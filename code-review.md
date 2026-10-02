# Code Review — GATE G4 (Hostile Review vs. the Original Demo)

**Method:** every exported function in `src/core`, `src/features`, `src/views` was compared, function by function, against the original single-file demo (`prospecting-call-tracker-demo.html`, preserved read-only at `docs/original-demo.html.ref` for this review) using `docs/inventory.md`'s module→original-name mapping as the index. `docs/CHANGELOG.md`'s "Pre-launch audit" section (already-fixed regressions) and its "flagged, deliberately not fixed" list (the *original demo's own* bugs, intentionally preserved — not rebuild regressions, and out of scope for this report by this project's own stated rule) were excluded from re-reporting; every item below was independently verified against the current source, not carried over from an earlier report.

Files verified **identical in behavior** to the original demo (module-boundary plumbing aside — see `docs/inventory.md`'s documented accommodations): `src/core/util.js`, `src/core/dialog.js`, `src/core/state.js`, `src/core/router.js`, `src/features/campaigns.js` (beyond the CHANGELOG's own investigated-not-a-bug note), `src/views/audit.js`, `src/views/crmdash.js`, `src/views/dashboard.js`, `src/views/followups.js`, `src/views/shell.js`, `src/views/login.js`, `src/views/lead.js`, `src/views/workspace.js`, `src/views/reports.js`, `src/views/scoreboard.js`. No rows below for these.

Nothing in this report has been fixed — findings only, per instruction.

---

## src/core

### core/permissions.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/core/permissions.js:131-153 | Medium | `loadRolesAndPermissions()` makes 3 Supabase calls with no `try/catch` at all — new failure surface the demo never had (roles were always an in-memory seed there). | `export async function loadRolesAndPermissions(){ if(!supabase) return; const { data:{ user } } = await supabase.auth.getUser(); ... }` — no `try{}` anywhere in the function body. | Wrap in `try/catch`; on failure leave `db.roles` as whatever it already was and toast a failure instead of letting it throw uncaught. |

### core/fields.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/core/fields.js:70-123 | Medium | `loadFieldConfig()` — same pattern: a chain of Supabase calls, no `try/catch`. | `export async function loadFieldConfig(){ if(!supabase) return; const { data:{ user } } = await supabase.auth.getUser(); ... }` (unguarded). | Wrap in `try/catch`; fall back to `defaultBuiltInFields()`/seeded `db.customFields` on failure and toast. |

### core/statuses.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/core/statuses.js:26-38 | Medium | `loadStatusConfig()` — same pattern, no `try/catch`, so a network blip during sign-in is an unhandled rejection rather than a graceful fallback to `defaultStatuses()`. | `export async function loadStatusConfig(){ if(!supabase) return; const { data:{ user } } = await supabase.auth.getUser(); ... }` | Wrap in `try/catch`, fall back to `defaultStatuses()` (already `statusList()`'s own fallback when `db.settings.statuses` is falsy), toast on failure. |

### core/session.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/core/session.js:77 | Medium | `signOut()`'s `repo.signOut?.()` is fire-and-forget with no `.catch` — a failed remote sign-out is an unhandled rejection. Demo had no network call here at all. | `repo.signOut?.();` immediately followed by synchronous local state reset — no `.catch(...)`. | Add `.catch(e => console.error("sign out:", e))`, matching the pattern `audit()` already uses for `writeAuditLog`. |
| src/core/session.js:109-115 | Medium | `signIn(id)` awaits `repo.signInWithPassword(...)` with no `try/catch` and no re-entrancy guard — a rapid double-click on a "sign in as" button can fire two concurrent sign-ins. Demo's `signIn(id)` was fully synchronous, no race possible. | `const result = await repo.signInWithPassword(m.email, DEMO_PASSWORD); if(!result.ok){ toast(...); return; } finishSignIn(result.member);` — no try/catch, no pending-guard. | Wrap in `try/catch` with a toast on rejection; guard against re-entry while the promise is in flight. |
| src/core/session.js:120-128 | Medium | `signInWithPassword()` (email+password form) — same gap: no `try/catch` around the network call, no disabled-while-pending state on Sign In. | `const result = await repo.signInWithPassword(email, pw); if(!result.ok){ ... } finishSignIn(result.member);` | Wrap in `try/catch` (toast a generic failure message), disable the submit control for the duration of the call. |
| src/core/session.js:130-140 | Medium | `changePasswordSubmit()` awaits `repo.updatePassword(m, a)` with no `try/catch` and no guard against a double-submit. Demo's password change was pure synchronous hashing. | `await repo.updatePassword(m, a); m.mustChangePw=false; ...` — no try/catch, no pending-state guard. | Wrap in `try/catch`, toast on failure, disable Save while pending. |
| src/core/session.js:149-153 | Medium | `restoreSession()` awaits `repo.getSessionMember()` with no `try/catch` — a network hiccup at app load throws uncaught instead of falling through to the login screen. | `const m = await repo.getSessionMember(); if(m) setMe(m);` | Wrap in `try/catch`; on failure leave `me` as `null` (falls through to login) instead of propagating the rejection. |

