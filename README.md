# Omoka (Haipa Labs Generator)

A design-first, contract-driven headless frontend built with **Next.js (App Router)**, **TypeScript**, and **Zod**.

This is **Slices 1–4** of the Haipa Labs design-first website generator: a single-site, premium Home template whose visual design is fully controlled by React. Slice 1 built the fixture-driven template and content inventory; Slice 2 the deterministic ACF field-group/mapping generators with operator review; Slice 3 the live staging WordPress integration (real edit → publish → React render, proven on staging); Slice 4 the **internal operator draft editor** with locally persisted draft/published snapshots, schema validation, and rollback.

**Slice 1–4 scope:** one site, schema validation, live staging WordPress reads, reviewable ACF mapping export, internal draft editor with local publish + rollback. **Not included:** customer-facing authentication, multi-tenancy, live WordPress content updates from the editor, billing, AI generation, n8n, Flowise, M-Pesa, social posting, or deployment automation.

## 📝 Internal Draft Editor (Slice 4)

`/editor` is an **internal Haipa Labs operator tool** (not customer-facing):

- Fields are generated from the explicit `ContentInventory` (label, stable `wpName`, type, required, max length) — never from Zod internals.
- Draft and published snapshots are **locally persisted JSON** under `.data/` (gitignored, dev-only) behind a `DraftRepository` interface so a future slice can swap in tenant-scoped storage. `siteKey` is carried in every method; today there is exactly one site and **no tenant isolation**.
- Saving a draft validates it against `HomeContentSchema` and **rejects unknown field names**; invalid drafts never replace the last known-good published snapshot. **No WordPress update API is ever called.**
- The editor shows current draft value, original published value per field, validation errors, unsaved-change state, last-saved time, and draft/published content hashes; services/FAQs rows keep their stable IDs across edits.
- `/preview?source=draft` and `/preview?source=published` render the snapshots through the same `HomeTemplate`; `/publication-status` shows hashes, timestamps, unpublished-changes state, and **confirmed rollback** of the local snapshot only.

---

## 🔄 The Full Design-First Flow

```
Approved React design
        │
        ▼
ContentInventory[]              ← approved editable-field metadata (src/content/content-inventory.ts)
        │
        ▼
AcfFieldGroupDefinition + FieldMapping[]   ← pure generators (src/lib/schema/generate.ts)
        │
        ▼
Operator review                 ← /mapping-review page + exports/full-export.json
        │                        (review ONLY — no WordPress changes in Slices 1–2)
        ▼
[FUTURE] WordPress field creation (explicit operator approval, Slice 3+)
        │
        ▼
WordPress REST JSON             ← external format, typed in src/types/wordpress.ts
        │
        ▼
mapWordPressHome(raw)           ← pure adapter in src/lib/content/wordpress.ts
        │
        ▼
validate HomeContent            ← Zod guard in src/lib/content/validate.ts
        │
        ▼
HomeTemplate                    ← src/components/HomeTemplate.tsx (validated content only)
        │
        ▼
Rendered React page             ← /preview
```

**Important:** editing `hero_title` in WordPress will change the displayed title **only after the live WordPress slice (Slice 3) and revalidation are implemented**. In Slices 1–2 the adapter is read-only and revalidation is time-based (`WORDPRESS_REVALIDATE_SECONDS`, default 3600s). A future slice will add protected on-demand revalidation triggered by a WordPress publish webhook.

## 🧩 Slice 2: schema & mapping generation

The pipeline `ContentInventory[] → AcfFieldGroupDefinition + FieldMapping[]` is implemented as **pure, deterministic functions** in `src/lib/schema/generate.ts`:

- `validateInventory(inventory)` — rejects duplicate `wpName` values, invalid field types, missing repeater subfields, and editable fields without a `wpName`.
- `generateAcfFieldGroup(inventory, version)` — deterministic ACF field-group definition (group key, title, front-page location rule, field tree with repeater subfields, required flags, max lengths, image return format, template key + schema version). Approved `wpName` values are preserved; existing fields are never renamed automatically.
- `generateFieldMappings(inventory, version)` — maps `acf.hero_title → hero.title`, `acf.services → services[]`, `acf.services[].services_title → services[].title`, etc.

**Review surfaces:**
- `/mapping-review` — shows template key/version, schema version, editable vs design-controlled counts, the full ACF field tree, the WordPress→React mapping table, validation warnings/errors, the migration note, and a copyable JSON export. It states clearly that **no live WordPress changes have been made**.
- `npm run export` writes deterministic JSON artifacts to `exports/` (see `exports/README.md` for the format and the future import step).

**Versioning & migration policy** (`src/content/schema-version.ts`): future design changes must create a new `schemaVersion` with an explicit migration plan. Existing customer fields are never silently deleted or renamed.

