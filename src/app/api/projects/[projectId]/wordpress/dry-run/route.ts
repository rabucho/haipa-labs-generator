import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId } from "@/lib/projects/project-repository";
import { getStagingProvider, getWordPressStagingConfig } from "@/lib/wordpress-staging/provider";
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { generateAcfFieldGroup, generateFieldMappings } from "@/lib/schema/generate";
import { homeSchemaVersion } from "@/content/schema-version";

/**
 * POST /api/projects/<projectId>/wordpress/dry-run
 * PURE: zero network I/O. Shows exactly what a sync would write.
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
    const { project, repos } = access;

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
          errors: [
            "No approved draft. Approve a draft in Review before running a dry run or sync.",
          ],
          errorCode: "no-approved-draft",
        },
        { status: 409 }
      );
    }

    const acfDefinition = generateAcfFieldGroup(contentInventory, {
      ...homeSchemaVersion,
      templateKey: template.id,
      templateVersion: template.version,
    });
    const mappings = generateFieldMappings(contentInventory, {
      ...homeSchemaVersion,
      templateKey: template.id,
      templateVersion: template.version,
    });

    const provider = getStagingProvider();
    const dryRun = await provider.dryRun({
      project,
      approvedDraft: {
        id: approved.id,
        projectId,
        content: approved.content,
        templateId: approved.templateId,
        approved: approved.approved,
      },
      inventory: contentInventory,
      acfDefinition,
      mappings,
    });

    return NextResponse.json({
      ok: true,
      dryRun: {
        ...dryRun,
        acfDefinition: undefined, // reviewed separately on Exports
      },
      fieldGroupKey: acfDefinition.key,
      templateVersion: template.version,
      draftId: approved.id,
      integrationEnabled: getWordPressStagingConfig().enabled,
    });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return NextResponse.json(
      { ok: false, errors: ["Dry run failed with a safe error."] },
      { status: 500 }
    );
  }
}
