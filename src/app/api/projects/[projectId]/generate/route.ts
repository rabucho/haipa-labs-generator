import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { briefRepository } from "@/lib/projects/brief-repository";
import { mediaRepository } from "@/lib/projects/media-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import {
  saveGeneratedDraft,
  type GenerationMetadata,
} from "@/lib/generation/deterministic-provider";
import { AI_CONTENT_PROMPT_VERSION } from "@/lib/generation/ai-provider";
import { isKnownProviderId } from "@/lib/generation/config";
import { resolveGenerationProvider } from "@/lib/generation/provider-registry";
import {
  generationAuditRepository,
  INTERNAL_OPERATOR,
} from "@/lib/generation/audit";
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { statusAfterGeneration } from "@/lib/projects/status";

/**
 * Project generation API (Slice 7).
 * POST /api/projects/<projectId>/generate  body: { provider: "deterministic" | "ai" }
 *
 * Guarantees:
 *  - NEVER calls a WordPress update endpoint.
 *  - Real AI runs only when AI_GENERATION_ENABLED=true AND AI_MODEL is set;
 *    otherwise a clear disabled state is returned (deterministic stays
 *    available).
 *  - On failure the previous draft is untouched; audit records the failure.
 *  - The new draft is saved ONLY after complete HomeContentSchema validation.
 *  - Drafts always start as review; the project is never auto-approved.
 *  - Client-facing errors are redacted: no provider internals or secrets.
 */
type RouteParams = { params: Promise<{ projectId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
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

  // Slice 12: provider registry. "ai" remains the legacy cloud provider id;
  // ollama/gemini/openrouter resolve through the same safe boundary. NO
  // silent fallback — an unavailable provider is a visible 409.
  let requestedProvider = "deterministic";
  let requestedModel: string | undefined;
  try {
    const body = (await req.json()) as { provider?: string; model?: string };
    if (body?.provider && isKnownProviderId(body.provider)) {
      requestedProvider = body.provider;
      requestedModel = typeof body.model === "string" ? body.model : undefined;
    }
  } catch {
    // empty body → deterministic
  }

  const resolved = resolveGenerationProvider(requestedProvider, requestedModel);
  if (!resolved.ok) {
    return NextResponse.json(
      {
        ok: false,
        errors: resolved.errors,
        providerDisabled: resolved.errorCode !== "unknown-provider",
      },
      { status: 409 }
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

  const auditBase = {
    projectId,
    provider: resolved.providerId,
    model: resolved.model,
    promptVersion:
      resolved.providerId === "deterministic-local"
        ? "deterministic-v1"
        : AI_CONTENT_PROMPT_VERSION,
    templateId: template.id,
    templateVersion: template.version,
    operator: INTERNAL_OPERATOR,
  };
  await generationAuditRepository.append(projectId, {
    ...auditBase,
    id: `audit_${randomUUID()}`,
    inputHash: "n/a",
    status: "started",
    startedAt: new Date().toISOString(),
  });

  const startedAt = Date.now();
  try {
    const input = {
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
    };

    const result = await resolved.provider.generateWebsiteDraft(input);

    const draft = await saveGeneratedDraft(projectDraftRepository, projectId, result);
    await projectRepository.updateProject(projectId, {
      status: statusAfterGeneration(project.status) as never,
      currentDraftId: draft.id,
    });

    const metadata = result.metadata as GenerationMetadata;
    await generationAuditRepository.append(projectId, {
      ...auditBase,
      id: `audit_${randomUUID()}`,
      draftId: draft.id,
      inputHash: metadata.inputHash,
      status: "succeeded",
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { ok: true, draftId: draft.id, metadata },
      { status: 201 }
    );
  } catch (error) {
    await generationAuditRepository.append(projectId, {
      ...auditBase,
      id: `audit_${randomUUID()}`,
      inputHash: "n/a",
      status: "failed",
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      errorCode: "generation-failed",
    });
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
