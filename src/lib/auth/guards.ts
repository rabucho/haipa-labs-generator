import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getOperator, type AuthContext } from "./session";
import { isDatabaseBackend } from "@/db/client";
import {
  DbProjectRepository,
  DbBriefRepository,
  DbMediaRepository,
  DbDraftRepository,
  DbAuditRepository,
} from "@/db/repositories";
import {
  projectRepository as localProjectRepo,
  loadProjectOrNothing as localLoadProject,
} from "@/lib/projects/project-repository";
import { briefRepository as localBriefRepo } from "@/lib/projects/brief-repository";
import { mediaRepository as localMediaRepo } from "@/lib/projects/media-repository";
import { projectDraftRepository as localDraftRepo } from "@/lib/projects/draft-repository";
import { generationAuditRepository as localAuditRepo } from "@/lib/generation/audit";
import type { GeneratedContentDraft } from "@/types/project";
import type { GenerationAudit } from "@/lib/generation/audit";
import type { CreateProjectInput, WebsiteProject, ProjectPatch } from "@/types/project";
import type { ValidatedBrandBrief } from "@/lib/projects/brief-repository";
import type { BrandMediaRecord, BrandMediaInput } from "@/lib/projects/media-repository";
import type { HomeContent } from "@/types/content";

/**
 * Centralized authorization (Slice 9).
 *
 * requireAuthenticatedOperator() — API routes: throws AuthError(401) when
 *   unauthenticated. requireOperatorPage() — server pages: redirects /login.
 * requireProjectAccess(auth, projectId) — resolves the project ONLY if the
 *   operator owns it; otherwise { ok:false } (callers return 404 without
 *   revealing whether the project exists elsewhere).
 * requireDraftAccess(auth, projectId, draftId) — verifies the draft belongs
 *   to the authorized project; a foreign draft id never resolves.
 *
 * The scoped repository bundle never issues an unscoped project query: in
 * database mode every method filters by owner; in local mode the tool is
 * single-operator by design (documented limitation) and the local repos are
 * wrapped to keep the same interface.
 */

export class AuthError extends Error {
  constructor(public status: 401) {
    super("Authentication required.");
  }
}

/** Map an AuthError to a 401 JSON response; rethrow anything else. */
export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { ok: false, errors: ["Authentication required."] },
      { status: 401 }
    );
  }
  return null;
}

export async function requireAuthenticatedOperator(): Promise<AuthContext> {
  const auth = await getOperator();
  if (!auth) throw new AuthError(401);
  return auth;
}

/** Server-page variant: redirects to /login instead of throwing. */
export async function requireOperatorPage(): Promise<AuthContext> {
  const auth = await getOperator();
  if (!auth) redirect("/login");
  return auth;
}

export type ScopedRepositories = {
  projects: {
    createProject(input: CreateProjectInput): Promise<WebsiteProject>;
    listProjects(): Promise<WebsiteProject[]>;
    loadProject(projectId: string): Promise<WebsiteProject | null>;
    updateProject(projectId: string, patch: ProjectPatch): Promise<WebsiteProject | null>;
  };
  briefs: {
    loadBrief(projectId: string): Promise<ValidatedBrandBrief | null>;
    saveBrief(projectId: string, brief: ValidatedBrandBrief): Promise<ValidatedBrandBrief>;
  };
  media: {
    listMedia(projectId: string): Promise<BrandMediaRecord[]>;
    addMedia(projectId: string, input: BrandMediaInput): Promise<BrandMediaRecord>;
    removeMedia(projectId: string, mediaId: string): Promise<boolean>;
    setApproved(projectId: string, mediaId: string, approved: boolean): Promise<BrandMediaRecord | null>;
  };
  drafts: {
    createDraft(input: { projectId: string; templateId: string; content: HomeContent; source: GeneratedContentDraft["source"]; aiPromptVersion?: string }): Promise<GeneratedContentDraft>;
    listDrafts(projectId: string): Promise<GeneratedContentDraft[]>;
    loadDraft(projectId: string, draftId: string): Promise<GeneratedContentDraft | null>;
    setApproved(projectId: string, draftId: string, approved: boolean): Promise<GeneratedContentDraft | null>;
  };
  audit: {
    append(projectId: string, event: GenerationAudit): Promise<void>;
    list(projectId: string): Promise<GenerationAudit[]>;
  };
}

