import { z } from "zod";
import { type HomeContent } from "@/types/content";
import type { ContentGenerationInput } from "./deterministic-provider";

/**
 * Explicit AI response schema (Slice 7) — a narrow generation contract that
 * is mapped into `HomeContent` by a pure adapter. Strict mode rejects extra
 * properties, so the AI cannot smuggle JSX/HTML/paths/arbitrary keys through.
 *
 * Every field is REQUIRED in the AI response (JSON-schema strict mode), with
 * empty strings permitted where the brief lacks information — the adapter and
 * HomeContentSchema decide what is acceptable.
 */

/** Plain-text guard applied AFTER min/max sizing. */
function NonExecutable(s: z.ZodString) {
  return s.refine(
    (value) => !/[<>{}]|<\/?[a-z]|function |javascript:/i.test(value),
    {
      message: "Value must be plain text (no HTML, JSX, code, or scripts)",
    }
  );
}

const AiImageSchema = z
  .object({
    url: z.string().max(500),
    alt: z.string().max(160),
  })
  .strict();

export const AiHomeContentSchema = z
  .object({
    hero: z
      .object({
        eyebrow: NonExecutable(z.string().max(120)),
        title: NonExecutable(z.string().min(1).max(120)),
        body: NonExecutable(z.string().min(1).max(600)),
        primaryCta: z
          .object({
            label: NonExecutable(z.string().min(1).max(60)),
            href: z.string().max(500),
          })
          .strict(),
        image: AiImageSchema.nullable(),
      })
      .strict(),
    about: z
      .object({
        eyebrow: NonExecutable(z.string().max(120)),
        title: NonExecutable(z.string().min(1).max(120)),
        body: NonExecutable(z.string().min(1).max(1000)),
      })
      .strict(),
    services: z
      .object({
        eyebrow: NonExecutable(z.string().max(120)),
        title: NonExecutable(z.string().min(1).max(120)),
        items: z
          .array(
            z
              .object({
                title: NonExecutable(z.string().min(1).max(100)),
                description: NonExecutable(z.string().min(1).max(500)),
              })
              .strict()
          )
          .min(1)
          .max(12),
      })
      .strict(),
    faqs: z
      .object({
        eyebrow: NonExecutable(z.string().max(120)),
        title: NonExecutable(z.string().min(1).max(120)),
        items: z
          .array(
            z
              .object({
                question: NonExecutable(z.string().min(1).max(200)),
                answer: NonExecutable(z.string().min(1).max(1000)),
              })
              .strict()
          )
          .min(1)
          .max(20),
      })
      .strict(),
    contact: z
      .object({
        title: NonExecutable(z.string().min(1).max(120)),
        phone: NonExecutable(z.string().max(40)),
        email: z.string().max(100),
        address: NonExecutable(z.string().max(300)),
      })
      .strict(),
    footer: z
      .object({ copyright: NonExecutable(z.string().min(1).max(200)) })
      .strict(),
  })
  .strict();

export type AiHomeContent = z.infer<typeof AiHomeContentSchema>;

/** Section keys eligible for targeted regeneration (approved inventory paths). */
export const REGENERATABLE_SECTIONS = [
  "hero",
  "about",
  "services",
  "faqs",
  "contact",
  "footer",
] as const;
export type RegeneratableSection = (typeof REGENERATABLE_SECTIONS)[number];

export const SectionSchemas: Record<RegeneratableSection, z.ZodTypeAny> = {
  hero: AiHomeContentSchema.shape.hero,
  about: AiHomeContentSchema.shape.about,
  services: AiHomeContentSchema.shape.services,
  faqs: AiHomeContentSchema.shape.faqs,
  contact: AiHomeContentSchema.shape.contact,
  footer: AiHomeContentSchema.shape.footer,
};

