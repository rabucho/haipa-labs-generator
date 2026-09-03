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
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { generateFieldMappings } from "@/lib/schema/generate";
import { homeSchemaVersion } from "@/content/schema-version";

/**
 * POST /api/projects/<projectId>/wordpress/sync  body: { confirm: true }
 *
 * Writes ONLY the approved draft through the mapping to the project staging
 * target. Requires an explicit { confirm: true }. A review/rejected draft is
 * refused. Records a redacted sync record; never deletes or overwrites the
 * previous record. Read-back verification runs through the existing adapter.
 */
export async function POST(
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
    const { project, repos } = access;

    let confirmed = false;
    try {
      const body = (await req.json()) as { confirm?: boolean };
      confirmed = body?.confirm === true;
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      return NextResponse.json(
        { ok: false, errors: ["Sync requires explicit confirmation ({ confirm: true })."] },
        { status: 400 }
      );
    }

    const config = getWordPressStagingConfig();
    if (!config.enabled) {
      return NextResponse.json(
        {
          ok: false,
          errors: [
            "WordPress staging integration is disabled. Set WORDPRESS_INTEGRATION_ENABLED=true and WORDPRESS_STAGING_URL on the server.",
          ],
          errorCode: "disabled",
        },
        { status: 409 }
      );
    }

    const template = getReadyTemplate(project.templateId);
    if (!template) {
      return NextResponse.json(
        { ok: false, errors: ["Project template is not available."] },
        { status: 400 }
      );
    }

    const drafts = await repos.drafts.listDrafts(projectId);
    const approved = drafts.find((d) => d.approved);
    if (!approved) {
      return NextResponse.json(
        {
          ok: false,
          errors: ["No approved draft. Only explicitly approved drafts can be synced."],
          errorCode: "no-approved-draft",
        },
        { status: 409 }
      );
    }

    const mappings = generateFieldMappings(contentInventory, {
      ...homeSchemaVersion,
      templateKey: template.id,
      templateVersion: template.version,
    });

    const provider = getStagingProvider();
    const startedAt = new Date().toISOString();
    const result = await provider.syncApprovedContent({
      project,
      approvedDraft: {
        id: approved.id,
        projectId,
        content: approved.content,
        templateId: approved.templateId,
        approved: approved.approved,
      },
      mappings,
    });

    await syncHistoryRepository.append(
      projectId,
      makeSyncRecord({
        projectId,
        actorId: auth.userId,
        operation: "content-sync",
        draftId: approved.id,
        contentHash: hashContent(approved.content),
        templateKey: template.id,
        templateVersion: template.version,
        schemaVersion: homeSchemaVersion.schemaVersion,
        mappingVersion: `mapping-v${homeSchemaVersion.schemaVersion}`,
        targetIdentifier: "[staging]",
        startedAt,
        status: result.ok ? (result.readBackVerified ? "success" : "failure") : "failure",
        errorCode: result.errorCode,
        readBackVerified: result.readBackVerified,
      })
    );

    // Redacted response: no raw provider bodies.
    return NextResponse.json({
      ok: result.ok,
      pageId: result.pageId,
      readBackVerified: result.readBackVerified,
      readBackPreview: result.readBackVerified
        ? { heroTitle: result.readBackContent?.hero.title }
        : null,
      detail: result.detail,
      errorCode: result.errorCode,
    });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json(
      { ok: false, errors: ["Sync failed with a safe error. The previous staging content is unchanged."] },
      { status: 500 }
    );
  }
}
