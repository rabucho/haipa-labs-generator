import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId } from "@/lib/projects/project-repository";
import { getWordPressStagingConfig } from "@/lib/wordpress-staging/config";
import { diffHomeContent } from "@/lib/wordpress-staging/diff";
import { getStagingProvider, WordPressSyncError } from "@/lib/wordpress-staging/provider";
import {
  syncHistoryRepository,
  makeSyncRecord,
} from "@/lib/wordpress-staging/sync-repository";
import { hashContent } from "@/lib/editor/draft-store";

/**
 * POST /api/projects/<projectId>/wordpress/diff
 *
 * Reads the bound staging page through the existing adapter and compares it
 * with the project's approved draft. READ-ONLY on WordPress (a single GET);
 * never writes. Records a redacted "diff" history entry. Uses stable
 * repeater IDs and excludes design-controlled values.
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
    const conn = project.wordpressConnection;
    if (!config.enabled || !conn) {
      return NextResponse.json(
        { ok: false, errors: ["Bind and verify a staging page first."], errorCode: "disabled" },
        { status: 409 }
      );
    }

    const drafts = await access.repos.drafts.listDrafts(projectId);
    const approved = drafts.find((d) => d.approved);
    if (!approved) {
      return NextResponse.json(
        { ok: false, errors: ["No approved draft. Approve a draft before comparing."], errorCode: "no-approved-draft" },
        { status: 409 }
      );
    }

    const provider = getStagingProvider();
    let staging;
    try {
      staging = await provider.readBack({ project });
    } catch (error) {
      const code =
        error instanceof WordPressSyncError ? error.errorCode : "unreachable";
      await syncHistoryRepository.append(
        projectId,
        makeSyncRecord({
          projectId,
          actorId: auth.userId,
          operation: "diff",
          draftId: approved.id,
          contentHash: hashContent(approved.content),
          templateKey: project.templateId,
          targetIdentifier: config.stagingUrl ? "[staging]" : null,
          startedAt: new Date().toISOString(),
          status: "failure",
          errorCode: code,
        })
      );
      return NextResponse.json(
        {
          ok: false,
          errorCode: code,
          errors: [
            code === "timeout"
              ? "The staging site did not respond in time."
              : code === "read-back-failed"
                ? "Staging content is missing required fields — import the ACF field group and fill the page first."
                : "Could not read staging content. Verify the connection and page binding.",
          ],
        },
        { status: 409 }
      );
    }

    const diff = diffHomeContent(approved.content, staging);

    await syncHistoryRepository.append(
      projectId,
      makeSyncRecord({
        projectId,
        actorId: auth.userId,
        operation: "diff",
        draftId: approved.id,
        contentHash: hashContent(approved.content),
        templateKey: project.templateId,
        targetIdentifier: config.stagingUrl ? "[staging]" : null,
        startedAt: new Date().toISOString(),
        status: "success",
      })
    );

    return NextResponse.json({ ok: true, diff, unchanged: diff.unchanged });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json({ ok: false, errors: ["Diff failed safely."] }, { status: 500 });
  }
}
