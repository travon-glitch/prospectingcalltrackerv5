import { field, memberOpts, opts } from '../core/dialog.js';
import { cfDisplay, money } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { BACKEND, me, memberName } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, esc, fmtD, fmtDT, pretty, toast } from '../core/util.js';
import { db } from '../data/persist.js';
import { badge, callBtn, full, hydrateLeadActivity, icon, leadActs, leadCampaigns, listNames, outcome, textBtn } from '../features/activity.js';
import { crm as repoCrm } from '../data/repo-supabase.js';
import { TEMPS, canSeeDeal, daysIn, dealCalls, dealFu, dealLastContact, dealLead, dealMath, dealTexts, fuTone, hydrateDeal, moveDeal, num, pipeline, setDealField, stageOf, stageOptsFor } from '../features/crm.js';
import { reassign } from '../features/leads.js';
import { draw } from '../main.js';
import type { Deal } from '../types.js';

// Stage 10, supabase backend: #deal/:id can be reached by a direct link or
// a page reload, not only by clicking a card that was already in
// crmDeals()' hydrated cache — same reasoning as views/lead.js's own
// ensureFullLead(). crm.get() (repo-supabase.js) is a plain single-row
// fetch by id (RLS-gated, like leads.get()); hydrateLeadActivity() brings in
// the deal's lead plus its full activity/follow-up/note history so
// dealTimeline() below has everything it needs, and the deal's own
// deal_history rows are fetched directly into d.history.
const fullDealCache = new Set();
function ensureFullDeal(id: number){
  if(fullDealCache.has(id)) return;
  fullDealCache.add(id);
  repoCrm.get(id).then(row => {
    if(!row) return;
    const d = hydrateDeal(row);
    return Promise.all([hydrateLeadActivity(d.leadId), repoCrm.historyFor(id).then(h => { d.history = h; })]);
  }).then(() => draw()).catch(() => toast("Couldn't load this deal"));
}

