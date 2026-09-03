import "server-only";

import { promises as fs } from "fs";
import path from "path";
import {
  SyncRecordSchema,
  type SyncRecord,
  type SyncOperationType,
  type SyncStatus,
} from "./types";

/**
 * Project-scoped WordPress sync history (Slice 10).
 *
 * Local JSON implementation under .data/projects/<projectId>/sync-history.json
 * (gitignored). Records are append-only: a failed or unsupported operation is
 * never deleted or overwritten. Interface mirrors the other repositories so a
 * database implementation can replace it later.
 *
 * The projectId is validated before any path is derived (no traversal).
 */

const DATA_ROOT = path.join(process.cwd(), ".data", "projects");

function isValidProjectId(projectId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(projectId);
}

function historyPath(projectId: string): string {
  return path.join(DATA_ROOT, projectId, "sync-history.json");
}

async function readHistory(projectId: string): Promise<SyncRecord[]> {
  if (!isValidProjectId(projectId)) return [];
  try {
    const raw = await fs.readFile(historyPath(projectId), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => SyncRecordSchema.safeParse(r))
      .filter((r) => r.success)
      .map((r) => r.data as SyncRecord);
  } catch {
    return [];
  }
}

export interface SyncHistoryRepository {
  append(projectId: string, record: SyncRecord): Promise<void>;
  list(projectId: string): Promise<SyncRecord[]>;
  latest(projectId: string, operation?: SyncOperationType): Promise<SyncRecord | null>;
}

class LocalSyncHistoryRepository implements SyncHistoryRepository {
  async append(projectId: string, record: SyncRecord): Promise<void> {
    if (!isValidProjectId(projectId)) {
      throw new Error("Invalid project id.");
    }
    const parsed = SyncRecordSchema.parse(record);
    const history = await readHistory(projectId);
    history.push(parsed);
    const file = historyPath(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(history, null, 2), "utf-8");
  }

  async list(projectId: string): Promise<SyncRecord[]> {
    return readHistory(projectId);
  }

  async latest(
    projectId: string,
    operation?: SyncOperationType
  ): Promise<SyncRecord | null> {
    const history = await readHistory(projectId);
    const filtered = operation
      ? history.filter((r) => r.operation === operation)
      : history;
    return filtered.length > 0 ? filtered[filtered.length - 1] : null;
  }
}

export const syncHistoryRepository: SyncHistoryRepository =
  new LocalSyncHistoryRepository();

/** Convenience factory for a complete record. */
export function makeSyncRecord(input: {
  projectId: string;
  actorId: string;
  operation: SyncOperationType;
  draftId?: string | null;
  contentHash?: string | null;
  templateKey?: string | null;
  templateVersion?: string | null;
  schemaVersion?: number | null;
  mappingVersion?: string | null;
  targetIdentifier?: string | null;
  startedAt: string;
  status: SyncStatus;
  errorCode?: string | null;
  readBackVerified?: boolean;
}): SyncRecord {
  return {
    id: `sync_${crypto.randomUUID()}`,
    projectId: input.projectId,
    actorId: input.actorId,
    operation: input.operation,
    draftId: input.draftId ?? null,
    contentHash: input.contentHash ?? null,
    templateKey: input.templateKey ?? null,
    templateVersion: input.templateVersion ?? null,
    schemaVersion: input.schemaVersion ?? null,
    mappingVersion: input.mappingVersion ?? null,
    targetIdentifier: input.targetIdentifier ?? null,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    status: input.status,
    errorCode: input.errorCode ?? null,
    readBackVerified: input.readBackVerified ?? false,
  };
}