### core/queue.js *(not in the original split — see note)*

> `docs/inventory.md` has no entry for this file; per its own header comment it is new "Stage 7" plumbing shared between backends, introduced during rework rather than mechanically ported. Its local-backend logic was verified as a faithful port of the demo's `queue()`/`callQueue()`/`queueGo()`/`queueSkipToUnworked()` (original lines 548-568, 865) — flagged here under "dead code and additions" as instructed, not because the file itself is wrong.

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/core/queue.js:63-71, 77-85 | Medium | Race condition: a slower, older `repoLeads.search(params)` response can resolve after a newer one and clobber the newer cache entry, since the `.then()` callback writes unconditionally without checking the cache's key is still current. | `repoLeads.search(params).then(({rows}) => { queueCache = { key, ids: rows.map(...) }; draw(); })` — no check that `key` still equals the current `queueParams()` key when the callback runs. | Re-check `key` still matches the current params (or use a monotonic request counter) before applying the resolved result; drop it otherwise. |
| src/core/queue.js:84 | Low | Inconsistent error handling: `ensureQueueLoaded()`'s catch toasts "Couldn't load queue"; `ensureFallbackLoaded()`'s catch resets state and redraws with **no** message at all. | `ensureFallbackLoaded`: `.catch(() => { fallbackCache = { key:null, ids:[] }; draw(); });` — no toast. | Add the same toast to `ensureFallbackLoaded`'s catch. |

---

## src/features

### features/leads.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/features/leads.js:123-129 | Medium | `archiveLead()`'s Supabase branch drops the `audit("archived","leads",...)` call the original demo (and this file's own local branch) always makes; no server trigger backfills it. | Current: `repoLeads.archive(id).then(()=>{ l.archived=true; toast("Lead archived"); ... })` — no `audit(...)`. Original: `l.archived=true; audit("archived","leads",full(l)); toast(...)`. | Add the matching `audit(...)` call inside the `.then()`. |
| src/features/leads.js:130-135 | Medium | `reassign()`'s Supabase branch never calls `audit("reassigned","assignments",...)`. | Current: `repoLeads.bulkReassign(ids, to).then(()=>{ ...; toast("Reassigned"); draw(); })` — no audit. Original calls `audit("reassigned","assignments", ...)`. | Add the matching `audit(...)` call after success. |
| src/features/leads.js:136-141 | Medium | `addToList()`'s Supabase branch never calls `audit("updated","lists",...)`. | Current: `repoLeads.bulkAddToList(ids, to).then(()=>{ ...; toast("Added to list"); draw(); })` — no audit. Original: `audit("updated","lists", ...)`. | Add the matching `audit(...)` call. |
| src/features/leads.js:150-153 | Medium | `addLeadsToCampaign()`'s Supabase branch never calls `audit("added leads","campaign_leads",...)`; original audits the count. | `return repoCampaignLeads.addLeads(campaignId, ids);` — no audit; no server trigger backfills it. | Await the call, then `audit(...)` with the resulting count before returning it. |
| src/features/leads.js:181-186 | Medium | `leadForm()`'s "create lead" Supabase branch never calls `audit("created","leads",...)`. | `.then(id => { closeDlg(); toast("Lead created"); go("lead", id); })` — no audit. Original: `audit("created","leads",full(nl))`. | Add the audit call once the create resolves. |
| src/features/leads.js:194-201 | Medium | `leadForm()`'s "edit lead" Supabase branch never calls `audit("updated","leads",...)`. | `.then(() => { Object.assign(l,...); ...; toast("Saved"); draw(); })` — no audit. Original: `audit("updated","leads", full(l))`. | Add the matching `audit(...)` call after the patch/phone update both succeed. |
| src/features/leads.js:255-262 | Medium | `saveCustom()`'s Supabase branch never calls `audit("updated","lead_custom_values",...)`. | Refetches the lead and toasts, no audit. Original: `audit("updated","lead_custom_values", full(l))`. | Add the audit call once the save succeeds. |
| src/features/leads.js:53-64 | Low | `supabaseFilteredLeads()`'s search cache can be overwritten by a stale, slower response after a newer search already started, briefly flashing results for an older query (self-corrects on next `draw()`). | `searchCache = { key, ids: ... }` written unconditionally in the `.then()`, even if a newer call already changed `searchCache.key`. | Guard the write with `if(searchCache.key === key)` before applying. |
| src/features/leads.js:142, 170-206, 220-226 | Medium | No disable-while-pending guard on `#aOk`/`#lOk`/`#pOk` buttons now that `addToCampaign`/`leadForm`/`addPhone` are async network calls — a rapid double-click can fire two concurrent creates/inserts (two leads, two phone rows). Demo's writes were synchronous in-memory pushes, so no such race existed. | No `disabled`/in-flight guard anywhere around these Supabase call sites. | Disable the triggering button (or guard with an in-flight flag) for the duration of the async call. |

