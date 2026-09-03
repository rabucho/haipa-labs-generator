import { z } from "zod";

/**
 * Visual Templates Builder contracts (Slice 15).
 *
 * CONSTRAINED builder: only serializable, approved configuration. No raw
 * JSX/HTML/JS, no arbitrary CSS, no external URLs. Every field is validated
 * with strict schemas; section types must map to registered approved
 * renderers; design tokens are restricted to an approved key/value set.
 */

// ── Approved design tokens ──────────────────────────────────────────────

export const APPROVED_TOKEN_KEYS = [
  "--color-primary",
  "--color-primary-hover",
  "--color-accent",
  "--color-bg-light",
  "--color-bg-card",
  "--radius-scale",
  "--button-style",
] as const;

export type ApprovedTokenKey = (typeof APPROVED_TOKEN_KEYS)[number];

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour.");
const ButtonStyle = z.enum(["solid", "outline", "pill"]);
const RadiusScale = z.enum(["sharp", "soft", "round"]);

export const DesignTokensSchema = z
  .object({
    "--color-primary": HexColor.optional(),
    "--color-primary-hover": HexColor.optional(),
    "--color-accent": HexColor.optional(),
    "--color-bg-light": HexColor.optional(),
    "--color-bg-card": HexColor.optional(),
    "--radius-scale": RadiusScale.optional(),
    "--button-style": ButtonStyle.optional(),
  })
  .strict();

export type DesignTokens = z.infer<typeof DesignTokensSchema>;

// ── Sections ────────────────────────────────────────────────────────────

export const APPROVED_SECTION_TYPES = [
  "hero",
  "about",
  "services",
  "faqs",
  "contact",
] as const;

export type ApprovedSectionType = (typeof APPROVED_SECTION_TYPES)[number];

export const SectionInstanceSchema = z
  .object({
    instanceId: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
    sectionType: z.enum(APPROVED_SECTION_TYPES),
    order: z.number().int().min(0).max(20),
    variant: z.enum(["default"]).optional(),
  })
  .strict();

export type SectionInstance = z.infer<typeof SectionInstanceSchema>;

// ── Pages ───────────────────────────────────────────────────────────────

export const PAGE_KEYS_BUILDER = ["home", "about", "services", "faqs", "contact"] as const;

export const BuilderPageSchema = z
  .object({
    pageKey: z.enum(PAGE_KEYS_BUILDER),
    enabled: z.boolean(),
    sections: z.array(SectionInstanceSchema).max(12),
  })
  .strict();

export type BuilderPage = z.infer<typeof BuilderPageSchema>;

// ── Site shell variants ─────────────────────────────────────────────────

export const SiteShellConfigSchema = z
  .object({
    headerVariant: z.enum(["brand-left"]),
    footerVariant: z.enum(["standard"]),
    navigationStyle: z.enum(["inline", "drawer"]),
  })
  .strict();

export type SiteShellConfig = z.infer<typeof SiteShellConfigSchema>;

// ── Builder document ────────────────────────────────────────────────────

export const BuilderDocumentSchema = z
  .object({
    templateVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "Version must be semver-like (major.minor.patch)."),
    designTokens: DesignTokensSchema,
    pages: z.array(BuilderPageSchema).min(1).max(5),
    siteShell: SiteShellConfigSchema,
  })
  .strict();

export type BuilderDocument = z.infer<typeof BuilderDocumentSchema>;

export const DEFAULT_BUILDER_DOCUMENT: BuilderDocument = {
  templateVersion: "1.0.1",
  designTokens: {},
  pages: [
    { pageKey: "home", enabled: true, sections: [
      { instanceId: "sec_hero", sectionType: "hero", order: 0 },
      { instanceId: "sec_about", sectionType: "about", order: 1 },
      { instanceId: "sec_services", sectionType: "services", order: 2 },
    ] },
    { pageKey: "about", enabled: true, sections: [
      { instanceId: "sec_about_page", sectionType: "about", order: 0 },
    ] },
    { pageKey: "services", enabled: true, sections: [
      { instanceId: "sec_services_page", sectionType: "services", order: 0 },
    ] },
    { pageKey: "faqs", enabled: true, sections: [
      { instanceId: "sec_faqs_page", sectionType: "faqs", order: 0 },
    ] },
    { pageKey: "contact", enabled: true, sections: [
      { instanceId: "sec_contact_page", sectionType: "contact", order: 0 },
    ] },
  ],
  siteShell: { headerVariant: "brand-left", footerVariant: "standard", navigationStyle: "inline" },
};

// ── Validation (save/publish gates) ─────────────────────────────────────

export type BuilderValidationIssue = {
  severity: "error" | "warning";
  path: string;
  message: string;
};

const REQUIRED_SECTIONS_BY_PAGE: Record<string, ApprovedSectionType[]> = {
  home: ["hero"],
  about: ["about"],
  services: ["services"],
  faqs: ["faqs"],
  contact: ["contact"],
};

