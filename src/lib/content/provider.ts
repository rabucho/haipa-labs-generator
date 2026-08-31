import "server-only";

import type { WordPressPageResponse } from "@/types/wordpress";
import {
  buildPageUrl,
  buildWordPressFetchOptions,
  type WordPressServerConfig,
} from "./server-config";

/**
 * Server-only WordPress REST content provider (Slice 3).
 *
 * - Accepts site configuration + page slug/id (site-scoped for future
 *   multi-tenancy; tenant authentication remains a later slice).
 * - Performs the ONLY outbound WordPress requests in the app.
 * - Raw WordPress JSON never leaves this layer except through the
 *   diagnostics redaction helper (sensitive values removed).
 */

// Site-scoped provider contracts (moved here; re-exported by wordpress.ts).
export type SiteContent = { id: string; name: string };
export type PageContent = { id: string; slug: string; raw: WordPressPageResponse };
export type PostQuery = { limit?: number; category?: string };
export type PostCollection = { posts: Array<{ id: string; title: string }> };

export interface ContentProvider {
  getSite(siteKey: string): Promise<SiteContent>;
  getPage(siteKey: string, slug: string): Promise<PageContent>;
  getPosts?(siteKey: string, options?: PostQuery): Promise<PostCollection>;
  updatePage?(siteKey: string, slug: string, content: PageContent): Promise<void>;
  publish?(siteKey: string, slug: string): Promise<void>;
}

export type FetchPageResult =
  | { ok: true; raw: WordPressPageResponse }
  | { ok: false; reason: "http-error" | "empty-response" | "network-error"; detail: string };

/**
 * WordPress REST provider for a single configured staging site.
 * Fetches only published public content by default; application-password
 * authentication (server-side only) is used when the staging site is not
 * publicly readable.
 */
export class WordPressRestContentProvider implements ContentProvider {
  constructor(private readonly config: WordPressServerConfig) {}

  /** Site identity for the configured staging site (no extra REST call). */
  async getSite(siteKey: string): Promise<SiteContent> {
    return { id: siteKey, name: this.config.apiUrl };
  }

  /** Fetches a page by slug for the configured site. */
  async getPage(_siteKey: string, slug: string): Promise<PageContent> {
    const result = await this.fetchBySlug(slug);
    if (!result.ok) {
      throw new Error(`getPage failed (${result.reason}): ${result.detail}`);
    }
    return {
      id: String(result.raw.id ?? ""),
      slug: String(result.raw.slug ?? slug),
      raw: result.raw,
    };
  }

  /** Fetches the configured Home page (id takes precedence over slug). */
  async fetchHomePage(): Promise<FetchPageResult> {
    return this.fetchByUrl(buildPageUrl(this.config));
  }

  /**
   * Resolves a numeric ACF image attachment ID to { url, alt } via the
   * public media endpoint. Needed because ACF's native REST exposure
   * serializes image fields as IDs regardless of the field's return-format
   * setting. Uses the same cache policy as page fetches.
   */
  async fetchMedia(
    id: number
  ): Promise<{ ok: true; url: string; alt: string } | { ok: false }> {
    try {
      const url = `${this.config.apiUrl.replace(/\/$/, "")}/wp/v2/media/${id}`;
      const res = await fetch(url, buildWordPressFetchOptions(this.config));
      if (!res.ok) return { ok: false };

      const json: unknown = await res.json();
      const media = (json ?? {}) as {
        source_url?: unknown;
        alt_text?: unknown;
        title?: { rendered?: unknown };
      };
      const sourceUrl =
        typeof media.source_url === "string" ? media.source_url : "";
      if (!sourceUrl) return { ok: false };

      const alt =
        typeof media.alt_text === "string" && media.alt_text.length > 0
          ? media.alt_text
          : typeof media.title?.rendered === "string"
            ? media.title.rendered
            : "";
      return { ok: true, url: sourceUrl, alt };
    } catch {
      return { ok: false };
    }
  }


  async fetchBySlug(slug: string): Promise<FetchPageResult> {
    const base = `${this.config.apiUrl.replace(/\/$/, "")}/wp/v2/pages`;
    return this.fetchByUrl(`${base}?slug=${encodeURIComponent(slug)}`);
  }

  private async fetchByUrl(url: string): Promise<FetchPageResult> {
    try {
      const res = await fetch(url, buildWordPressFetchOptions(this.config));

      if (!res.ok) {
        // Never include credentials or response bodies that may contain
        // sensitive data in errors.
        return {
          ok: false,
          reason: "http-error",
          detail: `WordPress REST request failed with HTTP status ${res.status}.`,
        };
      }

      const json: unknown = await res.json();
      const raw: WordPressPageResponse | undefined = Array.isArray(json)
        ? (json[0] as WordPressPageResponse | undefined)
        : (json as WordPressPageResponse);

      if (!raw) {
        return {
          ok: false,
          reason: "empty-response",
          detail: "The WordPress REST response contained no page object.",
        };
      }

      return { ok: true, raw };
    } catch (error) {
      return {
        ok: false,
        reason: "network-error",
        detail: `WordPress REST request failed: ${error instanceof Error ? error.name : "unknown error"}.`,
      };
    }
  }
}

const SENSITIVE_KEY = /password|passwd|token|secret|authorization|apikey|api_key|credential/i;
const MAX_DEPTH = 6;
const MAX_STRING = 120;

/**
 * Builds a redacted, type-describing copy of any value for the diagnostics
 * view: sensitive-looking keys are replaced with "[redacted]", long strings
 * are truncated (length preserved), arrays are sampled. Values themselves
 * are not exposed for sensitive keys.
 */
export function redactWordPressResponseShape(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;

  if (type === "string") {
    const s = value as string;
    if (s.length > MAX_STRING) {
      return `${s.slice(0, 60)}…(string, length ${s.length})`;
    }
    return s;
  }

  if (type === "number" || type === "boolean") return value;

  if (depth >= MAX_DEPTH) return "(max depth reached)";

  if (Array.isArray(value)) {
    const sample = value.slice(0, 2).map((item) => redactWordPressResponseShape(item, depth + 1));
    if (value.length > 2) {
      sample.push(`(+${value.length - 2} more items)`);
    }
    return sample;
  }

  if (type === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redactWordPressResponseShape(child, depth + 1);
    }
    return out;
  }

  return `(${type})`;
}

/** Redacts sensitive-looking values from the effective server config. */
export function redactConfig(config: WordPressServerConfig): Record<string, unknown> {
  return {
    apiUrl: config.apiUrl,
    pageId: config.pageId ?? null,
    pageSlug: config.pageSlug,
    appUser: config.appUser ? "[configured]" : null,
    appPassword: config.appPassword ? "[configured]" : null,
  };
}
