import "server-only";

import {
  getProviderRuntimeConfig,
  PROVIDER_IDS,
  type CostLabel,
} from "./config";
import {
  ServerAiContentGenerationProvider,
  serverAiProvider,
} from "./ai-provider";
import { deterministicProvider } from "./deterministic-provider";
import type { ContentGenerationProvider } from "./deterministic-provider";

/**
 * Provider-neutral AI model registry (Slice 12, Stage A).
 *
 * Server-only. Returns SAFE descriptors to the client (never credentials,
 * base URLs with keys, prompts, or raw responses). Generation always runs
 * through the same `ContentGenerationProvider` boundary and the same strict
 * Zod validation — a provider never becomes a source of unvalidated content.
 *
 * NO SILENT FALLBACK: an unavailable provider produces a visible error; the
 * deterministic provider is offered explicitly, never substituted silently.
 */

export type ModelDescriptor = {
  providerId: string;
  modelId: string;
  displayName: string;
  transport: "openai-compatible" | "gemini" | "ollama" | "openrouter" | "local";
  availability: "enabled" | "disabled" | "unconfigured" | "local";
  costLabel: CostLabel;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsModelListing: boolean;
  /** Human-readable operator meaning — no promises of free/unlimited access. */
  operatorNote: string;
};

const PROVIDER_NOTES: Record<string, string> = {
  deterministic:
    "Offline template demo content generated from the brief. No AI model, no network calls.",
  ai: "The configured server-side cloud provider. Uses your provider account and its current quotas and terms.",
  ollama:
    "Runs on the operator's machine via the local Ollama server. No hosted-model API charge; subject to local hardware, quality, and latency limits. The model must be installed locally.",
  gemini:
    "Google Gemini via its OpenAI-compatible endpoint. Free-tier or paid depending on configuration — subject to current provider quotas and terms, which can change.",
  openrouter:
    "OpenRouter gateway using an explicit model slug. Free-tier or paid depending on the chosen model; availability and terms can change. The openrouter/free router is non-deterministic and development-oriented.",
};

/** Safe descriptor for one provider (no credentials, no base URLs). */
function descriptorFor(
  providerId: string,
  modelId: string,
  transport: ModelDescriptor["transport"],
  enabled: boolean,
  hasConfig: boolean,
  costLabel: CostLabel,
  supportsStructuredOutput: boolean,
  supportsModelListing: boolean
): ModelDescriptor {
  const availability: ModelDescriptor["availability"] =
    providerId === "deterministic"
      ? "local"
      : enabled
        ? "enabled"
        : hasConfig
          ? "disabled"
          : "unconfigured";
  return {
    providerId,
    modelId: modelId || "(not configured)",
    displayName:
      providerId === "deterministic"
        ? "Deterministic (offline)"
        : providerId === "ai"
          ? "Configured cloud provider"
          : providerId.charAt(0).toUpperCase() + providerId.slice(1),
    transport,
    availability,
    costLabel,
    supportsStructuredOutput,
    supportsVision: false, // no provider is vision-enabled in this slice
    supportsModelListing,
    operatorNote: PROVIDER_NOTES[providerId] ?? "",
  };
}

/** Client-safe catalog. No network calls; no secrets. */
export function listProviderDescriptors(): ModelDescriptor[] {
  const out: ModelDescriptor[] = [
    descriptorFor("deterministic", "template-demo-v1", "local", true, true, "local", false, false),
  ];

  for (const id of PROVIDER_IDS) {
    if (id === "deterministic") continue;
    const config = getProviderRuntimeConfig(id);
    if (!config) continue;
    out.push(
      descriptorFor(
        id,
        config.model,
        config.transport,
        config.enabled && Boolean(config.apiKey ?? id === "ollama"),
        Boolean(config.model),
        id === "ai" ? "paid" : id === "ollama" ? "local" : id === "gemini" ? "free-tier" : "unknown",
        config.useStructuredOutput,
        id === "openrouter"
      )
    );
  }
  return out;
}

