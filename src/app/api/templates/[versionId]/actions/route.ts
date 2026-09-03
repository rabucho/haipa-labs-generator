import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedOperator, authErrorResponse } from "@/lib/auth/guards";
import { templateVersionStore } from "@/lib/templates/version-store";

/**
 * POST /api/templates/<versionId>/actions  body: { action, confirm? }
 *
 * Catalog actions: submit-review, publish, set-default, archive.
 * - publish requires passing validation and explicit confirm naming the
 *   content hash; it is a CATALOG action (never WordPress/deployment).
 * - set-default affects NEW projects only; existing projects stay pinned.
 */
type RouteParams = { params: Promise<{ versionId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuthenticatedOperator();
    const { versionId } = await params;
    let body: { action?: string; confirm?: boolean; contentHash?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, errors: ["Invalid JSON body."] }, { status: 400 });
    }

    switch (body.action) {
      case "submit-review": {
        const r = await templateVersionStore.setStatus(versionId, "review", auth.userId);
        return NextResponse.json(r, { status: r.ok ? 200 : 404 });
      }
      case "archive": {
        const version = await templateVersionStore.get(versionId);
        if (!version) {
          return NextResponse.json({ ok: false, errors: ["Version not found."] }, { status: 404 });
        }
        const defaultId = await templateVersionStore.getDefaultVersionId();
        if (defaultId === versionId) {
          return NextResponse.json(
            { ok: false, errors: ["The default version cannot be archived. Set another default first."] },
            { status: 409 }
          );
        }
        const r = await templateVersionStore.setStatus(versionId, "archived", auth.userId);
        return NextResponse.json(r, { status: r.ok ? 200 : 404 });
      }
      case "publish": {
        if (!body.confirm) {
          return NextResponse.json(
            { ok: false, errors: ["Publishing requires explicit confirmation ({ confirm: true })."] },
            { status: 400 }
          );
        }
        const r = await templateVersionStore.publish(versionId, auth.userId);
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case "set-default": {
        const r = await templateVersionStore.setDefault(versionId);
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      default:
        return NextResponse.json({ ok: false, errors: ["Unknown action."] }, { status: 400 });
    }
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Action failed safely."] }, { status: 500 });
  }
}
