"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type GenerateResult = {
  ok: boolean;
  errors?: string[];
  providerDisabled?: boolean;
  draftId?: string;
  metadata?: {
    provider: string;
    model?: string;
    inputHash: string;
    promptVersion: string;
    templateVersion: string;
    generatedAt: string;
  };
};

/**
 * Runs POST /api/projects/<id>/generate with loading/timeout/disabled/
 * invalid-output/provider-error states, for either the deterministic local
 * provider or the server-side AI provider (when enabled).
 */
/** Client-safe descriptor mirror (server sends only safe metadata). */
type ProviderOption = {
  providerId: string;
  displayName: string;
  modelId: string;
  availability: "enabled" | "disabled" | "unconfigured" | "local";
  costLabel: string;
  supportsStructuredOutput: boolean;
  operatorNote: string;
};

export default function GenerateButton({
  projectId,
  aiEnabled,
  aiModel,
  providers,
  openRouterModels,
}: {
  projectId: string;
  aiEnabled: boolean;
  aiModel: string;
  providers?: ProviderOption[];
  openRouterModels?: Array<{ id: string; name: string; promptPriceLabel: string }> | null;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<string>("deterministic");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [state, setState] = useState<
    "idle" | "loading" | "success" | "failure" | "disabled"
  >("idle");
  const [result, setResult] = useState<GenerateResult | null>(null);

  async function handleGenerate() {
    setState("loading");
    try {
      const res = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
        provider === "openrouter" && selectedModel
          ? { provider, model: selectedModel }
          : { provider }
      ),
      });
      const body = (await res.json()) as GenerateResult;
      setResult(body);
      if (res.status === 409 || body.providerDisabled) {
        setState("disabled");
      } else {
        setState(res.ok && body.ok ? "success" : "failure");
      }
      if (res.ok && body.ok) router.refresh();
    } catch (error) {
      setResult({ ok: false, errors: [String(error)] });
      setState("failure");
    }
  }

  return (
    <div>
      <fieldset>
        <legend>Provider</legend>
        <label>
          <input
            type="radio"
            name="provider"
            checked={provider === "deterministic"}
            onChange={() => setProvider("deterministic")}
          />{" "}
          Deterministic local (offline, no AI)
        </label>{" "}
        <label>
          <input
            type="radio"
            name="provider"
            checked={provider === "ai"}
            onChange={() => setProvider("ai")}
            disabled={!aiEnabled}
          />{" "}
          Real AI {aiEnabled ? `(${aiModel})` : "(disabled)"}
        </label>
        {providers && providers.length > 0 && (
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            Registered providers (server-validated at generation time)
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              style={{ display: "block", marginTop: "0.35rem", minWidth: "22rem" }}
            >
              {providers.map((p) => (
                <option
                  key={p.providerId}
                  value={p.providerId === "deterministic" ? "deterministic" : p.providerId}
                  disabled={p.availability !== "enabled" && p.availability !== "local"}
                >
                  {p.displayName} — {p.costLabel} — {p.availability}
                  {p.supportsStructuredOutput ? "" : " — text-JSON parsing"}
                </option>
              ))}
            </select>
          </label>
        )}
        {provider === "openrouter" && openRouterModels && openRouterModels.length > 0 && (
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            OpenRouter model (explicit slug; recorded with the draft)
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{ display: "block", marginTop: "0.35rem", minWidth: "22rem" }}
            >
              <option value="">— choose a model —</option>
              {openRouterModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id}) — {m.promptPriceLabel}
                </option>
              ))}
            </select>
          </label>
        )}
        {provider === "openrouter" && (
          <p role="note" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
            Warning: the openrouter/free router selects a free model dynamically
            and is NON-DETERMINISTIC. Free availability is provider-controlled
            and quota-limited — never use it for reproducible generation.
          </p>
        )}
      </fieldset>

      <button onClick={handleGenerate} disabled={state === "loading"}>
        {state === "loading" ? "Generating…" : "Generate draft"}
      </button>

      {state === "success" && result?.metadata && (
        <div>
          <p>
            Draft created: <code>{result.draftId}</code> — status: review
            (requires human approval)
          </p>
          <ul>
            <li>Provider: {result.metadata.provider}</li>
            {result.metadata.model && <li>Model: {result.metadata.model}</li>}
            <li>Prompt version: {result.metadata.promptVersion}</li>
            <li>Input hash: <code>{result.metadata.inputHash}</code></li>
            <li>Template version: {result.metadata.templateVersion}</li>
            <li>Generated at: {new Date(result.metadata.generatedAt).toLocaleString()}</li>
          </ul>
          <Link href={`/projects/${projectId}/review`}>
            Review the generated draft →
          </Link>
        </div>
      )}

      {state === "disabled" && (
        <div role="alert">
          <p>Real AI generation is disabled on this server.</p>
          <ul>
            {(result?.errors ?? []).map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {state === "failure" && (
        <div role="alert">
          <p>Generation failed — the previous draft is unchanged.</p>
          <ul>
            {(result?.errors ?? ["Unknown error"]).map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
