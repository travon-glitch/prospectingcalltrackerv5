import { opts } from '../core/dialog.js';
import { fieldLabel, fieldOn } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { go } from '../core/router.js';
import { callQueue } from '../core/queue.js';
import { BACKEND, memberName } from '../core/session.js';
import { TITLES, V, state } from '../core/state.js';
import { statusList } from '../core/statuses.js';
import { $, TODAY, esc, fmtD, fmtDT, pretty, toast } from '../core/util.js';
import { db } from '../data/persist.js';
import { activityForm, attempts, badge, blockMsg, callBtn, canSee, dncBadges, fuDone, fuReschedule, full, hydrateLeadActivity, icon, lastAct, leadActs, leadCampaigns, listNames, nextFu, outcome, textBtn } from '../features/activity.js';
import { campaignPanel, hydrateCampaignCardsForLead } from '../features/campaigns.js';
import { addToCrmBtn } from '../features/crm.js';
import { addToCampaign, addToList, archiveLead, customPanel, reassign } from '../features/leads.js';
import { draw } from '../main.js';

// Stage 5, supabase backend: leads.search() (features/leads.js) only carries
// each row's primary phone and no listIds/custom values — enough for the
// #leads table, not enough for #lead's phone list / list names / custom
// panel. Stage 6 extends the same first-open fetch to the lead's whole
// activity timeline, every follow-up and every note it's allowed to see
// (hydrateLeadActivity(), features/activity.js); Stage 8 adds this lead's
// campaign cards (hydrateCampaignCardsForLead(), features/campaigns.js) the
// same way, so campaignPanel() below — completely unchanged from the local
// backend's own rendering — reads real data too; cached by id so
// re-rendering this page (e.g. after ticking a DNC checkbox) doesn't
// refetch on every draw().
const fullLeadCache = new Set();
function ensureFullLead(id: number){
  if(fullLeadCache.has(id)) return;
  fullLeadCache.add(id);
  Promise.all([hydrateLeadActivity(id), hydrateCampaignCardsForLead(id)]).then(() => draw()).catch(() => toast("Couldn't load lead"));
}

