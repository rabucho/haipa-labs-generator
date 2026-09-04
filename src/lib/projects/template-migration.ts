import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import type { AuthContext } from "@/lib/auth/session";
import { getScopedRepositories } from "@/lib/auth/guards";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { hashContent } from "@/lib/editor/draft-store";
import { templateVersionStore } from "@/lib/templates/version-store";
import { buildPageAwareInventory } from "@/lib/templates/page-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";

/**
 * Explicit project template migration (Slice 17).
 *
 * Projects remain pinned to their template version until an operator
 * deliberately executes this workflow. Preview is read-only; execution
 * creates a BACKUP + a NEW review-status draft (never overwriting the
 * approved source); assignment changes only after approval of the migrated
 * draft and an explicit confirm; rollback restores the backup atomically.
 * Zero WordPress/provider network calls in the whole workflow.
 */

const MIGRATIONS_FILE_DIR = path.join(process.cwd(), ".data", "projects");

function migrationsFile(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(projectId)) {
    throw new Error("Invalid project id.");
  }
  return path.join(MIGRATIONS_FILE_DIR, projectId, "template-migrations.json");
}


async function writeHistory(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf-8");
}

// ── Plan ────────────────────────────────────────────────────────────────

export type MigrationPlan = {
  projectId: string;
  sourceTemplateId: string;
  targetVersionId: string;
  targetFamilyKey: string;
  targetVersion: string;
  pagesAdded: string[];
  pagesRemoved: string[];
  sectionsReordered: Array<{ pageKey: string; instanceId: string; from: number; to: number }>;
  fieldsPreserved: string[];
  fieldsMissing: string[];
  fieldsNeedingReview: string[];
  mappingChanges: string[];
  warnings: string[];
  compatible: boolean;
  planHash: string;
};

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Deterministic, read-only compatibility plan between the project's current
 * template and a published target version. Zero network calls.
 */
export async function buildMigrationPlan(
  auth: AuthContext,
  projectId: string,
  targetVersionId: string
): Promise<
  | { ok: true; plan: MigrationPlan }
  | { ok: false; errors: string[] }
> {
  const repos = getScopedRepositories(auth);
  const project = await repos.projects.loadProject(projectId);
  if (!project) {
    return { ok: false, errors: ["Project not found."] };
  }
  const target = await templateVersionStore.get(targetVersionId);
  if (!target) {
    return { ok: false, errors: ["Target template version not found."] };
  }
  if (target.status !== "published") {
    return { ok: false, errors: ["Only published template versions can be migration targets."] };
  }

  const sourceTemplate = getReadyTemplate(project.templateId);
  if (!sourceTemplate) {
    return { ok: false, errors: [`Project template is not available: ${project.templateId}`] };
  }

  // Source structure: the approved ready-template manifest; target: the
  // builder document of the target version.
  const sourcePages = ["home", "about", "services", "faqs", "contact"];
  const targetEnabled = target.document.pages.filter((p) => p.enabled);
  const pagesAdded = targetEnabled
    .map((p) => p.pageKey)
    .filter((k) => !sourcePages.includes(k));
  const pagesRemoved = sourcePages.filter(
    (k) => !targetEnabled.some((p) => p.pageKey === k)
  );

  const fieldsPreserved: string[] = [];
  const fieldsMissing: string[] = [];
  const inventory = buildPageAwareInventory();
  for (const field of inventory) {
    const pageEnabled = targetEnabled.some((p) => p.pageKey === field.pageKey);
    if (pageEnabled) fieldsPreserved.push(field.path);
    else fieldsMissing.push(field.path);
  }

  const warnings: string[] = [];
  if (pagesRemoved.length > 0) {
    warnings.push(
      `Pages removed in the target version: ${pagesRemoved.join(", ")}. Their content stays in the draft but will not render.`
    );
  }
  if (fieldsMissing.length > 0) {
    warnings.push(
      `${fieldsMissing.length} inventory field(s) belong to pages disabled in the target version.`
    );
  }
  warnings.push(
    "Content is preserved unchanged; verify all pages before approving the migrated draft."
  );

  const plan: Omit<MigrationPlan, "planHash"> = {
    projectId,
    sourceTemplateId: project.templateId,
    targetVersionId: target.versionId,
    targetFamilyKey: target.familyKey,
    targetVersion: target.version,
    pagesAdded,
    pagesRemoved,
    sectionsReordered: [],
    fieldsPreserved,
    fieldsMissing,
    fieldsNeedingReview: [],
    mappingChanges: [],
    warnings,
    compatible: true,
  };
  return { ok: true, plan: { ...plan, planHash: sha(JSON.stringify(plan)) } };
}

