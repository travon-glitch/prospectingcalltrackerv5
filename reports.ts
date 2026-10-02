import { can } from '../core/permissions.js';
import { me } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, esc } from '../core/util.js';
import { db } from '../data/persist.js';
import { exportCsv } from '../features/exports.js';
import { callsByHour, campaignCounts, listCounts, outcomeCounts, rangeFor, stats } from '../features/stats.js';
import { draw } from '../main.js';

V.reports = () => {
  const r = rangeFor(state.range); const who = can("viewTeamReports") ? db.members.filter(m=>m.active) : [me!];
  const scope = can("viewTeamReports") ? null : me!.id;
  const total = stats(scope, r).total;
  const oCounts = outcomeCounts(scope, r); const lCounts = listCounts(scope, r); const cCounts = campaignCounts(scope, r); const hCounts = callsByHour(scope, r);
  const byOutcome = db.outcomes.map(o=>[o, oCounts[o.id]||0] as const).filter(([,n])=>n).sort((a,b)=>b[1]-a[1]); const max = byOutcome[0]?.[1]||1;
  const byList = db.lists.map(l=>[l, lCounts[l.id]||0] as const).filter(([,n])=>n).sort((a,b)=>b[1]-a[1]);
  // cCounts only has an entry for a campaign with at least one logged
  // activity of ANY type in range (campaign_counts()'s own group-by, and
  // stats.js's local branch, both already exclude anything with none) —
  // filtering on key presence, not sent||replies, keeps a campaign whose
  // only linked activity isn't a text/reply (e.g. a door knock) visible
  // with "0 sent · 0 replies", matching the local backend's own
  // `.filter(([,a])=>a.length)` (every activity, not just text/reply).
  const byCamp = db.campaigns.filter(c=>cCounts[c.id]).map(c=>[c, cCounts[c.id]] as const);
  const goalMult = state.range==="week"?1:state.range==="month"?4.3:1;
  return `<div class="page-head"><div><h2>Reports</h2><p>Built from ${total} logged activities</p></div><div class="actions"><span class="seg">${[["week","This week"],["month","This month"],["all","All time"]].map(([k,t])=>`<button class="${state.range===k?"on":""}" onclick="state.range='${k}';draw()">${t}</button>`).join("")}</span>${can("export")?`<button class="btn tint" onclick="exportCsv('team_performance')">⇩ Export</button><button class="btn tint" onclick="exportCsv('activities')">⇩ Activities</button>`:""}</div></div>
  <div class="card flush" style="margin-bottom:16px"><div class="tbl"><table><thead><tr><th>Caller</th><th>Calls</th><th>Texts</th><th>Door knocks</th><th>Conversations</th><th>Contact rate</th><th>Appointments</th><th>Talk time</th><th>Goal</th><th>Progress</th></tr></thead><tbody>${who.map(m=>{const t=stats(m.id,r); const goal=Math.round(db.settings.weeklyGoal*goalMult); return `<tr><td><b>${esc(m.name)}</b> <span class="muted small">${m.role}</span></td><td class="mono">${t.calls}</td><td class="mono">${t.texts}</td><td class="mono">${t.doors}</td><td class="mono">${t.conv}</td><td class="mono">${t.rate}%</td><td class="mono">${t.appts}</td><td class="mono">${t.minutes} min</td><td class="mono">${state.range==="all"?"—":goal}</td><td>${state.range==="all"?"":`<div class="progress" style="width:120px"><i style="width:${Math.min(100,Math.round(t.calls/goal*100))}%;background:${t.calls/goal>=0.6?'var(--success)':'var(--warning)'}"></i></div>`}</td></tr>`;}).join("")}</tbody></table></div></div>
  <div class="grid g3"><div class="card"><h4>Outcomes</h4><ul>${byOutcome.map(([o,n])=>`<li class="row-line"><span style="flex:1">${esc(o.name)}</span><span class="mono muted">${n}</span><div class="progress" style="width:90px"><i style="width:${n/max*100}%"></i></div></li>`).join("")||'<li class="muted small">No activity in this range.</li>'}</ul></div>
  <div class="card"><h4>By list</h4><ul>${byList.map(([l,n])=>`<li class="row-line"><span style="flex:1">${esc(l.name)}</span><span class="mono muted">${n} attempts</span></li>`).join("")||'<li class="muted small">Nothing yet.</li>'}</ul><h4 style="margin-top:16px">By campaign</h4><ul>${byCamp.map(([c,v])=>`<li class="row-line"><span style="flex:1">${esc(c.name)}</span><span class="mono muted">${v.sent} sent · ${v.replies} replies</span></li>`).join("")||'<li class="muted small">No campaign texts logged.</li>'}</ul></div>
  <div class="card"><h4>Calls by hour</h4><ul>${Object.entries(hCounts).sort((a,b)=>+a[0]-+b[0]).map(([h,v])=>`<li class="row-line"><span style="flex:1">${(+h%12)||12}${+h<12?"am":"pm"} – ${((+h+1)%12)||12}${+h+1<12||+h+1===24?"am":"pm"}</span><span class="mono muted">${v.c} calls · ${v.c?Math.round(v.v/v.c*100):0}% contact</span></li>`).join("")||'<li class="muted small">No calls yet.</li>'}</ul></div></div>`;
};
