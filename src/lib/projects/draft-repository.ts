import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { HomeContentSchema, type HomeContent } from "@/types/content";
import type { GeneratedContentDraft } from "@/types/project";
import { isValidProjectId } from "./project-repository";

/**
 * Project-scoped draft repository (Slice A) — server-only.
 *
 * PERSISTENCE (documented, dev-only): one JSON file per draft under
 * `.data/projects/<projectId>/drafts/<draftId>.json` (gitignored). This is
 * NOT production-ready multi-tenant storage; the repository interface exists
 * so it can later become database-backed and tenant-scoped without touching
 * callers. Draft content is always validated against HomeContentSchema
 * before persistence — invalid drafts are rejected, never stored.
 */

export type DraftSource = GeneratedContentDraft["source"];

export interface ProjectDraftRepository {
  createDraft(input: {
    projectId: string;
    templateId: string;
    content: HomeContent;
    source: DraftSource;
    aiPromptVersion?: string;
  }): Promise<GeneratedContentDraft>;
  listDrafts(projectId: string): Promise<GeneratedContentDraft[]>;
  loadDraft(
    projectId: string,
    draftId: string
  ): Promise<GeneratedContentDraft | null>;
  setApproved(
    projectId: string,
    draftId: string,
    approved: boolean
  ): Promise<GeneratedContentDraft | null>;
}

export class JsonFileProjectDraftRepository implements ProjectDraftRepository {
  private draftsDir(projectId: string): string {
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project id: ${projectId}`);
    }
    return path.join(
      process.env.PROJECTS_DATA_DIR ?? ".data",
      "projects",
      projectId,
      "drafts"
    );
  }

  private draftFile(projectId: string, draftId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(draftId)) {
      throw new Error(`Invalid draft id: ${draftId}`);
    }
    return path.join(this.draftsDir(projectId), `${draftId}.json`);
  }

  async createDraft(input: {
    projectId: string;
    templateId: string;
    content: HomeContent;
    source: DraftSource;
    aiPromptVersion?: string;
  }): Promise<GeneratedContentDraft> {
    // Strict gate: never persist content that fails the approved schema.
    const parsed = HomeContentSchema.safeParse(input.content);
    if (!parsed.success) {
      throw new Error(
        `Draft content failed HomeContentSchema validation: ${parsed.error.errors
          .map((e) => `Path [${e.path.join(".")}]: ${e.message}`)
          .join("; ")}`
      );
    }

    const now = new Date().toISOString();
    const draft: GeneratedContentDraft = {
      id: `draft_${randomUUID()}`,
      projectId: input.projectId,
      templateId: input.templateId,
      content: parsed.data,
      source: input.source,
      ...(input.aiPromptVersion
        ? { aiPromptVersion: input.aiPromptVersion }
        : {}),
      approved: false,
      createdAt: now,
      updatedAt: now,
    };

    const file = this.draftFile(input.projectId, draft.id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(draft, null, 2), "utf-8");
    return draft;
  }

  async listDrafts(projectId: string): Promise<GeneratedContentDraft[]> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.draftsDir(projectId));
    } catch {
      return [];
    }
    const drafts: GeneratedContentDraft[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const draft = await this.loadDraft(
        projectId,
        entry.replace(/\.json$/, "")
      );
      if (draft) drafts.push(draft);
    }
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadDraft(
    projectId: string,
    draftId: string
  ): Promise<GeneratedContentDraft | null> {
    try {
      const raw = await fs.readFile(
        this.draftFile(projectId, draftId),
        "utf-8"
      );
      const body = JSON.parse(raw) as { content?: unknown };
      const parsed = HomeContentSchema.safeParse(body.content);
      if (!parsed.success) return null;
      return { ...(body as GeneratedContentDraft), content: parsed.data };
    } catch {
      return null;
    }
  }

  async setApproved(
    projectId: string,
    draftId: string,
    approved: boolean
  ): Promise<GeneratedContentDraft | null> {
    const current = await this.loadDraft(projectId, draftId);
    if (!current) return null;
    const updated: GeneratedContentDraft = {
      ...current,
      approved,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      this.draftFile(projectId, draftId),
      JSON.stringify(updated, null, 2),
      "utf-8"
    );
    return updated;
  }
}

export const projectDraftRepository: ProjectDraftRepository =
  new JsonFileProjectDraftRepository();
