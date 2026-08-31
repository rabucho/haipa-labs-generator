import { NextRequest, NextResponse } from "next/server";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { briefRepository } from "@/lib/projects/brief-repository";
import { mediaRepository } from "@/lib/projects/media-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import {
  deterministicProvider,
  saveGeneratedDraft,
} from "@/lib/generation/deterministic-provider";
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { statusAfterGeneration } from "@/lib/projects/status";

/**
 * Project generation API (Slice 6).
 * POST /api/projects/<projectId>/generate — runs the deterministic local
 * provider against the saved brief + approved media and persists a NEW draft.
 *
 * Guarantees:
 *  - NEVER calls a WordPress update endpoint.
 *  - On failure the previous draft is untouched (generation throws BEFORE any
 *    persistence; the draft repository itself also schema-gates writes).
 *  - The project is never auto-approved: status moves brief/draft → review only.
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
  if (!template) {
    return NextResponse.json(
      { ok: false, errors: [`Project template is not available: ${project.templateId}`] },
      { status: 400 }
    );
  }

  const brief = await briefRepository.loadBrief(projectId);
  if (!brief) {
    return NextResponse.json(
      { ok: false, errors: ["Save a project brief before generating a draft."] },
      { status: 400 }
    );
  }

  const allMedia = await mediaRepository.listMedia(projectId);
  const approvedMedia = allMedia.filter((m) => m.approved);

  try {
    const result = await deterministicProvider.generateWebsiteDraft({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        industry: project.industry,
      },
      brief,
      media: approvedMedia,
      template,
      inventory: contentInventory,
    });

    const draft = await saveGeneratedDraft(projectDraftRepository, projectId, result);
    await projectRepository.updateProject(projectId, {
      status: statusAfterGeneration(project.status) as never,
      currentDraftId: draft.id,
    });

    return NextResponse.json(
      { ok: true, draftId: draft.id, metadata: result.metadata },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          `Generation failed — the previous draft is unchanged. ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      },
      { status: 500 }
    );
  }
}
