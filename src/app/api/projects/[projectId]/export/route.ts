import { NextRequest, NextResponse } from "next/server";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getReadyTemplate } from "@/lib/templates/registry";
import { buildPageAwareInventory } from "@/lib/templates/page-inventory";
import { enabledPages } from "@/types/pages";
import {
  generateAcfFieldGroup,
  generateFieldMappings,
} from "@/lib/schema/generate";
import { contentInventory } from "@/content/content-inventory";

/**
 * GET /api/projects/<projectId>/export?kind=acf|mappings|content|full
 * Generates review artifacts locally and offline from the approved inventory
 * and the project's template. NEVER contacts WordPress. `content` exports the
 * current draft; `full` bundles version + template info + ACF group + mappings.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
  }
  const project = await projectRepository.loadProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, errors: ["Project not found."] }, { status: 404 });
  }
  const template = getReadyTemplate(project.templateId);
  if (!template) {
    return NextResponse.json(
      { ok: false, errors: ["Template unavailable."] },
      { status: 400 }
    );
  }

  const kind = new URL(req.url).searchParams.get("kind") ?? "full";
  const version = {
    templateKey: project.templateId,
    templateVersion: template.version,
    schemaVersion: 1,
  };
  const group = generateAcfFieldGroup(contentInventory, version);
  const mappings = generateFieldMappings(contentInventory, version);

  let payload: unknown;
  let filename: string;
  switch (kind) {
    case "acf":
      payload = group;
      filename = "acf-field-group.json";
      break;
    case "mappings":
      payload = mappings;
      filename = "field-mappings.json";
      break;
    case "content": {
      const current = project.currentDraftId
        ? await projectDraftRepository.loadDraft(projectId, project.currentDraftId)
        : null;
      if (!current) {
        return NextResponse.json(
          { ok: false, errors: ["No current draft to export. Generate or save one first."] },
          { status: 404 }
        );
      }
      payload = {
        projectId: project.id,
        templateId: project.templateId,
        draftId: current.id,
        source: current.source,
        approved: current.approved,
        updatedAt: current.updatedAt,
        content: current.content,
      };
      filename = `draft-content-${current.id}.json`;
      break;
    }
    case "full":
      payload = {
        schemaVersion: version.schemaVersion,
        templateKey: version.templateKey,
        templateVersion: version.templateVersion,
        projectId: project.id,
        projectName: project.name,
        pageManifest: enabledPages({}).map((p) => ({
          pageKey: p.pageKey,
          route: p.route,
          displayName: p.displayName,
        })),
        pageAwareInventory: buildPageAwareInventory().map((f) => ({
          pageKey: f.pageKey,
          path: f.path,
          label: f.label,
          type: f.type,
          required: f.required,
          maxLength: f.maxLength ?? null,
          wpName: f.wpName,
          sourceComponent: f.sourceComponent,
        })),
        acfFieldGroup: group,
        fieldMappings: mappings,
      };
      filename = "full-export.json";
      break;
    case "page-inventory":
      payload = {
        schemaVersion: version.schemaVersion,
        templateKey: version.templateKey,
        templateVersion: version.templateVersion,
        siteContentSchemaVersion: "2.0",
        fields: buildPageAwareInventory().map((f) => ({
          pageKey: f.pageKey,
          path: f.path,
          label: f.label,
          type: f.type,
          required: f.required,
          maxLength: f.maxLength ?? null,
          wpName: f.wpName,
          sourceComponent: f.sourceComponent,
        })),
      };
      filename = "page-aware-inventory.json";
      break;
    default:
      return NextResponse.json(
        { ok: false, errors: [`Unknown export kind: ${kind}`] },
        { status: 400 }
      );
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
