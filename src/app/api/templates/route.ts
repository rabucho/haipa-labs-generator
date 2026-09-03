import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedOperator, authErrorResponse } from "@/lib/auth/guards";
import { z } from "zod";
import { templateVersionStore } from "@/lib/templates/version-store";
import { templateFamilyStore } from "@/lib/templates/families";
import {
  BlankTemplateInputSchema,
  buildBlankDocument,
  BlankTemplateError,
} from "@/lib/templates/blank";
import type { BuilderDocument } from "@/types/builder";

/**
 * GET  /api/templates — safe catalog (no private project content).
 * POST /api/templates — create a new draft version (optionally based on one).
 */
export async function GET() {
  try {
    await requireAuthenticatedOperator();
    const versions = await templateVersionStore.list();
    const defaultVersionId = await templateVersionStore.getDefaultVersionId();
    return NextResponse.json({
      ok: true,
      defaultVersionId,
      versions: versions.map((v) => ({
        versionId: v.versionId,
        familyKey: v.familyKey,
        version: v.version,
        status: v.status,
        contentHash: v.contentHash,
        basedOnVersionId: v.basedOnVersionId ?? null,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        pageCount: v.document.pages.filter((p) => p.enabled).length,
        sectionCount: v.document.pages.reduce((n, p) => n + p.sections.length, 0),
      })),
    });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Could not load the catalog."] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthenticatedOperator();
    let body: {
      familyKey?: string;
      basedOnVersionId?: string;
      blank?: boolean;
      blankInput?: unknown;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // defaults apply
    }
    const familyKey = (body.familyKey ?? "professional-services")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40);
    if (!familyKey) {
      return NextResponse.json({ ok: false, errors: ["Invalid family key."] }, { status: 400 });
    }
    // Slice 16 Stage A: blank-template creation from approved sections/tokens.
    if (body.blank === true) {
      const blank = BlankTemplateInputSchema.safeParse(body.blankInput);
      if (!blank.success) {
        return NextResponse.json(
          { ok: false, errors: blank.error.issues.map((i: z.ZodIssue) => `${i.path.join(".")}: ${i.message}`) },
          { status: 400 }
        );
      }
      let document: BuilderDocument;
      try {
        document = buildBlankDocument(blank.data);
      } catch (error) {
        const errors = error instanceof BlankTemplateError ? error.errors : [String(error)];
        return NextResponse.json({ ok: false, errors }, { status: 409 });
      }
      const version = await templateVersionStore.createFamilyDraft({
        familyKey,
        document,
        createdBy: auth.userId,
      });
      await templateFamilyStore.register({
        familyKey,
        displayName: blank.data.displayName,
        description: blank.data.description,
        createdBy: auth.userId,
        versionId: version.versionId,
      });
      return NextResponse.json({ ok: true, versionId: version.versionId, version: version.version });
    }

    const version = await templateVersionStore.createFamilyDraft({
      familyKey,
      basedOnVersionId: body.basedOnVersionId,
      createdBy: auth.userId,
    });
    return NextResponse.json({ ok: true, versionId: version.versionId, version: version.version });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Could not create the draft version."] }, { status: 500 });
  }
}
