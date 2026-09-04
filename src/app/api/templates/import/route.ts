import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedOperator, authErrorResponse } from "@/lib/auth/guards";
import { templateVersionStore } from "@/lib/templates/version-store";
import {
  validatePackageImport,
  TEMPLATE_PACKAGE_VERSION,
} from "@/lib/templates/package";

/**
 * POST /api/templates/import  (Slice 21)
 *
 * Accepts a structured template package (JSON object or { packageJson }).
 * Parsed with JSON.parse (no evaluation), strictly schema-validated,
 * unsafe-content scanned, duplicate-checked — then imported as a NEW draft
 * version. Never overwrites a published/existing version. Never a WordPress
 * write or deployment.
 *
 * Body shape: the package itself, or { packageJson: "<json string>" }.
 */
const MAX_PACKAGE_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthenticatedOperator();

    const rawBody = await req.text();
    if (rawBody.length > MAX_PACKAGE_BYTES) {
      return NextResponse.json(
        { ok: false, errors: ["Import payload exceeds the 256 KB size limit."] },
        { status: 413 }
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { ok: false, errors: ["Malformed JSON — the import payload is not valid JSON."] },
        { status: 400 }
      );
    }

    const container = parsedBody as { packageJson?: unknown };
    const packageJson =
      typeof container?.packageJson === "string" ? container.packageJson : null;
    let pkg: unknown;
    if (packageJson !== null) {
      if (packageJson.length > MAX_PACKAGE_BYTES) {
        return NextResponse.json(
          { ok: false, errors: ["Import payload exceeds the 256 KB size limit."] },
          { status: 413 }
        );
      }
      try {
        pkg = JSON.parse(packageJson);
      } catch {
        return NextResponse.json(
          { ok: false, errors: ["Malformed JSON inside packageJson."] },
          { status: 400 }
        );
      }
    } else {
      pkg = parsedBody;
    }

    const all = await templateVersionStore.list();
    const existing = all.map((v) => ({ familyKey: v.familyKey, version: v.version }));
    const check = validatePackageImport(pkg, existing, MAX_PACKAGE_BYTES, rawBody.length);
    if (!check.ok) {
      return NextResponse.json(
        { ok: false, errors: check.errors, warnings: check.warnings },
        { status: check.errors[0]?.startsWith("Package exceeds") ? 413 : 422 }
      );
    }

    const imported = await templateVersionStore.importDraft({
      familyKey: check.family.key,
      displayName: check.family.name,
      version: check.version,
      document: check.document,
      actorId: auth.userId,
      provenance: {
        source: pkg && typeof pkg === "object" && (pkg as { provenance?: { source?: unknown } }).provenance
          ? String((pkg as { provenance: { source: unknown } }).provenance.source).slice(0, 60)
          : "external-import",
        ...(pkg && typeof pkg === "object" &&
        typeof (pkg as { provenance?: { label?: unknown } }).provenance?.label === "string"
          ? {
              label: String(
                (pkg as { provenance: { label: unknown } }).provenance.label
              ).slice(0, 120),
            }
          : {}),
      },
    });
    if (!imported.ok) {
      return NextResponse.json(
        { ok: false, errors: imported.errors },
        { status: imported.errorCode === "duplicate" ? 409 : 400 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        versionId: imported.version.versionId,
        familyKey: imported.version.familyKey,
        version: imported.version.version,
        contentHash: imported.version.contentHash,
        packageVersion: TEMPLATE_PACKAGE_VERSION,
        warnings: check.warnings,
        status: imported.version.status,
      },
      { status: 201 }
    );
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json(
      { ok: false, errors: ["Import failed safely. Nothing was persisted."] },
      { status: 500 }
    );
  }
}
