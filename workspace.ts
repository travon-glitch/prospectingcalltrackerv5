import { listOpts, openDlg, opts } from '../core/dialog.js';
import { fieldLabel, fieldOn } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { queue } from '../core/queue.js';
import { BACKEND, memberName } from '../core/session.js';
import { V, state } from '../core/state.js';
import { statusList } from '../core/statuses.js';
import { $, TODAY, esc, fmtD, fmtDT, pretty, smsHref, toast } from '../core/util.js';
import { db } from '../data/persist.js';
import { activityForm, attempts, badge, blockMsg, callBtn, dncBadges, fuDone, fuReschedule, full, hydrateLeadActivity, icon, isBlocked, lastAct, leadActs, leadCampaigns, listNames, nextFu, outcome, renderTpl, textBtn } from '../features/activity.js';
import { campaignCard, campaignPanel, campaignText, hydrateCampaignCardsForLead, selectedCampaign } from '../features/campaigns.js';
import { addToCrmBtn } from '../features/crm.js';
import { customPanel } from '../features/leads.js';
import { draw } from '../main.js';
import type { Lead } from '../types.js';

// Stage 7, supabase backend: #workspace's card and "More information" panel
// (moreInfo(), just below) both read a lead's full timeline/follow-ups/notes
// (leadActs()/db.followUps/db.notes) and its lists (listNames()) — none of
// which leads.search() carries (Stage 5's mapSearchRow() only derives
// _attempts/_lastOutcomeId/_nextFollowUpDue/_listNamesText for the #leads
// table). So the queue's current lead gets the exact same first-open fetch
// #lead/:id already uses (hydrateLeadActivity(), Stage 6), cached by id so
// paging through the queue only fetches each lead once, not on every draw().
// Until that resolves, the "_"-prefixed fields already on the row (from
// core/queue.js's own leads.search() fetch) stand in — same fallback shape
// views/leads.js's leadCell() and views/lead.js already use.
const wsLeadCache = new Set();
function ensureWorkspaceLeadLoaded(id: number){
  if(BACKEND!=="supabase" || wsLeadCache.has(id)) return;
  wsLeadCache.add(id);
  Promise.all([hydrateLeadActivity(id), hydrateCampaignCardsForLead(id)]).then(() => draw()).catch(() => toast("Couldn't load lead"));
}
const wsAttempts = (l: Lead) => BACKEND==="supabase" ? (l._attempts||0) : attempts(l);
const wsLastOutcomeName = (l: Lead) => BACKEND==="supabase" ? (l._lastOutcomeId ? outcome(l._lastOutcomeId)?.name : null) : (lastAct(l) ? outcome(lastAct(l)!.outcomeId)?.name : null);
const wsListNames = (l: Lead) => BACKEND==="supabase" ? (l._listNamesText||"").split(", ").filter(Boolean) : listNames(l);

