# Function Test Results — full detail, all 116 runtime-verified items

This is the complete, unabridged version of `docs/certification/gap-verification.md`: every one
of the 116 features that GATE G1's static trace (`traceability.md`) marked `GAP` (no automated
test proves it), with the actual verification performed and actual result observed — one row per
function/feature, nothing condensed. Verification method: live execution against a running
instance of the app (local backend, seeded demo data) via Playwright, or direct Node execution of
the real `src/` module for pure-logic functions. No `src/`/`tests/`/`supabase/` file was modified
to produce this; only this document and its companions in `docs/certification/` were added.

Columns: **ID** (matches `traceability.md`) | **Function(s) tested** | **Verdict** | **Evidence —
what was actually run and actually observed** | **Location**

---

## Permissions & roles

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F001 | `PERMISSIONS` table | WORKS* | Live count via Admin → Roles: 62 permissions across 7 groups (Leads 12, Prospecting 10, CRM Pipeline 9, Campaigns 6, Team management 6, Competitions 6, Administration 13 = 62). Role totals matched exactly (Administrator 59, ISA Manager 42, Agent 19, RE Agent 20, Viewer 10). *Doc note: traceability.md's row text says "55 permissions, 9 groups" — that count is wrong; the code/UI are correct and consistent with each other. | `src/core/permissions.js:6-76`, rendered by `src/views/admin.js ADM.roles` |
| F002 | `LEGACY_CAP` map | WORKS | Confirmed map = `{archiveLeads:"deleteLeads", manageMembers:"editUsers"}`. `can('archiveLeads')` for an agent returned identical result to `can('deleteLeads')`; `can('manageMembers')===can('editUsers')` for a manager. Both `can()` and `canUser()` consult it via `r.perms[LEGACY_CAP[cap]||cap]`. | `src/core/permissions.js:77,109,112` |
| F004 | `defaultPermissions()` | WORKS | Returns `{manager:{...}, agent:{...}}`; `manager.deleteLeads===true`, `agent.deleteLeads===false` — matches the role-derived permission sets exactly. | `src/core/permissions.js:101` |
| F006 | `canUser(m, cap)` | WORKS | `canUser(AGENT,'viewAllLeads')=false`, `canUser(AGENT,'viewOwnLeads')=true`, `canUser(MANAGER,'deleteLeads')=true`, `canUser(OWNER,'editPermissions')=true` (superAdmin bypass) — all correct against real seed roles. | `src/core/permissions.js:112` |
| F008 | `roleOf(m)` / `roleName(m)` / `isSuperAdmin(m)` | WORKS | `roleOf(OWNER).id='owner'`, `roleName(OWNER)='Owner / Super Administrator'`, `isSuperAdmin(OWNER)=true`; `roleOf(AGENT).id='agent'`, `roleName(AGENT)='Inside Sales Agent'`, `isSuperAdmin(AGENT)=false`. | `src/core/permissions.js:102-104` |

## Built-in fields

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F009 | `defaultBuiltInFields()` | WORKS | Returns exactly `first,last,phone,email,addr,city,state,zip`; `state.visible===false`; `first/last/phone` all carry `always:true`; `email` doesn't. | `src/core/fields.js:5-16` |
| F010 | `builtIn(key)` / `fieldLabel(key)` / `fieldOn(key)` | WORKS | `fieldLabel('phone')='Phone'`, `fieldOn('state')=false`, `fieldOn('phone')=true`. Unknown key `'totallyUnknownKey'` correctly falls back to `{key,label:key,visible:true,required:false}`. | `src/core/fields.js:18-20` |

## Lead statuses

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F012 | `STATUS_TONES` | WORKS | 5-tone palette confirmed both in code and live: Settings → Outcomes & statuses → "New status" color dropdown has exactly Grey/Blue/Green/Orange/Red. Screenshot captured during verification. | `src/core/statuses.js:15` |
| F013 | `statusList()` / `statusDef(key)` | WORKS | `statusList()` returns all 7 seed statuses in order; `statusDef('appointment')={label:'Appointment',tone:'green'}`; unknown key falls back to `{key,label:key,tone:''}`. | `src/core/statuses.js:16-17` |

