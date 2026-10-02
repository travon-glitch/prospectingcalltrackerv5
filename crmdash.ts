import { memberOpts, opts } from '../core/dialog.js';
import { money } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { BACKEND, me } from '../core/session.js';
import { V, state } from '../core/state.js';
import { esc } from '../core/util.js';
import { db } from '../data/persist.js';
import { full, leadCampaigns } from '../features/activity.js';
import { canSeeDeal, crmExportDlg, daysIn, dealLead, dealMath, exportCrm, fuTone, pipeline, pipelines, stageOf } from '../features/crm.js';
import { crmDashByAgent, crmDashByKind, crmDashByStage } from '../features/stats.js';
import type { CrmDashFilters, Deal, DealMath, Pipeline } from '../types.js';

// Stage 11, supabase backend: db.deals isn't loaded team-wide the way the
// local backend's own seed array always is, so crmdash.js's kinds/
// stageRows/byAgent aggregates come from crm_dashboard_by_kind/_by_stage/
// _by_agent (0019_stats.sql) instead of walking a local `ds` array —
// features/stats.js's crmDashByKind/crmDashByStage/crmDashByAgent already
// do the "cache by filter params, fetch on a miss, draw() once it lands"
// wrapping, so this just resolves the same concrete pipeline the local
// branch resolves (`pipeline(f.pipe) || pipelines()[0]` — db.pipelines
// itself loads team-wide at sign-in either way, Stage 10's
// loadCrmConfig()) and reshapes each cached result into the exact same
// local variable names V.crmdash()'s markup below already renders.
const kpi = (label: string, value: string | number, sub="") => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub?`<div class="small muted">${sub}</div>`:""}</div>`;
// Stage 14 fix: every commission-derived figure on this dashboard (weighted
// forecast, gross/net commission, per-agent forecast/closed-net) is gated
// behind viewCommissions the same way views/deal.js's own financials table
// and features/crm.js's dealCard() now are; sale-price figures are gated
// behind viewPrices separately, since a role can have one without the other.
const dashMoney = (n: number, allowed: boolean) => allowed ? money(n) : "—";

function supabaseCrmDash(f: CrmDashFilters, p: Pipeline | undefined){
  const showComm = can("viewCommissions");
  const kindRows = crmDashByKind(f.pipe, f.agent, f.campaign, f.from, f.to);
  const stageRows = p ? crmDashByStage(p.id, f.agent, f.campaign, f.from, f.to) : [];
  const agentRows = crmDashByAgent(f.pipe, f.agent, f.campaign, f.from, f.to);
  const k = (kind: string) => kindRows[kind] || { n:0, price:0, gross:0, net:0, weighted:0, appt:0, listing:0, contract:0, overdue:0, overdueSample:"" };
  const active = k("active"), closed = k("closed"), lost = k("lost");
  const stageRowsHtml = stageRows.map(s => `<tr><td><span class="dot" style="background:${s.color};display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px"></span>${esc(s.name)}</td><td>${s.leads}</td><td>${s.share}%</td><td>${s.prob}%</td><td>${s.avgDays}d</td><td>${dashMoney(s.weighted, showComm)}</td></tr>`).join("");
  const byAgentRows = db.members.filter(m=>m.active && (can("viewTeamReports") || m.id===me!.id)).map(m => {
    const a = agentRows[m.id] || { active:0, appts:0, listings:0, closed:0, forecast:0, closedNet:0 };
    return `<tr><td>${esc(m.name)}</td><td>${a.active}</td><td>${a.appts}</td><td>${a.listings}</td><td>${a.closed}</td><td>${dashMoney(a.forecast, showComm)}</td><td>${dashMoney(a.closedNet, showComm)}</td></tr>`;
  }).join("");
  return { active, closed, lost, stageRowsHtml, byAgentRows };
}

V.crmdash = () => {
  if(!state.crmDash) state.crmDash = { pipe:"", agent:"", campaign:"", from:"", to:"" };
  const f = state.crmDash;
  const p = pipeline(f.pipe) || pipelines()[0];
  let active, closed, lost, overdueCount, overdueSample, stageRowsHtml, byAgentRows;
  if(BACKEND==="supabase"){
    ({active, closed, lost, stageRowsHtml, byAgentRows} = supabaseCrmDash(f, p));
    overdueCount = active.overdue; overdueSample = esc(active.overdueSample);
    return crmDashHtml({ f, p, activeN:active.n, activePrice:active.price, activeGross:active.gross, activeWeighted:active.weighted,
      apptN:active.appt, listingN:active.listing, contractN:active.contract, closedN:closed.n, closedNetMoney:dashMoney(closed.net, can("viewCommissions")),
      lostN:lost.n, overdueCount, overdueSub: overdueCount?overdueSample:"None",
      winRate:(closed.n+lost.n)?Math.round(closed.n/(closed.n+lost.n)*100)+"%":"—",
      stageRowsHtml, byAgentRows });
  }
  let ds = db.deals.filter(d=>canSeeDeal(d) && dealLead(d) && !pipeline(d.pipelineId)?.archived);
  if(f.pipe) ds = ds.filter(d=>d.pipelineId===+f.pipe); if(f.agent) ds = ds.filter(d=>d.assigned===+f.agent);
  if(f.campaign) ds = ds.filter(d=>leadCampaigns(dealLead(d)!).some(c=>c.id===+f.campaign));
  if(f.from) ds = ds.filter(d=>d.createdAt.slice(0,10)>=f.from); if(f.to) ds = ds.filter(d=>d.createdAt.slice(0,10)<=f.to);
  const byKind = (k: string) => ds.filter(d=>stageOf(d)?.kind===k);
  active = byKind("active"); closed = byKind("closed"); lost = byKind("lost");
  const sum = (arr: Deal[], k: keyof DealMath) => arr.reduce((a,d)=>a+dealMath(d,stageOf(d))[k],0);
  const nameHas = (d: Deal, re: RegExp) => re.test(stageOf(d)?.name||"");
  const overdue = active.filter(d=>fuTone(d)==="red");
  const showComm = can("viewCommissions");
  const stageRowsArr = p ? p.stages.filter(s=>!s.archived).map(s=>{ const inS = ds.filter(d=>d.pipelineId===p.id && d.stageId===s.id); const avgDays = inS.length ? Math.round(inS.reduce((a,d)=>a+daysIn(d.stageEnteredAt),0)/inS.length) : 0; const total = ds.filter(d=>d.pipelineId===p.id).length; return `<tr><td><span class="dot" style="background:${s.color};display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px"></span>${esc(s.name)}</td><td>${inS.length}</td><td>${total?Math.round(inS.length/total*100):0}%</td><td>${s.prob}%</td><td>${avgDays}d</td><td>${dashMoney(sum(inS,"weighted"), showComm)}</td></tr>`; }) : [];
  stageRowsHtml = stageRowsArr.join("");
  byAgentRows = db.members.filter(m=>m.active && (can("viewTeamReports") || m.id===me!.id)).map(m=>{ const mine = ds.filter(d=>d.assigned===m.id); return `<tr><td>${esc(m.name)}</td><td>${mine.filter(d=>stageOf(d)?.kind==="active").length}</td><td>${mine.filter(d=>nameHas(d,/appointment/i)).length}</td><td>${mine.filter(d=>nameHas(d,/signed|active listing|under contract/i)).length}</td><td>${mine.filter(d=>stageOf(d)?.kind==="closed").length}</td><td>${dashMoney(sum(mine.filter(d=>stageOf(d)?.kind==="active"),"weighted"), showComm)}</td><td>${dashMoney(sum(mine.filter(d=>stageOf(d)?.kind==="closed"),"net"), showComm)}</td></tr>`; }).join("");
  return crmDashHtml({ f, p, activeN:active.length, activePrice:sum(active,"price"), activeGross:sum(active,"gross"), activeWeighted:sum(active,"weighted"),
    apptN:active.filter(d=>nameHas(d,/appointment scheduled/i)).length, listingN:active.filter(d=>nameHas(d,/listing signed|active listing/i)).length,
    contractN:active.filter(d=>nameHas(d,/under contract/i)).length, closedN:closed.length, closedNetMoney:dashMoney(sum(closed,"net"), showComm),
    lostN:lost.length, overdueCount:overdue.length, overdueSub: overdue.length?overdue.slice(0,3).map(d=>esc(full(dealLead(d)!))).join(", "):"None",
    winRate:(closed.length+lost.length)?Math.round(closed.length/(closed.length+lost.length)*100)+"%":"—",
    stageRowsHtml, byAgentRows });
};

function crmDashHtml({ f, p, activeN, activePrice, activeGross, activeWeighted, apptN, listingN, contractN, closedN, closedNetMoney, lostN, overdueCount, overdueSub, winRate, stageRowsHtml, byAgentRows }: { f: CrmDashFilters; p: Pipeline | undefined; activeN: number; activePrice: number; activeGross: number; activeWeighted: number; apptN: number; listingN: number; contractN: number; closedN: number; closedNetMoney: string; lostN: number; overdueCount: number; overdueSub: string; winRate: string; stageRowsHtml: string; byAgentRows: string }){
  return `<div class="page-head"><div><a href="#crm" onclick="go('crm');return false">‹ Pipeline</a><h2>CRM Dashboard</h2><p>What the pipeline is worth, and where it is stuck.</p></div>${can("exportCrm")?`<button class="btn tint" onclick="crmExportDlg()">Export</button>`:""}</div>
  <div class="toolbar" style="margin-bottom:16px">
    <select onchange="state.crmDash.pipe=this.value;draw()">${opts(pipelines().map(x=>[x.id,x.name]), f.pipe, "All pipelines")}</select>
    ${can("viewTeamReports")?`<select onchange="state.crmDash.agent=this.value;draw()">${memberOpts(f.agent, "All agents")}</select>`:""}
    <select onchange="state.crmDash.campaign=this.value;draw()">${opts(db.campaigns.filter(c=>!c.archived).map(c=>[c.id,c.name]), f.campaign, "All campaigns")}</select>
    <input type="date" value="${f.from}" onchange="state.crmDash.from=this.value;draw()" title="Added from"><input type="date" value="${f.to}" onchange="state.crmDash.to=this.value;draw()" title="Added to">
  </div>
  <div class="grid g4">${kpi("Active opportunities", activeN)}${kpi("Potential sales volume", dashMoney(activePrice, can("viewPrices")))}${kpi("Potential gross commission", dashMoney(activeGross, can("viewCommissions")))}${kpi("Weighted forecast", dashMoney(activeWeighted, can("viewCommissions")), "net × stage probability")}</div>
  <div class="grid g4" style="margin-top:12px">${kpi("Appointments scheduled", apptN)}${kpi("Listings signed", listingN)}${kpi("Under contract", contractN)}${kpi("Closed", closedN, closedNetMoney+" net")}</div>
  <div class="grid g3" style="margin-top:12px">${kpi("Lost opportunities", lostN)}${kpi("Overdue follow-ups", overdueCount, overdueSub)}${kpi("Win rate", winRate, "closed ÷ (closed + lost)")}</div>
  <div class="split" style="margin-top:16px"><div class="card"><h4>By stage${p?` · ${esc(p.name)}`:""}</h4><table><thead><tr><th>Stage</th><th>Leads</th><th>Share</th><th>Prob.</th><th>Avg days</th><th>Weighted</th></tr></thead><tbody>${stageRowsHtml||'<tr><td colspan="6" class="muted small">No pipeline</td></tr>'}</tbody></table></div>
  <div class="card"><h4>Production by agent</h4><table><thead><tr><th>Agent</th><th>Active</th><th>Appts</th><th>Listings</th><th>Closed</th><th>Forecast</th><th>Closed net</th></tr></thead><tbody>${byAgentRows}</tbody></table></div></div>`;
}

/* ---------------------------------------------------------------- export */
