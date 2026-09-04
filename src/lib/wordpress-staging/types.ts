import "server-only";

import { z } from "zod";
import type { HomeContent } from "@/types/content";
import type { AcfFieldGroupDefinition, FieldMapping } from "@/types/schema";
import type { ContentInventory } from "@/types/inventory";
import type { WebsiteProject } from "@/types/project";

/**
 * WordPress staging integration types (Slice 10).
 *
 * All network and credential handling stays server-only. These types
 * describe the contract between the API routes, the staging provider,
 * and the sync history repository.
 */

// ── Authorized context ──────────────────────────────────────────────────

/** Project already resolved + authorized by the Slice 9 guards. */
export type AuthorizedProject = WebsiteProject;

/** Draft that passed schema validation and belongs to the project. */
export type AuthorizedDraft = {
  id: string;
  projectId: string;
  content: HomeContent;
  templateId: string;
  approved: boolean;
};

/** Operator identity from the authenticated session. */
export type SyncActor = {
  userId: string;
  role: "operator" | "admin";
};

// ── Configuration ───────────────────────────────────────────────────────

export type WordPressStagingConfig = {
  enabled: boolean;
  stagingUrl: string | null;
  authMode: "application-password" | null;
  authSecretReference: string | null;
  timeoutMs: number;
  maxRetries: number;
};

// ── Diagnostics ─────────────────────────────────────────────────────────

export type WordPressDiagnostics = {
  ok: boolean;
  restReachable: boolean;
  pagesReachable: boolean;
  acfFieldGroupsReachable: boolean;
  acfFieldGroupCreateSupported: boolean;
  version: string | null;
  errorCode:
    | "unreachable"
    | "auth-failed"
    | "acf-unsupported"
    | "timeout"
    | "misconfigured"
    | "dns-failure"
    | "tls-failure"
    | "network-error"
    | "http-5xx"
    | "bad-json"
    | null;
  detail: string;
  checkedAt: string;
  /** Slice 20: phase-specific, bounded diagnostics. */
  phase?:
    | "configuration"
    | "url-validation"
    | "dns"
    | "tls"
    | "http"
    | "rest"
    | "auth"
    | null;
  statusCode?: number | null;
  elapsedMs?: number | null;
  /** Whether retrying the same read-only probe is appropriate. */
  retryable?: boolean;
  /** Safe operator-facing remediation hint (never contains credentials). */
  remediation?: string | null;
};

// ── Dry run ─────────────────────────────────────────────────────────────

export type WordPressDryRun = {
  ok: boolean;
  fields: Array<{
    internalPath: string;
    wpName: string;
    value: unknown;
  }>;
  acfDefinition: AcfFieldGroupDefinition | null;
  target: { pageId: number | null; pageSlug: string };
  errorCode:
    | "no-approved-draft"
    | "draft-not-validated"
    | "no-acf-definition"
    | "no-mapping"
    | null;
  detail: string;
};

// ── Schema provisioning ─────────────────────────────────────────────────

export type WordPressSchemaSyncResult = {
  ok: boolean;
  provisioned: boolean;
  supported: boolean;
  fieldGroupKey: string;
  exportPath: string | null;
  errorCode:
    | "unsupported"
    | "auth-failed"
    | "duplicate-ambiguous"
    | "timeout"
    | null;
  detail: string;
};

// ── Content sync ────────────────────────────────────────────────────────

export type WordPressContentSyncResult = {
  ok: boolean;
  pageId: string | null;
  readBackVerified: boolean;
  readBackContent: HomeContent | null;
  errorCode:
    | "no-approved-draft"
    | "draft-not-validated"
    | "write-failed"
    | "read-back-failed"
    | "timeout"
    | null;
  detail: string;
};

// ── Sync history ────────────────────────────────────────────────────────

export type SyncOperationType =
  | "diagnose"
  | "dry-run"
  | "schema-provision"
  | "content-sync"
  | "read-back"
  | "page-verify"
  | "diff";

export type SyncStatus = "success" | "failure" | "unsupported";

export type SyncRecord = {
  id: string;
  projectId: string;
  actorId: string;
  operation: SyncOperationType;
  draftId: string | null;
  contentHash: string | null;
  templateKey: string | null;
  templateVersion: string | null;
  schemaVersion: number | null;
  mappingVersion: string | null;
  targetIdentifier: string | null;
  startedAt: string;
  completedAt: string;
  status: SyncStatus;
  errorCode: string | null;
  readBackVerified: boolean;
};

export const SyncRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  actorId: z.string(),
  operation: z.enum([
    "diagnose",
    "dry-run",
    "schema-provision",
    "content-sync",
    "read-back",
    "page-verify",
    "diff",
  ]),
  draftId: z.string().nullable(),
  contentHash: z.string().nullable(),
  templateKey: z.string().nullable(),
  templateVersion: z.string().nullable(),
  schemaVersion: z.number().nullable(),
  mappingVersion: z.string().nullable(),
  targetIdentifier: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string(),
  status: z.enum(["success", "failure", "unsupported"]),
  errorCode: z.string().nullable(),
  readBackVerified: z.boolean(),
});

// ── Provider interface ──────────────────────────────────────────────────

export interface WordPressStagingProvider {
  diagnose(input: {
    stagingUrl: string;
    authSecretReference: string | null;
  }): Promise<WordPressDiagnostics>;

  dryRun(input: {
    project: AuthorizedProject;
    approvedDraft: AuthorizedDraft;
    inventory: ContentInventory[];
    acfDefinition: AcfFieldGroupDefinition;
    mappings: FieldMapping[];
  }): Promise<WordPressDryRun>;

  provisionSchema(input: {
    project: AuthorizedProject;
    acfDefinition: AcfFieldGroupDefinition;
  }): Promise<WordPressSchemaSyncResult>;

  syncApprovedContent(input: {
    project: AuthorizedProject;
    approvedDraft: AuthorizedDraft;
    mappings: FieldMapping[];
  }): Promise<WordPressContentSyncResult>;

  readBack(input: {
    project: AuthorizedProject;
  }): Promise<HomeContent>;

  /**
   * Locate a page on the allowlisted staging origin by id or slug.
   * READ-ONLY: used for page-binding verification and the draft-vs-staging
   * diff. Never writes. Returns safe error codes, never raw bodies.
   */
  locatePage(input: {
    pageId?: number;
    pageSlug?: string;
  }): Promise<{
    found: boolean;
    page: { pageId: string; slug: string; status: string | null } | null;
    errorCode:
      | "misconfigured"
      | "page-not-found"
      | "unreachable"
      | "auth-failed"
      | "timeout"
      | null;
  }>;
}

