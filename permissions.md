# GATE G5 — Permission Enforcement Certification

**Scope:** every key in `src/core/permissions.js`'s `PERMISSIONS` array — 62 keys across 7 groups (Leads 12, Prospecting 10, CRM Pipeline 9, Campaigns 6, Team management 6, Competitions 6, Administration 13). Verified against the original demo (`docs/original-demo.html.ref`), the current UI (`src/**`), and the database layer (`supabase/migrations/0015_rls.sql` — the only migration that defines any RLS policy; 14 policies total, covering exactly 5 tables: `leads`, `deals`, `follow_ups`, `activities`, `notes`).

**Report only. No code was fixed under this gate.** `git status --short` at the end of this document confirms only `docs/certification/permissions.md` and one new test file were added.

## How to read this report

Each key gets: demo behavior, UI enforcement (file:line), database enforcement (file:line or "no RLS"), existing test proof, and exactly one status:

- **ENFORCED-UI-AND-DB** — a real permission check exists in the UI/feature layer *and* the database genuinely rejects the action independent of the client.
- **UI-ONLY** — the only real gate is client-side (a hidden button, a feature-function check, or — the most common shape in this app — an edge function's own correct check sitting in front of a table that itself has no RLS, meaning a direct PostgREST call bypasses it entirely).
- **DB-ONLY** — the database rejects the action but the UI does not gate it at all (rare in this app).
- **UNENFORCED** — no real gate exists anywhere, in the UI or the database.

Per your rule, **any key that guards data and is not database-enforced is flagged**, and every UNENFORCED/UI-ONLY key gets two options: (a) enforce it, with an exact change, or (b) mark it intentionally unused, with a rationale. You decide per key — nothing below has been fixed.

**Cross-cutting architectural facts** (apply throughout, established once here rather than repeated per key):
- `LEGACY_CAP = { archiveLeads:"deleteLeads", manageMembers:"editUsers" }` (`src/core/permissions.js:77`) means `can("archiveLeads")` actually checks `deleteLeads`, and `manageMembers` is not itself a live `PERMISSIONS` entry — it exists only as this alias's target, used for migrating old saved data and by SQL's `has_permission()`.
- Only 5 of ~26 application tables have RLS at all (`leads`, `deals`, `follow_ups`, `activities`, `notes`). Every other table — `lists`, `lead_lists`, `campaigns`, `campaign_leads`, `message_templates`, `members`, `teams`, `roles`, `role_permissions`, `audit_log`, `org_settings`, `outcomes`, `statuses`, `custom_fields`, `built_in_fields`, `pipelines`, `stages`, `lead_phones`, etc. — has **zero** RLS policy and gets Supabase's default full-CRUD-to-`authenticated` grant. This is the root cause of the overwhelming majority of UI-ONLY/UNENFORCED findings below (same root cause GATE G3's security audit already reported at the table level; this report traces it permission-key by permission-key).
- Several Edge Functions (`admin-create-user`, `admin-reset-password`, `save-permissions`, `import-run`, `log-activity`, `org-backup`) run under a **service-role client that bypasses RLS by design**. Where such a function has its own correct permission check, that check is real but is the *only* gate — a direct PostgREST call to the underlying table sidesteps it completely. This is called out explicitly wherever it's the reason a key is classified UI-ONLY rather than ENFORCED-UI-AND-DB.
- Live proof that this isn't theoretical: `tests/security/rls.test.js` already contains passing-as-written, intentionally-red tests (`[EXPECTED TO FAIL until fixed]`) demonstrating a plain `agent` role can, via direct SQL/PostgREST: promote itself to `owner` (`members.role_id`), hop to another org (`members.org_id`), and — most severely — grant itself `editPermissions` by writing directly to `role_permissions`, cascading into control of every other permission in the app.

---

## Summary counts

| Status | Count | Keys |
|---|---|---|
| ENFORCED-UI-AND-DB | 12 | viewOwnLeads, viewTeamLeads, viewAllLeads, addNotes, editOutcomes, managerNotes, moveStages, editDealFinancials, import (Supabase only), createUsers*, resetPasswords* |
| UI-ONLY | 29 | createLeads, reassign, export, viewTeamPipeline, viewAllPipelines, viewPrices, viewCommissions, exportCrm, manageCampaigns, createTeams, editTeams, assignManagers, viewTeamReports, makeCalls, sendTexts, markSent, createUsers, editUsers, deactivateUsers, resetPasswords, createRoles, editPermissions, viewAudit, manageSettings, manageOutcomes, manageFields, manageStatuses, manageCrm |
| Mixed (see key) | 2 | editLeads, deleteLeads |
| DB-ONLY | 0 | — |
| UNENFORCED | 19 | assignLeads, manageLists, editDnc, createFollowUps, viewAttempts, browserDialer, viewPhones, viewOwnPipeline, editCampaigns, deleteCampaigns, assignCampaigns, createTemplates, creativeMessages, viewTeamMembers, assignMembers, viewCompetitions, participate, createCompetitions, editCompetitions, manageScoring, viewAllResults, manageIntegrations, exportReports |

