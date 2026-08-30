import { HomeContent } from "@/types/content";
import type {
  WordPressPageResponse,
  WordPressServiceRow,
  WordPressFaqRow,
  WordPressImageValue,
} from "@/types/wordpress";
import { homeFixture } from "@/content/home.fixture";
import { validateHomeContent } from "./validate";

/**
 * Revalidation window for WordPress-fetched content, in seconds.
 * Configurable via WORDPRESS_REVALIDATE_SECONDS; defaults to 1 hour.
 *
 * NOTE: A future slice will add protected on-demand revalidation triggered
 * by a WordPress publish webhook, making this interval a safety net only.
 */
export const WORDPRESS_REVALIDATE_SECONDS = Number(
  process.env.WORDPRESS_REVALIDATE_SECONDS ?? 3600
);

/**
 * When true, the local fixture may be used as a fallback (development and
 * explicit preview mode only). In production the fixture is NEVER rendered
 * for a configured-but-failing WordPress source.
 */
function fixtureFallbackAllowed(): boolean {
  if (process.env.PREVIEW_MODE === "true") return true;
  return process.env.NODE_ENV === "development";
}

// Stub types for the general ContentProvider interface (site-scoped for
// future multi-tenancy; tenant authentication arrives in a later slice).
export type SiteContent = { id: string; name: string };
export type PageContent = { id: string; slug: string; content: unknown };
export type PostQuery = { limit?: number; category?: string };
export type PostCollection = { posts: Array<{ id: string; title: string }> };

export interface ContentProvider {
  getSite(siteKey: string): Promise<SiteContent>;
  getPage(siteKey: string, slug: string): Promise<PageContent>;
  getPosts?(siteKey: string, options?: PostQuery): Promise<PostCollection>;
  updatePage?(siteKey: string, slug: string, content: PageContent): Promise<void>;
  publish?(siteKey: string, slug: string): Promise<void>;
}

/** The reason the fixture or an error state was shown instead of live content. */
export type HomeContentSource =
  | { kind: "wordpress"; content: HomeContent }
  | { kind: "fixture"; content: HomeContent }
  | { kind: "last-known-good"; content: HomeContent; fetchedAt: string }
  | { kind: "error"; message: string; details: string[] };

/**
 * Normalizes a WordPress/ACF image representation into a consistent internal
 * image object. Handles WP array/object shapes, raw string URLs, and nulls.
 */
export function normalizeImage(
  value: WordPressImageValue
): { url: string; alt: string } | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value ? { url: value, alt: "" } : null;
  }

  if (typeof value === "object") {
    const image = value as { url?: unknown; alt?: unknown; title?: unknown };
    const url = typeof image.url === "string" ? image.url : "";
    const alt =
      typeof image.alt === "string"
        ? image.alt
        : typeof image.title === "string"
          ? image.title
          : "";
    return url ? { url, alt } : null;
  }

  return null;
}

/**
 * Generates stable IDs for repeater rows: preserves a supplied `id`, otherwise
 * derives a deterministic one from the row index (never random, so repeated
 * fetches produce identical output).
 */
function stableRowId(rawId: unknown, prefix: string, index: number): string {
  if (typeof rawId === "string" && rawId.length > 0) return rawId;
  return `${prefix}_${index + 1}`;
}

/**
 * Pure WordPress Adapter for the Home page.
 * Takes a raw WordPress REST API page response and maps it strictly into the
 * internal HomeContent schema.
 *
 * DEFAULT POLICY: only genuinely optional fields (eyebrows, address, optional
 * links, hero image) receive safe defaults. Required business fields are
 * passed through as-is (empty string if missing) so that the Zod schema's
 * `.min(1)` checks FAIL validation — a missing client title or contact email
 * is never silently replaced with generic copy.
 *
 * Under no circumstances do components read raw ACF values directly.
 */