### features/activity.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/features/activity.js:92-97 | Medium | `addNote()`'s Supabase branch never calls `audit("created","notes",...)`; `notes.create()` is a plain insert with no server-side audit. | `.then(row=>{ db.notes.push(row); toast("Note added"); draw(); })` — no audit. Original: `audit("created","notes",full(...))`. | Add the matching `audit(...)` call. |
| src/features/activity.js:98-105 | Medium | `fuDone()`'s Supabase branch never calls `audit("completed","follow_ups",...)`. | `.then(()=>{ f.status="done"; f.doneAt=...; toast(...); draw(); })` — no audit vs. original's `audit("completed","follow_ups",full(...))`. | Add the audit call after the update resolves. |
| src/features/activity.js:106-114 | Medium | `fuSnooze()`'s Supabase branch never calls `audit("rescheduled","follow_ups",...)`. | No audit vs. original's `audit("rescheduled","follow_ups", ...)`. | Add the matching audit call. |
| src/features/activity.js:115-122 | Medium | `fuReschedule()`'s Supabase branch never calls `audit("rescheduled","follow_ups",...)`. | No audit vs. original's `audit("rescheduled","follow_ups", \`→ ${f.due}\`)`. | Add the audit call once the reschedule succeeds. |
| src/features/activity.js:123-130 | Medium | `fuCancel()`'s Supabase branch never calls `audit("cancelled","follow_ups",...)`. | No audit vs. original's `audit("cancelled","follow_ups",full(...))`. | Add the audit call once the cancel succeeds. |

### features/stats.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/features/stats.js:24-30 | Medium | `cached()` permanently "poisons" its cache entry with a zero placeholder after any fetch failure — a single transient network blip leaves stats/reports/CRM-dashboard numbers stuck at 0 for the rest of the session, no retry, only a generic toast. | `if(!cache.has(key)){ cache.set(key, zero); fetcher().then(v=>{cache.set(key,v);draw();}).catch(()=>{toast("Couldn't load stats");}); } return cache.get(key);` — the failed entry is never cleared. | On failure, delete the cache entry (or store a retry-able "errored" sentinel) instead of leaving the optimistic zero cached forever. |
| src/features/stats.js:52,60 | Low | Local-backend `stats()` returns an extra `total: acts.length` key with no equivalent in the original's return shape. | Current adds `total: acts.length`; original has no `total` key. | If unused by any caller, drop it for byte-for-byte parity; if used, this is an intentional, harmless addition — document it. |

