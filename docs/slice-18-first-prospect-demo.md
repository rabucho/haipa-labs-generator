# Slice 18 — First Prospect Demo QA & Operator Runbook

Status labels used throughout: **implemented** (code + tests), **contract-tested**
(verified against stubs only), **live-verified** (real external system), and
**blocked by configuration** (requires operator-side credentials/infrastructure).

## 1. What this slice adds

- **Project-scoped demo QA checklist** (`src/lib/qa/checklist.ts`, persisted at
  `.data/projects/<projectId>/qa-checklists.json` — honors `PROJECTS_DATA_DIR`).
- **26 required checks** across content, design, navigation, responsive,
  exports, staging, provider, and migration categories.
- **Honest readiness ladder** computed from server-side evidence only.
- **API**: `GET/POST /api/projects/[projectId]/qa` (list/assess, create,
  update-check) behind the existing operator guards.
- **Demo package integration**: `buildDemoPackage` now includes a `qa` block
  (checklist id, readiness state, pass/fail/pending counts, binding state).
- **Operator runbook** (below) with safe stop conditions.

## 2. QA checklist model

Every checklist is bound to the exact tuple:

```
projectId + templateVersionId + contentHash + schemaVersion
```

- Creation is **idempotent**: the same hash+version returns the existing
  checklist instead of creating an ambiguous duplicate.
- Creation requires an **approved draft bound to an immutable template
  version** — a project without one gets an actionable error, never invented
  content.
- Any content/template change makes the old checklist **stale**:
  `findCurrentChecklist` returns null for a new hash/version and the demo
  package reports `boundToCurrentContent: false`. Old checklists are retained
  as history and never deleted.

## 3. Readiness ladder (no skipped states)

```
not_started → in_progress → blocked → reviewed → approved
→ staging_synced → read_back_verified → demo_package_ready
```

Hard rules enforced by `assessReadiness`:

| Rule | Mechanism |
|---|---|
| Any failed check → `blocked` | `contentState` computation |
| All checks pending → `not_started` | ditto |
| Checks complete but no approved draft → stops at **`reviewed`** | `approvalVerified = false` |
| `approved` requires the checklist's bound hash to equal the **server-side approved draft's hash** | hash comparison |
| `demo_package_ready` requires a real verified read-back in append-only sync history | `readBackVerified` from history |
| Stubbed tests can never transition live states | states derive from repositories, never from check statuses |

If staging is not configured, the honest label is
**`demo_package_prepared — staging verification pending`**
(`stagingVerificationPending: true`); nothing implies staging success.

## 4. QA checks (Stage B)

Content: business name from brief · contact details only when supplied ·
services match brief · `[For review]` markers resolved or explicitly accepted ·
no invented claims/certifications/awards/statistics/reviews/ratings/prices ·
coherent headings/CTA · length limits pass · every enabled page valid.

Design/responsive: all five pages render · Shop only when WooCommerce is
actually enabled · desktop + mobile previews · SiteShell header/footer ·
navigation follows manifest · disabled pages hidden · heading hierarchy,
landmarks, focus, keyboard, reduced motion · no broken media.

Version/isolation: intended immutable template version in use · migration
evidence present when deliberately migrated · Project A cannot see B's QA data.

Exports/WordPress: ACF export matches template/schema · mapping export covers
inventory · content export hash matches approved draft · dry run inspected
before sync · sync and read-back statuses explicit.

Provider: verification status recorded as **contract-tested vs live-tested**;
a contract-tested provider is never displayed as live-verified.


## 5. Operator runbook — first prospect demo

1. Use a **fictional** project first; no real customer data.
2. Select a published immutable template version (Templates catalog).
3. Enter the brief and media (`/projects/<id>/brief`, `/media`).
4. Generate deterministic content as the baseline (`/generate`).
5. Optionally generate with ONE explicitly selected live provider.
6. Review every page (`/review`); resolve every `[For review]` marker that
   should not reach the prospect.
7. Verify content quality and absence of unsupported claims (QA checklist).
8. Verify desktop/mobile previews and navigation on all enabled pages.
9. Verify exports and hashes (`/exports`).
10. If changing template versions: migration preview → backup → review →
    approval → explicit assignment migration (`/template-migration`).
