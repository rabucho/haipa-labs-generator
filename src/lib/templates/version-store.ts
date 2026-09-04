import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { BuilderDocumentSchema, type BuilderDocument, validateBuilderDocument, DEFAULT_BUILDER_DOCUMENT } from "@/types/builder";
import { templateFamilyStore } from "@/lib/templates/families";

/**
 * Immutable template-version store (Slice 15).
 *
 * Local JSON persistence under .data/templates/ (gitignored). Core invariants:
 *  - A published version is IMMUTABLE: saving requires draft status.
 *  - Editing a published version creates a NEW draft based on it.
 *  - Content hash changes whenever the document changes.
 *  - defaultVersionId affects NEW projects only; existing projects stay pinned
 *    to their assigned version (projects store their own templateId).
 *  - Publishing is a catalog action — never a WordPress write or deployment.
 */

// Resolved lazily at call time so test files can override TEMPLATES_DATA_DIR
// in beforeAll regardless of module import order (see Slice 18 isolation fix).
function dataDir(): string {
  return process.env.TEMPLATES_DATA_DIR
    ? path.join(process.env.TEMPLATES_DATA_DIR)
    : path.join(process.cwd(), ".data", "templates");
}
function versionsFile(): string {
  return path.join(dataDir(), "versions.json");
}
function metaFile(): string {
  return path.join(dataDir(), "meta.json");
}

export type TemplateVersionStatus = "draft" | "review" | "published" | "archived";

export type StoredTemplateVersion = {
  versionId: string;
  familyKey: string;
  version: string;
  status: TemplateVersionStatus;
  document: BuilderDocument;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  basedOnVersionId?: string;
  /** Slice 21: redacted import provenance (never contains secrets). */
  provenance?: {
    source: string;
    label?: string;
    importedBy: string;
    importedAt: string;
    contentHash: string;
  };
};

export function hashBuilderDocument(doc: BuilderDocument): string {
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex").slice(0, 16);
}

function isValidVersionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id);
}

export { isValidVersionId };

async function readAll(): Promise<StoredTemplateVersion[]> {
  try {
    const raw = await fs.readFile(versionsFile(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => {
        const doc = BuilderDocumentSchema.safeParse((v as { document?: unknown }).document);
        if (!doc.success) return null;
        return { ...(v as StoredTemplateVersion), document: doc.data };
      })
      .filter((v): v is StoredTemplateVersion => v !== null);
  } catch {
    return [];
  }
}

async function writeAll(versions: StoredTemplateVersion[]): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(versionsFile(), JSON.stringify(versions, null, 2), "utf-8");
}

async function readDefaultVersionId(): Promise<string | null> {
  try {
    const raw = await fs.readFile(metaFile(), "utf-8");
    const parsed = JSON.parse(raw) as { defaultVersionId?: string };
    return parsed.defaultVersionId ?? null;
  } catch {
    return null;
  }
}

class LocalTemplateVersionStore {
  async list() {
    return readAll();
  }

  async get(versionId: string) {
    if (!isValidVersionId(versionId)) return null;
    return (await readAll()).find((v) => v.versionId === versionId) ?? null;
  }

  async getDefaultVersionId() {
    return readDefaultVersionId();
  }

  async createFamilyDraft(input: {
    familyKey: string;
    displayName?: string;
    basedOnVersionId?: string;
    document?: BuilderDocument;
    createdBy: string;
  }) {
    const versions = await readAll();
    let document = input.document;
    if (!document) {
      const source = input.basedOnVersionId ? await this.get(input.basedOnVersionId) : null;
      document = source?.document ?? DEFAULT_BUILDER_DOCUMENT;
    }
    const familyCount = versions.filter((v) => v.familyKey === input.familyKey).length;
    const now = new Date().toISOString();
    const record: StoredTemplateVersion = {
      versionId: `tpl_${input.familyKey}_v${familyCount + 1}_${Date.now().toString(36)}`,
      familyKey: input.familyKey,
      version: `1.0.${familyCount}`,
      status: "draft",
      document,
      contentHash: hashBuilderDocument(document),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      ...(input.basedOnVersionId ? { basedOnVersionId: input.basedOnVersionId } : {}),
    };
    versions.push(record);
    await writeAll(versions);
    // Slice 16 Stage E: keep the family record in sync with every version.
    await templateFamilyStore.register({
      familyKey: input.familyKey,
      displayName: input.displayName ?? input.familyKey,
      createdBy: input.createdBy,
      versionId: record.versionId,
    });
    return record;
  }