### features/exports.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/features/exports.js:85-108 (esp. 86) | High | `exportCsv()` is `async` (awaits `ensureExportData(dataset)`) but every call site fires it fire-and-forget from an `onclick="..."` string with no `.catch` — a Supabase fetch failure becomes an unhandled rejection with **no user-facing error at all** (the Export button silently does nothing). Demo's `exportCsv()` was fully synchronous and could not fail this way. | `export async function exportCsv(dataset){ await ensureExportData(dataset); ... }` — no try/catch; call sites across `views/leads.js`, `views/settings.js`, `views/campaigns.js`, `views/lists.js`, `views/reports.js`, `views/scoreboard.js`, `views/followups.js` are plain `onclick="exportCsv('leads')"`. | Wrap the body in try/catch (or add `.catch(e=>toast(e.message))` at each call site) so a failed export surfaces a toast. |

### features/crm.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/features/crm.js:121-139 | Medium | `addToCrm()`'s Supabase branch never calls `audit("added to CRM","deals",...)`; `repoCrm.create()` is a plain insert with no server-side audit. | Local branch/original: `audit("added to CRM", "deals", ...)`. Supabase branch's loop only toasts on completion — no audit anywhere in the chain. | Call `audit("added to CRM","deals", ...)` once the loop finishes, using the final added count. |
| src/features/crm.js:134 | Medium | `repoCrm.addHistory(row.id, "created", ...)` is fired with an empty `.catch(()=>{})` — a failed "Added to CRM" history entry is silently swallowed; the deal's timeline is permanently missing its creation entry with no sign anything went wrong. | `repoCrm.addHistory(row.id, "created", ...).catch(()=>{});` | Surface the failure (toast/console warn) instead of a silent no-op catch. |
| src/features/crm.js:159-175 (esp. 164-169) | High | `moveDeal()`'s Supabase branch never calls `audit("moved","deals",...)` — the single most common CRM action (drag-and-drop / Move button) leaves no audit trail on the Supabase backend at all. | Local/original: `dealLog(d,"stage",...); audit("moved","deals", ...); toast(...); draw();`. Supabase branch's `.then()` chain never calls `audit(...)`. | Add the matching `audit("moved","deals", ...)` call once the move + history write succeed. |
| src/features/crm.js:164-168 | Medium | If `repoCrm.addHistory()` fails after `repoCrm.move()` already succeeded, the single shared `.catch(e=>toast(e.message))` reports a generic failure even though the stage move itself already committed and `d.stageId`/`d.stageEnteredAt` are already locally updated — misleading error message implies the whole move failed when only the history write did. | `repoCrm.move(...).then(() => { d.stageId = to.id; ...; return repoCrm.addHistory(...); }).then(...).catch(e => toast(e.message));` — one catch for two independently-failable steps. | Give the history write its own, softer failure handling instead of sharing the move's catch. |
| src/features/crm.js:243-266 (esp. 265) | Medium | `setDealField()`'s `"notes"` branch fires the Supabase update without awaiting it, then unconditionally calls `audit("updated","deals",...)` and `draw()` immediately — every other key in the same function correctly gates the audit call on the write succeeding (inside a shared `save()` helper's `.then()`); a failed notes save is audited as if it succeeded. | `else if(key==="notes"){ d.notes = value; if(BACKEND==="supabase"){ repoCrm.update(dealId, {notes:value}).catch(e=>toast(e.message)); } audit("updated", "deals", ...); draw(); }` | Route the "notes" case through the same `save()` helper the other keys use, so audit only fires after a confirmed successful write. |
| src/features/crm.js:524-537 (esp. 525) | High | `exportCrm()` is `async` (awaits `ensureCrmExportData()`) but its call site fires it with no `.catch` — a fetch failure is an unhandled rejection and the Export button silently does nothing. | `$("#exOk").onclick = () => { closeDlg(); exportCrm(...); };` — no `.catch`/await; `exportCrm` has no internal try/catch either. | Wrap in try/catch (or add `.catch(e=>toast(e.message))` at the call site). |
| src/features/crm.js:275-290 | Low | `supabaseCrmDeals()`'s cache has the same stale-response race as `leads.js`'s `supabaseFilteredLeads()` — a slower, older response can overwrite a newer cache entry, flashing stale results (self-corrects next render). | `crmSearchCache = { key, ids };` written unconditionally in the `.then()`. | Guard the write with a check that `key` is still current before applying. |

