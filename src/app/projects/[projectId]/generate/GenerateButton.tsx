"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type GenerateResult = {
  ok: boolean;
  errors?: string[];
  draftId?: string;
  metadata?: {
    provider: string;
    inputHash: string;
    promptVersion: string;
    templateVersion: string;
    generatedAt: string;
  };
};

/** Runs POST /api/projects/<id>/generate with loading/success/failure states. */
export default function GenerateButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "success" | "failure">("idle");
  const [result, setResult] = useState<GenerateResult | null>(null);

  async function handleGenerate() {
    setState("loading");
    try {
      const res = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
      });
      const body = (await res.json()) as GenerateResult;
      setResult(body);
      setState(res.ok && body.ok ? "success" : "failure");
      if (res.ok && body.ok) router.refresh();
    } catch (error) {
      setResult({ ok: false, errors: [String(error)] });
      setState("failure");
    }
  }

  return (
    <div>
      <button onClick={handleGenerate} disabled={state === "loading"}>
        {state === "loading" ? "Generating…" : "Generate draft"}
      </button>

      {state === "success" && result?.metadata && (
        <div>
          <p>
            Draft created: <code>{result.draftId}</code>
          </p>
          <ul>
            <li>Provider: {result.metadata.provider}</li>
            <li>Prompt version: {result.metadata.promptVersion}</li>
            <li>Input hash: <code>{result.metadata.inputHash}</code></li>
            <li>Template version: {result.metadata.templateVersion}</li>
            <li>Generated at: {new Date(result.metadata.generatedAt).toLocaleString()}</li>
          </ul>
          <Link href={`/projects/${projectId}/preview`}>
            Preview the generated draft →
          </Link>
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
