import "server-only";

import type {
  WordPressStagingProvider,
  WordPressDiagnostics,
  WordPressDryRun,
  WordPressSchemaSyncResult,
  WordPressContentSyncResult,
  AuthorizedProject,
  AuthorizedDraft,
} from "./types";
import { getWordPressStagingConfig } from "./config";
import type { WordPressStagingConfig } from "./types";
import { mapWordPressHome } from "@/lib/content/wordpress";
import { validateHomeContent } from "@/lib/content/validate";
import type { HomeContent } from "@/types/content";
import type { AcfFieldGroupDefinition, FieldMapping } from "@/types/schema";
import type { ContentInventory } from "@/types/inventory";

export class WordPressSyncError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
  }
}

function resolveSecret(reference: string | null): string | null {
  if (!reference) return null;
  const value = process.env[reference];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function authHeader(secret: string | null): Record<string, string> {
  if (!secret) return {};
  return {
    Authorization: `Basic ${Buffer.from(secret).toString("base64")}`,
  };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export function resolveInternalPath(
  content: Record<string, unknown>,
  path: string
): unknown {
  let current: unknown = content;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function buildAcfPayload(
  content: HomeContent,
  mappings: FieldMapping[]
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const record = content as unknown as Record<string, unknown>;
  for (const mapping of mappings) {
    const path = mapping.internalPath;
    if (path.endsWith("[]")) {
      const repeaterPath = (path.slice(0, -2) + ".items").split(".");
      let rows: unknown = record;
      for (const segment of repeaterPath) {
        if (rows === null || typeof rows !== "object") break;
        rows = (rows as Record<string, unknown>)[segment];
      }
      if (!Array.isArray(rows)) continue;
      const subMappings = mappings.filter(
        (m) => m.internalPath.startsWith(`${path}.`) && m.internalPath !== path
      );
      payload[mapping.wpName] = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const sub of subMappings) {
          const subPath = sub.internalPath.slice(path.length + 1).split(".");
          let current: unknown = row;
          for (const segment of subPath) {
            if (current === null || typeof current !== "object") break;
            current = (current as Record<string, unknown>)[segment];
          }
          if (current !== undefined) out[sub.wpName] = current;
        }
        return out;
      });
      continue;
    }
    if (path.includes("[].")) continue;
    const value = resolveInternalPath(record, path);
    if (value !== undefined) payload[mapping.wpName] = value;
  }
  return payload;
}

export class StagingWordPressProvider implements WordPressStagingProvider {
  constructor(private readonly config: WordPressStagingConfig) {}