export function mapWordPressHome(raw: WordPressPageResponse): HomeContent {
  const acf = raw?.acf ?? {};

  const rawServices = Array.isArray(acf.services)
    ? (acf.services as WordPressServiceRow[])
    : [];
  const services = rawServices.map((item, idx) => ({
    id: stableRowId(item?.id, "wp_srv", idx),
    title: typeof item?.services_title === "string" ? item.services_title : "",
    description:
      typeof item?.services_description === "string"
        ? item.services_description
        : "",
    href:
      typeof item?.services_url === "string" && item.services_url.length > 0
        ? item.services_url
        : undefined,
  }));

  const rawFaqs = Array.isArray(acf.faqs)
    ? (acf.faqs as WordPressFaqRow[])
    : [];
  const faqs = rawFaqs.map((item, idx) => ({
    id: stableRowId(item?.id, "wp_faq", idx),
    question: typeof item?.faqs_question === "string" ? item.faqs_question : "",
    answer: typeof item?.faqs_answer === "string" ? item.faqs_answer : "",
  }));

  return {
    hero: {
      eyebrow: typeof acf.hero_eyebrow === "string" ? acf.hero_eyebrow : "",
      title: typeof acf.hero_title === "string" ? acf.hero_title : "",
      body: typeof acf.hero_text === "string" ? acf.hero_text : "",
      primaryCta: {
        label: typeof acf.hero_button_text === "string" ? acf.hero_button_text : "",
        href: typeof acf.hero_button_url === "string" ? acf.hero_button_url : "",
      },
      image: normalizeImage(acf.hero_image),
    },
    about: {
      eyebrow: typeof acf.about_eyebrow === "string" ? acf.about_eyebrow : "",
      title: typeof acf.about_title === "string" ? acf.about_title : "",
      body: typeof acf.about_text === "string" ? acf.about_text : "",
    },
    services: {
      eyebrow:
        typeof acf.services_section_eyebrow === "string"
          ? acf.services_section_eyebrow
          : "",
      title:
        typeof acf.services_section_title === "string"
          ? acf.services_section_title
          : "",
      items: services,
    },
    faqs: {
      eyebrow:
        typeof acf.faqs_section_eyebrow === "string"
          ? acf.faqs_section_eyebrow
          : "",
      title:
        typeof acf.faqs_section_title === "string" ? acf.faqs_section_title : "",
      items: faqs,
    },
    contact: {
      title: typeof acf.contact_title === "string" ? acf.contact_title : "",
      phone: typeof acf.contact_phone === "string" ? acf.contact_phone : "",
      email: typeof acf.contact_email === "string" ? acf.contact_email : "",
      address: typeof acf.contact_address === "string" ? acf.contact_address : "",
    },
    footer: {
      copyright:
        typeof acf.footer_copyright === "string" ? acf.footer_copyright : "",
    },
  };
}

/**
 * In-memory last-known-good snapshot of validated WordPress content.
 * A future slice will persist this durably per site; for now it survives
 * within a single server process so a transient WordPress failure does not
 * take down a page that previously rendered successfully.
 */
let lastKnownGood: { content: HomeContent; fetchedAt: string } | null = null;

/** Test hook: clears the in-memory last-known-good snapshot. */
export function resetLastKnownGood(): void {
  lastKnownGood = null;
}

export type GetHomeContentResult =
  | { status: "ok"; content: HomeContent; source: "wordpress" | "fixture" | "last-known-good" }
  | { status: "error"; message: string; details: string[] };

/**
 * Resolves homepage content with the following policy:
 *
 * 1. No WORDPRESS_API_URL configured:
 *    - development / PREVIEW_MODE=true → render the local fixture.
 *    - production → fail with a clear branded configuration error.
 * 2. WordPress configured but unreachable / invalid / failing validation:
 *    - serve the last-known-good validated snapshot if one exists.
 *    - otherwise fail with a safe error state. The fictional fixture is
 *      NEVER rendered for a configured-but-failing production source.
 */
export async function getHomeContent(): Promise<GetHomeContentResult> {
  const apiUrl = process.env.WORDPRESS_API_URL;
  const pageId = process.env.HOME_PAGE_ID;

  if (!apiUrl) {
    if (fixtureFallbackAllowed()) {
      return { status: "ok", content: homeFixture, source: "fixture" };
    }
    return {
      status: "error",
      message:
        "Haipa Labs configuration error: WORDPRESS_API_URL is not set. " +
        "This site cannot render live content in production without a configured WordPress source.",
      details: [
        "Set WORDPRESS_API_URL (and optionally HOME_PAGE_ID) in the environment, " +
          "or run with NODE_ENV=development / PREVIEW_MODE=true to use local fixture content.",
      ],
    };
  }

  try {
    const url = pageId
      ? `${apiUrl}/wp/v2/pages/${pageId}`
      : `${apiUrl}/wp/v2/pages?slug=home`;

    const res = await fetch(url, {
      next: { revalidate: WORDPRESS_REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      return wordpressFailure(
        `WordPress request failed with status ${res.status}.`,
        [`Request URL: ${url}`, `HTTP status: ${res.status}`]
      );
    }

    const json: unknown = await res.json();
    const rawPage: WordPressPageResponse | undefined = Array.isArray(json)
      ? (json[0] as WordPressPageResponse | undefined)
      : (json as WordPressPageResponse);

    if (!rawPage) {
      return wordpressFailure(
        "No page found in the WordPress API response.",
        ["The response contained no page object for the requested slug/id."]
      );
    }

    const mapped = mapWordPressHome(rawPage);
    const validation = validateHomeContent(mapped);

    if (!validation.success) {
      return wordpressFailure(
        "WordPress content failed schema validation (missing or malformed required fields).",
        validation.details
      );
    }

    lastKnownGood = { content: validation.data, fetchedAt: new Date().toISOString() };
    return { status: "ok", content: validation.data, source: "wordpress" };
  } catch (error) {
    return wordpressFailure(
      "An unexpected error occurred while fetching or parsing WordPress data.",
      [String(error)]
    );
  }
}

function wordpressFailure(message: string, details: string[]): GetHomeContentResult {
  if (lastKnownGood) {
    return {
      status: "ok",
      content: lastKnownGood.content,
      source: "last-known-good",
    };
  }
  return { status: "error", message, details };
}