export type ResolvedProvider =
  | { ok: true; provider: ContentGenerationProvider; providerId: string; model: string }
  | { ok: false; errorCode: "unknown-provider" | "unconfigured" | "disabled"; errors: string[] };

/**
 * Resolve a provider id into a generation provider. NEVER falls back: an
 * unavailable or unconfigured provider is a visible error.
 */
export function resolveGenerationProvider(
  providerId: string,
  modelOverride?: string
): ResolvedProvider {
  if (providerId === "deterministic") {
    return {
      ok: true,
      provider: deterministicProvider,
      providerId: "deterministic-local",
      model: "template-demo-v1",
    };
  }

  let config = getProviderRuntimeConfig(providerId);
  if (config && modelOverride && modelOverride.trim() && providerId === "openrouter") {
    // Explicit operator model selection: validated as a non-empty slug and
    // recorded with the draft for reproducibility.
    const model = modelOverride.trim();
    if (/^[a-zA-Z0-9.\/_:-]+$/.test(model)) {
      config = { ...config, model };
    }
  }
  if (!config) {
    return {
      ok: false,
      errorCode: "unknown-provider",
      errors: [`Unknown generation provider "${providerId}".`],
    };
  }
  if (!config.model) {
    return {
      ok: false,
      errorCode: "unconfigured",
      errors: [`Provider "${providerId}" has no model configured on the server.`],
    };
  }
  // openrouter/free is a non-deterministic development router: it must be
  // explicitly enabled and is always visibly labelled as non-reproducible.
  if (providerId === "openrouter" && config.model === "openrouter/free") {
    if (process.env.AI_OPENROUTER_ALLOW_FREE_ROUTER !== "true") {
      return {
        ok: false,
        errorCode: "disabled",
        errors: [
          "The openrouter/free router is disabled. Set AI_OPENROUTER_ALLOW_FREE_ROUTER=true to allow it. It is non-deterministic and intended for development only."
        ],
      };
    }
  }
  const hasCredential = providerId === "ollama" ? true : Boolean(config.apiKey);
  if (!config.enabled || !hasCredential) {
    return {
      ok: false,
      errorCode: "disabled",
      errors: [
        `Provider "${providerId}" is disabled or missing its server-side credential. Enable it in the server configuration.`,
      ],
    };
  }
  return {
    ok: true,
    provider:
      providerId === "ai"
        ? serverAiProvider
        : new ServerAiContentGenerationProvider(config),
    providerId,
    model: config.model,
  };
}

// ── Provider diagnosis (Slice 14, Stage A) ──────────────────────────────

export type ProviderDiagnosisStatus =
  | "configured"
  | "unconfigured"
  | "reachable"
  | "unreachable"
  | "authentication_failed"
  | "model_unavailable"
  | "quota_limited"
  | "unsupported_capability";

export type ProviderDiagnosis = {
  providerId: string;
  modelId: string;
  status: ProviderDiagnosisStatus;
  detail: string;
  checkedAt: string;
};

/**
 * Safe, bounded reachability check for ONE provider. Performs at most one
 * GET against the provider's models endpoint (or the local Ollama server)
 * and reports a SAFE status only — never credentials, raw response bodies,
 * or headers. Deterministic stays local by definition.
 */
