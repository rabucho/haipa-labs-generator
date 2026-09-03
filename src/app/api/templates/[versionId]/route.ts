import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedOperator, authErrorResponse } from "@/lib/auth/guards";
import { templateVersionStore } from "@/lib/templates/version-store";
import { BuilderDocumentSchema } from "@/types/builder";

/**
 * GET  /api/templates/<versionId> — one version (safe metadata + document).
 * PUT  /api/templates/<versionId> — save the builder document into a DRAFT
 *      version only. Published versions are immutable (error: immutable).
 */
type RouteParams = { params: Promise<{ versionId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireAuthenticatedOperator();
    const { versionId } = await params;
    const version = await templateVersionStore.get(versionId);
    if (!version) {
      return NextResponse.json({ ok: false, errors: ["Version not found."] }, { status: 404 });
    }
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Could not load the version."] }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuthenticatedOperator();
    const { versionId } = await params;
    let doc: unknown;
    try {
      const body = (await req.json()) as { document?: unknown };
      doc = body?.document;
    } catch {
      return NextResponse.json({ ok: false, errors: ["Invalid JSON body."] }, { status: 400 });
    }
    const parsed = BuilderDocumentSchema.safeParse(doc);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const result = await templateVersionStore.saveDraftDocument(versionId, parsed.data, auth.userId);
    if (!result.ok) {
      return NextResponse.json(result, { status: result.errorCode === "not-found" ? 404 : 409 });
    }
    return NextResponse.json({ ok: true, version: { versionId: result.version.versionId, contentHash: result.version.contentHash } });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Could not save the draft."] }, { status: 500 });
  }
}
