import { closeDlg, field, memberOpts, openDlg, opts } from '../core/dialog.js';
import { cfDisplay } from '../core/fields.js';
import { can, sameTeam } from '../core/permissions.js';
import { callQueue, queue } from '../core/queue.js';
import { BACKEND, audit, me } from '../core/session.js';
import { state } from '../core/state.js';
import { statusDef } from '../core/statuses.js';
import { $, TODAY, addDays, esc, fmtD, pretty, smsHref, toast } from '../core/util.js';
import { db, nid } from '../data/persist.js';
import { activities as repoActivities, followUps as repoFollowUps, leads as repoLeads, notes as repoNotes } from '../data/repo-supabase.js';
import { hydrateLead, reassign } from './leads.js';
import { draw } from '../main.js';
import type { Activity, Campaign, CampaignLead, FollowUp, Lead, Outcome } from '../types.js';

/** The lead fields a message template can merge in — a full Lead, a LeadPartial, or the campaign preview's blank stand-in. */
type TplLead = Pick<Lead, 'first' | 'last'> & Partial<Pick<Lead, 'addr' | 'city' | 'zip' | 'custom'>>;
type BlockFlags = Pick<Lead, 'dnc' | 'dnt' | 'dncontact'>;

export const full = (l: Pick<Lead, 'first' | 'last'>): string => `${l.first} ${l.last}`.trim();
// Stage 14 fix: visibleLeads() used to only ever show a lead assigned to
// the viewer themself (or every lead with viewAllLeads) — a manager with
// viewTeamLeads but not viewAllLeads couldn't see leads assigned to their
// own teammates here, even though canSee() (right below, and everywhere
// else that checks "can this person see this one lead") already granted
// it. Both now share the exact same three-way check.
export const visibleLeads = (): Lead[] => db.leads.filter(l => !l.archived && canSee(l));
export const canSee = (l: Pick<Lead, 'assigned'>): boolean => can("viewAllLeads") || l.assigned===me!.id || (can("viewTeamLeads") && sameTeam(l.assigned));
export const outcome = (id: number | null | undefined): Outcome | undefined => db.outcomes.find(o=>o.id===id);
export const leadActs = (l: Pick<Lead, 'id'>): Activity[] => db.activities.filter(a=>a.leadId===l.id).sort((a,b)=>b.at.localeCompare(a.at));
export const attempts = (l: Pick<Lead, 'id'>): number => leadActs(l).filter(a=>a.type!=="reply").length;
export const lastAct = (l: Pick<Lead, 'id'>): Activity | null => leadActs(l).find(a=>a.type!=="reply") || null;
export const nextFu = (l: Pick<Lead, 'id'>): FollowUp | null => db.followUps.filter(f=>f.leadId===l.id && f.status==="pending").sort((a,b)=>a.due.localeCompare(b.due))[0] || null;
export const blockMsg = (l: BlockFlags): string => l.dncontact ? "Do Not Contact — calling, texting and door knocks are blocked." : l.dnc && l.dnt ? "Do Not Call and Do Not Text are set." : l.dnc ? "Do Not Call is set — calling is blocked (texting is still allowed)." : l.dnt ? "Do Not Text is set — texting is blocked (calling is still allowed)." : "";
export const badge = (l: Pick<Lead, 'status'>): string => { const d = statusDef(l.status); return `<span class="badge ${d.tone||""}">${esc(d.label)}</span>`; };
export const dncBadges = (l: BlockFlags): string => (l.dncontact ? '<span class="badge red">Do Not Contact</span> ' : "") + (l.dnc && !l.dncontact ? '<span class="badge red">DNC</span> ' : "") + (l.dnt && !l.dncontact ? '<span class="badge orange">DNT</span>' : "");
export const listNames = (l: Pick<Lead, 'listIds'>): string[] => l.listIds.map(id=>db.lists.find(x=>x.id===id)?.name).filter(Boolean) as string[];
export const leadCampaigns = (l: Pick<Lead, 'id'>): Campaign[] => db.campaignLeads.filter(c=>c.leadId===l.id).map(c=>db.campaigns.find(x=>x.id===c.campaignId)).filter(c=>c && !c.archived) as Campaign[];
export function renderTpl(tpl: string | null | undefined, l: TplLead): string {
  const m: Record<string, string | undefined> = {first_name:l.first, last_name:l.last, full_name:full(l), address:l.addr, city:l.city, zip:l.zip, agent_name:db.settings.agentName, team_name:db.settings.teamName};
  // the team's own fields are merge fields too: {{listing_price}} and friends
  for(const f of (db.customFields||[])) if(f.active) m[f.key] = cfDisplay(f, (l.custom||{})[f.key]);
  return String(tpl||"").replace(/{{\s*(\w+)\s*}}/g,(_,k: string)=> m[k] !== undefined ? m[k]! : `{{${k}}}`);
}
export function cardBody(c: Pick<CampaignLead, 'leadId' | 'campaignId' | 'body'>): string { const l = db.leads.find(x=>x.id===c.leadId); const camp = db.campaigns.find(x=>x.id===c.campaignId); return renderTpl(c.body ?? camp!.body, l!); }
export function isBlocked(l: BlockFlags, type: string): boolean { return type==="call" ? (l.dnc||l.dncontact) : type==="text" ? (l.dnt||l.dncontact) : type==="door_knock" ? l.dncontact : false; }