  /**
   * Classifies a fetch failure into a stable, redacted error code and the
   * connection phase where it occurred (Slice 20). Never includes raw error
   * bodies, URLs with credentials, or stack traces.
   */
  private classifyFailure(error: unknown): {
    errorCode: string;
    phase: "dns" | "tls" | "http" | null;
    retryable: boolean;
  } {
    const cause = (error as { cause?: { code?: string } })?.cause?.code ?? "";
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") {
      return { errorCode: "timeout", phase: "http", retryable: true };
    }
    if (/ENOTFOUND|EAI_AGAIN/.test(cause)) {
      return { errorCode: "dns-failure", phase: "dns", retryable: false };
    }
    if (/CERT|ERR_TLS|SSL|SELF_SIGNED/.test(cause.toUpperCase())) {
      return { errorCode: "tls-failure", phase: "tls", retryable: false };
    }
    return { errorCode: "network-error", phase: "http", retryable: true };
  }

  private async fetchJson(
    url: string,
    init: RequestInit = {}
  ): Promise<
    | { ok: true; status: number; json: unknown; elapsedMs: number }
    | {
        ok: false;
        status: number | null;
        errorCode: string;
        elapsedMs: number;
        phase: "dns" | "tls" | "http" | "rest" | "auth" | null;
        retryable: boolean;
      }
  > {
    // Bounded total behavior: at most (1 + WORDPRESS_MAX_RETRIES) attempts of
    // WORDPRESS_TIMEOUT_MS each. Retries apply ONLY to idempotent reads
    // (GET/HEAD) and ONLY to transient failures. DNS/TLS failures and
    // timeouts are never retried (retrying multiplies waiting without
    // changing the outcome), and writes are never retried.
    const method = (init.method ?? "GET").toUpperCase();
    const idempotentRead = method === "GET" || method === "HEAD";
    const attempts = idempotentRead ? 1 + Math.max(0, this.config.maxRetries) : 1;
    let lastCode = "unreachable";
    let lastPhase: "dns" | "tls" | "http" | null = "http";
    let lastRetryable = false;
    let lastStatus: number | null = null;
    const startedAt = Date.now();
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const attemptStart = Date.now();
      try {
        const res = await fetch(url, {
          ...init,
          headers: {
            "User-Agent": "Omoka-Staging-Sync/1.0",
            Accept: "application/json",
            ...authHeader(resolveSecret(this.config.authSecretReference)),
            ...(init.headers ?? {}),
          },
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timer);
        if (res.status >= 500 || res.status === 429) {
          lastCode = `http-${res.status}`;
          lastStatus = res.status;
          lastPhase = "http";
          lastRetryable = idempotentRead;
          continue;
        }
        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            errorCode: `http-${res.status}`,
            elapsedMs: Date.now() - attemptStart,
            phase: res.status === 401 || res.status === 403 ? "auth" : "http",
            retryable: false,
          };
        }
        const json: unknown = await res.json().catch(() => null);
        if (json === null) {
          return {
            ok: false,
            status: res.status,
            errorCode: "bad-json",
            elapsedMs: Date.now() - attemptStart,
            phase: "rest",
            retryable: false,
          };
        }
        return {
          ok: true,
          status: res.status,
          json,
          elapsedMs: Date.now() - attemptStart,
        };
      } catch (error) {
        clearTimeout(timer);
        const classified = this.classifyFailure(error);
        lastCode = classified.errorCode;
        lastPhase = classified.phase;
        lastStatus = null;
        // Never retry DNS/TLS failures or timeouts; retry only transient
        // network errors on idempotent reads.
        lastRetryable = classified.retryable && idempotentRead;
        if (classified.errorCode !== "network-error") break;
      }
    }
    return {
      ok: false,
      status: lastStatus,
      errorCode: lastCode,
      elapsedMs: Date.now() - startedAt,
      phase: lastPhase,
      retryable: lastRetryable,
    };
  }

  async diagnose(): Promise<WordPressDiagnostics> {
    const checkedAt = new Date().toISOString();
    const base = this.config.stagingUrl;
    if (!this.config.enabled || !base) {
      return {
        ok: false,
        restReachable: false,
        pagesReachable: false,
        acfFieldGroupsReachable: false,
        acfFieldGroupCreateSupported: false,
        version: null,
        errorCode: "misconfigured",
        detail:
          "WordPress staging integration is disabled or WORDPRESS_STAGING_URL is not set.",
        checkedAt,
        phase: "configuration",
        statusCode: null,
        elapsedMs: 0,
        retryable: false,
        remediation:
          "Set WORDPRESS_INTEGRATION_ENABLED=true and WORDPRESS_STAGING_URL in the server environment.",
      };
    }
    const root = await this.fetchJson(joinUrl(base, "/wp-json/"));
    if (!root.ok) {
      const remediation: Record<string, string> = {
        timeout:
          "The staging host did not respond within the timeout. Check that the site is up and your network can reach it (Test-NetConnection host -Port 443).",
        "dns-failure":
          "The staging hostname could not be resolved. Check DNS and the WORDPRESS_STAGING_URL spelling.",
        "tls-failure":
          "The HTTPS certificate could not be validated. Confirm the staging site serves a valid TLS certificate.",
        "auth-failed":
          "The configured credentials were rejected. Recreate the Application Password and update its secret value.",
        "http-5xx":
          "The staging server returned a server error. Check Site Health in WordPress admin.",
        "bad-json":
          "The response was not valid JSON - the URL may not point to a WordPress REST root.",
        "network-error":
          "The connection could not be established. Check firewall/VPN and that the host is reachable.",
        unreachable:
          "The staging server could not be reached. Check hosting status and network connectivity.",
      };
      const phase =
        root.phase === "dns"
          ? "dns"
          : root.phase === "tls"
            ? "tls"
            : root.phase === "auth"
              ? "auth"
              : root.phase === "rest"
                ? "rest"
                : "http";
      return {
        ok: false,
        restReachable: false,
        pagesReachable: false,
        acfFieldGroupsReachable: false,
        acfFieldGroupCreateSupported: false,
        version: null,
        errorCode:
          root.errorCode === "timeout"
            ? "timeout"
            : root.status === 401 || root.status === 403
              ? "auth-failed"
              : (root.errorCode as
                  | "dns-failure"
                  | "tls-failure"
                  | "network-error"
                  | "http-5xx"
                  | "bad-json"
                  | "unreachable"),
        detail: "REST root check failed (" + root.errorCode + ").",
        checkedAt,
        phase,
        statusCode: root.status,
        elapsedMs: root.elapsedMs,
        retryable: root.retryable,
        remediation: remediation[root.errorCode] ?? null,
      };
    }
    const version =
      root.json && typeof root.json === "object"
        ? (((root.json as Record<string, unknown>).description as string) ?? null)
        : null;
    const pages = await this.fetchJson(
      joinUrl(base, "/wp-json/wp/v2/pages?per_page=1&_fields=id,slug")
    );
    const pagesReachable = pages.ok;
    if (!pages.ok && (pages.status === 401 || pages.status === 403)) {
      return {
        ok: false,
        restReachable: true,
        pagesReachable: false,
        acfFieldGroupsReachable: false,
        acfFieldGroupCreateSupported: false,
        version,
        errorCode: "auth-failed",
        detail: "Pages endpoint rejected the configured credentials.",
        checkedAt,
        phase: "auth",
        statusCode: pages.status,
        elapsedMs: pages.elapsedMs,
        retryable: false,
        remediation:
          "Recreate the WordPress Application Password and update only the secret-reference value in the server environment.",
      };
    }
    const acfProbe = await this.fetchJson(
      joinUrl(base, "/wp-json/acf/v3/pages?per_page=1")
    );
    const acfFieldGroupsReachable = acfProbe.ok;
    return {
      ok: pagesReachable,
      restReachable: true,
      pagesReachable,
      acfFieldGroupsReachable,
      acfFieldGroupCreateSupported: false,
      version,
      errorCode: pagesReachable ? null : "unreachable",
      detail: pagesReachable
        ? acfFieldGroupsReachable
          ? "REST reachable; pages readable; ACF-to-REST read endpoints detected."
          : "REST reachable; pages readable; ACF-to-REST plugin not detected."
        : "Pages endpoint unreachable.",
      checkedAt,
      phase: pagesReachable ? "rest" : "http",
      statusCode: pages.ok ? pages.status : null,
      elapsedMs: pages.ok ? pages.elapsedMs : root.elapsedMs,
      retryable: !pagesReachable,
      remediation: pagesReachable
        ? null
        : "The REST root responded but the pages endpoint did not. Check permalink settings and any security plugins.",
    };
  }

  async dryRun(input: {
    project: AuthorizedProject;
    approvedDraft: AuthorizedDraft;
    inventory: ContentInventory[];
    acfDefinition: AcfFieldGroupDefinition;
    mappings: FieldMapping[];
  }): Promise<WordPressDryRun> {
    const fields: WordPressDryRun["fields"] = [];
    const content = input.approvedDraft.content as unknown as Record<
      string,
      unknown
    >;
    for (const mapping of input.mappings) {
      if (mapping.internalPath.endsWith("[]")) {
        const rows = resolveInternalPath(
          content,
          mapping.internalPath.slice(0, -2) + ".items"
        );
        if (Array.isArray(rows)) {
          fields.push({
            internalPath: mapping.internalPath,
            wpName: mapping.wpName,
            value: `${rows.length} row(s)`,
          });
        }
        continue;
      }
      if (mapping.internalPath.includes("[].")) continue;
      const value = resolveInternalPath(content, mapping.internalPath);
      if (value !== undefined) {
        fields.push({
          internalPath: mapping.internalPath,
          wpName: mapping.wpName,
          value,
        });
      }
    }
    return {
      ok: true,
      fields,
      acfDefinition: input.acfDefinition,
      target: {
        pageId: input.project.wordpressConnection?.pageId ?? null,
        pageSlug:
          input.project.wordpressConnection?.pageSlug ?? input.project.slug,
      },
      errorCode: null,
      detail: `Dry run would write ${fields.length} mapped field(s) to the staging target. No network request was made.`,
    };
  }

  async provisionSchema(input: {
    project: AuthorizedProject;
    acfDefinition: AcfFieldGroupDefinition;
  }): Promise<WordPressSchemaSyncResult> {
    void input;
    return {
      ok: false,
      provisioned: false,
      supported: false,
      fieldGroupKey: input.acfDefinition.key,
      exportPath: `/projects/${input.project.id}/exports`,
      errorCode: "unsupported",
      detail:
        "ACF field-group creation is not exposed by the WordPress REST API. Import the reviewed export (Exports step, ACF field group JSON) via ACF Tools > Import on the staging site, then record the page on the project WordPress connection.",
    };
  }

  async syncApprovedContent(input: {
    project: AuthorizedProject;
    approvedDraft: AuthorizedDraft;
    mappings: FieldMapping[];
  }): Promise<WordPressContentSyncResult> {
    const base = this.config.stagingUrl;
    if (!this.config.enabled || !base) {
      return {
        ok: false,
        pageId: null,
        readBackVerified: false,
        readBackContent: null,
        errorCode: "write-failed",
        detail: "Staging integration is disabled.",
      };
    }
    const pageSlug =
      input.project.wordpressConnection?.pageSlug ?? input.project.slug;
    const list = await this.fetchJson(
      joinUrl(
        base,
        `/wp-json/wp/v2/pages?slug=${encodeURIComponent(pageSlug)}&_fields=id,slug`
      )
    );
    if (!list.ok) {
      return {
        ok: false,
        pageId: null,
        readBackVerified: false,
        readBackContent: null,
        errorCode: "write-failed",
        detail: `Could not resolve the staging page (${list.errorCode}).`,
      };
    }
    const rows = Array.isArray(list.json) ? list.json : [];
    const configuredId = input.project.wordpressConnection?.pageId;
    const resolvedId =
      configuredId !== undefined
        ? String(configuredId)
        : rows.length > 0 && typeof (rows[0] as { id?: unknown }).id === "string"
          ? String((rows[0] as { id: string }).id)
          : null;
    if (!resolvedId || !/^\d+$/.test(resolvedId)) {
      return {
        ok: false,
        pageId: null,
        readBackVerified: false,
        readBackContent: null,
        errorCode: "write-failed",
        detail:
          "No staging page resolved for this project. Connect a page id or slug on the project first.",
      };
    }
    const acfPayload = buildAcfPayload(input.approvedDraft.content, input.mappings);
    const write = await this.fetchJson(
      joinUrl(base, `/wp-json/wp/v2/pages/${resolvedId}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acf: acfPayload }),
      }
    );
    if (!write.ok) {
      return {
        ok: false,
        pageId: resolvedId,
        readBackVerified: false,
        readBackContent: null,
        errorCode: "write-failed",
        detail: `Staging write failed (${write.errorCode ?? write.status}). The previous staging content is unchanged.`,
      };
    }
    const rawPage = Array.isArray(write.json) ? write.json[0] : write.json;
    try {
      const mapped = mapWordPressHome(rawPage as Record<string, unknown>);
      const validation = validateHomeContent(mapped);
      if (!validation.success) {
        return {
          ok: true,
          pageId: resolvedId,
          readBackVerified: false,
          readBackContent: null,
          errorCode: "read-back-failed",
          detail: `Sync wrote successfully but read-back failed schema validation: ${validation.details[0]}`,
        };
      }
      return {
        ok: true,
        pageId: resolvedId,
        readBackVerified: true,
        readBackContent: validation.data,
        errorCode: null,
        detail:
          "Sync succeeded and read-back content passed HomeContentSchema validation.",
      };
    } catch {
      return {
        ok: true,
        pageId: resolvedId,
        readBackVerified: false,
        readBackContent: null,
        errorCode: "read-back-failed",
        detail: "Sync wrote successfully but read-back mapping failed.",
      };
    }
  }

  async readBack(input: { project: AuthorizedProject }): Promise<HomeContent> {
    const base = this.config.stagingUrl;
    if (!this.config.enabled || !base) {
      throw new WordPressSyncError(
        "misconfigured",
        "Staging integration is disabled."
      );
    }
    const pageSlug =
      input.project.wordpressConnection?.pageSlug ?? input.project.slug;
    const list = await this.fetchJson(
      joinUrl(base, `/wp-json/wp/v2/pages?slug=${encodeURIComponent(pageSlug)}`)
    );
    if (!list.ok) {
      throw new WordPressSyncError(
        list.errorCode === "timeout" ? "timeout" : "unreachable",
        `Read-back request failed (${list.errorCode}).`
      );
    }
    const rows = Array.isArray(list.json) ? list.json : [];
    if (rows.length === 0) {
      throw new WordPressSyncError("unreachable", "Staging page not found.");
    }
    const mapped = mapWordPressHome(rows[0] as Record<string, unknown>);
    const validation = validateHomeContent(mapped);
    if (!validation.success) {
      throw new WordPressSyncError(
        "read-back-failed",
        `Read-back failed schema validation: ${validation.details[0]}`
      );
    }
    return validation.data;
  }

  /**
   * READ-ONLY page lookup for binding verification and the staging diff.
   * Prefers the exact page id when provided; otherwise resolves by slug.
   */
  async locatePage(input: {
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
  }> {
    const base = this.config.stagingUrl;
    if (!this.config.enabled || !base) {
      return { found: false, page: null, errorCode: "misconfigured" };
    }

    const fields = "_fields=id,slug,status";
    const url =
      input.pageId !== undefined
        ? joinUrl(base, `/wp-json/wp/v2/pages/${input.pageId}?${fields}`)
        : joinUrl(
            base,
            `/wp-json/wp/v2/pages?slug=${encodeURIComponent(input.pageSlug ?? "")}&${fields}`
          );

    const res = await this.fetchJson(url);
    if (!res.ok) {
      const code =
        res.errorCode === "timeout"
          ? "timeout"
          : res.status === 401 || res.status === 403
            ? "auth-failed"
            : "unreachable";
      return { found: false, page: null, errorCode: code };
    }

    const row = Array.isArray(res.json) ? res.json[0] : res.json;
    const record = row as { id?: unknown; slug?: unknown; status?: unknown } | null;
    if (!record || typeof record.id !== "string" || typeof record.slug !== "string") {
      return { found: false, page: null, errorCode: "page-not-found" };
    }
    // If binding by id, confirm the slug matches when one is configured.
    if (
      input.pageId !== undefined &&
      input.pageSlug !== undefined &&
      record.slug !== input.pageSlug
    ) {
      return { found: false, page: null, errorCode: "page-not-found" };
    }
    return {
      found: true,
      page: {
        pageId: record.id,
        slug: record.slug,
        status: typeof record.status === "string" ? record.status : null,
      },
      errorCode: null,
    };
  }
}
let singleton: StagingWordPressProvider | null = null;

export function getStagingProvider(): StagingWordPressProvider {
  if (!singleton) {
    singleton = new StagingWordPressProvider(getWordPressStagingConfig());
  }
  return singleton;
}

export { getWordPressStagingConfig, redactedStagingConfigSummary } from "./config";
export type { WordPressStagingConfig } from "./types";