/** JSON Schema for OpenAI-compatible strict structured output. */
export function homeContentJsonSchema(): Record<string, unknown> {
  const text = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["hero", "about", "services", "faqs", "contact", "footer"],
    properties: {
      hero: {
        type: "object",
        additionalProperties: false,
        required: ["eyebrow", "title", "body", "primaryCta", "image"],
        properties: {
          eyebrow: text,
          title: text,
          body: text,
          primaryCta: {
            type: "object",
            additionalProperties: false,
            required: ["label", "href"],
            properties: { label: text, href: text },
          },
          image: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["url", "alt"],
                properties: { url: text, alt: text },
              },
              { type: "null" },
            ],
          },
        },
      },
      about: {
        type: "object",
        additionalProperties: false,
        required: ["eyebrow", "title", "body"],
        properties: { eyebrow: text, title: text, body: text },
      },
      services: {
        type: "object",
        additionalProperties: false,
        required: ["eyebrow", "title", "items"],
        properties: {
          eyebrow: text,
          title: text,
          items: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description"],
              properties: { title: text, description: text },
            },
          },
        },
      },
      faqs: {
        type: "object",
        additionalProperties: false,
        required: ["eyebrow", "title", "items"],
        properties: {
          eyebrow: text,
          title: text,
          items: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["question", "answer"],
              properties: { question: text, answer: text },
            },
          },
        },
      },
      contact: {
        type: "object",
        additionalProperties: false,
        required: ["title", "phone", "email", "address"],
        properties: { title: text, phone: text, email: text, address: text },
      },
      footer: {
        type: "object",
        additionalProperties: false,
        required: ["copyright"],
        properties: { copyright: text },
      },
    },
  };
}

/** Resolve an approved media URL for an image reference, or null. */
function normalizeImage(
  image: AiHomeContent["hero"]["image"],
  input: ContentGenerationInput
): HomeContent["hero"]["image"] {
  if (!image) return null;
  const url = image.url.trim();
  const approvedUrls = input.media
    .filter((m) => m.approved)
    .map((m) => m.sourceUrl)
    .filter((u): u is string => Boolean(u));
  // Only approved https media references may be rendered.
  if (!url.startsWith("https://") || !approvedUrls.includes(url)) {
    return null;
  }
  return { url, alt: image.alt.slice(0, 160) };
}

/**
 * Pure adapter: validated AI output → HomeContent.
 * - normalizes service/FAQ IDs (stable, index-based);
 * - keeps only "#contact" or the brief's own https website as the CTA href;
 * - keeps only approved https image references;
 * - contact details come ONLY from the brief (AI-invented contact data is
 *   replaced with "[For review]" markers).
 */
export function mapAiResponseToHomeContent(
  ai: AiHomeContent,
  input: ContentGenerationInput
): HomeContent {
  const brief = input.brief;

  const briefWebsite = brief.contactDetails?.website;
  const ctaHref =
    ai.hero.primaryCta.href.startsWith("#") ||
    (briefWebsite && ai.hero.primaryCta.href === briefWebsite)
      ? ai.hero.primaryCta.href
      : "#contact";

  const email = brief.contactDetails?.email ?? "";
  const phone = brief.contactDetails?.phone ?? "";
  const address = brief.contactDetails?.address ?? "";

  return {
    hero: {
      eyebrow: ai.hero.eyebrow,
      title: ai.hero.title,
      body: ai.hero.body,
      primaryCta: { label: ai.hero.primaryCta.label, href: ctaHref },
      image: normalizeImage(ai.hero.image, input),
    },
    about: ai.about,
    services: {
      eyebrow: ai.services.eyebrow,
      title: ai.services.title,
      items: ai.services.items.map((item, idx) => ({
        id: `srv_${idx + 1}`,
        title: item.title,
        description: item.description,
      })),
    },
    faqs: {
      eyebrow: ai.faqs.eyebrow,
      title: ai.faqs.title,
      items: ai.faqs.items.map((item, idx) => ({
        id: `faq_${idx + 1}`,
        question: item.question,
        answer: item.answer,
      })),
    },
    contact: {
      title: ai.contact.title,
      phone: phone || "[For review: add phone in the brief]",
      email: email || "review-needed@example.invalid",
      address,
    },
    footer: ai.footer,
  };
}

/** Strip Markdown fences defensively, then parse JSON. */
export function parseAiJsonResponse(raw: string): unknown {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}


