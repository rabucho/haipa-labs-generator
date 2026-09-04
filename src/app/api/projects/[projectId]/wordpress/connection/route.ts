import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId } from "@/lib/projects/project-repository";
import { getWordPressStagingConfig } from "@/lib/wordpress-staging/config";
import {
  toConnectionView,
  saveConnection,
} from "@/lib/wordpress-staging/connection";

/**
 * GET  /api/projects/<projectId>/wordpress/connection
 *   Redacted connection view: target label, page binding, verification state.
 *   Never exposes the credential reference name or its value.
 *
 * PUT  /api/projects/<projectId>/wordpress/connection
 *   Body: { targetKey: "staging", pageId?: number, pageSlug?: string }
 *   Validates the target against the server-side allowlist and persists the
 *   binding. Read-only metadata only; never contacts WordPress.
 */
export async function GET(
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
    const config = getWordPressStagingConfig();
    return NextResponse.json({
      ok: true,
      ...toConnectionView(access.project.wordpressConnection, config),
    });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json({ ok: false, errors: ["Could not load connection."] }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, errors: ["Invalid JSON body."] }, { status: 400 });
    }

    const result = await saveConnection(auth, projectId, body);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result.view });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json({ ok: false, errors: ["Could not save connection."] }, { status: 500 });
  }
}