// Stage 6, supabase backend only: additive hydration helpers, same shape as
// features/leads.js's hydrateLead() — merge a fetched row into the local
// array by id (replacing a stale copy, or appending one never seen before)
// so existing renderers (leadActs()/nextFu()/badge()/V.lead()/
// views/followups.js's V.followups(), all completely unchanged below and
// in the view files) keep reading db.activities/db.followUps/db.notes
// exactly like the local backend always has.
export function hydrateFollowUp(row: FollowUp): FollowUp {
  const existing = db.followUps.find(x=>x.id===row.id);
  if(existing) Object.assign(existing, row);
  else db.followUps.push(row);
  return existing || db.followUps[db.followUps.length-1];
}
async function refreshLead(leadId: number): Promise<void> { const row = await repoLeads.get(leadId); if(row) hydrateLead(row); }
async function refreshActivities(leadId: number): Promise<void> { const acts = await repoActivities.forLead(leadId); db.activities = db.activities.filter(a=>a.leadId!==leadId).concat(acts); }
async function refreshFollowUpsFor(leadId: number): Promise<void> { const fus = await repoFollowUps.forLead(leadId); db.followUps = db.followUps.filter(f=>f.leadId!==leadId).concat(fus); }
async function refreshNotes(leadId: number): Promise<void> { const ns = await repoNotes.forLead(leadId); db.notes = db.notes.filter(n=>n.leadId!==leadId).concat(ns); }
/** #lead/:id's first open on the supabase backend (called from
 * views/lead.js, extending Stage 5's own lead-only fetch): the lead's full
 * record, its whole activity timeline, every follow-up (any status) and
 * every note it's allowed to see, all in one go. */
export async function hydrateLeadActivity(leadId: number): Promise<void> {
  await Promise.all([refreshLead(leadId), refreshActivities(leadId), refreshFollowUpsFor(leadId), refreshNotes(leadId)]);
}

// working-day pace
export function logActivity(leadId: number, type: string, outcomeId: number | null, {note="", fuDate="", fuNote="", duration=null, campaignId=null, phone=null}: { note?: string; fuDate?: string; fuNote?: string; duration?: number | string | null; campaignId?: number | null; phone?: string | null }={}): boolean {
  const l = db.leads.find(x=>x.id===leadId)!; const oc = outcome(outcomeId);
  if(type!=="reply" && isBlocked(l, type)) { toast("That action is blocked for this lead"); return false; }
  const listId = state.queueList ? +state.queueList : (l.listIds[0] ?? null);
  db.activities.unshift({id:nid(), leadId, type, outcomeId, userId:me!.id, at:new Date().toISOString(), note, listId, campaignId, durationMin: duration?+duration:null, phone});
  if(type==="reply" && phone){ const p=l.phones.find(p=>p.n===phone); if(p) p.type="mobile"; }
  if(oc?.dnc){ l.dnc=true; l.status="do_not_call"; }
  else if(oc?.appt) l.status="appointment";
  else if(oc?.conv) l.status="contacted";
  else if(l.status==="new") l.status="attempted";
  // a new follow-up replaces the pending one
  if(fuDate){ db.followUps.forEach(f=>{ if(f.leadId===leadId && f.status==="pending"){ f.status="cancelled"; f.cancelReason="Replaced by a newer follow-up"; } }); db.followUps.push({id:nid(), leadId, due:fuDate, status:"pending", note:fuNote||note, assignee:l.assigned||me!.id, createdAt:new Date().toISOString()}); }
  if(oc?.dnc){ db.followUps.forEach(f=>{ if(f.leadId===leadId && f.status==="pending"){ f.status="cancelled"; f.cancelReason="Lead marked Do Not Call"; } }); }
  audit("logged", "activities", `${type.replace("_"," ")} · ${oc?.name} · ${full(l)}`);
  return true;
}
export const icon = (t: string): string => t==="call"?"☎":t==="text"?"✉":t==="reply"?"↩":t==="door_knock"?"🚪":"✉";