## Session & derived helpers

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F014 | `audit(action, table, detail)` | WORKS | Edited team name with a unique marker string, saved, then opened Audit log: the exact marker appeared in a new top row `"updated \| team \| The BG Group <marker>"` with correct actor (Travon Burnette) and timestamp; row count went 5→7 across two edits. | `src/core/session.js:50-68`, table in `src/views/audit.js` |
| F018 | `outcome(id)`, `leadActs(l)`, `attempts(l)`, `lastAct(l)`, `nextFu(l)` | WORKS | Cross-checked against `seed.js`: Sharon Whitfield's 4 seeded activities → `leadActs()` returned exactly those 4; `attempts()===4`; `lastAct()` returned the correct most-recent call with matching note/outcome. `nextFu()` correctly returned the right pending follow-up for two different leads. | `src/features/activity.js:23-27` |
| F019 | `blockMsg(l)` | WORKS | All 4 documented message variants produced exact text for dncontact / dnc+dnt / dnc-only / dnt-only combinations. | `src/features/activity.js:28` |
| F020 | `badge(l)` / `dncBadges(l)` | WORKS | Logic + live: a DNC-only lead showed a single red "DNC" badge (list + detail page); a dncontact lead showed only "Do Not Contact" (not separate DNC/DNT); a DNT-only lead showed orange "DNT". | `src/features/activity.js:29-30` |
| F021 | `listNames(l)`, `leadCampaigns(l)` | WORKS | Cross-checked against seed: Angela Ruiz (`listIds:[1]`) → `['Expired – Sept']`; her campaign membership resolved to `['Expired Listings – Sept']`, matching `seed.js` exactly. | `src/features/activity.js:31-32` |
| F023 | `cardBody(c)` | WORKS | Merge-substituted text matched the live-rendered campaign card DOM verbatim for two different leads (Angela Ruiz, Marcus Bell), each with correct name/address substitution. | `src/features/activity.js:39` |
| F026 | `pace()` | WORKS | Returned `{done:8,goal:750,total:5,elapsed:3,projected:13,pct:1,expected:450}` — internally consistent (`pct=round(8/750*100)=1`, `expected=round(750*3/5)=450`). Dashboard rendered the identical numbers live, no NaN. | `src/features/stats.js:41-50` |

## Custom fields

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F028 | `CF_TYPES` | WORKS | All 7 types (text, long_text, number, money, date, yes_no, choice) present with labels+hints; Settings → Fields & columns → New field → Type dropdown lists exactly those 7. | `src/core/fields.js:23` |
| F029 | `RESERVED_KEYS` | WORKS | `RESERVED_KEYS.has('email')=true`; `keyProblem('email',taken)` → `'"email" is already a built-in merge field. Try "my_email".'` Non-reserved key returns `null`. | `src/core/fields.js:25,29` |
| F030 | `keyFromLabel(l)` | WORKS | `"Listing Price"→"listing_price"`; `"2nd Phone!!!"→"f2nd_phone"` (leading-digit guard); `"  weird__spacing  "→"weird_spacing"`. | `src/core/fields.js:28` |
| F031 | `keyProblem(key, taken)` | WORKS | Empty key → "Give the field a name."; `"1abc"`/`"ABC"` → charset message; `"email"` → reserved-field message; already-taken key → "Another field already uses that name."; novel valid key → `null`. | `src/core/fields.js` `keyProblem()` |
| F032 | `money(n)` | WORKS | `money(425000)="$425,000"`; `money(0)="$0"`; `money(1234.567)="$1,235"` (rounds, no decimals). | `src/core/fields.js` `money()` |
| F033 | `cfDisplay(f, raw)` | WORKS | All 7 types format correctly: money→"$425,000", yes_no true→"Yes", date "2026-08-30"→"Aug 30", choice/text/long_text/number all correct, empty raw→"". | `src/core/fields.js` `cfDisplay()` |
| F034 | `cfClean(f, raw)` | WORKS | Valid inputs parse per type; invalid inputs throw typed, field-label-specific errors (e.g. number "abc" → `Listing price needs a number, got "abc"`; choice value not in list → lists valid choices; text/long_text length caps enforced at 200/2000 chars). | `src/core/fields.js` `cfClean()` |
| F035 | `setCustom(lead, values)` | WORKS | Valid value set on `lead.custom`; unknown key silently skipped; invalid value returned in the `problems` array with the correct message, in the same call. | `src/core/fields.js` `setCustom()` |
| F036 | `BUILT_IN_COLUMNS` / `columnChoices()` / `resolvedColumns()` / `cardFieldsFor()` | WORKS | Settings → Fields & columns checklist showed built-ins + active custom fields; checking a custom field column and unchecking "City" + Save actually changed the Leads table's rendered header. | `src/core/fields.js`, consumed by `src/views/settings.js` |
| F037 | `fieldForm(id)` | WORKS | Created a Choice-list field with auto-generated key, 3 options, hint, both display toggles — all persisted correctly with correct badges in the list. Editing an existing field correctly locks the merge-key input. | `src/views/settings.js` `fieldForm()` |
| F038 | `fieldTypeChanged()` | WORKS | Switching type to "Choice list" revealed the Options textarea and updated the hint text; switching away hid it and reverted the hint. | `src/views/settings.js` `fieldTypeChanged()` |
| F039 | `toggleField(id)` | WORKS | Turned off a field that had a lead value set: disappeared from active use, but the underlying `lead.custom` value was preserved; turning it back on confirmed the value was untouched. | `src/views/settings.js` `toggleField()` |
| F040 | `moveField(id, dir)` | WORKS | ▲/▼ reorder buttons produced a confirmed order swap in `allFields()`, verified before/after. | `src/views/settings.js` `moveField()` |
| F041 | `deleteField(id)` | WORKS | Confirm dialog correctly named the affected lead count ("...and its value on 3 lead(s) will be removed..."); after confirming, field removed from `db.customFields` and a spot-checked lead's value was gone. | `src/views/settings.js` `deleteField()` |
| F042 | `saveColumns()` | WORKS | "Reset to default" correctly cleared `tableColumns` to `[]`, and `resolvedColumns()` fell back to `DEFAULT_COLUMNS` exactly. | `src/views/settings.js` `saveColumns()` |

