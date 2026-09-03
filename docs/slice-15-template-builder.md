# Slice 15 — Visual Templates Builder & Immutable Template Versions

## Model

```
familyKey → immutable TemplateVersion (versionId, status, BuilderDocument, contentHash)
          → project assignment (projects store their own pinned template id)
          → defaultVersionId affects NEW projects only
```

Persistence: `.data/templates/versions.json` + `meta.json` (gitignored,
local-repository convention; interface ready for a database swap).

## Builder document (constrained, strict schemas)

`src/types/builder.ts` — `BuilderDocumentSchema`:
- `templateVersion` semver-like string.
- `designTokens`: approved keys only (`--color-*` hex colours, `--button-style`
  solid/outline/pill, `--radius-scale` sharp/soft/round) — `.strict()`.
- `pages[]`: pageKey (home/about/services/faqs/contact), enabled flag,
  ordered `sections[]` with `sectionType` limited to the five approved
  registered renderers. `.strict()` everywhere — no unknown keys, so raw
  JSX/HTML/JS cannot enter through any field.

Validation (`validateBuilderDocument`): duplicate keys/ids/orders, Home
required+enabled, per-page required sections, unsafe script-like content.

Semantic diff (`diffBuilderDocuments`): pages added/removed/disabled,
sections added/removed/**reordered** (by stable instanceId, never JSON
equality), token changes, shell changes, and `projectsAffected: "no"` always.

## Routes

- `/templates` — catalog (family, version, status, page/section counts,
  based-on, hash, default flag) + duplicate-as-draft form.
- `/api/templates` (GET/POST), `/api/templates/[versionId]` (GET/PUT),
  `/api/templates/[versionId]/actions` (submit-review / publish /
  set-default / archive; publish + set-default require published status and
  explicit confirmation).
- `/templates/[versionId]` — constrained editor: token colours, button
  style, page toggles (Home locked), section reorder; semantic diff vs the
  based-on version; validation errors; no edit path for published versions.
- `/templates/[versionId]/preview` — REAL registered section components +
  SiteShell, with approved tokens applied as CSS-variable overrides.

## Invariants enforced (test-proven)

- Published versions are immutable; saving is draft-only (`immutable` error).
- Editing a published version = duplicate-as-draft (`basedOnVersionId` set).
- Content hash changes with the document; unchanged saves rejected
  (`hash-unchanged`) so duplicate saves never create ambiguous versions.
- Publish requires passing validation; `set-default` requires published
  status and the UI states it affects new projects only.
- Archived versions remain readable; the default cannot be archived.
- Zero WordPress/network calls in the entire store (fetch-spy test).
- Existing projects stay pinned: project assignment is untouched by any
  builder action; migration remains a future explicit workflow.

## AI proposals & future migration

AI proposal schema/boundary is documented but intentionally not wired to a
provider UI in this slice (schema-first boundary delivered in Slices 7/12
applies). Project migration workflow (compat analysis → diff → backup →
preview → approve) remains the documented next step.

## Verification

Contract tests only (16 Slice 15 tests); no live provider calls performed.
