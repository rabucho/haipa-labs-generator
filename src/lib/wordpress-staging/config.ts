import "server-only";

import type { WordPressStagingConfig } from "./types";

/**
 * Server-side WordPress staging configuration (Slice 10).
 *
 * Reads from environment variables. Never imported by client components.
 * Defaults are SAFE: integration is disabled unless explicitly enabled.
 */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function getWordPressStagingConfig(): WordPressStagingConfig {
  const enabled = process.env.WORDPRESS_INTEGRATION_ENABLED === "true";
  const stagingUrl = nonEmpty(process.env.WORDPRESS_STAGING_URL) ?? null;
  const rawAuthMode = nonEmpty(process.env.WORDPRESS_AUTH_MODE);
  const authMode =
    rawAuthMode === "application-password" ? "application-password" : null;
  const authSecretReference =
    nonEmpty(process.env.WORDPRESS_AUTH_SECRET_REFERENCE) ?? null;

  return {
    enabled: enabled && Boolean(stagingUrl),
    stagingUrl,
    authMode,
    authSecretReference,
    timeoutMs: intEnv("WORDPRESS_TIMEOUT_MS", 30000),
    maxRetries: intEnv("WORDPRESS_MAX_RETRIES", 1),
  };
}

/** Client-safe summary (no credentials). */
export function redactedStagingConfigSummary(config: WordPressStagingConfig) {
  return {
    enabled: config.enabled,
    stagingUrl: config.stagingUrl,
    authMode: config.authMode,
    authSecretReference: config.authSecretReference
      ? "[configured]"
      : null,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };
}