## State & routing

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F044 | `openInCallMode(id, listId)` | **PARTIAL** | The function itself works correctly when actually invoked (proven from the Leads screen filtered by a list: queue bar showed "Lead 1 of 5", `state.queueList` set, Next/Previous cycled strictly within those 5 leads). **But** `src/views/lists.js`'s List detail page (`#list/:id`) row-click handler calls plain `go('lead', id)` instead of this function, so opening a lead from a prospecting list's own page does not scope the queue to that list — falls back to the unscoped workspace queue. | `src/core/router.js openInCallMode()` (correct) vs. `src/views/lists.js V.list()` row handler (never calls it) |
| F045 | `callQueue()` | WORKS | Opened a lead not in the owner's "only my leads" workspace queue via direct hash; queue bar showed the correct alphabetical, dncontact-excluded fallback sweep of all 13 visible leads — no crash, correct fallback. | `src/core/queue.js callQueue()` |
| F046 | `queueGo(dir)` | WORKS | Previous/Next wrapped correctly at both ends of a 6-lead queue; position counter updated correctly at every step. | `src/core/queue.js queueGo()` |
| F047 | `queueSkipToUnworked()` | WORKS | Jumped directly to the one 0-attempt lead in a mixed queue; after all leads were attempted, Skip produced the exact toast "Every lead in this queue has been attempted". | `src/core/queue.js queueSkipToUnworked()` |
| F049 | `clearFilters()` | WORKS | With search text + a status filter + a filter-panel value set, Clear reset every one of the 12 filter state fields in one call; header and `#q` input both returned to the unfiltered state. | `src/core/router.js clearFilters()` |

## Leads: filtering & list screen

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F053 | `filterCount()` / `toggleFilters()` / `toggleSel(id,on)` / `toggleAll(on)` / `bulkArchive()` / `redrawKeepFocus(id)` | WORKS (all 5 sub-parts) | Filter-count badge showed "2" for 2 active filters; panel toggled open/closed; select-all checkbox correctly checked all 14 visible rows; bulk Archive showed a confirm dialog and correctly archived all 14 selected leads; typing "abc" rapidly in the search box preserved focus and exact cursor position (`selectionStart:3`) through every redraw. | `src/views/leads.js` + `redrawKeepFocus` in `src/core/router.js` |

