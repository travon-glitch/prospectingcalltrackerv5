// ======================================================================
// Entry point. Wires draw(), initial hash handling and ensureDemoPasswords,
// exactly as the bottom of the original single-file script did.
//
// The original demo ran everything in one global <script> scope, so every
// inline onclick="..." handler in the rendered HTML could call any function
// by name. Splitting into ES modules removes that shared scope, so this file
// re-exposes every function/constant those inline handlers reference as a
// property of `window` (a single Object.assign, as the stage instructions
// require). No handler was rewritten to addEventListener in this stage.
// ======================================================================
import { $, TODAY, addDays, copyText, daysAgo, digits, download, esc, fmtD, fmtDT, isApple, isoDate, normPhone, pad, pretty, prettyRaw, smsHref, toast, todayD } from './core/util.js';
import { ADM, ADMIN_TABS, adminTabs, canAdmin, deleteRole, permsCopyFrom, permsSetAll, resetPermissions, roleDlg, savePermissions } from './views/admin.js';
import { TEAM_COLORS, acceptInvite, archiveTeam, deactivate, inviteDlg, lastActivityOf, resetPasswordDlg, restoreTeam, saveUser, setRole, setUserTeams, teamDlg, teamLogoPick, teamPerf, toggleMember, userActivity, userDlg } from './features/admin.js';
import { ADMIN_BASE, AGENT_BASE, ALL_PERMS, CAPABILITIES, LEGACY_CAP, MANAGER_BASE, PERMISSIONS, PERM_GROUPS, PERM_LABEL, can, canUser, defaultPermissions, defaultRoles, isSuperAdmin, permsFrom, roleName, roleOf, sameTeam } from './core/permissions.js';
import { BUILT_IN_COLUMNS, BUILT_IN_DEFAULT_LABEL, CF_TYPES, CF_TYPE_LABEL, DEFAULT_COLUMNS, RESERVED_KEYS, activeFields, allFields, builtIn, cardFieldsFor, cfClean, cfDisplay, columnChoices, defaultBuiltInFields, fieldLabel, fieldOn, keyFromLabel, keyProblem, money, resolvedColumns, setCustom } from './core/fields.js';
import { CAMPAIGN_TYPES, campaignCard, campaignPanel, campaignText, selectedCampaign, sendingCampaign } from './features/campaigns.js';
import { BACKEND, DEMO_PASSWORD, audit, changePasswordSubmit, checkPassword, ensureDemoPasswords, generatePassword, hashPassword, initials, isMgr, me, memberName, randomSalt, restoreSession, setMe, setPassword, sha256, signIn, signInWithPassword, signOut, teamsOf } from './core/session.js';
import { NAV, callBarMobile, shell, toggleTheme } from './views/shell.js';
import { PAGE, addLeadsToCampaign, addPhone, addToCampaign, addToList, archiveLead, customPanel, filteredLeads, leadForm, reassign, saveCustom, setDnc, setLeadStatus } from './features/leads.js';
import { SAVE_KEY, _saved, backup, db, loadSaved, nid, persist, resetDemo } from './data/persist.js';
import { SET, deleteField, deleteStatus, fieldForm, fieldTypeChanged, moveField, moveStatus, outcomeForm, saveBuiltInFields, saveColumns, saveImportCfg, saveSettings, saveTeamName, statusForm, toggleField } from './views/settings.js';
import { STAGE_COLORS, TEMPS, addStageDlg, addToCrm, addToCrmBtn, archivePipeline, archiveStage, canSeeDeal, crmDeals, crmDefaultFilters, crmExportDlg, crmFilterCount, crmFiltersDlg, daysIn, dealCalls, dealCard, dealFu, dealFuDlg, dealLastContact, dealLead, dealLog, dealMath, dealNoteDlg, dealTexts, dealsFor, defaultStages, deleteStage, dragDeal, dragEnd, dragLeave, dragOver, dragStart, dropOn, exportCrm, fuTone, moveDeal, moveStage, moveStageDlg, newPipeline, num, pct, pipeline, pipelineDlg, pipelines, restorePipeline, restoreStage, setDealField, stageMenu, stageOf, stageOptsFor, stageTotals } from './features/crm.js';
import { STATUS_TONES, defaultStatuses, statusDef, statusLabel, statusList } from './core/statuses.js';
import { TITLES, V, state } from './core/state.js';
import { activityForm, addNote, attempts, badge, blockMsg, callBtn, canSee, cardBody, dncBadges, fuCancel, fuDone, fuReschedule, fuSnooze, full, icon, isBlocked, lastAct, leadActs, leadCampaigns, listNames, logActivity, nextFu, outcome, refreshForm, renderTpl, saveActivity, textBtn, visibleLeads } from './features/activity.js';
import { addLeadsDlg, archiveCampaign, campaignForm, deleteTemplate, duplicateCampaign, editCard, logReply, markAllDraftsReady, markSent, msgCard, removeCard, templateForm, templatesDlg, useCampaignTemplate } from './views/campaigns.js';
import { archiveList, assignList, listForm, listToCampaign, removeFromList } from './views/lists.js';
import { bulkArchive, filterCount, leadCell, toggleAll, toggleFilters, toggleSel } from './views/leads.js';
import { clearFilters, go, openInCallMode, redrawKeepFocus, setF } from './core/router.js';
import { callQueue, queue, queueGo, queueSkipToUnworked } from './core/queue.js';
import { closeDlg, confirmDlg, field, listOpts, memberOpts, openDlg, opts } from './core/dialog.js';
import { crmPickLead, swipeEnd, swipeStart, swipeX } from './views/crm.js';
import { csvCell, exportCsv } from './features/exports.js';
import { dealTimeline } from './views/deal.js';
import { importWizard } from './views/imports.js';
import { downloadSample, handleFile, importCheck, importRun, parseCsv, undoImport } from './features/imports.js';
import { inRange, monthRange, pace, rangeFor, stats, weekRange } from './features/stats.js';
import { loginScreen } from './views/login.js';
import { moreInfo, pickNumber } from './views/workspace.js';
import { seed } from './data/seed.js';
import { upgradeDb } from './data/upgrade.js';
// These view modules register their view (V.xxx = ...) purely as a side
// effect of being loaded; nothing else imports a named export from them, so
// without an explicit import here they'd never run and their routes would
// 404 inside the app. Not present in the original (one global scope needed
// no such wiring) — required only because ES modules load lazily.
import './views/audit.js';
import './views/crmdash.js';
import './views/dashboard.js';
import './views/followups.js';
import './views/lead.js';
import './views/reports.js';
import './views/scoreboard.js';

