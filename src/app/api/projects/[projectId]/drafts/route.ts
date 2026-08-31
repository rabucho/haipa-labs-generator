import { NextRequest, NextResponse } from "next/server";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getReadyTemplate } from "@/lib/templates/registry";

/**
 * Project-scoped drafts API (Slice A).
 * GET  /api/projects/<projectId>/drafts — list drafts for one project.
 * POST /api/projects/<projectId>/drafts — create a draft from submitted
 * content (validated against the approved HomeContentSchema before storage).
 * Saving a draft NEVER calls the WordPress update API.
 */
export async function GET(
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
  const drafts = await projectDraftRepository.listDrafts(projectId);
  return NextResponse.json({ ok: true, drafts });
}

export async function POST(
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
      { ok: false, errors: [`Project template is not available: ${project.templateId}`] },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errors: ["Request body must be valid JSON."] }, { status: 400 });
  }

  const { content, source, aiPromptVersion } = (body ?? {}) as {
    content?: unknown;
    source?: string;
    aiPromptVersion?: string;
  };

  const draftSource =
    source === "ai" || source === "manual" || source === "wordpress"
      ? source
      : ("manual" as const);

  try {
    const draft = await projectDraftRepository.createDraft({
      projectId,
      templateId: project.templateId,
      content: content as never,
      source: draftSource,
      ...(aiPromptVersion ? { aiPromptVersion } : {}),
    });
    await projectRepository.updateProject(projectId, {
      status: project.status === "brief" || project.status === "generating" ? "draft" : project.status,
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
