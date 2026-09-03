import "server-only";

/**
 * Server-side AI generation configuration (Slice 7).
 *
 * Read entirely from environment variables on the server. Never imported by
 * client components; never exposed to the browser. The default is SAFE:
 * real AI generation is disabled unless AI_GENERATION_ENABLED is explicitly
 * "true" AND a model is configured.
 */

export type AiGenerationConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  maxOutputTokens: number;
  timeoutMs: number;
  maxInputChars: number;
  maxRetries: number;
  enabled: boolean;
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAiGenerationConfig(): AiGenerationConfig {
  const enabled =
    process.env.AI_GENERATION_ENABLED === "true" &&
    Boolean(process.env.AI_MODEL);
  return {
    provider: process.env.AI_PROVIDER ?? "openai-compatible",
    model: process.env.AI_MODEL ?? "",
    baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
    maxOutputTokens: intEnv("AI_MAX_OUTPUT_TOKENS", 12000),
    timeoutMs: intEnv("AI_TIMEOUT_MS", 60000),
    maxInputChars: intEnv("AI_MAX_INPUT_CHARS", 50000),
    maxRetries: intEnv("AI_MAX_RETRIES", 2),
    enabled,
  };
}

/** Client-safe summary (contains NO credentials). */
export function redactedConfigSummary(config: AiGenerationConfig) {
  return {
    provider: config.provider,
    model: config.model || "(not configured)",
    enabled: config.enabled,
    maxInputChars: config.maxInputChars,
    maxRetries: config.maxRetries,
  };
}

/** Transient HTTP statuses worth retrying (rate limit + server errors). */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ── Provider registry runtime configs (Slice 12, Stage A) ───────────────

/**
 * Per-provider runtime configuration. All values are resolved server-side
 * from environment variables; `apiKey` is the resolved secret and must never
 * leave the server. The registry exposes only safe descriptors.
 */
export type ProviderRuntimeConfig = {
  providerId: string;
  transport: "openai-compatible" | "gemini" | "ollama" | "openrouter";
  /** OpenAI-compatible chat-completions base URL (all current transports). */
  baseUrl: string;
  model: string;
  apiKey: string | null;
  enabled: boolean;
  /** Whether the request sends a strict JSON-schema response_format. */
  useStructuredOutput: boolean;
  maxOutputTokens: number;
  timeoutMs: number;
  maxInputChars: number;
  maxRetries: number;
};

function providerIntEnv(name: string, fallback: number): number {
  return intEnv(name, fallback);
}

function resolveKey(envName: string | null): string | null {
  if (!envName) return null;
  const value = process.env[envName];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** Known safe provider ids. "ai" remains an alias for the legacy cloud provider. */
export const PROVIDER_IDS = [
  "deterministic",
  "ai",
  "ollama",
  "gemini",
  "openrouter",
] as const;

export function isKnownProviderId(value: string): value is (typeof PROVIDER_IDS)[number] {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Resolve the runtime configuration for one provider id.
 * Returns null for unknown ids; `enabled` is false unless the provider's
 * feature flag is explicitly "true" AND a model is configured.
 */
export function getProviderRuntimeConfig(
  providerId: string
): ProviderRuntimeConfig | null {
  if (providerId === "deterministic") return null;

  if (providerId === "ai" || providerId === "openai-compatible") {
    const base = getAiGenerationConfig();
    return {
      providerId: "ai",
      transport: "openai-compatible",
      baseUrl: base.baseUrl,
      model: base.model,
      apiKey: resolveKey("AI_API_KEY"),
      enabled: base.enabled,
      useStructuredOutput: true,
      maxOutputTokens: base.maxOutputTokens,
      timeoutMs: base.timeoutMs,
      maxInputChars: base.maxInputChars,
      maxRetries: base.maxRetries,
    };
  }

  if (providerId === "ollama") {
    const baseUrl =
      process.env.AI_OLLAMA_BASE_URL?.trim() || "http://localhost:11434/v1";
    const model = process.env.AI_OLLAMA_MODEL?.trim() ?? "";
    return {
      providerId: "ollama",
      transport: "ollama",
      baseUrl,
      model,
      apiKey: null, // local transport needs no production credential
      enabled: process.env.AI_OLLAMA_ENABLED === "true" && Boolean(model),
      useStructuredOutput: false, // parse text + Zod instead
      maxOutputTokens: providerIntEnv("AI_MAX_OUTPUT_TOKENS", 12000),
      timeoutMs: providerIntEnv("AI_TIMEOUT_MS", 60000),
      maxInputChars: providerIntEnv("AI_MAX_INPUT_CHARS", 50000),
      maxRetries: 0, // local model: no point retrying long generations
    };
  }

  if (providerId === "gemini") {
    const model = process.env.AI_GEMINI_MODEL?.trim() ?? "";
    return {
      providerId: "gemini",
      transport: "gemini",
      // Gemini's OpenAI-compatible endpoint (documented by Google).
      baseUrl:
        process.env.AI_GEMINI_BASE_URL?.trim() ||
        "https://generativelanguage.googleapis.com/v1beta/openai",
      model,
      apiKey: resolveKey("AI_GEMINI_API_KEY"),
      enabled: process.env.AI_GEMINI_ENABLED === "true" && Boolean(model),
      useStructuredOutput: true,
      maxOutputTokens: providerIntEnv("AI_GEMINI_MAX_OUTPUT_TOKENS", 12000),
      timeoutMs: providerIntEnv("AI_TIMEOUT_MS", 60000),
      maxInputChars: providerIntEnv("AI_MAX_INPUT_CHARS", 50000),
      maxRetries: providerIntEnv("AI_MAX_RETRIES", 2),
    };
  }

  if (providerId === "openrouter") {
    const model = process.env.AI_OPENROUTER_MODEL?.trim() ?? "";
    return {
      providerId: "openrouter",
      transport: "openrouter",
      baseUrl:
        process.env.AI_OPENROUTER_BASE_URL?.trim() ||
        "https://openrouter.ai/api/v1",
      model,
      apiKey: resolveKey("AI_OPENROUTER_API_KEY"),
      enabled: process.env.AI_OPENROUTER_ENABLED === "true" && Boolean(model),
      useStructuredOutput: true,
      maxOutputTokens: providerIntEnv("AI_OPENROUTER_MAX_OUTPUT_TOKENS", 12000),
      timeoutMs: providerIntEnv("AI_TIMEOUT_MS", 60000),
      maxInputChars: providerIntEnv("AI_MAX_INPUT_CHARS", 50000),
      maxRetries: providerIntEnv("AI_MAX_RETRIES", 2),
    };
  }

  return null;
}

/** Operator-facing cost label — never a promise of free/unlimited access. */
export type CostLabel = "free-tier" | "local" | "paid" | "unknown";


