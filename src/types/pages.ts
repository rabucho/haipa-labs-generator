import { z } from "zod";
import type { HomeContent } from "./content";

/**
 * Multi-page content contracts (Slice 12, Stage B).
 *
 * A template defines a manifest of pages; each page has its own strict
 * schema, editable inventory, renderer, and WordPress mapping. Legacy
 * Home-only drafts remain valid: the `SiteContent` envelope is derived at
 * render time from `HomeContent` (schemaVersion "1.0") or stored page-keyed
 * ("2.0") — stored drafts are never silently mutated.
 */

export const PAGE_KEYS = ["home", "about", "services", "faqs", "contact", "shop"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export const SITE_CONTENT_SCHEMA_VERSION = "2.0";

// ── Page content schemas (strict, no unknown keys) ──────────────────────

export const AboutPageSchema = z.object({
  eyebrow: z.string().max(120),
  title: z.string().min(1, "About title is required").max(120),
  body: z.string().min(1, "About body is required").max(1000),
}).strict();

export const ServicesPageSchema = z.object({
  eyebrow: z.string().max(120),
  title: z.string().min(1, "Services title is required").max(120),
  items: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        href: z.string().max(500).optional(),
      })
    )
    .max(12, "Maximum 12 services allowed"),
}).strict();

export const FaqsPageSchema = z.object({
  eyebrow: z.string().max(120),
  title: z.string().min(1, "FAQs title is required").max(120),
  items: z
    .array(
      z.object({
        id: z.string(),
        question: z.string().min(1).max(200),
        answer: z.string().min(1).max(1000),
      })
    )
    .max(20, "Maximum 20 FAQs allowed"),
}).strict();

export const ContactPageSchema = z.object({
  title: z.string().min(1, "Contact title is required").max(120),
  phone: z.string().min(1, "Contact phone is required").max(40),
  email: z.string().min(1, "Contact email is required").email().max(100),
  address: z.string().max(300),
}).strict();

export type AboutPageContent = z.infer<typeof AboutPageSchema>;
export type ServicesPageContent = z.infer<typeof ServicesPageSchema>;
export type FaqsPageContent = z.infer<typeof FaqsPageSchema>;
export type ContactPageContent = z.infer<typeof ContactPageSchema>;

// ── SiteContent envelope (v2) ───────────────────────────────────────────

export const SiteContentSchema = z.object({
  templateKey: z.string().min(1),
  templateVersion: z.string().min(1),
  schemaVersion: z.literal(SITE_CONTENT_SCHEMA_VERSION),
  pages: z.object({
    home: z.custom<HomeContent>(() => true),
    about: AboutPageSchema,
    services: ServicesPageSchema,
    faqs: FaqsPageSchema,
    contact: ContactPageSchema,
    shop: z.unknown().optional(),
  }),
});

export type SiteContent = z.infer<typeof SiteContentSchema>;

/**
 * Compatibility adapter: derive a v2 SiteContent view from a legacy
 * Home-only draft. Read-only — the stored draft is never rewritten.
 */
export function siteContentFromHomeContent(
  home: HomeContent,
  templateKey: string,
  templateVersion: string
): SiteContent {
  return {
    templateKey,
    templateVersion,
    schemaVersion: SITE_CONTENT_SCHEMA_VERSION,
    pages: {
      home,
      about: home.about,
      services: home.services,
      faqs: home.faqs,
      contact: home.contact,
    },
  };
}

// ── Page manifest contract ──────────────────────────────────────────────

export type PageDefinition = {
  pageKey: PageKey;
  route: string;
  displayName: string;
  enabledByDefault: boolean;
  /** Required pages cannot be disabled (Home is required). */
  required: boolean;
  /** WooCommerce capability gate — Shop only ever renders when enabled. */
  requiresCapability: "none" | "woocommerce";
};

/**
 * Route manifest for the professional-services template. The Shop page is a
 * capability only: it is absent from navigation, inventory, exports, and
 * generated content unless the project explicitly enables WooCommerce with a
 * verified catalog source.
 */
export const PAGE_MANIFEST: PageDefinition[] = [
  { pageKey: "home", route: "/", displayName: "Home", enabledByDefault: true, required: true, requiresCapability: "none" },
  { pageKey: "about", route: "/about", displayName: "About", enabledByDefault: true, required: false, requiresCapability: "none" },
  { pageKey: "services", route: "/services", displayName: "Services", enabledByDefault: true, required: false, requiresCapability: "none" },
  { pageKey: "faqs", route: "/faqs", displayName: "FAQs", enabledByDefault: true, required: false, requiresCapability: "none" },
  { pageKey: "contact", route: "/contact", displayName: "Contact", enabledByDefault: true, required: false, requiresCapability: "none" },
  { pageKey: "shop", route: "/shop", displayName: "Shop", enabledByDefault: false, required: false, requiresCapability: "woocommerce" },
];

/** Pages visible in navigation/previews for the given capability flags. */
export function enabledPages(options: {
  woocommerce?: boolean;
}): PageDefinition[] {
  return PAGE_MANIFEST.filter((page) => {
    if (page.requiresCapability === "woocommerce") {
      return options.woocommerce === true;
    }
    return page.enabledByDefault;
  });
}

export function isPageKey(value: string): value is PageKey {
  return (PAGE_KEYS as readonly string[]).includes(value);
}
