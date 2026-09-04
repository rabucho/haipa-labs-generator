import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedOperator, authErrorResponse } from "@/lib/auth/guards";
import {
  requestTemplateProposal,
  listProposals,
  acceptProposal,
  rejectProposal,
  ProposalRequestSchema,
} from "@/lib/templates/proposals";

/**
 * Slice 16 Stages B–D: AI template proposals.
 *
 * GET  /api/templates/proposals — list proposals (redacted metadata).
 * POST /api/templates/proposals — request a proposal (explicit provider/model).
 * POST /api/templates/proposals?accept=<id> — accept: creates a NEW draft
 *        version. Never publishes; existing projects stay pinned.
 * POST /api/templates/proposals?reject=<id> — reject: no catalog side effect.
 */
export async function GET() {
  try {
    await requireAuthenticatedOperator();
    const proposals = await listProposals();
    return NextResponse.json({
      ok: true,
      proposals: proposals.map((p) => ({
        proposalId: p.proposalId,
        familyKey: p.familyKey,
        displayName: p.displayName,
        status: p.status,
        providerId: p.providerId,
        modelId: p.modelId,
        promptVersion: p.promptVersion,
        inputHash: p.inputHash,
        outputHash: p.outputHash,
        createdAt: p.createdAt,
        diff: p.diff,
      })),
    });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Could not list proposals."] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthenticatedOperator();
    const acceptId = req.nextUrl.searchParams.get("accept");
    const rejectId = req.nextUrl.searchParams.get("reject");

    if (acceptId) {
      const r = await acceptProposal(acceptId, auth.userId);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (rejectId) {
      const r = await rejectProposal(rejectId);
      return NextResponse.json(r, { status: r.ok ? 200 : 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, errors: ["Invalid JSON body."] }, { status: 400 });
    }
    const parsed = ProposalRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const result = await requestTemplateProposal(parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, errors: result.errors, errorCode: result.errorCode },
        { status: result.errorCode === "invalid-request" ? 400 : 409 }
      );
    }
    const { proposal } = result;
    return NextResponse.json({
      ok: true,
      proposal: {
        proposalId: proposal.proposalId,
        status: proposal.status,
        providerId: proposal.providerId,
        modelId: proposal.modelId,
        promptVersion: proposal.promptVersion,
        inputHash: proposal.inputHash,
        outputHash: proposal.outputHash,
        diff: proposal.diff,
        rationale: proposal.rationale,
      },
    });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Proposal request failed safely."] }, { status: 500 });
  }
}