V.lead = () => {
  if(BACKEND==="supabase") ensureFullLead(state.id!);
  const l = db.leads.find(x=>x.id===state.id);
  // RLS already gated which rows leads.search()/leads.get() could ever
  // return, so on the supabase backend a hydrated lead's mere presence in
  // db.leads is proof of visibility — canSee()'s own team-membership check
  // reads db.teams, which nothing in this stage populates from Supabase, so
  // it isn't a reliable second gate here the way it is on the local backend.
  if(!l || (BACKEND!=="supabase" && !canSee(l))) return `<div class="card empty">Lead not found or not assigned to you. <a href="#leads" onclick="go('leads');return false">Back to leads</a></div>`;
  const blocked = blockMsg(l); const acts = leadActs(l); const fus = db.followUps.filter(f=>f.leadId===l.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); const camps = leadCampaigns(l);
  const cq = callQueue();
  const backTo = state.backTo && TITLES[state.backTo] ? state.backTo : "leads";
  const bar = `
    <div class="card queue-bar" style="position:sticky;top:60px;z-index:6;padding:10px 14px;margin-bottom:14px;display:flex;flex-wrap:wrap;align-items:center;gap:10px" data-testid="queue-bar">
      <button class="btn plain sm" onclick="go('${backTo}')" data-testid="queue-back">‹ ${esc(state.queueList ? (db.lists.find(x=>x.id===+state.queueList)?.name || "Queue") : (TITLES[backTo]||"Back"))}</button>
      <span class="badge blue">Prospecting</span>
      <span class="small muted">${cq.i>=0 ? `Lead <b class="b" style="color:var(--ink)">${cq.i+1}</b> of ${cq.q.length}` : "Not in this queue"}</span>
      <span style="flex:1"></span>
      <div class="actions qb-actions">
        ${callBtn(l, l.phones[0]?.n || "", "sm")}
        ${l.phones[0] ? textBtn(l, l.phones[0].n, "sm") : ""}
        <button class="btn tint sm" onclick="document.getElementById('actForm')?.scrollIntoView({behavior:'smooth',block:'center'})" data-testid="queue-log">✎ Log</button>
        <button class="btn tint sm" ${cq.q.length<2?"disabled":""} onclick="queueGo(-1)" data-testid="queue-prev">‹ Previous</button>
        <button class="btn tint sm" ${cq.q.length<2?"disabled":""} onclick="queueSkipToUnworked()" data-testid="queue-skip">Skip</button>
        <button class="btn sm" ${cq.q.length<2?"disabled":""} onclick="queueGo(1)" data-testid="queue-next">Next ›</button>
      </div>
    </div>`;
  const listNamesText = BACKEND==="supabase" ? esc(l._listNamesText||"") : listNames(l).map(esc).join(", ");
  return `${bar}<div class="page-head"><div><h2>${esc(full(l))}</h2><p>${esc(l.addr)}${l.city?", "+esc(l.city):""} ${esc(l.zip)} · ${listNamesText||"no list"} · Assigned to ${esc(memberName(l.assigned))}</p><div style="margin-top:6px">${badge(l)} ${dncBadges(l)} ${camps.map(c=>`<a class="badge blue" href="#campaign/${c.id}" onclick="go('campaign',${c.id});return false">✉ ${esc(c.name)}</a>`).join(" ")}</div></div>
    <div class="actions">${addToCrmBtn(l.id, "")}<button class="btn tint" onclick="go('workspace')" data-testid="start-call-mode">Compact call screen</button><button class="btn tint" onclick="leadForm(db.leads.find(x=>x.id===${l.id}))">Edit</button>${can("reassign")?`<button class="btn tint" onclick="reassign([${l.id}])">Reassign</button>`:""}${can("manageLists")?`<button class="btn tint" onclick="addToList([${l.id}])">Add to list</button>`:""}${can("manageCampaigns")?`<button class="btn tint" onclick="addToCampaign([${l.id}])">Add to campaign</button>`:""}${can("archiveLeads")?`<button class="btn danger tint" onclick="archiveLead(${l.id})">Archive</button>`:""}</div></div>
  ${blocked?`<div class="alert red" style="margin-bottom:16px">⛔ ${blocked}</div>`:""}
  <div class="split"><div class="grid">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h4 style="margin:0">Phone numbers</h4><button class="btn plain sm" onclick="addPhone(${l.id})">+ Add number</button></div>
      ${l.phones.map(p=>`<div class="row-line"><div><span class="mono" style="font-size:17px">${pretty(p.n)}</span> <span class="badge">${p.type}</span></div><div class="actions">${callBtn(l,p.n,"sm")}${textBtn(l,p.n,"sm")}</div></div>`).join("")||'<div class="muted small" style="padding:8px 0">No phone numbers.</div>'}
      <p class="small muted" style="margin:10px 0 0">On an iPhone these open the Phone and Messages apps. Nothing is recorded automatically — log the attempt below.</p></div>
    <div class="card" id="actForm">${activityForm(l)}</div>
    ${leadCampaigns(l).length ? campaignPanel(l) : ""}
    <div class="card"><h4>Notes</h4>${db.notes.filter(n=>n.leadId===l.id && (n.kind!=="manager"||can("managerNotes"))).sort((a,b)=>b.at.localeCompare(a.at)).map(n=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div class="small muted">${esc(memberName(n.userId))} · ${fmtDT(n.at)} ${n.kind==="manager"?'<span class="badge orange">Manager note</span>':""}</div>${esc(n.text)}</div>`).join("")||'<div class="muted small" style="padding:8px 0">No notes yet.</div>'}
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center"><input id="noteIn" placeholder="Add a note…" onkeydown="if(event.key==='Enter')addNote(${l.id})">${can("managerNotes")?`<label class="small" style="white-space:nowrap"><input type="checkbox" id="noteMgr"> Manager-only</label>`:""}<button class="btn" onclick="addNote(${l.id})">Add</button></div></div>
  </div><div class="grid">
    <div class="card"><h4>Status</h4>
      <select onchange="setLeadStatus(${l.id}, this.value)" ${can("editLeads")?"":"disabled"} data-testid="status-select">${opts(statusList().filter(x=>x.active!==false||x.key===l.status).map(x=>[x.key,x.label]), l.status)}</select>
      <p class="small muted" style="margin:8px 0 0">Logging an outcome updates this automatically. Statuses are yours to rename or add in <a href="#settings" onclick="state.setTab='outcomes';go('settings');return false">Settings</a>.</p></div>
    <div class="card"><h4>Details</h4><table>${fieldOn("email")?`<tr><td class="muted">${esc(fieldLabel("email"))}</td><td>${esc(l.email||"—")}</td></tr>`:""}<tr><td class="muted">Source</td><td>${esc(l.source)}</td></tr>${BACKEND==="supabase"?`<tr><td class="muted">Attempts</td><td>${l._attempts||0}</td></tr><tr><td class="muted">Last attempt</td><td>${l._lastAttemptAt?fmtDT(l._lastAttemptAt):"—"}</td></tr><tr><td class="muted">Last outcome</td><td>${l._lastOutcomeId?esc(outcome(l._lastOutcomeId)?.name):"—"}</td></tr><tr><td class="muted">Next follow-up</td><td>${l._nextFollowUpDue?fmtD(l._nextFollowUpDue):"—"}</td></tr>`:`<tr><td class="muted">Attempts</td><td>${attempts(l)}</td></tr><tr><td class="muted">Last attempt</td><td>${lastAct(l)?fmtDT(lastAct(l)!.at):"—"}</td></tr><tr><td class="muted">Last outcome</td><td>${lastAct(l)?esc(outcome(lastAct(l)!.outcomeId)?.name):"—"}</td></tr><tr><td class="muted">Next follow-up</td><td>${nextFu(l)?fmtD(nextFu(l)!.due):"—"}</td></tr>`}<tr><td class="muted">Added</td><td>${fmtD(l.createdAt)}</td></tr></table></div>
    <div class="card"><h4>Your fields</h4>${customPanel(l)}</div>
    <div class="card"><h4>Contact preferences</h4><div class="checks">
      <label><input type="checkbox" ${l.dnc?"checked":""} ${l.dncontact?"disabled":""} onchange="setDnc(db.leads.find(x=>x.id===${l.id}),'dnc',this.checked)"> Do Not Call</label>
      <label><input type="checkbox" ${l.dnt?"checked":""} ${l.dncontact?"disabled":""} onchange="setDnc(db.leads.find(x=>x.id===${l.id}),'dnt',this.checked)"> Do Not Text</label>
      <label><input type="checkbox" ${l.dncontact?"checked":""} onchange="setDnc(db.leads.find(x=>x.id===${l.id}),'dncontact',this.checked)"> Do Not Contact (blocks everything)</label></div>
      <p class="small muted" style="margin:8px 0 0">Blocked actions can't be started or logged. Every change is written to the audit log.</p></div>
    <div class="card"><h4>Follow-ups</h4><ul>${fus.map(f=>`<li class="row-line"><div><b style="color:${f.status==="pending"&&f.due<TODAY?'var(--danger)':'inherit'}">${fmtD(f.due)}</b> <span class="badge ${f.status==="pending"?"blue":f.status==="done"?"green":""}">${f.status}</span><div class="small muted">${esc(f.note||"")}${f.cancelReason?" · "+esc(f.cancelReason):""} · ${esc(memberName(f.assignee))}</div></div>${f.status==="pending"?`<div class="actions"><button class="btn tint sm" onclick="fuDone(${f.id})">Done</button><button class="btn plain sm" onclick="fuReschedule(${f.id})">Reschedule</button></div>`:""}</li>`).join("")||'<li class="muted small">None yet. Add one when you log an attempt.</li>'}</ul></div>
    <div class="card"><h4>Timeline</h4><ul class="timeline">${acts.map(a=>`<li><span class="dot">${icon(a.type)}</span><div><b>${esc(outcome(a.outcomeId)?.name)}</b> <span class="muted small">· ${a.type.replace("_"," ")} by ${esc(memberName(a.userId))}${a.durationMin?` · ${a.durationMin} min`:""}${a.campaignId?` · ${esc(db.campaigns.find(c=>c.id===a.campaignId)?.name)}`:""}</span>${a.note?`<div class="small">${esc(a.note)}</div>`:""}</div><time>${fmtDT(a.at)}</time></li>`).join("")||'<li class="muted small">Never attempted.</li>'}</ul></div>
  </div></div>`;
};
/* ------------------------------------------------------- lead custom values */
