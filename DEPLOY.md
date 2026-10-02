# Deploying the Prospecting Call Tracker live

The app is a static Vite single-page app (frontend) + a Supabase project (Postgres database, Auth, and 6 Edge Functions). Deploying it live means three things: create the Supabase project, deploy the database + functions, then build and host the static frontend.

> **Read "Known risks before going live" at the bottom before putting real data in.** The certification gates (docs/certification/) found real, unfixed security gaps — most importantly, most tables have no row-level security, and an ordinary signed-in user can grant themselves admin permissions by calling the database REST API directly (GATE G3 F-01/F-02, GATE G5). Fine for a pilot with trusted users; not fine for untrusted ones.

---

## What's in this package

```
index.html, src/           the frontend (TypeScript ES modules, built by Vite)
tsconfig.json              strict TypeScript settings (npm run typecheck)
supabase/migrations/       0001–0019: full database schema, RLS, SQL functions
supabase/functions/        6 Edge Functions: admin-create-user, admin-reset-password,
                           log-activity, save-permissions, org-backup, import-run
supabase/seed-production.sql  LIVE seed: settings only, no people, no logins, no sample data
supabase/seed.sql             demo seed (sample users + leads). Do NOT run on a live project
supabase/config.toml       Supabase CLI project config
package.json               deps + scripts (dev / build / typecheck / test / test:e2e / verify)
.env.example               the three env vars the build needs
tests/                     unit, e2e (Playwright), security (G3), certification (G6/G7)
docs/                      spec, inventory, CHANGELOG, and all certification reports
```

Two backends exist. `VITE_BACKEND=local` (the default) is the demo mode — everything in the browser's localStorage, no server. **A live deployment uses `VITE_BACKEND=supabase`.**

## Prerequisites

