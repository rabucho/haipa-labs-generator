import "server-only";

/**
 * Server-only WordPress staging configuration (Slice 3).
 *
 * All credentials are read from environment variables on the server. They are
 * NEVER imported by client components and NEVER logged. See
 * `.env.example` and `docs/wordpress-staging-setup.md` for the documented
 * variable list and credential flow.
 */

export type WordPressServerConfig = {
  /** Base REST URL, e.g. https://staging.example.co.ke/wp-json */
  apiUrl: string;
  /** Numeric page id; takes precedence over slug when set. */
  pageId?: string;
  /** Page slug fallback, e.g. "home". */
  pageSlug: string;
  /**
   * WordPress application password credentials (server-side only).
   * Leave unset for public content; only use when the staging site is not
   * publicly readable. NOTE: Next.js does not cache fetch responses that
   * carry an Authorization header — authenticated reads bypass the data cache.
   */
  appUser?: string;
  appPassword?: string;
};

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Reads and validates the WordPress staging config from the environment. */
export function getWordPressServerConfig(): WordPressServerConfig | null {
  const apiUrl = nonEmpty(process.env.WORDPRESS_API_URL);
  if (!apiUrl) return null;

  return {
    apiUrl,
    pageId: nonEmpty(process.env.HOME_PAGE_ID),
    pageSlug: nonEmpty(process.env.WORDPRESS_PAGE_SLUG) ?? "home",
    appUser: nonEmpty(process.env.WORDPRESS_APP_USER),
    appPassword: nonEmpty(process.env.WORDPRESS_APP_PASSWORD),
  };
}

/**
 * Whether the local fixture may be used as a fallback: explicit preview mode
 * or a non-production environment only. Production NEVER falls back to the
 * fictional fixture.
 */
export function isFixtureFallbackAllowed(): boolean {
  if (process.env.PREVIEW_MODE === "true") return true;
  return process.env.NODE_ENV === "development";
}

/** Revalidation tag applied to WordPress fetches for targeted invalidation. */
export const REVALIDATE_TAG = "wordpress-home";

const DEFAULT_REVALIDATE_SECONDS = 3600;

/**
 * Configurable cache revalidation window in seconds.
 * WORDPRESS_REVALIDATE_SECONDS overrides the 3600s default; invalid values
 * fall back to the default. A protected webhook (see
 * /api/revalidate) can invalidate the REVALIDATE_TAG earlier.
 */
export function getRevalidateSeconds(): number {
  const raw = nonEmpty(process.env.WORDPRESS_REVALIDATE_SECONDS);
  if (!raw) return DEFAULT_REVALIDATE_SECONDS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_REVALIDATE_SECONDS;
}

/** Secret that protects the revalidation endpoint. Server-side only. */
export function getRevalidateSecret(): string | undefined {
  return nonEmpty(process.env.REVALIDATE_SECRET);
}

/**
 * Builds the fetch options for a WordPress REST request.
 * Cacheable when unauthenticated; uncacheable (by Next data cache) when an
 * Authorization header is present — documented trade-off.
 */
export function buildWordPressFetchOptions(config: WordPressServerConfig): RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
} {
  const revalidate = getRevalidateSeconds();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  let cached = true;

  if (config.appUser && config.appPassword) {
    // Application password → HTTP Basic auth. Server-side only.
    const token = Buffer.from(
      `${config.appUser}:${config.appPassword}`,
      "utf-8"
    ).toString("base64");
    headers.Authorization = `Basic ${token}`;
    // Next.js data cache skips responses with Authorization headers.
    cached = false;
  }

  return {
    headers,
    ...(cached
      ? { next: { revalidate, tags: [REVALIDATE_TAG] } }
      : { next: { tags: [REVALIDATE_TAG] } }),
    // Mark cache policy explicitly for clarity in diagnostics.
    ...(cached ? {} : { cache: "no-store" as RequestCache }),
  };
}

/**
 * Resolves the REST URL for the configured Home page (id first, slug fallback).
 */
export function buildPageUrl(config: WordPressServerConfig): string {
  const base = `${config.apiUrl.replace(/\/$/, "")}/wp/v2/pages`;
  return config.pageId ? `${base}/${config.pageId}` : `${base}?slug=${encodeURIComponent(config.pageSlug)}`;
}
