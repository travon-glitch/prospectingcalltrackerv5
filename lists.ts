import { closeDlg, confirmDlg, field, memberOpts, openDlg, opts } from '../core/dialog.js';
import { can } from '../core/permissions.js';
import { go } from '../core/router.js';
import { audit, memberName } from '../core/session.js';
import { BACKEND } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, esc, fmtD, pretty, toast } from '../core/util.js';
import { db, nid } from '../data/persist.js';
import { attempts, badge, canSee, dncBadges, full, nextFu } from '../features/activity.js';
import { addLeadsToCampaign, hydrateLead, reassign } from '../features/leads.js';
import { leads as repoLeads, lists as listsRepo } from '../data/repo-supabase.js';
import { draw } from '../main.js';
import type { Lead, List } from '../types.js';

// Stage 5, supabase backend: a list's leads aren't in db.leads until fetched
// — there's no local array to filter the way the local backend's V.lists()/
// V.list() do. leadsForList() fetches+hydrates them via the same
// leads.search({list}) RPC filteredLeads() uses, cached by list id so
// re-rendering (e.g. after a checkbox click) doesn't refetch, and kicks a
// fresh draw() once the fetch resolves. pageSize:1000 stands in for "every
// lead on the list" since this view (unlike #leads) isn't paginated.
let listLeadsCache: Record<string, { rows: Lead[] }> = {};
function leadsForList(listId: number){
  const key = String(listId);
  const c = listLeadsCache[key];
  if(!c){
    listLeadsCache[key] = { rows: [] };
    repoLeads.search({list:+listId, sort:'name', page:0, pageSize:1000}).then(({rows})=>{
      listLeadsCache[key] = { rows: rows.map(hydrateLead) };
      draw();
    }).catch(()=>{ listLeadsCache[key] = { rows: [] }; toast("Couldn't load list"); draw(); });
  }
  return listLeadsCache[key].rows;
}

V.lists = () => {
  const ls = db.lists.filter(l=>!l.archived);
  return `<div class="page-head"><div><h2>Lists</h2><p>${ls.length} active lists</p></div><div class="actions">${can("manageLists")?`<button class="btn" onclick="listForm()">+ New list</button>`:""}</div></div>
  <div class="grid g3">${ls.map(li=>{
    const r = BACKEND==="supabase" ? leadsForList(li.id) : db.leads.filter(l=>!l.archived&&l.listIds.includes(li.id)&&canSee(l));
    const worked = BACKEND==="supabase" ? r.filter(l=>(l._attempts||0)>0).length : r.filter(l=>attempts(l)>0).length;
    const campNames = BACKEND==="supabase" ? [...new Set(r.flatMap(l=>(l._campaignNamesText||"").split(", ").filter(Boolean)))] : null;
    const camps = BACKEND==="supabase" ? null : db.campaigns.filter(c=>!c.archived&&db.campaignLeads.some(cl=>cl.campaignId===c.id&&r.some(l=>l.id===cl.leadId)));
    const campsLabel = BACKEND==="supabase" ? (campNames!.length?"Campaigns: "+campNames!.map(esc).join(", "):"Not on a campaign yet") : (camps!.length?"Campaigns: "+camps!.map(c=>esc(c.name)).join(", "):"Not on a campaign yet");
    return `<div class="card"><a href="#list/${li.id}" onclick="go('list',${li.id});return false"><b style="font-size:17px">${esc(li.name)}</b></a><div class="muted small">${r.length} leads${can("viewAllLeads")?"":" (yours)"} · ${worked} worked · ${r.filter(l=>l.status==="appointment").length} appointments</div><div class="progress" style="margin:12px 0"><i style="width:${r.length?Math.round(worked/r.length*100):0}%"></i></div><div class="small muted" style="margin-bottom:10px">${campsLabel}</div><div class="actions"><button class="btn tint sm" onclick="go('list',${li.id})">Open</button><button class="btn plain sm" onclick="state.queueList='${li.id}';state.queueIdx=0;go('workspace')">Call from this list</button></div></div>`; }).join("")||'<div class="card empty">No lists yet.</div>'}</div>`;
};
export function listForm(li?: List){ openDlg(`<div class="body"><h3>${li?"Rename list":"New list"}</h3>${field("Name",`<input id="ln" value="${esc(li?.name||"")}" placeholder="e.g. Expired – October">`)}</div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="lOk">${li?"Save":"Create"}</button></div>`); $("#ln").focus(); $("#lOk").onclick=()=>{ const n=$("#ln").value.trim(); if(!n) return;
  if(BACKEND==="supabase"){
    if(li){ listsRepo.rename(li.id, n).then(()=>{ li.name=n; closeDlg(); draw(); }).catch(e=>toast(e.message)); }
    else { listsRepo.create(n).then(nl=>{ db.lists.push(nl); closeDlg(); draw(); }).catch(e=>toast(e.message)); }
    return;
  }
  if(li){ li.name=n; audit("renamed","lists",n); } else { const nl={id:nid(),name:n,archived:false,createdAt:new Date().toISOString()}; db.lists.push(nl); audit("created","lists",n); } closeDlg(); draw(); }; }
