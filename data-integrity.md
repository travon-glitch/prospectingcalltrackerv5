# GATE G6 — Data Integrity Certification

**Scope:** the seven G6 items, executed as real automated tests against the actual application code (no re-implemented copies). All test code lives in `tests/certification/` — nothing under `src/**` or `supabase/**` was modified. Where a test exposed a real defect, the assertion was kept strict and the test left red with a `[FAIL — real defect: …]` name, following the repo convention.

**Authoritative final run** (`npx vitest run tests/certification`):

```
 Test Files  1 failed | 6 passed (7)
      Tests  1 failed | 122 passed (123)
   Duration  42.03s
```

The single failure is deliberate — it pins defect **DI-1** (tab-escaping, item 4 below). Everything else passes.

| # | Gate item | Verdict |
|---|---|---|
| 1 | Generate messy test data (10k leads / 50k activities / 20 users / 4 teams) | **PASS** |
| 2 | Import 5 overlapping CSVs — dedupe, merge, counts, undo | **PASS** |
| 3 | Network death mid-import / mid-activity-save / mid-status-change | **PASS (client)** / **2 server-side findings (DI-2, DI-3)** |
| 4 | Export every dataset, re-import where possible, diff | **PASS with 1 real defect (DI-1) and documented structural limits** |
| 5 | Backup → restore into empty staging, counts + checksums | **PASS** (+ documented product limitation DI-4) |
| 6 | Time zones: 11:30pm Eastern follow-up + DST | **PASS** |
| 7 | Money: 20 hand-calculated deals to the cent | **PASS** (max deviation 4.7×10⁻¹⁰ dollars) |

**Defect register (all pinned by tests, none fixed under this gate):**
- **DI-1 (real defect, red test):** `csvCell()` (src/features/exports.js:26) quote-wraps `",\n\r` but **not TAB**, while the app's own `parseCsv()` (src/features/imports.js:34) splits unquoted tabs into columns — any exported value containing a tab shifts every following column on re-import. Fix: add `\t` to csvCell's quote-wrap class.
- **DI-2 (server-side, static test):** `import-run` edge function's commit is **not atomic** — a sequence of separate PostgREST writes with no transaction; the five side-table inserts (lead_phones, lead_lists, lead_custom_values, notes, import_leads; index.ts L338–342) never check their errors, so partial failure is silently swallowed and the commit still reports success.
- **DI-3 (server-side, static test):** a mid-commit death leaves the import job stuck at `status:"running"` forever; undo requires `status === "completed"`, so a **half-import cannot be undone through the app**, and leads cut off between the `leads` insert and the `import_leads` insert are orphaned from undo permanently.
- **DI-4 (documented product limitation, pinned):** on the Supabase backend, backup is **export-only** — there is deliberately no in-app restore (persist.js:25-35 and org-backup/index.ts:14-23 both state this). The only restore path is an out-of-band database-level restore, which item 5 certifies at the Postgres level.

---

## Item 1 — Test data generation: PASS

**Test file:** `tests/certification/generate-dataset.ts` (deterministic, seeded mulberry32, SEED=42; standalone-runnable and importable; determinism asserted by byte-comparing two runs).

