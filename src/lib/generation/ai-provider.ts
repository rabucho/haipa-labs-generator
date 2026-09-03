import "server-only";

import { HomeContentSchema, type HomeContent } from "@/types/content";
import {
  AiHomeContentSchema,
  SectionSchemas,
  REGENERATABLE_SECTIONS,
  type RegeneratableSection,
  homeContentJsonSchema,
  mapAiResponseToHomeContent,
  parseAiJsonResponse,
} from "./ai-content-schema";
import {
  type ContentGenerationInput,
  type ContentGenerationProvider,
  type GenerationMetadata,
  computeInputHash,
} from "./deterministic-provider";
import {
  getAiGenerationConfig,
  isTransientStatus,
  type ProviderRuntimeConfig,
} from "./config";

/**
 * Server-only real AI content-generation provider (Slice 7).
 *
 * One OpenAI-compatible structured-output request per full draft, strict JSON
 * schema mode. Configured entirely from server environment variables
 * (config.ts). Never imported by client components; never exposes
 * credentials, raw prompts, or raw provider responses to the browser.
 *
 * PROMPT VERSION: ai-content-v1 (recorded in metadata and audit records).
 */

export const AI_CONTENT_PROMPT_VERSION = "ai-content-v1";

const SYSTEM_PROMPT = [
  "You generate website content for an approved React template.",
  "Generate content for the supplied business brief ONLY.",
  "Follow the supplied HomeContent JSON schema exactly.",
  "Use only facts present in the brief and approved media metadata.",
  'When required information is missing, use the placeholder "[For review]" in the relevant field.',
  "Do NOT invent testimonials, reviews, ratings, awards, certifications, client names, revenue figures, guarantees, licenses, accreditations, performance statistics, or regulatory claims.",
  "Do NOT invent phone numbers, email addresses, physical addresses, URLs, opening hours, prices, or service promises.",
  "Do NOT reproduce copyrighted copy from reference websites.",
  "Do NOT change design, template structure, component names, CSS, or routes.",
  "Write concise, professional copy appropriate for a Kenyan business unless the brief specifies otherwise.",
  "Preserve the client's real brand name and supplied contact details exactly where appropriate.",
  "Return JSON only — no Markdown fences, no explanatory prose.",
].join(" ");

const SECTION_PROMPTS: Record<RegeneratableSection, string> = {
  hero: "Regenerate ONLY the hero section (eyebrow, title, body, primaryCta label, and a nullable image reference chosen from the approved media list).",
  about: "Regenerate ONLY the about section (eyebrow, title, body).",
  services: "Regenerate ONLY the services section (eyebrow, title, and 1-12 service items with title and description).",
  faqs: "Regenerate ONLY the faqs section (eyebrow, title, and 1-20 question/answer items).",
  contact: "Regenerate ONLY the contact section (title). Use ONLY contact details supplied in the brief; missing details must be [For review] placeholders.",
  footer: "Regenerate ONLY the footer section (copyright line).",
};

/** Bounded, privacy-safe request input. No secrets, paths, or env values. */
function buildBoundedInput(input: ContentGenerationInput, maxChars: number) {
  const bounded = {
    template: { id: input.template.id, version: input.template.version },
    schemaVersion: 1,
    promptVersion: AI_CONTENT_PROMPT_VERSION,
    brief: input.brief,
    approvedMedia: input.media.map((m) => ({
      id: m.id,
      kind: m.kind,
      name: m.name,
      ...(m.sourceUrl ? { url: m.sourceUrl } : {}),
      ...(m.altText ? { altText: m.altText } : {}),
    })),
    editableFields: input.inventory
      .filter((f) => f.editable)
      .map((f) => ({
        path: f.path,
        label: f.label,
        type: f.type,
        required: f.required,
      })),
  };
  const json = JSON.stringify(bounded);
  if (json.length > maxChars) {
    throw new Error(
      `Generation input exceeds AI_MAX_INPUT_CHARS (${json.length} > ${maxChars}). Reduce the brief length — the previous draft is unchanged.`
    );
  }
  return { bounded, json };
}

