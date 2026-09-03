import "server-only";

import { getDbPool } from "./client";
import {
  ProjectSchema,
  type CreateProjectInput,
  type ProjectPatch,
  type WebsiteProject,
} from "@/types/project";
import {
  BrandBriefSchema,
  type ValidatedBrandBrief,
} from "@/lib/projects/brief-repository";
import type { BrandMediaRecord } from "@/lib/projects/media-repository";
import type { GeneratedContentDraft } from "@/types/project";
import type { GenerationAudit } from "@/lib/generation/audit";
import { slugifyName } from "@/lib/projects/project-repository";
import { randomUUID } from "crypto";

/**
 * Database-backed repositories (Slice 9).
 *
 * ISOLATION RULE: every repository is constructed with an authenticated
 * ownerId. Every query that touches project data joins projects(owner_id) so
 * a request can never read or modify another operator's project â€” even with
 * a valid foreign id. Raw credentials and raw AI responses are never stored;
 * only the existing redacted JSON shapes are persisted (validated with the
 * same Zod schemas the local repositories use).
 */

export class DbProjectRepository {
  constructor(private readonly ownerId: string) {}

  async createProject(input: CreateProjectInput): Promise<WebsiteProject> {
    const id = `proj_${randomUUID()}`;
    const now = new Date().toISOString();

    const existing = await this.listProjects();
    const baseSlug = slugifyName(input.name);
    let slug = baseSlug;
    let counter = 2;
    while (existing.some((p) => p.slug === slug)) {
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }

    const project: WebsiteProject = {
      id,
      name: input.name,
      slug,
      prospectName: input.prospectName,
      industry: input.industry,
      ...(input.location ? { location: input.location } : {}),
      status: "brief",
      templateId: input.templateId,
      createdAt: now,
      updatedAt: now,
    };
    const parsed = ProjectSchema.parse(project);

    await getDbPool().query(
      `INSERT INTO projects (id, owner_id, name, slug, prospect_name, industry, location, status, template_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        parsed.id, this.ownerId, parsed.name, parsed.slug, parsed.prospectName,
        parsed.industry, parsed.location ?? null, parsed.status,
        parsed.templateId, parsed.createdAt, parsed.updatedAt,
      ]
    );
    return project;
  }

  async listProjects(): Promise<WebsiteProject[]> {
    const result = await getDbPool().query(
      `SELECT id, name, slug, prospect_name, industry, location, status, template_id,
              current_draft_id, approved_design_version, wordpress_connection, created_at, updated_at
       FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC`,
      [this.ownerId]
    );
    return result.rows.map(rowToProject).filter(
      (p): p is WebsiteProject => ProjectSchema.safeParse(p).success
    );
  }

  async loadProject(projectId: string): Promise<WebsiteProject | null> {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return null;
    const result = await getDbPool().query(
      `SELECT id, name, slug, prospect_name, industry, location, status, template_id,
              current_draft_id, approved_design_version, wordpress_connection, created_at, updated_at
       FROM projects WHERE id = $1 AND owner_id = $2`,
      [projectId, this.ownerId]
    );
    if (result.rows.length === 0) return null; // not found OR not owned â€” same response
    const project = rowToProject(result.rows[0]);
    return ProjectSchema.safeParse(project).success ? project : null;
  }

  async updateProject(
    projectId: string,
    patch: ProjectPatch
  ): Promise<WebsiteProject | null> {
    const current = await this.loadProject(projectId);
    if (!current) return null;
    const updated: WebsiteProject = {
      ...current,
      ...patch,
      id: current.id,
      slug: current.slug,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const parsed = ProjectSchema.parse(updated);
    await getDbPool().query(
      `UPDATE projects SET name=$2, industry=$3, location=$4, status=$5,
              current_draft_id=$6, approved_design_version=$7,
              wordpress_connection=$8, updated_at=$9
       WHERE id=$1 AND owner_id=$10`,
      [
        projectId, parsed.name, parsed.industry, parsed.location ?? null,
        parsed.status, parsed.currentDraftId ?? null,
        parsed.approvedDesignVersion ?? null,
        parsed.wordpressConnection ? JSON.stringify(parsed.wordpressConnection) : null,
        parsed.updatedAt, this.ownerId,
      ]
    );
    return parsed as WebsiteProject;
  }
}

export class DbBriefRepository {
  constructor(private readonly ownerId: string) {}

  async loadBrief(projectId: string): Promise<ValidatedBrandBrief | null> {
    if (!(await ownedProjectExists(projectId, this.ownerId))) return null;
    const result = await getDbPool().query(
      `SELECT b.data FROM project_briefs b
       JOIN projects p ON p.id = b.project_id
       WHERE b.project_id = $1 AND p.owner_id = $2`,
      [projectId, this.ownerId]
    );
    if (result.rows.length === 0) return null;
    const parsed = BrandBriefSchema.safeParse(result.rows[0].data);
    return parsed.success ? parsed.data : null;
  }

  async saveBrief(
    projectId: string,
    brief: ValidatedBrandBrief
  ): Promise<ValidatedBrandBrief> {
    const parsed = BrandBriefSchema.parse(brief);
    if (!(await ownedProjectExists(projectId, this.ownerId))) {
      throw new Error("Project not found for this operator.");
    }
    await getDbPool().query(
      `INSERT INTO project_briefs (project_id, data, updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT (project_id) DO UPDATE SET data=$2, updated_at=now()`,
      [projectId, JSON.stringify(parsed)]
    );
    return parsed;
  }
}

export class DbMediaRepository {
  constructor(private readonly ownerId: string) {}

  async listMedia(projectId: string): Promise<BrandMediaRecord[]> {
    if (!(await ownedProjectExists(projectId, this.ownerId))) return [];
    const result = await getDbPool().query(
      `SELECT m.data FROM project_media m
       JOIN projects p ON p.id = m.project_id
       WHERE m.project_id = $1 AND p.owner_id = $2
       ORDER BY m.created_at ASC`,
      [projectId, this.ownerId]
    );
    return result.rows.map((r) => r.data as BrandMediaRecord);
  }

  async addMedia(
    projectId: string,
    record: BrandMediaRecord
  ): Promise<BrandMediaRecord> {
    if (!(await ownedProjectExists(projectId, this.ownerId))) {
      throw new Error("Project not found for this operator.");
    }
    await getDbPool().query(
      `INSERT INTO project_media (id, project_id, data) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET data=$3`,
      [record.id, projectId, JSON.stringify(record)]
    );
    return record;
  }

  async removeMedia(projectId: string, mediaId: string): Promise<boolean> {
    const result = await getDbPool().query(
      `DELETE FROM project_media m USING projects p
       WHERE m.project_id = p.id AND m.id = $1 AND m.project_id = $2 AND p.owner_id = $3`,
      [mediaId, projectId, this.ownerId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async setApproved(
    projectId: string,
    mediaId: string,
    approved: boolean
  ): Promise<BrandMediaRecord | null> {
    const existing = await this.listMedia(projectId);
    const target = existing.find((m) => m.id === mediaId);
    if (!target) return null;
    const updated = { ...target, approved };
    await getDbPool().query(
      `UPDATE project_media m SET data=$1 FROM projects p
       WHERE m.id=$2 AND m.project_id=$3 AND p.owner_id=$4`,
      [JSON.stringify(updated), mediaId, projectId, this.ownerId]
    );
    return updated;
  }
}

function rowToProject(row: Record<string, unknown>): WebsiteProject {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    prospectName: String(row.prospect_name),
    industry: String(row.industry),
    ...(row.location ? { location: String(row.location) } : {}),
    status: String(row.status) as WebsiteProject["status"],
    templateId: String(row.template_id),
    ...(row.current_draft_id ? { currentDraftId: String(row.current_draft_id) } : {}),
    ...(row.approved_design_version
      ? { approvedDesignVersion: String(row.approved_design_version) }
      : {}),
    ...(row.wordpress_connection
      ? { wordpressConnection: row.wordpress_connection as WebsiteProject["wordpressConnection"] }
      : {}),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export class DbDraftRepository {
  constructor(private readonly ownerId: string) {}

  async createDraft(draft: GeneratedContentDraft): Promise<GeneratedContentDraft> {
    if (!(await ownedProjectExists(draft.projectId, this.ownerId))) {
      throw new Error("Project not found for this operator.");
    }
    await getDbPool().query(
      `INSERT INTO project_drafts (id, project_id, data) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET data=$3`,
      [draft.id, draft.projectId, JSON.stringify(draft)]
    );
    return draft;
  }

  async listDrafts(projectId: string): Promise<GeneratedContentDraft[]> {
    if (!(await ownedProjectExists(projectId, this.ownerId))) return [];
    const result = await getDbPool().query(
      `SELECT d.data FROM project_drafts d
       JOIN projects p ON p.id = d.project_id
       WHERE d.project_id = $1 AND p.owner_id = $2
       ORDER BY d.created_at ASC`,
      [projectId, this.ownerId]
    );
    return result.rows
      .map((r) => r.data as GeneratedContentDraft)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadDraft(
    projectId: string,
    draftId: string
  ): Promise<GeneratedContentDraft | null> {
    if (!/^[a-zA-Z0-9_-]+$/.test(draftId)) return null;
    const result = await getDbPool().query(
      `SELECT d.data FROM project_drafts d
       JOIN projects p ON p.id = d.project_id
       WHERE d.id = $1 AND d.project_id = $2 AND p.owner_id = $3`,
      [draftId, projectId, this.ownerId]
    );
    return result.rows.length > 0
      ? (result.rows[0].data as GeneratedContentDraft)
      : null;
  }

  async setApproved(
    projectId: string,
    draftId: string,
    approved: boolean
  ): Promise<GeneratedContentDraft | null> {
    const current = await this.loadDraft(projectId, draftId);
    if (!current) return null;
    const updated = { ...current, approved, updatedAt: new Date().toISOString() };
    await getDbPool().query(
      `UPDATE project_drafts d SET data=$1 FROM projects p
       WHERE d.id=$2 AND d.project_id=$3 AND p.owner_id=$4`,
      [JSON.stringify(updated), draftId, projectId, this.ownerId]
    );
    return updated;
  }
}

export class DbAuditRepository {
  constructor(private readonly ownerId: string) {}

  async append(projectId: string, event: GenerationAudit): Promise<void> {
    if (!(await ownedProjectExists(projectId, this.ownerId))) {
      throw new Error("Project not found for this operator.");
    }
    await getDbPool().query(
      `INSERT INTO project_audit_events (id, project_id, data) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, projectId, JSON.stringify(event)]
    );
  }

  async list(projectId: string): Promise<GenerationAudit[]> {
    if (!(await ownedProjectExists(projectId, this.ownerId))) return [];
    const result = await getDbPool().query(
      `SELECT a.data FROM project_audit_events a
       JOIN projects p ON p.id = a.project_id
       WHERE a.project_id = $1 AND p.owner_id = $2
       ORDER BY a.created_at ASC`,
      [projectId, this.ownerId]
    );
    return result.rows.map((r) => r.data as GenerationAudit);
  }
}

/**

/** Child records are only reachable through an owned project. */
async function ownedProjectExists(
  projectId: string,
  ownerId: string
): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return false;
  const result = await getDbPool().query(
    "SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2",
    [projectId, ownerId]
  );
  return result.rows.length > 0;
}
