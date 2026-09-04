# Slice 11 — Project-Scoped WordPress Connection, Page Binding, and Staging Diff

## Connection model

Each project carries safe, non-secret connection metadata:

| Field | Purpose |
| --- | --- |
| `targetKey` | Must be `"staging"` — the single server-allowlisted target (`WORDPRESS_STAGING_URL`). |
| `pageId` | Positive integer page id on the staging origin (optional). |
| `pageSlug` | Safe slug (`[a-z0-9-_]`, max 120) of the bound page (optional). |
| `credentialReference` | NAME of the server-side env variable holding the Application Password. The value is resolved at request time only. |
| `pageVerified` | Set server-side only after a successful read-only page lookup. |
| `connectedAt` / `lastDiagnosedAt` / `lastPageVerifiedAt` / `lastReadBackAt` | Timestamps for the UI status cards. |

Stored in `WebsiteProject.wordpressConnection`, persisted by **both** the local
(JSON) and database repositories via `ProjectPatch`. Raw credentials are never
stored in the project record, database, audit events, exports, logs, or browser
state.

## Secret-reference model

`WORDPRESS_AUTH_SECRET_REFERENCE` names the env variable that holds the
Application Password (e.g. `WORDPRESS_APPLICATION_PASSWORD`). The provider
resolves it server-side per request. The client view
(`GET .../wordpress/connection`) returns `authConfigured: true/false` — never
the reference name or value.

## Page-binding validation

`PUT .../wordpress/connection` validates:

1. `targetKey` against the allowlist (rejects arbitrary URLs/hosts).
2. `pageId` as a positive integer, `pageSlug` as a safe slug.
3. At least one of pageId/pageSlug.

A changed binding resets `pageVerified` and `lastPageVerifiedAt`, so a silent
page change is always visible to the operator.

`POST .../wordpress/verify-page` runs a read-only lookup through
`provider.locatePage` (GET `/wp-json/wp/v2/pages/{id}` or `?slug=…`,
`_fields=id,slug,status`). When bound by id with a slug configured, the slug
must match. Records a `page-verify` history entry.

## Diff semantics (`diffHomeContent`, pure)

Compares the **approved draft** against staging content normalized through the
existing `mapWordPressHome` + `HomeContentSchema` pipeline.

- Text, links, images: per-field old/new with 80-char display truncation.
- Services/FAQs: compared **by stable id** — added / missing / per-field
  changes; never by array index.
- Design-controlled values: excluded (they do not exist in `HomeContent`).
- Unmapped WordPress fields: excluded and explicitly stated as untouched.
- Deterministic: same inputs → identical diff; no network, clock, or randomness.

`POST .../wordpress/diff` performs exactly one WordPress GET (read-back) and
zero writes; it records a redacted `diff` history entry.

## Guided round-trip

```
Bind page → Verify page → Approve draft (Review step) → Diff → Confirm dialog → Sync → Read-back → Verified
```

Sync remains gated exactly as in Slice 10: integration enabled, page bound,
approved draft present, explicit `{ confirm: true }`. The result is labeled
"synced to staging / read-back verified" — never "published".

## Manual staging setup (unchanged from Slice 10)

1. Import the reviewed ACF JSON (Exports step) via WP admin → ACF → Tools.
2. Create/fill the staging page; note its id/slug.
3. Set server env: `WORDPRESS_INTEGRATION_ENABLED=true`, `WORDPRESS_STAGING_URL`,
   `WORDPRESS_AUTH_MODE=application-password`, `WORDPRESS_AUTH_SECRET_REFERENCE`,
   plus the referenced credential variable in `.env.local` (never committed).

## Rollback / limitations

- Local `.data` files remain untouched; local repository mode still works with
  the integration disabled.
- No automatic WordPress rollback: history records are append-only references.
- One allowlisted staging target per server; multi-target support is deferred.
- No live round-trip is claimed until the manual steps above are completed.