export function callBtn(l: BlockFlags, n: string, size=""): string { const off = isBlocked(l,"call") || !can("makeCalls"); return `<a class="btn success ${size} ${off?"off":""}" href="tel:${n}" data-testid="call-link" ${off?`onclick="event.preventDefault();toast('Calling is blocked for this lead')"`:""}>☎ Call</a>`; }
export function textBtn(l: BlockFlags, n: string, size="", body=""): string { const off = isBlocked(l,"text") || !can("sendTexts"); return `<a class="btn tint ${size} ${off?"off":""}" href="sms:${n}" data-testid="sms-link" ${off?`onclick="event.preventDefault();toast('Texting is blocked for this lead')"`:`onclick="this.href=smsHref('${n}',${JSON.stringify(body).replace(/"/g,"&quot;")})"`}>✉ Text</a>`; }
export function addNote(leadId: number): void {
  if(!can("addNotes")) return toast("Adding notes is turned off for your role");
  const v=$("#noteIn").value.trim(); if(!v) return;
  const kind = $("#noteMgr")?.checked ? "manager" : "quick";
  if(BACKEND==="supabase"){
    repoNotes.create(leadId, v, kind).then(row=>{ db.notes.push(row); toast("Note added"); draw(); }).catch(e=>toast(e.message));
    return;
  }
  db.notes.push({id:nid(),leadId,userId:me!.id,at:new Date().toISOString(),text:v,kind}); audit("created","notes",full(db.leads.find(x=>x.id===leadId)!)); toast("Note added"); draw();
}
export function fuDone(id: number): void {
  const f=db.followUps.find(x=>x.id===id)!;
  if(BACKEND==="supabase"){
    repoFollowUps.done(id).then(()=>{ f.status="done"; f.doneAt=new Date().toISOString(); toast("Follow-up done"); draw(); }).catch(e=>toast(e.message));
    return;
  }
  f.status="done"; f.doneAt=new Date().toISOString(); audit("completed","follow_ups",full(db.leads.find(x=>x.id===f.leadId)!)); toast("Follow-up done"); draw();
}
export function fuSnooze(id: number, days: number): void {
  const f=db.followUps.find(x=>x.id===id)!;
  const due = addDays(f.due<TODAY?TODAY:f.due, days);
  if(BACKEND==="supabase"){
    repoFollowUps.snooze(id, due).then(()=>{ f.due=due; toast("Moved to "+fmtD(f.due)); draw(); }).catch(e=>toast(e.message));
    return;
  }
  f.due = due; audit("rescheduled","follow_ups",`→ ${f.due}`); toast("Moved to "+fmtD(f.due)); draw();
}
export function fuReschedule(id: number): void { const f=db.followUps.find(x=>x.id===id)!; openDlg(`<div class="body"><h3>Reschedule follow-up</h3>${field("New date",`<input type="date" id="fd" value="${f.due}">`)}${field("Note",`<input id="fn" value="${esc(f.note||"")}">`)}${can("reassign")?field("Assignee",`<select id="fa">${memberOpts(f.assignee)}</select>`):""}</div><div class="foot"><button class="btn danger tint" onclick="fuCancel(${id})">Cancel follow-up</button><button class="btn plain" onclick="closeDlg()">Close</button><button class="btn" id="fOk">Save</button></div>`); $("#fOk").onclick=()=>{
  if(!$("#fd").value) return toast("Pick a date");
  const due=$("#fd").value, note=$("#fn").value, assigneeId=$("#fa")?+$("#fa").value:undefined;
  if(BACKEND==="supabase"){
    repoFollowUps.reschedule(id, {due, note, assigneeId}).then(()=>{ f.due=due; f.note=note; if(assigneeId!==undefined) f.assignee=assigneeId; closeDlg(); draw(); }).catch(e=>toast(e.message));
    return;
  }
  f.due=due; f.note=note; if($("#fa")) f.assignee=+$("#fa").value; audit("rescheduled","follow_ups",`→ ${f.due}`); closeDlg(); draw(); }; }
export function fuCancel(id: number): void {
  const f=db.followUps.find(x=>x.id===id)!;
  if(BACKEND==="supabase"){
    repoFollowUps.cancel(id, "Cancelled by "+me!.name, me!.id).then(()=>{ f.status="cancelled"; f.cancelledBy=me!.id; f.cancelReason="Cancelled by "+me!.name; closeDlg(); draw(); }).catch(e=>toast(e.message));
    return;
  }
  f.status="cancelled"; f.cancelledBy=me!.id; f.cancelReason="Cancelled by "+me!.name; closeDlg(); audit("cancelled","follow_ups",full(db.leads.find(x=>x.id===f.leadId)!)); draw();
}