/** Full save/publish validation. Pure and deterministic. */
export function validateBuilderDocument(
  doc: BuilderDocument
): BuilderValidationIssue[] {
  const issues: BuilderValidationIssue[] = [];

  const keys = doc.pages.map((p) => p.pageKey);
  if (new Set(keys).size !== keys.length) {
    issues.push({ severity: "error", path: "pages", message: "Duplicate page keys." });
  }
  const home = doc.pages.find((p) => p.pageKey === "home");
  if (!home || !home.enabled) {
    issues.push({ severity: "error", path: "pages.home", message: "The Home page is required and must stay enabled." });
  }

  for (const page of doc.pages) {
    if (!page.enabled) continue;
    for (const sectionType of REQUIRED_SECTIONS_BY_PAGE[page.pageKey] ?? []) {
      if (!page.sections.some((s) => s.sectionType === sectionType)) {
        issues.push({
          severity: "error",
          path: `pages.${page.pageKey}`,
          message: `Required section "${sectionType}" is missing from the enabled ${page.pageKey} page.`,
        });
      }
    }
    const orders = page.sections.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      issues.push({ severity: "error", path: `pages.${page.pageKey}.sections`, message: "Duplicate section order values." });
    }
    const ids = page.sections.map((s) => s.instanceId);
    if (new Set(ids).size !== ids.length) {
      issues.push({ severity: "error", path: `pages.${page.pageKey}.sections`, message: "Duplicate section instance ids." });
    }
  }

  // Defence in depth against script-like content.
  if (/<script|javascript:|on\w+\s*=/i.test(JSON.stringify(doc))) {
    issues.push({ severity: "error", path: "document", message: "Unsafe script-like content detected." });
  }

  return issues;
}

// ── Semantic version diff ───────────────────────────────────────────────

export type BuilderDiff = {
  pagesAdded: string[];
  pagesRemoved: string[];
  pagesDisabled: string[];
  sectionsAdded: Array<{ pageKey: string; sectionType: string }>;
  sectionsRemoved: Array<{ pageKey: string; sectionType: string }>;
  sectionsReordered: Array<{ pageKey: string; sectionType: string; from: number; to: number }>;
  tokensChanged: Array<{ key: string; from: string; to: string }>;
  shellChanged: boolean;
  /** Existing projects are pinned; migration is always a separate workflow. */
  projectsAffected: "no";
};

export function diffBuilderDocuments(
  source: BuilderDocument,
  next: BuilderDocument
): BuilderDiff {
  const result: BuilderDiff = {
    pagesAdded: [],
    pagesRemoved: [],
    pagesDisabled: [],
    sectionsAdded: [],
    sectionsRemoved: [],
    sectionsReordered: [],
    tokensChanged: [],
    shellChanged: JSON.stringify(source.siteShell) !== JSON.stringify(next.siteShell),
    projectsAffected: "no",
  };

  const sourceByKey = new Map(source.pages.map((p) => [p.pageKey, p]));
  const nextByKey = new Map(next.pages.map((p) => [p.pageKey, p]));
  for (const [key, page] of nextByKey) {
    if (!sourceByKey.has(key)) result.pagesAdded.push(key);
    const src = sourceByKey.get(key);
    if (src && src.enabled && !page.enabled) result.pagesDisabled.push(key);
  }
  for (const [key, page] of sourceByKey) {
    const nxt = nextByKey.get(key);
    if (!nxt) {
      result.pagesRemoved.push(key);
      continue;
    }
    const srcSections = [...page.sections].sort((a, b) => a.order - b.order);
    const nextSections = [...nxt.sections].sort((a, b) => a.order - b.order);
    for (const s of nextSections) {
      if (!srcSections.some((x) => x.instanceId === s.instanceId)) {
        result.sectionsAdded.push({ pageKey: key, sectionType: s.sectionType });
      }
    }
    for (const s of srcSections) {
      if (!nextSections.some((x) => x.instanceId === s.instanceId)) {
        result.sectionsRemoved.push({ pageKey: key, sectionType: s.sectionType });
      }
    }
    for (let i = 0; i < nextSections.length; i++) {
      const srcIdx = srcSections.findIndex((x) => x.instanceId === nextSections[i].instanceId);
      if (srcIdx >= 0 && srcIdx !== i) {
        result.sectionsReordered.push({
          pageKey: key,
          sectionType: nextSections[i].sectionType,
          from: srcIdx,
          to: i,
        });
      }
    }
  }

  for (const key of APPROVED_TOKEN_KEYS) {
    const from = source.designTokens[key];
    const to = next.designTokens[key];
    if (from !== to) {
      result.tokensChanged.push({ key, from: from ?? "(default)", to: to ?? "(default)" });
    }
  }

  return result;
}