V.list = () => {
  const li = db.lists.find(x=>x.id===state.id); if(!li) return '<div class="card empty">List not found.</div>';
  const r = BACKEND==="supabase" ? leadsForList(li.id) : db.leads.filter(l=>!l.archived&&l.listIds.includes(li.id)&&canSee(l)).sort((a,b)=>full(a).localeCompare(full(b)));
  const worked = BACKEND==="supabase" ? r.filter(l=>(l._attempts||0)>0).length : r.filter(l=>attempts(l)>0).length;
  const byM = db.members.filter(m=>m.active).map(m=>[m, r.filter(l=>l.assigned===m.id).length] as const).filter(([,n])=>n);
  return `<div class="page-head"><div><a href="#lists" onclick="go('lists');return false">‹ Lists</a><h2>${esc(li.name)}</h2><p>${r.length} leads · ${worked} worked · created ${fmtD(li.createdAt)}</p></div><div class="actions"><button class="btn success" onclick="state.queueList='${li.id}';state.queueIdx=0;go('workspace')">☎ Call from this list</button>${can("reassign")?`<button class="btn tint" onclick="assignList(${li.id})">Assign list</button>`:""}${can("manageCampaigns")?`<button class="btn tint" onclick="listToCampaign(${li.id})">Add to campaign</button>`:""}${can("manageLists")?`<button class="btn tint" onclick="listForm(db.lists.find(x=>x.id===${li.id}))">Rename</button><button class="btn danger tint" onclick="archiveList(${li.id})">Archive</button>`:""}<button class="btn tint" onclick="state.list='${li.id}';exportCsv('leads')">⇩ Export</button></div></div>
  <div class="grid g3" style="margin-bottom:16px"><div class="card kpi"><div class="label">Assigned</div><div class="value" style="font-size:18px;margin-top:8px">${byM.map(([m,n])=>`${esc(m.name.split(" ")[0])} ${n}`).join(" · ")||"Nobody"}</div></div><div class="card kpi"><div class="label">Blocked (DNC/DNT)</div><div class="value">${r.filter(l=>l.dnc||l.dnt||l.dncontact).length}</div></div><div class="card kpi"><div class="label">Appointments</div><div class="value">${r.filter(l=>l.status==="appointment").length}</div></div></div>
  <div class="card flush"><div class="tbl"><table><thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Assigned</th><th>Status</th><th>Attempts</th><th>Follow-up</th><th></th></tr></thead><tbody>${r.map(l=>`<tr class="row" onclick="go('lead',${l.id})"><td><b>${esc(full(l))}</b> ${dncBadges(l)}</td><td class="mono">${pretty(l.phones[0]?.n)}</td><td>${esc(l.addr)}, ${esc(l.city)}</td><td>${esc(memberName(l.assigned))}</td><td>${badge(l)}</td><td class="mono">${BACKEND==="supabase"?(l._attempts||0):attempts(l)}</td><td>${BACKEND==="supabase"?(l._nextFollowUpDue?fmtD(l._nextFollowUpDue):"—"):(nextFu(l)?fmtD(nextFu(l)!.due):"—")}</td><td onclick="event.stopPropagation()">${can("manageLists")?`<button class="btn plain sm" onclick="removeFromList(${l.id},${li.id})">Remove</button>`:""}</td></tr>`).join("")||'<tr><td colspan="8" class="empty">No leads in this list. Import a spreadsheet into it or add leads from the Leads page.</td></tr>'}</tbody></table></div></div>`;
};
export function assignList(listId: number){ openDlg(`<div class="body"><h3>Assign the whole list</h3>${field("Assign every lead in this list to",`<select id="aM">${memberOpts("")}</select>`)}<p class="small muted">Leads already assigned to someone else will be moved.</p></div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="aOk">Assign</button></div>`); $("#aOk").onclick=()=>{ const to=+$("#aM").value;
  if(BACKEND==="supabase"){
    listsRepo.assignAll(listId, to).then(n=>{
      const key=String(listId); if(listLeadsCache[key]) listLeadsCache[key].rows.forEach(l=>{ l.assigned=to; });
      closeDlg(); toast(`${n} leads assigned`); draw();
    }).catch(e=>toast(e.message));
    return;
  }
  let n=0; db.leads.forEach(l=>{ if(!l.archived&&l.listIds.includes(listId)){ l.assigned=to; n++; } }); audit("assigned","assignments",`${db.lists.find(x=>x.id===listId)!.name} → ${memberName(to)} (${n})`); closeDlg(); toast(`${n} leads assigned`); draw(); }; }
