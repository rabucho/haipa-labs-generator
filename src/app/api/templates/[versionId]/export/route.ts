import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
} from "@/lib/auth/guards";
import { isValidVersionId, templateVersionStore } from "@/lib/templates/version-store";
import { templateFamilyStore } from "@/lib/templates/families";
import { buildTemplatePackage } from "@/lib/templates/package";

/**
 * GET /api/templates/<versionId>/export  (Slice 21)
 * Returns the versioned, deterministic template package for review or
 * re-import elsewhere. A catalog export — never a WordPress/deployment call.
 */
type RouteParams = { params: Promise<{ versionId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireAuthenticatedOperator();
    const { versionId } = await params;
    if (!isValidVersionId(versionId)) {
      return NextResponse.json({ ok: false, errors: ["Invalid version id."] }, { status: 400 });
    }
    const version = await templateVersionStore.get(versionId);
    if (!version) {
      return NextResponse.json({ ok: false, errors: ["Version not found."] }, { status: 404 });
    }
    const family = await templateFamilyStore.get(version.familyKey);
    const pkg = buildTemplatePackage({
      familyKey: version.familyKey,
      familyName: family?.displayName ?? version.familyKey,
      version: version.version,
      document: version.document,
      source: version.provenance?.source ?? "omoka-export",
    });
    return new NextResponse(JSON.stringify(pkg, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="template-${version.familyKey}-${version.version}.json"`,
      },
    });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Export failed."] }, { status: 500 });
  }
}