export function draw(): void { persist(); if(!me){ $("#app").innerHTML=loginScreen(); return; } if(!V[state.view]) state.view="dashboard"; let content; try { content = V[state.view](); } catch(e){ console.error(e); content = `<div class="card"><h4>Something went wrong on this screen</h4><p class="small muted">${esc((e as Error).message)}</p><button class="btn tint sm" onclick="go('dashboard')">Back to dashboard</button></div>`; } $("#app").innerHTML = shell(content); }

// Expose everything the rendered HTML's inline event handlers call by name.
Object.assign(window, {
  $, ADM, ADMIN_BASE, ADMIN_TABS, AGENT_BASE, ALL_PERMS, BUILT_IN_COLUMNS, BUILT_IN_DEFAULT_LABEL,
  CAMPAIGN_TYPES, CAPABILITIES, CF_TYPES, CF_TYPE_LABEL, DEFAULT_COLUMNS, DEMO_PASSWORD, LEGACY_CAP, MANAGER_BASE,
  NAV, PAGE, PERMISSIONS, PERM_GROUPS, PERM_LABEL, RESERVED_KEYS, SAVE_KEY, SET,
  STAGE_COLORS, STATUS_TONES, TEAM_COLORS, TEMPS, TITLES, TODAY, V, _saved,
  acceptInvite, activeFields, activityForm, addDays, addLeadsDlg, addLeadsToCampaign, addNote, addPhone,
  addStageDlg, addToCampaign, addToCrm, addToCrmBtn, addToList, adminTabs, allFields, archiveCampaign,
  archiveLead, archiveList, archivePipeline, archiveStage, archiveTeam, assignList, attempts, audit,
  backup, badge, blockMsg, builtIn, bulkArchive, callBarMobile, callBtn, callQueue,
  campaignCard, campaignForm, campaignPanel, campaignText, can, canAdmin, canSee, canSeeDeal,
  canUser, cardBody, cardFieldsFor, cfClean, cfDisplay, changePasswordSubmit, checkPassword, clearFilters,
  closeDlg, columnChoices, confirmDlg, copyText, crmDeals, crmDefaultFilters, crmExportDlg, crmFilterCount,
  crmFiltersDlg, crmPickLead, csvCell, customPanel, daysAgo, daysIn, deactivate, dealCalls,
  dealCard, dealFu, dealFuDlg, dealLastContact, dealLead, dealLog, dealMath, dealNoteDlg,
  dealTexts, dealTimeline, dealsFor, defaultBuiltInFields, defaultPermissions, defaultRoles, defaultStages, defaultStatuses,
  deleteField, deleteRole, deleteStage, deleteStatus, deleteTemplate, digits, dncBadges, download,
  downloadSample, dragDeal, dragEnd, dragLeave, dragOver, dragStart, draw, dropOn,
  duplicateCampaign, editCard, ensureDemoPasswords, esc, exportCrm, exportCsv, field, fieldForm,
  fieldLabel, fieldOn, fieldTypeChanged, filterCount, filteredLeads, fmtD, fmtDT, fuCancel,
  fuDone, fuReschedule, fuSnooze, fuTone, full, generatePassword, go, handleFile,
  hashPassword, icon, importCheck, importRun, importWizard, inRange, initials, inviteDlg,
  isApple, isBlocked, isMgr, isSuperAdmin, isoDate, keyFromLabel, keyProblem, lastAct,
  lastActivityOf, leadActs, leadCampaigns, leadCell, leadForm, listForm, listNames, listOpts,
  listToCampaign, loadSaved, logActivity, logReply, loginScreen, markAllDraftsReady, markSent, memberName,
  memberOpts, money, monthRange, moreInfo, moveDeal, moveField, moveStage, moveStageDlg,
  moveStatus, msgCard, newPipeline, nextFu, nid, normPhone, num, openDlg,
  openInCallMode, opts, outcome, outcomeForm, pace, pad, parseCsv, pct,
  permsCopyFrom, permsFrom, permsSetAll, persist, pickNumber, pipeline, pipelineDlg, pipelines,
  pretty, prettyRaw, queue, queueGo, queueSkipToUnworked, randomSalt, rangeFor, reassign,
  redrawKeepFocus, refreshForm, removeCard, removeFromList, renderTpl, resetDemo, resetPasswordDlg, resetPermissions,
  resolvedColumns, restorePipeline, restoreStage, restoreTeam, roleDlg, roleName, roleOf, sameTeam, saveActivity,
  saveBuiltInFields, saveColumns, saveCustom, saveImportCfg, savePermissions, saveSettings, saveTeamName, saveUser,
  seed, selectedCampaign, sendingCampaign, setCustom, setDealField, setDnc, setF, setLeadStatus,
  setPassword, setRole, setUserTeams, sha256, shell, signIn, signInWithPassword, signOut,
  smsHref, stageMenu, stageOf, stageOptsFor, stageTotals, state, stats, statusDef,
  statusForm, statusLabel, statusList, swipeEnd, swipeStart, swipeX, teamDlg, teamLogoPick,
  teamPerf, teamsOf, templateForm, templatesDlg, textBtn, toast, todayD, toggleAll,
  toggleField, toggleFilters, toggleMember, toggleSel, toggleTheme, undoImport, upgradeDb, useCampaignTemplate, userActivity,
  // @ts-expect-error TS1117: `draw` is already listed above (after dragStart). The duplicate shorthand is harmless at runtime (same binding, last one wins) and is left in place because this conversion must not touch runtime code.
  userDlg, visibleLeads, weekRange, draw
});
// `db` is reassigned wholesale on backup restore (data/persist.js), so it is
// exposed as a live getter rather than a one-time snapshot, or window.db would
// go stale the moment a backup is restored. `me` is reassigned on every
// sign-in/sign-out/restore (core/session.js's setMe), so it needs the same
// treatment or window.me would freeze at whatever it was on initial load.
// No inline onclick="..." in the rendered HTML reads window.db or window.me
// directly today except the handful of db.xxx admin "reset" actions already
// covered by the db getter, but keeping both live avoids a silent trap.
Object.defineProperty(window, 'db', { get: () => db, configurable: true });
Object.defineProperty(window, 'me', { get: () => me, configurable: true });

// Stage 0's boot was a plain synchronous IIFE (session restore was just
// reading data/persist.js's own _saved.meId). Stage 3 adds a second,
// inherently async restore path for the Supabase backend (asking Supabase
// for its persisted session), so this became an async function — but the
// local-backend path below is byte-identical to Stage 0's, still fully
// synchronous in practice, so VITE_BACKEND=local (or no Vite at all) never
// waits on anything new here.
(async function(){
  if(BACKEND === "supabase"){ await restoreSession(); }
  else if(_saved?.meId){ setMe(db.members.find(m=>m.id===_saved!.meId) || null); }
  const [v,id]=location.hash.slice(1).split("/"); if(v && V[v]){ state.view=v; state.id=id?+id:null; if(v==="lead") state.callMode=true; }
  draw();
})();
ensureDemoPasswords();
