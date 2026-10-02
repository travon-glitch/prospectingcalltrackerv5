import { closeDlg, openDlg, opts } from '../core/dialog.js';
import { money } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { go } from '../core/router.js';
import { memberName } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, esc } from '../core/util.js';
import { db } from '../data/persist.js';
import { full, visibleLeads } from '../features/activity.js';
import { addToCrm, crmDeals, crmDefaultFilters, crmExportDlg, crmFilterCount, dealCard, exportCrm, pipeline, pipelines, stageMenu, stageTotals } from '../features/crm.js';
import { draw } from '../main.js';
import type { Stage } from '../types.js';

V.crm = () => {
  if(!state.crm) state.crm = crmDefaultFilters();
  const ps = pipelines(); if(!ps.length) return `<div class="page-head"><div><h2>CRM Pipeline</h2></div></div><div class="card empty">No pipelines yet.${can("manageCrm")?` <a href="#settings" onclick="state.setTab='pipelines';go('settings');return false">Create one in Settings</a>.`:""}</div>`;
  if(!pipeline(state.crmPipe) || pipeline(state.crmPipe)!.archived) state.crmPipe = ps[0].id;
  const p = pipeline(state.crmPipe)!; const deals = crmDeals(); const stages = p.stages.filter(s=>!s.archived);
  const all = stages.map(s=>stageTotals(s, deals)); const tot = all.reduce((a,t)=>({price:a.price+t.price, net:a.net+t.net, weighted:a.weighted+t.weighted, count:a.count+t.count}),{price:0,net:0,weighted:0,count:0});
  const nf = crmFilterCount();
  state.crmCol = Math.min(Math.max(0, state.crmCol||0), stages.length-1);
  // Same viewPrices/viewCommissions gating Stage 14 applied to dealCard()
  // (features/crm.js), the deal page and the CRM dashboard — the audit
  // found these board-level totals (the page header and every column's
  // crm-stats row, below) had been missed, still showing pipeline-wide
  // dollar figures to a role whose per-card money was already hidden.
  const showPrices = can("viewPrices"), showComm = can("viewCommissions");
  const moneyBits = [showPrices?`${money(tot.price)} potential`:"", showComm?`${money(tot.net)} net`:"", showComm?`<b>${money(tot.weighted)}</b> weighted forecast`:""].filter(Boolean);
  const head = `<div class="page-head"><div><h2>CRM Pipeline</h2><p>${tot.count} opportunit${tot.count===1?"y":"ies"}${moneyBits.length?` · ${moneyBits.join(" · ")}`:""}</p></div>
    <div class="actions"><button class="btn tint" onclick="go('crmdash')">Dashboard</button>${can("exportCrm")?`<button class="btn plain" onclick="crmExportDlg()">Export</button>`:""}<button class="btn" onclick="crmPickLead()" data-testid="crm-add">+ Add lead</button></div></div>
  <div class="toolbar crm-toolbar">
    <select onchange="state.crmPipe=+this.value;state.crm.stage='';state.crmCol=0;draw()" data-testid="crm-pipeline">${opts(ps.map(x=>[x.id,x.name]), p.id)}</select>
    <input id="crmq" placeholder="Search name, address or phone" value="${esc(state.crm.q)}" oninput="state.crm.q=this.value;redrawKeepFocus('crmq')">
    <select onchange="state.crm.sort=this.value;draw()">${opts([["newest","Newest lead"],["oldest","Oldest lead"],["price","Highest sale price"],["commission","Highest commission"],["followup","Next follow-up"],["overdue","Most overdue"],["stagetime","Longest in stage"],["activity","Most recent activity"]], state.crm.sort)}</select>
    <button class="btn tint" onclick="crmFiltersDlg()" data-testid="crm-filters">Filters${nf?` · ${nf}`:""}</button>
  </div>`;
  const colHead = (s: Stage, t: ReturnType<typeof stageTotals>, i: number) => `<div class="crm-head" style="border-top-color:${s.color}">
      <div class="crm-title"><span class="dot" style="background:${s.color}"></span><b>${esc(s.name)}</b><span class="badge">${t.count}</span><span style="flex:1"></span><span class="small muted">${s.prob}%</span>${can("manageCrm")?`<button class="btn plain sm" onclick="stageMenu(${s.id})" aria-label="Stage settings" data-testid="stage-menu">⋯</button>`:""}</div>
      <div class="crm-stats">${showPrices?`<span title="Potential sales volume">${money(t.price)}</span>`:""}${showComm?`<span title="Potential net commission">${money(t.net)} net</span><span title="Weighted forecast" class="b">${money(t.weighted)}</span>`:""}</div>
      <button class="btn plain sm" style="width:100%" onclick="crmPickLead(${s.id})">+ Add lead here</button>
    </div>`;
  const col = (s: Stage, t: ReturnType<typeof stageTotals>, i: number) => `<div class="crm-col" data-stage="${s.id}" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dropOn(event,${s.id})">${colHead(s,t,i)}<div class="crm-cards">${t.deals.map(dealCard).join("") || `<div class="crm-empty">Drop a card here</div>`}</div></div>`;
  const cur = stages[state.crmCol];
  return `${head}
  <div class="crm-mobile-nav">
    <button class="btn tint" ${state.crmCol===0?"disabled":""} onclick="state.crmCol--;draw()" data-testid="col-prev">‹</button>
    <select onchange="state.crmCol=+this.value;draw()" data-testid="col-pick">${opts(stages.map((s,i)=>[i, `${s.name} (${all[i].count})`]), state.crmCol)}</select>
    <button class="btn tint" ${state.crmCol>=stages.length-1?"disabled":""} onclick="state.crmCol++;draw()" data-testid="col-next">›</button>
  </div>
  <div class="crm-board" id="crmBoard" ontouchstart="swipeStart(event)" ontouchend="swipeEnd(event)">${stages.map((s,i)=>col(s, all[i], i)).join("")}</div>
  <div class="crm-mobile-one" ontouchstart="swipeStart(event)" ontouchend="swipeEnd(event)">${cur ? col(cur, all[state.crmCol], state.crmCol) : ""}</div>`;
};
export let swipeX: number | null = null;
export function swipeStart(e: TouchEvent){ swipeX = e.touches[0].clientX; }
export function swipeEnd(e: TouchEvent){ if(swipeX===null || window.innerWidth>900) return; const dx = e.changedTouches[0].clientX - swipeX; swipeX = null; if(Math.abs(dx) < 60) return; const n = pipeline(state.crmPipe)!.stages.filter(s=>!s.archived).length; if(dx<0 && state.crmCol<n-1) state.crmCol++; else if(dx>0 && state.crmCol>0) state.crmCol--; else return; draw(); }
export function crmPickLead(stageId?: number){
  const p = pipeline(state.crmPipe)!; const inPipe = new Set(db.deals.filter(d=>d.pipelineId===p.id).map(d=>d.leadId));
  const cands = visibleLeads().filter(l=>!inPipe.has(l.id)).sort((a,b)=>full(a).localeCompare(full(b)));
  openDlg(`<div class="body"><h3>Add a lead to ${esc(p.name)}</h3><p class="small muted">Pick from leads already in your lists. Leads already in this pipeline are hidden.</p>
    <input id="plq" placeholder="Search…" oninput="document.querySelectorAll('#pll li').forEach(li=>li.style.display=li.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')">
    <ul id="pll" style="max-height:50vh;overflow:auto;margin-top:8px">${cands.map(l=>`<li class="row-line"><div><b>${esc(full(l))}</b><div class="small muted">${esc(l.addr||"")}${l.city?", "+esc(l.city):""} · ${esc(memberName(l.assigned))}</div></div><button class="btn tint sm" onclick="closeDlg();state.crmPipe=${p.id};addToCrm(${l.id})${stageId?`;setTimeout(()=>{const s=document.getElementById('cs');if(s){s.value='${stageId}';}},0)`:""}">Add</button></li>`).join("") || '<li class="muted small">Every lead you can see is already in this pipeline.</li>'}</ul>
  </div><div class="foot"><button class="btn plain" onclick="closeDlg()">Close</button></div>`, {wide:true});
}

/* ------------------------------------------------------ stage management */
