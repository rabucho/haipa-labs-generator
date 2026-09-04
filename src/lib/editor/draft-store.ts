import "server-only";

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { HomeContent } from "@/types/content";

/**
 * Internal operator draft/published persistence (Slice 4).
 *
 * PERSISTENCE MECHANISM (documented, dev-only): plain JSON files under
 * `.data/editor/<siteKey>/` — OUTSIDE Git (.gitignore) and NOT production
 * multi-tenant storage. The DraftRepository interface exists so a later
 * slice can swap in a tenant-scoped database implementation without
 * touching callers. `siteKey` is carried through every method for that
 * future; today there is exactly one site ("home") and NO tenant isolation.
 */

export const EDITOR_SITE_KEY = "home";

export type DraftSnapshot = {
  content: HomeContent;
  savedAt: string;
  hash: string;
};

export type PublishedSnapshot = {
  content: HomeContent;
  publishedAt: string;
  hash: string;
};

/** Deterministic short content hash (SHA-256 of the canonical JSON). */
export function hashContent(content: HomeContent): string {
  return createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex")
    .slice(0, 16);
}

export interface DraftRepository {
  loadDraft(siteKey: string): Promise<DraftSnapshot | null>;
  saveDraft(siteKey: string, content: HomeContent): Promise<DraftSnapshot>;
  loadPublished(siteKey: string): Promise<PublishedSnapshot | null>;
  /** Publishes validated content; preserves the previous snapshot for rollback. */
  publishDraft(
    siteKey: string,
    content: HomeContent
  ): Promise<PublishedSnapshot>;
  /** Non-destructive check: is a previous published snapshot available? */
  hasRollbackSnapshot(siteKey: string): Promise<boolean>;
  /** Restores the previous published snapshot; null when none exists. */
  rollbackPublished(siteKey: string): Promise<PublishedSnapshot | null>;
}

/**
 * JSON-file repository. Base directory via EDITOR_DATA_DIR (tests point this
 * at a temp dir); default `.data` (gitignored, development-only).
 */
export class JsonFileDraftRepository implements DraftRepository {
  private baseDir(): string {
    return process.env.EDITOR_DATA_DIR ?? ".data";
  }

  private siteDir(siteKey: string): string {
    return path.join(this.baseDir(), "editor", siteKey);
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(file, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf-8");
  }

  async loadDraft(siteKey: string): Promise<DraftSnapshot | null> {
    return this.readJson<DraftSnapshot>(
      path.join(this.siteDir(siteKey), "draft.json")
    );
  }

  async saveDraft(
    siteKey: string,
    content: HomeContent
  ): Promise<DraftSnapshot> {
    const snapshot: DraftSnapshot = {
      content,
      savedAt: new Date().toISOString(),
      hash: hashContent(content),
    };
    await this.writeJson(
      path.join(this.siteDir(siteKey), "draft.json"),
      snapshot
    );
    return snapshot;
  }

  async loadPublished(siteKey: string): Promise<PublishedSnapshot | null> {
    return this.readJson<PublishedSnapshot>(
      path.join(this.siteDir(siteKey), "published.json")
    );
  }

  async publishDraft(
    siteKey: string,
    content: HomeContent
  ): Promise<PublishedSnapshot> {
    const dir = this.siteDir(siteKey);
    const current = await this.loadPublished(siteKey);
    if (current) {
      // Preserve the previous approved snapshot for rollback.
      await this.writeJson(path.join(dir, "published-previous.json"), current);
    }
    const snapshot: PublishedSnapshot = {
      content,
      publishedAt: new Date().toISOString(),
      hash: hashContent(content),
    };
    await this.writeJson(path.join(dir, "published.json"), snapshot);
    return snapshot;
  }

  async hasRollbackSnapshot(siteKey: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.siteDir(siteKey), "published-previous.json"));
      return true;
    } catch {
      return false;
    }
  }

  async rollbackPublished(siteKey: string): Promise<PublishedSnapshot | null> {
    const dir = this.siteDir(siteKey);
    const previous = await this.readJson<PublishedSnapshot>(
      path.join(dir, "published-previous.json")
    );
    if (!previous) return null;

    const restored: PublishedSnapshot = {
      content: previous.content,
      publishedAt: new Date().toISOString(),
      hash: hashContent(previous.content),
    };
    await this.writeJson(path.join(dir, "published.json"), restored);
    await fs.rm(path.join(dir, "published-previous.json"), { force: true });
    return restored;
  }
}

export const editorRepository: DraftRepository = new JsonFileDraftRepository();
