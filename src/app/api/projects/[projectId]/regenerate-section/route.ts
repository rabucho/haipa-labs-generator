import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { HomeContentSchema, type HomeContent } from "@/types/content";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { briefRepository } from "@/lib/projects/brief-repository";
import { mediaRepository } from "@/lib/projects/media-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { serverAiProvider, AI_CONTENT_PROMPT_VERSION } from "@/lib/generation/ai-provider";
import { getAiGenerationConfig } from "@/lib/generation/config";
import {
  generationAuditRepository,
  INTERNAL_OPERATOR,
} from "@/lib/generation/audit";
import type { RegeneratableSection } from "@/lib/generation/ai-content-schema";

/**
 * POST /api/projects/<projectId>/regenerate-section — Part H: AI
 * regeneration of ONE approved section. Validates the section BEFORE
 * merging; on failure the existing section (and draft) is unchanged.
 * Saves the merged result as a NEW draft (previous draft preserved).
 * Body: { draftId, section: "hero"|"about"|"services"|"faqs"|"contact"|"footer" }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
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
    return NextResponse.json({ ok: false, errors: ["Template unavailable."] }, { status: 400 });
  }

  const config = getAiGenerationConfig();
  if (!config.enabled) {
    return NextResponse.json(
      { ok: false, errors: ["Real AI generation is disabled — section regeneration requires it."], providerDisabled: true },
      { status: 409 }
    );
  }

  let body: { draftId?: string; section?: string };
  try {
    body = (await req.json()) as { draftId?: string; section?: string };
  } catch {
    return NextResponse.json({ ok: false, errors: ["Invalid JSON body."] }, { status: 400 });
  }
  const { draftId, section } = body;
  if (!draftId || !section) {
    return NextResponse.json(
      { ok: false, errors: ["draftId and section are required."] },
      { status: 400 }
    );
  }

  const draft = await projectDraftRepository.loadDraft(projectId, draftId);
  if (!draft) {
    return NextResponse.json({ ok: false, errors: ["Draft not found."] }, { status: 404 });
  }

  const brief = await briefRepository.loadBrief(projectId);
  if (!brief) {
    return NextResponse.json({ ok: false, errors: ["Save a brief first."] }, { status: 400 });
  }
  const approvedMedia = (await mediaRepository.listMedia(projectId)).filter((m) => m.approved);

  const startedAt = Date.now();
  try {
    const result = await serverAiProvider.regenerateSection(
      {
        project: { id: project.id, name: project.name, slug: project.slug, industry: project.industry },
        brief,
        media: approvedMedia,
        template,
        inventory: contentInventory,
      },
      section as RegeneratableSection,
      draft.content
    );

    // Merge into a complete draft and validate the WHOLE result before save.
    const merged = { ...draft.content, [section]: result.section } as HomeContent;
    const validated = HomeContentSchema.safeParse(merged);
    if (!validated.success) {
      throw new Error("Merged draft failed HomeContentSchema — section unchanged.");
    }

    const newDraft = await projectDraftRepository.createDraft({
      projectId,
      templateId: template.id,
      content: validated.data,
      source: "ai",
      aiPromptVersion: `${result.promptVersion}#${(draft.aiPromptVersion ?? "").split("#")[1] ?? "n/a"}`,
    });
    await projectRepository.updateProject(projectId, { currentDraftId: newDraft.id });

    await generationAuditRepository.append(projectId, {
      id: `audit_${randomUUID()}`,
      projectId,
      draftId: newDraft.id,
      provider: config.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      templateId: template.id,
      templateVersion: template.version,
      inputHash: (newDraft.aiPromptVersion ?? "").split("#")[1] ?? "n/a",
      status: "succeeded",
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      operator: INTERNAL_OPERATOR,
    });

    return NextResponse.json(
      { ok: true, draftId: newDraft.id, section },
      { status: 201 }
    );
  } catch (error) {
    await generationAuditRepository.append(projectId, {
      id: `audit_${randomUUID()}`,
      projectId,
      draftId,
      provider: config.provider,
      model: config.model,
      promptVersion: AI_CONTENT_PROMPT_VERSION,
      templateId: template.id,
      templateVersion: template.version,
      inputHash: "n/a",
      status: "failed",
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      errorCode: "section-regeneration-failed",
      operator: INTERNAL_OPERATOR,
    });
    return NextResponse.json(
      {
        ok: false,
        errors: [
          `Section regeneration failed — the existing section is unchanged. ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      },
      { status: 500 }
    );
  }
}
