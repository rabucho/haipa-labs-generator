import { z } from "zod";
import {
  BuilderDocumentSchema,
  type BuilderDocument,
  type DesignTokens,
} from "@/types/builder";

/**
 * Blank-template creation (Slice 16, Stage A).
 *
 * A blank template is a blank DESIGN STRUCTURE — never blank/invented client
 * content. The operator selects required pages, approved sections, and
 * approved tokens; the resulting document passes the same strict validation
 * as any builder document. Shop is capability-gated server-side.
 */

export const BlankTemplateInputSchema = z
  .object({
    familyKey: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/, "Family key: lowercase letters, numbers, hyphens."),
    displayName: z.string().min(1).max(80),
    description: z.string().max(300).optional(),
    enabledPages: z
      .array(z.enum(["home", "about", "services", "faqs", "contact"]))
      .min(1)
      .max(5),
    includeShop: z.boolean().optional(),
    designTokens: z
      .object({
        "--color-primary": z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        "--color-primary-hover": z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        "--color-accent": z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        "--color-bg-light": z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        "--color-bg-card": z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        "--radius-scale": z.enum(["sharp", "soft", "round"]).optional(),
        "--button-style": z.enum(["solid", "outline", "pill"]).optional(),
      })
      .strict()
      .optional(),
    siteShell: z
      .object({
        headerVariant: z.enum(["brand-left"]).optional(),
        footerVariant: z.enum(["standard"]).optional(),
        navigationStyle: z.enum(["inline", "drawer"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type BlankTemplateInput = z.infer<typeof BlankTemplateInputSchema>;

const DEFAULT_SECTIONS: Record<string, Array<{ instanceId: string; sectionType: string }>> = {
  home: [
    { instanceId: "sec_hero", sectionType: "hero" },
    { instanceId: "sec_about", sectionType: "about" },
    { instanceId: "sec_services", sectionType: "services" },
  ],
  about: [{ instanceId: "sec_about_page", sectionType: "about" }],
  services: [{ instanceId: "sec_services_page", sectionType: "services" }],
  faqs: [{ instanceId: "sec_faqs_page", sectionType: "faqs" }],
  contact: [{ instanceId: "sec_contact_page", sectionType: "contact" }],
};

export class BlankTemplateError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(" "));
  }
}

/**
 * Build a validated blank document. Throws BlankTemplateError when Shop is
 * requested without the configured capability or Home is missing.
 */
export function buildBlankDocument(input: BlankTemplateInput): BuilderDocument {
  const errors: string[] = [];
  const woocommerceConfigured = process.env.WOOCOMMERCE_ENABLED === "true";
  if (input.includeShop && !woocommerceConfigured) {
    errors.push(
      "Shop requires the WooCommerce capability (WOOCOMMERCE_ENABLED=true) and a verified catalog source."
    );
  }
  if (!input.enabledPages.includes("home")) {
    errors.push("The Home page is required and must stay enabled.");
  }
  if (errors.length > 0) throw new BlankTemplateError(errors);

  const pages = ["home", "about", "services", "faqs", "contact"]
    .filter(
      (key) =>
        key === "home" || input.enabledPages.includes(key as "about")
    )
    .map((pageKey) => ({
      pageKey: pageKey as "home",
      enabled: input.enabledPages.includes(pageKey as "home"),
      sections: (DEFAULT_SECTIONS[pageKey] ?? []).map((s, i) => ({
        instanceId: s.instanceId,
        sectionType: s.sectionType as "hero",
        order: i,
      })),
    }));

  const document: BuilderDocument = {
    templateVersion: "1.0.0",
    designTokens: (input.designTokens ?? {}) as DesignTokens,
    pages,
    siteShell: {
      headerVariant: input.siteShell?.headerVariant ?? "brand-left",
      footerVariant: input.siteShell?.footerVariant ?? "standard",
      navigationStyle: input.siteShell?.navigationStyle ?? "inline",
    },
  };

  const parsed = BuilderDocumentSchema.safeParse(document);
  if (!parsed.success) {
    throw new BlankTemplateError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    );
  }
  return parsed.data;
}
