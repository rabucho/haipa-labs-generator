import "server-only";

import { z } from "zod";
import type { AuthContext } from "@/lib/auth/session";
import type { ProjectWordPressConnection } from "@/types/project";
import { getScopedRepositories } from "@/lib/auth/guards";
import { getWordPressStagingConfig, redactedStagingConfigSummary } from "./config";
import { getStagingProvider } from "./provider";
import {
  syncHistoryRepository,
  makeSyncRecord,
} from "./sync-repository";

/**
 * Project-scoped WordPress connection management (Slice 11).
 *
 * Server-only. Validates and persists SAFE connection metadata (target key,
 * page id/slug, credential reference name). The credential itself is resolved
 * server-side at request time from the referenced environment variable and is
 * never returned to the client or persisted anywhere.
 *
 * The only allowlisted target in this slice is the single server-configured
 * staging origin (targetKey "staging" = WORDPRESS_STAGING_URL).
 */

export const STAGING_TARGET_KEY = "staging";

const SafeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-_]+$/, "Slug may only contain lowercase letters, numbers, hyphens and underscores.");

export const ConnectionInputSchema = z
  .object({
    targetKey: z.literal(STAGING_TARGET_KEY, {
      errorMap: () => ({
        message: `Unknown WordPress target. Only the server-configured staging target ("${STAGING_TARGET_KEY}") is allowlisted.`,
      }),
    }),
    pageId: z.number().int().positive().optional(),
    pageSlug: SafeSlugSchema.optional(),
  })
  .refine(
    (v) => v.pageId !== undefined || v.pageSlug !== undefined,
    { message: "Provide a page id or a page slug to bind." }
  );

export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;

/** Safe error codes surfaced to the UI (no raw provider bodies). */
export type ConnectionErrorCode =
  | "disabled"
  | "invalid-input"
  | "page-not-found"
  | "unreachable"
  | "auth-failed"
  | "timeout"
  | null;

export type ConnectionView = {
  integrationEnabled: boolean;
  stagingOrigin: string | null;
  authConfigured: boolean;
  connection: {
    targetKey: string;
    pageId: number | null;
    pageSlug: string | null;
    pageVerified: boolean;
    connectedAt: string | null;
    lastDiagnosedAt: string | null;
    lastPageVerifiedAt: string | null;
    lastReadBackAt: string | null;
  } | null;
  config: ReturnType<typeof redactedStagingConfigSummary>;
};

/** Redacted client view — never exposes the credential reference name or value. */
export function toConnectionView(
  connection: ProjectWordPressConnection | undefined,
  config: ReturnType<typeof getWordPressStagingConfig>
): ConnectionView {
  return {
    integrationEnabled: config.enabled,
    stagingOrigin: config.stagingUrl,
    authConfigured: Boolean(config.authSecretReference),
    connection: connection
      ? {
          targetKey: connection.targetKey,
          pageId: connection.pageId ?? null,
          pageSlug: connection.pageSlug ?? null,
          pageVerified: connection.pageVerified ?? false,
          connectedAt: connection.connectedAt ?? null,
          lastDiagnosedAt: connection.lastDiagnosedAt ?? null,
          lastPageVerifiedAt: connection.lastPageVerifiedAt ?? null,
          lastReadBackAt: connection.lastReadBackAt ?? null,
        }
      : null,
    config: redactedStagingConfigSummary(config),
  };
}

/** Validate + persist the project's staging page binding. */
export async function saveConnection(
  auth: AuthContext,
  projectId: string,
  input: unknown
): Promise<
  | { ok: true; view: ConnectionView }
  | { ok: false; errorCode: ConnectionErrorCode; errors: string[] }
> {
  const parsed = ConnectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: "invalid-input",
      errors: parsed.error.issues.map((i) => i.message),
    };
  }

  const config = getWordPressStagingConfig();
  const repos = getScopedRepositories(auth);
  const existing = await repos.projects.loadProject(projectId);
  if (!existing) {
    return { ok: false, errorCode: "invalid-input", errors: ["Project not found."] };
  }

  const now = new Date().toISOString();
  const previous = existing.wordpressConnection;
  const sameBinding =
    previous?.pageId === parsed.data.pageId &&
    previous?.pageSlug === parsed.data.pageSlug;
  const connection: ProjectWordPressConnection = {
    targetKey: STAGING_TARGET_KEY,
    pageId: parsed.data.pageId,
    pageSlug: parsed.data.pageSlug,
    credentialReference:
      config.authSecretReference ?? "WORDPRESS_APPLICATION_PASSWORD",
    // A changed binding invalidates a previous page verification.
    pageVerified: sameBinding ? (previous?.pageVerified ?? false) : false,
    connectedAt: previous?.connectedAt ?? now,
    lastDiagnosedAt: previous?.lastDiagnosedAt,
    lastPageVerifiedAt: sameBinding ? previous?.lastPageVerifiedAt : undefined,
    lastReadBackAt: previous?.lastReadBackAt,
  };

  const updated = await repos.projects.updateProject(projectId, {
    wordpressConnection: connection,
  });
  if (!updated) {
    return { ok: false, errorCode: "invalid-input", errors: ["Project not found."] };
  }
  return { ok: true, view: toConnectionView(updated.wordpressConnection, config) };
}

/** Verify the bound page exists on the allowlisted staging origin. Read-only. */
export async function verifyPageBinding(
  auth: AuthContext,
  projectId: string
): Promise<
  | {
      ok: true;
      view: ConnectionView;
      page: { pageId: string; slug: string; status: string | null };
    }
  | { ok: false; errorCode: ConnectionErrorCode; errors: string[] }
> {
  const config = getWordPressStagingConfig();
  const repos = getScopedRepositories(auth);
  const project = await repos.projects.loadProject(projectId);
  if (!project) {
    return { ok: false, errorCode: "invalid-input", errors: ["Project not found."] };
  }
  const conn = project.wordpressConnection;
  if (!config.enabled || !conn || (!conn.pageId && !conn.pageSlug)) {
    return {
      ok: false,
      errorCode: "disabled",
      errors: ["Bind a staging page and enable the integration before verifying."],
    };
  }

  const provider = getStagingProvider();
  const page = await provider.locatePage({
    pageId: conn.pageId,
    pageSlug: conn.pageSlug,
  });
  const verified = page.found;

  const updated = await repos.projects.updateProject(projectId, {
    wordpressConnection: {
      ...conn,
      pageVerified: verified,
      lastPageVerifiedAt: new Date().toISOString(),
    },
  });

  await syncHistoryRepository.append(
    projectId,
    makeSyncRecord({
      projectId,
      actorId: auth.userId,
      operation: "page-verify",
      templateKey: project.templateId,
      schemaVersion: null,
      targetIdentifier: config.stagingUrl ? "[staging]" : null,
      startedAt: new Date().toISOString(),
      status: verified ? "success" : "failure",
      errorCode: verified ? null : (page.errorCode ?? "page-not-found"),
    })
  );

  if (!verified || !updated || !page.page) {
    return {
      ok: false,
      errorCode: (page.errorCode as ConnectionErrorCode) ?? "page-not-found",
      errors: [
        page.errorCode === "timeout"
          ? "The staging site did not respond in time. Try again."
          : page.errorCode === "auth-failed"
            ? "Staging authentication failed. Check the server-side credential."
            : "The bound page was not found on the staging origin. Check the page id or slug.",
      ],
    };
  }
  return {
    ok: true,
    view: toConnectionView(updated.wordpressConnection, config),
    page: page.page,
  };
}
