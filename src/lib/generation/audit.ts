import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { isValidProjectId } from "@/lib/projects/project-repository";

/**
 * Redacted generation audit records (Slice 7) — server-only.
 *
 * PERSISTENCE (dev-only): `.data/projects/<projectId>/audit.json`.
 * The audit record NEVER contains raw prompts, raw provider responses,
 * credentials, or private media. Redaction is enforced by the Zod schema
 * itself: only the fields below can be persisted.
 */

export const GenerationAuditSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  draftId: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  templateId: z.string(),
  templateVersion: z.string(),
  inputHash: z.string(),
  status: z.enum(["started", "succeeded", "failed", "rejected", "approved"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  durationMs: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  errorCode: z.string().optional(),
  operator: z.string().optional(),
});

export type GenerationAudit = z.infer<typeof GenerationAuditSchema>;

export interface GenerationAuditRepository {
  append(projectId: string, event: GenerationAudit): Promise<void>;
  list(projectId: string): Promise<GenerationAudit[]>;
}

export class JsonFileGenerationAuditRepository
  implements GenerationAuditRepository
{
  private auditFile(projectId: string): string {
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project id: ${projectId}`);
    }
    return path.join(
      process.env.PROJECTS_DATA_DIR ?? ".data",
      "projects",
      projectId,
      "audit.json"
    );
  }

  async append(projectId: string, event: GenerationAudit): Promise<void> {
    const parsed = GenerationAuditSchema.safeParse(event);
    if (!parsed.success) {
      throw new Error("Audit event failed redaction schema validation.");
    }
    const file = this.auditFile(projectId);
    let existing: GenerationAudit[] = [];
    try {
      existing = GenerationAuditSchema.array().parse(
        JSON.parse(await fs.readFile(file, "utf-8"))
      );
    } catch {
      existing = [];
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify([...existing, parsed.data], null, 2),
      "utf-8"
    );
  }

  async list(projectId: string): Promise<GenerationAudit[]> {
    try {
      return GenerationAuditSchema.array().parse(
        JSON.parse(await fs.readFile(this.auditFile(projectId), "utf-8"))
      );
    } catch {
      return [];
    }
  }
}

export const generationAuditRepository: GenerationAuditRepository =
  new JsonFileGenerationAuditRepository();

/**
 * Temporary internal operator identity. The tool currently has a single
 * trusted operator; this label is NOT secure multi-user authorization and
 * will be replaced by real identity in the database/auth slice.
 */
export const INTERNAL_OPERATOR = "local-operator";
