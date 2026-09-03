# Slice 17 — Explicit Project Template Migration & Demo Delivery

## Workflow (all project-scoped, authenticated)

```
Pinned project → choose published target version → read-only compatibility plan
→ execute (confirm): backup + NEW review draft → operator reviews pages
→ approve migrated draft → explicit assignment migration (confirm)
→ rollback available at every step → demo package snapshot
```

## Stage A — Planner (`buildMigrationPlan`)

Deterministic, **zero network**. Compares the project's current template
manifest with the target **published** builder version (draft/review/archived
targets rejected). Returns pagesAdded/Removed, sectionsReordered,
`fieldsPreserved`/`fieldsMissing` (page-aware inventory), warnings, and a
`planHash` (SHA-256 of the canonical plan). Missing pages are warnings —
content is never invented; disabled-page fields are reported, not silently
dropped.

## Stage B — Execute (`executeMigration`, requires `{ confirm: true }`)

Re-validates the plan hash server-side, then creates:

1. An immutable **backup** (`.data/projects/<id>/template-backups.json`):
   source templateId, draft pointer, full draft content, approved state.
2. A **NEW review-status draft** carrying the preserved content, tagged
   `template-migration:<planHash>`.

Idempotent per (planHash, sourceDraftId) — re-execution returns the existing
migration. No draft without an existing source (no invented content). Zero
network calls (fetch-spy test).

## Stage C/D — Approval & assignment migration

`migrateAssignment` requires the migrated draft to be **explicitly approved**
and `{ confirm: true }`; it then sets `project.templateVersionId` to the
target versionId atomically and marks the record `assignment_migrated`.
`rollbackMigration` restores `templateVersionId = null` and the source draft
pointer. Approval is bound to the migrated content hash and plan hash; any
edit/regeneration returns the draft to review, invalidating assignment.

## Stage E — Demo package (`buildDemoPackage`, `?demo=true`)

Project-scoped internal artifact: project/template/schema versions, content
hash, enabled pages, approval + staging states, and internal references
(preview/inventory/exports/wordpress). Honest status ladder:
`draft → reviewed → approved → staging-synced → read-back-verified →
demo-package-ready`; when staging verification has not run, the package says
`stagingVerificationPending: true`. Internal references only — no public
route, no deployment, no WordPress calls.

## Safety summary

- Publishing/defaults never migrate projects (test-proven).
- Preview/execute/demo = zero WordPress/provider calls (fetch-spy tests).
- Plan-hash mismatch (content or target changed) blocks execution.
- Isolation: plans/records/demo packages are project-scoped; B's content
  never appears in A's plan (test-proven).
- Live provider/staging verification remains **pending** operator-side.

## Deferred

Per-page WordPress bindings, richer section variants, native SiteContent
persistence, AI-proposal provider UI polish.
