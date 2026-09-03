import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import {
  generationAuditRepository,
  INTERNAL_OPERATOR,
} from "@/lib/generation/audit";

/**
 * POST /api/projects/<projectId>/drafts/<draftId>/approve — explicit human
 * approval. Requires schema-valid content (the draft store already gates
 * this). Records a redacted audit event. NEVER publishes to WordPress or
 * deploys anything.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; draftId: string }> }
) {
  const { projectId, draftId } = await params;
  if (!isValidProjectId(projectId) || !/^[a-zA-Z0-9_-]+$/.test(draftId)) {
    return NextResponse.json({ ok: false, errors: ["Invalid ids."] }, { status: 400 });
  }
  const project = await projectRepository.loadProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, errors: ["Project not found."] }, { status: 404 });
  }
  const draft = await projectDraftRepository.loadDraft(projectId, draftId);
  if (!draft) {
    return NextResponse.json({ ok: false, errors: ["Draft not found."] }, { status: 404 });
  }

  // Draft content is schema-validated at load; refuse approval otherwise.
  if (!draft.content || !draft.content.hero?.title) {
    return NextResponse.json(
      { ok: false, errors: ["Draft failed schema validation and cannot be approved."] },
      { status: 422 }
    );
  }

  const approved = await projectDraftRepository.setApproved(projectId, draftId, true);
  if (!approved) {
    return NextResponse.json({ ok: false, errors: ["Approval failed."] }, { status: 500 });
  }
  await projectRepository.updateProject(projectId, { status: "approved" as never });

  await generationAuditRepository.append(projectId, {
    id: `audit_${randomUUID()}`,
    projectId,
    draftId,
    provider: draft.source === "ai" ? "ai" : draft.source,
    model: "n/a",
    promptVersion: draft.aiPromptVersion ?? "n/a",
    templateId: draft.templateId,
    templateVersion: "n/a",
    inputHash: (draft.aiPromptVersion ?? "").split("#")[1] ?? "n/a",
    status: "approved",
    startedAt: new Date().toISOString(),
    operator: INTERNAL_OPERATOR,
  });

  return NextResponse.json({ ok: true, draft: approved });
}