### features/imports.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/features/imports.js:131-146 | Medium | No disable-while-pending guard on the Import button — `importRun()` is now an async network call (`repoImports.commit(...)`), and a rapid double-click can fire two separate `commit` calls, risking the import's leads being created twice. Demo's import was fully synchronous. | `export async function importRun(){ ... try{ const {imported, list_id} = await repoImports.commit({...}); ... }catch(e){ toast(e.message); } }` — no in-flight flag/button-disable before the await resolves. | Set an in-flight flag (disable the Import button) until the request settles. |

### features/admin.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/features/admin.js:128-133 | Medium | `deactivate()` mutates local state and calls `audit(...)` synchronously, *before* the actual Supabase write is even attempted (fired fire-and-forget after); if that write fails, the UI and audit log both claim the user was deactivated while the server row may still show them active. | `m.active=false; m.deactivatedAt=...; audit("deactivated","users",m.name); if(BACKEND==="supabase") repoUsers.update(m.id, {active:false, deactivated_at:m.deactivatedAt}).catch(e=>toast(e.message));` — local mutation/audit isn't gated on the async call succeeding. | Gate the local mutation/audit/toast on the resolved `repoUsers.update()` promise (as `saveUser()`'s own patch already correctly does), or roll back on failure. |
| src/features/admin.js:138-141 | Medium | `reactivate()` has the identical optimistic-audit-before-confirmed-write issue as `deactivate()`. | `m.active=true; audit("reactivated","users",m.name); if(BACKEND==="supabase") repoUsers.update(m.id, {active:true}).catch(e=>toast(e.message));` | Same fix as `deactivate()`. |

---

## src/views

### views/deal.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/views/deal.js:58-59 | High | The `viewPrices`/`viewCommissions` money-gating added in the pre-launch audit was applied to "Potential sale price" and the commission table, but **not** to "Brokerage flat fee" or "Closing costs / deductions" — both raw dollar figures still shown/editable to any role regardless of permission. | `${field("Potential sale price", can("viewPrices") ? $$("price", d.price) : '<span class="muted">Hidden for your role</span>')}...${field("Brokerage flat fee", $$("brokerageFee", d.brokerageFee))}${field("Closing costs / deductions", $$("closingCosts", d.closingCosts))}` — only `price` is gated. | Wrap the "Brokerage flat fee" and "Closing costs / deductions" fields in the same `can("viewPrices")` (or `viewCommissions`) check, with the same "Hidden for your role" placeholder. |

### views/imports.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/views/imports.js:18 | High | The "Undo" button's visibility condition was changed from the original's `j.leadIds.length` to `j.imported>0`. These diverge whenever an import used "merge" duplicate-handling (`features/imports.js:152`'s merge path increments `imported` but never pushes into `leadIds`), so a merge-only import now shows an "Undo" button that does nothing useful — `undoImport`'s local branch only loops `j.leadIds` (empty), yet still flips status to "undone" and toasts "Import undone", falsely telling the user data was removed, while its own confirm dialog (`features/imports.js:158`) correctly still says "0 leads...will be removed" — a visible contradiction. | Current: `${j.status==="completed"&&j.imported>0?...Undo button...:""}`. Original (`docs/original-demo.html.ref:1039`): `${j.status==="completed"&&j.leadIds.length?...:""}`. | Change the condition back to `j.leadIds.length`, or split it the same way `undoImport()` itself already does: `BACKEND==="supabase" ? j.imported : j.leadIds.length`. |

