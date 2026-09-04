import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { enabledPages } from "@/types/pages";

/**
 * Project-level demo QA checklist (Slice 18).
 *
 * Project-scoped JSON persistence under .data/projects/<id>/ (existing
 * convention). Every checklist is bound to the exact content hash, template
 * version, and schema version — any change to project content or template
 * invalidates applicable checks (readiness falls back honestly).
 *
 * Live-verification safety: provider/staging checks can only be marked by an
 * explicit operator action with evidence; stubbed tests never transition
 * them, and the readiness ladder never claims live success without the
 * corresponding server-side record (sync history / approved draft).
 */

function qaRoot(): string {
  return process.env.PROJECTS_DATA_DIR ?? path.join(process.cwd(), ".data", "projects");
}

function qaFile(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(projectId)) {
    throw new Error("Invalid project id.");
  }
  return path.join(qaRoot(), projectId, "qa-checklists.json");
}

export type QaCategory =
  | "content"
  | "design"
  | "navigation"
  | "responsive"
  | "exports"
  | "staging"
  | "provider"
  | "migration";

export type QaCheckStatus = "pending" | "passed" | "failed" | "not_applicable";

export const DemoQaCheckSchema = z
  .object({
    checkId: z.string().min(1).max(60),
    category: z.enum([
      "content",
      "design",
      "navigation",
      "responsive",
      "exports",
      "staging",
      "provider",
      "migration",
    ]),
    label: z.string().min(1).max(200),
    status: z.enum(["pending", "passed", "failed", "not_applicable"]),
    evidence: z.string().max(500).optional(),
    verifiedBy: z.string().max(60).optional(),
    verifiedAt: z.string().optional(),
  })
  .strict();

export type DemoQaCheck = z.infer<typeof DemoQaCheckSchema>;

export const DemoQaChecklistSchema = z
  .object({
    checklistId: z.string().min(1).max(60),
    projectId: z.string().min(1).max(80),
    templateVersionId: z.string().max(80).nullable(),
    contentHash: z.string().max(32).nullable(),
    schemaVersion: z.string().min(1).max(20),
    status: z.enum(["not_started", "in_progress", "blocked", "ready"]),
    checks: z.array(DemoQaCheckSchema).min(1),
    createdBy: z.string().min(1).max(60),
    updatedAt: z.string(),
    completedAt: z.string().optional(),
  })
  .strict();

export type DemoQaChecklist = z.infer<typeof DemoQaChecklistSchema>;

async function readAll(projectId: string): Promise<DemoQaChecklist[]> {
  try {
    const raw = await fs.readFile(qaFile(projectId), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => DemoQaChecklistSchema.safeParse(c))
      .filter((r) => r.success)
      .map((r) => r.data as DemoQaChecklist);
  } catch {
    return [];
  }
}

async function writeAll(projectId: string, checklists: DemoQaChecklist[]): Promise<void> {
  await fs.mkdir(path.dirname(qaFile(projectId)), { recursive: true });
  await fs.writeFile(qaFile(projectId), JSON.stringify(checklists, null, 2), "utf-8");
}

// ── Required checks (Stage B) ────────────────────────────────────────────

export const DEFAULT_QA_CHECKS: Array<
  Omit<DemoQaCheck, "status" | "evidence" | "verifiedBy" | "verifiedAt">
> = [
  { checkId: "content-business-name", category: "content", label: "Business name is present and comes from the brief." },
  { checkId: "content-contact-supplied", category: "content", label: "Contact details present only when supplied or approved." },
  { checkId: "content-services-match-brief", category: "content", label: "Services match the brief; no invented services." },
  { checkId: "content-review-markers", category: "content", label: "No [For review] markers remain unless explicitly accepted." },
  { checkId: "content-no-invented-claims", category: "content", label: "No invented claims, certifications, awards, statistics, reviews, testimonials, ratings, prices, or guarantees." },
  { checkId: "content-coherent-headings", category: "content", label: "Headings and CTA text are coherent." },
  { checkId: "content-length-limits", category: "content", label: "Content length limits pass schema validation." },
  { checkId: "content-all-pages-valid", category: "content", label: "Every enabled page has valid content." },
  { checkId: "design-pages-render", category: "design", label: "Home, About, Services, FAQs, and Contact render successfully." },
  { checkId: "design-shop-gated", category: "design", label: "Shop appears only when WooCommerce capability is actually enabled." },
  { checkId: "design-desktop-preview", category: "responsive", label: "Desktop preview renders for every enabled page." },
  { checkId: "design-mobile-preview", category: "responsive", label: "Mobile preview renders for every enabled page." },
  { checkId: "design-shell-present", category: "design", label: "SiteShell header and footer are present." },
  { checkId: "navigation-manifest", category: "navigation", label: "Desktop and mobile navigation follow the page manifest." },
  { checkId: "navigation-disabled-hidden", category: "navigation", label: "Disabled pages do not appear in navigation." },
  { checkId: "design-a11y", category: "design", label: "Heading hierarchy, landmarks, focus states, keyboard navigation, and reduced motion are usable." },
  { checkId: "design-no-broken-media", category: "design", label: "No broken images or invalid links exist." },
  { checkId: "version-intended-template", category: "migration", label: "Project uses the intended immutable template version." },
  { checkId: "version-migration-evidence", category: "migration", label: "Migration evidence exists if the project was deliberately migrated." },
  { checkId: "exports-acf", category: "exports", label: "ACF export matches the selected template version/schema." },
  { checkId: "exports-mapping", category: "exports", label: "Mapping export covers the current editable inventory." },
  { checkId: "exports-content-hash", category: "exports", label: "Content export hash matches the approved draft." },
  { checkId: "staging-dry-run-inspected", category: "staging", label: "Dry-run diff was inspected before staging sync." },
  { checkId: "staging-sync-status", category: "staging", label: "Staging sync status is explicit (performed or intentionally not performed)." },
  { checkId: "staging-read-back-status", category: "staging", label: "Read-back validation status is explicit." },
  { checkId: "provider-status", category: "provider", label: "Provider verification status is recorded (contract-tested vs live-tested)." },
];

