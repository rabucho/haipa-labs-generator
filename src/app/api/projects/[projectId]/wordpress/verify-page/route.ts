import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId } from "@/lib/projects/project-repository";
import { verifyPageBinding } from "@/lib/wordpress-staging/connection";

/**
 * POST /api/projects/<projectId>/wordpress/verify-page
 *
 * READ-ONLY: confirms the bound page exists on the allowlisted staging origin
 * and persists only the verification flag/timestamp. Never writes to WordPress.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireAuthenticatedOperator();
    const { projectId } = await params;
    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
    }
    const access = await requireProjectAccess(auth, projectId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, errors: ["Project not found."] }, { status: 404 });
    }

    const result = await verifyPageBinding(auth, projectId);
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.view, page: result.page });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json({ ok: false, errors: ["Page verification failed."] }, { status: 500 });
  }
}
