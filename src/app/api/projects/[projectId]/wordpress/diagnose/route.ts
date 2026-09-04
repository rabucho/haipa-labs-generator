import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId } from "@/lib/projects/project-repository";
import {
  getStagingProvider,
  getWordPressStagingConfig,
  redactedStagingConfigSummary,
} from "@/lib/wordpress-staging/provider";
import { syncHistoryRepository, makeSyncRecord } from "@/lib/wordpress-staging/sync-repository";

/**
 * POST /api/projects/<projectId>/wordpress/diagnose
 * Probes the configured staging WordPress (reads only). Never a write.
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

    const provider = getStagingProvider();
    const startedAt = new Date().toISOString();
    const diagnostics = await provider.diagnose();
    const config = getWordPressStagingConfig();

    await syncHistoryRepository.append(
      projectId,
      makeSyncRecord({
        projectId,
        actorId: auth.userId,
        operation: "diagnose",
        targetIdentifier: config.stagingUrl ? "[staging]" : null,
        startedAt,
        status: diagnostics.ok ? "success" : "failure",
        errorCode: diagnostics.errorCode,
      })
    );

    return NextResponse.json({ ok: true, diagnostics, config: redactedStagingConfigSummary(config) });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json(
      { ok: false, errors: ["Diagnosis failed with a safe error."] },
      { status: 500 }
    );
  }
}
