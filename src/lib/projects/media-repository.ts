import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { isValidProjectId } from "./project-repository";

/**
 * Project-scoped brand-media metadata repository (Slice 6) — server-only.
 *
 * PERSISTENCE (dev-only): `.data/projects/<projectId>/media.json` (gitignored).
 * This slice stores MEDIA METADATA and safe references only — there is no
 * object storage and the server never fetches remote URLs or parses uploaded
 * documents. Files belong to exactly one project; every method validates the
 * project id first so media can never leak between projects.
 */

/** Only https URLs are accepted as remote references. */
export const SafeHttpsUrlSchema = z
  .string()
  .url("Must be a valid URL")
  .refine((value) => value.startsWith("https://"), {
    message: "Only https:// URLs are accepted for remote references",
  })
  .refine((value) => !/[\s"'<>\\]/.test(value), {
    message: "URL contains unsafe characters",
  });

/**
 * A local file reference must be an explicit relative path inside the
 * operator-managed media directory — no absolute paths, no traversal.
 */
export const SafeLocalPathSchema = z
  .string()
  .refine((value) => !value.includes("..") && !path.isAbsolute(value), {
    message: "Local media references must be relative paths without traversal",
  })
  .refine((value) => /^[\w\-. /]+$/.test(value), {
    message: "Local media references may only contain letters, numbers, dots, dashes, slashes, and spaces",
  });

export const BrandMediaInputSchema = z
  .object({
    kind: z.enum(["logo", "photo", "document", "reference"]),
    name: z.string().min(1, "Name is required").max(160),
    sourceUrl: SafeHttpsUrlSchema.optional(),
    localPath: SafeLocalPathSchema.optional(),
    altText: z.string().max(300).optional(),
    mimeType: z.string().max(120).optional(),
  })
  .refine((value) => Boolean(value.sourceUrl ?? value.localPath), {
    message: "Provide either an https source URL or a local reference path",
    path: ["sourceUrl"],
  });

export type BrandMediaInput = z.infer<typeof BrandMediaInputSchema>;

export type BrandMediaRecord = BrandMediaInput & {
  id: string;
  projectId: string;
  approved: boolean;
  createdAt: string;
};

export interface MediaRepository {
  listMedia(projectId: string): Promise<BrandMediaRecord[]>;
  addMedia(projectId: string, input: BrandMediaInput): Promise<BrandMediaRecord>;
  removeMedia(projectId: string, mediaId: string): Promise<boolean>;
  setApproved(
    projectId: string,
    mediaId: string,
    approved: boolean
  ): Promise<BrandMediaRecord | null>;
}

export class JsonFileMediaRepository implements MediaRepository {
  private mediaFile(projectId: string): string {
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project id: ${projectId}`);
    }
    return path.join(
      process.env.PROJECTS_DATA_DIR ?? ".data",
      "projects",
      projectId,
      "media.json"
    );
  }

  private async readAll(projectId: string): Promise<BrandMediaRecord[]> {
    try {
      const raw = await fs.readFile(this.mediaFile(projectId), "utf-8");
      const parsed = z.array(BrandMediaRecordSchema).safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  private async writeAll(
    projectId: string,
    media: BrandMediaRecord[]
  ): Promise<void> {
    const file = this.mediaFile(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(media, null, 2), "utf-8");
  }

  async listMedia(projectId: string): Promise<BrandMediaRecord[]> {
    return this.readAll(projectId);
  }

  async addMedia(
    projectId: string,
    input: BrandMediaInput
  ): Promise<BrandMediaRecord> {
    const parsed = BrandMediaInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `Media failed validation: ${parsed.error.errors
          .map((e) => `Path [${e.path.join(".")}]: ${e.message}`)
          .join("; ")}`
      );
    }
    const existing = await this.readAll(projectId);
    const record: BrandMediaRecord = {
      ...parsed.data,
      id: `media_${existing.length + 1}_${Date.now()}`,
      projectId,
      approved: false,
      createdAt: new Date().toISOString(),
    };
    await this.writeAll(projectId, [...existing, record]);
    return record;
  }

  async removeMedia(projectId: string, mediaId: string): Promise<boolean> {
    const existing = await this.readAll(projectId);
    const next = existing.filter((m) => m.id !== mediaId);
    if (next.length === existing.length) return false;
    await this.writeAll(projectId, next);
    return true;
  }

  async setApproved(
    projectId: string,
    mediaId: string,
    approved: boolean
  ): Promise<BrandMediaRecord | null> {
    const existing = await this.readAll(projectId);
    const target = existing.find((m) => m.id === mediaId);
    if (!target) return null;
    const next = existing.map((m) =>
      m.id === mediaId ? { ...m, approved } : m
    );
    await this.writeAll(projectId, next);
    return next.find((m) => m.id === mediaId) ?? null;
  }
}

import { randomUUID } from "crypto";

/** Persisted-record guard (id/projectId/timestamps are server-generated). */
export const BrandMediaRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(["logo", "photo", "document", "reference"]),
  name: z.string().min(1).max(160),
  sourceUrl: z.string().optional(),
  localPath: z.string().optional(),
  altText: z.string().max(300).optional(),
  mimeType: z.string().max(120).optional(),
  approved: z.boolean(),
  createdAt: z.string(),
});

export const mediaRepository: MediaRepository = new JsonFileMediaRepository();

/** Kept for future collision-free ids if Date.now() granularity is a concern. */
export const newMediaId = () => `media_${randomUUID()}`;