- Node 22+ and npm
- A [Supabase](https://supabase.com) account (free tier works for a pilot)
- Supabase CLI: `npm i -g supabase` (or `npx supabase ...`)
- Anywhere that hosts static files for the frontend: Netlify, Vercel, Cloudflare Pages, S3+CloudFront, or any web server

## Step 1 — Create the Supabase project

1. supabase.com → New project. Pick a strong database password and a region near your users.
2. Note from **Settings → API**: the **Project URL** and the **anon public key** (these go in `.env`), and keep the **service_role key** secret (the Edge Functions use it server-side; never put it in the frontend).

## Step 2 — Deploy the database

From the project root:

```bash
supabase login
supabase link --project-ref <your-project-ref>     # ref is in your project's URL
supabase db push                                    # applies supabase/migrations/0001..0019 in order (do not add --include-seed)
```

Then run the **production seed**: open the Supabase SQL Editor and run the contents of `supabase/seed-production.sql` (or `psql "$SUPABASE_DB_URL" -f supabase/seed-production.sql`). **This step is required.** It creates your org ("The BG Group"), the 6 roles with all their permissions, the lead statuses, call outcomes, field definitions and CRM pipelines the app needs.

It creates **no people and no sample data**: zero users, zero logins, zero leads. After this step nobody can sign in until you create the first login in Step 4.

Do **not** run `supabase/seed.sql` on a live project. That one is the demo seed: it adds three sample users and the sample leads you saw in the demo file.

## Step 3 — Deploy the Edge Functions

```bash
supabase functions deploy admin-create-user
supabase functions deploy admin-reset-password
supabase functions deploy log-activity
supabase functions deploy save-permissions
supabase functions deploy org-backup
supabase functions deploy import-run
```

The functions use the project's built-in `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars, which Supabase injects automatically — no extra secrets to configure.

## Step 4 — Create the first login (yours)

A fresh deployment has no logins at all. You create the first one by hand, once. Every login after that is created inside the app.

1. In Supabase: **Authentication → Providers → Email**, turn **off** "Allow new users to sign up". This means nobody can create their own account; logins only exist when an admin creates them. (`supabase/config.toml` already has `enable_signup = false`, so `supabase config push` sets this for you.)
2. **Authentication → Users → Add user**: enter your email and a strong password, and tick "Auto Confirm User".
3. SQL Editor — make that login the owner of the org (change the name and email to yours; the email must match step 2 exactly):

```sql
insert into members (org_id, auth_user_id, first, last, email, role_id, active)
select 1, id, 'Your first name', 'Your last name', email, 'owner', true
from auth.users
where email = 'you@yourcompany.com';
```

It should report `INSERT 0 1`. If it reports `INSERT 0 0`, the email didn't match step 2.

4. Open the app and sign in with that email and password. You are the owner.
5. Create everyone else in the app at **Admin → Users**. Each new user gets a temporary password and must choose their own on first sign-in.

There is no other way in: the live site shows only the email and password form, and the one-click demo sign-in is disabled in code on the live backend.

## Step 5 — Build and host the frontend

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_DEMO_LOGIN=false        # IMPORTANT: never true in production — it shows one-click sign-in-as-anyone buttons
```

```bash
npm install
npm run build        # outputs dist/
```

Host `dist/` anywhere static:
- **Netlify / Vercel / Cloudflare Pages**: point it at the repo, build command `npm run build`, publish directory `dist`, and set the four `VITE_*` env vars in the host's dashboard (they're baked in at build time).
- **Your own server**: copy `dist/` behind nginx/Apache. It's a single-page hash-router app (`#dashboard` etc.), so no special rewrite rules are needed.

Then in Supabase **Authentication → URL Configuration**, set the Site URL to your hosted domain.

## Step 6 — Smoke test

1. Open the site, sign in as your bootstrap user.
2. Create a second user via Admin → Users (you'll get a temporary password; sign in as them in a private window and confirm the forced password change works).
3. Create a lead, log a call with an outcome and a follow-up date, import the sample CSV (Imports → download sample), check the dashboard, run an export.

## Updating later

- Schema changes: add a new numbered file in `supabase/migrations/`, then `supabase db push`.
- Function changes: `supabase functions deploy <name>`.
- Frontend changes: `npm run build` and re-publish `dist/` (hosts with git integration do this on push).
- Full verification suite: `npm run verify` (lint + unit tests + Playwright e2e). The DB-backed suites (tests/security, parts of tests/certification) need a local Postgres 16 and are optional for deploys.

## Backups

- Supabase takes daily automatic database backups (paid tiers; on free tier, use `pg_dump` on a schedule).
- The in-app **Save backup** button on the Supabase backend produces a JSON export only — **there is no in-app restore on the live backend** (deliberate; see docs/certification/data-integrity.md DI-4). Your real restore path is a database-level restore (`pg_dump`/`pg_restore`), which GATE G6 verified round-trips all 33 tables losslessly.

---

## Known risks before going live (from the certification gates — unfixed as of this package)

Read the full reports in `docs/certification/`, especially `security-audit.md` (G3), `permissions.md` (G5), `data-integrity.md` (G6).

1. **Most tables have no row-level security.** Only `leads`, `deals`, `follow_ups`, `activities`, `notes` are RLS-protected. Any signed-in user can read/write every other table (members, teams, roles, campaigns, lists, settings, audit log, …) directly through the Supabase REST API — including **granting themselves admin permissions via `role_permissions`** (proven by a live test). Until the G3/G5 fixes are applied, deploy only for a group of users you trust completely.
2. **No rate limiting** on login or password reset (G3 F-level finding).
3. **Import commit is not atomic** server-side — a connection drop mid-import can leave a partial import that can't be undone in-app (G6 DI-2/DI-3).
4. **CSV tab-escaping defect** (G6 DI-1): a tab character inside a field breaks that row on re-import.
5. **Concurrent editing is last-write-wins with no warning** — two users saving the same lead silently overwrite each other's fields (G7 scenario 1; a rule choice is pending).
6. Minor: double follow-ups possible when two users log calls on the same worked lead simultaneously (G7 scenario 2, self-healing on the next log).

Recommended order if you want these closed before launch: G3 fix list (F-01..F-15) → G5 per-key decisions → DI-1/DI-2/DI-3 → the G7 conflict-rule choice.
