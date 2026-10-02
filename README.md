# Prospecting Call Tracker

A real-estate prospecting/CRM app: leads, call queues, follow-ups, text
campaigns, a CRM pipeline, team admin and roles. Started from a single-file
HTML demo (the product spec) and rebuilt as a vanilla-JS, ES-module
front end on a Supabase (Postgres + Auth + RLS + Edge Functions) backend.

## Setup

Requirements: Node 22+, npm.

```bash
git clone <this repo>
cd prospecting-call-tracker
npm install
cp .env.example .env
npm run dev
```

Open the printed URL (`http://localhost:5173`). With the default `.env`
(`VITE_BACKEND=local`), the app runs entirely in the browser — leads, deals,
users and everything else live in memory and are saved to `localStorage`,
same as the original demo, no Supabase project required. One-click demo
sign-in buttons (`VITE_DEMO_LOGIN=true` by default) let you try the app as
each seeded role without a password.

### Env vars (`.env`, from `.env.example`)

| Variable | Purpose |
| --- | --- |
| `VITE_BACKEND` | `local` (default — in-browser demo data) or `supabase` (real backend, below). |
| `VITE_SUPABASE_URL` | Only used when `VITE_BACKEND=supabase`. Your project's API URL (Settings → API). |
| `VITE_SUPABASE_ANON_KEY` | Only used when `VITE_BACKEND=supabase`. Your project's anon key (Settings → API). |
| `VITE_DEMO_LOGIN` | Shows the one-click "sign in as" buttons. Leave `false`/unset for anything that isn't a demo/eval environment — a real deployment should never expose it. |

### Running against Supabase instead of the in-browser demo

1. Create a Supabase project (or run one locally with `supabase start` —
   see [supabase.com/docs/guides/cli](https://supabase.com/docs/cli)).
2. Apply the schema: `supabase db push` (against a hosted project) or
   `supabase start` (local — applies `supabase/migrations/*.sql`
   automatically). For a live deployment run `supabase/seed-production.sql` (settings only:
   no users, no logins, no sample data) and follow DEPLOY.md to create the
   first login. `supabase/seed.sql` is the demo seed (sample users and
   leads) for local evaluation only.
3. Deploy the edge functions in `supabase/functions/` (privileged
   operations only a service-role key can do — creating a real Auth user,
   resetting someone else's password, running an import, logging an
   activity, and the settings/permissions and org-backup writes):
   ```bash
   supabase functions deploy admin-create-user admin-reset-password \
     import-run log-activity org-backup save-permissions
   ```
4. Set `VITE_BACKEND=supabase`, `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` in `.env`, and turn `VITE_DEMO_LOGIN` off.

## Run

```bash
npm run dev        # dev server, http://localhost:5173
npm run build       # production build to dist/
npm run preview     # serve the production build locally
```

## Test

```bash
npm test            # unit tests (vitest)
npm run test:e2e     # end-to-end tests (Playwright) — see below
```

`npm run test:e2e` builds the app and serves it with `vite preview`
automatically (`playwright.config.ts`'s `webServer`), then runs
`tests/e2e/*.spec.ts` against it with Chromium. It doesn't need a Supabase
project — the suite runs against the default `local` backend, driving the
UI directly and reading/writing `window.db`/`window.state` (both exposed by
`src/main.ts` for exactly this) to set up fixtures without depending on the
exact contents of the seed data.

Covers: login (demo one-click, real email/password, wrong password),
create a lead, log a call attempt, mark a follow-up done, list → campaign →
mark sent → log a reply, import a sample CSV, add a lead to the CRM → drag
to a new stage → edit its price, admin creates a user who's forced to
change their password on first sign-in, an owner edits and saves a role's
permissions, and every export/backup download in Settings → Data & exports.

### Performance

Measured by `tests/e2e/performance.spec.ts`, which seeds 10,000 leads and
2,000 deals directly into `window.db` (bypassing the UI, the way a real
bulk import would land the same volume of rows) and times the first
`window.draw()` render of each screen. Last measured on the machine this
suite last ran on (re-run `npm run test:e2e` to reproduce on yours):

| Screen | Rows | First render | Target |
| --- | --- | --- | --- |
| Leads (`#leads`) | 10,000 leads | **~110–230ms** | < 1,500ms |
| CRM Pipeline (`#crm`) | 2,000 deals | **~540–740ms** | < 1,500ms |

Both are well under target without any changes to `filteredLeads()`'s
search — it's a synchronous per-keystroke filter over the in-memory array
(`src/features/leads.ts`), and at these row counts a full re-filter still
finishes fast enough that no debounce was needed to hit the 1.5s target or
to keep typing responsive; the suite's third performance spec types a
15-character query against 10,000 loaded leads as a regression guard (not
a strict timing gate) to catch a future regression that made it lag.
(If a future dataset size ever needs one, the search input's `oninput`
handler is the one place to add it — `views/leads.ts`'s
`oninput="state.q=this.value;state.page=0;redrawKeepFocus()"` — without
changing any markup or `data-testid`.)

## Deploy runbook

The app is a static bundle (`vite build` → `dist/`) plus a Supabase
project. There's no server to run beyond Supabase itself.

1. **Database**: apply migrations to your Supabase project —
   `supabase db push` (or `supabase migration up` against a linked
   project). Migrations are ordered and idempotent-by-numbering in
   `supabase/migrations/`; don't skip or reorder them.
2. **Edge functions**: `supabase functions deploy` each function under
   `supabase/functions/` (see the list in Setup above), or
   `supabase functions deploy` with no name to deploy all of them.
3. **Auth**: in the Supabase dashboard, turn off public sign-ups if you
   don't want them (users are created through Admin → Users, which calls
   the `admin-create-user` edge function with a service-role key — not
   through Supabase's own sign-up flow), and set the site URL / redirect
   URLs to match where you're hosting the front end.
4. **Front end build**:
   ```bash
   npm ci
   npm run build
   ```
   sets `VITE_BACKEND=supabase`, `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` at build time (via `.env` or your host's build
   environment variables — Vite inlines `VITE_*` vars into the bundle at
   build time, so they must be set *before* `vite build`, not just at
   runtime) and **leave `VITE_DEMO_LOGIN` unset/false** — the demo
   one-click sign-in buttons should never ship to a real deployment.
5. **Host `dist/`** on any static host (Netlify, Vercel, Cloudflare Pages,
   S3+CloudFront, GitHub Pages, etc.) — it's a single `index.html` plus
   hashed assets, no server-side rendering or special routing needed
   (the app is hash-routed: `#leads`, `#crm`, etc., so no rewrite rules are
   required for deep links).
6. **Smoke test**: sign in as a real user, create a lead, and confirm an
   export downloads — the fastest way to catch a missed env var or an
   undeployed edge function.

## CI

`.github/workflows/ci.yml` runs on every push/PR to `main`: unit tests
(`npm test`), the Playwright e2e suite (`npm run test:e2e`, Chromium via
`playwright install --with-deps`), and `supabase db lint` against the
migrations in `supabase/migrations/` (via `supabase db start` on the
runner's Docker, using `supabase/config.toml`).
