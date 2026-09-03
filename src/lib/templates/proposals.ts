import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import {
  DEFAULT_BUILDER_DOCUMENT,
  diffBuilderDocuments,
  validateBuilderDocument,
  type BuilderDiff,
  type BuilderDocument,
} from "@/types/builder";
import { getProviderRuntimeConfig, isTransientStatus } from "@/lib/generation/config";
import {
  TEMPLATE_PROPOSAL_PROMPT_VERSION,
  TemplateProposalRequestSchema,
  TemplateProposalOutputSchema,
  PROPOSAL_SYSTEM_PROMPT,
  buildProposalInput,
  proposalJsonSchema,
  parseProposalJson,
  type TemplateProposalRequest,
  type TemplateProposalOutput,
} from "./proposal-schema";
import { templateFamilyStore } from "./families";

/**
 * AI template-proposal lifecycle (Slice 16, Stages B–D). Server-only.
 *
 * request → provider call → strict validation → saved as `proposal_review`
 * → operator accepts (creates a NEW draft version; never publishes) or
 * rejects (no catalog side effect). No silent fallback; credentials, raw
 * prompts, and raw responses never leave this module.
 */

const PROPOSALS_FILE = process.env.TEMPLATES_DATA_DIR
  ? path.join(process.env.TEMPLATES_DATA_DIR, "proposals.json")
  : path.join(process.cwd(), ".data", "templates", "proposals.json");

export type ProposalStatus = "proposal_review" | "accepted" | "rejected";

export type StoredProposal = {
  proposalId: string;
  familyKey: string;
  displayName: string;
  status: ProposalStatus;
  document: BuilderDocument;
  rationale: string;
  providerId: string;
  modelId: string;
  promptVersion: string;
  inputHash: string;
  outputHash: string;
  createdAt: string;
  diff: BuilderDiff;
};

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function readProposals(): Promise<StoredProposal[]> {
  try {
    const raw = await fs.readFile(PROPOSALS_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredProposal[]) : [];
  } catch {
    return [];
  }
}

async function writeProposals(proposals: StoredProposal[]): Promise<void> {
  await fs.mkdir(path.dirname(PROPOSALS_FILE), { recursive: true });
  await fs.writeFile(PROPOSALS_FILE, JSON.stringify(proposals, null, 2), "utf-8");
}

