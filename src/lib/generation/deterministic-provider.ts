import { createHash } from "crypto";
import { HomeContentSchema, type HomeContent } from "@/types/content";
import type { ContentInventory } from "@/types/inventory";
import type { GeneratedContentDraft } from "@/types/project";
import type { TemplateDefinition } from "@/lib/templates/registry";

/**
 * Deterministic local content-generation provider (Slice 6).
 *
 * Generates a valid `HomeContent` draft from the project brief, approved
 * media, and the selected ready template — with NO network calls and NO
 * invented facts. Testimonials, reviews, ratings, awards, certifications,
 * client lists, revenue figures, guarantees, and regulated professional
 * claims are never generated. Uncertain answers are marked "[For review]".
 */

export interface GenerationMetadata {
  provider: "deterministic-local" | "ai";
  templateId: string;
  templateVersion: string;
  inputHash: string;
  promptVersion: string;
  generatedAt: string;
}

export type ContentGenerationInput = {
  project: { id: string; name: string; slug: string; industry: string };
  brief: {
    businessName: string;
    industry: string;
    offer: string;
    location?: string;
    audience?: string;
    differentiators?: string;
    tone?: string;
    primaryGoal?: string;
    contactDetails?: {
      phone?: string;
      email?: string;
      address?: string;
      website?: string;
    };
  };
  media: Array<{
    id: string;
    kind: "logo" | "photo" | "document" | "reference";
    name: string;
    sourceUrl?: string;
    localPath?: string;
    altText?: string;
    approved: boolean;
  }>;
  template: TemplateDefinition;
  inventory: ContentInventory[];
};

export interface ContentGenerationProvider {
  generateWebsiteDraft(
    input: ContentGenerationInput
  ): Promise<{ content: HomeContent; metadata: GenerationMetadata }>;
}

/** Canonical JSON: sorted keys, stable — same input always hashes the same. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export function computeInputHash(input: ContentGenerationInput): string {
  const canonical = canonicalize({
    brief: input.brief,
    media: input.media,
    templateId: input.template.id,
    templateVersion: input.template.version,
    inventory: input.inventory,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** Split an offer/differentiator blob into neutral service items. */
export function deriveServiceItems(
  offer: string,
  differentiators?: string
): HomeContent["services"]["items"] {
  const sentences = `${offer} ${differentiators ?? ""}`
    .split(/[.;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    .slice(0, 6);

  if (sentences.length === 0) {
    return [
      {
        id: "srv_1",
        title: "Core service",
        description: offer.slice(0, 500),
      },
    ];
  }

  return sentences.map((sentence, idx) => ({
    id: `srv_${idx + 1}`,
    title: sentence.length <= 100 ? sentence : `${sentence.slice(0, 97)}…`,
    description: sentence.slice(0, 500),
  }));
}

export class DeterministicLocalProvider implements ContentGenerationProvider {
  readonly promptVersion = "deterministic-v1";

  async generateWebsiteDraft(
    input: ContentGenerationInput
  ): Promise<{ content: HomeContent; metadata: GenerationMetadata }> {
    const { brief, media, template } = input;

    const approvedPhoto = media.find(
      (m) => m.approved && m.kind === "photo" && (m.sourceUrl || m.localPath)
    );

    const heroImageSource = approvedPhoto?.sourceUrl ?? approvedPhoto?.localPath;
    const heroImage =
      heroImageSource && heroImageSource.startsWith("https://")
        ? {
            url: heroImageSource,
            alt: approvedPhoto?.altText ?? brief.businessName,
          }
        : null;

    const toneLead = brief.tone ? `${brief.tone} — ` : "";
    const heroTitle = `${brief.businessName}: ${
      brief.offer.split(/[.;\n]/)[0]?.trim().slice(0, 80) ??
      "professional services"
    }`.slice(0, 120);

    const contactEmail = brief.contactDetails?.email;
    const contactPhone = brief.contactDetails?.phone;

    const content: HomeContent = {
      hero: {
        eyebrow: brief.industry.slice(0, 120),
        title: heroTitle,
        body: `${toneLead}${brief.offer}`.slice(0, 600),
        primaryCta: {
          label: "Get in touch",
          href: brief.contactDetails?.website?.startsWith("https://")
            ? brief.contactDetails.website
            : "#contact",
        },
        image: heroImage,
      },
      about: {
        eyebrow: brief.location ? `Serving ${brief.location}`.slice(0, 120) : "",
        title: `About ${brief.businessName}`.slice(0, 120),
        body: `Who this is for: ${
          brief.audience ?? "the intended audience described in the brief"
        }. ${brief.offer}`.slice(0, 1000),
      },
      services: {
        eyebrow: "What we do",
        title: "Services",
        items: deriveServiceItems(brief.offer, brief.differentiators),
      },
      faqs: {
        eyebrow: "Questions",
        title: "Frequently asked questions",
        items: [
          {
            id: "faq_1",
            question: `How can I contact ${brief.businessName}?`,
            answer: contactPhone
              ? `Phone: ${contactPhone}${contactEmail ? `, email: ${contactEmail}` : ""}.`
              : "Contact details were not supplied in the brief yet — add them before publishing.",
          },
          {
            id: "faq_2",
            question: "What does this business offer?",
            answer: brief.offer.slice(0, 1000),
          },
          {
            id: "faq_3",
            question: `Where is ${brief.businessName} located?`,
            answer: brief.location
              ? brief.location
              : "[For review] Location was not supplied in the brief — confirm before publishing.",
          },
        ],
      },
      contact: {
        title: `Contact ${brief.businessName}`.slice(0, 120),
        phone: contactPhone ?? "[For review: add phone in the brief]",
        email: contactEmail ?? "review-needed@example.invalid",
        address: brief.contactDetails?.address ?? "",
      },
      footer: {
        copyright: `© ${new Date().getFullYear()} ${brief.businessName}`.slice(
          0,
          200
        ),
      },
    };

    // Hard gate: a complete valid draft or a thrown structured error — never
    // a partially saved invalid draft.
    const parsed = HomeContentSchema.safeParse(content);
    if (!parsed.success) {
      throw new Error(
        `Generated content failed HomeContentSchema validation: ${parsed.error.errors
          .map((e) => `Path [${e.path.join(".")}]: ${e.message}`)
          .join("; ")}`
      );
    }

    return {
      content: parsed.data,
      metadata: {
        provider: "deterministic-local",
        templateId: template.id,
        templateVersion: template.version,
        inputHash: computeInputHash(input),
        promptVersion: this.promptVersion,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

export const deterministicProvider = new DeterministicLocalProvider();

/** Persist a generated draft through a project draft repository. */
export async function saveGeneratedDraft(
  draftRepo: {
    createDraft(input: {
      projectId: string;
      templateId: string;
      content: HomeContent;
      source: GeneratedContentDraft["source"];
      aiPromptVersion?: string;
    }): Promise<GeneratedContentDraft>;
  },
  projectId: string,
  result: { content: HomeContent; metadata: GenerationMetadata }
): Promise<GeneratedContentDraft> {
  return draftRepo.createDraft({
    projectId,
    templateId: result.metadata.templateId,
    content: result.content,
    source: result.metadata.provider === "ai" ? "ai" : "manual",
    aiPromptVersion: `${result.metadata.promptVersion}#${result.metadata.inputHash}`,
  });
}

