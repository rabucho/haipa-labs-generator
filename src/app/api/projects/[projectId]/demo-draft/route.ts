import { NextRequest, NextResponse } from "next/server";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getReadyTemplate } from "@/lib/templates/registry";

/**
 * POST /api/projects/<projectId>/demo-draft — creates a project draft from
 * the template's built-in demo content (source: "fixture"). Server-side only;
 * validated against the approved schema before persistence. NEVER calls the
 * WordPress update API.
 */
export async function POST(
  _req: NextRequest,
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
  if (!template || !template.defaultContent) {
    return NextResponse.json(
      { ok: false, errors: ["Template has no demo content."] },
      { status: 400 }
    );
  }

  try {
    const draft = await projectDraftRepository.createDraft({
      projectId,
      templateId: project.templateId,
      content: template.defaultContent,
      source: "fixture",
    });
    await projectRepository.updateProject(projectId, {
      status: project.status === "brief" ? "draft" : project.status,
      currentDraftId: draft.id,
    });
    return NextResponse.json({ ok: true, draft }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, errors: [error instanceof Error ? error.message : String(error)] },
      { status: 400 }
    );
  }
}