/** Low-level request executor: timeout + bounded retries on transient errors. */
async function requestCompletion(
  messages: Array<{ role: "system" | "user"; content: string }>,
  jsonSchema: Record<string, unknown>,
  schemaName: string,
  runtime?: ProviderRuntimeConfig
): Promise<{ raw: string; inputTokens?: number; outputTokens?: number }> {
  const legacy = getAiGenerationConfig();
  const config: ProviderRuntimeConfig = runtime ?? {
    providerId: "ai",
    transport: "openai-compatible",
    baseUrl: legacy.baseUrl,
    model: legacy.model,
    apiKey: process.env.AI_API_KEY?.trim() || null,
    enabled: legacy.enabled,
    useStructuredOutput: true,
    maxOutputTokens: legacy.maxOutputTokens,
    timeoutMs: legacy.timeoutMs,
    maxInputChars: legacy.maxInputChars,
    maxRetries: legacy.maxRetries,
  };
  if (!config.enabled || !config.model) {
    throw new Error(
      "Real AI generation is disabled. Set AI_GENERATION_ENABLED=true and AI_MODEL to enable it, or use deterministic generation."
    );
  }
  if (!config.apiKey) {
    throw new Error(
      "AI generation is enabled but the provider API key is not configured on the server."
    );
  }
  const apiKey = config.apiKey;

  let attempt = 0;
  let lastError: Error = new Error("AI request failed.");
  while (attempt <= config.maxRetries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          ...(config.useStructuredOutput
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: { name: schemaName, strict: true, schema: jsonSchema },
                },
              }
            : {}),
          max_tokens: config.maxOutputTokens,
          temperature: 0.4,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        if (isTransientStatus(res.status) && attempt < config.maxRetries) {
          attempt += 1;
          continue;
        }
        // Redacted error: status only, never the response body.
        throw new Error(
          `AI provider request failed with status ${res.status} (redacted).`
        );
      }

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const raw = body.choices?.[0]?.message?.content ?? "";
      if (!raw) {
        throw new Error("AI provider returned an empty response.");
      }
      return {
        raw,
        inputTokens: body.usage?.prompt_tokens,
        outputTokens: body.usage?.completion_tokens,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const transient = isAbort || error instanceof TypeError;
      if (transient && attempt < config.maxRetries) {
        attempt += 1;
        lastError = isAbort
          ? new Error(`AI request timed out after ${config.timeoutMs}ms.`)
          : new Error("AI request failed at the network level (redacted).");
        continue;
      }
      throw error instanceof Error ? error : lastError;
    }
  }
  throw lastError;
}