function freshChecks(): DemoQaCheck[] {
  return DEFAULT_QA_CHECKS.map((c) => ({ ...c, status: "pending" as const }));
}

// ── Readiness ladder (Stage C) ───────────────────────────────────────────

export type ReadinessState =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "reviewed"
  | "approved"
  | "staging_synced"
  | "read_back_verified"
  | "demo_package_ready";

export type ReadinessAssessment = {
  state: ReadinessState;
  contentState: "pending" | "in_progress" | "blocked" | "ready";
  passed: number;
  failed: number;
  pending: number;
  not_applicable: number;
  blockingChecks: string[];
  /** True only when a real server-side approved draft matches the bound hash. */
  approvalVerified: boolean;
  /** True only when append-only sync history contains a verified read-back. */
  readBackVerified: boolean;
};

/**
 * Computes the honest readiness ladder for a checklist. Live states
 * (approved / staging_synced / read_back_verified / demo_package_ready) are
 * derived from server-side evidence, never from check statuses alone — a
 * stubbed test can never transition them.
 */
export function assessReadiness(input: {
  checklist: DemoQaChecklist;
  approvedContentHash: string | null;
  readBackVerified: boolean;
  stagingSynced: boolean;
}): ReadinessAssessment {
  const { checklist, approvedContentHash, readBackVerified, stagingSynced } = input;
  const counts = { passed: 0, failed: 0, pending: 0, not_applicable: 0 };
  const blockingChecks: string[] = [];
  for (const c of checklist.checks) {
    counts[c.status] += 1;
    if (c.status === "failed" || c.status === "pending") blockingChecks.push(c.checkId);
  }

  let contentState: ReadinessAssessment["contentState"];
  if (counts.failed > 0) contentState = "blocked";
  else if (counts.pending === 0) contentState = "ready";
  else if (counts.passed > 0 || counts.not_applicable > 0) contentState = "in_progress";
  else contentState = "pending";

  // The bound hash must match the currently approved draft, or the checklist
  // is stale against changed content and cannot claim any live state.
  const approvalVerified =
    approvedContentHash !== null &&
    checklist.contentHash !== null &&
    checklist.contentHash === approvedContentHash;

  let state: ReadinessState;
  if (contentState === "blocked") state = "blocked";
  else if (contentState === "ready" && approvalVerified && readBackVerified)
    state = "demo_package_ready";
  else if (contentState === "ready" && approvalVerified && stagingSynced)
    state = "staging_synced";
  else if (contentState === "ready" && approvalVerified) state = "approved";
  else if (contentState === "ready") state = "reviewed";
  // Live states with an incomplete checklist: server evidence exists, so the
  // honest label reflects the furthest verified staging step.
  else if (approvalVerified && readBackVerified) state = "read_back_verified";
  else if (approvalVerified && stagingSynced) state = "staging_synced";
  else state = contentState === "pending" ? "not_started" : "in_progress";

  return { state, contentState, ...counts, blockingChecks, approvalVerified, readBackVerified };
}

// ── Lifecycle operations ─────────────────────────────────────────────────

