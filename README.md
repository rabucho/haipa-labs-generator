# Omoka (Haipa Labs Generator)

A design-first, contract-driven headless frontend built with **Next.js (App Router)**, **TypeScript**, and **Zod**.

This is **Slices 1–2** of the Haipa Labs design-first website generator: a single-site, premium Home template whose visual design is fully controlled by React, while all business content flows in from WordPress (ACF) through a strict, validated adapter — with a local fixture fallback for development. Slice 2 adds a deterministic, reviewable pipeline that converts the approved `ContentInventory[]` into a versioned ACF field-group definition and a WordPress-to-React mapping report.

**Slice 1–2 scope:** one site, local fixtures, schema validation, a pure WordPress read adapter, preview, content inventory, mapping review, and tests. **Not included:** authentication, database, multi-tenancy, live ACF field creation, AI APIs, n8n, Flowise, M-Pesa, social posting, billing, or deployment automation.

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
npm test          # vitest run (54 tests)
npm run export    # writes exports/*.json (offline, deterministic)
```

Coverage includes: validation (valid/invalid content, path-specific errors), the WordPress adapter (mapping, image normalization, stable IDs, required-field failures, fallback policy), template rendering, inventory completeness, raw-type isolation, and the Slice 2 generators (determinism, duplicate rejection, repeater nesting, required/maxLength preservation, image return format, design-controlled exclusion, no network access).

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

Routes: `/` (redirects to dashboard) · `/dashboard` (operator hub) · `/preview` (generated-site preview) · `/inventory` (editable-content report) · `/mapping-review` (ACF definition + mapping review with copyable JSON).

Copy `.env.example` to `.env.local` and set `WORDPRESS_API_URL` (and optionally `HOME_PAGE_ID`) to pull live ACF content. Without it, development renders from the fixture; production fails with a clear configuration error.

## ✅ Verified vs. prepared (honest status)

**Fully verified:** schema validation with path-specific errors; pure typed adapter; env-gated fixture fallback; branded production config error; last-known-good snapshot; deterministic ACF field-group + mapping generators with validation (duplicates, missing wpName, invalid types, empty repeaters); `/mapping-review` page; offline JSON exports; 54 passing tests; typecheck; lint; production build.

**Prepared but NOT verified against a live system (later slices):** live WordPress editing (Slice 3), ACF field creation (Slice 2 produces a reviewable export only — the ACF-native import transformer is a future step), multi-tenancy/tenant auth, on-demand webhook revalidation, durable last-known-good persistence, and publication/rollback.

## 📝 License

Private Repository. All Rights Reserved.