11. WordPress staging: diagnose → verify page → dry-run diff (`/wordpress`).
12. Sync approved content **only** with the explicit confirmation dialog.
13. Read back and validate (`read-back verified`).
14. Generate the demo package and confirm the readiness status honestly.
15. Present to the prospect only after operator review.

### Safe stop conditions

Stop and resolve before continuing when any of these occur:

- Provider configuration missing or provider output invalid.
- Content contains unsupported claims (awards, statistics, guarantees…).
- Missing contact facts (never invent phone/email/address).
- Migration compatibility warning unresolved.
- Staging target unavailable or page binding unverified.
- Read-back mismatch (`sync_succeeded_readback_failed`).
- Credentials or private data appear in any output/log (treat as an incident).

## 6. Operational verification records (Stage G)

These remain **operator-manual** and must never be marked complete by tests:

| Gate | Status |
|---|---|
| Live AI provider (Ollama / Gemini / OpenRouter) | **blocked by configuration** — record provider id, exact model, timestamp, duration, validation + review outcome |
| Migration click-through | **pending** — record source/target versions, plan hash, backup id, migrated draft id, approval id, assignment result |
| WordPress staging round-trip | **pending** — record diagnosis, dry-run, explicit sync, read-back, schema validation results |

## 7. Verification

Automated (this slice): 16 new tests in `tests/slice18.test.ts` covering
checklist binding/idempotency, project scoping, invalidation on
content/template change, evidence updates with bounded evidence, unknown
check/checklist rejection, the full readiness ladder including the
"no approval without server evidence" rule, stale-hash behavior, and demo
package QA integration with zero network calls.

## 8. Slice 19 additions

### Repository hygiene

- `npm run lint` now runs `eslint src tests` directly (the old `next lint`
  script was broken under Next.js 16).
- `git diff --check` is clean; trailing blank lines at EOF were trimmed from
  the generate route and GenerateButton.
- Test/debug artifacts (`.slice15/16/17-templates/`, `s16.txt`,
  `slice16-fail.txt`) were removed from Git and gitignored — they are
  generated by the test suites, never fixtures.
- `middleware.ts` migrated to the Next.js 16 `proxy.ts` convention (same
  cookie-presence gate; full verification still server-side in the guards).
- Page-by-page preview verification: `buildPagePreviewChecks()` enumerates
  every enabled manifest page (Shop only when WooCommerce is enabled) with
  render/navigation/responsive/a11y checks and internal preview references.
  Automated pixel-perfect visual QA is NOT claimed — the operator records
  evidence manually per page.
- Readiness ladder honesty: sync without verified read-back stops at
  `staging_synced`; live evidence with an incomplete checklist reports the
  furthest verified step, never `demo_package_ready`.

### Troubleshooting table

| Symptom | Likely cause | Action |
|---|---|---|
| PostgreSQL unavailable | Docker Desktop stopped / container down | `npm run db:start`; verify `docker ps` (omoka-db healthy) |
| Missing provider configuration | AI env vars unset | Set `AI_GENERATION_ENABLED=true` + provider vars in `.env.local`; restart the server |
| Invalid provider output | Non-JSON / extra keys / HTML from the model | Safe error code is shown; retry once or switch the explicit model — never a silent fallback |
| Unsupported content claim | Brief lacks facts; `[For review]` markers present | Fill facts in the brief or explicitly accept markers in review; never invent |
| Migration incompatibility | Target version changes pages/schema | Read the plan warnings; resolve or choose a compatible target |
| Staging authentication failure | Application Password wrong/revoked | Recreate the Application Password; update only the secret-reference value in `.env.local` |
| Staging dry-run mismatch | Field names or page binding drifted | Re-verify the page binding; re-check the ACF import on staging |
| Read-back schema failure | ACF import incomplete or values empty | Complete the manual ACF import; fill required fields; re-sync |
| Export/hash mismatch | Content changed after export | Re-run `npm run export`; confirm the QA checklist is bound to the current hash |
| Credential leakage concern | Secret seen in any output/log | Treat as an incident: rotate the credential, purge logs, re-run `git ls-files` checks |