## Leads: mutations

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F056 | `archiveLead(id)` | WORKS | Confirm dialog → `l.archived=true` → navigated back to Leads list → lead row no longer present. (Secondary finding reported separately: the Leads-table's own per-row Archive button isn't permission-gated, unlike the lead-detail-page one.) | `src/features/leads.js archiveLead()` |
| F057 | `reassign(ids)` | WORKS | Reassigned a lead with a pending follow-up: both `lead.assigned` AND the follow-up's `assignee` changed to the new agent — confirmed in the lead's Follow-ups panel. | `src/features/leads.js reassign()` |
| F058 | `addToList(ids)` | WORKS | Selected lead + "Add to list" → lead's Lists column showed the new list immediately. | `src/features/leads.js addToList()` |
| F061 | `setLeadStatus(id, key)` | WORKS | Changed status dropdown on a lead detail page, badge updated immediately; reloaded the browser page and the new status persisted via localStorage. | `src/features/leads.js setLeadStatus()` |
| F062 | `addPhone(leadId)` | WORKS | Added a new 10-digit number — appeared in the phone list. Attempting to add a duplicate of an existing number on the same lead was rejected with toast "Already on this lead", dialog stayed open. | `src/features/leads.js addPhone()` |

## Call actions & activity logging

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F064 | `callBtn(l,n)` | WORKS | Normal lead: `href="tel:+1..."`, no "off" class. After setting `dnc=true`: button gained the "off" class and clicking produced toast "Calling is blocked for this lead" without navigating. | `src/features/activity.js callBtn()` |
| F065 | `textBtn(l,n,size,body)` | WORKS | Same pattern for `dnt=true` / `sms:` link / "Texting is blocked for this lead" toast. | `src/features/activity.js textBtn()` |
| F066 | `smsHref(n, body)` | WORKS | Default branch: `sms:+1...?body=...` (URL-encoded). With a spoofed iPhone user agent: `sms:+1...&body=...` — both separator branches confirmed correct. | `src/core/util.js smsHref()` |
| F067 | `addNote(leadId)` | WORKS | Typed note + Add → appeared immediately with correct author. Checked "Manager-only" → new note carried a "Manager note" badge. | `src/features/activity.js addNote()` |

## Workspace / call-mode screen

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F071 | `queue()` | WORKS | "Never attempted" mode returned exactly the leads with 0 attempts (verified by forcing one lead to 0 and confirming it alone appeared); "Follow-ups due" mode returned exactly the lead with an overdue follow-up — filtering is precise, not cosmetic. | `src/core/queue.js queue()` |
| F075 | `moreInfo(l)` | WORKS | "More information ▾" expanded a panel containing phone numbers/property details/status/follow-ups/notes/timeline sections; clicking again collapsed and removed it from the DOM. | `src/views/workspace.js moreInfo()` |
| F076 | `V.workspace` | WORKS | Full screen smoke test: header, call/text buttons, activity form all rendered; logging an attempt produced a success toast AND actually advanced the queue to the next lead (`state.queueIdx` moved, displayed lead changed). | `src/views/workspace.js V.workspace` |
| F077 | `pickNumber(id)` | WORKS | On a lead with 2 phone numbers, "2 numbers ▾" opened a "Choose a number" dialog listing both, each with its own working Call/Text buttons. | `src/views/workspace.js pickNumber()` |
| F078 | `copyText(t)` | WORKS | Clicked Copy on a campaign message bubble: toast "Copied" appeared, and `navigator.clipboard.readText()` returned text identical to the displayed message (exact string match). | `src/core/util.js copyText()` |

