# Module Inventory — Stage 0

Every module produced by splitting the original single-file demo script, and the exact original top-level declarations (functions/consts/lets, plus `V.*`, `SET.*`, `ADM.*`, and `window.*`-equivalent listener blocks) each one contains, in original source order. Every name below is verbatim from the original monolith — none were renamed.

| Module file | Original names contained |
|---|---|
| `src/core/util.js` | `$`, `esc`, `pad`, `todayD`, `isoDate`, `TODAY`, `daysAgo`, `addDays`, `fmtD`, `fmtDT`, `digits`, `normPhone`, `prettyRaw`, `pretty`, `isApple`, `smsHref`, `toast`, `download`, `copyText` |
| `src/core/dialog.js` | `openDlg`, `closeDlg`, `confirmDlg`, `field`, `opts`, `memberOpts`, `listOpts` |
| `src/core/state.js` | `state`, `TITLES`, `V` |
| `src/core/router.js` | `go`, `openInCallMode`, `callQueue`, `queueGo`, `queueSkipToUnworked`, `(window listener)@404`, `clearFilters`, `setF`, `redrawKeepFocus` |
| `src/core/permissions.js` | `PERMISSIONS`, `LEGACY_CAP`, `PERM_LABEL`, `PERM_GROUPS`, `ALL_PERMS`, `permsFrom`, `CAPABILITIES`, `AGENT_BASE`, `MANAGER_BASE`, `ADMIN_BASE`, `defaultRoles`, `defaultPermissions`, `roleOf`, `roleName`, `isSuperAdmin`, `can`, `canUser`, `sameTeam` |
| `src/core/fields.js` | `defaultBuiltInFields`, `BUILT_IN_DEFAULT_LABEL`, `builtIn`, `fieldLabel`, `fieldOn`, `CF_TYPES`, `CF_TYPE_LABEL`, `RESERVED_KEYS`, `activeFields`, `allFields`, `keyFromLabel`, `keyProblem`, `money`, `cfDisplay`, `cfClean`, `setCustom`, `BUILT_IN_COLUMNS`, `DEFAULT_COLUMNS`, `columnChoices`, `resolvedColumns`, `cardFieldsFor` |
| `src/core/statuses.js` | `defaultStatuses`, `STATUS_TONES`, `statusList`, `statusDef`, `statusLabel` |
| `src/core/session.js` | `me`, `isMgr`, `memberName`, `audit`, `signOut`, `DEMO_PASSWORD`, `sha256`, `randomSalt`, `hashPassword`, `generatePassword`, `setPassword`, `checkPassword`, `initials`, `teamsOf`, `ensureDemoPasswords`, `signIn`, `signInWithPassword`, `changePasswordSubmit` |
| `src/data/seed.js` | `seed` |
| `src/data/upgrade.js` | `upgradeDb` |
| `src/data/persist.js` | `SAVE_KEY`, `loadSaved`, `persist`, `resetDemo`, `_saved`, `db`, `nid`, `backup`, `(window listener)@1291` |
| `src/features/leads.js` | `filteredLeads`, `PAGE`, `setDnc`, `archiveLead`, `reassign`, `addToList`, `addToCampaign`, `addLeadsToCampaign`, `leadForm`, `setLeadStatus`, `addPhone`, `customPanel`, `saveCustom` |
| `src/features/activity.js` | `full`, `visibleLeads`, `canSee`, `outcome`, `leadActs`, `attempts`, `lastAct`, `nextFu`, `blockMsg`, `badge`, `dncBadges`, `listNames`, `leadCampaigns`, `renderTpl`, `cardBody`, `isBlocked`, `logActivity`, `icon`, `callBtn`, `textBtn`, `addNote`, `fuDone`, `fuSnooze`, `fuReschedule`, `fuCancel`, `activityForm`, `refreshForm`, `saveActivity`, `queue` |
| `src/features/stats.js` | `weekRange`, `monthRange`, `rangeFor`, `inRange`, `pace`, `stats` |
| `src/features/campaigns.js` | `CAMPAIGN_TYPES`, `selectedCampaign`, `campaignCard`, `campaignText`, `campaignPanel`, `sendingCampaign` |
| `src/features/exports.js` | `csvCell`, `exportCsv` |
| `src/features/crm.js` | `STAGE_COLORS`, `TEMPS`, `defaultStages`, `newPipeline`, `num`, `pct`, `dealMath`, `pipelines`, `pipeline`, `stageOf`, `dealLead`, `dealsFor`, `canSeeDeal`, `dealFu`, `dealCalls`, `dealTexts`, `dealLastContact`, `daysIn`, `fuTone`, `dealLog`, `addToCrm`, `stageOptsFor`, `addToCrmBtn`, `moveDeal`, `moveStageDlg`, `dragDeal`, `dragStart`, `dragEnd`, `dragOver`, `dragLeave`, `dropOn`, `dealNoteDlg`, `dealFuDlg`, `setDealField`, `crmDeals`, `crmFilterCount`, `crmFiltersDlg`, `crmDefaultFilters`, `dealCard`, `stageTotals`, `stageMenu`, `moveStage`, `archiveStage`, `restoreStage`, `deleteStage`, `addStageDlg`, `pipelineDlg`, `archivePipeline`, `crmExportDlg`, `exportCrm` |
| `src/views/shell.js` | `NAV`, `shell`, `toggleTheme`, `callBarMobile` |
| `src/views/login.js` | `loginScreen` |
| `src/views/dashboard.js` | `V.dashboard` |
| `src/views/leads.js` | `leadCell`, `V.leads`, `filterCount`, `toggleFilters`, `toggleSel`, `toggleAll`, `bulkArchive` |
| `src/views/lead.js` | `V.lead` |
| `src/views/workspace.js` | `moreInfo`, `V.workspace`, `pickNumber` |
| `src/views/followups.js` | `V.followups` |
| `src/views/lists.js` | `V.lists`, `listForm`, `V.list`, `assignList`, `listToCampaign`, `archiveList`, `removeFromList` |
| `src/views/campaigns.js` | `V.campaigns`, `campaignForm`, `duplicateCampaign`, `archiveCampaign`, `templatesDlg`, `templateForm`, `deleteTemplate`, `V.campaign`, `msgCard`, `editCard`, `markSent`, `logReply`, `removeCard`, `addLeadsDlg` |
| `src/views/imports.js` | `V.imports`, `downloadSample`, `(window listener)@890`, `parseCsv`, `handleFile`, `importWizard`, `importCheck`, `importRun`, `undoImport` |
| `src/views/reports.js` | `V.reports` |
| `src/views/scoreboard.js` | `V.scoreboard` |
| `src/views/settings.js` | `V.settings`, `SET`, `SET.team`, `SET.fields`, `SET.import`, `SET.outcomes`, `SET.scoring`, `SET.data`, `SET.about`, `saveTeamName`, `saveBuiltInFields`, `saveImportCfg`, `statusForm`, `moveStatus`, `deleteStatus`, `saveSettings`, `outcomeForm`, `fieldForm`, `fieldTypeChanged`, `toggleField`, `moveField`, `deleteField`, `saveColumns`, `SET.pipelines` |
| `src/views/audit.js` | `V.audit` |
| `src/views/admin.js` | `ADMIN_TABS`, `adminTabs`, `canAdmin`, `V.admin`, `ADM`, `lastActivityOf`, `ADM.users`, `userDlg`, `saveUser`, `setUserTeams`, `deactivate`, `toggleMember`, `resetPasswordDlg`, `userActivity`, `setRole`, `inviteDlg`, `acceptInvite`, `ADM.roles`, `permsSetAll`, `permsCopyFrom`, `savePermissions`, `resetPermissions`, `roleDlg`, `deleteRole`, `TEAM_COLORS`, `ADM.teams`, `teamDlg`, `teamLogoPick`, `archiveTeam`, `restoreTeam`, `teamPerf` |
| `src/views/crm.js` | `V.crm`, `swipeX`, `swipeStart`, `swipeEnd`, `crmPickLead` |
| `src/views/deal.js` | `dealTimeline`, `V.deal` |
| `src/views/crmdash.js` | `V.crmdash` |
| `src/main.js` | `draw` |

