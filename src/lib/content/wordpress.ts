import "server-only";

import { HomeContent } from "@/types/content";
import type {
  WordPressPageResponse,
  WordPressServiceRow,
  WordPressFaqRow,
  WordPressImageValue,
} from "@/types/wordpress";
import { homeFixture } from "@/content/home.fixture";
import { validateHomeContent } from "./validate";
import {
  getWordPressServerConfig,
  isFixtureFallbackAllowed,
  getRevalidateSeconds,
} from "./server-config";
import { WordPressRestContentProvider } from "./provider";

// Site-scoped provider contracts now live in provider.ts (server-only);
// re-exported here for backwards compatibility.
export type {
  SiteContent,
  PageContent,
  PostQuery,
  PostCollection,
  ContentProvider,
  FetchPageResult,
} from "./provider";
export {
  WordPressRestContentProvider,
  redactWordPressResponseShape,
  redactConfig,
} from "./provider";
export {
  REVALIDATE_TAG,
  getRevalidateSeconds,
  getRevalidateSecret,
} from "./server-config";

/**
 * Revalidation window for WordPress-fetched content, in seconds (evaluated at
 * module load). Prefer the live value via getRevalidateSeconds(); a protected
 * webhook (/api/revalidate) can invalidate the REVALIDATE_TAG earlier.
 */
export const WORDPRESS_REVALIDATE_SECONDS = getRevalidateSeconds();

/**
 * Normalizes a WordPress/ACF image representation into a consistent internal
 * image object. Handles WP array/object shapes, raw string URLs, and nulls.
 *
 * NOTE on numeric ACF ids: when an ACF image field uses the "ID" return
 * format the REST response contains a number, which cannot be resolved to a
 * URL without extra media requests. The approved field definition sets
 * return_format "array"; ID-format responses normalize to null.
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

export type HomeContentErrorReason =
  | "missing-config"
  | "http-error"
  | "empty-response"
  | "network-error"
  | "validation-error"
  | "unexpected";

export type GetHomeContentResult =
  | {
      status: "ok";
      content: HomeContent;
      source: "wordpress" | "fixture" | "last-known-good";
    }
  | {
      status: "error";
      reason: HomeContentErrorReason;
      message: string;
      details: string[];
    };

function wordpressFailure(
  reason: HomeContentErrorReason,
  message: string,
  details: string[]
): GetHomeContentResult {
  if (lastKnownGood) {
    return {
      status: "ok",
      content: lastKnownGood.content,
      source: "last-known-good",
    };
  }
  return { status: "error", reason, message, details };
}

/**
 * Resolves homepage content with the following policy:
 *
 * 1. No WORDPRESS_API_URL configured:
 *    - development / PREVIEW_MODE=true → render the local fixture.
 *    - production → fail with a clear branded configuration error.
 * 2. WordPress configured but unreachable / empty / invalid:
 *    - serve the last-known-good validated snapshot if one exists.
 *    - otherwise fail with a safe error state. The fictional fixture is
 *      NEVER rendered for a configured-but-failing production source.
 */
export async function getHomeContent(): Promise<GetHomeContentResult> {
  const config = getWordPressServerConfig();

  if (!config) {
    if (isFixtureFallbackAllowed()) {
      return { status: "ok", content: homeFixture, source: "fixture" };
    }
    return {
      status: "error",
      reason: "missing-config",
      message:
        "Haipa Labs configuration error: WORDPRESS_API_URL is not set. " +
        "This site cannot render live content in production without a configured WordPress source.",
      details: [
        "Set WORDPRESS_API_URL (and optionally HOME_PAGE_ID or WORDPRESS_PAGE_SLUG) in the environment, " +
          "or run with NODE_ENV=development / PREVIEW_MODE=true to use local fixture content.",
      ],
    };
  }

  const provider = new WordPressRestContentProvider(config);
  const fetched = await provider.fetchHomePage();

  if (!fetched.ok) {
    return wordpressFailure(
      fetched.reason,
      `WordPress content is unavailable (${fetched.reason}).`,
      [fetched.detail]
    );
  }

  try {
    const mapped = mapWordPressHome(fetched.raw);
    const validation = validateHomeContent(mapped);

    if (!validation.success) {
      return wordpressFailure(
        "validation-error",
        "WordPress content failed schema validation (missing or malformed required fields).",
        validation.details
      );
    }

    lastKnownGood = { content: validation.data, fetchedAt: new Date().toISOString() };
    return { status: "ok", content: validation.data, source: "wordpress" };
  } catch (error) {
    return wordpressFailure(
      "unexpected",
      "An unexpected error occurred while mapping WordPress content.",
      [String(error)]
    );
  }
}


