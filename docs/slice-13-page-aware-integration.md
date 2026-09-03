# Slice 13 — Page-Aware Integration (Stages A–C complete)

## Stage A — Provider selector (wired)

`/projects/[id]/generate` now receives the safe provider catalog
(`listProviderDescriptors()` — availability, cost label, structured-output
support, operator note) and, when OpenRouter is enabled, its cached model
list. `GenerateButton` renders a provider select (unconfigured providers
disabled) plus an explicit OpenRouter model picker; the chosen model slug is
sent with the request and re-validated server-side by
`resolveGenerationProvider(providerId, modelOverride)`.

- `openrouter/free` requires `AI_OPENROUTER_ALLOW_FREE_ROUTER=true` and is
  always labelled non-deterministic/development-only in the UI and errors.
- The generate route persists `resolved.providerId` + `resolved.model` in
  metadata and audit records. No silent fallback anywhere.

## Stage B — Page-aware generation

Because the approved template stores all five pages' content in one validated
`HomeContent` (hero/about/services/faqs/contact/footer), one generation
already produces every enabled page. The v2 `SiteContent` envelope is derived
(`siteContentFromHomeContent`), so:

- Only enabled pages exist; Shop requires the WooCommerce capability.
- Strict page schemas validate each page's slice (`AboutPageSchema`, etc.).
- `[For review]` markers, stable service/FAQ IDs, and the review gate are
  preserved from Slices 6–7.
- Per-page provider routing (different models per page) is deferred — one
  full-draft operation per provider call remains the policy.

## Stage C — Explicit 1.0 → 2.0 migration

`src/lib/projects/site-migration.ts` + `GET/POST
/api/projects/<id>/migration`:

- **Preview** (read-only, no network): source `1.0` → target `2.0`, page
  field counts, `[For review]` markers grouped by page, warnings, and whether
  this content hash was already migrated.
- **Execute** (`{ confirm: true }`): creates a NEW review-status draft
  (source `manual`, `aiPromptVersion` marker `site-content-v2-migration:<hash>`)
  derived from the legacy draft. **Idempotent** — re-execution reuses the
  existing migrated draft. The legacy draft is never mutated; rollback is
  simply selecting the previous draft. No WordPress calls; project-scoped.

## Page-aware inventory

`buildPageAwareInventory()` (`src/lib/templates/page-inventory.ts`) maps
every editable field exactly once to its page key (hero/footer → home,
about → about, services → services, faqs → faqs, contact → contact);
design-controlled values excluded; deterministic. `reviewMarkersByPage()`
groups `[For review]` fields per page with stable repeater paths.

## Deferred to later slices (honest status)

- Page-grouped ACF JSON and mapping exports (current single Home ACF group
  already contains all five pages' fields; exports verified unchanged).
- Per-page WordPress staging bindings and per-page diff/sync (current
  verified flow binds one staging page carrying all ACF fields — correct for
  the one-page WordPress design).
- Page-aware review UI regrouping and page-scoped section regeneration
  (existing section regeneration remains gated as in Slice 7).
- Templates Builder (Slice 14).

All existing Slice 1–12 guarantees (auth, isolation, approval gates,
redaction, staging-only sync) are preserved.