**Total original declarations ported: 332**

## Known deviations from pure mechanical porting

- **`core/session.js`: added `export function setMe(m){ me = m; }`.** Not present in the original. In the monolith, every function shared one global scope and could reassign `me` directly (e.g. on sign-out, sign-in, backup restore, and initial-load restore-of-last-user). ES modules only allow the *owning* module to reassign its own exported `let` binding, so `data/persist.js` (backup restore) and `main.js` (restoring the last signed-in user on load) now call `setMe(...)` instead of assigning `me` directly. Behavior is identical; this is purely a module-boundary accommodation, not a feature change.
- **`main.js`: `window.db` and `window.me` are exposed via `Object.defineProperty(window, ..., { get: () => ..., configurable: true })`** rather than a plain `Object.assign(window, {db, me})` snapshot. The original demo's rendered HTML contains `onclick="..."` strings that reference `db.xxx` directly (about 10 call sites, mostly admin "reset to defaults" actions), and both `db` and `me` are reassigned wholesale by `core/session.js`'s `setMe()` (sign-in, sign-out, backup restore, initial-load restore-of-last-user). A one-time `Object.assign` snapshot would leave `window.db`/`window.me` stale after the first sign-in or restore; the getters keep them live. Verified with a headless-browser pass: before this fix `window.me` stayed `null` forever after the very first sign-in even though the app's own internal state (which never goes through `window`) was correct.
- **`main.js`: added explicit side-effect-only imports for `views/audit.js`, `views/crmdash.js`, `views/dashboard.js`, `views/followups.js`, `views/lead.js`, `views/reports.js`, `views/scoreboard.js`.** These seven view modules register their route purely as a side effect of being loaded (`V.dashboard = () => {...}`, etc.) and export no name that any other module imports, so nothing was pulling them into the module graph — their routes threw `TypeError: V[state.view] is not a function` on first load. Caught via a headless-browser smoke test (sign in as each seed user, then visit every route) before this stage was called done. Not a deviation the original needed — one global `<script>` scope has no "unreached module" concept — but required here since ES modules only execute when imported.
- **Removed several dozen auto-generated cross-module imports that were never used as real JS-level calls.** The mechanical import scanner (word-boundary text match) was deliberately over-inclusive, including names that only ever appear inside HTML template-literal *text* destined for `onclick="..."` attributes (resolved later through `window.X`, not the module's local import binding) or that happen to collide with unrelated object-literal property keys (e.g. `core/session.js` originally imported `outcome`/`queue` from `features/activity.js`, but only used those words as `state` property keys `outcome:""` / `queueIdx:0`, never as calls). A subset of these unused imports created import cycles that produced real `ReferenceError`-class TDZ failures at load ("Cannot access 'V' before initialization", "Cannot access 'daysAgo' before initialization") — not just harmless dead code — so rather than leave them as originally planned, every import list was re-derived (removing only names never referenced as a genuine identifier in the file's real code, verified against strings and template-literal text separately so nothing referenced inside a real `${...}` expression was touched) and the affected 26 files were updated. Re-verified with `node --check` on all 36 files plus a full headless-browser pass (every route, all 3 seed users, settings tabs, admin tabs, CRM add-to-pipeline + drag-equivalent move, CSV parsing, backup/restore JSON round-trip) showing zero console errors.
- **Cosmetic artifact of automated line-range slicing:** a trailing comment block (`// ============... CRM Pipeline` section header, originally introduced ahead of the CRM code) ended up at the very bottom of `src/data/persist.js` instead of at the top of `src/features/crm.js`, because the automated slicer assigns any trailing comment/blank lines to the end of the preceding block rather than the start of the next one. No code was affected; left as-is per the "don't touch beyond what's needed" rule for this stage.
