# Slice 16 — AI template proposals & blank template creation

## Stage A — Blank template creation (implemented)

`POST /api/templates` with `{ blank: true, blankInput }` where `blankInput`
follows `BlankTemplateInputSchema` (`src/lib/templates/blank.ts`): familyKey
(lowercase/hyphen), displayName, optional description, `enabledPages`
(Home always required), optional approved `designTokens` and shell variants.
`buildBlankDocument()` composes the approved section skeleton per enabled
page and runs the same strict document validation. Shop is capability-gated
server-side via `WOOCOMMERCE_ENABLED=true`; requesting it without the
capability fails with a visible error. The catalog "New blank template"
flow is live (no invented business content — structure only).

## Stage E — Family records (implemented)

`.data/templates/families.json` via `templateFamilyStore`
(`src/lib/templates/families.ts`): familyKey (unique), displayName,
description, createdBy/At, `defaultVersionId`, `versionIds[]`. Every
`createFamilyDraft` auto-registers the family; `setDefault` updates both the
global meta and the family record. No delete API exists, so versions can
never become unreadable. Family records never duplicate version data.

## Stage B–D — AI proposals (implemented, contract-tested)

`src/lib/templates/proposal-schema.ts` (pure) + `proposals.ts` (server-only)
+ `GET/POST /api/templates/proposals`.

- Request: familyKey?, displayName, industry?, audience?, designDirection?,
  requiredPages, providerId (`ai|ollama|gemini|openrouter`), modelId?,
  sourceVersionId?. Strict, bounded (20k chars).
- Prompt version `template-proposal-v1`; system prompt forbids
  JSX/HTML/CSS/JS, URLs, fabricated claims, and commerce content.
- Output: `{ document: BuilderDocument, rationale }` — strict schema, then
  `validateBuilderDocument` again. Text-mode providers are parsed defensively
  (no permissive repair); invalid output is a visible `invalid-output` error.
- Proposal saved as `proposal_review` with providerId, exact modelId,
  promptVersion, inputHash, outputHash, and semantic diff vs the baseline.
- Accept (`?accept=<id>`) creates a NEW draft version + family record; never
  publishes. Double-accept rejected. Reject has no catalog side effect.
- `openrouter/free` gated by `AI_OPENROUTER_ALLOW_FREE_ROUTER=true` and
  always labelled non-deterministic.
- No silent fallback; provider/model metadata redacted (no keys — test-proven).

## Live verification status

**Contract-only.** No live Ollama/Gemini/OpenRouter call and no WordPress
staging round-trip was performed in this slice. Stages G/H remain manual
operator steps per `docs/wordpress-staging-setup.md` and
`docs/slice-14-operational-verification.md`; record results only when they
actually run.

## Deferred

Richer section variants (current variants: default; variant registry schema
in place), project→new-version explicit migration workflow, media/vision
policy for proposals, multi-family catalog filtering UI.