export function getScopedRepositories(auth: AuthContext): ScopedRepositories {
  if (isDatabaseBackend()) {
    return {
      projects: new DbProjectRepository(auth.userId),
      briefs: new DbBriefRepository(auth.userId),
      media: new DbMediaRepository(auth.userId),
      drafts: new DbDraftRepository(auth.userId),
      audit: new DbAuditRepository(auth.userId),
    };
  }
  // Local mode: single trusted operator (documented limitation). The auth
  // context is still required by callers so switching backends is seamless.
  return {
    projects: {
      createProject: (i) => localProjectRepo.createProject(i),
      listProjects: () => localProjectRepo.listProjects(),
      loadProject: (id) => localProjectRepo.loadProject(id),
      updateProject: (id, patch) => localProjectRepo.updateProject(id, patch),
    },
    briefs: {
      loadBrief: (id) => localBriefRepo.loadBrief(id),
      saveBrief: (id, b) => localBriefRepo.saveBrief(id, b),
    },
    media: {
      listMedia: (id) => localMediaRepo.listMedia(id),
      addMedia: (id, m) => localMediaRepo.addMedia(id, m),
      removeMedia: (id, mid) => localMediaRepo.removeMedia(id, mid),
      setApproved: (id, mid, a) => localMediaRepo.setApproved(id, mid, a),
    },
    drafts: {
      createDraft: (i) => localDraftRepo.createDraft(i),
      listDrafts: (id) => localDraftRepo.listDrafts(id),
      loadDraft: (id, did) => localDraftRepo.loadDraft(id, did),
      setApproved: (id, did, a) => localDraftRepo.setApproved(id, did, a),
    },
    audit: {
      append: (id, e) => localAuditRepo.append(id, e),
      list: (id) => localAuditRepo.list(id),
    },
  };
}

export type ProjectAccess =
  | { ok: true; project: WebsiteProject; repos: ScopedRepositories }
  | { ok: false; status: 404 };

/** Resolve + authorize a project. 404 without existence leakage. */
export async function requireProjectAccess(
  auth: AuthContext,
  projectId: string
): Promise<ProjectAccess> {
  const repos = getScopedRepositories(auth);
  const project = await repos.projects.loadProject(projectId);
  if (!project) return { ok: false, status: 404 };
  return { ok: true, project, repos };
}

export type DraftAccess =
  | { ok: true; draft: GeneratedContentDraft; project: WebsiteProject; repos: ScopedRepositories }
  | { ok: false; status: 404 };

/** Verify the draft belongs to the authorized project (never a foreign id). */
export async function requireDraftAccess(
  auth: AuthContext,
  projectId: string,
  draftId: string
): Promise<DraftAccess> {
  const access = await requireProjectAccess(auth, projectId);
  if (!access.ok) return { ok: false, status: 404 };
  const draft = await access.repos.drafts.loadDraft(projectId, draftId);
  if (!draft) return { ok: false, status: 404 };
  return { ok: true, draft, project: access.project, repos: access.repos };
}

/** Page-level helper: operator + project scope, else redirect/notFound. */
export async function requireOperatorProjectPage(projectId: string): Promise<{
  auth: AuthContext;
  project: WebsiteProject;
  repos: ScopedRepositories;
} | null> {
  const auth = await requireOperatorPage();
  const repos = getScopedRepositories(auth);
  const project = await repos.projects.loadProject(projectId);
  if (!project) return null; // page renders notFound()
  return { auth, project, repos };
}

// Re-export for pages that previously used the local convenience helper.
export { localLoadProject };