### views/campaigns.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/views/campaigns.js:189-218 | Medium | `markSent()`, `logReply()`, and `editCard()` mutate a campaign card's status on the Supabase backend but never call `resetCampaignSummaries()` — the Campaigns list page's cached per-campaign totals (`total`/`sent`/`replied`) go stale after these actions, unlike the original which recomputes them fresh from `db.campaignLeads` on every render (no cache to go stale). | `resetCampaignSummaries()` is called from campaign create (line 56), `duplicateCampaign` (77), `addLeadsDlg`'s finish (261), and `removeCard` (223) — but not from `markSent` (194-202), `logReply` (204-217), or `editCard` (176-188), despite all three changing `card.status`, which the cached counters derive from. | Call `resetCampaignSummaries()` (or a targeted per-campaign invalidation) at the end of these three functions' Supabase success branches. |
| src/views/campaigns.js:48-73 | Low | `campaignForm()`'s save button (and similarly `duplicateCampaign`, `templateForm`, `removeCard`) has no disabled-while-pending guard around its Supabase `.then()` chain — a rapid double-click before `closeDlg()` runs can submit the create/update call twice, risking duplicate rows. Demo had no async writes at all. | `$("#cOk").onclick=()=>{ ... repoCampaigns.create({name,type,body}).then(nc => {...}) ... }` — no `disabled` toggle before the async call. | Disable the triggering button (or set an in-flight flag) for the duration of the promise chain. |

### views/admin.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| src/views/admin.js:105-122 | Medium | `roleDlg()`'s "Create role" button has no disabled-while-pending guard on the Supabase backend — the duplicate-name check runs synchronously against the client's current (possibly stale) `db.roles` cache before `await supabaseRoles.create(...)`, so a fast double-click can fire two `create` calls before either response updates `db.roles`, creating two roles with the same name. | `$("#rOk").onclick = async () => { ... if(db.roles.some(x=>x.name.toLowerCase()===name.toLowerCase() && x.id!==r?.id)) return toast(...); if(BACKEND==="supabase"){ try{ ... await supabaseRoles.create(...); ... }catch(e){...} closeDlg(); toast("Saved"); draw(); return; } ... }` — no `$("#rOk").disabled=true` before the `await`. | Disable `#rOk` immediately on click, re-enabling only in the `catch` path. |

### views/leads.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| views/leads.js:63,68 | Medium | On the Supabase backend, the page header's "leads" count and "match" count are forced to the same number, losing the distinction the demo always made between "how many you can see" and "how many match your current filters." | `const total = BACKEND==="supabase" ? leadsSearchTotal() : all.length;` ... `const headCount = BACKEND==="supabase" ? total : visibleLeads().length;` then `<p>${headCount} leads... · ${total} match</p>`. Original: `<p>${visibleLeads().length} leads... · ${all.length} match</p>` (independently derived). | Add a dedicated unfiltered-count query for the Supabase branch so `headCount` isn't just an alias of `total`. |
| views/leads.js:89 | Medium | The empty-state message ("No leads match these filters." vs. "No leads yet...") still branches on `visibleLeads().length`, which on Supabase only reflects whatever rows have already been lazily hydrated into `db.leads` — not the account's real lead count — so a zero-result filtered search on a large account can incorrectly show "No leads yet. Import a spreadsheet or add a lead." | Unchanged `visibleLeads().length?"No leads match these filters.":"No leads yet. Import a spreadsheet or add a lead."` ternary; on Supabase `visibleLeads()` no longer walks the complete account dataset the way it does for the local backend. | Gate this message on a Supabase-aware "has this org ever had any leads" signal instead of `visibleLeads().length`. |

### views/lists.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| views/lists.js:46 | Medium | `listForm()`'s Create/Save button has no disabled-while-pending guard around the async `listsRepo.create()`/`rename()` calls — a fast double-click can fire two inserts and create two lists with the same name before the first response closes the dialog. | `$("#lOk").onclick=()=>{ ... if(BACKEND==="supabase"){ ...listsRepo.create(n).then(nl=>{ db.lists.push(nl); closeDlg(); draw(); })...}` — no `disabled` set before the call. Demo had no network round-trip here (synchronous `db.lists.push`). | Disable `#lOk` immediately on click, re-enabling only on failure. |

### views/settings.js