export function activityForm(l: Lead, embedded=false): string {
  if(!can("editOutcomes")) return '<p class="small muted" style="margin:0">Logging attempts is turned off for your role.</p>';
  const blocked = isBlocked(l, state.actType); const oc = state.actOutcome ? outcome(state.actOutcome) : null; const wantsFu = oc && (oc.name==="Call back later"||oc.name==="Interested"||oc.name==="Left voicemail");
  const camps = leadCampaigns(l);
  return `<h4>Log an attempt</h4>
  <div style="margin:6px 0 10px"><span class="seg">${[["call","☎ Call"],["text","✉ Text"],["reply","↩ Reply received"],["door_knock","🚪 Door knock"]].map(([k,t])=>`<button class="${state.actType===k?"on":""}" onclick="state.actType='${k}';state.actOutcome=null;refreshForm(${l.id})">${t}</button>`).join("")}</span></div>
  ${blocked?`<div class="alert red small" style="margin-bottom:10px">This action is blocked for this lead, so it can't be logged.</div>`:""}
  <label class="f" style="margin-top:0">Outcome</label><div class="outcomes">${db.outcomes.filter(o=>!o.disabled && !(state.actType==="reply"&&o.dnc)).map(o=>`<button class="${state.actOutcome===o.id?"on":""}" onclick="state.actOutcome=${o.id};refreshForm(${l.id})">${esc(o.name)}${o.conv?' <span class="muted small">· conv.</span>':""}</button>`).join("")}</div>
  <div class="grid g2" style="margin-top:4px;gap:0 12px">${field("Follow-up date",`<input type="date" id="fuIn" value="${wantsFu?addDays(TODAY,oc!.name==="Left voicemail"?3:2):""}">`)}${state.actType==="call"?field("Duration (minutes)",`<input type="number" id="durIn" min="0" placeholder="e.g. 3">`):(state.actType==="text"||state.actType==="reply")&&camps.length?field("Campaign",`<select id="campIn">${opts(camps.map(c=>[c.id,c.name]),camps[0].id,"None")}</select>`):"<div></div>"}</div>
  ${l.phones.length>1?field("Number used",`<select id="phIn">${opts(l.phones.map(p=>[p.n,pretty(p.n)+" · "+p.type]),l.phones[0].n)}</select>`):""}
  ${field("Note",`<textarea id="noteAct" rows="2" placeholder="What happened?"></textarea>`)}
  <div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" ${blocked||!state.actOutcome?"disabled":""} onclick="saveActivity(${l.id})" data-testid="save-activity">Save attempt</button></div>`;
}
export function refreshForm(id: number): void { const l=db.leads.find(x=>x.id===id)!; const el=$("#actForm"); if(el) el.innerHTML=activityForm(l); }
export function saveActivity(id: number): void {
  const fu=$("#fuIn")?.value||"";
  const note = $("#noteAct").value.trim();
  const duration = $("#durIn")?.value;
  const campaignId = $("#campIn")?.value?+$("#campIn").value:null;
  const phone = $("#phIn")?.value||db.leads.find(x=>x.id===id)!.phones[0]?.n||null;
  const type = state.actType, outcomeId = state.actOutcome;
  function afterSave(): void {
    state.actOutcome=null;
    let moved = "";
    if(state.view==="workspace"){ const q=queue(); if(q.length) state.queueIdx=(state.queueIdx+1)%q.length; window.scrollTo(0,0); }
    // Logging from the lead page keeps the run going: straight on to the next one,
    // with everything about them still in front of you.
    else if(state.view==="lead"){ const {q,i}=callQueue(); if(q.length>1){ state.id = q[(Math.max(i,0)+1)%q.length].id; state.actType="call"; location.hash="lead/"+state.id; window.scrollTo(0,0); moved = " · next lead"; } }
    toast("Attempt saved"+(fu?" · follow-up "+fmtD(fu):"")+moved);
    draw();
  }
  if(BACKEND==="supabase"){
    const l = db.leads.find(x=>x.id===id)!;
    if(type!=="reply" && isBlocked(l, type)){ toast("That action is blocked for this lead"); return; }
    const listId = state.queueList ? +state.queueList : (l.listIds?.[0] ?? null);
    repoActivities.log({ lead_id:id, type, outcome_id:outcomeId, note, fu_date: fu||null, fu_note: note,
      duration: duration?+duration:null, campaign_id: campaignId, phone, list_id: listId })
      .then(() => hydrateLeadActivity(id))
      .then(afterSave)
      .catch(e => toast(e.message));
    return;
  }
  const ok = logActivity(id, type, outcomeId, {note, fuDate:fu, duration, campaignId, phone}); if(!ok) return;
  afterSave();
}

/**
 * The campaign message for the lead in front of you. Pick which campaign
 * (when the lead is on more than one), see exactly what will go out with the
 * merge fields filled in, send it from your phone, and then confirm what was
 * sent so it is logged and the card is marked sent.
 */
