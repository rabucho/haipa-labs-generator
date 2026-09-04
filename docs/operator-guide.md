# Haipa Labs Operator Guide (plain language)

This is the everyday handbook for using the Omoka website factory. No
programming knowledge needed - just copy the commands into the terminal
(exactly as written) and press Enter.

---

## 1. Why do I see a login screen?

The tool is internal-only. Everything except the public site preview is
locked behind a login. There is **no self-signup** and **no default
password**: your account is created by you, once, with a command (below).

---

## 2. First-time setup (do these once)

Open a terminal in the project folder (in VS Code: Terminal > New Terminal)
and run these four commands **in order**.

**Step 1 - Start the database** (a small local data store the app needs):

```bash
npm run db:start
```

> Requires Docker Desktop to be running (look for the whale icon in your
> system tray). If you see an error, open Docker Desktop, wait until it says
> "Engine running", then try again.

**Step 2 - Create the database tables** (safe to run any time, never deletes
anything):

```bash
npm run db:migrate
```

**Step 3 - Add the database address to your .env.local file:**

Open `.env.local` in the project root and make sure this line exists
(create the file first by copying `.env.example` if you don't have one):

```text
DATABASE_URL=postgresql://omoka:omoka_local_dev_only@localhost:5432/omoka
```

**Step 4 - Create your login:**

```bash
npm run operator:create -- your.name@haipalabs.co.ke "Pick-A-Strong-Password"
```

- Replace the email and password with your own.
- Use at least 8 characters.
- This is the **only** way to get an account. If you forget the password,
  just run the same command again with a new one (it resets it).

Then start the website:

```bash
npm run dev
```

Open <http://localhost:3000>, sign in, and you're in.

---

## 3. Everyday use

| I want to... | Do this |
|---|---|
| Start a work session | `npm run db:start` then `npm run dev`, open <http://localhost:3000> |
| Finish for the day | Close the terminal (or Ctrl+C in it). Optionally `npm run db:stop` |
| Log out | **Sign out** link in the sidebar (bottom area) |
| Create a client project | Sidebar > **Projects** > **New project** |
| Preview a prospect site | Project > **Preview** (this is the clean public-looking page - no menus) |

Sessions last 12 hours, then you sign in again. Logging out immediately
cancels the session even on other tabs.

---

## 4. I forgot my password / want to change it

Run the create command again with the same email and a new password. It
resets the password and signs out all existing sessions:

```bash
npm run operator:create -- your.name@haipalabs.co.ke "New-Password-Here"
```

To see which operator accounts exist (emails only), start the database and
run:

```bash
docker exec omoka-db psql -U omoka -d omoka -c "SELECT email, role, created_at FROM users;"
```

---

## 5. The preview shows OLD WordPress content (cache)

WordPress content is cached so pages load fast (default: 1 hour). If you
edited something on the staging WordPress site and the preview still shows
the old version, refresh the cache in one of these ways:

**Option A - the refresh webhook (best).** If you set `REVALIDATE_SECRET`
in `.env.local` (any long random text), run:

```bash
curl -X POST http://localhost:3000/api/revalidate -H "x-revalidate-secret: YOUR_SECRET_HERE"
```

**Option B - clear the cache folder.** Stop the app (Ctrl+C), delete the
cache, start again:

```bash
Remove-Item -Recurse -Force .next\cache\fetch-cache
npm run dev
```

**Option C - wait.** It refreshes on its own after
`WORDPRESS_REVALIDATE_SECONDS` (default 3600 = 1 hour). To always see fresh
content while developing, set `WORDPRESS_REVALIDATE_SECONDS=30` in
`.env.local` and restart.

> Note: drafts, projects, briefs and media in the operator tool are **never**
> cached like this - this only affects the WordPress-fed site preview.

---

## 6. Where is my data?

| Data | Location | In Git? |
|---|---|---|
| Projects, briefs, media, drafts (local mode) | `.data/projects/` | No (ignored) |
| Operator logins + sessions (database) | Docker volume `omoka-db-data` | Never |
| WordPress credentials, AI keys | `.env.local` | Never - do not commit |
| Export artifacts (ACF JSON etc.) | `exports/` and per-project Exports page | Yes (safe, redacted) |

Deleting `.data/` removes local-mode projects. The database is not touched.
To wipe the database completely: `npm run db:stop`, then
`docker volume rm omoka_omoka-db-data`, then start and migrate again.

---

## 7. WordPress staging connection (optional)

To feed real staging WordPress content into a preview:

1. In `.env.local` set:
   - `WORDPRESS_API_URL=https://your-stating-site/wp-json`
   - (optional) `HOME_PAGE_ID=<number>`
2. Restart `npm run dev`.
3. The preview now shows the live staging content (through the approved
   design).

For pushing approved content TO staging (Slice 10), see
`docs/slice-10-wordpress-integration.md` and the per-project **WordPress**
step. It is disabled until `WORDPRESS_INTEGRATION_ENABLED=true`.

---

## 8. AI generation (optional)

Off by default. To enable real AI draft generation, set in `.env.local`:

```text
AI_GENERATION_ENABLED=true
AI_MODEL=<model your provider supports>
AI_API_KEY=<your key>
```

Restart the app. The Generate page then offers "AI" next to the always
available deterministic generator. AI drafts always land in **review** -
nothing is ever auto-approved.

---

## 9. If something breaks

| Symptom | Fix |
|---|---|
| Login says sign-in failed | Is the database running? `npm run db:start`. Does your account exist? Re-run `npm run operator:create`. |
| Every page is 404 after a crash | Stop the dev server, delete the `.next` folder, run `npm run dev` again. |
| `DATABASE_URL is not configured` | Add the DATABASE_URL line from Step 3 to `.env.local` and restart the terminal. |
| Preview shows "Content failed validation" | The staging WordPress page is missing required fields - fill them in WordPress, publish, then refresh the cache (Section 5). |
| Docker says engine error | Open Docker Desktop and wait for "Engine running", then retry. |