## 🛡️ Fallback & Error Policy

| Situation | Behaviour |
|---|---|
| No `WORDPRESS_API_URL`, `NODE_ENV=development` or `PREVIEW_MODE=true` | Render the local fixture (`home.fixture.ts`) |
| `PREVIEW_MODE=true` in any environment | Fixture allowed (for hosted preview deployments) |
| Production, no `WORDPRESS_API_URL` | **Branded configuration error** — the fixture is never rendered |
| WordPress unreachable / HTTP error / validation failure | Serve the **last-known-good validated snapshot** if one exists in the process |
| WordPress failure with no last-known-good snapshot | **Safe error state** — the fictional fixture is never shown |

## 📂 Repository Structure

```text
src/
├── app/
│   ├── page.tsx              # / → redirects to /dashboard
│   ├── dashboard/            # Operator hub (Preview, Inventory, Mapping Review)
│   ├── preview/              # Public generated-site preview (dynamic)
│   ├── inventory/            # Editable-content inventory report
│   └── mapping-review/       # ACF definition + mapping review page (copyable JSON)
├── components/
│   ├── HomeTemplate.tsx      # The single approved Home renderer (typed content only)
│   └── sections/             # Hero, About, Services, Faq, Contact, Footer (CSS Modules)
├── content/
│   ├── home.fixture.ts       # Local fixture content (development / PREVIEW_MODE)
│   ├── content-inventory.ts  # Approved editable-content inventory (explicit metadata)
│   ├── schema-version.ts     # Versioned schema record + migration note
│   ├── acf-field-group.sample.ts  # Legacy hand-written sample (superseded by the generator)
│   ├── field-mapping.example.json # Legacy example mapping sheet
│   └── wordpress-sample.ts   # Realistic raw WP response for offline adapter testing
├── lib/
│   ├── content/              # wordpress.ts (adapter + fallback policy), validate.ts (Zod guard)
│   └── schema/               # generate.ts (pure ACF/mapping generators + validation)
└── types/                    # content.ts, wordpress.ts, acf.ts, inventory.ts, schema.ts
tests/                        # Vitest suite (validation, adapter, generators, export, isolation)
exports/                      # Generated review artifacts (acf-field-group.json, field-mappings.json, full-export.json)
```

## 🧪 Tests

```bash
npm test          # vitest run (109 tests)
npm run export    # writes exports/*.json (offline, deterministic)
```

Coverage includes: validation (valid/invalid content, path-specific errors), the WordPress adapter (mapping, image normalization incl. numeric-ID media resolution, stable IDs, required-field failures, fallback policy), template rendering, inventory completeness, raw-type isolation, the Slice 2 generators (determinism, duplicate rejection, repeater nesting, required/maxLength preservation, image return format, design-controlled exclusion, no network access), the live staging capture acceptance gate, and the Slice 4 editor (inventory-driven form generation, valid/invalid draft save, unknown-field rejection, repeater ID stability, rollback, no-WordPress guarantee, one contract across fixture/live/draft/published).

## 🚀 Local Development

```bash
npm install
npm run dev        # http://localhost:3000 → /dashboard
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint (flat config)
npm run build      # production build
npm run export     # writes exports/*.json review artifacts
```

Routes: `/` (redirects to dashboard) · `/dashboard` (operator hub) · `/projects` (internal website factory — one project per prospect: `/projects/new`, project workspace, template, drafts, and project preview) · `/preview` (live/fixture, plus `?source=draft` and `?source=published`) · `/inventory` (editable-content report) · `/mapping-review` (ACF definition + mapping review) · `/editor` (internal draft editor) · `/publication-status` (snapshot status + confirmed rollback) · `/diagnostics` (dev/preview WordPress response shape) · `/api/revalidate` (protected cache invalidation).

Copy `.env.example` to `.env.local` and set `WORDPRESS_API_URL` (and optionally `HOME_PAGE_ID`) to pull live ACF content. Without it, development renders from the fixture; production fails with a clear configuration error.

## ✅ Verified vs. prepared (honest status)

**Fully verified:** schema validation with path-specific errors; pure typed adapter; env-gated fixture fallback; branded production config error; last-known-good snapshot; deterministic ACF field-group + mapping generators with validation (duplicates, missing wpName, invalid types, empty repeaters); `/mapping-review` page; offline JSON exports; 54 passing tests; typecheck; lint; production build.

**Prepared but NOT verified against a live system (later slices):** live WordPress editing (Slice 3), ACF field creation (Slice 2 produces a reviewable export only — the ACF-native import transformer is a future step), multi-tenancy/tenant auth, on-demand webhook revalidation, durable last-known-good persistence, and publication/rollback.

## 📝 License

Private Repository. All Rights Reserved.