## Prospecting lists screens

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F080 | `V.lists` | WORKS | "Expired – Sept" card read "5 leads · 5 worked · 0 appointments" — matched an independent count of `db.leads` for that list exactly. | `src/views/lists.js V.lists` |
| F081 | `listForm(li)` | WORKS | Created a new list — appeared immediately. Renamed an existing list — the new name propagated to every lead referencing it. | `src/views/lists.js listForm()` |
| F082 | `V.list` | WORKS | List detail page showed the correct lead count, and per-member "Assigned" counts ("Travon 2 · Maria 1 · Devin 2") matched an independent tally exactly. | `src/views/lists.js V.list` |
| F083 | `assignList(listId)` | WORKS | Bulk-assigned a 4-lead list to one agent; all 4 leads' `assigned` field changed correctly (spot-checked 3, confirmed all 4). | `src/views/lists.js assignList()` |
| F085 | `archiveList(id)` / `removeFromList(leadId, listId)` | WORKS | Archiving a list removed it from the active grid. Removing a single lead from a list cleared that list reference from the lead but left the lead record intact. | `src/views/lists.js archiveList()`, `removeFromList()` |

## Campaigns screens

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F086 | `V.campaigns` | WORKS | Campaign card counts ("5 leads · 1 sent · 0 replied") matched `campaignLeads` exactly; live merge-field preview for a sample lead matched `renderTpl()` output verbatim. | `src/views/campaigns.js V.campaigns` |
| F087 | `campaignForm(c)` | WORKS | "Start from a template" auto-filled the message body with the exact template text; editing an existing campaign's message persisted correctly. | `src/views/campaigns.js campaignForm()` |
| F088 | `duplicateCampaign(id)` | WORKS | Duplicated a 5-card campaign: new campaign had the identical template body but 0 message cards — confirms leads are not copied. | `src/views/campaigns.js duplicateCampaign()` |
| F089 | `archiveCampaign(id)` | WORKS | Archived campaign disappeared from the active Campaigns list. | `src/views/campaigns.js archiveCampaign()` |
| F090 | `templatesDlg()` / `templateForm(id)` / `deleteTemplate(id)` | WORKS | Created, edited, and deleted a template in sequence — each step correctly reflected in the dialog's live list and in `db.templates`. | `src/views/campaigns.js` |
| F091 | `V.campaign` | WORKS | Status-filter tabs (All 5/Draft 3/Ready 1/Sent 1/Replied 0) each rendered the exact matching card count when clicked. | `src/views/campaigns.js V.campaign` |
| F092 | `msgCard(card, lead)` | WORKS | Card for a lead with custom fields showed correct status badge, bubble text, and a custom-field summary line matching the lead's actual data ("Listing price: $425,000 · Expired on: Aug 30"). | `src/views/campaigns.js msgCard()` |
| F093 | `editCard(id)` | WORKS | Live preview updated on every keystroke while editing; saving added a "customised" badge and the new text replaced the template. | `src/views/campaigns.js editCard()` |
| F094 | `markSent(id)` | WORKS | Marking sent logged a real new activity on the lead's timeline (count went 2→3) AND flipped the card to "sent" with a real timestamp. | `src/views/campaigns.js markSent()` |
| F096 | `removeCard(id)` | WORKS | Confirm dialog fired with correct lead name; after confirming, `campaignLeads` count dropped by 1, card gone from grid, lead record unaffected. | `src/views/campaigns.js removeCard()` |
| F097 | `addLeadsDlg(cid)` | WORKS | "From a list" mode added exactly the list's non-skip leads (4 of 5, one DNT-excluded); "Search" mode added exactly the 1 checked lead out of a larger search result set — not the whole set. | `src/views/campaigns.js addLeadsDlg()` |

## Imports

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F099 | `downloadSample()` | WORKS | Intercepted the real download: header row exactly matched current `importCfg` (10 phone slots, 1 email slot) plus active custom-field labels; 3 sample data rows present. | `src/features/imports.js downloadSample()` |
| F104 | `undoImport(id)` | WORKS | Ran a real CSV import (2 new leads), logged an activity on one, left the other untouched, clicked Undo: the worked lead was **kept**, the untouched one was **removed**, toast read "Undone · 1 worked leads kept" exactly. | `src/features/imports.js undoImport()` |

## Reports & scoreboard

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F105 | `V.reports` | WORKS | Per-caller table numbers genuinely differed across week/month/all-time ranges (not static); outcomes/by-list/by-campaign/calls-by-hour breakdowns all showed real seed-derived data. | `src/views/reports.js V.reports` |
| F106 | `V.scoreboard` | WORKS | Points-per-action legend exactly matched live Settings → Scoring values; ranked cards were strictly descending by points with correct r1/r2/r3 medal classes on the top 3; switching ranges changed the numbers; manual point recomputation for one member matched the displayed value exactly. | `src/views/scoreboard.js V.scoreboard` |

