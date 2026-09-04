import { NextRequest, NextResponse } from "next/server";
import { isValidProjectId } from "@/lib/projects/project-repository";
import {
  migrationPreview,
  executeMigration,
} from "@/lib/projects/site-migration";
import { requireAuthenticatedOperator, authErrorResponse } from "@/lib/auth/guards";

/**
 * SiteContent 1.0 → 2.0 migration (Slice 13, Stage C).
 *
 * GET  — read-only preview: source/target versions, page field counts,
 *        [For review] markers, warnings, idempotency state. No mutation,
 *        no WordPress calls.
 * POST — explicit execution ({ confirm: true }): creates a NEW review-status
 *        draft derived from the legacy draft. Idempotent via content-hash
 *        marker; the legacy draft is preserved unchanged.
 */
type RouteParams = { params: Promise<{ projectId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuthenticatedOperator();
    const { projectId } = await params;
    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
    }
    const result = await migrationPreview(auth, projectId);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Migration preview failed safely."] }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuthenticatedOperator();
    const { projectId } = await params;
    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
    }
    let confirmed = false;
    try {
      const body = (await req.json()) as { confirm?: boolean };
      confirmed = body?.confirm === true;
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      return NextResponse.json(
        { ok: false, errors: ["Migration requires explicit confirmation ({ confirm: true })."] },
        { status: 400 }
      );
    }
    const result = await executeMigration(auth, projectId);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Migration failed safely. The previous draft is unchanged."] }, { status: 500 });
  }
}
