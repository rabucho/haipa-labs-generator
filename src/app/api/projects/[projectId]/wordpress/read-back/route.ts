import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId } from "@/lib/projects/project-repository";
import { hashContent } from "@/lib/editor/draft-store";
import { getStagingProvider, getWordPressStagingConfig } from "@/lib/wordpress-staging/provider";
import {
  syncHistoryRepository,
  makeSyncRecord,
} from "@/lib/wordpress-staging/sync-repository";
import { WordPressSyncError } from "@/lib/wordpress-staging/provider";

/**
 * POST /api/projects/<projectId>/wordpress/read-back
 * READ-ONLY: fetches the staging page through the existing adapter and
 * validates it with HomeContentSchema. Records a diagnostic history entry.
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
    const { project } = access;

    const config = getWordPressStagingConfig();
    const provider = getStagingProvider();
    const startedAt = new Date().toISOString();
    try {
      const content = await provider.readBack({ project });
      await syncHistoryRepository.append(
        projectId,
        makeSyncRecord({
          projectId,
          actorId: auth.userId,
          operation: "read-back",
          contentHash: hashContent(content),
          targetIdentifier: config.stagingUrl ? "[staging]" : null,
          startedAt,
          status: "success",
          readBackVerified: true,
        })
      );
      return NextResponse.json({
        ok: true,
        verified: true,
        preview: { heroTitle: content.hero.title, services: content.services.items.length },
      });
    } catch (readError) {
      const code =
        readError instanceof WordPressSyncError ? readError.errorCode : "read-back-failed";
      await syncHistoryRepository.append(
        projectId,
        makeSyncRecord({
          projectId,
          actorId: auth.userId,
          operation: "read-back",
          targetIdentifier: config.stagingUrl ? "[staging]" : null,
          startedAt,
          status: code === "unsupported" ? "unsupported" : "failure",
          errorCode: code,
        })
      );
      return NextResponse.json(
        {
          ok: false,
          verified: false,
          errorCode: code,
          errors: [
            readError instanceof Error
              ? readError.message
              : "Read-back failed with a safe error.",
          ],
        },
        { status: 502 }
      );
    }
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json(
      { ok: false, errors: ["Read-back failed with a safe error."] },
      { status: 500 }
    );
  }
}
