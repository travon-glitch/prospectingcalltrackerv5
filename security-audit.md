# Security Audit — GATE G3 (Hostile Review)

**Scope:** `supabase/migrations`, `supabase/functions`, `src/data/repo-supabase.js`, `src/core/session.js` (auth), and anywhere the browser talks to the backend.
**Posture:** this review assumes every rule is broken until a real query, a real test, or a line-referenced piece of code proves otherwise. Nothing here is fixed yet — findings only, per instruction.
**Test evidence:** `tests/security/rls.test.js` (20 tests, run against a real throwaway local Postgres 16 with every migration applied — not mocked), `tests/security/edge-functions-static.test.js` (26 tests, source-level verification of all 6 edge functions), `tests/security/input-handling.test.js` (2 tests, CSV injection + XSS attribute-breakout, exercised against the real functions). Run with `npx vitest run tests/security` (both suites are additionally wired into `vitest.config.js`'s `include`, so `npm run test`/`npm run verify` pick them up too).

---

## 0. Headline finding

**Of the app's 31 tables, only 5 have Row-Level Security enabled: `leads`, `deals`, `follow_ups`, `activities`, `notes`.** The other 26 — including `members`, `roles`, `role_permissions`, `orgs`, `teams`, `audit_log`, `lead_phones`, `lead_custom_values`, and every settings/config table — have **no RLS at all**. Supabase grants the `authenticated` Postgres role full `SELECT`/`INSERT`/`UPDATE`/`DELETE` on every `public` table by default, and this repo's migrations never issue a single restricting `GRANT` (confirmed: zero `grant` statements anywhere in `supabase/migrations/*.sql`). That means **any signed-in user of any org, using nothing but their own browser's network tab and the anon key already shipped to the client, can read or write any row in any of those 26 tables — including another company's entire roster, another company's audit trail, and their own role/org assignment.** The app's own `can()` permission checks (`src/core/permissions.js`) and the edge functions' authorization logic are real, but they only gate the app's own UI and its own edge-function call sites — they do nothing to stop a direct `PATCH https://<project>.supabase.co/rest/v1/members?id=eq.4` request, which Supabase auto-generates for every table regardless of whether the app ever calls it that way.

This is not a subtle oversight: `supabase/functions/save-permissions/index.ts`'s own header comment says outright that `roles`/`role_permissions` "have no RLS of their own... so every write to a role has to go through this function instead" — the gap was known and left open.

---

## 1. Role × table × operation matrix

Roles: the 6 built-ins from `defaultRoles()` (`owner`/super-admin, `manager`/Administrator, `isa_manager`, `agent`, `re_agent`, `viewer`) plus one custom, non-built-in role exercised throughout this audit's tests: **`field_temp`** (`viewOwnLeads, editLeads, makeCalls, editOutcomes, viewAttempts` only — no team/org visibility, no admin rights).

Legend: **Demo-intended** = what `core/permissions.js`'s `can()`/`canSee()` model says should happen in the app. **Actual (RLS)** = what a direct database/REST call actually allows today, independent of the app's own UI.

### 1a. The 5 RLS-protected tables (server-side enforcement is real here)

| Table | Operation | Demo-intended | Actual (RLS) |
|---|---|---|---|
| `leads` | select | own/team/all per `viewOwnLeads`/`viewTeamLeads`/`viewAllLeads`, always org-scoped | **Matches.** `leads_select` enforces `org_id = current_org_id() and can_see_member(assigned_id)` for every role including `field_temp`. Proven by `tests/security/rls.test.js` ("reading another team/org's leads" — all 4 pass). |
| `leads` | insert | `createLeads`, org-scoped | Matches (`leads_insert`). |
| `leads` | update | `editLeads` + must already see the row | Matches (`leads_update`). |
| `leads` | delete | `deleteLeads` (app itself never hard-deletes, always archives) | Matches (`leads_delete`) — defensive policy present even though unused. |
| `deals` | select | same visibility as the lead it's attached to | Matches (`deals_select`). |
| `deals` | insert | any lead you can already see | Matches (`deals_insert`). |
| `deals` | update | `moveStages` / `reassign` / `editDealFinancials` **or** being the assigned agent | Matches at the row level — **but see Finding F-09**: RLS is row-level, not column-level, so the assigned agent can edit price/commission columns without `editDealFinancials` (documented in the migration's own comment as an accepted, deferred gap). Proven by the "deals and follow_ups" test group. |
| `deals` | delete | never issued by the app | No policy — denied by default. Matches. |
| `follow_ups` | select/insert/update | `createFollowUps`, visibility follows assignee | Matches. |
| `follow_ups` | delete | never issued | No policy — denied by default. Matches. |
| `activities` | select | visibility follows the lead | Matches. |
| `activities` | insert | `editOutcomes`, always as yourself (no impersonation) | Matches — proven by "editing another team's activities" (both the cross-team insert and the `user_id` spoof attempt fail). |
| `activities` | update/delete | never issued (append-only log) | No policy — denied by default, **even for the owning agent**. Matches/stricter-than-intended in a safe direction. |
| `notes` | select | visibility follows the lead; `kind='manager'` additionally needs `managerNotes` | Matches. |
| `notes` | insert | `addNotes` (+`managerNotes` for manager notes), always as yourself | Matches. |
| `notes` | update/delete | never issued | Denied by default. Matches. |

### 1b. The 26 unprotected tables (RLS disabled — every cell below is the same shape)

For **every** role (`owner` through `field_temp`) and **every** operation (select/insert/update/delete), the demo's intended answer varies by role and permission — but the **actual** answer, because RLS is off and Supabase's default grants apply, is: **any authenticated user, in any org, may select/insert/update/delete any row, regardless of role, org, or team.** The only thing standing between a user and these tables is the app's own client-side JS and, for a handful of actions, an edge function's server-side check — both of which are trivially bypassed by calling the PostgREST REST API directly (e.g. with `curl` and the anon key + the user's own JWT).

| Table | Demo-intended gate | Actual (RLS) |
|---|---|---|
| `members` | `viewTeamMembers`/org-admin to read; `editUsers`/`deactivateUsers` to write; **role_id and org_id should never be client-writable** | **No RLS.** Full cross-org read/write. **This is the complete privilege-escalation + tenant-hijack + account-takeover path — see Finding F-01.** |
| `roles`, `role_permissions` | `createRoles`/`editPermissions` | No RLS. Any user can rewrite any role's permission grants directly, bypassing `save-permissions` entirely. |
| `orgs` | nobody edits this from the app | No RLS. Any user can rename/delete another org's row. |
| `teams`, `team_members`, `team_history`, `team_lists`, `team_campaigns` | `createTeams`/`editTeams`/`assignMembers`/`assignManagers` | No RLS. Any user can add/remove any member from any team in any org, reassign managers, etc. |
| `member_lists` | implicit, via `userDlg()` | No RLS. |
| `audit_log` | `viewAudit` to read; nothing ever deletes a row from the app | No RLS. **Any user can read or delete another org's entire audit trail** — proven by `tests/security/rls.test.js`'s "deleting audit entries" group (both cases currently succeed). |
| `lists` | `manageLists` | No RLS. |
| `statuses` | `manageStatuses` | No RLS. |
| `custom_fields`, `built_in_fields` | `manageFields` | No RLS. |
| `org_settings` | `manageSettings` | No RLS — any user can overwrite another org's settings (including `import_cfg`, scoring points, working days). |
| `outcomes` | `manageOutcomes` | No RLS. |
| `templates` | `createTemplates` | No RLS. |
| `campaigns` | `manageCampaigns`/`editCampaigns`/`deleteCampaigns` | No RLS. |
| `campaign_leads` | implicit (via campaign visibility) | No RLS. |
| `pipelines`, `stages` | `manageCrm` | No RLS. |
| `deal_history` | append-only, implicit | No RLS — any user can read or fabricate another org's deal-history log. |
| `imports`, `import_leads` | `import` | No RLS (writes normally go through `import-run`, which does check permissions — but a direct REST call to these tables skips it entirely). |
| `lead_phones`, `lead_lists`, `lead_custom_values` | should inherit the parent lead's visibility | **No RLS of their own.** Because the parent `leads` row IS protected, this is the sneakiest gap in the whole schema: a user who is correctly denied `SELECT` on someone else's `leads` row can still directly query `lead_phones`/`lead_custom_values`/`lead_lists` filtered by `lead_id` and read that lead's phone numbers, custom-field values (which can hold sensitive data), and list memberships. **Proven by `tests/security/rls.test.js`'s `[EXPECTED TO FAIL until fixed]` phone-number test — see Finding F-02.** |

---

## 2. Findings

Each finding lists severity, proof, and the exact fix. **Nothing below has been applied — this is the list awaiting approval, per instruction.**

### F-01 — CRITICAL — `members` table has no RLS: full cross-org privilege escalation and tenant hijack
**Proof:** `supabase/migrations/0015_rls.sql` (grep confirms `enable row level security` appears exactly 5 times, never for `members`). Live proof: `tests/security/rls.test.js` → "escalating own role / privilege escalation via members table" (all 3 `[EXPECTED TO FAIL until fixed]` tests currently fail, meaning the attacks currently **succeed**):
- An `agent` can `UPDATE members SET role_id = 'owner' WHERE id = <self>` directly — instant super-admin.
- An `agent` can `UPDATE members SET org_id = <other org> WHERE id = <self>` — hijacks their own membership into any other tenant, after which every `current_org_id()`-scoped RLS policy on the 5 protected tables now resolves to the victim org.
- A non-admin can `UPDATE role_permissions SET allowed = true ...` to grant themselves `editPermissions`/any capability directly, bypassing `save-permissions` entirely.
Also proven: "reading the users/members table of another team/org" — an `agent` in org B reads all 9 of org A's member rows (including emails, `must_change_pw`, `deactivated_at`) with a plain `select * from members where org_id = 1`.

**Fix:** Enable RLS on `members`, `roles`, `role_permissions` and write policies mirroring the existing `has_permission()`/`current_org_id()` helpers, e.g.:
```sql
alter table members enable row level security;
create policy members_select on members for select
  using (org_id = current_org_id() and (has_permission('viewTeamMembers') or id = current_member_id()));
create policy members_update on members for update
  using (org_id = current_org_id())
  with check (
    org_id = current_org_id()
    and has_permission('editUsers')
    -- column-level guard: role_id/org_id changes require a stricter check
    -- than editUsers alone, or should be routed through a SECURITY DEFINER
    -- RPC (the same shape save-permissions already uses) rather than a
    -- raw table UPDATE from the browser.
  );
alter table roles enable row level security;
alter table role_permissions enable row level security;
-- both read-only to authenticated (has_permission('editPermissions') gates select;
-- all writes go exclusively through save-permissions, which already uses the
-- service-role client and can keep being the only writer once direct table
-- writes are denied by RLS).
```
The safest fix for `members.role_id`/`org_id` specifically is to deny column-level changes to those two columns from a plain `UPDATE` policy altogether (Postgres RLS can't do column-level `WITH CHECK` alone reliably against a partial-column update the way you'd want) — route role/org changes exclusively through a `SECURITY DEFINER` RPC or edge function (the same pattern `save-permissions`/`admin-create-user` already use), and let RLS deny direct `UPDATE`s to those two columns outright.

### F-02 — HIGH — `lead_phones`, `lead_lists`, `lead_custom_values` have no RLS, leaking PII for leads a user cannot otherwise see
**Proof:** `tests/security/rls.test.js` → "reading another team/org's leads" → `[EXPECTED TO FAIL until fixed] org B agent cannot read org A lead's phone number via lead_phones directly` — currently fails (the phone row IS returned) even though the same user's `select * from leads where id = 1` correctly returns 0 rows two tests above it.

**Fix:**
```sql
alter table lead_phones enable row level security;
create policy lead_phones_select on lead_phones for select
  using (exists (select 1 from leads l where l.id = lead_phones.lead_id and l.org_id = lead_phones.org_id and can_see_member(l.assigned_id)));
-- mirror for insert/update/delete (matching whatever write policy leads
-- itself uses), and the identical shape for lead_lists and lead_custom_values.
```

### F-03 — HIGH — `audit_log` has no RLS: any user can read or delete any org's audit trail
**Proof:** `tests/security/rls.test.js` → "deleting audit entries" — both tests currently fail: an org-A `agent` with no `viewAudit`/admin rights deletes org A's only audit row, and separately an org-B `agent` deletes it too (cross-org).

**Fix:**
```sql
alter table audit_log enable row level security;
create policy audit_log_select on audit_log for select
  using (org_id = current_org_id() and has_permission('viewAudit'));
create policy audit_log_insert on audit_log for insert
  with check (org_id = current_org_id()); -- every mutation path writes its own audit row as itself
-- no update/delete policy at all: an audit trail must not be alterable or
-- deletable by anyone through the client, including super admins — if a
-- retention/purge need ever exists, do it via a service-role job, never RLS.
```

### F-04 — HIGH — The other 21 org-scoped config/roster tables have no RLS (`roles`, `teams`, `team_members`, `orgs`, `lists`, `statuses`, `custom_fields`, `built_in_fields`, `org_settings`, `outcomes`, `templates`, `campaigns`, `campaign_leads`, `pipelines`, `stages`, `deal_history`, `imports`, `import_leads`, `member_lists`, `team_lists`, `team_campaigns`, `team_history`)
**Proof:** same `enable row level security` grep (0015_rls.sql) — none of these 21 tables appear. Every one of `repo-supabase.js`'s corresponding read/write functions relies entirely on the client adding its own `.eq('org_id', ...)` filter (confirmed by reading the full file: every `loadXConfig()` function and every `users`/`teams`/`lists`/`statuses`/`fields`/`crm`/`campaigns` write in `repo-supabase.js` is a bare `supabase.from(table)...` call with no RLS backing it) — a direct REST call with no `org_id` filter, or a tampered one, is not stopped by the database at all.

**Fix:** Enable RLS on all 21 tables. Pattern (adjust the permission key per table, matching the table's own comment in `repo-supabase.js` about which `can()` gate the client already uses):
```sql
alter table <table> enable row level security;
create policy <table>_select on <table> for select using (org_id = current_org_id());
create policy <table>_write on <table> for insert/update/delete
  with check (org_id = current_org_id() and has_permission('<the matching permission key>'));
```
`team_members`/`team_history`/`deal_history`/`campaign_leads`/`import_leads`/`member_lists`/`team_lists`/`team_campaigns` don't carry `org_id` directly in every case — join through their parent (`team_id`→`teams.org_id`, `campaign_id`→`campaigns.org_id`, etc.) the same way `deals_insert`'s existing `exists (select 1 from leads ...)` pattern already does.

### F-05 — MEDIUM — Column-level gap on `deals.price`/commission fields (documented, accepted risk — re-flagging for completeness)
**Proof:** `0015_rls.sql`'s own comment on `deals_update` acknowledges this; `tests/security/rls.test.js`'s "deals and follow_ups" group proves it live — the assigned agent successfully updates `price` without `editDealFinancials`.
**Fix (optional, since it's a deliberate, documented trade-off):** add a trigger that rejects a `price`/`comm_pct`/`referral_pct`/etc. change unless `has_permission('editDealFinancials')`, e.g. a `BEFORE UPDATE` trigger comparing `OLD`/`NEW` on the financial columns.

### F-06 — MEDIUM — Modulo bias in temporary-password generation (`admin-create-user`, `admin-reset-password`)
**Proof:** both functions use `crypto.getRandomValues(new Uint8Array(10))` mapped via `bytes[i] % alphabet.length` where `alphabet.length === 56` does not evenly divide 256 — proven present in both files by `tests/security/edge-functions-static.test.js`'s "temporary-password generation and logging" group.
**Fix:** use rejection sampling instead of modulo:
```ts
function randomAlphabetChar(alphabet: string): string {
  const max = 256 - (256 % alphabet.length);
  let b: number;
  do { b = crypto.getRandomValues(new Uint8Array(1))[0]; } while (b >= max);
  return alphabet[b % alphabet.length];
}
```

### F-07 — MEDIUM — No rate limiting on login or password reset anywhere in application code
**Proof:** `tests/security/edge-functions-static.test.js`'s "no rate limiting exists anywhere in this layer" group passes for all 6 edge functions (i.e., confirms none of them implement any throttling). `src/core/session.js`'s `signInWithPassword()`/`signIn()` call `supabase.auth.signInWithPassword` directly with no client-side or server-side attempt-throttling of its own; `admin-reset-password` has no limit on how often it can be invoked against the same target member.
**Fix:** rely on and explicitly configure Supabase Auth's built-in rate limiting (documented, project-level setting — verify it's turned on, not just default) for the login path; add an explicit per-caller/per-target rate limit (e.g. a `rate_limits` table keyed by `caller_id`+`action`, checked and incremented inside `admin-reset-password` before issuing the reset) for the edge-function-driven reset path, since Supabase Auth's own limiter doesn't cover this custom function.

### F-08 — LOW — `has_permission_for`/`same_team_for`/`can_see_member_for` (0017_log_activity.sql) trust a caller-supplied `p_member_id` with no internal org/identity binding
**Proof:** full body quoted and compared against `has_permission()` during recon; the one current call site (`import-run`) resolves `p_member_id` safely from a server-verified token before calling it, but the function itself has no such guard.
**Fix:** either (a) document loudly (as a code comment directly on the function) that `p_member_id` must only ever come from a server-resolved identity, never client input, or (b) harden the function itself to also take and verify a caller identity, e.g. `has_permission_for(p_caller_auth_uid uuid, p_member_id bigint, perm_key text)` that additionally asserts the caller is allowed to act on `p_member_id` (same org, or `is_super_admin()`), so a future careless call site can't turn this into an IDOR.

### F-09 — LOW — Attribute-breakout stored XSS via campaign/template body text
**Proof:** `src/features/campaigns.js:54-55`, `src/views/campaigns.js:166`, `src/views/workspace.js:65`, `src/features/activity.js:87` all embed campaign/card body text into an `onclick="..."` attribute using `JSON.stringify(text).replace(/"/g,"&quot;")` instead of `esc()`. This neutralizes literal `"` characters but never HTML-escapes the text itself — a campaign/template body (editable by anyone with `manageCampaigns`) containing a literal `&quot;` sequence decodes back into a real `"` when the browser parses the attribute, closing it early and letting the rest of the body execute as injected `onclick` JS for every later viewer. Proven mechanically (not just asserted) by `tests/security/input-handling.test.js`'s "Stored XSS" test, which reproduces the exact transform and shows the attribute closing early.
**Fix:** replace every `JSON.stringify(text).replace(/"/g,"&quot;")` site with `esc(JSON.stringify(text))` (HTML-escape the *whole* JSON-stringified value, not just its quote characters), or better, stop building `onclick="..."` attribute strings from dynamic text altogether and attach the handler via `addEventListener` with the text passed as a captured closure variable instead of serialized into markup.

### F-10 — LOW — `downloadSample()`'s inline CSV escaping is weaker than `csvCell()` and is reachable via custom-field "choice" values
**Proof:** `src/features/imports.js:29`'s own quoting only triggers on a comma/quote, never on a leading `=`/`+`/`-`/`@`/tab/CR the way `src/features/exports.js`'s `csvCell()` does. `ex()` (same file, line 19) reads a custom field's `choices[0]`/`choices[1]` — free text a manager sets via `fieldForm()` (`src/views/settings.js`) — directly into the sample row. Proven live by `tests/security/input-handling.test.js`'s CSV-injection test: a `choice` field whose first value is `=1+1` is written unescaped (`=1+1`, not `'=1+1`) into the downloaded sample CSV.
**Fix:** make `downloadSample()` reuse `csvCell()` from `src/features/exports.js` instead of its own inline escaper.

### F-11 — LOW — Low-exploitability unescaped interpolation of team logo/color into `src=`/`style=`
**Proof:** `src/views/admin.js:53,144`, `src/features/admin.js:50,196,241,244,258` interpolate `t.color`/`t.logo`/upload-result URLs into `style=`/`src=` attributes without `esc()`. `t.color` is only ever set from a fixed swatch (low risk); `t.logo` is a `FileReader` data URL or a Supabase-storage URL, not free-typed text, so no current input path reaches it directly — documented as defense-in-depth.
**Fix:** wrap both in `esc()` regardless, since neither costs anything and it removes the dependency on "no current path reaches it" staying true forever.

### F-12 — INFORMATIONAL — Migration header comment overclaims blanket enforcement
**Proof:** `0015_rls.sql`'s top-of-file comment says "server-side enforcement of the visibility/write rules... not just a client-side convenience" without qualifying that this is true for only 5 of 31 tables.
**Fix:** amend the comment (when F-01–F-04 are fixed, this becomes moot; until then, the comment should say "5 of 31 tables" explicitly so no future reader assumes broader coverage than exists).

### F-13 — INFORMATIONAL — Passwords are never logged; temporary-password replay is not possible (both confirmed, not exploitable)
**Checked:**
- Grepped `console.log`/`console.error`/etc. near password variables across both edge functions and `src/core/session.js`/`src/data/repo-supabase.js`/`src/data/repo-local.js` — no match. `tests/security/edge-functions-static.test.js`'s "neither function logs the generated/returned password" test formalizes this for the two functions that generate one.
- Replay: `changePasswordSubmit()` → `repo.updatePassword()` → Supabase backend calls `client.auth.updateUser({ password: newPw })`, a real Supabase Auth credential update. Supabase Auth keeps only the current password hash (no history/rollback), so once changed, the old temporary password stops matching immediately and unconditionally — there is no application-level cache or grace window that could be replayed. This is inherent to Supabase Auth's own model, not something this app's code could reintroduce a replay window into, and isn't independently unit-testable without a live Supabase project; noted here as verified by code/architecture review.

### F-14 — INFORMATIONAL — No secrets in git history, no service-role key reachable from the browser bundle
**Checked:** grepped all 16 commits' history for `service_role`/`secret`/`password`-looking literals — none found (only `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` references, which read from environment, never a literal). `.env`/`.env.example` contain no real keys. The built `dist/` bundle contains only `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` identifiers, no JWT-shaped string, no service-role key. Clean.

### F-15 — INFORMATIONAL — Security-definer `search_path` pinning is complete
**Checked:** every `security definer` function across all 19 migrations (`0015_rls.sql`, `0017_log_activity.sql` — the only two files that declare any) pins `set search_path = public`. No search-path-hijack risk found.

---

## 3. Test suite — what's covered and its one real limitation

- **`tests/security/rls.test.js`** (20 tests) — runs against a real, throwaway local Postgres 16 with every migration applied, using the same `set role authenticated; select set_config('request.jwt.claim.sub', ...)` impersonation technique GATE G2's own parity suites established. Covers: reading another team's/org's leads, editing another team's activities (including a `user_id` impersonation attempt), role escalation via `members`/`role_permissions`, reading another org's member roster, deleting audit entries, reading a deactivated user's data, and the custom `field_temp` role's enforcement. **8 of 20 tests currently fail — every failure is a real, reproduced vulnerability, each one labeled `[EXPECTED TO FAIL until fixed]` in its test name and mapped to a Finding above** (F-01, F-02, F-03). The remaining 12 pass, proving the 5 protected tables' policies hold even against a hostile custom role and a second org.
- **`tests/security/edge-functions-static.test.js`** (26 tests) — verifies, by reading each function's actual TypeScript source (not by trusting any prior report), that every one of the 6 edge functions checks for an `Authorization` header and 401s without one, resolves the caller exclusively via `admin.auth.getUser(token)` rather than a client-supplied id, and re-checks org membership + a specific permission before any privileged write. Also formalizes the modulo-bias and no-rate-limiting findings, and confirms passwords are never logged. **All 26 pass** — these functions' own authorization logic is sound; the exposure is that this logic can be bypassed entirely by calling the underlying tables directly (Findings F-01–F-04), not a flaw in the functions themselves.
- **`tests/security/input-handling.test.js`** (2 tests) — mechanically reproduces the CSV-formula-injection gap in `downloadSample()` and the attribute-breakout XSS transform used for campaign/card text, rather than asserting either from source alone.
- **Stated limitation:** item 2 also asks to call "every edge function without auth and with the wrong role" as a live HTTP test. This sandbox has neither Deno nor the Supabase CLI installed (confirmed: `which deno supabase` returns nothing), so a live `supabase functions serve` + `fetch()` run isn't possible here. `edge-functions-static.test.js` is the closest verifiable substitute — it proves the *code path* that would reject such a call is present and exercised by real assertions, not that the network response is literally a 401 in this environment. Re-running the unauth/wrong-role HTTP cases against a real deployed project (or a Deno-enabled CI runner) is recommended before sign-off, and is flagged here rather than silently assumed.

## 4. Summary for approval

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 | F-01 |
| High | 3 | F-02, F-03, F-04 |
| Medium | 3 | F-05, F-06, F-07 |
| Low | 3 | F-08, F-09, F-10, F-11 |
| Informational (no action required / already sound) | 4 | F-12, F-13, F-14, F-15 |

Waiting for approval of this list before any remediation. Once approved, fixes proceed under **G-FIX**, followed by re-running `npx vitest run tests/security` (expecting the 8 currently-failing `[EXPECTED TO FAIL until fixed]` tests to flip to passing, and F-05's documented-gap test to be revisited if that trade-off is also closed).
