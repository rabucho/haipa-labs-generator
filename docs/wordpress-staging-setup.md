# Staging WordPress Setup & Verification Checklist (Slice 3)

This is the **human-reviewed** process for connecting the Home template to one
staging WordPress site and proving the edit → publish → React render loop.
Nothing in this repository creates, updates, or deletes WordPress fields
automatically. **Use a staging site — never Haipa production or a customer site.**

## 1. Provision the staging site

1. Provision one WordPress site (e.g. `https://staging.<domain>.co.ke`).
2. Install and activate **Advanced Custom Fields (ACF) 6.x** (free tier is fine).
3. Note the site URL — it becomes `WORDPRESS_API_URL` (append `/wp-json`).

## 2. Import the approved ACF field group (human-reviewed)

1. Run `npm run export` in this repo.
2. Open `exports/acf-import.acf.json` — the approved field group converted to
   ACF's **native JSON import format** (schema v1, field names preserved
   exactly; nothing renamed or retyped).
3. Cross-check the field list against `/mapping-review` in this app.
4. In WordPress admin: **ACF → Tools → Import** → select
   `exports/acf-import.acf.json` → review the summary → **Import**.
5. Verify the imported group **"premium-professional-services-home — schema v1"**
   shows the expected fields and the location rule
   `Page type is equal to front page`.

## 3. Expose ACF data in the REST API

Verify how the staging site exposes ACF data — do not assume `raw.acf` exists:

- **Option A (preferred):** confirm **"Show in REST API"** is enabled on the
  imported field group (ACF 6.x; the export sets `show_in_rest: 1`). Fields
  then appear in the core `/wp-json/wp/v2/pages` response under an `acf` object.
- **Option B:** if your ACF version lacks the toggle, install the
  **"ACF to REST API"** plugin and confirm the `acf` object appears.

```bash
curl -s "https://<staging-host>/wp-json/wp/v2/pages?slug=home" | head -c 400
```

If the `acf` object is missing or shaped differently, record the actual shape
here and adjust **only the adapter** (`src/lib/content/wordpress.ts`);
React components stay untouched.

## 4. Create and fill the Home page

1. **Pages → Add New** → title "Home" → publish.
2. **Settings → Reading → Your homepage displays: A static page** → select
   "Home" (matches the `front_page` location rule).
3. Fill **every required field** (per `/mapping-review`): hero title/text,
   button text + URL, about title + body, services section title, 1–3 service
   cards, FAQs section title, 1–2 FAQs, contact title/phone/email, footer
   copyright. Upload a hero image (field uses **return format Array** — do not
   switch it to ID/URL without noting the adapter impact).
4. Note the page ID (visible in the edit URL) for `HOME_PAGE_ID`.

## 5. Capture the real REST response (sensitive values removed before sharing)

```bash
curl -s "https://<staging-host>/wp-json/wp/v2/pages?slug=home" \
  -o tests/fixtures/staging-home-page.json
```

- If the site is not publicly readable, create an **Application Password**
  (Users → Profile → Application Passwords) and fetch with
  `curl -u "<user>:<app-password>"` — credentials go ONLY in `.env.local`,
  never in the repo.
- Before committing a capture, strip tokens/keys/emails you do not want in
  the repo (staging content only).
- `tests/fixtures/staging-home-page.sample.json` is a shape template; once
  `staging-home-page.json` exists, the integration tests automatically
  validate the real capture too.

## 6. Configure the Next.js app (server-side only)

`.env.local` (never committed):

```
WORDPRESS_API_URL=https://<staging-host>/wp-json
WORDPRESS_PAGE_SLUG=home
# or HOME_PAGE_ID=42
# Only if the staging site is not publicly readable:
# WORDPRESS_APP_USER=haipa-operator
# WORDPRESS_APP_PASSWORD=xxxx xxxx xxxx xxxx
WORDPRESS_REVALIDATE_SECONDS=60
REVALIDATE_SECRET=<random-string>
```

## 7. Verify the first render

```bash
npm run build && npm run start   # production-like caching
# or: npm run dev
```

- `/preview` renders staging content with source banner **wordpress**
  (no banner = live content, no fallback in play).
- `/diagnostics` (dev/preview only) shows the **redacted** response shape,
  mapping status, and cache settings.

## 8. Prove the edit → publish → render loop

1. Note the currently displayed values (hero title/text/image, one service
   title, one FAQ answer, contact phone).
2. In WordPress, edit **hero_title, hero_text, hero_image, one service card
   title, one FAQ answer, and contact_phone**. Click **Update**.
3. Refresh the cached content:
   ```bash
   curl -X POST http://localhost:3000/api/revalidate \
     -H "x-revalidate-secret: $REVALIDATE_SECRET"
   ```
4. Reload `/preview` — the six edited values must change while layout,
   spacing, typography, and component structure stay identical.

### ⚠️ Cache gotcha (observed live)

`next start` serves WordPress fetches from a **persisted on-disk cache**
(`.next/cache/fetch-cache`) that survives restarts AND rebuilds. If the first
fetch happened while the fields were still empty, a restart alone will keep
serving the stale empty response until `WORDPRESS_REVALIDATE_SECONDS` elapses.
To see new content immediately, do ONE of:

- `POST /api/revalidate` with the `x-revalidate-secret` header (preferred —
  this is exactly what the future WordPress publish webhook will call); or
- delete the cache: `rm -rf .next/cache/fetch-cache` then restart; or
- wait out `WORDPRESS_REVALIDATE_SECONDS` (set it low, e.g. 60, while testing).

## 9. Expected REST/ACF exposure method (confirm on staging)

| Aspect | Expected | Confirm by |
|---|---|---|
| Endpoint | `GET /wp-json/wp/v2/pages?slug=home` (or `/pages/{id}`) | curl |
| ACF fields | `acf` object on the page, keys = approved wpNames | curl / /diagnostics |
| Image field | object `{ id, url, alt, title, … }` (return format Array) | curl / /diagnostics |
| Repeaters | array of objects keyed by subfield wpNames (`services_title`, …) | curl / /diagnostics |
| Auth | none for public reads; Basic auth (application password) only if required | curl |

## 10. If something differs

- **`acf` missing** → enable "Show in REST API" (Option A) or install the
  plugin (Option B); re-capture.
- **`acf` present but every value empty** → the fields have not been filled in
  yet. (Observed live 2026-08-30: the imported group exposed the correct field
  names with all values `""`, and empty `services`/`faqs` repeaters omitted
  from the response.) Open the Home page in WP admin, fill every required
  field, add at least one row to the `services` and `faqs` repeaters, click
  **Update**, re-capture, then POST `/api/revalidate`. `/preview` now shows
  this exact hint in its error state.
- **Image is a number** → expected behaviour: ACF's native REST exposure
  serializes image fields as attachment IDs regardless of the field's
  return-format setting (observed live 2026-08-31). The adapter resolves IDs
  automatically via the public `/wp-json/wp/v2/media/{id}` endpoint
  (`resolveHeroImage` in `src/lib/content/wordpress.ts`). No action needed;
  if resolution fails the image renders as absent rather than breaking.
- **Shape mismatch elsewhere** → adapt ONLY `mapWordPressHome` and the types
  in `src/lib/content/wordpress.ts` + `src/types/wordpress.ts`; never the
  React components; add/adjust tests with the real capture.