export async function diagnoseProvider(
  providerId: string
): Promise<ProviderDiagnosis> {
  const checkedAt = new Date().toISOString();
  if (providerId === "deterministic") {
    return {
      providerId,
      modelId: "template-demo-v1",
      status: "reachable",
      detail: "Local deterministic provider — no network required.",
      checkedAt,
    };
  }
  const config = getProviderRuntimeConfig(providerId);
  if (!config || !config.model) {
    return {
      providerId,
      modelId: "(not configured)",
      status: "unconfigured",
      detail: "No model configured on the server for this provider.",
      checkedAt,
    };
  }
  if (!config.enabled) {
    return {
      providerId,
      modelId: config.model,
      status: "configured",
      detail: "Configured but disabled by its feature flag.",
      checkedAt,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 15000));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const res = await fetch(`${config.baseUrl}/models`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      return { providerId, modelId: config.model, status: "authentication_failed", detail: `Authentication failed (${res.status}).`, checkedAt };
    }
    if (res.status === 402 || res.status === 429) {
      return { providerId, modelId: config.model, status: "quota_limited", detail: `Quota or rate limit indicated (${res.status}).`, checkedAt };
    }
    if (res.status === 404) {
      return { providerId, modelId: config.model, status: "unsupported_capability", detail: "Models endpoint not available (404).", checkedAt };
    }
    if (!res.ok) {
      return { providerId, modelId: config.model, status: "unreachable", detail: `Provider responded with status ${res.status}.`, checkedAt };
    }

    // Model availability check where the catalog lists ids.
    const body = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: unknown }> }
      | { models?: Array<{ name?: unknown }> }
      | null;
    const ids: string[] =
      body && "data" in body && Array.isArray(body.data)
        ? body.data.filter((m) => typeof m.id === "string").map((m) => m.id as string)
        : body && "models" in body && Array.isArray(body.models)
          ? body.models.filter((m) => typeof m.name === "string").map((m) => m.name as string)
          : [];
    if (ids.length > 0 && !ids.includes(config.model)) {
      return {
        providerId,
        modelId: config.model,
        status: "model_unavailable",
        detail: "The configured model id was not found in the provider catalog.",
        checkedAt,
      };
    }
    return {
      providerId,
      modelId: config.model,
      status: "reachable",
      detail: "Provider reachable with the configured model.",
      checkedAt,
    };
  } catch (error) {
    return {
      providerId,
      modelId: config.model,
      status: "unreachable",
      detail:
        error instanceof Error && error.name === "AbortError"
          ? "Timed out."
          : "Network-level failure (redacted).",
      checkedAt,
    };
  }
}

export type SafeModelInfo = {
  id: string;
  name: string;
  contextLength: number | null;
  promptPriceLabel: string;
};

let openRouterCache: { at: number; models: SafeModelInfo[] } | null = null;
const OPENROUTER_CACHE_MS = 60_000;

/**
 * Fetch OpenRouter's model catalog with bounded caching. Returns safe
 * metadata only (id, name, context length, price label). Never called during
 * page render — only from the explicit providers endpoint when configured.
 */
export async function listOpenRouterModels(): Promise<
  | { ok: true; models: SafeModelInfo[]; cached: boolean }
  | { ok: false; errorCode: string }
> {
  const config = getProviderRuntimeConfig("openrouter");
  if (!config || !config.enabled) {
    return { ok: false, errorCode: "disabled" };
  }
  if (openRouterCache && Date.now() - openRouterCache.at < OPENROUTER_CACHE_MS) {
    return { ok: true, models: openRouterCache.models, cached: true };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, errorCode: `http-${res.status}` };
    }
    const body = (await res.json()) as {
      data?: Array<{
        id?: unknown;
        name?: unknown;
        context_length?: unknown;
        pricing?: { prompt?: unknown };
      }>;
    };
    const models: SafeModelInfo[] = (body.data ?? [])
      .filter(
        (m): m is { id: string; name: string; context_length?: unknown; pricing?: { prompt?: unknown } } =>
          typeof m.id === "string" && typeof m.name === "string"
      )
      .map((m) => ({
        id: m.id,
        name: m.name,
        contextLength:
          typeof m.context_length === "number" ? m.context_length : null,
        promptPriceLabel:
          typeof m.pricing?.prompt === "string" && Number(m.pricing.prompt) === 0
            ? "free (provider-controlled, quota-limited)"
            : "paid / see provider",
      }))
      .slice(0, 200);
    openRouterCache = { at: Date.now(), models };
    return { ok: true, models, cached: false };
  } catch (error) {
    return {
      ok: false,
      errorCode:
        error instanceof Error && error.name === "AbortError" ? "timeout" : "unreachable",
    };
  }
}