## Settings

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F108 | `SET.team` / `saveTeamName()` | WORKS | Changed team name + agent name, saved, reloaded — both persisted; a campaign preview immediately reflected the new `{{team_name}}`/`{{agent_name}}` values. | `src/views/settings.js` |
| F109 | `SET.fields` (built-in fields table) | WORKS | Renamed ZIP→"Postal Code", hid Email, made ZIP required, saved: the lead-create dialog then showed the new label with a required asterisk, no Email field, and blocked submission when ZIP was blank. | `src/views/settings.js` |
| F110 | `SET.import` | WORKS | Changed phone-slot count 10→3: the import column-mapping step then offered exactly 3 phone columns. Toggling off the "same phone number" dup-check changed actual dup-detection results on a real test row. | `src/views/settings.js` |
| F111 | `SET.outcomes` (read side) | WORKS | Outcome badges matched their actual flags exactly; all 7 status lead-counts matched an independent `db.leads` count per status exactly. | `src/views/settings.js` |
| F112 | `SET.scoring` | WORKS | A real member's points, computed manually from the current scoring settings and their actual stats, matched `stats().points` exactly. As a non-manager, the tab correctly showed read-only text instead of editable inputs. | `src/views/settings.js` |
| F114 | `SET.about` | WORKS | Compliance notice rendered fully with zero inputs/Save button — unconditionally, no permission gate needed since there's nothing to protect. | `src/views/settings.js` |
| F115 | `saveTeamName()` / `saveBuiltInFields()` / `saveImportCfg()` / `saveSettings()` | WORKS | Triggering all 4 savers produced 4 new, correctly-worded audit log entries, confirmed visible on the Audit log screen. | `src/views/settings.js` |
| F116 | `statusForm(key)` / `moveStatus(key,dir)` / `deleteStatus(key)` | WORKS | Created, renamed, recolored, reordered (▲▼, confirmed real order change), then deleted a custom status with 2 leads on it — dialog correctly warned about the 2 leads, and after deleting both leads' status became "New". The locked "New" status has no delete button. | `src/views/settings.js` |
| F117 | `outcomeForm(id)` | WORKS | New outcome with conversation+appointment flags appeared as a real button in the lead activity-log outcome picker. Toggling "Disabled" removed it from that picker while keeping it visible (struck through) in Settings. | `src/views/settings.js` |
| F118 | `SET.pipelines` (settings-tab view) | WORKS | Settings-tab stage table (name/probability/kind/lead-count) matched the live CRM board exactly for all 14 stages of the Seller Leads pipeline. | `src/views/settings.js` |

## Audit log

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F119 | `V.audit` | WORKS | Table-filter dropdown correctly narrowed the log to only matching rows and restored the full list on "All tables". Without `viewAudit`, the screen correctly showed only "The audit log is turned off for your role." | `src/views/audit.js V.audit` |

## Exports & backup

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F123 | Restore file-input handler | WORKS | Downloaded a real backup JSON, archived a lead, restored the backup — the archived lead's flag correctly reverted and a "Backup restored" toast appeared. Both a garbage-JSON file and a well-formed-but-wrong-shape JSON were correctly rejected with "That isn't a valid backup file," no crash either time. | `src/data/persist.js` (note: button lives in `src/views/settings.js`, but the actual restore logic is in `persist.js`) |

## CRM pipeline core

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F124 | `defaultStages()` / `newPipeline()` | WORKS | Produced exactly the 14 documented stages (names/probabilities/colors) both via direct call and via creating a real new pipeline in the live UI (14 columns rendered on the board). | `src/features/crm.js` |
| F129 | `dealLog(d, type, detail)` | WORKS | Moving a deal between stages produced a correctly worded, correctly timestamped, correctly attributed new entry at the top of the deal's Activity timeline. | `src/features/crm.js dealLog()` |

## Add-to-CRM & deal creation

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F131 | `stageOptsFor(pipeId, sel)` / `addToCrmBtn(leadId, size)` | WORKS | Button correctly read "◫ Add to CRM" before, "◫ In CRM" after. Clicking "In CRM" while the lead was in only 1 of 2 pipelines correctly reopened the Add dialog (by design, to allow adding to the second pipeline); once in every pipeline, it correctly navigated to the existing deal. | `src/features/crm.js` |

