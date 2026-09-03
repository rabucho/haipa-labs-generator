import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId, projectRepository } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { hashContent } from "@/lib/editor/draft-store";
import {
  assessReadiness,
  createChecklist,
  listChecklists,
  updateCheck,
  findCurrentChecklist,
} from "@/lib/qa/checklist";

/**
 * Slice 18 — project-scoped demo QA checklist.
 *
 * GET  /api/projects/<id>/qa
 *      Lists checklists with honest readiness assessment against the
 *      currently approved draft (server-side evidence only).
 * POST /api/projects/<id>/qa
 *      { action: "create" } — bind a checklist to the approved content
 *      hash + template version (idempotent).
 *      { action: "update-check", checklistId, checkId, status, evidence? }
 */
type RouteParams = { params: Promise<{ projectId: string }> };

async function currentApprovalState(projectId: string): Promise<{
  approvedContentHash: string | null;
  templateVersionId: string | null;
  approvedDraftId: string | null;
}> {
  const drafts = await projectDraftRepository.listDrafts(projectId);
  const approved = drafts.find((d) => d.approved) ?? null;
  const project = await projectRepository.loadProject(projectId);
  return {
    approvedContentHash: approved ? hashContent(approved.content) : null,
    templateVersionId: project?.templateVersionId ?? null,
    approvedDraftId: approved?.id ?? null,
  };
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
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

    const approval = await currentApprovalState(projectId);
    let stagingSynced = false;
    let readBackVerified = false;
    try {
      const { syncHistoryRepository } = await import("@/lib/wordpress-staging/sync-repository");
      const history = await syncHistoryRepository.list(projectId);
      stagingSynced = history.some((r) => r.operation === "content-sync" && r.status === "success");
      readBackVerified = history.some(
        (r) => r.operation === "content-sync" && r.status === "success" && r.readBackVerified
      );
    } catch {
      // History unavailable → honest pending default.
    }

    const checklists = await listChecklists(projectId);
    const current = await findCurrentChecklist(
      projectId,
      approval.approvedContentHash,
      approval.templateVersionId
    );
    const assessments = checklists.map((c) => ({
      checklist: c,
      readiness: assessReadiness({
        checklist: c,
        approvedContentHash: approval.approvedContentHash,
        readBackVerified,
        stagingSynced,
      }),
      isCurrent: current?.checklistId === c.checklistId,
    }));

    return NextResponse.json({
      ok: true,
      approvedDraftId: approval.approvedDraftId,
      approvedContentHash: approval.approvedContentHash,
      templateVersionId: approval.templateVersionId,
      stagingSynced,
      readBackVerified,
      checklists: assessments,
    });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["QA listing failed safely."] }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
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

    let body: {
      action?: string;
      checklistId?: string;
      checkId?: string;
      status?: string;
      evidence?: string;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, errors: ["Invalid JSON body."] }, { status: 400 });
    }

    if (body.action === "create") {
      const approval = await currentApprovalState(projectId);
      const r = await createChecklist({
        projectId,
        operatorId: auth.userId,
        templateVersionId: approval.templateVersionId,
        contentHash: approval.approvedContentHash,
        schemaVersion: "2.0",
      });
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }

    if (body.action === "update-check") {
      if (!body.checklistId || !body.checkId) {
        return NextResponse.json(
          { ok: false, errors: ["update-check requires checklistId and checkId."] },
          { status: 400 }
        );
      }
      const validStatuses = ["pending", "passed", "failed", "not_applicable"] as const;
      if (!validStatuses.includes(body.status as (typeof validStatuses)[number])) {
        return NextResponse.json({ ok: false, errors: ["Invalid check status."] }, { status: 400 });
      }
      const r = await updateCheck({
        projectId,
        checklistId: body.checklistId,
        operatorId: auth.userId,
        checkId: body.checkId,
        status: body.status as (typeof validStatuses)[number],
        evidence: body.evidence,
      });
      return NextResponse.json(r, { status: r.ok ? 200 : 404 });
    }

    return NextResponse.json({ ok: false, errors: ["Unknown action."] }, { status: 400 });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["QA action failed safely."] }, { status: 500 });
  }
}