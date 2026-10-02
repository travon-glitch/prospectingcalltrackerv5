# GAP Verification Report — runtime audit of all 116 untested features

This document follows up on `docs/certification/traceability.md` (GATE G1). That document was a
**static** trace: it confirmed every demo feature has matching code and flagged 116 of 190
features as `GAP` because no automated test in `tests/` currently exercises them. `GAP` never
meant "broken" — it meant "unproven by the test suite."

This audit closes that gap in a different way: every one of the 116 `GAP`-marked features was
**actually executed** — via Playwright against a live instance of the app (local backend,
`npm run build && vite preview`, seeded demo data) and, for pure logic functions, via Node
scripts importing the real `src/` modules directly — rather than re-read and assumed correct.
No permanent test files were added and no `src/`/`supabase/` file was modified; verification
scripts were scratch files, since discarded. `git status --short` shows only this new
`docs/certification/` directory.

**Result: 114 of 116 WORK exactly as designed. 2 are PARTIAL (real, minor gaps, described
below). 0 are BROKEN or missing entirely.** Two additional findings — outside the original 116 —
surfaced incidentally during verification and are reported at the end.

## Method

- 6 parallel verification passes, each covering ~15-20 features, signed in as the seeded demo
  users (Travon Burnette = owner, Maria Lopez = manager, Devin Carter = agent) to also confirm
  permission gates.
- For each item: drive the actual UI flow a user would (click, type, submit), or call the actual
  exported function with realistic inputs, then inspect the real resulting state (DOM, `db`
  object, downloaded file, clipboard, localStorage) — not just that a handler exists or a
  function runs without throwing.
- Cross-checks against seed data where possible (e.g. a lead's attempt count verified against
  the actual activities array in `src/data/seed.js`, not just that the function returns *a*
  number).

## Full results (116/116)