Produces `tests/certification/.data/`:
- **dataset.json** — 20 users (ids 101–120), 4 teams (ids 201–204, membership covers all 20 users), 10,000 leads, 50,000 activities referencing those leads/users.
- **leads-1.csv … leads-5.csv** — the 10,000 leads with engineered overlap (item 2's arithmetic below).

Required mess, all present and byte-exact-asserted after import:
- Duplicate phones across rows, and the **same number in 5 formats** — `(404) 555-0170`, `404-555-0170`, `+14045550170`, `404.555.0170`, bare digits — all collapsing via `normPhone()`.
- 2,020/10,000 leads (~20.2%) with **missing emails**.
- **Unicode names** (`Zoë Åström`, `李雷`, `José Muñoz-Ferreira`, `Ólafur Þórðarson`) and an emoji note.
- **Very long text**: a 5,000-char note and a 500-char street address.
- 25 fully **blank rows** (asserted dropped by `parseCsv()`: raw-line vs parsed-row counts, 2036→2030 and 2286→2280 per file).
- 10 name-only and 10 phone-only rows; a leading-`=` note cell stored as plain data.

---

## Item 2 — 5 overlapping CSV imports: PASS (18/18 tests)

**Test file:** `tests/certification/import-integrity.test.js` — drives the **real** pipeline end to end: real jsdom `File` → `handleFile()` → `importCheck()` → per-dup actions → `importRun()` → `undoImport()` confirmed through the real dialog (#cYes click). Three consecutive runs identical.

**Overlap design & exact expected numbers (all asserted):** file 1 = 2,000 fresh leads; files 2–5 = 2,000 fresh + 250 re-presented rows from the previous file (same phone in a different format, new 2nd phone, changed last name, fill-in email, **conflicting** addr/city/zip) + 30 within-file exact phone duplicates. Dup actions per file 2–5: 100 merge, 10 forced import, 140 skip.

| File | ready/dups/bad | job.imported | leads created | running total |
|---|---|---|---|---|
| leads-1 | 2000 / 0 / 30 | 2000 | 2000 | 2,000 |
| leads-2…5 (each) | 2000 / 250 / 30 | 2110 | 2010 | 4,010 / 6,020 / 8,030 / **10,040** |

- **No duplicates beyond the demo's dedupe rule:** final count exactly **10,040 = 10,000 unique + 40 deliberately forced** (`action:"import"`). Directly asserted: no two non-archived leads share a normalized phone except exactly those 40 pairs. Dedupe rule verified **byte-equivalent to the demo** (demo ref lines 1093, 1095–1101 ≡ imports.js:116–125): within-file key = first phone, else email, else addr+zip; against-db match on any phone / case-insensitive email / addr+ZIP of any non-archived lead.
- **Merge rule — demo-parity pinned precisely** (demo ref line 1107 ≡ imports.js:152). The demo's rule is **fill-blanks-only: the existing non-empty value always wins**; the incoming row's data lands only in previously-empty fields; phones are unioned without duplicates; names are never touched; assignee set only if unassigned. The gate's phrase "merges keep the newest non-empty fields" is certified as this rule — verified by 400 per-merge assertions plus 5 byte-exact deep-equal lead objects (the conflicting "Should Not Overwrite St"/"00000" values were discarded; incoming email/city stored only where the field was empty).
- **Counts match:** per-file ready/dups/bad, job.imported, job.rows, created-lead deltas and running totals all match the generator's arithmetic exactly (table above); `truncated === false` every file (importCfg `maxRows: 50000`, defaults untouched).
- **Undo removes exactly the imported leads (and only them):** undoing import #5 removed **2,007** of its 2,010 created leads plus their notes/followUps/campaignLeads; kept exactly the **3** leads given activities beforehand (toast: "Undone · 3 worked leads kept"); all **8,030** leads from imports 1–4 untouched (count + id spot-checks); merge-target leads not removed, and merges **not reverted** — demo-parity behavior (demo ref line 1108 ≡ imports.js:156–166: undo removes only `job.leadIds`; merged leads were never in that list).

**Performance evidence:** the 5 imports (O(n²) dup check against a growing 10k-lead db) totaled **~3.9–4.4s** (file 1 ~50ms → file 5 ~1.5s, linear growth per file as expected).

---

## Item 3 — Network killed mid-operation: client PASS (14/14), two server-side findings

**Test file:** `tests/certification/network-failure.test.js`. The Supabase branches were genuinely exercised (`BACKEND === 'supabase'` via `vi.stubEnv('VITE_BACKEND','supabase')` before dynamic import; every fake repo method asserted called exactly once) with the repo layer rejecting `Error('Failed to fetch')` — what fetch throws on a dropped connection. "Clear user message" asserted via the real `toast()` → `#toast.textContent`.

**Client-side: no half-saved records in any scenario — PASS.**

| Scenario | What the code does on failure | Half-saved state? | User message |
|---|---|---|---|
| Mid-import, check phase (imports.js:100–106) | returns to "map" step, file/mapping retained for retry | None — full db snapshot byte-identical | "Failed to fetch" |
| Mid-import, commit (imports.js:134–147) | nothing is mutated before the await (payload assembly only); wizard state kept for retry; no local list/job/lead appears | None — snapshot identical | "Failed to fetch" |
| Mid-activity-save (activity.js:146–176) | write-then-mirror: **zero** local mutation before the await; follow-up side effect does not half-apply; form state retained (user can press Save again) | None — no activity row, no follow-up, lead status/dnc unchanged | "Failed to fetch" |
| Mid-status-change (leads.js:209–218) | **not optimistic** — `l.status` set only in `.then()` | None — status unchanged | "Failed to fetch" |
| Bonus: mid-DNC-toggle (leads.js:86–119) | same write-then-mirror shape | None | "Failed to fetch" |

**Server-side atomicity (static verification, pinned by source-assertion tests in the same file):**
- **Activity save: ATOMIC.** The `log-activity` edge function makes exactly one DB write call — `admin.rpc("log_activity")` — and `log_activity()` (0017_log_activity.sql) is a single plpgsql function containing the activity insert, status transitions, follow-up replace, DNC cancellation and audit row: one function call = one transaction = all-or-nothing.
- **Status change: ATOMIC.** A single `UPDATE leads` statement (repo-supabase.js:671–674); the DNC patch likewise travels as one UPDATE. Residual observation: on `dncontact`, the follow-up cancellations are separate client calls with `.catch(()=>{})` — a death after the lead UPDATE can leave pending follow-ups uncancelled server-side.
- **Import commit: NOT ATOMIC — findings DI-2 and DI-3** (see register above). Write order: list insert → **job row first** (`status:"running"`) → per-500 batches of leads → lead_phones/lead_lists/lead_custom_values/notes/import_leads (these five **unchecked for errors**) → merge loop → job finalize **last**. A cut mid-sequence leaves half-saved leads server-side; the stuck "running" job makes the half-import *visible* but **not undoable** through the app (undo requires `completed`), and leads cut off before their `import_leads` row are permanently orphaned from undo.

---

## Item 4 — Export every dataset, re-import where possible, diff: PASS with 1 real defect

**Test file:** `tests/certification/export-roundtrip.test.js` (18 green + 1 deliberate red = DI-1). Run against the full imported dataset (10,040 leads) plus all 50,000 activities, as an owner with filters cleared and `state.range` pinned to all-time (the default range is "week" — it would have truncated the activities export; pinned and documented).

**Every dataset exported and encoding-round-tripped (encode → the app's own `parseCsv()` → field-by-field diff):**

| Dataset | Rows (= expected) | Field diff | Notes |
|---|---|---|---|
| leads | 10,040 | full 10,040 × 24 cells, **0 mismatches** | |
| assignments | 10,040 | full, 0 | |
| activities | **50,000** | **full 50,000 × 11 cells, 0 mismatches** | export took 631ms |
| outcomes | 8 | full, 0 | "Times used" sums to exactly 50,000 |
| notes | 223 | full, 0 | incl. 5,000-char + emoji + multiline/quoted cells |
| follow_ups | 250 | full, 0 | |
| campaigns | 3 | full, 0 | status counts over 300 campaign rows exact; bodies byte-exact |
| team_performance / scoreboard | 23 | full, 0 | stats independently recomputed over all 50k activities; the two datasets byte-identical |

All exports: BOM present, `\r\n` line endings, headers byte-equal to source. Byte-exact spot proofs on Zoë/李雷, the 5,000-char note, the 500-char address, embedded quotes/commas/newlines.

**Documented round-trip exceptions (deliberate, not defects):**
- The G3 **formula guard**: `csvCell()` prefixes `'` to values starting `=+-@\t\r` — so every phone exports as `'+1404…` and the `=SUM(…)` note as `'=SUM(…)`. Parse-back is `'`+original (asserted precisely). Phones still re-import byte-stable because `normPhone()` discards the apostrophe.
- **BOM on re-import**: `parseCsv()` itself does not strip it (proven), but `File.text()`'s UTF-8 decode, `handleFile`'s `.trim()`, and `guess()`'s character-strip each independently neutralize it — the real wizard maps all columns correctly. Not a finding.

**Re-import (leads is the only dataset the product can import — the rest are certified export-only but value-proven at the CSV-encoding level):**
- **Into the same org:** exact split **ready = 10, dups = 9,990 (all on "phone"), bad = 40** — the 10 ready rows are the name-only leads (nothing to match on; they would create duplicates if run — a known matching-rule limit, not a code defect); the 40 bad are the second in-file occurrences of the forced-duplicate phones.
- **Into an empty org:** 10,000 of 10,040 recreated (each forced-dup pair correctly collapses to one). **Full 10,000-lead field diff, 0 mismatches** on the surviving fields: first, last, email, addr (incl. 500-char), city (incl. merge-filled values), zip, and **both phone numbers** (merged 2nd phones included).
- **Structurally export-only fields** (headers exist, `guess()` maps them to Skip — the honest "where possible" boundary): Lists, Campaigns, Assigned to, Status, Attempts, Last attempt, Last outcome, Next follow-up, DNC/DNT/DNContact flags, Added; the 2nd phone's *type label* also doesn't survive (numbers do). Contact-identity data round-trips exactly; workflow state is export-only by design.

**Real defect DI-1 (red test):** tab-in-value breaks the app's own export→import contract — see register. Evidence: re-parsed row has 6 cells vs the header's 5 (`expected 6 to be 5`).

---

## Item 5 — Backup → restore into empty staging: PASS (17/17)

**Test files:** `tests/certification/backup-restore-local.test.js` (app level + the product-gap pin) and `backup-restore-staging.test.js` (database level, against real local Postgres 16.13).

**Product fact verified first (DI-4):** the Supabase backend's backup (`org-backup` edge function) is **export-only** — its own header says "there is deliberately no 'restore' action in this function", and persist.js's restore handler toasts "Restoring a backup isn't available on this backend — export only." Pinned statically so the posture can't silently change. The in-app restore exists only on the local backend; the DB-level restore below is the Supabase-grade path.

**App-level JSON round trip (local backend, real `backup()` → real `#restoreIn` change handler, 7/7):** seeded with unicode leads (Žofia 😀, 李小龍, عَرَبِيّ, O'Brien-Ωmega), a ~3.4k-char multi-script note, custom fields, deals, follow-ups; db then heavily mutated (half the leads deleted, tables emptied, settings changed) before restoring, so a no-op could not pass. **All 21 db tables restored byte-exactly** (per-table JSON + sha256 checksums, pre = post, e.g. leads `b175b8f4…` match). Corrupt file and valid-JSON-but-not-a-backup both rejected with "That isn't a valid backup file" and **db unchanged** (checksums identical).

**Database-level backup → empty staging (10/10):**
- `cert_g6_prod` created, all 19 migrations applied (with the same `auth.uid()` shim the G3 suite uses), seeded at the gate's scale: 1 org, 20 members, 4 teams, **10,000 leads** (unicode, NULLs, 5.4k-char addresses), 10,000 lead_phones, **50,000 activities**, plus rows in every other table (33 public tables total, discovered dynamically, all asserted non-empty) — including a >5,000-char emoji note and jsonb with embedded quotes.
- Backup: `pg_dump -Fc --no-owner cert_g6_prod`. Restore: fresh **empty** `cert_g6_staging` (no migrations) + `pg_restore`.
- **All 33 tables match on both row count and order-independent content checksum** (`md5(string_agg(md5(row::text)… order by …))`, computed identically on both sides): activities 50,000 = 50,000, checksum match; leads 10,000 = 10,000, match; every other table match.
- **Sequences survived:** post-restore inserts got id 10,001 (> max 10,000) and > 50,000 respectively — no PK collisions. Staging also has the identical table set, the same `pg_policies` count (RLS traveled with the dump), and the shim function.
- Wall time: seed+migrate 7.9s, dump 0.3s, restore 1.3s, compare 0.4s. Both throwaway DBs dropped afterward; pre-existing databases untouched.

---

## Item 6 — Time zones: PASS (24/24)

**Test files:** `tests/certification/timezone.test.ts` + `tz-probe.ts` (cross-zone cases shell out to a probe run under `TZ=` set before node starts, with a fixed mocked "now", importing the **real** `src/core/util.js`).

**Why it's zone-safe (the verified model):** a follow-up's `due` is a plain calendar string end to end — stored verbatim from `<input type="date">` (activity.js:79, crm.js:237), a Postgres `date` column (0010:44; `log_activity()` takes `p_fu_date date` and inserts it verbatim), string-passthrough in repo mapping (repo-supabase.js:1046), compared lexicographically against the viewer-local `TODAY`, and rendered via `fmtD()` which appends `"T00:00"` (local-midnight parse — never the classic `new Date("YYYY-MM-DD")` UTC-midnight bug). **Every `new Date(dateOnlyString)` site in src/ was audited: all guarded or benign; the bug pattern appears nowhere.** Activity timestamps are the complementary correct pattern: UTC instants (`toISOString`) rendered viewer-locally (`toLocaleString`).

**The gate scenario — follow-up created at 11:30pm Eastern (2026-10-01T23:30−04:00), due "2026-10-02":**

| Viewer zone | TODAY there | Due date shown | Instant of the save shown |
|---|---|---|---|
| America/New_York | 2026-10-01 | **Oct 2** | Oct 1, 11:30 PM |
| America/Los_Angeles | 2026-10-01 | **Oct 2** | Oct 1, 8:30 PM |
| Asia/Tokyo | 2026-10-02 | **Oct 2** | Oct 2, 12:30 PM |
| Pacific/Kiritimati (UTC+14) | 2026-10-02 | **Oct 2** | Oct 2, 5:30 PM |

The rendered due day is **identical in all four zones** — no ±1 shift. The control test proved the platform *would* shift the day under the buggy parse (`isoDate(new Date('2026-10-02'))` = 2026-10-01 in NY/LA), and the app's path doesn't.

**DST (America/New_York, both 2026 transitions):** spring-forward (Mar 8, 2→3am): TODAY is `2026-03-08` at both 01:59 EST and 03:01 EDT — no day skip; a due-Mar-8 follow-up stays "today" through the transition; `daysAgo(1)`/`addDays()` step cleanly over the missing hour. Fall-back (Nov 1): through **both** passes of the ambiguous 01:30 hour, TODAY stably `2026-11-01`, no double-count or day shift across the 25-hour day. All PASS.

**Documented semantics (inherited design, consistent, not defects):** urgency classification (overdue/today) is per-viewer-local-calendar — at the same instant a Tokyo viewer sees a due-10-01 follow-up as overdue while the ET creator still sees "today"; certified as consistent and monotonic (the rendered day never changes; urgency never decreases moving east). Server-side overdue *filters* use the database's `current_date` (UTC on hosted Supabase) while the client badges against viewer-local TODAY — a near-midnight filter-vs-badge disagreement is possible by design, with no rendering shift. Also noted: `TODAY` is computed at module load, so a tab left open past midnight goes stale until reload (SPA tradeoff, not a zone bug).

---

## Item 7 — Money: PASS (31/31) — matches to the cent, max deviation 4.7×10⁻¹⁰ dollars

**Test files:** `tests/certification/money-math.test.js` + `money-oracle.py` (the hand calculations are **independent of the JS under test**: computed with Python `decimal` at 50-digit precision and pasted as a literal fixture).

- **Demo parity:** `num()`/`pct()`/`dealMath()`/`money()` byte-identical to the demo (ref lines 1480–1481, 1487–1499, 502), verified by diff.
- **20 stress deals** covering: round numbers; cents-precision prices; float-trap chains; zero/empty/null fields; both clamp cases (fee > afterRef; closing > afterBrok); team split 0/50/100; probability 0/35/100; formatted strings (`"$425,000"`, `"3%"` — parse correctly); negative price (flows to negative gross, net clamps at 0); $99,999,999.99.
- **All 7 money outputs per deal** (gross, referral, brokerage, net, teamShare, agentShare, weighted) asserted against the decimal oracle at |Δ| < $0.005, plus the invariant `teamShare + agentShare ≡ net`. **Every one of the 140 values matched.** Worst case: D18 (the 8-digit price) at Δ = 4.66×10⁻¹⁰ dollars ≈ 0.00000005 cents — seven orders of magnitude inside the half-cent tolerance. Most deals: Δ = 0 exactly.
- **SQL recomputation agrees:** both `search_deals` (0018:110–153) and the stats forecast CTE (0019) implement the identical chain with identical clamps in exact `numeric`; the client never displays SQL-computed money (it recomputes via `dealMath()`), and JS↔SQL parity is independently executed against real Postgres by the pre-existing `tests/unit/dealmath-parity.test.js` (14/14 green in this run).
- **Certified (demo-identical) behaviors worth knowing:** `num("3,0")` parses as **30**, not 3.0 (European decimal-comma hazard — a "3,0" commission is 10× what the user meant); `money()` displays whole dollars only (cents live in the math and in CSV exports), rounding half-away-from-zero; on the Supabase backend, `numeric(5,2)` columns round percentages to 2dp at storage.

---

## Change footprint for this gate

```
tests/certification/            (new: 7 test files + generator + oracle + probe)
docs/certification/data-integrity.md   (this report)
vitest.config.js                (test-infra only: added tests/certification/** to include + timeouts)
```

No file under `src/**` or `supabase/**` was modified. The four register items (DI-1…DI-4) are reported, pinned by tests, and await your decision; nothing was fixed under this gate.