export function moreInfo(l: Lead){
  const acts = leadActs(l); const fus = db.followUps.filter(f=>f.leadId===l.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return `<div class="card" data-testid="ws-more">
    <div style="display:flex;justify-content:space-between;align-items:center"><h4 style="margin:0">All phone numbers</h4><button class="btn plain sm" onclick="addPhone(${l.id})">+ Add number</button></div>
    ${l.phones.map(p=>`<div class="row-line"><div><span class="mono" style="font-size:17px">${pretty(p.n)}</span> <span class="badge">${p.type}</span></div><div class="actions">${callBtn(l,p.n,"sm")}${textBtn(l,p.n,"sm",leadCampaigns(l).length?campaignText(l,selectedCampaign(l)!):"")}</div></div>`).join("")||'<div class="muted small" style="padding:8px 0">No phone numbers.</div>'}
    <h4 style="margin-top:16px">Property &amp; details</h4>
    <table><tr><td class="muted">Address</td><td>${esc(l.addr)}${l.city?", "+esc(l.city):""} ${esc(l.zip)}</td></tr>${fieldOn("email")?`<tr><td class="muted">${esc(fieldLabel("email"))}</td><td>${esc(l.email||"—")}</td></tr>`:""}<tr><td class="muted">Source</td><td>${esc(l.source)}</td></tr><tr><td class="muted">Lists</td><td>${wsListNames(l).map(esc).join(", ")||"—"}</td></tr><tr><td class="muted">Assigned to</td><td>${esc(memberName(l.assigned))}</td></tr><tr><td class="muted">Attempts</td><td>${wsAttempts(l)}</td></tr><tr><td class="muted">Last outcome</td><td>${wsLastOutcomeName(l)?esc(wsLastOutcomeName(l)):"—"}</td></tr><tr><td class="muted">Added</td><td>${fmtD(l.createdAt)}</td></tr></table>
    <h4 style="margin-top:16px">Your fields</h4>${customPanel(l)}
    <h4 style="margin-top:16px">Status</h4>
    <select onchange="setLeadStatus(${l.id}, this.value)" ${can("editLeads")?"":"disabled"}>${opts(statusList().filter(x=>x.active!==false||x.key===l.status).map(x=>[x.key,x.label]), l.status)}</select>
    <h4 style="margin-top:16px">Follow-ups</h4><ul>${fus.map(f=>`<li class="row-line"><div><b style="color:${f.status==="pending"&&f.due<TODAY?'var(--danger)':'inherit'}">${fmtD(f.due)}</b> <span class="badge ${f.status==="pending"?"blue":f.status==="done"?"green":""}">${f.status}</span><div class="small muted">${esc(f.note||"")} · ${esc(memberName(f.assignee))}</div></div>${f.status==="pending"?`<div class="actions"><button class="btn tint sm" onclick="fuDone(${f.id})">Done</button><button class="btn plain sm" onclick="fuReschedule(${f.id})">Reschedule</button></div>`:""}</li>`).join("")||'<li class="muted small">None yet.</li>'}</ul>
    <h4 style="margin-top:16px">All notes</h4>${db.notes.filter(n=>n.leadId===l.id && (n.kind!=="manager"||can("managerNotes"))).sort((a,b)=>b.at.localeCompare(a.at)).map(n=>`<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div class="small muted">${esc(memberName(n.userId))} · ${fmtDT(n.at)} ${n.kind==="manager"?'<span class="badge orange">Manager note</span>':""}</div>${esc(n.text)}</div>`).join("")||'<div class="muted small">No notes yet.</div>'}
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center"><input id="noteIn" placeholder="Add a note…" onkeydown="if(event.key==='Enter')addNote(${l.id})"><button class="btn" onclick="addNote(${l.id})">Add</button></div>
    <h4 style="margin-top:16px">Full timeline</h4><ul class="timeline">${acts.map(a=>`<li><span class="dot">${icon(a.type)}</span><div><b>${esc(outcome(a.outcomeId)?.name)}</b> <span class="muted small">· ${a.type.replace("_"," ")} by ${esc(memberName(a.userId))}${a.durationMin?` · ${a.durationMin} min`:""}${a.campaignId?` · ${esc(db.campaigns.find(c=>c.id===a.campaignId)?.name)}`:""}</span>${a.note?`<div class="small">${esc(a.note)}</div>`:""}</div><time>${fmtDT(a.at)}</time></li>`).join("")||'<li class="muted small">Never attempted.</li>'}</ul>
  </div>`;
}

V.workspace = () => {
  const q = queue();
  const controls = `<div class="actions"><select style="width:auto" onchange="state.queueList=this.value;state.queueIdx=0;draw()">${listOpts(state.queueList,"All my lists")}</select><span class="seg">${[["all","All"],["fresh","Never attempted"],["due","Follow-ups due"]].map(([k,t])=>`<button class="${(state.queueMode||"all")===k?"on":""}" onclick="state.queueMode='${k}';state.queueIdx=0;draw()">${t}</button>`).join("")}</span>${can("viewAllLeads")?`<label class="small"><input type="checkbox" ${state.queueMine===false?"":"checked"} onchange="state.queueMine=this.checked;state.queueIdx=0;draw()"> Only my leads</label>`:""}</div>`;
  if(!q.length) return `<div class="page-head"><div><h2>Workspace</h2><p>Nothing in this queue</p></div>${controls}</div><div class="card empty">No leads match this queue. Try another list or filter, or ask a manager to assign leads to you.</div>`;
  state.queueIdx = Math.min(state.queueIdx, q.length-1); const l = q[state.queueIdx]; ensureWorkspaceLeadLoaded(l.id); const blocked = blockMsg(l); const p = l.phones[0]; const camps = leadCampaigns(l); const acts = leadActs(l).slice(0,4); const fu = nextFu(l);
  const camp = selectedCampaign(l); const msg = camp ? (campaignCard(l,camp)?.body ?? camp.body) : null;
  return `<div class="page-head"><div><h2>Workspace</h2><p>Lead ${state.queueIdx+1} of ${q.length}</p></div>${controls}</div>
  <div class="actions" style="margin-bottom:14px"><button class="btn tint" ${state.queueIdx===0?"disabled":""} onclick="state.queueIdx--;draw()">‹ Previous</button><button class="btn tint" onclick="state.queueIdx=(state.queueIdx+1)%${q.length};draw()">Skip</button><button class="btn" onclick="state.queueIdx=(state.queueIdx+1)%${q.length};draw()">Next ›</button><span class="muted small">Skip leaves the lead untouched; saving an attempt moves to the next lead.</span></div>
  <div class="split"><div class="grid">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div style="font-size:24px;font-weight:700">${esc(full(l))}</div><div class="muted">${esc(l.addr)}${l.city?", "+esc(l.city):""} ${esc(l.zip)}</div><div style="margin-top:6px">${badge(l)} ${dncBadges(l)} ${wsListNames(l).map(n=>`<span class="badge">${esc(n)}</span>`).join(" ")} ${camps.map(c=>`<span class="badge blue">✉ ${esc(c.name)}</span>`).join(" ")}</div>${fu?`<div class="small" style="margin-top:6px;color:${fu.due<TODAY?'var(--danger)':'var(--warning)'}">◷ Follow-up ${fu.due<TODAY?"overdue":"due"} ${fmtD(fu.due)}${fu.note?" · "+esc(fu.note):""}</div>`:""}</div><div style="text-align:right">${addToCrmBtn(l.id)} <button class="btn tint sm" onclick="state.wsMore=!state.wsMore;draw()" data-testid="ws-more-toggle">${state.wsMore?"Less information ▴":"More information ▾"}</button><div style="margin-top:6px"><a class="small" href="#lead/${l.id}" onclick="openInCallMode(${l.id});return false" data-testid="open-lead">Open full lead page ›</a></div></div></div>
      ${blocked?`<div class="alert red" style="margin-top:14px">⛔ ${blocked}</div>`:""}
      ${p?`<div class="actions" style="margin-top:16px">${callBtn(l,p.n,"lg").replace("☎ Call","☎ Call "+pretty(p.n))}${camp && !isBlocked(l,"text") ? `<a class="btn tint lg" href="sms:${p.n}" data-testid="sms-link" onclick="this.href=smsHref('${p.n}',${JSON.stringify(renderTpl(msg,l)).replace(/"/g,"&quot;")});sendingCampaign(${l.id},${camp.id})">✉ Text</a>` : textBtn(l,p.n,"lg")}${l.phones.length>1?`<button class="btn plain lg" onclick="pickNumber(${l.id})">${l.phones.length} numbers ▾</button>`:""}</div>`:'<div class="alert gray" style="margin-top:14px">No phone number on file — add one from the lead page.</div>'}</div>
    <div class="card" id="actForm">${activityForm(l)}</div>
    ${state.wsMore ? moreInfo(l) : ""}
    <div class="alert gray small">You are responsible for following applicable calling, texting, consent, identification, contact-hour and do-not-contact requirements. This app does not guarantee legal compliance.</div>
  </div><div class="grid">
    ${campaignPanel(l)}
    <div class="card"><h4>Notes</h4>${db.notes.filter(n=>n.leadId===l.id&&(n.kind!=="manager"||can("managerNotes"))).slice(-3).map(n=>`<div class="small" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="muted">${esc(memberName(n.userId))}:</span> ${esc(n.text)}</div>`).join("")||'<div class="muted small">No notes.</div>'}</div>
    <div class="card"><h4>Recent activity</h4><ul class="timeline">${acts.map(a=>`<li><span class="dot">${icon(a.type)}</span><div><b>${esc(outcome(a.outcomeId)?.name)}</b><div class="small muted">${esc(memberName(a.userId))}${a.note?" · "+esc(a.note):""}</div></div><time>${fmtDT(a.at)}</time></li>`).join("")||'<li class="muted small">Never attempted.</li>'}</ul></div>
    <div class="card"><h4>Up next</h4><ul>${q.slice(state.queueIdx+1,state.queueIdx+6).map((n,i)=>`<li class="row-line"><span class="muted small">${state.queueIdx+i+2}</span><span style="flex:1;margin-left:8px">${esc(full(n))}</span><span class="muted small">${wsAttempts(n)} att.</span></li>`).join("")||'<li class="muted small">End of queue.</li>'}</ul></div>
  </div></div>`;
};
export function pickNumber(id: number){ const l=db.leads.find(x=>x.id===id)!; openDlg(`<div class="body"><h3>Choose a number</h3>${l.phones.map(p=>`<div class="row-line"><div><span class="mono" style="font-size:17px">${pretty(p.n)}</span> <span class="badge">${p.type}</span></div><div class="actions">${callBtn(l,p.n,"sm")}${textBtn(l,p.n,"sm")}</div></div>`).join("")}</div><div class="foot"><button class="btn plain" onclick="closeDlg()">Close</button></div>`); }