All items carry the same ID as `docs/certification/traceability.md`. Verdict legend: **WORKS**
(behaves exactly as the demo specified), **PARTIAL** (implemented, but a real discrepancy from
spec was found and is described), **BROKEN**/**NOT-FOUND** (none found).

### WORKS (114 of 116)

Permissions & roles — F001✓ F002✓ F004✓ F006✓ F008✓
Built-in fields — F009✓ F010✓
Lead statuses — F012✓ F013✓
Session & derived helpers — F014✓ F018✓ F019✓ F020✓ F021✓ F023✓ F026✓
Custom fields — F028✓ F029✓ F030✓ F031✓ F032✓ F033✓ F034✓ F035✓ F036✓ F037✓ F038✓ F039✓ F040✓ F041✓ F042✓
State & routing — F045✓ F046✓ F047✓ F049✓
Leads: filtering & list screen — F053✓
Leads: mutations — F056✓ F057✓ F058✓ F061✓ F062✓
Call actions & activity logging — F064✓ F065✓ F066✓ F067✓
Workspace / call-mode screen — F071✓ F075✓ F076✓ F077✓ F078✓
Prospecting lists — F080✓ F081✓ F082✓ F083✓ F085✓
Campaigns — F086✓ F087✓ F088✓ F089✓ F090✓ F091✓ F092✓ F093✓ F094✓ F096✓ F097✓
Imports — F099✓ F104✓
Reports & scoreboard — F105✓ F106✓
Settings — F108✓ F109✓ F110✓ F111✓ F112✓ F114✓ F115✓ F116✓ F117✓ F118✓
Audit log — F119✓
Exports & backup — F123✓
CRM pipeline core — F124✓ F129✓
Add-to-CRM & deal creation — F131✓
Moving deals — F133✓
Quick deal edits — F135✓ F136✓
CRM board & filters — F139✓
CRM stage & pipeline management — F144✓ F145✓ F146✓ F147✓ F148✓ F149✓
Deal detail screen — F150✓
CRM dashboard — F152✓
CRM export — F153✓
Shell & navigation — F157✓ F158✓
Admin: passwords & migration — F162✓ F163✓
Admin: users — F169✓ F170✓ F172✓
Admin: roles — F175✓ F176✓
Admin: teams — F177✓ F178✓ F179✓ F180✓ F181✓
Persistence — F189✓ F190✓

Representative evidence (full detail available on request, condensed here for length):
- **F014 audit()**: edited team name with a unique marker, confirmed the exact marker appeared
  in the Audit log with correct action/table/actor/timestamp.
- **F019 blockMsg()**: all 4 documented DNC/DNT/DNContact message variants matched character-
  for-character.
- **F057 reassign()**: confirmed reassigning a lead also moved its pending follow-up's assignee.
- **F094 markSent()**: confirmed it both logs a real activity on the lead's timeline AND flips
  the campaign card to "sent" with a timestamp.
- **F104 undoImport()**: ran a real CSV import, logged an activity on one created lead, undid the
  import, and confirmed the worked lead was kept while the untouched one was removed — exact
  toast text match.
- **F145/F146 stage archive/delete**: confirmed archiving an occupied stage is blocked, deleting
  one forces a destination pick, and deals actually move with a "(stage deleted)" history entry.
- **F152 CRM dashboard**: win-rate tile showed "—" for 0/0 exactly as the formula requires, and
  an agent filter demonstrably recomputed every KPI tile.
- **F163 upgradeDb()**: fed a deliberately old, field-missing DB shape through it — correctly
  backfilled roles/teams/teamHistory/member fields without throwing, and was idempotent against
  a modern DB.
- **F179 teamLogoPick()**: a real oversized (450KB) fake file was rejected with the exact
  "Logo must be under 400 KB" toast, no crash.
- **F190 resetDemo()**: confirmed it actually clears localStorage and returns to seed state,
  including signing the session out.

### PARTIAL (2 of 116) — real, reproducible discrepancies

| ID | Feature | What's actually wrong |
|---|---|---|
| **F044** | `openInCallMode(id, listId)` | The function itself is correct — proven by driving it from the one place it's actually wired up (Leads screen filtered by list), where it correctly scopes the queue to that list. But `src/views/lists.js`'s **List detail page** (`#list/:id`) row click calls plain `go('lead', id)` instead of `openInCallMode(id, listId)`. So clicking a lead from a prospecting list's own detail page does **not** scope the call queue to that list — it silently falls back to the full workspace queue. Minor, easy one-line fix (`go` → `openInCallMode`), but real. |
| **F171** | `resetPasswordDlg(id)` | Works correctly for its core job (generates and displays a one-time temporary password), but its confirmation dialog has no "Copy password" button — unlike the sibling new-user-creation dialog, which does. An admin resetting a password has to manually select/copy the text instead of clicking Copy. Minor UX inconsistency, not a functional failure. |

### BROKEN / NOT-FOUND: 0

No feature was found missing, non-functional, or throwing an error.

## Two additional findings (outside the original 116 — surfaced incidentally)

1. **Leads-table row "Archive" button has no permission gate.** While verifying F056
   (`archiveLead`), the lead-detail-page Archive button was correctly hidden for an agent without
   `archiveLeads`, but the *same* action's button on the main Leads table (per-row) is **not**
   gated in `src/views/leads.js` — confirmed live as Devin Carter (agent): 0 Archive buttons on
   his lead detail pages, but the per-row buttons were still present and clickable on the Leads
   table. This is a genuine, previously-undetected permission-enforcement gap.
2. **`docs/certification/traceability.md` has a factual error in F001's description.** It says
   "55 named permissions across 9 groups"; the actual, live-rendered `PERMISSIONS` table in
   `src/core/permissions.js` has **62 permissions across 7 groups** (Leads, Prospecting, CRM
   Pipeline, Campaigns, Team management, Competitions, Administration). Code and UI are
   internally consistent with each other — only the doc's count in that one row is wrong. (This
   was a transcription slip in the original feature inventory, not a code issue.)

## Bottom line

Of 116 features the static trace could not prove were tested, runtime verification confirms
**114 work exactly as the demo specified**, with **2 minor, real discrepancies** (one queue-
scoping edge case, one missing copy button) and **1 permission-gate gap** found along the way —
none of them data-loss or security-critical, all straightforward fixes. No feature from the
original demo is missing its rebuild, and none are non-functional.
