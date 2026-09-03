import { z } from "zod";
import {
  BuilderDocumentSchema,
  type BuilderDocument,
} from "@/types/builder";

/**
 * AI template-proposal contracts (Slice 16, Stages B–C). Pure module.
 *
 * The AI may propose a BuilderDocument. Proposals are UNTRUSTED: strict
 * schemas, registry-backed section types, approved token values, unknown
 * keys rejected. Output never contains JSX/HTML/JS/CSS/URLs/paths — the
 * schema shape plus downstream `validateBuilderDocument` enforce this.
 */

export const TEMPLATE_PROPOSAL_PROMPT_VERSION = "template-proposal-v1";

// ── Request ─────────────────────────────────────────────────────────────

export const TemplateProposalRequestSchema = z
  .object({
    familyKey: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    displayName: z.string().min(1).max(80),
    industry: z.string().max(80).optional(),
    audience: z.string().max(200).optional(),
    designDirection: z.string().max(500).optional(),
    requiredPages: z
      .array(z.enum(["home", "about", "services", "faqs", "contact"]))
      .min(1),
    providerId: z.enum(["ai", "ollama", "gemini", "openrouter"]),
    modelId: z.string().max(120).optional(),
    sourceVersionId: z.string().max(80).optional(),
  })
  .strict();

export type TemplateProposalRequest = z.infer<typeof TemplateProposalRequestSchema>;

// ── Output schema (strict) ──────────────────────────────────────────────

export const TemplateProposalOutputSchema = z
  .object({
    document: BuilderDocumentSchema,
    rationale: z.string().max(2000),
  })
  .strict();

export type TemplateProposalOutput = z.infer<typeof TemplateProposalOutputSchema>;

export const PROPOSAL_SYSTEM_PROMPT = [
  "You propose website template structure for an approved React component library.",
  "Return a BuilderDocument JSON object exactly matching the supplied schema.",
  "Use ONLY these section types: hero, about, services, faqs, contact.",
  "Use ONLY the approved design-token keys and values shown in the schema.",
  "Do NOT output JSX, HTML, CSS source code, JavaScript, URLs, or file paths.",
  "Do NOT include testimonials, reviews, ratings, awards, certifications, statistics, prices, or contact details.",
  "Keep the Home page enabled and include a hero section.",
  "Return JSON only — no Markdown fences, no explanatory prose outside the JSON rationale field.",
].join(" ");

/** Bounded, privacy-safe proposal input (no secrets, paths, client content). */
export function buildProposalInput(
  request: TemplateProposalRequest,
  baseline: BuilderDocument
): { bounded: unknown; json: string } {
  const bounded = {
    promptVersion: TEMPLATE_PROPOSAL_PROMPT_VERSION,
    displayName: request.displayName,
    industry: request.industry,
    audience: request.audience,
    designDirection: request.designDirection,
    requiredPages: request.requiredPages,
    baseline: {
      templateVersion: baseline.templateVersion,
      pages: baseline.pages.map((p) => ({
        pageKey: p.pageKey,
        enabled: p.enabled,
        sections: p.sections.map((s) => s.sectionType),
      })),
      siteShell: baseline.siteShell,
      approvedTokenKeys: [
        "--color-primary",
        "--color-primary-hover",
        "--color-accent",
        "--color-bg-light",
        "--color-bg-card",
        "--radius-scale",
        "--button-style",
      ],
    },
  };
  const json = JSON.stringify(bounded);
  if (json.length > 20000) {
    throw new Error("Proposal input exceeds the bounded size (20000 chars).");
  }
  return { bounded, json };
}

/** JSON schema handed to structured-output transports. */
export function proposalJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["document", "rationale"],
    properties: {
      document: { type: "object" },
      rationale: { type: "string" },
    },
  };
}

/** Parse text-mode responses defensively (no permissive repair). */
export function parseProposalJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  return JSON.parse(trimmed);
}
