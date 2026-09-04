import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import {
  generationAuditRepository,
  INTERNAL_OPERATOR,
} from "@/lib/generation/audit";

/**
 * POST /api/projects/<projectId>/drafts/<draftId>/reject — marks a draft as
 * rejected (approved=false) and restores the previous known-good draft as
 * the current pointer when one exists. The rejected draft is retained for
 * the audit trail; nothing is deleted and no live system is touched.
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

  const rejected = await projectDraftRepository.setApproved(projectId, draftId, false);

  // Restore the most recent other draft as current (previous known-good).
  const others = (await projectDraftRepository.listDrafts(projectId)).filter(
    (d) => d.id !== draftId
  );
  const restored = others[0]?.id ?? null;
  await projectRepository.updateProject(projectId, {
    currentDraftId: restored ?? project.currentDraftId,
    status: restored ? ("review" as never) : project.status,
  });

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
    status: "rejected",
    startedAt: new Date().toISOString(),
    operator: INTERNAL_OPERATOR,
  });

  return NextResponse.json({ ok: true, draft: rejected, restoredCurrentDraftId: restored });
}
