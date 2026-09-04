import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
} from "@/lib/auth/guards";
import { isValidVersionId, templateVersionStore } from "@/lib/templates/version-store";
import { isValidProjectId, projectRepository } from "@/lib/projects/project-repository";

/**
 * GET /api/templates/<versionId>/usage  (Slice 21)
 *
 * Safe project-usage view for version decisions (archive/migration):
 * project id, display name, status, and pinned version ONLY. Never exposes
 * briefs, media, credentials, drafts, or WordPress connection details.
 */
type RouteParams = { params: Promise<{ versionId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireAuthenticatedOperator();
    const { versionId } = await params;
    if (!isValidVersionId(versionId)) {
      return NextResponse.json({ ok: false, errors: ["Invalid version id."] }, { status: 400 });
    }
    const version = await templateVersionStore.get(versionId);
    if (!version) {
      return NextResponse.json({ ok: false, errors: ["Version not found."] }, { status: 404 });
    }
    const projects = await projectRepository.listProjects();
    const usage = projects
      .filter((p) => p.templateVersionId === versionId)
      .map((p) => ({
        projectId: p.id,
        name: p.name,
        status: p.status,
        pinnedVersion: p.templateVersionId ?? null,
      }));
    return NextResponse.json({
      ok: true,
      versionId,
      projectCount: usage.length,
      projects: usage,
      archiveSafe: usage.length === 0,
    });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Usage lookup failed."] }, { status: 500 });
  }
}

// isValidProjectId re-validation helper is used by future project-scoped
// usage drill-downs; exported routes above validate ids via the store.
void isValidProjectId;
