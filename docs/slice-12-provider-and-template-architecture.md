# Slice 12 — Provider Registry & Multi-Page Template Foundation

## Stage A — Provider registry

`src/lib/generation/provider-registry.ts` (server-only) + `getProviderRuntimeConfig`
(`src/lib/generation/config.ts`).

| Provider id | Transport | Config (server env, names only) | Cost label | Structured output |
| --- | --- | --- | --- | --- |
| `deterministic` | local | — (always available) | local | n/a |
| `ai` (legacy cloud) | openai-compatible | existing `AI_*` vars | paid | yes |
| `ollama` | ollama (local `/v1/`) | `AI_OLLAMA_ENABLED`, `AI_OLLAMA_BASE_URL`, `AI_OLLAMA_MODEL` | local | no — text parsed + strict Zod |
| `gemini` | openai-compatible endpoint | `AI_GEMINI_ENABLED`, `AI_GEMINI_MODEL`, `AI_GEMINI_API_KEY` | free-tier* | yes |
| `openrouter` | openrouter | `AI_OPENROUTER_ENABLED/_BASE_URL/_API_KEY/_MODEL` | unknown (per model) | yes |

*Free-tier is an operator-facing label only. **No model is promised free,
unlimited, or permanently available** — quotas, prices, and terms are
provider-controlled and can change.

Safety rules implemented:

- Credentials resolved server-side per request; descriptors never contain
  base URLs with keys, credentials, prompts, or raw responses.
- Every provider output passes the same `AiHomeContentSchema` →
  `mapAiResponseToHomeContent` → `HomeContentSchema` chain.
- **No silent fallback** — `resolveGenerationProvider` returns a visible error
  (`unknown-provider` / `unconfigured` / `disabled`) rendered as a 409.
- Ollama: disabled by default, `maxRetries: 0`, text-mode JSON parsing, local
  hardware/quality/latency caveats surfaced in the operator note.
- OpenRouter: model discovery via `/models` with 60-second bounded cache,
  safe metadata only (id, name, context length, price label); the
  `openrouter/free` router is non-deterministic and development-oriented —
  the resolved provider/model is stored with every draft.
- Generation metadata records provider id + model id (never credentials).

## Stage B/C — Multi-page template contract

`src/types/pages.ts`:

- `PageKey` = home | about | services | faqs | contact | shop.
- Strict page schemas (`AboutPageSchema`, `ServicesPageSchema`,
  `FaqsPageSchema`, `ContactPageSchema`) — same limits as the Home contract.
- `SiteContentSchema` (schemaVersion `"2.0"`): page-keyed envelope.
- `siteContentFromHomeContent()` — compatibility adapter; legacy Home-only
  drafts derive the envelope at render time and are **never rewritten**.
- `PAGE_MANIFEST` + `enabledPages()`: navigation/preview/inventory/exports
  are generated from the manifest. `shop` is a WooCommerce capability only —
  absent everywhere unless explicitly enabled with a verified catalog source
  (no fake products/prices/reviews).

`src/lib/templates/pages.tsx` + `src/components/site/SiteShell.tsx`:

- `renderProjectPage()` renders one enabled page through the shared site
  shell using the SAME approved section components (no second design family).
- `SiteHeader`/`SiteFooter` are design-controlled; nav comes from the
  manifest (desktop list + accessible mobile `<details>` drawer, active
  `aria-current`, focus-visible styles, reduced-motion respected).

Preview: `/projects/[projectId]/preview/[pageKey]` (authorized, disabled
pages → 404). Existing `/projects/[id]/preview` and `/preview` unchanged.

## Future Templates Builder — versioning contract (plan only)

```
Template family/key → immutable template version
  → page manifest + renderers + design tokens + schemas + mappings
  → project template assignment (pinned key@version)
```

A project assigned `key@1.0.0` never changes when `key@1.1.0` is published.
New versions are saved immutably (draft → published states), projects may be
migrated only via an explicit diff/backup/compat-check/approve/rollback
workflow. AI-generated template code requires schema, security, visual, and
human review before activation. Implementation is deferred — no Builder
navigation entry is shown as functional.

## Deferred

Page-keyed inventory prefixes/ACF page groups in exports and WordPress
mappings (current Home mappings unchanged and verified), Shop/WooCommerce
catalog integration, real vision-capable providers, provider-specific UI
model pickers beyond OpenRouter discovery.
