import { can } from '../core/permissions.js';
import { BACKEND, me, memberName } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, TODAY, esc, fmtD, pretty, toast } from '../core/util.js';
import { db } from '../data/persist.js';
import { badge, callBtn, fuDone, fuReschedule, fuSnooze, full, hydrateFollowUp } from '../features/activity.js';
import { hydrateLead } from '../features/leads.js';
import { exportCsv } from '../features/exports.js';
import { followUps as repoFollowUps } from '../data/repo-supabase.js';
import { draw } from '../main.js';
import type { FollowUp } from '../types.js';

// Stage 6, supabase backend: every follow-up RLS lets the caller see, plus
// just enough of each one's lead to render a row (repo-supabase.js's
// followUps.listAll()), hydrated into db.followUps/db.leads the same
// additive way features/leads.js's supabaseFilteredLeads() does. Once this
// has run, the rest of V.followups() below is completely unchanged from
// the local backend — it already just filters db.followUps/db.leads.
let fuLoaded = false;
function ensureFollowUpsLoaded(){
  if(fuLoaded) return;
  fuLoaded = true;
  repoFollowUps.listAll().then(rows => {
    rows.forEach(({fu, lead}) => { hydrateFollowUp(fu); hydrateLead(lead); });
    draw();
  }).catch(() => { fuLoaded = false; toast("Couldn't load follow-ups"); draw(); });
}

V.followups = () => {
  if(BACKEND==="supabase") ensureFollowUpsLoaded();
  const mine = db.followUps.filter(f=>(can("viewAllLeads")||f.assignee===me!.id) && db.leads.find(x=>x.id===f.leadId && !x.archived));
  const open = mine.filter(f=>f.status==="pending").sort((a,b)=>a.due.localeCompare(b.due)); const closed = mine.filter(f=>f.status!=="pending").sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);
  const row = (f: FollowUp) => { const l=db.leads.find(x=>x.id===f.leadId)!; return `<tr class="row" onclick="go('lead',${l.id})"><td><b>${esc(full(l))}</b><div class="small muted">${esc(l.addr)}, ${esc(l.city)}</div></td><td class="small">${esc(f.note||"")}</td><td>${esc(memberName(f.assignee))}</td><td class="mono">${pretty(l.phones[0]?.n)}</td><td style="color:${f.status==="pending"&&f.due<TODAY?'var(--danger)':'inherit'}">${fmtD(f.due)}${f.status!=="pending"?` <span class="badge">${f.status}</span>`:""}</td><td style="text-align:right" onclick="event.stopPropagation()">${f.status==="pending"?`<div class="actions" style="justify-content:flex-end">${callBtn(l,l.phones[0]?.n||"","sm")}<button class="btn tint sm" onclick="fuDone(${f.id})">Done</button><button class="btn plain sm" onclick="fuSnooze(${f.id},1)">+1 day</button><button class="btn plain sm" onclick="fuReschedule(${f.id})">Reschedule</button></div>`:""}</td></tr>`; };
  const group = (t: string, rows: FollowUp[]) => rows.length ? `<h3 style="margin:18px 0 8px;font-size:15px">${t} <span class="badge">${rows.length}</span></h3><div class="card flush"><div class="tbl"><table><tbody>${rows.map(row).join("")}</tbody></table></div></div>` : "";
  return `<div class="page-head"><div><h2>Follow-ups</h2><p>${open.length} open${can("viewAllLeads")?" across the team":""}</p></div><div class="actions"><span class="seg"><button class="${state.fuTab==="open"?"on":""}" onclick="state.fuTab='open';draw()">Open</button><button class="${state.fuTab==="closed"?"on":""}" onclick="state.fuTab='closed';draw()">Done & cancelled</button></span>${can("export")?`<button class="btn tint" onclick="exportCsv('follow_ups')">⇩ Export</button>`:""}</div></div>
  ${state.fuTab==="open" ? (group("Overdue", open.filter(f=>f.due<TODAY)) + group("Today", open.filter(f=>f.due===TODAY)) + group("Upcoming", open.filter(f=>f.due>TODAY)) + (open.length?"":'<div class="card empty">Nothing scheduled. Add a follow-up date when you log an attempt.</div>')) : (group("History", closed) || '<div class="card empty">No completed or cancelled follow-ups yet.</div>')}`;
};

