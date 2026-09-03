# Slice 14 — Operational Verification Status

## Truthful status matrix

### Implemented AND contract-tested (automated, stubbed network)

- Provider registry, safe catalog, explicit model selection, `openrouter/free`
  gating with non-determinism warning; **no silent fallback**.
- **Provider diagnosis (new, Slice 14 Stage A):** `diagnoseProvider(id)` +
  `GET /api/projects/<id>/generation/providers?diagnose=<id>` — one bounded
  GET per provider reporting only safe statuses
  (`configured/unconfigured/reachable/unreachable/authentication_failed/
  model_unavailable/quota_limited/unsupported_capability`). No credentials,
  bodies, or headers in output (test-proven).
- Page-aware generation via the derived v2 envelope; strict page schemas;
  `[For review]` markers; stable repeater IDs; review/approval gates.
- Explicit 1.0 → 2.0 migration (preview + confirmed execute, idempotent,
  legacy draft preserved, zero network).
- Page-aware inventory (`buildPageAwareInventory`) and **new export kinds**
  (Slice 14 Stage D): `page-inventory` (`page-aware-inventory.json`) and an
  extended `full` export including the page manifest and page-aware
  inventory. Deterministic; design-controlled values and disabled Shop
  excluded (test-proven).
- Page-grouped `[For review]` markers and per-page preview links on the
  Review page (Slice 14 Stage C).
- WordPress staging connection, page verification, diff, sync, read-back,
  append-only redacted history (Slices 10–11).

### Implemented but NOT live-tested

- Real Ollama / Gemini / OpenRouter generation calls (require operator-side
  env config). Diagnosis + contract paths verified with stubbed fetch only.
- Real WordPress staging write/read-back round-trip (requires the operator's
  staging site + Application Password + manual ACF import).

### Deferred and intentionally out of scope

- Visual Templates Builder (Slice 15).
- Per-page WordPress bindings — superseded by the **documented Strategy 1**
  (see below).
- AI-generated template activation, vision-capable providers, WooCommerce
  catalog integration.

### Blocked by external configuration

- Live provider verification: needs `AI_OLLAMA_*` / `AI_GEMINI_*` /
  `AI_OPENROUTER_*` (+ key) in `.env.local`.
- Live staging round-trip: needs `WORDPRESS_INTEGRATION_ENABLED=true`,
  `WORDPRESS_STAGING_URL`, auth reference + Application Password, manual ACF
  import, and a disposable staging page.

## Stage E decision — WordPress page strategy: **Strategy 1**

One WordPress page carries all page-keyed ACF fields. Rationale: the
verified Slice 3/10/11 adapter and sync already read/write exactly this
shape; all five React routes render from the one read-back `HomeContent`;
the diff reports page-specific changes via stable paths; unrelated fields
are untouched. Recorded here and in the operator docs. Strategy 2 (separate
WP pages per route) was evaluated and rejected for this template because it
would require five bindings, five ACF groups, and a read-back aggregator for
no content benefit — revisitable for future multi-page WordPress designs.

## Stage B decision — draft representation

New drafts **continue to store validated `HomeContent`**; the v2
`SiteContent` envelope (templateKey, templateVersion, schemaVersion "2.0",
explicit page keys) is derived at render/export time through
`siteContentFromHomeContent()`. This was chosen over changing the
persistence schema because the page slices are exactly the HomeContent
sections, so no information is lost, all legacy drafts stay readable, and
the migration tool provides the explicit preview/execute path. Remaining
limitation: the envelope is not physically persisted; a future storage
migration (optional) would store it natively.

## Stages F & G — live verification

To be executed by the operator following
`docs/wordpress-staging-setup.md` and the migration endpoints; cannot be
truthfully claimed from stubbed tests. No success records were fabricated.
