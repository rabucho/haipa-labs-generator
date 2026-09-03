# Slice 10 — Project-Scoped WordPress Staging Sync & ACF Provisioning

## Current state (Slices 1–9)

- WordPress integration is **read-only** (Slice 3): a single global staging target
  configured via `WORDPRESS_API_URL` + optional Application Password.
- The `WordPressRestContentProvider` fetches pages/media and the pure
  `mapWordPressHome()` adapter maps raw ACF responses into validated `HomeContent`.
- Slice 9 added database-backed persistence, authenticated operator sessions,
  repository abstractions, project ownership, and centralized authorization guards.
- The `WebsiteProject` model already carries an optional
  `ProjectWordPressConnection` (`apiUrl`, `pageId`, `pageSlug`, `connectedAt`).

## Objective

Add a **project-scoped, staging-only WordPress integration** that can:

1. Inspect and validate the configured WordPress staging connection.
2. Perform a safe dry run showing exactly what would be written.
3. Provision the project's ACF field-group definition through an explicit
   integration boundary, only if the configured WordPress environment supports it.
4. Push only **approved** project content to the project's configured staging
   target after explicit operator confirmation.
5. Read the resulting WordPress content back through the existing adapter.
6. Record redacted, project-scoped sync history and results.

This is **staging verification only** — not production publishing or customer self-service.

## Endpoint capability matrix

| Operation | Endpoint | Auth | Writes | Notes |
| --- | --- | --- | --- | --- |
| Diagnose connection | `GET /wp-json/` + `GET /wp-json/wp/v2/pages` | Basic/App Password | No | Validates reachability + ACF exposure |
| Read page | `GET /wp-json/wp/v2/pages?slug=home` | Basic (if needed) | No | Existing read path |
| Read media | `GET /wp-json/wp/v2/media/{id}` | Basic (if needed) | No | Existing image resolution |
| Create/update page | `POST/PUT /wp-json/wp/v2/pages/{id}` | Basic (if needed) | Yes | Approved content sync |
| List ACF field groups | `GET /wp-json/acf/v3/field-groups` | Basic | No | Schema provisioning check |
| Create ACF field group | `POST /wp-json/acf/v3/field-groups` | Basic | Yes | Schema provisioning |

**Known limitation:** ACF's native REST API for field-group creation requires
either ACF Pro or the ACF to REST API plugin. If the staging site does not
expose `POST /wp-json/acf/v3/field-groups`, schema provisioning is offered as
a **download/export** of the ACF JSON definition for manual import via
WordPress admin (ACF → Tools → Import). This is the documented Slice 3 path.

## Authentication method

- **WordPress Application Password** (server-side only), configured via
  environment variables. The secret is stored **only** in `.env.local` (never
  committed, never logged, never sent to the browser).
- Variable names follow the existing convention: `WORDPRESS_API_URL`,
  `WORDPRESS_APP_USER`, `WORDPRESS_APP_PASSWORD`.
- Slice 10 adds project-scoped override variables:
  - `WORDPRESS_INTEGRATION_ENABLED=false` (master gate, disabled by default)
  - `WORDPRESS_STAGING_URL=` (validated against allowlist)
  - `WORDPRESS_AUTH_MODE=application-password`
  - `WORDPRESS_AUTH_SECRET_REFERENCE=` (server-side reference, not the secret itself)
  - `WORDPRESS_TIMEOUT_MS=30000`
  - `WORDPRESS_MAX_RETRIES=1`

## Data flow

```
Operator action (UI)
  → API route (auth guard → project access → draft access)
    → WordPressStagingProvider (server-only)
      → fetch() with Basic auth (server-side only)
    → Redacted result → audit/sync history
  → UI shows result (no credentials, no raw responses)
```

## Dry-run behavior

- **Zero network writes.** The dry run generates the ACF field-group definition
  and content mapping locally (pure functions), then simulates the write payload
  and returns a deterministic field diff.
- Rejects missing or unapproved drafts.
- Does not modify repositories or sync history (except a documented diagnostic record).

## Approval gate

- Only drafts with `approved: true` may be synced.
- Approval and synchronization are **separate** explicit operator actions.
- Approval never calls WordPress automatically.
- Editing a reviewed draft returns it to `review` (Slice 7), requiring
  re-approval before sync.

## Read-back validation

After a successful sync, the provider reads the page back through the existing
`WordPressRestContentProvider` + `mapWordPressHome()` adapter and validates the
result against `HomeContentSchema`. The sync is marked **verified** only when
read-back content passes validation.

## Sync history

Project-scoped sync records stored via a `SyncHistoryRepository`:

- Project ID, operator ID, operation type, draft ID, content hash,
  template key/version, schema version, mapping version, target identifier,
  started/completed timestamps, success/failure/unsupported status, safe error
  code, read-back verification status.

No credentials, raw responses, or raw prompts are stored.

## Rollback approach

Slice 10 does **not** implement automatic WordPress rollback. Failed syncs
preserve the previous known-good sync state and are clearly visible. A
recovery reference (previous content manifest) is provided. Automatic rollback
is deferred to a future slice.

## Known limitations

1. ACF field-group creation requires ACF Pro or the ACF to REST API plugin on
   the staging site. If unavailable, provisioning falls back to export/download.
2. Only one staging target is configured via environment variables. Per-project
   targets are not supported in this slice.
3. No media uploads in this slice — image references must already exist on the
   staging site.
4. No background jobs, webhooks, or production publishing.

## Required WordPress-side setup

1. WordPress 6.x with ACF 6.x installed.
2. Application Password created (Users → Profile → Application Passwords).
3. ACF field group with "Show in REST API" enabled (or ACF to REST API plugin).
4. Home page created and set as front page.
5. `WORDPRESS_API_URL`, `WORDPRESS_APP_USER`, `WORDPRESS_APP_PASSWORD` set in
   `.env.local`.