/** Provider call: OpenAI-compatible transport with bounded retries. */
async function callProvider(
  providerId: string,
  modelOverride: string | undefined,
  userContent: string,
  useStructuredOutput: boolean
): Promise<{ raw: string; modelId: string }> {
  const config = getProviderRuntimeConfig(providerId);
  if (!config) throw new Error("unknown-provider");
  const model = modelOverride?.trim() || config.model;
  if (!config.enabled || !model) throw new Error("provider-disabled");
  if (providerId !== "ollama" && !config.apiKey) throw new Error("provider-disabled");

  const attempts = 1 + config.maxRetries;
  let lastCode = "unreachable";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: PROPOSAL_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          ...(useStructuredOutput
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "template_proposal",
                    strict: true,
                    schema: proposalJsonSchema(),
                  },
                },
              }
            : {}),
          max_tokens: config.maxOutputTokens,
          temperature: 0.5,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        if (isTransientStatus(res.status) && attempt < attempts - 1) {
          lastCode = `http-${res.status}`;
          continue;
        }
        if (res.status === 401 || res.status === 403) throw new Error("authentication_failed");
        if (res.status === 402 || res.status === 429) throw new Error("quota_limited");
        throw new Error(`provider-http-${res.status}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = body.choices?.[0]?.message?.content ?? "";
      if (!raw) throw new Error("empty-response");
      return { raw, modelId: model };
    } catch (error) {
      clearTimeout(timer);
      const isAbort = error instanceof Error && error.name === "AbortError";
      const transient = isAbort || error instanceof TypeError;
      if (transient && attempt < attempts - 1) {
        lastCode = isAbort ? "timeout" : "unreachable";
        continue;
      }
      if (!transient && error instanceof Error && error.message !== "provider-http-error") {
        throw error;
      }
      if (!transient && error instanceof Error && error.message.startsWith("provider-http-")) {
        throw error;
      }
      lastCode = isAbort ? "timeout" : lastCode;
    }
  }
  throw new Error(lastCode);
}

export type ProposalRequestResult =
  | { ok: true; proposal: StoredProposal }
  | { ok: false; errorCode: string; errors: string[] };

export async function requestTemplateProposal(
  request: TemplateProposalRequest
): Promise<ProposalRequestResult> {
  const parsedRequest = TemplateProposalRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    return {
      ok: false,
      errorCode: "invalid-request",
      errors: parsedRequest.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const source = request.sourceVersionId
    ? await (await import("@/lib/templates/version-store")).templateVersionStore.get(
        request.sourceVersionId
      )
    : null;
  const baseline: BuilderDocument = source?.document ?? DEFAULT_BUILDER_DOCUMENT;

  let json: string;
  try {
    json = buildProposalInput(parsedRequest.data, baseline).json;
  } catch (error) {
    return { ok: false, errorCode: "input-too-large", errors: [String(error)] };
  }
  const inputHash = sha(json);
  // openrouter/free is gated and always labelled non-deterministic.
  const requestedModel = parsedRequest.data.modelId?.trim();
  if (
    parsedRequest.data.providerId === "openrouter" &&
    requestedModel === "openrouter/free" &&
    process.env.AI_OPENROUTER_ALLOW_FREE_ROUTER !== "true"
  ) {
    return {
      ok: false,
      errorCode: "disabled",
      errors: [
        "The openrouter/free router is disabled and NON-DETERMINISTIC. Set AI_OPENROUTER_ALLOW_FREE_ROUTER=true to allow it for development experiments."
      ],
    };
  }
  const runtime = getProviderRuntimeConfig(parsedRequest.data.providerId);
  const effectiveModel = requestedModel ?? runtime?.model ?? "";
  if (
    parsedRequest.data.providerId === "openrouter" &&
    effectiveModel === "openrouter/free" &&
    process.env.AI_OPENROUTER_ALLOW_FREE_ROUTER !== "true"
  ) {
    return {
      ok: false,
      errorCode: "disabled",
      errors: [
        "The openrouter/free router is disabled and NON-DETERMINISTIC. Set AI_OPENROUTER_ALLOW_FREE_ROUTER=true to allow it for development experiments."
      ],
    };
  }

  let raw: string;
  let modelId: string;
  try {
    const result = await callProvider(
      parsedRequest.data.providerId,
      request.modelId,
      `Design proposal request:\n${json}\n\nReturn the complete template proposal JSON object with a "document" and a short "rationale".`,
      runtime?.useStructuredOutput ?? true
    );
    raw = result.raw;
    modelId = result.modelId;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unreachable";
    const safeMessages: Record<string, string> = {
      "provider-disabled": "The selected provider is disabled or missing its server-side credential.",
      "unknown-provider": "Unknown provider.",
      authentication_failed: "Provider authentication failed.",
      quota_limited: "Provider quota or rate limit reached.",
      timeout: "The provider did not respond in time.",
      "empty-response": "The provider returned an empty response.",
    };
    return {
      ok: false,
      errorCode: safeMessages[msg] ? msg : msg.startsWith("provider-http-") ? msg : "unreachable",
      errors: [safeMessages[msg] ?? "The provider request failed (redacted)."],
    };
  }

  let output: TemplateProposalOutput;
  try {
    const parsedUnknown = parseProposalJson(raw);
    const parsed = TemplateProposalOutputSchema.safeParse(parsedUnknown);
    if (!parsed.success) {
      return {
        ok: false,
        errorCode: "invalid-output",
        errors: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .slice(0, 5),
      };
    }
    output = parsed.data;
  } catch {
    return {
      ok: false,
      errorCode: "invalid-output",
      errors: ["Provider output was not valid JSON for a template proposal."],
    };
  }

  const issues = validateBuilderDocument(output.document);
  if (issues.some((i) => i.severity === "error")) {
    return {
      ok: false,
      errorCode: "invalid-output",
      errors: issues
        .filter((i) => i.severity === "error")
        .map((i) => `${i.path}: ${i.message}`),
    };
  }

  const proposal: StoredProposal = {
    proposalId: `prop_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    familyKey: request.familyKey ?? "professional-services",
    displayName: request.displayName,
    status: "proposal_review",
    document: output.document,
    rationale: output.rationale,
    providerId: parsedRequest.data.providerId,
    modelId,
    promptVersion: TEMPLATE_PROPOSAL_PROMPT_VERSION,
    inputHash,
    outputHash: sha(JSON.stringify(output.document)),
    createdAt: new Date().toISOString(),
    diff: diffBuilderDocuments(baseline, output.document),
  };
  const proposals = await readProposals();
  proposals.push(proposal);
  await writeProposals(proposals);
  return { ok: true, proposal };
}

export async function listProposals(): Promise<StoredProposal[]> {
  return readProposals();
}

export async function getProposal(proposalId: string): Promise<StoredProposal | null> {
  return (await readProposals()).find((p) => p.proposalId === proposalId) ?? null;
}

/** Accept: create a NEW draft version from the proposal. Never publishes. */
export async function acceptProposal(
  proposalId: string,
  actorId: string
): Promise<{ ok: true; versionId: string } | { ok: false; errors: string[] }> {
  const proposals = await readProposals();
  const idx = proposals.findIndex((p) => p.proposalId === proposalId);
  if (idx === -1) return { ok: false, errors: ["Proposal not found."] };
  const proposal = proposals[idx];
  if (proposal.status !== "proposal_review") {
    return { ok: false, errors: [`Proposal is ${proposal.status} and cannot be accepted again.`] };
  }

  const { templateVersionStore } = await import("@/lib/templates/version-store");
  const created = await templateVersionStore.createFamilyDraft({
    familyKey: proposal.familyKey,
    document: proposal.document,
    createdBy: actorId,
  });
  await templateFamilyStore.register({
    familyKey: proposal.familyKey,
    displayName: proposal.displayName,
    createdBy: actorId,
    versionId: created.versionId,
  });

  proposals[idx] = { ...proposal, status: "accepted" };
  await writeProposals(proposals);
  return { ok: true, versionId: created.versionId };
}

/** Reject: no catalog side effect; the source version is untouched. */
export async function rejectProposal(
  proposalId: string
): Promise<{ ok: boolean; errors?: string[] }> {
  const proposals = await readProposals();
  const idx = proposals.findIndex((p) => p.proposalId === proposalId);
  if (idx === -1) return { ok: false, errors: ["Proposal not found."] };
  proposals[idx] = { ...proposals[idx], status: "rejected" };
  await writeProposals(proposals);
  return { ok: true };
}

export { TemplateProposalRequestSchema as ProposalRequestSchema };