(Counts don't sum to exactly 62 because `editLeads`/`deleteLeads` are split-status keys with more than one enforcement path — see their write-ups. `*` marks keys whose core action is genuinely un-bypassable — see Administration §4 — even though other side-effects of the same key are UI-ONLY.)

**Headline finding:** zero of the 13 Administration keys are fully ENFORCED-UI-AND-DB. The two most severe gaps are `createRoles`/`editPermissions` (§Administration) — the `role_permissions` table that stores every role's permissions has no RLS at all, and a real test in this repo already proves an ordinary agent can grant themselves `editPermissions` directly via PostgREST, which cascades into full control of the entire permission system.

---

# Group 1: Leads (12 keys)

## viewOwnLeads — "View own leads"
- **Demo:** implicit floor of `visibleLeads()` — everyone sees their own assigned leads regardless of any toggle.
- **UI:** `src/features/activity.js:21-22`, `canSee()`/`visibleLeads()` — unconditional own-lead branch (`l.assigned===me.id`); not a real on/off toggle in the demo or rebuild.
- **DB:** `leads_select` policy, `0015_rls.sql:111-113`, via `can_see_member()` — its base case is exactly "own row."
- **Test:** `tests/unit/visible-leads.test.js`; `tests/security/rls.test.js:224`.
- **Status:** ENFORCED-UI-AND-DB (as an unconditional floor, faithfully matching the demo).

## viewTeamLeads — "View team leads (same team)"
- **Demo:** implicit in visibility logic.
- **UI:** `src/features/activity.js:22` — `canSee = (l) => can("viewAllLeads") || l.assigned===me.id || (can("viewTeamLeads") && sameTeam(l.assigned))`.
- **DB:** `can_see_member()`, `0015_rls.sql:99-106`, third branch: `has_permission('viewTeamLeads') and same_team(...)`.
- **Test:** `tests/unit/visible-leads.test.js:29`; `tests/security/rls.test.js:220`; **new:** `tests/unit/visible-leads-team-scope.test.js` (Team A vs Team B — see the dedicated section at the end of this report).
- **Status:** ENFORCED-UI-AND-DB.

## viewAllLeads — "View all leads"
- **UI:** `src/features/activity.js:22` (first branch of `canSee`); `src/views/leads.js:68,76`.
- **DB:** `can_see_member()` first branch, `0015_rls.sql:103`.
- **Test:** `tests/security/rls.test.js:216,228`; `tests/unit/permissions-matrix.test.js`.
- **Status:** ENFORCED-UI-AND-DB.

## createLeads — "Create leads"
- **Demo:** `original-demo.html.ref:725` — "+ New lead" button gated.
- **UI:** Button-only, `src/views/leads.js:70`. `leadForm()` (`src/features/leads.js:155-208`) has **no internal check** — console-callable by any role.
- **DB:** `leads_insert`, `0015_rls.sql:114-117` — `with check (org_id=current_org_id() and has_permission('createLeads'))`.
- **Test:** none directly exercises this key's enforcement.
- **Status:** UI-ONLY (button-hide only; function unguarded). Effectively ENFORCED-UI-AND-DB on Supabase since RLS backstops it; **UNENFORCED below the button on the local/non-Supabase backend**, which has no RLS at all.
- **Guards data:** yes — flagged.
  - (a) Enforce: add `if(!can("createLeads")) return;` as the first line of `leadForm()`'s save handler, `src/features/leads.js:~170`.
  - (b) Mark unused: not appropriate — real write, real label promise.

## editLeads — "Edit leads" — SPLIT STATUS
- **Demo:** status dropdown disabled without it; the full lead-edit form's "Edit" button is unconditional in the demo too (matches rebuild).
- **UI:**
  - Status change: `src/features/leads.js:210` (`setLeadStatus()` checks `can("editLeads")`) and `src/views/lead.js:76`/`workspace.js:46` (`disabled` attribute) — **function-level, real**.
  - Full field edit: `src/views/lead.js:64`'s Edit button and `leadForm()`'s existing-lead save path (`src/features/leads.js:193-206`) have **no `can("editLeads")` check at all** — faithfully reproduces a demo gap, but remains a real rebuild-certification gap.
- **DB:** `leads_update`, `0015_rls.sql:121-127` — `has_permission('editLeads')` — real backstop for both paths on Supabase.
- **Test:** none performs an UPDATE and asserts `editLeads` is required.
- **Status:** UI-ONLY for the status dropdown (belt-and-suspenders); **UNENFORCED IN UI** for the full-edit form (DB-only on Supabase, fully unenforced on local backend).
- **Guards data:** yes — flagged.
  - (a) Enforce: wrap the Edit button in `can("editLeads")` at `src/views/lead.js:64`; add the same check to `leadForm()`'s existing-lead branch, `src/features/leads.js:~193`.
  - (b) Mark unused: not appropriate — this is real lead-data protection the label explicitly promises.

## deleteLeads — "Delete / archive leads" (aliased from `archiveLeads`) — SPLIT STATUS, INTERNALLY INCONSISTENT
- **Demo:** soft-flag archive (`archived=true`), never a hard delete; per-row Archive button (`:743`) and `archiveLead()` (`:622`) are **unconditional in the demo itself** — a pre-existing gap, not a rebuild regression.
- **UI:**
  - Bulk-archive button (`src/views/leads.js:69`) and detail-page Archive (`src/views/lead.js:64`) both correctly check `can("archiveLeads")` → resolves via `LEGACY_CAP` to `deleteLeads`.
  - **Per-row Archive button, `src/views/leads.js:88`, has NO check at all** — a genuine, confirmed inconsistency with the two sibling entry points, faithfully matching the demo's own gap.
  - `archiveLead()` (`src/features/leads.js:123-129`) and `bulkArchive()` (`src/views/leads.js:96-103`) have no internal checks either way — enforcement is button-only where it exists at all.
- **DB — critical subtlety, verified precisely:** the app's actual archive flow is an UPDATE (`archived=true`), which hits `leads_update` — and that policy checks `has_permission('editLeads')`, **not `deleteLeads`**. The separate `leads_delete` policy (`0015_rls.sql:129-131`, checks `deleteLeads`) gates a hard SQL DELETE the app's own code never issues. Net effect: a role with `editLeads` but not `deleteLeads` can still archive via UPDATE at the DB layer even though the UI hides the button for it — the DB is more permissive than the permission model intends for this specific path.
- **Test:** `tests/unit/permissions-matrix.test.js:141` proves only the client-side alias equivalence, not any RLS/UI end-to-end behavior. No test covers the editLeads/deleteLeads RLS mismatch or the per-row button gap.
- **Status:** the per-row path is **UNENFORCED**; the bulk/detail paths are **UI-ONLY / DB-enforced-on-the-wrong-key** (mismatch, not currently exploitable since `editLeads` is normally co-granted with `deleteLeads`, but a real inconsistency).
- **Guards data:** yes — flagged.
  - (a) Enforce: (i) wrap `src/views/leads.js:88`'s button in `can("archiveLeads")` to match its siblings; (ii) add the check inside `archiveLead()`/`bulkArchive()` themselves; (iii) fix the RLS mismatch — either add `has_permission('deleteLeads')` as an alternative to `editLeads` on `leads_update`'s `with check`, or add a dedicated archive-flag check; (iv) add an RLS test for a `deleteLeads`-but-not-`editLeads` role attempting the archive UPDATE.
  - (b) Mark unused: not appropriate for the per-row gap — straightforward oversight on a permanently-destructive-feeling action.

## assignLeads — "Assign leads"
- **Demo:** label only — real assignment actions in the demo are all gated by `can("reassign")`, never `assignLeads`.
- **UI:** **zero call sites anywhere** in `src/**` or the demo. Fully orphaned — seeded per-role but never consumed.
- **DB:** no RLS policy references this key at all.
- **Test:** none — appears only as a role-seed constant.
- **Status:** UNENFORCED (dead/orphaned key).
- **Guards data:** the key nominally would, but nothing currently routes through it.
  - (a) Enforce: either wire it in as the distinct gate for *initial* assignment (replacing `can("reassign")` in `leadForm()`'s "Assigned to" field, `src/features/leads.js:166`) so "assign" and "reassign" are genuinely separate permissions as their labels imply; or fold `reassign` to cover both and treat `assignLeads` as redundant.
  - (b) Mark unused: plausible if the product intends "assign and reassign are the same permission" — but flag that an admin toggling this checkbox today believes it does something, and it doesn't; that's misleading regardless of which option you pick.

## reassign — "Reassign leads"
- **Demo:** `original-demo.html.ref:623,724,775,839` — `reassign()` + multiple button gates.
- **UI:** extensively checked at button level across `src/views/leads.js:69`, `lead.js:64`, `features/leads.js:166`, `views/lists.js:58`, `views/deal.js:70`, `features/activity.js:115`. `reassign()` itself has no internal check; `src/features/crm.js:262` (deal reassignment) **is** function-level.
- **DB:** `deals_update`, `0015_rls.sql:157-172`, checks `reassign` — real, for deal reassignment. **Lead reassignment's DB write hits `leads_update`, which only checks `editLeads`, never `reassign` specifically** — so lead-level reassignment is not separately DB-gated on this key.
- **Test:** `tests/security/rls.test.js:362` covers deal-move team boundaries generally, not `reassign` in isolation.
- **Status:** UI-ONLY for lead reassignment (DB checks the broader `editLeads`, not `reassign`); ENFORCED-UI-AND-DB for deal reassignment.
- **Guards data:** yes for the lead path — flagged.
  - (a) Enforce: add a column-aware check to `leads_update` (trigger or additional `with check` comparing `OLD.assigned` vs `NEW.assigned`, requiring `has_permission('reassign')` when they differ).
  - (b) Mark unused: not appropriate — `reassign` is deliberately withheld from `AGENT_BASE` while `editLeads` is granted, implying agents should edit-but-not-reassign; today they effectively can reassign via any edit-permitted UPDATE.

## export — "Export leads"
- **Demo:** `original-demo.html.ref:725` — button gated.
- **UI:** button-only across 6 views (`leads.js:70`, `campaigns.js:32`, `followups.js:34`, `reports.js:26`, `scoreboard.js:14`, `settings.js:166`). `exportCsv()` (`src/features/exports.js:85+`) has **no internal check** — globally exposed, console-callable regardless of role.
- **DB:** no RLS references `export`; row-level exposure is still bounded by each table's own SELECT policy, so a user can't export rows they can't see at all, but a user with `viewAllLeads` and no `export` can bulk-download everything visible via console.
- **Test:** `tests/unit/export-crm-columns.test.js`/`csv-escaping.test.js` test formatting, not the gate.
- **Status:** UI-ONLY.
- **Guards data:** arguably not (row visibility is the real boundary) — see option (b).
  - (a) Enforce: add `if(!can("export")) return toast(...)` as the first line of `exportCsv()`, `src/features/exports.js:85`, matching the pattern already used for `import`.
  - (b) Mark unused: defensible if `export` is meant as a bulk-download convenience on top of an already-enforced visibility boundary, not a distinct data-access control — but `AGENT_BASE`'s per-role seed differentiation suggests it's meant to be load-bearing for some custom roles, which the unguarded function currently defeats.

## import — "Upload lead lists"
- **Demo:** import wizard gated by role.
- **UI:** whole-view block, `src/views/imports.js:12`, plus nav-link hide, `src/views/shell.js:19`. `importRun()`/`importCheck()`/`undoImport()` have no internal check — console-callable on the local backend with zero gate (no RLS there either).
- **DB (Supabase):** no RLS on `imports`/`import_leads` tables, but the actual commit path runs through the **service-role** `import-run` edge function, which does its own explicit `has_permission_for(..., 'import')` check (`supabase/functions/import-run/index.ts:149-152`, backed by `has_permission_for()` in `0017_log_activity.sql:13`) — real server-side enforcement, just not an RLS policy.
- **Test:** `tests/unit/import-dedupe-merge.test.js` tests parsing/dedupe, not the permission gate; `tests/security/edge-functions-static.test.js` verifies the function's checks exist statically.
- **Status:** ENFORCED-UI-AND-DB on the Supabase backend (view-block + edge-function check, the strongest combination in the Leads group); UI-ONLY on the local backend.
  - (a) Enforce (local backend gap): add `if(!can("import")) return;` at the top of `importRun()`, `src/features/imports.js:131`.
  - (b) Mark unused: not appropriate — the Supabase-side enforcement shows this is clearly meant to be load-bearing.

## manageLists — "Create and edit prospecting lists"
- **Demo:** `original-demo.html.ref:971+` — buttons gated.
- **UI:** button-only across `lists.js:37,58,60`, `leads.js:69`, `lead.js:64`. `listForm()`, `archiveList()`, `removeFromList()`, `addToList()` have no internal checks — all console-callable regardless of role.
- **DB:** **no RLS on `lists`, `lead_lists`, `team_lists`, or `member_lists` at all** — full CRUD open to any authenticated user, any org (no `org_id` scoping either). This is worse than most other UI-ONLY gaps since it's cross-org-reachable.
- **Test:** none targets the `lists` table at all.
- **Status:** UNENFORCED.
- **Guards data:** yes — flagged, high severity.
  - (a) Enforce: enable RLS on `lists`/`lead_lists` and add `org_id`-scoped, `has_permission('manageLists')`-gated policies (following the `leads_*` pattern); add the same check to `listForm()`, `archiveList()`, `removeFromList()`, `addToList()`.
  - (b) Mark unused: not appropriate — real organizational data, currently open cross-org with zero protection.

## editDnc — "Remove a Do Not Call / Text / Contact flag"
- **Demo:** the three DNC/DNT/Do-Not-Contact checkboxes call `setDnc()` unconditionally — **the demo itself never checks `can("editDnc")` anywhere**, despite the key being defined and seeded per role.
- **UI:** identical to the demo — grep-confirmed zero `can("editDnc")` call sites anywhere in `src/**`. Any user who can see a lead can toggle (including *remove*) a DNC flag.
- **DB:** no RLS references `editDnc`; the DNC columns are covered only by the general `leads_update` policy (`editLeads`), which doesn't distinguish which columns changed.
- **Test:** `tests/unit/dnc-cancels-followups-supabase.test.js` tests the side effect of `setDnc()`, not the permission gate (which doesn't exist to test).
- **Status:** UNENFORCED.
- **Guards data:** yes, and compliance-sensitive — flagged as one of the higher-priority items in this report.
  - (a) Enforce: (i) disable each checkbox's "turn off" transition in `src/views/lead.js:81-83` when `!can("editDnc")`; (ii) inside `setDnc()` (`src/features/leads.js:86`), add `if(!val && !can("editDnc")) return toast(...)` (so *setting* a flag stays open under `editLeads`, only *removing* one requires `editDnc`, matching the label's exact wording); (iii) a column-aware DB check (trigger comparing old/new DNC columns, requiring `editDnc` on a true→false transition).
  - (b) Mark unused: not appropriate — this is exactly the kind of compliance-relevant control where silent non-enforcement is a real risk, and per-role seed data shows it was meant to be load-bearing.

---

# Group 2: Prospecting (10 keys)

## makeCalls — "Make calls"
- **Demo:** `callBtn()` disables the `tel:` link and toasts when absent.
- **UI:** `src/features/activity.js:86` — view-layer only; nothing to gate server-side (a `tel:` link has no DB write).
- **DB:** N/A by nature — no table represents "may I dial."
- **Test:** none specific.
- **Status:** UI-ONLY.
  - (a) Enforce further: n/a (no server mutation exists); could add a unit test on `callBtn()`'s disabled output.
  - (b) Mark unused: reasonable — dialing has no corresponding server mutation, so DB enforcement isn't meaningful for this key.

## sendTexts — "Send or prepare texts"
- Same shape as `makeCalls`: `src/features/activity.js:87`, view-layer only, no DB write to gate.
- **Status:** UI-ONLY. (a)/(b) as `makeCalls`.

## addNotes — "Add notes"
- **Demo:** `addNote()` checks `can("addNotes")` before pushing.
- **UI:** `src/features/activity.js:89` — real function-level check (not merely a hidden input — the Add input renders unconditionally but the function itself refuses).
- **DB:** `notes_insert`, `0015_rls.sql:258-269` — checks `has_permission('addNotes')`, real RLS (direct PostgREST path, not edge-function-bypassed).
- **Test:** none isolates this key by name, though the mechanism is proven generically by the RLS policy's presence and the function check.
- **Status:** ENFORCED-UI-AND-DB.

## createFollowUps — "Create follow-ups" — HIGHEST-PRIORITY FINDING IN THIS GROUP
- **Demo:** never gated by any dedicated permission even in the original demo (folded into `editOutcomes`'s form-level gate, or ungated for the CRM dialog).
- **UI:** **zero `can("createFollowUps")` call sites anywhere** in `src/**`.
- **DB — two distinct creation paths, verified precisely:**
  1. **Dominant path** ("log an attempt" with a follow-up date): routes through the **service-role** `log-activity` edge function → SQL function `log_activity()` (`0017_log_activity.sql`), which inserts into `follow_ups` gated **only** by an earlier `has_permission_for(..., 'editOutcomes')` check — `createFollowUps` is **never checked**, and because this runs under the service-role client, the `follow_ups_insert` RLS policy (`0015_rls.sql:182-191`, which *does* check `createFollowUps`) **never runs** for this path at all.
  2. **CRM deal dialog** (`dealFuDlg()`, `src/features/crm.js:221-233`): calls `repoFollowUps.create()` directly via PostgREST, so `follow_ups_insert`'s RLS check genuinely applies here — but there's no UI-level gate on the dialog's trigger button, so a user without the permission sees the button and dialog and is only rejected at submit.
- **Test:** `tests/unit/activity.test.js:270` proves `editOutcomes` is required for `log_activity()`, but no test covers `createFollowUps` specifically, nor the fact that the dominant path ignores it entirely.
- **Status:** UNENFORCED (the permission has no real-world teeth on its dominant creation path; the one path where RLS could apply has no UI signal either).
- **Guards data:** yes — flagged.
  - (a) Enforce: add `if p_fu_date is not null and not has_permission_for(p_caller_id, 'createFollowUps') then raise exception ...` to `log_activity()` in `0017_log_activity.sql`, before its follow-up insert block; gate the follow-up-date field in `activityForm()` and `dealFuDlg()`'s trigger button on `can("createFollowUps")`.
  - (b) Mark unused: plausible, since the original demo never gated follow-up creation by a dedicated key either — document `createFollowUps` as vestigial/reserved and note the `follow_ups_insert` RLS check as advisory only, updating its migration comment so it doesn't imply a guarantee the app doesn't honor.

## editOutcomes — "Log and edit call outcomes"
- **Demo:** entire "Log an attempt" form replaced with a message when absent.
- **UI:** `src/features/activity.js:133` — whole-form gate.
- **DB:** enforced via `log_activity()`'s own re-check (`0017_log_activity.sql:~107`) rather than the (bypassed) `activities_insert` RLS policy — real enforcement, just via the SQL function, not the policy.
- **Test:** `tests/unit/activity.test.js:270` — direct, solid proof (SQLSTATE 42501 asserted for a `no_perms` role).
- **Status:** ENFORCED-UI-AND-DB. Worth flagging: the RLS policy alone would not have protected this path had the SQL function forgotten the check — exactly what happened to `createFollowUps` above.

## viewAttempts — "View previous attempts"
- **Demo:** attempt counts/history shown unconditionally everywhere — never gated in the demo either.
- **UI:** zero `can("viewAttempts")` call sites anywhere.
- **DB:** `activities_select` (`0015_rls.sql:209-217`) checks only general lead visibility (`can_see_member`), never `viewAttempts`.
- **Test:** none behavioral.
- **Status:** UNENFORCED.
  - (a) Enforce: gate the Attempts/Last-attempt/Last-outcome cells and history card in `src/views/lead.js` behind `can("viewAttempts")`; add `and has_permission('viewAttempts')` to `activities_select`'s `using` clause.
  - (b) Mark unused: reasonable — the demo never gated this by a distinct key either, folding it into the coarser (and already-enforced) lead-visibility boundary; documenting it as reserved/aspirational matches demo fidelity.

## browserDialer — "Use the browser dialer"
- **Demo:** grep-confirmed — **no browser-dialer feature exists anywhere in the 2208-line demo**, only the permission label itself.
- **UI/DB:** nothing to enforce — the feature was never built in the demo or the rebuild.
- **Status:** UNENFORCED (vestigial — not a regression, since the demo never implemented it either).
  - (a) Enforce: if a real dialer feature is ever built, gate its entry point and re-check inside its call-initiation function; no DB enforcement would be meaningful (same reasoning as `makeCalls`).
  - (b) Mark unused: reasonable — carried over from the demo's permission catalog for a feature that was never built anywhere; document as reserved for a future feature and exclude from future "is every key enforced" checks until it exists.

## viewPhones — "View phone numbers"
- **Demo:** `pretty(n)` masks the middle 3 digits of the *displayed* text when the viewer lacks the permission.
- **UI:** `src/core/util.js:15` — byte-identical to the demo. **This is display-formatting only**: the raw digits are already in the DOM/JS the moment the lead loads, and `callBtn`/`textBtn` build their `tel:`/`sms:` hrefs from the **raw**, unmasked number regardless of this permission (`src/features/activity.js:86-87`) — so even the "masked" fields leak the real number via the call/text button attributes.
- **DB:** `lead_phones` is **not** in the RLS table list at all — full default CRUD grant, no `org_id` scoping, no masking, no filtering of any kind.
- **Test:** none.
- **Status:** UNENFORCED at the level that matters (data access) — the UI layer is cosmetic string formatting, not a withheld-data control, and doesn't even apply consistently (call/text buttons bypass it).
- **Guards data:** yes, in intent — flagged.
  - (a) Enforce: (i) stop selecting the raw phone column server-side when `!can("viewPhones")` (requires a masking view/RPC — true masking can't be done client-side); (ii) enable RLS on `lead_phones` with org/visibility scoping at minimum; (iii) gate `callBtn`/`textBtn` themselves if masking is meant to be a real restriction, not cosmetic.
  - (b) Mark unused: reasonable — document that this was only ever meant as a glance-shield (over-the-shoulder viewing), matching the demo's own cosmetic-only property, and skip server-side work as out of scope.

## markSent — "Mark campaign messages as sent"
- **Demo:** button gated on `can("markSent")`.
- **UI:** `src/views/campaigns.js:166` — button-only; `markSent()` itself (`campaigns.js:189`) has no internal check.
- **DB:** the activity-logging half is gated by `editOutcomes` (not `markSent`); the campaign-card status UPDATE hits `campaign_leads`, which **has no RLS at all** — any authenticated member of any org could PATCH any card directly.
- **Test:** none.
- **Status:** UI-ONLY (and the underlying write is DB-unenforced entirely, not even by an unrelated permission).
- **Guards data:** low-severity (cosmetic tracking field, not compliance-relevant) but flagged for the cross-org write exposure.
  - (a) Enforce: enable RLS on `campaign_leads` with an update policy requiring `has_permission('markSent')`, scoped by org/visibility; have `markSent()` re-check the permission itself rather than relying solely on the hidden button.
  - (b) Mark unused: defensible if `campaign_leads` status is treated as low-sensitivity reporting data — but the residual cross-org write exposure should be documented explicitly either way.

## managerNotes — "Write manager-only notes"
- **Demo:** manager-only checkbox and note-kind filtering gated.
- **UI:** checkbox gate (`src/views/lead.js:73`) and read-filtering at multiple call sites (`lead.js:72`, `deal.js:36`, `workspace.js:48,71`, `exports.js:96`). `addNote()` trusts the checkbox rather than re-verifying, but the real backstop is DB-side.
- **DB:** `notes_select`/`notes_insert` (`0015_rls.sql:244-253,258-269`) both check `has_permission('managerNotes')` on the manager-kind branch, via the real, non-bypassed direct-REST path.
- **Test:** none isolates this key specifically, though the mechanism is the same well-proven RLS pattern.
- **Status:** ENFORCED-UI-AND-DB — the cleanest, most complete enforcement chain in this group.

---

# Group 3: CRM Pipeline (9 keys)

**Headline finding for this group:** the alleged client-side "key substitution" bug (`viewTeamPipeline`/`viewAllPipelines` swapped) is **false** — `canSeeDeal()` (`src/features/crm.js:58`) is byte-identical to the demo and correctly OR's in both pipeline keys at the right positions. However, a **real, more consequential substitution exists at the database layer**: the RLS helper `can_see_member()` (used by `deals_select`/`deals_update`) checks only `viewAllLeads`/`viewTeamLeads` — **it never checks `viewAllPipelines`/`viewTeamPipeline` at all**. A role granted a pipeline-scope key but not the matching Leads key sees the right rows in the UI but gets them silently filtered out (or rejected) by Postgres RLS underneath. This affects both `viewTeamPipeline` and `viewAllPipelines` below.

## viewOwnPipeline — "View own pipeline"
- **Demo:** catalog entry only — never referenced by any `can()` call in the demo; own-deal visibility is unconditional (`d.assigned===me.id`).
- **UI/DB:** same — unconditional in both layers, matching the demo exactly.
- **Test:** none isolates it (appears only in role-array fixtures).
- **Status:** UNENFORCED (by design/fidelity).
  - (a) Enforce: make own-deal visibility conditional on this key in `canSeeDeal()` and add a matching RLS branch.
  - (b) Mark unused: reasonable — decorative in the demo, granted to every role including `viewer`, no demo UX ever offered a toggle with real teeth; recommend documenting as intentionally inert rather than diverging from demo fidelity.

## viewTeamPipeline — "View team pipeline"
- **UI:** `src/features/crm.js:58`, correctly OR'd with `viewTeamLeads` — no client-side bug (see Headline Finding).
- **DB:** `can_see_member()` never checks this key — role with `viewTeamPipeline` but not `viewTeamLeads` is blocked at the DB layer despite correct client logic.
- **Test:** `tests/security/rls.test.js:362` tests team-boundary generally but with a role that holds neither key, so it doesn't isolate this specific mismatch.
- **Status:** UI-ONLY (functionally correct in the UI; DB enforcement exists for the table but is keyed to the wrong/incomplete permission set).
- **Guards data:** yes — flagged.
  - (a) Enforce: update `can_see_member()` (or a sibling function) to OR in `has_permission('viewTeamPipeline')` alongside `viewTeamLeads`, mirroring the client exactly; add a regression test granting the pipeline key without the leads key.
  - (b) Mark unused: only if the product intent is "pipeline visibility always rides on lead visibility" — then retire `viewTeamPipeline`/`viewAllPipelines` as independently-grantable keys and merge into the Leads equivalents; this would be a deliberate behavior change from the demo's model of separately-assignable permissions, not a silent fix.

## viewAllPipelines — "View all pipelines"
- Same pattern and same DB gap as `viewTeamPipeline` (checked against `viewAllLeads` instead). Under Supabase, `search_deals()` (`0018_search_deals.sql`) runs under caller RLS, so the DB simply returns fewer rows than the client believes it's entitled to — silent under-filtering, no error.
- **Test:** `tests/security/rls.test.js:358` tests org isolation, not this specific key mismatch.
- **Status:** UI-ONLY. (a)/(b) identical reasoning to `viewTeamPipeline`.

## moveStages — "Move leads between stages"
- **Demo:** `moveDeal()` checks the permission and toasts.
- **UI:** `src/features/crm.js:160` — real function-level check (the Move button/drag handle itself is unconditional; enforcement happens on attempt, not on visibility).
- **DB:** `deals_update`, `0015_rls.sql:157-166` — checks `moveStages` (OR'd with `reassign`/`editDealFinancials`/own-row). Documented caveat: this is a single row-level policy, so it can't distinguish "changed stage" from "changed price" at the column level — a user with only `editDealFinancials` could in principle also slip a stage change through the same UPDATE via direct REST (accepted/documented gap in the migration's own comments).
- **Test:** `tests/security/rls.test.js:362`.
- **Status:** ENFORCED-UI-AND-DB (with the documented row-vs-column caveat noted above, not treated as a separate open item unless you want tighter column-level enforcement).

## manageCrm — "Edit pipeline stages"
- **Demo:** view-level gates only; underlying stage functions never checked internally in the demo either.
- **UI:** view/panel-level only — `src/views/crm.js:15,37`, `src/views/settings.js:426` (whole Pipelines panel blocked). The actual mutating functions (`stageMenu`, `moveStage`, `archiveStage`, `restoreStage`, `deleteStage`, `addStageDlg`, `pipelineDlg` — `src/features/crm.js:372-463`) have **no internal check** — console-callable regardless of role.
- **DB:** **`pipelines`/`stages` tables have zero RLS policy** — any authenticated user of any role can INSERT/UPDATE/DELETE directly, completely bypassing `manageCrm`.
- **Test:** none tests pipeline/stage write permissions.
- **Status:** UNENFORCED at the DB layer (critical — fully open write access), UI-ONLY at best client-side (and only at panel-visibility level, not function-level, unlike `moveStages`/`editDealFinancials`).
- **Guards data:** yes, and this is the one key in this group where "mark unused" is not defensible.
  - (a) Enforce: enable RLS on `pipelines`/`stages`, gate writes on `org_id = current_org_id() and has_permission('manageCrm')`; add internal checks to all 7 feature functions listed above.
  - (b) Mark unused: not recommended — genuine open write-access hole, not a cosmetic gap.

## viewPrices — "View potential sale prices"
- **Demo — important correction:** `viewPrices` is defined and role-seeded but **never actually checked anywhere in the original demo** — prices render unconditionally there. The rebuild's UI gating is a **deliberate enhancement beyond demo fidelity**, not a faithful reproduction of existing demo behavior.
- **UI:** `src/features/crm.js:354` (board card), `src/views/deal.js:57` (detail view), `src/views/crmdash.js:89` (KPI tile) — all render/suppress conditionally.
- **"Guards data" classification:** **display-only suppression of already-delivered data.** `d.price` is fully present in `db.deals`/the wire payload (`search_deals()` in `0018_search_deals.sql` has zero `has_permission()` calls) — a user without the permission can read the true price via devtools/Network tab/console regardless of what's rendered.
- **DB:** no column-level restriction anywhere; `deals_select` is row-level only.
- **Test:** `tests/unit/deal-money-permission.test.js`, `tests/unit/crm-board-money-permission.test.js` — correctly verify DOM suppression, but structurally cannot (and don't) prove the underlying data is withheld, because it isn't.
- **Status:** UI-ONLY (display-only gate on data already fully delivered — not a real access control).
- **Guards data:** yes, in intent, but not in practice today — flagged.
  - (a) Enforce: redact price (and price-derived) columns server-side in `search_deals()` based on `has_permission('viewPrices')`, since RLS is row-level and can't do this alone.
  - (b) Mark unused: reasonable given the demo itself never enforced this — document the current UI gating as a "display convenience, not a security boundary" enhancement, and skip server-side redaction unless real data protection is wanted.

## viewCommissions — "View commissions"
- Same pattern, same demo history (defined/seeded but never enforced in the demo), same display-only classification as `viewPrices`. Commission/net/weighted figures and all their math inputs are fully present in the wire payload; `dealMath()` computes them client-side from already-delivered data.
- **UI:** `src/features/crm.js:354`, `src/views/deal.js:62`, `src/views/crmdash.js:32,55,69,89`.
- **Test:** `tests/unit/deal-money-permission.test.js`, `tests/unit/crm-board-money-permission.test.js`.
- **Status:** UI-ONLY (display-only). (a)/(b) identical reasoning to `viewPrices`.

## editDealFinancials — "Edit financial information"
- **Demo:** `setDealField()` checks the permission OR ownership.
- **UI:** `src/features/crm.js:255` — real function-level check (`!can("editDealFinancials") && d.assigned!==me.id` → refuse), matching the demo exactly; `src/views/deal.js:50` disables inputs to match.
- **DB:** `deals_update`, `0015_rls.sql:157-166` — checked, with the same documented row-vs-column caveat as `moveStages` (a test, `tests/security/rls.test.js:366`, is explicitly labeled informational/deferred for this exact limitation, and it's an accepted consequence of the client-side OR-with-ownership logic, not a real bypass of intended behavior).
- **Test:** `tests/security/rls.test.js:366`; no unit test isolates the non-assigned-user-with-the-permission case specifically.
- **Status:** ENFORCED-UI-AND-DB.

## exportCrm — "Export pipeline information"
- **Demo:** button gated; function itself unchecked in the demo (matches rebuild).
- **UI:** `src/views/crm.js:29`, `crmdash.js:82` — button-only. `exportCrm()` (`src/features/crm.js:524-535`) has no internal check but does correctly re-derive `canSeeDeal()` per row, so a devtools-invoked export is still scoped to visible deals (subject to the same viewTeamPipeline/viewAllPipelines DB mismatch noted above on Supabase).
- **DB:** no RLS references `exportCrm` — it's a pure client-side CSV action with no dedicated endpoint; the only real protection in play is the row-visibility boundary (`deals_select`), not an export-specific one.
- **Test:** `tests/unit/export-crm-columns.test.js` tests CSV formatting, not the permission gate.
- **Status:** UI-ONLY.
- **Guards data:** yes, unlike the decorative pipeline-visibility keys above — this genuinely gates bulk data egress.
  - (a) Enforce: add `if(!can("exportCrm")) return toast(...)` as the first line of `exportCrm()`, `src/features/crm.js:524`.
  - (b) Mark unused: not recommended — real, consequential action; enforce it instead.

---

# Group 4: Campaigns (6 keys)

**Cross-check against CHANGELOG.md:** the "Pre-launch audit" section's "flagged, deliberately not fixed" list names `createTemplates`, `deleteCampaigns`, and `assignCampaigns` from this group as defined-but-never-enforced, matching the demo. It does **not** mention `editCampaigns` or `creativeMessages`, even though both are verified below to be equally, completely dead (grep-confirmed: each appears only in `src/core/permissions.js`'s own definition and the `MANAGER_BASE` array, never in a single `can()` call site anywhere else). This is a real, independently-confirmed gap between the CHANGELOG's disclosed list and the actual code.

## manageCampaigns — "Create campaigns"
- **Demo:** the workhorse permission for nearly all campaign write actions.
- **UI:** extensively gated across `src/views/campaigns.js` (new/edit/duplicate/archive, templates dialog, mark-drafts-ready), `src/views/lead.js`/`leads.js`/`lists.js` (add-to-campaign), `src/features/campaigns.js:56`.
- **DB:** **no RLS on `campaigns`, `campaign_leads`, or `message_templates` at all** — default full-CRUD grant.
- **Test:** `tests/e2e/campaigns.spec.js:83` exercises the "Mark all drafts ready" UI gate at e2e level; no RLS test touches these tables at all.
- **Status:** UI-ONLY.
- **Guards data:** yes — flagged.
  - (a) Enforce: enable RLS on the three campaign tables with insert/update/delete policies keyed on `has_permission('manageCampaigns')`, org-scoped, mirroring `leads_insert`/`leads_update`.
  - (b) Mark unused: not applicable — this is clearly a live, heavily-used permission; only option (a) fits.

## editCampaigns — "Edit campaigns" — undisclosed dead key
- **Demo:** no distinct "edit" permission in the demo — all edits ride on `manageCampaigns`.
- **UI:** **grep-confirmed zero call sites** outside its own definition and `MANAGER_BASE`.
- **DB:** no RLS coverage (moot — the key gates nothing to protect).
- **Test:** none behavioral.
- **Status:** UNENFORCED (dead key, **not disclosed in CHANGELOG.md** despite being exactly as dead as the three keys that are disclosed there).
  - (a) Enforce: split campaign-edit actions in `src/views/campaigns.js` onto `can("editCampaigns")` distinct from `manageCampaigns`'s create actions, plus a matching `campaigns_update` RLS policy.
  - (b) Mark unused: if create/edit are meant to stay merged under `manageCampaigns` (matching actual demo behavior), formally add `editCampaigns` to CHANGELOG's disclosed dead-permission list so it's not silently omitted.

## deleteCampaigns — "Delete campaigns"
- **Demo:** the demo never hard-deletes a campaign — only archives (`archiveCampaign()`, gated by `manageCampaigns`).
- **UI/DB:** grep-confirmed dead, same as above.
- **Test:** listed in CHANGELOG's disclosed dead list.
- **Status:** UNENFORCED (disclosed).
  - (a) Enforce: add a real hard-delete admin action gated by this key, plus a `campaigns_delete`/`message_templates_delete` RLS policy.
  - (b) Mark unused: reasonable — already documented, archiving already covers the product need; consider removing from the assignable Roles UI.

## assignCampaigns — "Assign campaigns"
- **Demo:** no distinct "assign a campaign" feature exists — campaign-to-lead/list attachment is gated by `manageCampaigns` only.
- **UI/DB:** grep-confirmed dead.
- **Test:** listed in CHANGELOG's disclosed dead list.
- **Status:** UNENFORCED (disclosed).
  - (a) Enforce: only meaningful if a real assignment feature is built later.
  - (b) Mark unused: reasonable — no such feature exists in the demo's spec at all.

## createTemplates — "Create message templates"
- **Demo:** template CRUD exists but is gated by `manageCampaigns`, not a dedicated key.
- **UI/DB:** grep-confirmed dead — `templatesDlg`/`templateForm`/`deleteTemplate` all check `manageCampaigns`, never `createTemplates`.
- **Test:** listed in CHANGELOG's disclosed dead list.
- **Status:** UNENFORCED (disclosed).
  - (a) Enforce: split template CRUD onto `can("createTemplates")`, plus a `message_templates` RLS policy.
  - (b) Mark unused: already documented and acceptable if templates should stay under `manageCampaigns`.

## creativeMessages — "Use creative-message generation" — undisclosed dead key, fully vestigial
- **Demo:** grep of the entire demo finds the string "creative" **only** in this permission's own label — no AI/creative-message feature was ever built there.
- **UI:** grep-confirmed zero call sites; no such feature exists in the rebuild either.
- **DB:** no table/feature to protect.
- **Test:** none behavioral.
- **Status:** UNENFORCED (fully vestigial — no feature exists at all; **not disclosed in CHANGELOG.md**, the strongest candidate in this group for formal "not implemented" documentation).
  - (a) Enforce: N/A unless a creative-message-generation feature is actually built.
  - (b) Mark unused: recommended — remove from the assignable Roles UI or explicitly flag in CHANGELOG as referencing a feature that was never built in the demo or the rebuild.

---

# Group 5: Team management (6 keys)

## viewTeamMembers — "View team members"
- **Demo:** intent per test comments — agents should see teammates' roster, not all-org members.
- **UI:** **zero call sites** — the admin Users table renders unconditionally for anyone who can open the Admin page.
- **DB:** `members` has no RLS at all.
- **Test:** `tests/security/rls.test.js:307` — an existing, **currently-failing** `[EXPECTED TO FAIL until fixed]` test proving a plain agent can read every org member including other teams' emails.
- **Status:** UNENFORCED.
- **Guards data:** yes — flagged; already has a real failing test documenting it.
  - (a) Enforce: enable RLS on `members` with a select policy using `has_permission('viewTeamMembers') and same_team(id)` (plus a bypass for `viewAllLeads`/`editUsers`/super-admin).
  - (b) Mark unused: if the product decision is "any signed-in member may see the full roster" (today's de facto behavior), formally deprecate this key as a documented no-op.

## createTeams — "Create teams"
- **UI:** `src/views/admin.js:23,142` — button and tab-visibility gates.
- **DB:** no RLS on `teams` at all.
- **Test:** none dedicated.
- **Status:** UI-ONLY.
  - (a) Enforce: enable RLS on `teams` with an insert policy keyed to `has_permission('createTeams')`.
  - (b) Mark unused: not applicable — real, reachable admin action.

## editTeams — "Edit teams"
- **UI:** `src/views/admin.js:149,23` (Edit/Archive/Restore buttons, tab visibility). The team-edit dialog's member-checkbox list has no independent check beyond this gate — see `assignMembers` below.
- **DB:** no RLS on `teams`/`team_members`.
- **Test:** none dedicated.
- **Status:** UI-ONLY.
  - (a) Enforce: add a `teams_update` RLS policy keyed to `has_permission('editTeams')`.
  - (b) Mark unused: not applicable — real, reachable write path.

## assignMembers — "Assign members to teams" — confirmed orphaned
- **Demo/UI:** grep-confirmed **zero `can("assignMembers")` call sites** anywhere except widening the Teams tab's visibility condition. The actual member-assignment UI (team-edit dialog's member checkboxes, and the user-edit dialog's team checkboxes) are gated by `editTeams` and `editUsers` respectively — **never** by `assignMembers`, despite it being a real, distinct `PERMISSIONS` entry in `MANAGER_BASE` (unlike `manageMembers`, confirmed to be purely a `LEGACY_CAP` alias target, not a live catalog entry, with no current caller anywhere).
- **DB:** no RLS on `team_members`.
- **Test:** none behavioral.
- **Status:** UNENFORCED (orphaned — exists as a role-seedable key with no consuming code path).
  - (a) Enforce: replace the `editTeams`/`editUsers` guards around the member-checkbox blocks with `can("assignMembers")||can("editTeams")` (or `editUsers`) so the more specific, lower-privilege-tier key genuinely does something distinct.
  - (b) Mark unused: alternatively, remove `assignMembers` from `PERMISSIONS` and fold it permanently into `editTeams`, since that's what already gates its only reachable UI.

## assignManagers — "Assign team managers"
- **UI:** `src/features/admin.js:197` — the "Team manager" select renders only with this permission (or when creating a brand-new team).
- **DB:** no RLS on `teams` — `manager_id` has no column-level or row-level protection at all.
- **Test:** none dedicated.
- **Status:** UI-ONLY.
  - (a) Enforce: cover with the same `teams_update` RLS policy proposed for `editTeams`, optionally adding column-level precision via a trigger for `manager_id` specifically.
  - (b) Mark unused: not applicable — real, reachable admin action.

## viewTeamReports — "View team performance"
- **UI:** the most-enforced key in this group — gated across `reports.js`, `dashboard.js`, `crmdash.js`, `stats.js`, `exports.js` (many call sites).
- **DB:** no table's RLS references this key at all — the underlying data (`activities`/`deals`/`leads`) is already protected by `viewAllLeads`/`viewTeamLeads`/ownership, but a role with `viewTeamReports` and neither Leads key is blocked client-side only from the aggregate view, while a direct query still enforces the (different) leads-visibility rule.
- **Test:** `tests/unit/stats.test.js`, `tests/e2e/dashboards.spec.js` — unit/e2e level, not DB.
- **Status:** UI-ONLY.
- **Guards data:** partially — the underlying rows are already protected by other enforced keys, but aggregate exports (e.g. `team_performance` CSV) go beyond raw row exposure.
  - (a) Enforce: ensure any server-side reporting RPC/view internally checks `has_permission('viewTeamReports')` before returning cross-member aggregates, rather than relying on the client to only request the narrower query.
  - (b) Mark unused: defensible for pure dashboard reads (bounded by already-enforced row visibility) but not for the CSV export path — recommend (a) as the safer choice given that distinction.

**On `set_member_role`:** grep-confirmed to not exist anywhere in the repo as a named symbol — not merely unreachable, it was never built. The real role-assignment path is `setRole()` (`src/features/admin.js:185`), correctly gated by `editUsers` at its call site, including a self-demotion guard.

**On `manageMembers`:** confirmed to be purely a `LEGACY_CAP` alias target (`archiveLeads`/`manageMembers` → `deleteLeads`/`editUsers`), not a live `PERMISSIONS` array entry — it exists only for migrating old saved data and for SQL's alias-aware `has_permission()`. No current code calls `can("manageMembers")` as a forward-looking gate.

---

# Group 6: Competitions (6 keys)

**Overarching finding:** **no `competitions` table (or scoring-rules table) exists anywhere in `supabase/migrations/*.sql`.** This matches the original demo exactly — the demo never had a writable competitions entity either; "Scoring settings" in the demo just opens the global Settings → scoring tab (gated by `manageSettings`, a different key entirely). The rebuild's Scoreboard is a purely computed, read-only view derived from `activities`+`members`+global `settings`. All 6 keys in this group are, and always were (including in the ground-truth demo), fully decorative.

## viewCompetitions
- **UI/DB:** zero call sites anywhere; scoreboard renders unconditionally for every active member.
- **Test:** none behavioral — appears only in bulk fixture arrays.
- **Status:** UNENFORCED.
  - (a) Enforce: gate the scoreboard nav entry/page on this key.
  - (b) Mark unused: reasonable — the underlying data is already bounded by other enforced permissions, and the demo never gated visibility either.

## participate
- **UI/DB:** zero call sites; no participation/opt-in concept exists at all (stats simply appear).
- **Status:** UNENFORCED.
  - (a) Enforce: only meaningful if a real opt-out concept is added.
  - (b) Mark unused: strong candidate — no participation gate ever existed in the demo either.

## createCompetitions
- **UI/DB:** zero call sites; **no table exists to write to**.
- **Status:** UNENFORCED.
- **Guards data:** would, if the feature existed — currently moot.
  - (a) Enforce: requires net-new schema (a `competitions` table + RLS) before any UI gate would mean anything.
  - (b) Mark unused: the honest disposition given no underlying entity exists in the demo or the rebuild — recommend this over faking a UI gate over a nonexistent write path.

## editCompetitions
- Same as `createCompetitions` — no entity to edit.
- **Status:** UNENFORCED. (a)/(b) identical reasoning.

## manageScoring
- **Demo:** the only scoring-adjacent action in the demo ("Scoring settings" button) is gated by `manageSettings`, **not** `manageScoring` — this key was already dead in the ground-truth demo.
- **UI:** `src/views/scoreboard.js:14` — confirmed gated on `manageSettings`, matching the demo's own mismatch.
- **DB:** the `settings` table (holding point-values) has no RLS regardless of which key nominally guards it.
- **Status:** UNENFORCED.
  - (a) Enforce: if `manageScoring` is meant to be the real gate, switch `scoreboard.js:14`'s condition to it and add RLS coverage for `settings`.
  - (b) Mark unused: reasonable given the demo itself never wired this key to anything — document as a duplicate of `manageSettings` rather than introduce a second, redundant gate.

## viewAllResults
- **Demo:** scoreboard shows every member's results to every viewer unconditionally, even in the demo.
- **UI:** `src/views/scoreboard.js:13` — no filter applied.
- **DB:** no competition-results table exists; underlying data is filtered by other enforced keys.
- **Status:** UNENFORCED.
  - (a) Enforce: filter `rows` by `can("viewAllResults")` vs. same-team/self, mirroring the `sameTeam` pattern used elsewhere.
  - (b) Mark unused: reasonable if a fully public, org-wide leaderboard is the intended design (as the demo's own behavior suggests) — mark intentionally unused rather than scope down a feature that may be deliberately public.

---

# Group 7: Administration (13 keys)

**Zero of these 13 keys are ENFORCED-UI-AND-DB.** Every one is at best UI-ONLY, and 8 of the 13 (`deactivateUsers`, `createRoles`, `editPermissions`, `viewAudit`, `manageSettings`, `manageOutcomes`, `manageFields`, `manageStatuses`) have **no server-side check of any kind** — not even an edge function — sitting in front of a completely unprotected table; the client-side `can()` call is the only gate that exists anywhere.

**Highest-severity, confirmed-with-a-live-test finding:** `createRoles` and `editPermissions` gate the `roles`/`role_permissions` tables, which have **zero RLS policies**. `tests/security/rls.test.js:289-298` already contains a currently-failing test proving a plain `agent` role can `UPDATE role_permissions SET allowed=true WHERE permission_key='editPermissions'` directly via PostgREST, bypassing the correctly-written `save-permissions` edge function entirely — after which that agent's own `can("editPermissions")` evaluates true, letting them cascade into granting themselves every other permission in the app. This is the single most important finding across all 62 keys in this report.

## createUsers
- **UI:** `src/views/admin.js:23,46,47`.
- **DB:** `members` has no RLS; the privileged action (creating the Supabase Auth user) does go through the service-role `admin-create-user` edge function, which correctly checks `caller.active`, org match, and `createUsers` — but a direct `insert into members` bypasses that entirely.
- **Test:** `tests/security/edge-functions-static.test.js` verifies the function's own check.
- **Status:** UI-ONLY.
  - (a) Enforce: enable RLS on `members` with an insert policy keyed to `has_permission('createUsers')`.
  - (b) Mark unused: not applicable — active, demo-parity feature.

## editUsers (also the `manageMembers` alias target)
- **UI:** `src/views/admin.js:23,46,59`; self-demotion guard at `src/features/admin.js:75`.
- **DB:** `members` has no RLS. **Live proof of the worst-case escalation:** `tests/security/rls.test.js:265-279` (`[EXPECTED TO FAIL until fixed]`) — a plain agent can `UPDATE members SET role_id='owner'` directly; lines 280-288 prove an org-hop via `members.org_id` the same way.
- **Status:** UI-ONLY, with the single most dangerous sub-case (role self-escalation) already proven live and unfixed.
- **Guards data:** yes — highest priority alongside `editPermissions`.
  - (a) Enforce: add a `members_update` RLS policy requiring `has_permission('editUsers')`, following the `deals_update` OR-of-permissions pattern (note this alone doesn't close the deeper hole in §`editPermissions` below — a caller could still grant themselves `editUsers` first via the unprotected `role_permissions` table, so both fixes are needed together).
  - (b) Mark unused: not applicable.

## deactivateUsers
- **UI:** `src/views/admin.js:23,61`; `src/features/admin.js:142` (function-level check).
- **DB:** `members` has no RLS; no edge function sits in front of this action at all — a bare client `can()` gate calling an unprotected table directly. `tests/security/rls.test.js:341-354` shows a deactivated member's Supabase Auth session still resolves normally — deactivation isn't enforced at the session level either, only by the app's own sign-in flow.
- **Status:** UI-ONLY.
  - (a) Enforce: fold into the same `members_update` policy proposed for `editUsers`, OR-ing in `has_permission('deactivateUsers')`.
  - (b) Mark unused: not applicable.

## resetPasswords
- **UI:** `src/views/admin.js:23,60`.
- **DB:** the core action (`auth.admin.updateUserById`) genuinely cannot be bypassed via PostgREST — it requires the service-role key, so there is no "front door to skip" for the password itself. The function's own `members.must_change_pw` side-write, however, hits the unprotected `members` table.
- **Test:** `tests/security/edge-functions-static.test.js`.
- **Status:** UI-ONLY per the classification rule for edge-function-only checks, but with an explicit nuance: the password-setting action itself is already un-bypassable by design; only the minor `must_change_pw` flag is exposed.
  - (a) Enforce: fold `resetPasswords` into the same `members_update` policy's OR-list to close the flag-only gap.
  - (b) Mark unused: not applicable to the core action (already safe); optional for the minor flag.

## createRoles — HIGHEST-STAKES KEY
- **UI:** `src/views/admin.js:23,69,70`.
- **DB:** **confirmed, zero RLS on `roles`.** `save-permissions`'s `create_role` action checks this key correctly — but bypassable via direct REST since the table has no policy of its own.
- **Status:** UI-ONLY.
- **Guards data:** yes — this key gates the permission system itself.
  - (a) Enforce: enable RLS on `roles` with insert/update/delete policies keyed to `has_permission('createRoles')`/`has_permission('editPermissions')`, mirroring the `leads_*` pattern.
  - (b) Mark unused: not applicable — cannot be marked unused.

## editPermissions — HIGHEST-STAKES KEY, LIVE PROVEN BYPASS
- **UI:** `src/views/admin.js:69,71,90,104`.
- **DB:** **confirmed, zero RLS on `role_permissions`.** `save-permissions`'s `save_permissions`/`rename_role`/`delete_role` actions correctly check this key — but, as detailed above, `tests/security/rls.test.js:289-298` already proves the front door is trivially bypassed by writing to the table directly.
- **Status:** UI-ONLY — the single worst finding in this entire report.
- **Guards data:** yes — gates the entire permission system; already has a live failing test.
  - (a) Enforce: enable RLS on `role_permissions` with a write policy requiring `has_permission('editPermissions')` (optionally also reproducing the app's own "can't remove your own editPermissions" rule server-side, matching `savePermissions()`'s client check).
  - (b) Mark unused: not applicable.

## manageIntegrations
- **UI/DB:** no Integrations feature exists anywhere in the demo or the rebuild — confirmed dead, matching demo behavior (a pre-existing stub, not a regression). Already flagged in `docs/certification/traceability.md` (D013) and `docs/CHANGELOG.md`.
- **Status:** UNENFORCED.
  - (a) Enforce: N/A — no feature/table exists.
  - (b) Mark unused: recommended — already documented as dead (D013); leave flagged rather than build a facade gate.

## viewAudit
- **UI:** `src/views/settings.js:21`, `src/views/audit.js:30`.
- **DB:** **no RLS on `audit_log` at all** — confirmed by the codebase's own comment in `src/data/repo-supabase.js:876-881` admitting this convention for several admin tables. No edge function sits in front of it either — a bare client-side `can()` call in front of a plain, unprotected `select`. `tests/security/rls.test.js:317-339` proves the adjacent write-side (delete) is equally unprotected and cross-org reachable.
- **Status:** UI-ONLY — among the most exposed keys in the group, tied with `editPermissions` for having no server-side check whatsoever.
  - (a) Enforce: enable RLS on `audit_log` with a select-only policy (`org_id = current_org_id() and has_permission('viewAudit')`), deny-by-default for writes.
  - (b) Mark unused: not applicable — active feature exposing genuinely sensitive log data.

## exportReports — confirmed dead/orphaned, matches disclosed finding D013
- **UI/DB:** grep-confirmed **zero `can("exportReports")` call sites** — every real export surface, and `org-backup`'s own edge-function check, actually key off the separate `export` permission instead.
- **Status:** UNENFORCED (dead key, matches demo, already disclosed in D013).
  - (a) Enforce: N/A — no feature distinct from `export` exists.
  - (b) Mark unused: recommended — already documented; leave as-is to avoid diverging from demo parity.

## manageSettings
- **UI:** `src/views/settings.js:35,89,155` (Team name, Import config, Scoring & goals tabs).
- **DB:** **no RLS on `org_settings`** — no edge function either, a bare client write to an unprotected table.
- **Status:** UI-ONLY.
  - (a) Enforce: enable RLS on `org_settings` with an update policy keyed to `has_permission('manageSettings')`.
  - (b) Mark unused: not applicable — active feature across three settings tabs.

## manageOutcomes
- **UI:** `src/views/settings.js:132,134,135`.
- **DB:** **no RLS on `outcomes`** — no edge function.
- **Status:** UI-ONLY.
  - (a) Enforce: enable RLS on `outcomes` with insert/update/delete policies keyed to `has_permission('manageOutcomes')`, with a permissive same-org select (everyone needs to read outcomes to log a call).
  - (b) Mark unused: not applicable — active feature.

## manageFields
- **UI:** `src/views/settings.js:45,49-52,56`; `src/features/leads.js:231`.
- **DB:** **no RLS on `custom_fields`/`built_in_fields`** — no edge function.
- **Status:** UI-ONLY.
  - (a) Enforce: enable RLS on both tables, insert/update/delete keyed to `has_permission('manageFields')`, permissive same-org select.
  - (b) Mark unused: not applicable — active feature.

## manageStatuses
- **UI:** `src/views/settings.js:132,137-140`.
- **DB:** **no RLS on `statuses`** — no edge function.
- **Status:** UI-ONLY.
  - (a) Enforce: enable RLS on `statuses`, insert/update/delete keyed to `has_permission('manageStatuses')`, permissive same-org select.
  - (b) Mark unused: not applicable — active feature.

---

# visibleLeads() team-scope confirmation (per your explicit instruction)

Your instruction: *"Confirm visibleLeads respects team scope (demo defect fixed in Stage 14). Test it as a team member of Team A trying to see Team B."*

The existing `tests/unit/visible-leads.test.js` only covered "a team member vs. a member with no team at all" — not two distinct named teams. A new test was written to close that gap precisely as specified:

**New file: `tests/unit/visible-leads-team-scope.test.js`**
- Creates two distinct named teams — **Team A** (a manager + an agent) and **Team B** (a separate manager + agent), using the same mock/import pattern as the existing test file.
- The Team A manager holds `isa_manager` (real `viewTeamLeads`, explicitly **not** `viewAllLeads` — the exact scope needed to exercise this).
- A lead owned by the Team B agent, and a second lead owned by the Team A manager's own teammate.
- Asserts, as the Team A manager: `canSee(teamBLead)` is `false` and the lead does **not** appear in `visibleLeads()` — Team A cannot see Team B's lead.
- Asserts, as the same manager: `canSee(teamALead)` is `true` and the lead **does** appear in `visibleLeads()` — proving this is selective denial across teams, not a global lockout bug.

**Result: PASSED.** No source changes were made or needed — `visibleLeads()`/`canSee()` (`src/features/activity.js:21-22`) correctly deny Team A visibility into Team B's lead while preserving same-team visibility.

```
 ✓ tests/unit/visible-leads-team-scope.test.js  (1 test) 634ms
 ✓ tests/unit/visible-leads.test.js  (1 test) 128ms

 Test Files  2 passed (2)
      Tests  2 passed (2)
```

This confirms the Stage 14 demo-defect fix holds for the client-side visibility function specifically. Note this is a UI-layer confirmation only — as documented under `viewTeamLeads`/`viewAllLeads` above, the RLS-layer equivalent (`can_see_member()` in `0015_rls.sql`) already has its own two-named-team coverage via the existing `tests/security/rls.test.js:220` (Team North/Team South fixtures), so both layers now have a distinct-named-team proof.

---

# Change footprint for this gate

```
$ git status --short
?? docs/certification/          (new: this file, permissions.md)
?? tests/unit/visible-leads-team-scope.test.js   (new test only)
```

No file under `src/**` or `supabase/**` was modified. This gate is report-only, per your instruction — every UNENFORCED/UI-ONLY key above is awaiting your per-key decision (enforce with the exact change given, or mark intentionally unused) before any fix is made.