export async function createChecklist(input: {
  projectId: string;
  operatorId: string;
  templateVersionId: string | null;
  contentHash: string | null;
  schemaVersion: string;
}): Promise<{ ok: true; checklist: DemoQaChecklist } | { ok: false; errors: string[] }> {
  if (!input.templateVersionId || !input.contentHash) {
    return {
      ok: false,
      errors: [
        "A QA checklist requires approved content bound to an immutable template version. Generate, review, and approve a draft first.",
      ],
    };
  }
  const existing = await readAll(input.projectId);
  // Idempotent: the same content hash + template version returns the
  // existing checklist instead of creating an ambiguous duplicate.
  const current = existing.find(
    (c) => c.contentHash === input.contentHash && c.templateVersionId === input.templateVersionId
  );
  if (current) return { ok: true, checklist: current };

  const checklist: DemoQaChecklist = {
    checklistId: `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    projectId: input.projectId,
    templateVersionId: input.templateVersionId,
    contentHash: input.contentHash,
    schemaVersion: input.schemaVersion,
    status: "not_started",
    checks: freshChecks(),
    createdBy: input.operatorId,
    updatedAt: new Date().toISOString(),
  };
  await writeAll(input.projectId, [...existing, checklist]);
  return { ok: true, checklist };
}

export async function listChecklists(projectId: string): Promise<DemoQaChecklist[]> {
  return readAll(projectId);
}

export async function getChecklist(
  projectId: string,
  checklistId: string
): Promise<DemoQaChecklist | null> {
  const all = await readAll(projectId);
  return all.find((c) => c.checklistId === checklistId) ?? null;
}

/**
 * Records one check result with bounded evidence. Operator identity is
 * stamped automatically; stale results against changed content are visible
 * because the checklist stays bound to its original content hash.
 */
export async function updateCheck(input: {
  projectId: string;
  checklistId: string;
  operatorId: string;
  checkId: string;
  status: DemoQaCheck["status"];
  evidence?: string;
}): Promise<{ ok: true; checklist: DemoQaChecklist } | { ok: false; errors: string[] }> {
  const all = await readAll(input.projectId);
  const idx = all.findIndex((c) => c.checklistId === input.checklistId);
  if (idx === -1) return { ok: false, errors: ["Checklist not found."] };
  const checklist = all[idx];
  const checkIdx = checklist.checks.findIndex((c) => c.checkId === input.checkId);
  if (checkIdx === -1) return { ok: false, errors: [`Unknown check "${input.checkId}".`] };

  const updated: DemoQaChecklist = {
    ...checklist,
    checks: checklist.checks.map((c, i) =>
      i === checkIdx
        ? {
            ...c,
            status: input.status,
            evidence: input.evidence?.slice(0, 500),
            verifiedBy: input.operatorId,
            verifiedAt: new Date().toISOString(),
          }
        : c
    ),
    updatedAt: new Date().toISOString(),
  };
  all[idx] = updated;
  await writeAll(input.projectId, all);
  return { ok: true, checklist: updated };
}

/**
 * Returns the newest checklist bound to the given content hash + template
 * version, or null when content/template changed (invalidation: the operator
 * must complete a fresh checklist for the new content). Old checklists are
 * kept as history and never deleted.
 */
export async function findCurrentChecklist(
  projectId: string,
  contentHash: string | null,
  templateVersionId: string | null
): Promise<DemoQaChecklist | null> {
  if (!contentHash || !templateVersionId) return null;
  const all = await readAll(projectId);
  return (
    [...all]
      .reverse()
      .find((c) => c.contentHash === contentHash && c.templateVersionId === templateVersionId) ??
    null
  );
}

// ── Page-by-page preview verification (Slice 19) ─────────────────────────

export type PagePreviewCheck = {
  pageKey: string;
  route: string;
  displayName: string;
  previewPath: string;
  checks: Array<{
    id: string;
    label: string;
    status: DemoQaCheck["status"];
  }>;
};

/**
 * Builds per-page preview verification entries for every ENABLED page of the
 * project's template manifest. The shared design/pages/navigation checks from
 * the base checklist are expanded page-by-page so an operator can record
 * evidence per page and per route.
 *
 * Zero network: this derives purely from the manifest and the project's
 * capability flags. Visual screenshot QA is not automated — each entry
 * carries internal preview references and the operator records evidence
 * manually (documented limitation).
 */
export function buildPagePreviewChecks(options: {
  projectId: string;
  woocommerce?: boolean;
}): PagePreviewCheck[] {
  return enabledPages({ woocommerce: options.woocommerce === true }).map((page) => ({
    pageKey: page.pageKey,
    route: page.route,
    displayName: page.displayName,
    previewPath: `/projects/${options.projectId}/preview/${page.pageKey === "home" ? "" : page.pageKey}`,
    checks: [
      {
        id: `page-${page.pageKey}-renders`,
        label: `${page.displayName} renders through the registered renderer with the shared SiteShell.`,
        status: "pending",
      },
      {
        id: `page-${page.pageKey}-navigation`,
        label: `${page.displayName} desktop/mobile navigation follows the manifest; active route visible.`,
        status: "pending",
      },
      {
        id: `page-${page.pageKey}-responsive`,
        label: `${page.displayName} renders on desktop and mobile without fatal errors or broken images.`,
        status: "pending",
      },
      {
        id: `page-${page.pageKey}-a11y`,
        label: `${page.displayName} landmarks, heading order, focus visibility, and reduced motion are intact.`,
        status: "pending",
      },
    ],
  }));
}