export function dealTimeline(d: Deal){
  const l = dealLead(d)!; const items: { at: string; who: number | null; icon: string; text: string }[] = [];
  leadActs(l).forEach(a=>items.push({at:a.at, who:a.userId, icon:icon(a.type), text:`${a.type.replace("_"," ")} · ${outcome(a.outcomeId)?.name || ""}${a.durationMin?` · ${a.durationMin} min`:""}${a.campaignId?` · ${db.campaigns.find(c=>c.id===a.campaignId)?.name}`:""}${a.note?` — ${a.note}`:""}`}));
  db.notes.filter(n=>n.leadId===l.id && (n.kind!=="manager"||can("managerNotes"))).forEach(n=>items.push({at:n.at, who:n.userId, icon:"✎", text:`Note — ${n.text}`}));
  db.followUps.filter(f=>f.leadId===l.id).forEach(f=>items.push({at:f.createdAt, who:f.assignee, icon:"◷", text:`Follow-up ${f.status} for ${fmtD(f.due)}${f.note?` — ${f.note}`:""}`}));
  d.history.forEach(h=>items.push({at:h.at, who:h.userId, icon:({stage:"⇄",created:"◫",price:"$",commission:"%",assigned:"👤",follow_up:"◷",note:"✎",edit:"✎"} as Record<string, string>)[h.type]||"•", text:h.detail}));
  return items.sort((a,b)=>b.at.localeCompare(a.at));
}
V.deal = () => {
  if(BACKEND==="supabase") ensureFullDeal(state.id!);
  const d = db.deals.find(x=>x.id===state.id);
  // RLS already gated which deal rows search_deals()/crm.get() could ever
  // return, so on the supabase backend a hydrated deal's mere presence in
  // db.deals is proof of visibility — same "canSee's local-only check isn't
  // a reliable second gate here" reasoning as views/lead.js's V.lead().
  if(!d || (BACKEND!=="supabase" && !canSeeDeal(d))) return `<div class="card empty">Not found or not yours. <a href="#crm" onclick="go('crm');return false">Back to the pipeline</a></div>`;
  if(BACKEND==="supabase" && !dealLead(d)) return `<div class="card empty">Loading…</div>`;
  const l = dealLead(d)!; const p = pipeline(d.pipelineId)!; const s = stageOf(d)!; const m = dealMath(d, s); const fin = can("editDealFinancials") || d.assigned===me!.id; const t = (TEMPS as Record<string, string[]>)[d.temperature]||TEMPS.warm;
  const list = db.imports.find(j=>j.leadIds?.includes(l.id)); const camps = leadCampaigns(l);
  const $$ = (k: string, v: unknown, inputmode="decimal") => `<input value="${esc(v)}" inputmode="${inputmode}" ${fin?"":"disabled"} onchange="setDealField(${d.id},'${k}',this.value)">`;
  return `<div class="page-head"><div><a href="#crm" onclick="state.crmPipe=${p.id};go('crm');return false">‹ ${esc(p.name)}</a><h2>${esc(full(l))}</h2><p>${esc(l.addr||"")}${l.city?", "+esc(l.city):""} ${esc(l.zip||"")} · <span class="badge ${t[1]}">${t[0]}</span> <span class="badge" style="background:${s.color}22;color:${s.color}">${esc(s.name)} · ${s.prob}%</span> · ${daysIn(d.stageEnteredAt)} days in stage</p></div>
    <div class="actions">${l.phones[0]?callBtn(l,l.phones[0].n):""}${l.phones[0]?textBtn(l,l.phones[0].n):""}<button class="btn tint" onclick="moveStageDlg(${d.id})" data-testid="deal-move">⇄ Move stage</button><button class="btn tint" onclick="dealFuDlg(${d.id})">◷ Follow-up</button><button class="btn plain" onclick="openInCallMode(${l.id})">Open lead in call mode</button></div></div>
  <div class="split"><div class="grid">
    <div class="card"><h4>Financials</h4><div class="grid g2" style="gap:0 12px">
      ${field("Potential sale price", can("viewPrices") ? $$("price", d.price) : '<span class="muted">Hidden for your role</span>')}${field("Commission %", $$("commPct", d.commPct))}
      ${field("Referral %", $$("referralPct", d.referralPct))}${field("Brokerage split %", $$("brokeragePct", d.brokeragePct))}
      ${field("Brokerage flat fee", $$("brokerageFee", d.brokerageFee))}${field("Closing costs / deductions", $$("closingCosts", d.closingCosts))}
      ${field("Team split % (team's share)", $$("teamSplitPct", d.teamSplitPct))}${field("Expected closing date", `<input type="date" value="${d.closeDate||""}" onchange="setDealField(${d.id},'closeDate',this.value)">`)}
    </div>
    ${can("viewCommissions") ? `<table style="margin-top:10px" data-testid="deal-math"><tr><td class="muted">Gross commission income</td><td class="b">${money(m.gross)}</td></tr><tr><td class="muted">− Referral</td><td>${money(m.referral)}</td></tr><tr><td class="muted">− Brokerage</td><td>${money(m.brokerage)}</td></tr><tr><td class="muted">− Closing costs</td><td>${money(num(d.closingCosts))}</td></tr><tr><td class="muted">Net estimated commission</td><td class="b">${money(m.net)}</td></tr><tr><td class="muted">Agent's share</td><td>${money(m.agentShare)}</td></tr><tr><td class="muted">Team's share</td><td>${money(m.teamShare)}</td></tr><tr><td class="muted">Weighted forecast (net × ${m.prob}%)</td><td class="b" style="color:var(--brand)">${money(m.weighted)}</td></tr></table>` : '<p class="small muted" data-testid="deal-math-hidden">Commission details are hidden for your role.</p>'}
    ${fin?"":'<p class="small muted">Only managers or the assigned agent can edit the financials.</p>'}</div>
    <div class="card"><h4>Notes</h4><textarea rows="3" onchange="setDealField(${d.id},'notes',this.value)" placeholder="Deal notes">${esc(d.notes||"")}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center"><input id="noteIn" placeholder="Add a quick note to the timeline…" onkeydown="if(event.key==='Enter'){addNote(${l.id});}"><button class="btn" onclick="addNote(${l.id})">Add</button></div></div>
    <div class="card"><h4>Activity timeline</h4><ul class="timeline" data-testid="deal-timeline">${dealTimeline(d).map(i=>`<li><span class="dot">${i.icon}</span><div>${esc(i.text)}<div class="small muted">${esc(memberName(i.who))}</div></div><time>${fmtDT(i.at)}</time></li>`).join("")||'<li class="muted small">Nothing yet.</li>'}</ul></div>
  </div><div class="grid">
    <div class="card"><h4>Deal</h4>
      ${field("Stage", `<select onchange="moveDeal(${d.id},+this.value)" data-testid="deal-stage">${stageOptsFor(p.id, d.stageId)}</select>`)}
      ${field("Assigned agent", `<select ${can("reassign")?"":"disabled"} onchange="setDealField(${d.id},'assigned',this.value)">${memberOpts(d.assigned)}</select>`)}
      ${field("Temperature", `<select onchange="setDealField(${d.id},'temperature',this.value)">${opts(Object.entries(TEMPS).map(([k,v])=>[k,v[0]]), d.temperature)}</select>`)}
      <table><tr><td class="muted">Next follow-up</td><td>${dealFu(d)?fmtD(dealFu(d)):"—"} ${fuTone(d)==="red"?'<span class="badge red">overdue</span>':""}</td></tr><tr><td class="muted">Last contact</td><td>${dealLastContact(d)?fmtDT(dealLastContact(d)):"never"}</td></tr><tr><td class="muted">Calls / texts</td><td>${dealCalls(d)} / ${dealTexts(d)}</td></tr><tr><td class="muted">Added to CRM</td><td>${fmtD(d.createdAt)} by ${esc(memberName(d.createdBy))}</td></tr></table></div>
    <div class="card"><h4>Contact &amp; property</h4><table>${l.phones.map(ph=>`<tr><td class="muted">${ph.type}</td><td><span class="mono">${pretty(ph.n)}</span></td></tr>`).join("")}<tr><td class="muted">Email</td><td>${esc(l.email||"—")}</td></tr><tr><td class="muted">Address</td><td>${esc(l.addr||"—")}${l.city?", "+esc(l.city):""} ${esc(l.zip||"")}</td></tr>${(db.customFields||[]).filter(f=>f.active&&(l.custom||{})[f.key]!==undefined).map(f=>`<tr><td class="muted">${esc(f.label)}</td><td>${esc(cfDisplay(f,l.custom![f.key]))}</td></tr>`).join("")}</table>
      <div class="actions" style="margin-top:10px"><button class="btn tint sm" onclick="leadForm(db.leads.find(x=>x.id===${l.id}))">Edit contact</button></div></div>
    <div class="card"><h4>Source</h4><table><tr><td class="muted">Lead source</td><td>${esc(l.source||"—")}</td></tr><tr><td class="muted">Campaigns</td><td>${camps.map(c=>esc(c.name)).join(", ")||"—"}</td></tr><tr><td class="muted">Lists</td><td>${listNames(l).map(esc).join(", ")||"—"}</td></tr><tr><td class="muted">Uploaded from</td><td>${list?esc(list.file):"Added by hand"}</td></tr><tr><td class="muted">Lead created</td><td>${fmtD(l.createdAt)}</td></tr></table></div>
  </div></div>`;
};

/* -------------------------------------------------------------- dashboard */
