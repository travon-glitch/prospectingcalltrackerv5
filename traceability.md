# Feature Traceability Matrix — GATE G1

This document traces every feature catalogued from the original single-file demo HTML (the
spec) to its implementation in this rebuild's `src/` tree and to the automated test(s) that
exercise it, if any. It was produced by static inspection (`grep`/`read`) of `src/`,
`tests/unit/*.test.js` and `tests/e2e/*.spec.js`, not by executing the suite. **A `GAP` status
does not mean the feature is broken** — it means no automated test currently proves the
behavior works; the code may well be correct and simply unexercised by the current suite.
`COVERED` means both an implementation was found and at least one test asserts on, drives, or
would fail if that specific behavior broke.

## Permissions & roles

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F001 | PERMISSIONS table (55 named permissions, 9 groups) | src/core/permissions.js `PERMISSIONS` | NONE | GAP |
| F002 | LEGACY_CAP map | src/core/permissions.js `LEGACY_CAP` | NONE | GAP |
| F003 | defaultRoles() — 6 built-in roles w/ base permission sets | src/core/permissions.js `defaultRoles()`, `AGENT_BASE`/`MANAGER_BASE`/`ADMIN_BASE` | tests/unit/stats.test.js (OWNER has viewTeamReports, AGENT doesn't); tests/e2e/admin.spec.js (role list rendering/selection) | COVERED |
| F004 | defaultPermissions() back-compat shim | src/core/permissions.js `defaultPermissions()` | NONE | GAP |
| F005 | can(cap) — core permission check, superAdmin bypass | src/core/permissions.js `can()` | tests/unit/crm-board-money-permission.test.js, tests/unit/deal-money-permission.test.js, tests/unit/stats.test.js | COVERED |
| F006 | canUser(m, cap) | src/core/permissions.js `canUser()` | NONE | GAP |
| F007 | sameTeam(userId) | src/core/permissions.js `sameTeam()` | tests/unit/visible-leads.test.js "a viewTeamLeads (not viewAllLeads) manager sees a teammate's own lead" | COVERED |
| F008 | roleOf(m) / roleName(m) / isSuperAdmin(m) | src/core/permissions.js `roleOf()`, `roleName()`, `isSuperAdmin()` | NONE | GAP |

## Built-in fields

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F009 | defaultBuiltInFields() — first/last/phone/email/addr/city/state(hidden)/zip | src/core/fields.js `defaultBuiltInFields()` | NONE | GAP |
| F010 | builtIn(key)/fieldLabel(key)/fieldOn(key) accessors | src/core/fields.js `builtIn()`, `fieldLabel()`, `fieldOn()` | NONE (create-lead e2e exercises the static default field set, not the on/off gating behavior itself) | GAP |

## Lead statuses

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F011 | defaultStatuses() — new/attempted/contacted/appointment/do_not_call/do_not_contact (locked) + closed | src/core/statuses.js `defaultStatuses()` | tests/unit/activity.test.js (status-transition table depends on this exact status set) | COVERED |
| F012 | STATUS_TONES palette | src/core/statuses.js `STATUS_TONES` | NONE | GAP |
| F013 | statusList()/statusDef(key) | src/core/statuses.js `statusList()`, `statusDef()` | NONE | GAP |

## Session & derived helpers

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F014 | audit(action, table, detail) | src/core/session.js `audit()` | NONE (invoked as a side effect throughout the suite, but no test asserts on `db.audit` content) | GAP |
| F015 | full(l) name concat | src/features/activity.js `full()` | tests/e2e/auth-and-leads.spec.js (new lead's page header asserted to contain the concatenated name) | COVERED |
| F016 | visibleLeads() | src/features/activity.js `visibleLeads()` | tests/unit/visible-leads.test.js | COVERED |
| F017 | canSee(l) | src/features/activity.js `canSee()` | tests/unit/visible-leads.test.js | COVERED |
| F018 | outcome(id), leadActs(l), attempts(l), lastAct(l), nextFu(l) | src/features/activity.js `outcome()`, `leadActs()`, `attempts()`, `lastAct()`, `nextFu()` | NONE (tests re-derive lookups themselves rather than calling these exports) | GAP |
| F019 | blockMsg(l) — DNC/DNT/DoNotContact message text | src/features/activity.js `blockMsg()` | NONE | GAP |
| F020 | badge(l) status badge; dncBadges(l) | src/features/activity.js `badge()`, `dncBadges()` | NONE | GAP |
| F021 | listNames(l), leadCampaigns(l) | src/features/activity.js `listNames()`, `leadCampaigns()` | NONE | GAP |
| F022 | renderTpl(tpl, l) — merge-field substitution | src/features/activity.js `renderTpl()` | tests/e2e/campaigns.spec.js (asserts `[data-testid="campaign-text"]` is non-empty after merge-field render) | COVERED |
| F023 | cardBody(c) campaign card body resolution | src/features/activity.js `cardBody()` | NONE | GAP |
| F024 | isBlocked(l, type) | src/features/activity.js `isBlocked()` | tests/unit/activity.test.js "a blocked lead cannot log a call...and nothing is recorded" | COVERED |
| F025 | weekRange()/monthRange()/rangeFor(key)/inRange(a,range) | src/features/stats.js `weekRange()`, `monthRange()`, `rangeFor()`, `inRange()` | tests/unit/stats.test.js (directly imported and used for every range key: week/month/all) | COVERED |
| F026 | pace() — weekly call pace projection math | src/features/stats.js `pace()` | NONE (imported by stats.test.js but never asserted on) | GAP |
| F027 | stats(userId, range) — aggregation incl. points formula | src/features/stats.js `stats()` | tests/unit/stats.test.js (extensive, incl. SQL parity) | COVERED |

## Custom fields

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F028 | CF_TYPES (text/long_text/number/money/date/yes_no/choice) | src/core/fields.js `CF_TYPES` | NONE | GAP |
| F029 | RESERVED_KEYS merge-field collision guard | src/core/fields.js `RESERVED_KEYS` | NONE | GAP |
| F030 | keyFromLabel(l) auto-slug generator | src/core/fields.js `keyFromLabel()` | NONE | GAP |
| F031 | keyProblem(key, taken) validation | src/core/fields.js `keyProblem()` | NONE | GAP |
| F032 | money(n) formatter | src/core/fields.js `money()` | NONE | GAP |
| F033 | cfDisplay(f, raw) per-type display formatting | src/core/fields.js `cfDisplay()` | NONE | GAP |
| F034 | cfClean(f, raw) per-type parse/validate | src/core/fields.js `cfClean()` | NONE | GAP |
| F035 | setCustom(lead, values) bulk merge | src/core/fields.js `setCustom()` | NONE | GAP |
| F036 | BUILT_IN_COLUMNS / columnChoices() / resolvedColumns() / cardFieldsFor() | src/core/fields.js `BUILT_IN_COLUMNS`, `columnChoices()`, `resolvedColumns()`, `cardFieldsFor()` | NONE | GAP |
| F037 | fieldForm(id) — new/edit custom field dialog | src/views/settings.js `fieldForm()` | NONE | GAP |
| F038 | fieldTypeChanged() | src/views/settings.js `fieldTypeChanged()` | NONE | GAP |
| F039 | toggleField(id) | src/views/settings.js `toggleField()` | NONE | GAP |
| F040 | moveField(id, dir) | src/views/settings.js `moveField()` | NONE | GAP |
| F041 | deleteField(id) | src/views/settings.js `deleteField()` | NONE | GAP |
| F042 | saveColumns() | src/views/settings.js `saveColumns()` | NONE | GAP |

## State & routing

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F043 | go(view, id) — hash-based navigation | src/core/router.js `go()` | tests/e2e/auth-and-leads.spec.js (save-lead navigates to the new lead's detail page, asserted via h2) | COVERED |
| F044 | openInCallMode(id, listId) | src/core/router.js `openInCallMode()` | NONE (campaigns.spec.js sets `window.state.queueList` directly instead of calling this) | GAP |
| F045 | callQueue() | src/core/queue.js `callQueue()` | NONE | GAP |
| F046 | queueGo(dir) | src/core/queue.js `queueGo()` | NONE | GAP |
| F047 | queueSkipToUnworked() | src/core/queue.js `queueSkipToUnworked()` | NONE | GAP |
| F048 | hashchange listener — back/forward support | src/core/router.js (window `hashchange` handler) | tests/e2e/*.spec.js broadly (every `page.goto('/#...')` navigation and its subsequent view assertion depends on this handler) | COVERED |
| F049 | clearFilters() | src/core/router.js `clearFilters()` | NONE | GAP |
| F050 | setF(k,v) | src/core/router.js `setF()` | tests/e2e/performance.spec.js "search input stays responsive with 10,000 leads loaded" (typing into `#q` drives the search filter) | COVERED |

## Leads: filtering & list screen

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F051 | filteredLeads() — search/status/assigned/list/campaign/DNC/follow-up/outcome/attempts/date-range filters, 5 sort modes | src/features/leads.js `filteredLeads()` | tests/e2e/performance.spec.js (search filtering asserted) | COVERED |
| F052 | V.leads — page head, bulk toolbar, export/import/new-lead buttons, search, filters panel, results table, pagination | src/views/leads.js `V.leads` | tests/e2e/performance.spec.js (renders `#leads`, `h2` contains "Leads"); tests/e2e/auth-and-leads.spec.js ("+ New lead" button) | COVERED |
| F053 | filterCount()/toggleFilters()/toggleSel(id,on)/toggleAll(on)/bulkArchive()/redrawKeepFocus(id) | src/views/leads.js `filterCount()`, `toggleFilters()`, `toggleSel()`, `toggleAll()`, `bulkArchive()`, `redrawKeepFocus()` | NONE | GAP |

## Leads: mutations

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F054 | logActivity(leadId, type, outcomeId, opts) | src/features/activity.js `logActivity()` | tests/unit/activity.test.js (extensive, both backends); tests/e2e/activity-and-followups.spec.js | COVERED |
| F055 | setDnc(l, key, val) | src/features/leads.js `setDnc()` | tests/unit/dnc-cancels-followups-supabase.test.js | COVERED |
| F056 | archiveLead(id) | src/features/leads.js `archiveLead()` | NONE | GAP |
| F057 | reassign(ids) | src/features/leads.js `reassign()` | NONE | GAP |
| F058 | addToList(ids) | src/features/leads.js `addToList()` | NONE | GAP |
| F059 | addToCampaign(ids) / addLeadsToCampaign(campaignId, ids) | src/features/leads.js `addToCampaign()`, `addLeadsToCampaign()` | tests/unit/list-to-campaign-promise.test.js (exercises `addLeadsToCampaign()` via `listToCampaign()`'s call into it) | COVERED |
| F060 | leadForm(l) — create/edit dialog, dup-phone check | src/features/leads.js `leadForm()` | tests/e2e/auth-and-leads.spec.js "agent can create a new lead", "a duplicate phone number is rejected" | COVERED |
| F061 | setLeadStatus(id, key) | src/features/leads.js `setLeadStatus()` | NONE | GAP |
| F062 | addPhone(leadId) | src/features/leads.js `addPhone()` | NONE | GAP |

## Lead detail screen

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F063 | V.lead — queue bar, page head, blocked banner, phone/activity/campaign/notes/status/details/custom-fields/contact-prefs/follow-ups/timeline panels | src/views/lead.js `V.lead` | tests/e2e/auth-and-leads.spec.js (lead detail page header); tests/e2e/activity-and-followups.spec.js (activity form panel); tests/e2e/campaigns.spec.js (campaign panel on the lead page) | COVERED |

## Call actions & activity logging

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F064 | callBtn(l,n) | src/features/activity.js `callBtn()` | NONE | GAP |
| F065 | textBtn(l,n,size,body) | src/features/activity.js `textBtn()` | NONE | GAP |
| F066 | smsHref(n, body) | src/features/activity.js `smsHref()` | NONE (campaigns.spec.js deliberately avoids clicking the real `sms:` link and calls `sendingCampaign()` directly instead, bypassing this) | GAP |
| F067 | addNote(leadId) | src/features/activity.js `addNote()` | NONE | GAP |
| F068 | fuDone(id)/fuSnooze(id,days)/fuReschedule(id)/fuCancel(id) | src/features/activity.js `fuDone()`, `fuSnooze()`, `fuReschedule()`, `fuCancel()` | tests/e2e/activity-and-followups.spec.js "marking a follow-up done removes it from the pending list" (tests `fuDone()`; the other 3 in this bundle are untested) | COVERED |
| F069 | activityForm(l) | src/features/activity.js `activityForm()` | tests/e2e/activity-and-followups.spec.js "logging a call attempt records an activity..." | COVERED |
| F070 | refreshForm(id) / saveActivity(id) | src/features/activity.js `refreshForm()`, `saveActivity()` | tests/e2e/activity-and-followups.spec.js (`[data-testid="save-activity"]` click, activity count asserted) | COVERED |

## Workspace / call-mode screen

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F071 | queue() — visible/non-dncontact/non-closed leads, filters | src/core/queue.js `queue()` | NONE | GAP |
| F072 | selectedCampaign(l)/campaignCard(l,camp)/campaignText(l,camp) | src/features/campaigns.js `selectedCampaign()`, `campaignCard()`, `campaignText()` | tests/e2e/campaigns.spec.js (`campaign-text` asserted non-empty, with `window.state.wsCampaign` forcing `selectedCampaign()`'s choice) | COVERED |
| F073 | campaignPanel(l) | src/features/campaigns.js `campaignPanel()` | tests/e2e/campaigns.spec.js (`campaign-panel` visible, Send button) | COVERED |
| F074 | sendingCampaign(leadId, campId) | src/features/campaigns.js `sendingCampaign()` | tests/e2e/campaigns.spec.js (called directly, confirm dialog driven through the UI) | COVERED |
| F075 | moreInfo(l) | src/views/workspace.js `moreInfo()` | NONE | GAP |
| F076 | V.workspace | src/views/workspace.js `V.workspace` | NONE (no test navigates to `#workspace`) | GAP |
| F077 | pickNumber(id) | src/views/workspace.js `pickNumber()` | NONE | GAP |
| F078 | copyText(t) | src/core/util.js `copyText()` | NONE | GAP |

## Follow-ups screen

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F079 | V.followups — open/closed tabs, Overdue/Today/Upcoming groups, per-row actions, export | src/views/followups.js `V.followups` | tests/e2e/activity-and-followups.spec.js "marking a follow-up done removes it from the pending list" | COVERED |

## Prospecting lists screens

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F080 | V.lists — list cards, progress bar, New list button | src/views/lists.js `V.lists` | NONE | GAP |
| F081 | listForm(li) | src/views/lists.js `listForm()` | NONE | GAP |
| F082 | V.list — single list detail | src/views/lists.js `V.list` | NONE | GAP |
| F083 | assignList(listId) | src/views/lists.js `assignList()` | NONE | GAP |
| F084 | listToCampaign(listId) | src/views/lists.js `listToCampaign()` | tests/unit/list-to-campaign-promise.test.js | COVERED |
| F085 | archiveList(id) / removeFromList(leadId, listId) | src/views/lists.js `archiveList()`, `removeFromList()` | NONE | GAP |

## Campaigns screens

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F086 | V.campaigns — campaign cards, templates button, export, new-campaign | src/views/campaigns.js `V.campaigns` | NONE | GAP |
| F087 | campaignForm(c) | src/views/campaigns.js `campaignForm()` | NONE | GAP |
| F088 | duplicateCampaign(id) | src/views/campaigns.js `duplicateCampaign()` | NONE | GAP |
| F089 | archiveCampaign(id) | src/views/campaigns.js `archiveCampaign()` | NONE | GAP |
| F090 | templatesDlg()/templateForm(id)/deleteTemplate(id) | src/views/campaigns.js `templatesDlg()`, `templateForm()`, `deleteTemplate()` | NONE | GAP |
| F091 | V.campaign — single campaign detail, status filter, bulk "mark ready" | src/views/campaigns.js `V.campaign` | NONE | GAP |
| F092 | msgCard(card, lead) | src/views/campaigns.js `msgCard()` | NONE | GAP |
| F093 | editCard(id) | src/views/campaigns.js `editCard()` | NONE | GAP |
| F094 | markSent(id) | src/views/campaigns.js `markSent()` | NONE (distinct from `sendingCampaign()`, which is what campaigns.spec.js actually drives) | GAP |
| F095 | logReply(id) | src/views/campaigns.js `logReply()` | tests/e2e/campaigns.spec.js "↩ Log reply" flow, `#rn`/`#rOk` | COVERED |
| F096 | removeCard(id) | src/views/campaigns.js `removeCard()` | NONE | GAP |
| F097 | addLeadsDlg(cid) | src/views/campaigns.js `addLeadsDlg()` | NONE | GAP |

## Imports

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F098 | V.imports — drag-and-drop zone, sample-CSV button, history table | src/views/imports.js `V.imports` | tests/e2e/imports.spec.js (visits `#imports`, drives the wizard) | COVERED |
| F099 | downloadSample() | src/features/imports.js `downloadSample()` | NONE (imports.spec.js ships its own fixture CSV instead of clicking this button) | GAP |
| F100 | parseCsv(text) | src/features/imports.js `parseCsv()` | tests/e2e/imports.spec.js (CSV file imported, rows parsed correctly) | COVERED |
| F101 | handleFile(file) | src/features/imports.js `handleFile()` | tests/e2e/imports.spec.js (`#fileIn` file upload) | COVERED |
| F102 | importWizard()/importCheck() — map step, dup-check step | src/features/imports.js `importWizard()`, `importCheck()` | tests/e2e/imports.spec.js ("Match columns" → "Next: check duplicates" → "Check duplicates") | COVERED |
| F103 | importRun() | src/features/imports.js `importRun()` | tests/e2e/imports.spec.js ("Import N leads" click, leads created, job status "completed") | COVERED |
| F104 | undoImport(id) | src/features/imports.js `undoImport()` | NONE | GAP |

## Reports & scoreboard

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F105 | V.reports — performance table, outcomes/list/campaign/hour breakdowns, export | src/views/reports.js `V.reports` | NONE (tests/unit/stats.test.js re-implements equivalent aggregation logic in the test itself for SQL-parity checking, but never calls `V.reports()`) | GAP |
| F106 | V.scoreboard — points formula, ranked cards, export | src/views/scoreboard.js `V.scoreboard` | NONE | GAP |

## Settings

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F107 | V.settings shell — 8 tabs, audit-log shortcut, sign-out | src/views/settings.js `V.settings` | tests/e2e/exports.spec.js (visits `#settings`, clicks `[data-tab="data"]`) | COVERED |
| F108 | SET.team — team name + agent-name editor, admin shortcuts | src/views/settings.js `SET.team` | NONE | GAP |
| F109 | SET.fields — custom fields list, built-in fields table, column pickers | src/views/settings.js `SET.fields` | NONE | GAP |
| F110 | SET.import — phone/email slots, dup-match toggles, defaults | src/views/settings.js `SET.import` | NONE | GAP |
| F111 | SET.outcomes — outcomes list, lead statuses list | src/views/settings.js `SET.outcomes` | NONE | GAP |
| F112 | SET.scoring — point values, weekly goal, working days | src/views/settings.js `SET.scoring` | NONE | GAP |
| F113 | SET.data — per-dataset export buttons, backup, restore, reset-demo-data | src/views/settings.js `SET.data` | tests/e2e/exports.spec.js (Leads/Activities/Follow-ups CSV downloads, "Save backup" JSON validated) | COVERED |
| F114 | SET.about — compliance notice text | src/views/settings.js `SET.about` | NONE | GAP |
| F115 | saveTeamName/saveBuiltInFields/saveImportCfg/saveSettings | src/views/settings.js `saveTeamName()`, `saveBuiltInFields()`, `saveImportCfg()`, `saveSettings()` | NONE | GAP |
| F116 | statusForm(key)/moveStatus(key,dir)/deleteStatus(key) | src/views/settings.js `statusForm()`, `moveStatus()`, `deleteStatus()` | NONE | GAP |
| F117 | outcomeForm(id) | src/views/settings.js `outcomeForm()` | NONE | GAP |
| F118 | SET.pipelines — pipeline list, per-pipeline stage table | src/views/settings.js `SET.pipelines` | NONE | GAP |

## Audit log

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F119 | V.audit — table filter, 200-row cap, When/Who/Action/Table/Detail | src/views/audit.js `V.audit` | NONE | GAP |

## Exports & backup

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F120 | csvCell(v) — CSV-injection guard + quoting | src/features/exports.js `csvCell()` | tests/unit/export-crm-columns.test.js (its own CSV-row parser depends on `csvCell()`'s exact quoting/escaping to round-trip) | COVERED |
| F121 | exportCsv(dataset) — 9 dataset types | src/features/exports.js `exportCsv()` | tests/e2e/exports.spec.js (Leads/Activities/Follow-ups downloads) | COVERED |
| F122 | backup() — full-db JSON download | src/data/persist.js `backup()` | tests/e2e/exports.spec.js "'Save backup' downloads a valid JSON snapshot" | COVERED |
| F123 | restore file input handler | src/views/settings.js (restore `<input>` handler) | NONE | GAP |

## CRM pipeline core

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F124 | defaultStages()/newPipeline() — 14 default stages | src/features/crm.js `defaultStages()`, `newPipeline()` | NONE | GAP |
| F125 | dealMath(d, stage) — full commission/net/weighted math | src/features/crm.js `dealMath()` | tests/unit/stats.test.js (SQL-parity assertions on price/gross/net/weighted sums, via `localCrmDashboard()`'s direct `dealMath()` calls) | COVERED |
| F126 | canSeeDeal(d) | src/features/crm.js `canSeeDeal()` | tests/unit/stats.test.js (deal-visibility parity vs. Postgres RLS) | COVERED |
| F127 | dealFu(d)/dealCalls(d)/dealTexts(d)/dealLastContact(d)/daysIn(iso) | src/features/crm.js `dealFu()`, `dealCalls()`, `dealTexts()`, `dealLastContact()`, `daysIn()` | tests/unit/stats.test.js (`daysIn()` drives the `avgDays` figure checked against `crm_dashboard_by_stage`; the other 4 in this bundle are untested) | COVERED |
| F128 | fuTone(d) — traffic-light follow-up logic | src/features/crm.js `fuTone()` | tests/unit/stats.test.js (overdue-count parity uses `fuTone(d)==='red'`) | COVERED |
| F129 | dealLog(d, type, detail) | src/features/crm.js `dealLog()` | NONE | GAP |

## Add-to-CRM & deal creation

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F130 | addToCrm(leadIds) — pipeline/stage/price/commission form | src/features/crm.js `addToCrm()` | tests/e2e/crm.spec.js "add to CRM, drag to a new stage, and edit price" | COVERED |
| F131 | stageOptsFor(pipeId, sel) / addToCrmBtn(leadId, size) | src/features/crm.js `stageOptsFor()`, `addToCrmBtn()` | NONE | GAP |

## Moving deals

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F132 | moveDeal(dealId, stageId, why) | src/features/crm.js `moveDeal()` | tests/e2e/crm.spec.js (drag-and-drop asserts `deal.stageId` changed) | COVERED |
| F133 | moveStageDlg(dealId) | src/features/crm.js `moveStageDlg()` | NONE (the drag path doesn't open this dialog) | GAP |
| F134 | drag-and-drop (dragStart/dragEnd/dragOver/dragLeave/dropOn) | src/features/crm.js `dragStart()`, `dragEnd()`, `dragOver()`, `dragLeave()`, `dropOn()` | tests/e2e/crm.spec.js (`card.dragTo(target)`) | COVERED |

## Quick deal edits

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F135 | dealNoteDlg(dealId) | src/features/crm.js `dealNoteDlg()` | NONE | GAP |
| F136 | dealFuDlg(dealId) | src/features/crm.js `dealFuDlg()` | NONE | GAP |
| F137 | setDealField(dealId, key, value) | src/features/crm.js `setDealField()` | tests/e2e/crm.spec.js ("edit price on the deal detail page" fills the price field, dispatches `change`, asserts `deal.price` updated) | COVERED |

## CRM board & filters

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F138 | crmDeals() — 19 filter dimensions, 8 sort modes | src/features/crm.js `crmDeals()` | tests/unit/crm-board-money-permission.test.js (board rendering depends on it returning deals); tests/e2e/crm.spec.js (board shows the new deal's card) | COVERED |
| F139 | crmFilterCount()/crmFiltersDlg()/crmDefaultFilters() | src/features/crm.js `crmFilterCount()`, `crmFiltersDlg()`, `crmDefaultFilters()` | NONE | GAP |
| F140 | dealCard(d) | src/features/crm.js `dealCard()` | tests/unit/deal-money-permission.test.js; tests/unit/crm-board-money-permission.test.js; tests/e2e/crm.spec.js (`[data-testid="deal-card"]`) | COVERED |
| F141 | stageTotals(stage, deals) | src/features/crm.js `stageTotals()` | tests/unit/crm-board-money-permission.test.js (column "weighted forecast" totals asserted) | COVERED |
| F142 | V.crm — pipeline switcher, header KPIs, board, stage settings, mobile nav | src/views/crm.js `V.crm` | tests/unit/crm-board-money-permission.test.js (calls `V.crm()` directly); tests/e2e/crm.spec.js (visits `#crm`) | COVERED |
| F143 | crmPickLead(stageId) | src/views/crm.js `crmPickLead()` | tests/e2e/crm.spec.js (`[data-testid="crm-add"]` opens the pick-lead dialog, `#pll` rows, "Add" button) | COVERED |

## CRM stage & pipeline management

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F144 | stageMenu(stageId) | src/features/crm.js `stageMenu()` | NONE | GAP |
| F145 | moveStage/archiveStage(blocks if occupied/last active)/restoreStage | src/features/crm.js `moveStage()`, `archiveStage()`, `restoreStage()` | NONE | GAP |
| F146 | deleteStage(stageId) | src/features/crm.js `deleteStage()` | NONE | GAP |
| F147 | addStageDlg(pipeId) | src/features/crm.js `addStageDlg()` | NONE | GAP |
| F148 | pipelineDlg(pipeId) | src/features/crm.js `pipelineDlg()` | NONE | GAP |
| F149 | archivePipeline(pipeId) | src/features/crm.js `archivePipeline()` | NONE | GAP |

## Deal detail screen

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F150 | dealTimeline(d) — merged activities/notes/follow-ups/history feed | src/views/deal.js `dealTimeline()` | NONE | GAP |
| F151 | V.deal — header, financials form + math breakdown, timeline, summary tables | src/views/deal.js `V.deal` | tests/e2e/crm.spec.js (visits `#deal/:id`, edits the price field in the financials form) | COVERED |

## CRM dashboard

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F152 | V.crmdash — pipeline/agent/campaign/date filters, 11 KPI tiles, by-stage/by-agent tables | src/views/crmdash.js `V.crmdash` | NONE (tests/unit/stats.test.js re-implements the same aggregation as `localCrmDashboard()` and checks it against SQL functions, but never calls `V.crmdash()` itself) | GAP |

## CRM export

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F153 | crmExportDlg() — 7 export scopes | src/features/crm.js `crmExportDlg()` | NONE | GAP |
| F154 | exportCrm(what, pipeId, stageId, agentId) | src/features/crm.js `exportCrm()` | tests/unit/export-crm-columns.test.js (all 6 non-forecast modes) | COVERED |

## Shell & navigation

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F155 | shell(content) — demo banner, sidebar nav, topbar, mobile nav/call bar | src/views/shell.js `shell()` | tests/unit/shell-demo-banner-gating.test.js; tests/unit/shell-demo-banner-gating-supabase.test.js | COVERED |
| F156 | signOut() | src/core/session.js `signOut()` | tests/e2e/admin.spec.js (`window.signOut()` called directly, re-sign-in flow) | COVERED |
| F157 | toggleTheme() | src/views/shell.js `toggleTheme()` | NONE | GAP |
| F158 | callBarMobile(d) | src/views/shell.js `callBarMobile()` | NONE | GAP |

## Admin: passwords & data migration

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F159 | sha256/randomSalt/hashPassword/checkPassword — salted storage | src/data/repo-local.js `sha256()`, `randomSalt()`, `hashPassword()`, `checkPassword()` | tests/e2e/auth-and-leads.spec.js ("email + password sign-in works", "wrong password is rejected") | COVERED |
| F160 | generatePassword() | src/data/repo-local.js `generatePassword()` | tests/e2e/admin.spec.js (auto-fills the temp-password field revealed and used to sign in) | COVERED |
| F161 | setPassword(m, pw, {temporary}) | src/data/repo-local.js `setPassword()` | tests/e2e/admin.spec.js (temp password set on create; `changePasswordSubmit()` clears `mustChangePw` via this) | COVERED |
| F162 | initials(name)/teamsOf(id) | src/core/session.js `initials()`, `teamsOf()` | NONE | GAP |
| F163 | upgradeDb(d) — old-save migration | src/data/upgrade.js `upgradeDb()` | NONE | GAP |
| F164 | ensureDemoPasswords() | src/data/repo-local.js `ensureDemoPasswords()` | tests/e2e/auth-and-leads.spec.js (relies on `window.DEMO_PASSWORD` having been seeded for every member) | COVERED |

## Admin: users

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F165 | canAdmin()/adminTabs() — tab visibility gating | src/views/admin.js `canAdmin()`, `adminTabs()` | tests/e2e/admin.spec.js (visits `#admin`, switches to the "roles" tab) | COVERED |
| F166 | ADM.users — table, new-user button, per-row actions | src/views/admin.js `ADM.users` | tests/e2e/admin.spec.js ("admin creates a user...") | COVERED |
| F167 | userDlg(id) — create/edit dialog | src/features/admin.js `userDlg()` | tests/e2e/admin.spec.js (`#uF`/`#uL`/`#uE` fields) | COVERED |
| F168 | saveUser(id) | src/features/admin.js `saveUser()` | tests/e2e/admin.spec.js (`[data-testid="save-user"]`, member created and validated) | COVERED |
| F169 | setUserTeams(userId, teamIds) | src/features/admin.js `setUserTeams()` | NONE | GAP |
| F170 | deactivate(m)/toggleMember(id) | src/features/admin.js `deactivate()`, `toggleMember()` | NONE | GAP |
| F171 | resetPasswordDlg(id) | src/features/admin.js `resetPasswordDlg()` | NONE | GAP |
| F172 | userActivity(id) | src/features/admin.js `userActivity()` | NONE | GAP |

## Admin: roles & permissions

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F173 | ADM.roles — role list, selected-role detail, permission checklist | src/views/admin.js `ADM.roles` | tests/e2e/admin.spec.js "owner edits and saves permissions for a role" | COVERED |
| F174 | permsSetAll(v)/permsCopyFrom(id)/savePermissions()/resetPermissions() | src/views/admin.js `permsSetAll()`, `permsCopyFrom()`, `savePermissions()`, `resetPermissions()` | tests/e2e/admin.spec.js (`[data-testid="save-permissions"]` click, `db.roles[...].perms[cap]` asserted flipped — covers `savePermissions()`; the other 3 in this bundle are untested) | COVERED |
| F175 | roleDlg(id) — new/rename role | src/views/admin.js `roleDlg()` | NONE | GAP |
| F176 | deleteRole(id) | src/views/admin.js `deleteRole()` | NONE | GAP |

## Admin: teams

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F177 | ADM.teams — team cards, mini-stats, new-team button | src/views/admin.js `ADM.teams` | NONE | GAP |
| F178 | teamDlg(id) | src/features/admin.js `teamDlg()` | NONE | GAP |
| F179 | teamLogoPick(input) | src/features/admin.js `teamLogoPick()` | NONE | GAP |
| F180 | archiveTeam(id)/restoreTeam(id) | src/features/admin.js `archiveTeam()`, `restoreTeam()` | NONE | GAP |
| F181 | teamPerf(id) | src/features/admin.js `teamPerf()` | NONE | GAP |

## Login & session

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F182 | loginScreen() — forced-password-change vs. normal branch | src/views/login.js `loginScreen()` | tests/unit/demo-banner-gating.test.js; tests/unit/demo-banner-gating-off.test.js; tests/e2e/auth-and-leads.spec.js | COVERED |
| F183 | signIn(id) | src/core/session.js `signIn()` | exercised via `loginAsDemo()` in tests/e2e/helpers.js, used by every demo-login e2e spec | COVERED |
| F184 | signInWithPassword() | src/core/session.js `signInWithPassword()` | tests/e2e/auth-and-leads.spec.js; tests/e2e/admin.spec.js | COVERED |
| F185 | changePasswordSubmit() | src/core/session.js `changePasswordSubmit()` | tests/e2e/admin.spec.js (forced password-change flow) | COVERED |
| F186 | draw() — top-level render loop | src/main.js `draw()` | tests/e2e/performance.spec.js (calls `window.draw()` directly and times it); exercised universally elsewhere | COVERED |
| F187 | app bootstrap IIFE — restores last member + hash route | src/main.js (bootstrap IIFE) | exercised as a precondition of every `page.goto('/')` in tests/e2e/helpers.js's `withDb()`/`loginAsDemo()` | COVERED |
| F188 | ensureDemoPasswords() call on load | src/main.js (top-level call) | tests/e2e/auth-and-leads.spec.js (email+password sign-in depends on passwords having been seeded at load) | COVERED |

## Persistence

| ID | Demo feature (demo function) | New file & function | Test file & test name | Status |
|---|---|---|---|---|
| F189 | loadSaved()/persist() — localStorage save/load, validates db.pipelines | src/data/persist.js `loadSaved()`, `persist()` | NONE (no test reloads the page and asserts restored state) | GAP |
| F190 | resetDemo() | src/data/persist.js `resetDemo()` | NONE | GAP |

## Known demo defects

| ID | Defect (demo line ref) | New file & function (what changed, or "N/A — kept") | Test file & test name | Status |
|---|---|---|---|---|
| D001 | Demo's `.hidden` CSS class had no backing rule (filters panel / custom-field options textarea toggle had no visual effect) (demo ~line 729, 1370) | styles.css `.hidden { display:none !important; }` added | tests/unit/styles-hidden.test.js | FIXED-IN-STAGE-14 |
| D002 | `visibleLeads()` didn't honor team scope the way `canSee()` did — a role with viewTeamLeads but not viewAllLeads couldn't see teammates' leads in list/export screens (demo line 465) | src/features/activity.js `visibleLeads()` | tests/unit/visible-leads.test.js | FIXED-IN-STAGE-14 |
| D003 | `exportCrm()` had a stray extra `""` cell after "Overdue", shifting every later column one to the right (demo line 1893) | src/features/crm.js `exportCrm()` | tests/unit/export-crm-columns.test.js | FIXED-IN-STAGE-14 |
| D004 | `viewPrices`/`viewCommissions` permissions existed and were assignable in the demo but nothing ever checked them anywhere (demo-wide, e.g. dealCard money line ~1693, deal page ~1818-1824, crmdash KPIs ~1866) | src/features/crm.js `dealCard()`, src/views/deal.js, src/views/crmdash.js | tests/unit/deal-money-permission.test.js | FIXED-IN-STAGE-14 |
| D005 | `listToCampaign()` used `addLeadsToCampaign()`'s return value directly; on the Supabase backend that function returns a Promise, not a number, so the toast read "[object Promise] leads added" and navigation happened before the insert landed (demo line 984 used a sync local-only implementation, so this defect is specific to the Supabase rebuild, not the original demo) | src/views/lists.js `listToCampaign()` | tests/unit/list-to-campaign-promise.test.js | FIXED-IN-AUDIT |
| D006 | Marking a lead Do Not Contact didn't cancel its pending follow-ups on the Supabase backend (local backend always did; demo's single `setDnc()` at line 621 always does both since there's only one backend) | src/features/leads.js `setDnc()` (supabase branch) | tests/unit/dnc-cancels-followups-supabase.test.js | FIXED-IN-AUDIT |
| D007 | `setDnc()`'s Supabase branch only mirrored the one toggled key into the in-memory lead instead of the full server patch, leaving `l.dnc`/`l.dnt` stale until reload (demo line 621 always mirrors fully since it's a single in-memory object) | src/features/leads.js `setDnc()` (supabase branch) | tests/unit/dnc-cancels-followups-supabase.test.js | FIXED-IN-AUDIT |
| D008 | `audit()`'s fire-and-forget `writeAuditLog()` call had no `.catch()`, risking an unhandled promise rejection on every mutation across the app if the audit write failed (demo's `audit()` at line 460 is synchronous, so this is Supabase-rebuild-specific) | src/core/session.js `audit()` | (regression surfaced via console error during) tests/unit/dnc-cancels-followups-supabase.test.js | FIXED-IN-AUDIT |
| D009 | CRM board page header and per-column stats showed price/net/weighted totals regardless of viewPrices/viewCommissions, even though per-card money was already gated in Stage 14 (demo has no such permission at all, line ~1719, 1729) | src/views/crm.js (page head + `colHead()`) | tests/unit/crm-board-money-permission.test.js | FIXED-IN-AUDIT |
| D010 | Two demo-only UI banners leaked into a real deployment: the shell's "DEMO — everything runs in this page" banner rendered regardless of backend (demo line 1902, always local so always true there), and the login screen's demo banner/one-click-button explanation/password hint rendered regardless of VITE_DEMO_LOGIN (demo line 2185/2190, always true there) | src/views/shell.js `shell()`, src/views/login.js `loginScreen()` | tests/unit/shell-demo-banner-gating.test.js, tests/unit/shell-demo-banner-gating-supabase.test.js, tests/unit/demo-banner-gating.test.js, tests/unit/demo-banner-gating-off.test.js | FIXED-IN-AUDIT |
| D011 | CSV export (`exportCsv('leads')`) includes every price/commission-bearing column regardless of viewPrices/viewCommissions (demo line 1442-1443 has no such permission at all — this matches the original demo's own behavior exactly) | N/A — kept, matches original demo behavior | NONE | KEPT |
| D012 | CRM filters dialog's price-range and net-commission-range inputs are shown regardless of viewPrices/viewCommissions (demo line 1672-1673 has no such permission at all) | N/A — kept, matches original demo behavior | NONE | KEPT |
| D013 | 18 permissions are defined and assignable in Admin -> Roles but never actually gate anything, in the demo and in this rebuild alike: the entire "Competitions" group (viewCompetitions, participate, createCompetitions, editCompetitions, manageScoring, viewAllResults — the demo has no competitions feature built, only the permission stubs), plus deleteLeads, assignLeads, editDnc, browserDialer, viewAttempts, createFollowUps, createTemplates, deleteCampaigns, assignCampaigns, exportReports, manageIntegrations, viewTeamMembers | N/A — kept, matches original demo behavior (verify by grepping src/ for each permission name to confirm none of them gate anything, same as confirming in the demo) | NONE | KEPT |
| D014 | `features/campaigns.js`'s `sendingCampaign()` references `openDlg`/`field`/`full`/`pretty`/`me` without importing them — looks like a certain ReferenceError on static analysis, but main.js's `Object.assign(window, {...})` plus a `window.me` live getter deliberately expose this surface globally, so it works at runtime (confirmed via direct testing in the e2e suite) | src/features/campaigns.js `sendingCampaign()` (unchanged, relies on src/main.js global exposure) | tests/e2e/campaigns.spec.js (calls window.sendingCampaign() directly) | KEPT |

## Summary

- **Total feature rows (F001–F190): 190**
- **COVERED: 74**
- **GAP: 116**

All 14 known demo defects (D001–D014) are accounted for above: 4 FIXED-IN-STAGE-14, 6
FIXED-IN-AUDIT, 4 KEPT. D013's claim (18 permissions defined but never enforced) was
independently re-verified by grepping `src/` for `can("<perm>")`/`can('<perm>')` for each of
the 18 named permissions — none of them are checked anywhere in the codebase, confirming the
row is accurate as given.

### GAP rows by category

**Permissions & roles**
- F001: PERMISSIONS table itself (55 named permissions across 9 groups)
- F002: LEGACY_CAP map (archiveLeads->deleteLeads, manageMembers->editUsers)
- F004: defaultPermissions() back-compat shim (manager/agent map from roles)
- F006: canUser(m, cap) — permission check for a user who isn't "me"
- F008: roleOf(m) / roleName(m) / isSuperAdmin(m)

**Built-in fields**
- F009: defaultBuiltInFields() — first, last, phone, email, addr, city, state(hidden by default), zip
- F010: builtIn(key)/fieldLabel(key)/fieldOn(key) accessors

**Lead statuses**
- F012: STATUS_TONES palette (grey/blue/green/orange/red)
- F013: statusList()/statusDef(key)

**Session & derived helpers**
- F014: audit(action, table, detail) — writes to db.audit
- F018: outcome(id), leadActs(l), attempts(l), lastAct(l), nextFu(l)
- F019: blockMsg(l) — DNC/DNT/DoNotContact message text
- F020: badge(l) status badge render; dncBadges(l) DNC/DNT/DoNotContact badges
- F021: listNames(l), leadCampaigns(l)
- F023: cardBody(c) campaign card body resolution
- F026: pace() — weekly call pace projection math

**Custom fields**
- F028: CF_TYPES (text, long_text, number, money, date, yes_no, choice)
- F029: RESERVED_KEYS merge-field collision guard
- F030: keyFromLabel(l) auto-slug generator
- F031: keyProblem(key, taken) validation
- F032: money(n) formatter
- F033: cfDisplay(f, raw) — per-type display formatting
- F034: cfClean(f, raw) — per-type parse/validate
- F035: setCustom(lead, values) — bulk merge
- F036: BUILT_IN_COLUMNS / columnChoices() / resolvedColumns() / cardFieldsFor()
- F037: fieldForm(id) — new/edit custom field dialog
- F038: fieldTypeChanged()
- F039: toggleField(id)
- F040: moveField(id, dir)
- F041: deleteField(id)
- F042: saveColumns()

**State & routing**
- F044: openInCallMode(id, listId)
- F045: callQueue()
- F046: queueGo(dir)
- F047: queueSkipToUnworked()
- F049: clearFilters()

**Leads: filtering & list screen**
- F053: filterCount()/toggleFilters()/toggleSel(id,on)/toggleAll(on)/bulkArchive()/redrawKeepFocus(id)

**Leads: mutations**
- F056: archiveLead(id)
- F057: reassign(ids)
- F058: addToList(ids)
- F061: setLeadStatus(id, key)
- F062: addPhone(leadId)

**Call actions & activity logging**
- F064: callBtn(l,n)
- F065: textBtn(l,n,size,body)
- F066: smsHref(n, body)
- F067: addNote(leadId)

**Workspace / call-mode screen**
- F071: queue() — visible, non-dncontact, non-closed leads; list filter; fresh/due queueMode filters; "only my leads" toggle
- F075: moreInfo(l)
- F076: V.workspace
- F077: pickNumber(id)
- F078: copyText(t)

**Prospecting lists screens**
- F080: V.lists
- F081: listForm(li)
- F082: V.list
- F083: assignList(listId)
- F085: archiveList(id) / removeFromList(leadId, listId)

**Campaigns screens**
- F086: V.campaigns
- F087: campaignForm(c)
- F088: duplicateCampaign(id)
- F089: archiveCampaign(id)
- F090: templatesDlg()/templateForm(id)/deleteTemplate(id)
- F091: V.campaign
- F092: msgCard(card, lead)
- F093: editCard(id)
- F094: markSent(id)
- F096: removeCard(id)
- F097: addLeadsDlg(cid)

**Imports**
- F099: downloadSample()
- F104: undoImport(id)

**Reports & scoreboard**
- F105: V.reports
- F106: V.scoreboard

**Settings**
- F108: SET.team
- F109: SET.fields
- F110: SET.import
- F111: SET.outcomes
- F112: SET.scoring
- F114: SET.about
- F115: saveTeamName/saveBuiltInFields/saveImportCfg/saveSettings
- F116: statusForm(key)/moveStatus(key,dir)/deleteStatus(key)
- F117: outcomeForm(id)
- F118: SET.pipelines

**Audit log**
- F119: V.audit

**Exports & backup**
- F123: restore file input handler

**CRM pipeline core**
- F124: defaultStages()/newPipeline()
- F129: dealLog(d, type, detail)

**Add-to-CRM & deal creation**
- F131: stageOptsFor(pipeId, sel) / addToCrmBtn(leadId, size)

**Moving deals**
- F133: moveStageDlg(dealId)

**Quick deal edits**
- F135: dealNoteDlg(dealId)
- F136: dealFuDlg(dealId)

**CRM board & filters**
- F139: crmFilterCount()/crmFiltersDlg()/crmDefaultFilters()

**CRM stage & pipeline management**
- F144: stageMenu(stageId)
- F145: moveStage/archiveStage(blocks if occupied, blocks if last active stage)/restoreStage
- F146: deleteStage(stageId)
- F147: addStageDlg(pipeId)
- F148: pipelineDlg(pipeId)
- F149: archivePipeline(pipeId)

**Deal detail screen**
- F150: dealTimeline(d)

**CRM dashboard**
- F152: V.crmdash

**CRM export**
- F153: crmExportDlg()

**Shell & navigation**
- F157: toggleTheme()
- F158: callBarMobile(d)

**Admin: passwords & data migration**
- F162: initials(name)/teamsOf(id)
- F163: upgradeDb(d)

**Admin: users**
- F169: setUserTeams(userId, teamIds)
- F170: deactivate(m)/toggleMember(id)
- F171: resetPasswordDlg(id)
- F172: userActivity(id)

**Admin: roles & permissions**
- F175: roleDlg(id)
- F176: deleteRole(id)

**Admin: teams**
- F177: ADM.teams
- F178: teamDlg(id)
- F179: teamLogoPick(input)
- F180: archiveTeam(id)/restoreTeam(id)
- F181: teamPerf(id)

**Persistence**
- F189: loadSaved()/persist()
- F190: resetDemo()