export function listToCampaign(listId: number){ const cs=db.campaigns.filter(c=>!c.archived); if(!cs.length) return toast("Create a campaign first"); openDlg(`<div class="body"><h3>Add this list to a campaign</h3>${field("Campaign",`<select id="aC">${opts(cs.map(c=>[c.id,c.name]),"")}</select>`)}<p class="small muted">Every lead in the list gets a message card on the campaign. Leads already on the campaign, and Do-Not-Text / Do-Not-Contact leads, are skipped. Run it again later to pick up new leads added to the list.</p></div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="aOk">Add the whole list</button></div>`); $("#aOk").onclick=()=>{ const cid=+$("#aC").value; const ids=db.leads.filter(l=>!l.archived&&l.listIds.includes(listId)).map(l=>l.id);
  // addLeadsToCampaign() returns a Promise on the supabase backend and a
  // plain number on the local one (features/leads.js) — Promise.resolve()
  // normalizes both so this doesn't toast "[object Promise]" and navigate
  // away before the insert actually lands, the way it did before this fix.
  Promise.resolve(addLeadsToCampaign(cid, ids)).then(n => {
    closeDlg(); toast(`${n} lead${n===1?"":"s"} added to the campaign`); go("campaign", cid);
  }).catch(e => toast(e.message));
}; }
export function archiveList(id: number){ const li=db.lists.find(x=>x.id===id)!; confirmDlg("Archive this list?", `${li.name} will be hidden. Leads stay in the system.`, "Archive", ()=>{
  if(BACKEND==="supabase"){
    listsRepo.archive(id).then(()=>{ li.archived=true; go("lists"); }).catch(e=>toast(e.message));
    return;
  }
  li.archived=true; audit("archived","lists",li.name); go("lists"); }); }
export function removeFromList(leadId: number, listId: number){ const l=db.leads.find(x=>x.id===leadId)!; confirmDlg("Remove from this list?", `${full(l)} stays as a lead but leaves this list.`, "Remove", ()=>{
  if(BACKEND==="supabase"){
    listsRepo.removeLead(leadId, listId).then(()=>{
      l.listIds = (l.listIds||[]).filter(x=>x!==listId);
      const key=String(listId); if(listLeadsCache[key]) listLeadsCache[key].rows = listLeadsCache[key].rows.filter(x=>x.id!==leadId);
      draw();
    }).catch(e=>toast(e.message));
    return;
  }
  l.listIds=l.listIds.filter(x=>x!==listId); audit("removed","lists",`${full(l)} from ${db.lists.find(x=>x.id===listId)!.name}`); draw(); }); }