## Moving deals

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F133 | `moveStageDlg(dealId)` | WORKS | Stage (and, with 2+ pipelines, cross-pipeline) move worked correctly; attempting to move into a pipeline the lead's deal was already in was correctly blocked with "Already in that pipeline." | `src/features/crm.js moveStageDlg()` |

## Quick deal edits

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F135 | `dealNoteDlg(dealId)` | WORKS | A note added via the deal card appeared both on the lead's own Notes and in the deal's Activity timeline. | `src/features/crm.js dealNoteDlg()` |
| F136 | `dealFuDlg(dealId)` | WORKS | Scheduling a follow-up updated the card, appeared correctly on the Follow-Ups screen, and scheduling a second one correctly cancelled the first with reason "Replaced from the CRM." | `src/features/crm.js dealFuDlg()` |

## CRM board & filters

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F139 | `crmFilterCount()` / `crmFiltersDlg()` / `crmDefaultFilters()` | WORKS | Applying 3 filters simultaneously (temperature/price/overdue-only) correctly showed a "3" badge and correctly reduced the board to 0 matching deals (proving real, combined filtering); "Clear all" correctly restored all 5. | `src/features/crm.js` |

## CRM stage & pipeline management

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F144 | `stageMenu(stageId)` | WORKS | Renamed, reprobabilitized, re-kinded, and recolored a stage — all 4 changes correctly reflected on the board's column header after save. | `src/features/crm.js stageMenu()` |
| F145 | `moveStage()` / `archiveStage()` / `restoreStage()` | WORKS | Move-left correctly reordered the column; archiving an occupied stage was correctly blocked ("Move the leads out first..."); archiving an empty stage correctly removed the column; restoring it from Settings brought it back. | `src/features/crm.js` |
| F146 | `deleteStage(stageId)` | WORKS | Deleting an occupied stage forced a destination pick; after confirming, the deal's `stageId` correctly moved to the destination and its history logged "...(stage deleted)." | `src/features/crm.js deleteStage()` |
| F147 | `addStageDlg(pipeId)` | WORKS | New custom stage correctly appeared as a new column with the entered name/probability. | `src/features/crm.js addStageDlg()` |
| F148 | `pipelineDlg(pipeId)` | WORKS | New pipeline with a chosen lead-type appeared in the pipeline switcher with the correct 14 default stages. | `src/features/crm.js pipelineDlg()` |
| F149 | `archivePipeline(pipeId)` | WORKS | Archiving a 5-deal pipeline correctly warned about the 5 deals, removed it from the switcher, and left it restorable from Settings. | `src/features/crm.js archivePipeline()` |

## Deal detail screen

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F150 | `dealTimeline(d)` | WORKS | Merged activities, notes, follow-ups, and stage-history into one feed of 11 items, correctly sorted newest-first, with correct distinct icons per entry type — count matched an independently computed array exactly. | `src/views/deal.js dealTimeline()` |

## CRM dashboard

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F152 | `V.crmdash` | WORKS | All KPI tiles showed non-NaN, internally consistent numbers (win-rate correctly showed "—" for a 0/0 case); the agent filter demonstrably recomputed every tile when applied (active count dropped 5→1 when filtered to one agent). | `src/views/crmdash.js V.crmdash` |

## CRM export

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F153 | `crmExportDlg()` | WORKS | Tested "entire pipeline" and "commission forecast by stage" export scopes via real intercepted downloads: headers matched the documented column sets exactly, row counts matched on-screen data, sample row values were correct. | `src/features/crm.js crmExportDlg()` |

## Shell & navigation

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F157 | `toggleTheme()` | WORKS | Clicking Theme flipped `data-theme` and the actual rendered background color light↔dark; second click reverted it. | `src/views/shell.js toggleTheme()` |
| F158 | `callBarMobile(d)` | WORKS | At mobile viewport width, the fixed call bar was absent on non-lead screens and present (with working Call/Text/Log/Prev/Next controls) only on a lead detail screen. | `src/views/shell.js callBarMobile()` |