  async saveDraftDocument(versionId: string, doc: BuilderDocument, _actorId: string) {
    if (!isValidVersionId(versionId)) {
      return { ok: false as const, errorCode: "not-found" as const, errors: ["Invalid version id."] };
    }
    const versions = await readAll();
    const idx = versions.findIndex((v) => v.versionId === versionId);
    if (idx === -1) {
      return { ok: false as const, errorCode: "not-found" as const, errors: ["Version not found."] };
    }
    const current = versions[idx];
    if (current.status !== "draft") {
      return {
        ok: false as const,
        errorCode: "immutable" as const,
        errors: [`Version ${current.version} is ${current.status} and immutable. Duplicate it as a new draft to make changes.`],
      };
    }
    const parsed = BuilderDocumentSchema.safeParse(doc);
    if (!parsed.success) {
      return {
        ok: false as const,
        errorCode: "invalid" as const,
        errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const issues = validateBuilderDocument(parsed.data);
    if (issues.some((i) => i.severity === "error")) {
      return {
        ok: false as const,
        errorCode: "invalid" as const,
        errors: issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`),
      };
    }
    const contentHash = hashBuilderDocument(parsed.data);
    if (contentHash === current.contentHash) {
      return { ok: false as const, errorCode: "hash-unchanged" as const, errors: ["No changes to save."] };
    }
    const updated: StoredTemplateVersion = {
      ...current,
      document: parsed.data,
      contentHash,
      updatedAt: new Date().toISOString(),
    };
    versions[idx] = updated;
    await writeAll(versions);
    return { ok: true as const, version: updated };
  }

  async setStatus(versionId: string, status: TemplateVersionStatus, _actorId: string) {
    const versions = await readAll();
    const idx = versions.findIndex((v) => v.versionId === versionId);
    if (idx === -1) {
      return { ok: false as const, errorCode: "not-found", errors: ["Version not found."] };
    }
    const updated: StoredTemplateVersion = {
      ...versions[idx],
      status,
      updatedAt: new Date().toISOString(),
    };
    versions[idx] = updated;
    await writeAll(versions);
    return { ok: true as const, version: updated };
  }

  async publish(versionId: string, _actorId: string) {
    const versions = await readAll();
    const idx = versions.findIndex((v) => v.versionId === versionId);
    if (idx === -1) {
      return { ok: false as const, errorCode: "not-found", errors: ["Version not found."] };
    }
    const current = versions[idx];
    if (current.status === "published") {
      return { ok: false as const, errorCode: "immutable", errors: ["Version is already published."] };
    }
    const issues = validateBuilderDocument(current.document);
    if (issues.some((i) => i.severity === "error")) {
      return {
        ok: false as const,
        errorCode: "validation-failed",
        errors: issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`),
      };
    }
    const updated: StoredTemplateVersion = {
      ...current,
      status: "published",
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    versions[idx] = updated;
    await writeAll(versions);
    return { ok: true as const, version: updated };
  }

  async setDefault(versionId: string) {
    const versions = await readAll();
    const target = versions.find((v) => v.versionId === versionId);
    if (!target || target.status !== "published") {
      return { ok: false as const, errors: ["Only published versions can become the default for new projects."] };
    }
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(metaFile(), JSON.stringify({ defaultVersionId: versionId }, null, 2), "utf-8");
    await templateFamilyStore.setDefaultVersion(target.familyKey, versionId);
    return { ok: true as const };
  }

  /**
   * Slice 21: imports a validated package as a NEW draft version.
   * The caller (import route) performs all validation; this method only
   * enforces the duplicate-version guard and records provenance.
   */
  async importDraft(input: {
    familyKey: string;
    displayName: string;
    version: string;
    document: BuilderDocument;
    actorId: string;
    provenance: { source: string; label?: string };
  }) {
    const versions = await readAll();
    const duplicate = versions.some(
      (v) => v.familyKey === input.familyKey && v.version === input.version
    );
    if (duplicate) {
      return {
        ok: false as const,
        errorCode: "duplicate" as const,
        errors: [
          `Version ${input.version} already exists for family "${input.familyKey}". Existing versions are never overwritten.`,
        ],
      };
    }
    const now = new Date().toISOString();
    const familyCount = versions.filter((v) => v.familyKey === input.familyKey).length;
    const record: StoredTemplateVersion = {
      versionId: `tpl_${input.familyKey}_v${familyCount + 1}_${Date.now().toString(36)}`,
      familyKey: input.familyKey,
      version: input.version,
      status: "draft",
      document: input.document,
      contentHash: hashBuilderDocument(input.document),
      createdBy: input.actorId,
      createdAt: now,
      updatedAt: now,
      provenance: {
        source: input.provenance.source,
        ...(input.provenance.label ? { label: input.provenance.label } : {}),
        importedBy: input.actorId,
        importedAt: now,
        contentHash: hashBuilderDocument(input.document),
      },
    };
    versions.push(record);
    await writeAll(versions);
    await templateFamilyStore.register({
      familyKey: input.familyKey,
      displayName: input.displayName,
      createdBy: input.actorId,
      versionId: record.versionId,
    });
    return { ok: true as const, version: record };
  }

  async duplicateAsDraft(versionId: string, actorId: string) {
    const source = await this.get(versionId);
    if (!source) {
      return { ok: false as const, errorCode: "not-found", errors: ["Version not found."] };
    }
    const created = await this.createFamilyDraft({
      familyKey: source.familyKey,
      basedOnVersionId: source.versionId,
      document: source.document,
      createdBy: actorId,
    });
    return { ok: true as const, version: created };
  }
}

export const templateVersionStore = new LocalTemplateVersionStore();
