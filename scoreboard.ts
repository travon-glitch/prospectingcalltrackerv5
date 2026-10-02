import { can } from '../core/permissions.js';
import { go } from '../core/router.js';
import { me } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, esc } from '../core/util.js';
import { db } from '../data/persist.js';
import { badge } from '../features/activity.js';
import { exportCsv } from '../features/exports.js';
import { rangeFor, stats } from '../features/stats.js';
import { draw } from '../main.js';

V.scoreboard = () => {
  const r = rangeFor(state.range); const rows = db.members.filter(m=>m.active).map(m=>({m, ...stats(m.id,r)})).sort((a,b)=>b.points-a.points); const s=db.settings;
  return `<div class="page-head"><div><h2>Scoreboard</h2><p>${s.ptsCall} pt per call · ${s.ptsText} per text · ${s.ptsDoor} per door knock · ${s.ptsConv} per conversation · ${s.ptsAppt} per appointment</p></div><div class="actions"><span class="seg">${[["week","This week"],["month","This month"],["all","All time"]].map(([k,t])=>`<button class="${state.range===k?"on":""}" onclick="state.range='${k}';draw()">${t}</button>`).join("")}</span>${can("export")?`<button class="btn tint" onclick="exportCsv('scoreboard')">⇩ Export</button>`:""}${can("manageSettings")?`<button class="btn tint" onclick="state.setTab='scoring';go('settings')">Scoring settings</button>`:""}</div></div>
  <div class="grid">${rows.map((x,i)=>`<div class="card" style="display:flex;align-items:center;gap:16px"><span class="rank r${i+1}">${i+1}</span><div style="flex:1"><b style="font-size:17px">${esc(x.m.name)}${x.m.id===me!.id?' <span class="badge blue">you</span>':""}</b><div class="muted small">${x.calls} calls · ${x.texts} texts · ${x.conv} conversations · ${x.appts} appointments · ${x.rate}% contact rate</div></div><div style="text-align:right"><div style="font-size:26px;font-weight:700">${x.points}</div><div class="muted small">points</div></div></div>`).join("")}</div>`;
};

// ---------------------------------------------------------------- settings & audit