| File:line | Severity | What is wrong | Evidence | Suggested fix |
|---|---|---|---|---|
| views/settings.js:167-168 | High | The "Demo data" card's copy ("Everything you change is saved in this browser, so it is still here after a refresh") and its Backup/Restore/Reset buttons render unconditionally regardless of `BACKEND`, even though the restore handler in `data/persist.js` already refuses on the Supabase backend (`toast("Restoring a backup isn't available on this backend — export only.")`) — the same class of "describes the local backend specifically" issue the pre-launch audit explicitly fixed for `views/shell.js`'s banner and `views/login.js`'s hint, but this card was missed. | `<div class="card"><h4>Demo data</h4><p class="small muted">Everything you change is saved in this browser...</p><div class="actions">...backup()...restoreIn...resetDemo()...</div></div>` — unconditional; compare `data/persist.js`'s `if(BACKEND==="supabase"){ toast(...); return; }` restore guard. | Gate this card's copy (and hide/relabel the Restore button) behind `BACKEND==="local"`, mirroring the shell/login banner fixes. |
| views/settings.js:431 | Low | The archived-pipeline "Restore" button now calls a new function `restorePipeline(id)` with no counterpart in the original demo (not in `docs/inventory.md`'s `features/crm.js` entry) — a legitimate addition for async persistence, flagged as new code per instruction. | `onclick="restorePipeline(${p.id})"` vs. original's inline `onclick="pipeline(${p.id}).archived=false;draw()"`. | No fix required; confirm `restorePipeline()` also writes an audit-log entry the way `archivePipeline()` does, for parity. |
| views/settings.js:11 | Low | Dead code: the named import `pipeline` from `features/crm.js` is never referenced anywhere in this file. | `import { addStageDlg, archivePipeline, num, pipeline, pipelineDlg, restorePipeline, restoreStage, stageMenu } from '../features/crm.js';` — no other occurrence of bare `pipeline` in the file. | Remove the unused import. |
| views/settings.js:11,198 | Low | Dead code: the named import `num` from `features/crm.js` is shadowed by a local `const num = (id, lo, hi, cur) => {...}` inside `saveImportCfg()` — every call site resolves to the local, never the import. | Local `num` redeclared at line 198; import at line 11 never used. | Rename the local helper (e.g. `clampNum`) or drop the unused top-level import. |

---

## Summary of dominant patterns

1. **Dropped audit-log calls on the Supabase backend** (Medium, widespread): `archiveLead`, `reassign`, `addToList`, `addLeadsToCampaign`, `leadForm` create/edit, `saveCustom` (`features/leads.js`); `addNote`, `fuDone`, `fuSnooze`, `fuReschedule`, `fuCancel` (`features/activity.js`); `addToCrm`, `moveDeal` (`features/crm.js`); the optimistic-before-confirmed variant in `deactivate`/`reactivate` (`features/admin.js`). None of these have a server-side trigger backfilling the audit row, so the Supabase backend's audit log is measurably less complete than the local backend's and the original demo's — every one of these actions is invisible in `#audit` on a real deployment.
2. **`async` functions invoked fire-and-forget from `onclick=""` with no `.catch` anywhere** (High): `exportCsv()`/`exportCrm()` — a network failure during export silently does nothing, with zero user-facing feedback, across every screen that has an Export button.
3. **No disable-while-pending guard on several save/create buttons** newly backed by async network calls (`leads.js`'s add/edit/phone dialogs, `campaigns.js`'s create/duplicate/template/remove, `lists.js`'s create/rename, `admin.js`'s role-create, `imports.js`'s commit) — a rapid double-click can issue duplicate writes; none of this was possible in the synchronous original.
4. **Two independent "the app still talks about the local demo backend" gaps** that slipped past the earlier pre-launch audit's otherwise-thorough shell/login banner fix: `views/settings.js`'s "Demo data" backup/restore card (High) and, more narrowly, `views/leads.js`'s header counts/empty-state message conflating "visible" with "matches all leads" on Supabase (Medium).
5. A handful of low-severity items: two stale cache races (`leads.js`, `crm.js` search caches — self-correcting but can flash stale data), two dead imports (`settings.js`), one changed Undo-button condition with a confusable user-facing consequence (`imports.js`, High because of the misleading "Import undone" toast on a no-op action), and one stale summary cache (`campaigns.js` list totals).

No Critical-severity findings (no data loss or security issue was found in this pass — GATE G3's separate security audit covers that ground). No behavior differences were found that changed text/copy/ordering/defaults/rounding beyond what's listed above; the large majority of ported logic across all three directories is a verbatim match to the original demo.
