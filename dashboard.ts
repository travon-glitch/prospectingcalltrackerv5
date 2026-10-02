import { can } from '../core/permissions.js';
import { go } from '../core/router.js';
import { BACKEND, me, memberName } from '../core/session.js';
import { V } from '../core/state.js';
import { $, TODAY, esc, fmtD, fmtDT, toast, todayD } from '../core/util.js';
import { db } from '../data/persist.js';
import { activities as repoActivities, followUps as repoFollowUps } from '../data/repo-supabase.js';
import { full, hydrateFollowUp, icon, outcome } from '../features/activity.js';
import { hydrateLead } from '../features/leads.js';
import { pace, rangeFor, stats } from '../features/stats.js';
import { draw } from '../main.js';

// Stage 11, supabase backend: db.followUps/db.activities aren't loaded
// team-wide the way the local backend's own seed arrays always are —
// dashboard.js's "Follow-ups due" KPI, "Overdue & today" and "Recent
// activity" lists aren't aggregates (member_stats() and friends don't
// cover them), just the same "fetch once, cache, hydrate additively,
// draw()" pattern views/followups.js's own ensureFollowUpsLoaded() already
// uses for the #followups page, kept local to this view since it's the
// only other screen that needs a follow-up list before any aggregate call.
let fuLoaded = false;
function ensureFollowUpsLoaded(){
  if(fuLoaded) return;
  fuLoaded = true;
  repoFollowUps.listAll().then(rows => {
    rows.forEach(({fu, lead}) => { hydrateFollowUp(fu); hydrateLead(lead); });
    draw();
  }).catch(() => { fuLoaded = false; toast("Couldn't load follow-ups"); draw(); });
}
let recentLoaded = false;
function ensureRecentActivityLoaded(){
  if(recentLoaded) return;
  recentLoaded = true;
  repoActivities.recent(6, can("viewTeamReports") ? null : me!.id).then(rows => {
    rows.forEach(({activity, lead}) => {
      const existing = db.activities.find(x=>x.id===activity.id);
      if(existing) Object.assign(existing, activity); else db.activities.push(activity);
      hydrateLead(lead);
    });
    db.activities.sort((a,b)=>b.at.localeCompare(a.at));
    draw();
  }).catch(() => { recentLoaded = false; toast("Couldn't load recent activity"); draw(); });
}

V.dashboard = () => {
  if(BACKEND==="supabase"){ ensureFollowUpsLoaded(); ensureRecentActivityLoaded(); }
  const p = pace(); const r = rangeFor("week"); const s = stats(can("viewTeamReports")?null:me!.id, r);
  const due = db.followUps.filter(f=>f.status==="pending" && f.due<=TODAY && (can("viewAllLeads")||f.assignee===me!.id)).length;
  const hour = new Date().getHours();
  return `<div class="page-head"><div><h2>Welcome back, ${esc(me!.name.split(" ")[0])}</h2><p>Your numbers today and this week, follow-ups due, and your rank. · ${todayD().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}</p></div><button class="btn lg" onclick="go('workspace')">☏ Start prospecting</button></div>
  <div class="grid g4">
    <div class="card kpi"><div class="label">Calls this week</div><div class="value">${s.calls}</div><div class="sub">${s.texts} texts · ${s.doors} door knocks</div></div>
    <div class="card kpi"><div class="label">Contact rate</div><div class="value">${s.rate}%</div><div class="sub">${s.conv} conversations ÷ call attempts</div></div>
    <div class="card kpi"><div class="label">Appointments</div><div class="value">${s.appts}</div><div class="sub">this week</div></div>
    <div class="card kpi"><div class="label">Follow-ups due</div><div class="value" style="color:${due?'var(--warning)':'inherit'}">${due}</div><div class="sub"><a href="#followups" onclick="go('followups');return false">Open follow-ups ›</a></div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h4>Weekly pace · goal ${p.goal} calls${can("viewTeamReports")?" (team)":""}</h4><div style="display:flex;justify-content:space-between;margin:6px 0"><b>${p.done} done</b><span class="muted">expected ${p.expected} by now · on pace for ${p.projected}</span></div><div class="progress"><i style="width:${p.pct}%;background:${p.done>=p.expected?'var(--success)':'var(--warning)'}"></i></div><p class="small muted" style="margin:10px 0 0">${p.elapsed} of ${p.total} working days elapsed (${db.settings.workingDays.map(d=>["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"][d]).join(" ")}). Change goals in Settings.</p></div>
    <div class="card"><h4>${can("viewTeamReports")?"Team this week":"Your week"}</h4><table><thead><tr><th>Caller</th><th>Calls</th><th>Conv.</th><th>Rate</th><th>Appts</th></tr></thead><tbody>${db.members.filter(m=>m.active && (can("viewTeamReports")||m.id===me!.id)).map(m=>{const t=stats(m.id,r);return `<tr><td>${esc(m.name)}</td><td class="mono">${t.calls}</td><td class="mono">${t.conv}</td><td class="mono">${t.rate}%</td><td class="mono">${t.appts}</td></tr>`;}).join("")}</tbody></table></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h4>Overdue & today</h4><ul>${db.followUps.filter(f=>f.status==="pending"&&f.due<=TODAY&&(can("viewAllLeads")||f.assignee===me!.id)).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,6).map(f=>{const l=db.leads.find(x=>x.id===f.leadId)!;return `<li class="row-line"><a href="#lead/${l.id}" onclick="go('lead',${l.id});return false"><b>${esc(full(l))}</b> <span class="muted small">${esc(f.note||"")}</span></a><span class="small" style="color:${f.due<TODAY?'var(--danger)':'inherit'}">${f.due<TODAY?"Overdue · ":""}${fmtD(f.due)}</span></li>`;}).join("")||'<li class="muted small">Nothing due. Nice.</li>'}</ul></div>
    <div class="card"><h4>Recent activity</h4><ul class="timeline">${db.activities.filter(a=>can("viewTeamReports")||a.userId===me!.id).slice(0,6).map(a=>{const l=db.leads.find(x=>x.id===a.leadId)!;return `<li><span class="dot">${icon(a.type)}</span><div><b>${esc(outcome(a.outcomeId)?.name)}</b> <span class="muted small">· ${esc(full(l))} · ${esc(memberName(a.userId))}</span></div><time>${fmtDT(a.at)}</time></li>`;}).join("")||'<li class="muted small">No activity yet.</li>'}</ul></div>
  </div>`;
};
