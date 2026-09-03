import "server-only";

import { promises as fs } from "fs";
import path from "path";

/**
 * Template family records (Slice 16, Stage E).
 *
 * Same persistence system as the version store (.data/templates/). Family
 * records carry display metadata and the family-level default version —
 * they never duplicate version data. A family cannot be deleted while any
 * of its versions exist (delete API intentionally not exposed).
 */

const FAMILIES_FILE = process.env.TEMPLATES_DATA_DIR
  ? path.join(process.env.TEMPLATES_DATA_DIR, "families.json")
  : path.join(process.cwd(), ".data", "templates", "families.json");

export type TemplateFamilyRecord = {
  familyKey: string;
  displayName: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  defaultVersionId?: string;
  versionIds: string[];
};

function isValidFamilyKey(key: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(key);
}

async function readFamilies(): Promise<TemplateFamilyRecord[]> {
  try {
    const raw = await fs.readFile(FAMILIES_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is TemplateFamilyRecord =>
        typeof f.familyKey === "string" && Array.isArray(f.versionIds)
    );
  } catch {
    return [];
  }
}

async function writeFamilies(families: TemplateFamilyRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(FAMILIES_FILE), { recursive: true });
  await fs.writeFile(FAMILIES_FILE, JSON.stringify(families, null, 2), "utf-8");
}

export interface TemplateFamilyStore {
  list(): Promise<TemplateFamilyRecord[]>;
  get(familyKey: string): Promise<TemplateFamilyRecord | null>;
  /** Register or update display metadata; appends the version id. Idempotent. */
  register(input: {
    familyKey: string;
    displayName: string;
    description?: string;
    createdBy: string;
    versionId: string;
  }): Promise<TemplateFamilyRecord>;
  /** Family-level default: published versions only, checked by the caller. */
  setDefaultVersion(familyKey: string, versionId: string): Promise<boolean>;
}

class LocalTemplateFamilyStore implements TemplateFamilyStore {
  async list() {
    return readFamilies();
  }

  async get(familyKey: string) {
    if (!isValidFamilyKey(familyKey)) return null;
    return (await readFamilies()).find((f) => f.familyKey === familyKey) ?? null;
  }

  async register(input: {
    familyKey: string;
    displayName: string;
    description?: string;
    createdBy: string;
    versionId: string;
  }) {
    if (!isValidFamilyKey(input.familyKey)) {
      throw new Error("Invalid family key.");
    }
    const families = await readFamilies();
    const now = new Date().toISOString();
    const existingIdx = families.findIndex((f) => f.familyKey === input.familyKey);
    if (existingIdx >= 0) {
      const existing = families[existingIdx];
      const updated: TemplateFamilyRecord = {
        ...existing,
        displayName: input.displayName || existing.displayName,
        ...(input.description ? { description: input.description } : {}),
        updatedAt: now,
        versionIds: existing.versionIds.includes(input.versionId)
          ? existing.versionIds
          : [...existing.versionIds, input.versionId],
      };
      families[existingIdx] = updated;
      await writeFamilies(families);
      return updated;
    }
    const created: TemplateFamilyRecord = {
      familyKey: input.familyKey,
      displayName: input.displayName,
      ...(input.description ? { description: input.description } : {}),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      versionIds: [input.versionId],
    };
    families.push(created);
    await writeFamilies(families);
    return created;
  }

  async setDefaultVersion(familyKey: string, versionId: string) {
    const families = await readFamilies();
    const idx = families.findIndex((f) => f.familyKey === familyKey);
    if (idx === -1) return false;
    if (!families[idx].versionIds.includes(versionId)) return false;
    families[idx] = {
      ...families[idx],
      defaultVersionId: versionId,
      updatedAt: new Date().toISOString(),
    };
    await writeFamilies(families);
    return true;
  }
}

export const templateFamilyStore: TemplateFamilyStore = new LocalTemplateFamilyStore();
