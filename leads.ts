import { confirmDlg, listOpts, memberOpts, opts } from '../core/dialog.js';
import { cfDisplay, resolvedColumns } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { clearFilters, go, openInCallMode, setF } from '../core/router.js';
import { audit, memberName } from '../core/session.js';
import { V, state } from '../core/state.js';
import { statusList } from '../core/statuses.js';
import { $, TODAY, esc, fmtD, pretty, toast } from '../core/util.js';
import { db } from '../data/persist.js';
import { attempts, badge, dncBadges, full, lastAct, leadCampaigns, listNames, nextFu, outcome, visibleLeads } from '../features/activity.js';
import { addToCrmBtn } from '../features/crm.js';
import { exportCsv } from '../features/exports.js';
import { BACKEND } from '../core/session.js';
import { PAGE, addToCampaign, addToList, archiveLead, filteredLeads, leadForm, leadsSearchTotal, reassign } from '../features/leads.js';
import { leads as repoLeads } from '../data/repo-supabase.js';
import { draw } from '../main.js';
import type { ColumnChoice, Lead } from '../types.js';

export function leadCell(c: ColumnChoice, l: Lead){
  if(c.custom){ const f = db.customFields.find(x=>x.key===c.id); const t = f ? cfDisplay(f, (l.custom||{})[c.id]) : ""; return t ? esc(t) : '<span class="muted">—</span>'; }
  if(BACKEND==="supabase"){
    switch(c.id){
      case "phone": return `<span class="mono">${pretty(l.phones[0]?.n)}</span>`;
      case "address": return `${esc(l.addr)}<div class="muted small">${esc(l.city)} ${esc(l.zip)}</div>`;
      case "city": return esc(l.city) || '<span class="muted">—</span>';
      case "zip": return `<span class="mono">${esc(l.zip)||"—"}</span>`;
      case "email": return esc(l.email) || '<span class="muted">—</span>';
      case "lists": return `<span class="small">${esc(l._listNamesText||"")||"—"}</span>`;
      case "campaigns": return `<span class="small">${esc(l._campaignNamesText||"")||"—"}</span>`;
      case "assigned": return esc(memberName(l.assigned));
      case "status": return badge(l);
      case "attempts": return `<span class="mono">${l._attempts||0}</span>`;
      case "last_attempt": return l._lastAttemptAt?fmtD(l._lastAttemptAt):"—";
      case "last_outcome": return l._lastOutcomeId?esc(outcome(l._lastOutcomeId)?.name):"—";
      case "follow_up": return `<span style="color:${l._nextFollowUpDue&&l._nextFollowUpDue<TODAY?'var(--danger)':'inherit'}">${l._nextFollowUpDue?fmtD(l._nextFollowUpDue):"—"}</span>`;
      default: return "—";
    }
  }
  const la = lastAct(l), fu = nextFu(l);
  switch(c.id){
    case "phone": return `<span class="mono">${pretty(l.phones[0]?.n)}</span>`;
    case "address": return `${esc(l.addr)}<div class="muted small">${esc(l.city)} ${esc(l.zip)}</div>`;
    case "city": return esc(l.city) || '<span class="muted">—</span>';
    case "zip": return `<span class="mono">${esc(l.zip)||"—"}</span>`;
    case "email": return esc(l.email) || '<span class="muted">—</span>';
    case "lists": return `<span class="small">${listNames(l).map(esc).join(", ")||"—"}</span>`;
    case "campaigns": return `<span class="small">${leadCampaigns(l).map(c=>esc(c.name)).join(", ")||"—"}</span>`;
    case "assigned": return esc(memberName(l.assigned));
    case "status": return badge(l);
    case "attempts": return `<span class="mono">${attempts(l)}</span>`;
    case "last_attempt": return la?fmtD(la.at):"—";
    case "last_outcome": return la?esc(outcome(la.outcomeId)?.name):"—";
    case "follow_up": return `<span style="color:${fu&&fu.due<TODAY?'var(--danger)':'inherit'}">${fu?fmtD(fu.due):"—"}</span>`;
    default: return "—";
  }
}
V.leads = () => {
  const cols = resolvedColumns();
  const all = filteredLeads();
  // Stage 5, supabase backend: search_leads() already paginates server-side,
  // so `all` here is just the current page's rows, not every match — the
  // total to paginate/report by is leadsSearchTotal() instead of all.length,
  // and there's no client-side re-slice.
  const total = BACKEND==="supabase" ? leadsSearchTotal() : all.length;
  const pages = Math.max(1, Math.ceil(total/PAGE)); state.page = Math.min(state.page, pages-1);
  const rows = BACKEND==="supabase" ? all : all.slice(state.page*PAGE, state.page*PAGE+PAGE);
  const sel = state.sel; const anySel = sel.size>0;
  const headCount = BACKEND==="supabase" ? total : visibleLeads().length;
  return `<div class="page-head"><div><h2>Leads</h2><p>${headCount} leads${can("viewAllLeads")?"":" assigned to you"} · ${total} match</p></div><div class="actions">
    ${anySel?`<span class="badge blue">${sel.size} selected</span>${can("reassign")?`<button class="btn tint sm" onclick="reassign([...state.sel])">Reassign</button>`:""}${can("manageLists")?`<button class="btn tint sm" onclick="addToList([...state.sel])">Add to list</button>`:""}${can("manageCampaigns")?`<button class="btn tint sm" onclick="addToCampaign([...state.sel])">Add to campaign</button>`:""}${can("archiveLeads")?`<button class="btn danger tint sm" onclick="bulkArchive()">Archive</button>`:""}<button class="btn plain sm" onclick="state.sel.clear();draw()">Clear</button>`:""}
    ${can("export")?`<button class="btn tint" onclick="exportCsv('leads')">⇩ Export CSV</button>`:""}${can("import")?`<button class="btn tint" onclick="go('imports')">⇪ Import</button>`:""}${can("createLeads")?`<button class="btn" onclick="leadForm()">+ New lead</button>`:""}</div></div>
  <div class="toolbar"><input id="q" placeholder="Search name, phone, address, city, ZIP, email, list, campaign…" value="${esc(state.q)}" oninput="state.q=this.value;state.page=0;redrawKeepFocus()">
    <select onchange="setF('sort',this.value)">${opts([["name","Sort: Name"],["attempts","Sort: Attempts"],["last","Sort: Last attempt"],["fu","Sort: Follow-up"],["newest","Sort: Newest"]],state.sort)}</select>
    <button class="btn gray" onclick="toggleFilters()">Filters ${filterCount()?`<span class="badge blue">${filterCount()}</span>`:""}</button><button class="btn plain" onclick="clearFilters()">Clear</button></div>
  <div class="filters ${state.showFilters?"":"hidden"}" id="filters">
    <div><label class="f">Status</label><select onchange="setF('status',this.value)">${opts(statusList().filter(x=>x.active!==false).map(x=>[x.key,x.label]),state.status,"Any")}</select></div>
    ${can("viewAllLeads")?`<div><label class="f">Assigned caller</label><select onchange="setF('assigned',this.value)">${memberOpts(state.assigned,"Anyone")}</select></div>`:""}
    <div><label class="f">List</label><select onchange="setF('list',this.value)">${listOpts(state.list,"Any list")}</select></div>
    <div><label class="f">Campaign</label><select onchange="setF('campaign',this.value)">${opts(db.campaigns.filter(c=>!c.archived).map(c=>[c.id,c.name]),state.campaign,"Any campaign")}</select></div>
    <div><label class="f">Do Not Call / Text / Contact</label><select onchange="setF('dnc',this.value)">${opts([["any","Any"],["blocked","Any block set"],["dnc","Do Not Call"],["dnt","Do Not Text"],["none","Not blocked"]],state.dnc)}</select></div>
    <div><label class="f">Last outcome</label><select onchange="setF('outcome',this.value)">${opts(db.outcomes.map(o=>[o.id,o.name]),state.outcome,"Any")}</select></div>
    <div><label class="f">Follow-up</label><select onchange="setF('fu',this.value)">${opts([["any","Any"],["scheduled","Scheduled"],["overdue","Overdue"],["none","None"]],state.fu)}</select></div>
    <div><label class="f">Attempts (min)</label><input type="number" min="0" value="${state.attMin}" onchange="setF('attMin',this.value)"></div>
    <div><label class="f">Attempts (max)</label><input type="number" min="0" value="${state.attMax}" onchange="setF('attMax',this.value)"></div>
    <div><label class="f">Last attempt from</label><input type="date" value="${state.laFrom}" onchange="setF('laFrom',this.value)"></div>
    <div><label class="f">Last attempt to</label><input type="date" value="${state.laTo}" onchange="setF('laTo',this.value)"></div>
  </div>
  <div class="card flush"><div class="tbl">${rows.length?`<table><thead><tr><th><input type="checkbox" onchange="toggleAll(this.checked)" ${rows.every(l=>sel.has(l.id))?"checked":""}></th><th>Name</th>${cols.map(c=>`<th>${esc(c.label)}</th>`).join("")}<th></th></tr></thead><tbody>
    ${rows.map(l=>`<tr class="row" onclick="openInCallMode(${l.id}${state.list?`,${state.list}`:""})"><td onclick="event.stopPropagation()"><input type="checkbox" ${sel.has(l.id)?"checked":""} onchange="toggleSel(${l.id},this.checked)"></td><td><b>${esc(full(l))}</b><div>${dncBadges(l)}</div></td>${cols.map(c=>`<td>${leadCell(c,l)}</td>`).join("")}<td style="white-space:nowrap">${addToCrmBtn(l.id)} <button class="btn plain sm" onclick="event.stopPropagation();archiveLead(${l.id})">Archive</button></td></tr>`).join("")}
    </tbody></table>`:`<div class="empty">${visibleLeads().length?"No leads match these filters.":"No leads yet. Import a spreadsheet or add a lead."}<br><button class="btn plain" onclick="clearFilters()">Clear filters</button></div>`}</div></div>
  ${pages>1?`<div class="actions" style="justify-content:center;margin-top:12px"><button class="btn tint sm" ${state.page===0?"disabled":""} onclick="state.page--;draw()">‹ Prev</button><span class="small muted">Page ${state.page+1} of ${pages}</span><button class="btn tint sm" ${state.page>=pages-1?"disabled":""} onclick="state.page++;draw()">Next ›</button></div>`:""}`;
};
export function filterCount(){ return ["status","assigned","list","campaign","outcome","attMin","attMax","laFrom","laTo"].filter(k=>(state as unknown as Record<string, unknown>)[k]!=="").length + ((state.dnc!=="any") as unknown as number) + ((state.fu!=="any") as unknown as number); }
export function toggleFilters(){ state.showFilters=!state.showFilters; draw(); }
export function toggleSel(id: number, on: boolean){ on?state.sel.add(id):state.sel.delete(id); draw(); }
export function toggleAll(on: boolean){ const rows = BACKEND==="supabase" ? filteredLeads() : filteredLeads().slice(state.page*PAGE, state.page*PAGE+PAGE); rows.forEach(l=>on?state.sel.add(l.id):state.sel.delete(l.id)); draw(); }
export function bulkArchive(){ const ids=[...state.sel];
  confirmDlg(`Archive ${ids.length} leads?`, "They will be hidden from lists, campaigns and the workspace.", "Archive", ()=>{
    if(BACKEND==="supabase"){
      repoLeads.bulkArchive(ids).then(()=>{ ids.forEach(id=>{ const l=db.leads.find(x=>x.id===id); if(l) l.archived=true; }); state.sel.clear(); toast("Archived"); draw(); }).catch(e=>toast(e.message));
      return;
    }
    ids.forEach(id=>{ db.leads.find(x=>x.id===id)!.archived=true; }); audit("archived","leads",`${ids.length} leads (bulk)`); state.sel.clear(); toast("Archived"); draw();
  });
}