## Admin: passwords & data migration

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F162 | `initials(name)` / `teamsOf(id)` | WORKS | `initials("Travon Burnette")="TB"`, correct for single names and empty input too; live Admin → Users avatars matched the real members' initials exactly. | `src/core/session.js` |
| F163 | `upgradeDb(d)` | WORKS | Fed a deliberately old, field-missing DB shape through it: correctly backfilled roles, a default team, teamHistory, and per-member fields without throwing, including correctly remapping a legacy permission via `LEGACY_CAP`. Feeding it the current seed DB was a no-op (idempotent). | `src/data/upgrade.js` |

## Admin: users

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F169 | `setUserTeams(userId, teamIds)` | WORKS | Moving a user between teams via the edit-user dialog correctly updated both teams' member lists immediately and recorded a `teamHistory` join entry. | `src/features/admin.js` |
| F170 | `deactivate(m)` / `toggleMember(id)` | WORKS | Deactivating a user correctly dropped the active count and removed their demo-login button; self-deactivation and last-super-admin-deactivation were both correctly blocked with the exact documented toast text. | `src/features/admin.js` |
| F171 | `resetPasswordDlg(id)` | **PARTIAL** | Correctly generates and displays a one-time temporary password with a working "Done" close. But unlike the sibling new-user-creation dialog, this confirmation dialog has **no "Copy password" button** — an admin has to manually select/copy the text. | `src/features/admin.js` (missing the copy-button pattern its own new-user dialog uses) |
| F172 | `userActivity(id)` | WORKS | Activity dialog showed a real activity feed and team history for a user, cross-checked against `db.activities` filtered by that user's id — matched. | `src/features/admin.js` |

## Admin: roles & permissions

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F175 | `roleDlg(id)` | WORKS | "Start from" correctly cloned a base role's exact permission set into the new role; renaming an existing role updated the role list immediately. | `src/views/admin.js` |
| F176 | `deleteRole(id)` | WORKS | Deleting a role with an assigned user was correctly blocked, naming the user count; deleting an unassigned custom role succeeded after confirmation. | `src/views/admin.js` |

## Admin: teams

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F177 | `ADM.teams` | WORKS | Team card mini-stats (calls/conv/appts this week) matched an independent sum of the same members' `stats()` output exactly. | `src/views/admin.js` |
| F178 | `teamDlg(id)` | WORKS | Created a team, set a manager without separately checking them as a member — save correctly auto-added the manager to the member list. | `src/features/admin.js` |
| F179 | `teamLogoPick(input)` | WORKS | A valid small image uploaded and previewed correctly; a 450KB oversized fake file was correctly rejected with "Logo must be under 400 KB," no crash, prior state untouched. | `src/features/admin.js` |
| F180 | `archiveTeam(id)` / `restoreTeam(id)` | WORKS | Archiving moved a team from the Active tab to Archived; restoring moved it back — both confirmed by tab counts. | `src/features/admin.js` |
| F181 | `teamPerf(id)` | WORKS | Performance dialog's team-total row was verified to be the exact arithmetic sum of its member rows. | `src/features/admin.js` |

## Persistence

| ID | Function(s) | Verdict | Evidence | Location |
|---|---|---|---|---|
| F189 | `loadSaved()` / `persist()` | WORKS | A change survived a same-page browser reload (real localStorage roundtrip). Three different corrupted/garbage localStorage values all caused `loadSaved()` to return `null` gracefully rather than throw. | `src/data/persist.js` |
| F190 | `resetDemo()` | WORKS | Confirmed, then accepting actually cleared localStorage, reloaded, and returned to original seed state (a prior change was gone, session was signed out). | `src/data/persist.js` |

---

## Tally

- **116 functions/features tested, all by actual execution.**
- **114 WORKS** exactly as the demo specified.
- **2 PARTIAL**: F044 (`openInCallMode` not wired from the List detail page), F171 (`resetPasswordDlg` missing a copy button).
- **0 BROKEN, 0 NOT-FOUND.**

Two more issues were found incidentally while testing (not part of the original 116, reported in
full in `gap-verification.md`): the Leads-table's per-row Archive button has no `archiveLeads`
permission gate, and `traceability.md`'s F001 row understates the permission count (55/9 stated
vs. 62/7 actual).