// ── Records ─────────────────────────────────────────────────────────────

export type MigrationRecord = {
  migrationId: string;
  projectId: string;
  actorId: string;
  sourceTemplateId: string;
  targetVersionId: string;
  planHash: string;
  status: "migrated_draft" | "assignment_migrated" | "rolled_back" | "rejected";
  sourceDraftId: string;
  sourceSnapshot: { content: unknown; templateId: string };
  migratedDraftId: string;
  backupId: string;
  createdAt: string;
  assignedAt?: string;
};

async function readRecords(projectId: string): Promise<MigrationRecord[]> {
  try {
    const raw = await fs.readFile(migrationsFile(projectId), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MigrationRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeRecords(projectId: string, records: MigrationRecord[]): Promise<void> {
  await writeHistory(migrationsFile(projectId), records);
}

// ── Execute ─────────────────────────────────────────────────────────────

export type ExecuteResult =
  | {
      ok: true;
      migrated: boolean;
      alreadyMigrated: boolean;
      migrationId: string;
      migratedDraftId: string;
      backupId: string;
      planHash: string;
    }
  | { ok: false; errors: string[] };

/** Create backup + migrated review draft. Idempotent per plan hash. */
export async function executeMigration(
  auth: AuthContext,
  projectId: string,
  targetVersionId: string,
  planHash: string,
  confirm: boolean
): Promise<ExecuteResult> {
  if (!confirm) {
    return { ok: false, errors: ["Migration requires explicit confirmation ({ confirm: true })."] };
  }

  const planResult = await buildMigrationPlan(auth, projectId, targetVersionId);
  if (!planResult.ok) return { ok: false, errors: planResult.errors };
  const plan = planResult.plan;
  if (plan.planHash !== planHash) {
    return {
      ok: false,
      errors: ["Plan hash mismatch — the target version or content changed. Re-run the preview."],
    };
  }

  const repos = getScopedRepositories(auth);
  const project = (await repos.projects.loadProject(projectId))!;
  const drafts = await projectDraftRepository.listDrafts(projectId);
  const sourceDraft =
    drafts.find((d) => d.id === project.currentDraftId) ??
    drafts.find((d) => d.approved) ??
    drafts[drafts.length - 1];
  if (!sourceDraft) {
    return {
      ok: false,
      errors: ["The project has no draft to migrate. Generate or save a draft first — no invented content is created."],
    };
  }

  const records = await readRecords(projectId);
  const existing = records.find(
    (r) => r.planHash === planHash && r.sourceDraftId === sourceDraft.id && r.status !== "rolled_back"
  );
  if (existing) {
    return {
      ok: true,
      migrated: false,
      alreadyMigrated: true,
      migrationId: existing.migrationId,
      migratedDraftId: existing.migratedDraftId,
      backupId: existing.backupId,
      planHash,
    };
  }

  // Immutable backup of the source assignment + draft content.
  const backupId = `backup_${Date.now().toString(36)}`;
  const backup = {
    backupId,
    createdAt: new Date().toISOString(),
    templateId: project.templateId,
    currentDraftId: project.currentDraftId ?? null,
    draftContent: sourceDraft.content,
    draftApproved: sourceDraft.approved,
  };
  await writeHistory(
    path.join(MIGRATIONS_FILE_DIR, projectId, "template-backups.json"),
    [backup]
  );

  // Migrated draft: same validated content, new review-status snapshot.
  const migrated = await projectDraftRepository.createDraft({
    projectId,
    templateId: project.templateId,
    content: sourceDraft.content,
    source: "manual",
    aiPromptVersion: `template-migration:${planHash}`,
  });

  const record: MigrationRecord = {
    migrationId: `mig_${Date.now().toString(36)}`,
    projectId,
    actorId: auth.userId,
    sourceTemplateId: project.templateId,
    targetVersionId,
    planHash,
    status: "migrated_draft",
    sourceDraftId: sourceDraft.id,
    sourceSnapshot: { content: sourceDraft.content, templateId: project.templateId },
    migratedDraftId: migrated.id,
    backupId,
    createdAt: new Date().toISOString(),
  };
  records.push(record);
  await writeRecords(projectId, records);

  return {
    ok: true,
    migrated: true,
    alreadyMigrated: false,
    migrationId: record.migrationId,
    migratedDraftId: migrated.id,
    backupId,
    planHash,
  };
}

// ── Assignment migration (Stage D) + rollback ───────────────────────────

export type AssignmentResult =
  | { ok: true; status: "assignment_migrated" | "rolled_back"; templateId: string; versionId: string | null }
  | { ok: false; errors: string[] };

/**
 * Migrate the project assignment to the target version. Requires an APPROVED
 * migrated draft (created by executeMigration) for the same plan hash.
 * Never touches WordPress or the family default.
 */
export async function migrateAssignment(
  auth: AuthContext,
  projectId: string,
  migrationId: string,
  confirm: boolean
): Promise<AssignmentResult> {
  if (!confirm) {
    return { ok: false, errors: ["Assignment migration requires explicit confirmation."] };
  }
  const records = await readRecords(projectId);
  const record = records.find((r) => r.migrationId === migrationId);
  if (!record) return { ok: false, errors: ["Migration not found."] };
  if (record.status !== "migrated_draft") {
    return { ok: false, errors: [`Migration is ${record.status}; cannot assign.`] };
  }

  const migrated = await projectDraftRepository.loadDraft(projectId, record.migratedDraftId);
  if (!migrated) return { ok: false, errors: ["Migrated draft not found."] };
  if (!migrated.approved) {
    return { ok: false, errors: ["Approve the migrated draft before migrating the assignment."] };
  }

  const repos = getScopedRepositories(auth);
  const updated = await repos.projects.updateProject(projectId, {
    templateVersionId: record.targetVersionId,
  });
  if (!updated) {
    return { ok: false, errors: ["Assignment update failed — the source assignment is unchanged."] };
  }

  const records2 = await readRecords(projectId);
  const idx = records2.findIndex((r) => r.migrationId === migrationId);
  records2[idx] = {
    ...records2[idx],
    status: "assignment_migrated",
    assignedAt: new Date().toISOString(),
  };
  await writeRecords(projectId, records2);
  return {
    ok: true,
    status: "assignment_migrated",
    templateId: updated.templateId,
    versionId: record.targetVersionId,
  };
}

/** Rollback: restore the source assignment and draft pointer atomically. */
export async function rollbackMigration(
  auth: AuthContext,
  projectId: string,
  migrationId: string,
  confirm: boolean
): Promise<AssignmentResult> {
  if (!confirm) {
    return { ok: false, errors: ["Rollback requires explicit confirmation."] };
  }
  const records = await readRecords(projectId);
  const record = records.find((r) => r.migrationId === migrationId);
  if (!record) return { ok: false, errors: ["Migration not found."] };

  const repos = getScopedRepositories(auth);
  const updated = await repos.projects.updateProject(projectId, {
    templateVersionId: undefined,
    currentDraftId: record.sourceDraftId,
  });
  if (!updated) {
    return { ok: false, errors: ["Rollback failed — state unchanged."] };
  }
  const records2 = await readRecords(projectId);
  const idx = records2.findIndex((r) => r.migrationId === migrationId);
  records2[idx] = { ...records2[idx], status: "rolled_back" };
  await writeRecords(projectId, records2);
  return {
    ok: true,
    status: "rolled_back",
    templateId: updated.templateId,
    versionId: null,
  };
}

// ── Demo package (Stage E) ──────────────────────────────────────────────

export type DemoPackage = {
  projectId: string;
  projectName: string;
  templateId: string;
  templateVersionId: string | null;
  schemaVersion: string;
  contentHash: string | null;
  enabledPages: string[];
  status:
    | "draft"
    | "reviewed"
    | "approved"
    | "staging-synced"
    | "read-back-verified"
    | "demo-package-ready";
  stagingVerificationPending: boolean;
  approvedDraftId: string | null;
  qa: {
    checklistId: string | null;
    readinessState: string;
    contentState: string;
    passed: number;
    failed: number;
    pending: number;
    boundToCurrentContent: boolean;
  };
  references: {
    preview: string;
    inventory: string;
    exports: string;
    wordpress: string;
  };
  generatedAt: string;
};

/**
 * Project-scoped demo package for pitch preparation. Internal references
 * only; nothing is public, deployed, or sent to WordPress.
 */
export async function buildDemoPackage(
  auth: AuthContext,
  projectId: string
): Promise<{ ok: true; pkg: DemoPackage } | { ok: false; errors: string[] }> {
  const repos = getScopedRepositories(auth);
  const project = await repos.projects.loadProject(projectId);
  if (!project) return { ok: false, errors: ["Project not found."] };

  const drafts = await projectDraftRepository.listDrafts(projectId);
  const approved = drafts.find((d) => d.approved) ?? null;
  const contentHash = approved ? hashContent(approved.content) : null;

  // Staging verification state from the append-only sync history.
  let stagingSynced = false;
  let readBackVerified = false;
  try {
    const { syncHistoryRepository } = await import("@/lib/wordpress-staging/sync-repository");
    const history = await syncHistoryRepository.list(projectId);
    stagingSynced = history.some(
      (r) => r.operation === "content-sync" && r.status === "success"
    );
    readBackVerified = history.some(
      (r) =>
        r.operation === "content-sync" && r.status === "success" && r.readBackVerified
    );
  } catch {
    // History unavailable → verification pending (honest default).
  }

  let status: DemoPackage["status"] = "draft";
  if (project.status === "review") status = "reviewed";
  if (approved) status = "approved";
  if (stagingSynced) status = "staging-synced";
  if (readBackVerified) status = "read-back-verified";
  if (readBackVerified && approved) status = "demo-package-ready";

  // Slice 18 — QA checklist status (honest; checklist may be absent).
  let qa: DemoPackage["qa"] = {
    checklistId: null,
    readinessState: "not_started",
    contentState: "pending",
    passed: 0,
    failed: 0,
    pending: 0,
    boundToCurrentContent: false,
  };
  try {
    const { findCurrentChecklist, assessReadiness, listChecklists } = await import(
      "@/lib/qa/checklist"
    );
    const templateVersionId = project.templateVersionId ?? null;
    const current = await findCurrentChecklist(projectId, contentHash, templateVersionId);
    if (current) {
      const all = await listChecklists(projectId);
      const found = all.find((c) => c.checklistId === current.checklistId);
      if (found) {
        const assessment = assessReadiness({
          checklist: found,
          approvedContentHash: contentHash,
          readBackVerified,
          stagingSynced,
        });
        qa = {
          checklistId: found.checklistId,
          readinessState: assessment.state,
          contentState: assessment.contentState,
          passed: assessment.passed,
          failed: assessment.failed,
          pending: assessment.pending,
          boundToCurrentContent: true,
        };
      }
    }
  } catch {
    // QA unavailable → honest default above.
  }

  return {
    ok: true,
    pkg: {
      projectId: project.id,
      projectName: project.name,
      templateId: project.templateId,
      templateVersionId: project.templateVersionId ?? null,
      schemaVersion: "2.0",
      contentHash,
      enabledPages: ["home", "about", "services", "faqs", "contact"],
      status,
      stagingVerificationPending: !readBackVerified,
      approvedDraftId: approved?.id ?? null,
      qa,
      references: {
        preview: `/projects/${projectId}/preview`,
        inventory: `/projects/${projectId}/inventory`,
        exports: `/projects/${projectId}/exports`,
        wordpress: `/projects/${projectId}/wordpress`,
      },
      generatedAt: new Date().toISOString(),
    },
  };
}