async function completeDraft(
  input: ContentGenerationInput,
  runtime?: ProviderRuntimeConfig
): Promise<{
  content: HomeContent;
  metadata: GenerationMetadata;
  usage?: { inputTokens?: number; outputTokens?: number };
}> {
  const config = getAiGenerationConfig();
  const { json } = buildBoundedInput(input, config.maxInputChars);
  const inputHash = computeInputHash(input);

  const { raw, inputTokens, outputTokens } = await requestCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Business brief and approved media for the website draft:\n${json}\n\nReturn the complete HomeContent JSON object.`,
      },
    ],
    homeContentJsonSchema(),
    "home_content",
    runtime
  );

  // Parse → strict shape-validate → map → final application schema gate.
  const parsedUnknown = parseAiJsonResponse(raw);
  const aiResult = AiHomeContentSchema.safeParse(parsedUnknown);
  if (!aiResult.success) {
    throw new Error(
      `AI output failed the strict generation schema: ${aiResult.error.errors
        .map((e) => `Path [${e.path.join(".") || "(root)"}]: ${e.message}`)
        .slice(0, 5)
        .join("; ")}`
    );
  }
  const mapped = mapAiResponseToHomeContent(aiResult.data, input);
  const validated = HomeContentSchema.safeParse(mapped);
  if (!validated.success) {
    throw new Error(
      `AI-mapped content failed HomeContentSchema: ${validated.error.errors
        .map((e) => `Path [${e.path.join(".")}]: ${e.message}`)
        .slice(0, 5)
        .join("; ")}`
    );
  }

  return {
    content: validated.data,
    metadata: {
      provider: (runtime?.providerId ?? "ai") as GenerationMetadata["provider"],
      model: config.model,
      templateId: input.template.id,
      templateVersion: input.template.version,
      inputHash,
      promptVersion: AI_CONTENT_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
    },
    usage: { inputTokens, outputTokens },
  };
}

export class ServerAiContentGenerationProvider
  implements ContentGenerationProvider
{
  readonly promptVersion = AI_CONTENT_PROMPT_VERSION;

  /** Optional per-provider runtime override (Slice 12 provider registry). */
  constructor(private readonly runtime?: ProviderRuntimeConfig) {}

  async generateWebsiteDraft(
    input: ContentGenerationInput
  ): Promise<{ content: HomeContent; metadata: GenerationMetadata }> {
    const result = await completeDraft(input, this.runtime);
    return { content: result.content, metadata: result.metadata };
  }

  /**
   * Section-level regeneration (Part H): returns a validated replacement for
   * ONE section, or throws. Merging happens only after validation, so an
   * invalid section output leaves the existing section unchanged.
   */
  async regenerateSection(
    input: ContentGenerationInput,
    section: RegeneratableSection,
    currentDraft: HomeContent
  ): Promise<{ section: unknown; model: string; promptVersion: string }> {
    if (!REGENERATABLE_SECTIONS.includes(section)) {
      throw new Error(`Section "${section}" is not eligible for regeneration.`);
    }
    const config = this.runtime ?? {
      model: getAiGenerationConfig().model,
    };
    const { json } = buildBoundedInput(input, getAiGenerationConfig().maxInputChars);
    const sectionSchema = SectionSchemas[section];
    const mediaSubset = input.media.filter(
      (m) => m.approved && (section === "hero" ? m.kind !== "document" : true)
    );

    const { raw } = await requestCompletion(
      [
        {
          role: "system",
          content: `${SYSTEM_PROMPT} ${SECTION_PROMPTS[section]}`,
        },
        {
          role: "user",
          content: `Project context:\n${JSON.stringify({
            brief: input.brief,
            approvedMedia: mediaSubset,
            template: { id: input.template.id, version: input.template.version },
          })}\n\nInventory excerpt:\n${json.slice(0, 2000)}\n\nCurrent section value:\n${JSON.stringify(
            currentDraft[section]
          )}\n\nReturn ONLY the regenerated "${section}" section as JSON.`,
        },
      ],
      sectionJsonSchema(section),
      `${section}_section`,
      this.runtime
    );

    const parsed = parseAiJsonResponse(raw) as Record<string, unknown>;
    // Accept either the wrapped { [section]: ... } shape or the bare section.
    const payload = parsed[section] ?? parsed;
    const validated = sectionSchema.safeParse(payload);
    if (!validated.success) {
      throw new Error(
        `Regenerated section failed validation — the existing section is unchanged. ${validated.error.errors
          .map((e) => `Path [${e.path.join(".")}]: ${e.message}`)
          .slice(0, 3)
          .join("; ")}`
      );
    }
    return {
      section: validated.data,
      model: config.model,
      promptVersion: this.promptVersion,
    };
  }
}

/** JSON schema for a single section response (strict wrapper). */
function sectionJsonSchema(
  section: RegeneratableSection
): Record<string, unknown> {
  const full = homeContentJsonSchema();
  const props = full.properties as Record<string, Record<string, unknown>>;
  return {
    type: "object",
    additionalProperties: false,
    required: [section],
    properties: { [section]: props[section] },
  };
}

export const serverAiProvider = new ServerAiContentGenerationProvider();

