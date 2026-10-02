import { closeDlg, confirmDlg, field, listOpts, openDlg, opts } from '../core/dialog.js';
import { cardFieldsFor, cfDisplay } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { go } from '../core/router.js';
import { BACKEND, audit, me } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, TODAY, addDays, esc, fmtD, pretty, smsHref, toast } from '../core/util.js';
import { db, nid } from '../data/persist.js';
import { activities as repoActivities, campaignLeads as repoCampaignLeads, campaigns as repoCampaigns, leads as repoLeads, templates as repoTemplates } from '../data/repo-supabase.js';
import { badge, canSee, cardBody, dncBadges, full, isBlocked, renderTpl } from '../features/activity.js';
import { CAMPAIGN_TYPES, hydrateCampaignCard } from '../features/campaigns.js';
import { exportCsv } from '../features/exports.js';
import { addLeadsToCampaign, hydrateLead } from '../features/leads.js';
import { draw } from '../main.js';
import type { Campaign, CampaignLead, CampaignSummary, Lead } from '../types.js';

// logActivity is not imported here: it resolves off `window` at call time
// (main.ts's Object.assign(window, {...})), exactly as before the conversion.
declare const logActivity: typeof import('../features/activity.js').logActivity;

// Stage 8, supabase backend: V.campaigns' per-campaign counts (total/sent/
// replied cards) and preview sample lead come from campaigns.summaries()
// (repo-supabase.js) — one query for every campaign's cards at once, cached
// until a mutation below invalidates it (resetCampaignSummaries()), rather
// than on every draw().
let campaignSummaries: Map<number, CampaignSummary> | null = null;
function ensureCampaignSummaries(){
  if(campaignSummaries) return;
  campaignSummaries = new Map();
  repoCampaigns.summaries().then(m => { campaignSummaries = m; draw(); }).catch(() => { campaignSummaries = new Map(); toast("Couldn't load campaigns"); draw(); });
}
function resetCampaignSummaries(){ campaignSummaries = null; }

V.campaigns = () => {
  const cs = db.campaigns.filter(c=>!c.archived);
  if(BACKEND==="supabase") ensureCampaignSummaries();
  return `<div class="page-head"><div><h2>Campaigns</h2><p>Text campaigns with personalised message cards — every message is sent by a person from their phone</p></div><div class="actions"><button class="btn tint" onclick="templatesDlg()">Message templates</button>${can("export")?`<button class="btn tint" onclick="exportCsv('campaigns')">⇩ Export</button>`:""}${can("manageCampaigns")?`<button class="btn" onclick="campaignForm()">+ New campaign</button>`:""}</div></div>
  <div class="grid">${cs.map(c=>{
    let total, sent, rep, sample;
    if(BACKEND==="supabase"){
      const s = campaignSummaries?.get(c.id);
      total = s?.total||0; sent = s?.sent||0; rep = s?.replied||0;
      sample = s?.sample || db.leads[0] || {first:"",last:"",addr:"",city:"",zip:""};
    } else {
      const cards=db.campaignLeads.filter(x=>x.campaignId===c.id&&canSee(db.leads.find(l=>l.id===x.leadId)||{}));
      total=cards.length; sent=cards.filter(x=>x.status==="sent"||x.status==="replied").length; rep=cards.filter(x=>x.status==="replied").length;
      sample=db.leads.find(l=>l.id===cards[0]?.leadId)||db.leads[0];
    }
    return `<div class="card"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><a href="#campaign/${c.id}" onclick="go('campaign',${c.id});return false"><b style="font-size:17px">${esc(c.name)}</b></a> <span class="badge blue">${CAMPAIGN_TYPES[c.type]}</span><div class="muted small">${total} leads · ${sent} sent · ${rep} replied · created ${fmtD(c.createdAt)}</div></div><div class="actions"><button class="btn" onclick="go('campaign',${c.id})">Open messages</button>${can("manageCampaigns")?`<button class="btn tint sm" onclick="campaignForm(db.campaigns.find(x=>x.id===${c.id}))">Edit</button><button class="btn plain sm" onclick="duplicateCampaign(${c.id})">Duplicate</button><button class="btn danger tint sm" onclick="archiveCampaign(${c.id})">Archive</button>`:""}</div></div>
    <div class="grid g2" style="margin-top:12px"><div><label class="f" style="margin-top:0">Template</label><pre class="tpl">${esc(c.body)}</pre></div><div><label class="f" style="margin-top:0">Preview for ${esc(full(sample))}</label><div class="bubble">${esc(renderTpl(c.body,sample))}</div><div class="small muted" style="margin-top:6px;text-align:right">${renderTpl(c.body,sample).length} characters${renderTpl(c.body,sample).length>160?" · will send as more than one SMS":""}</div></div></div></div>`; }).join("")||'<div class="card empty">No campaigns yet. Create one, then add a list to it.</div>'}</div>`;
};
export function campaignForm(c?: Campaign){ const isNew=!c; openDlg(`<div class="body"><h3>${isNew?"New campaign":"Edit campaign"}</h3>${field("Name",`<input id="cn" value="${esc(c?.name||"")}" placeholder="e.g. Expired – October">`)}${field("Type",`<select id="ct">${opts(Object.entries(CAMPAIGN_TYPES),c?.type||"custom")}</select>`)}${field("Start from a template",`<select id="ctpl" onchange="if(this.value)document.getElementById('cb').value=db.templates.find(t=>t.id==this.value).body">${opts(db.templates.map(t=>[t.id,t.name+" · "+t.style]),"","Write my own")}</select>`)}${field("Message",`<textarea id="cb" rows="5">${esc(c?.body||"")}</textarea>`)}<p class="small muted">Merge fields: {{first_name}} {{last_name}} {{address}} {{city}} {{zip}} {{agent_name}} {{team_name}}. Editing the template never changes messages you customised per lead.</p>${isNew?field("Add a list right away (optional)",`<select id="cl">${listOpts("","No list yet")}</select>`):""}</div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="cOk">${isNew?"Create campaign":"Save"}</button></div>`,{wide:true});
  $("#cOk").onclick=()=>{
    const name=$("#cn").value.trim(), body=$("#cb").value.trim(), type=$("#ct").value;
    if(!name||!body) return toast("Name and message are required");
    if(isNew){
      if(BACKEND==="supabase"){
        repoCampaigns.create({name,type,body}).then(nc => {
          db.campaigns.push(nc);
          const lid = $("#cl").value;
          const finish = (n: number) => { resetCampaignSummaries(); closeDlg(); toast(n?`Campaign created with ${n} leads`:"Campaign created"); go("campaign", nc.id); };
          if(lid){
            repoLeads.search({list:+lid, pageSize:10000})
              .then(({rows}) => addLeadsToCampaign(nc.id, rows.map(r=>r.id)))
              .then(finish).catch(e=>toast(e.message));
          } else finish(0);
        }).catch(e=>toast(e.message));
        return;
      }
      const nc={id:nid(),name,type,body,archived:false,createdAt:new Date().toISOString()}; db.campaigns.push(nc); audit("created","campaigns",name); const lid=$("#cl").value; let n=0; if(lid){ n=addLeadsToCampaign(nc.id, db.leads.filter(l=>!l.archived&&l.listIds.includes(+lid)).map(l=>l.id)) as number; } closeDlg(); toast(n?`Campaign created with ${n} leads`:"Campaign created"); go("campaign", nc.id);
    } else {
      if(BACKEND==="supabase"){
        repoCampaigns.update(c.id, {name,type,body}).then(()=>{ Object.assign(c,{name,type,body}); closeDlg(); draw(); }).catch(e=>toast(e.message));
        return;
      }
      Object.assign(c,{name,type,body}); audit("updated","campaigns",name); closeDlg(); draw();
    }
  };
}
export function duplicateCampaign(id: number){
  if(BACKEND==="supabase"){
    repoCampaigns.duplicate(id).then(nc => { db.campaigns.push(nc); resetCampaignSummaries(); toast("Duplicated — leads are not copied"); draw(); }).catch(e=>toast(e.message));
    return;
  }
  const c=db.campaigns.find(x=>x.id===id)!; const nc={...c,id:nid(),name:c.name+" (copy)",createdAt:new Date().toISOString(),duplicatedFrom:c.id}; db.campaigns.push(nc); audit("duplicated","campaigns",nc.name); toast("Duplicated — leads are not copied"); draw();
}
export function archiveCampaign(id: number){
  const c=db.campaigns.find(x=>x.id===id)!;
  confirmDlg("Archive this campaign?", `${c.name} and its message cards will be hidden. Logged activity is kept.`, "Archive", ()=>{
    if(BACKEND==="supabase"){
      repoCampaigns.archive(id).then(()=>{ c.archived=true; go("campaigns"); }).catch(e=>toast(e.message));
      return;
    }
    c.archived=true; audit("archived","campaigns",c.name); go("campaigns");
  });
}
export function templatesDlg(){ openDlg(`<div class="body"><h3>Message templates</h3><p class="small muted">Reusable starting points for campaigns.</p>${db.templates.map(t=>`<div class="row-line"><div><b>${esc(t.name)}</b> <span class="badge">${t.style}</span><div class="small muted">${esc(t.body).slice(0,110)}…</div></div>${can("manageCampaigns")?`<div class="actions"><button class="btn plain sm" onclick="templateForm(${t.id})">Edit</button><button class="btn plain sm" style="color:var(--danger)" onclick="deleteTemplate(${t.id})">Delete</button></div>`:""}</div>`).join("")}</div><div class="foot">${can("manageCampaigns")?`<button class="btn tint" onclick="templateForm()">+ New template</button>`:""}<button class="btn plain" onclick="closeDlg()">Close</button></div>`,{wide:true}); }
export function templateForm(id?: number){
  const t=db.templates.find(x=>x.id===id);
  openDlg(`<div class="body"><h3>${t?"Edit":"New"} template</h3>${field("Name",`<input id="tn" value="${esc(t?.name||"")}">`)}${field("Style",`<select id="ts">${opts([["standard","Standard"],["friendly","Friendly"],["short","Short"],["custom","Custom"]],t?.style||"standard")}</select>`)}${field("Message",`<textarea id="tb" rows="5">${esc(t?.body||"")}</textarea>`)}</div><div class="foot"><button class="btn plain" onclick="templatesDlg()">Back</button><button class="btn" id="tOk">Save</button></div>`,{wide:true});
  $("#tOk").onclick=()=>{
    const name=$("#tn").value.trim(), body=$("#tb").value.trim(), style=$("#ts").value;
    if(!name||!body) return toast("Name and message are required");
    if(BACKEND==="supabase"){
      if(t) repoTemplates.update(t.id, {name,style,body}).then(()=>{ Object.assign(t,{name,style,body}); toast("Template saved"); templatesDlg(); }).catch(e=>toast(e.message));
      else repoTemplates.create({name,style,body}).then(nt=>{ db.templates.push(nt); toast("Template saved"); templatesDlg(); }).catch(e=>toast(e.message));
      return;
    }
    if(t){ Object.assign(t,{name,style,body}); audit("updated","message_templates",name); } else { db.templates.push({id:nid(),name,style,body}); audit("created","message_templates",name); } toast("Template saved"); templatesDlg();
  };
}
export function deleteTemplate(id: number){
  const t=db.templates.find(x=>x.id===id)!;
  confirmDlg("Delete this template?", `${t.name} will be removed. Campaigns that used it keep their own copy of the text.`, "Delete", ()=>{
    if(BACKEND==="supabase"){
      repoTemplates.delete(id).then(()=>{ db.templates=db.templates.filter(x=>x.id!==id); templatesDlg(); }).catch(e=>toast(e.message));
      return;
    }
    db.templates=db.templates.filter(x=>x.id!==id); audit("deleted","message_templates",t.name); templatesDlg();
  });
}

// Stage 8, supabase backend: db.campaignLeads is only ever additively
// hydrated (never loaded wholesale — see features/campaigns.js's
// hydrateCampaignCard()), so #campaign/:id fetches every card for this one
// campaign (with just enough of each lead for msgCard()/cardFieldsFor(),
// repo-supabase.js's campaignLeads.forCampaign()) on first visit, cached by
// campaign id. addLeadsDlg()'s "aOk" handler below invalidates this cache
// after adding leads so the new cards show up without a full reload.
const campaignCardsLoaded = new Set();
function ensureCampaignCardsLoaded(campaignId: number){
  if(campaignCardsLoaded.has(campaignId)) return;
  campaignCardsLoaded.add(campaignId);
  repoCampaignLeads.forCampaign(campaignId).then(rows => {
    rows.forEach(({card, lead}) => { hydrateCampaignCard(card); hydrateLead(lead); });
    draw();
  }).catch(() => { campaignCardsLoaded.delete(campaignId); toast("Couldn't load campaign"); draw(); });
}
export function markAllDraftsReady(campaignId: number){
  const ids = db.campaignLeads.filter(x=>x.campaignId===campaignId && x.status==="draft").map(x=>x.id);
  if(!ids.length) return;
  Promise.all(ids.map(id=>repoCampaignLeads.update(id, {status:"ready"})))
    .then(()=>{ ids.forEach(id=>{ const card=db.campaignLeads.find(x=>x.id===id); if(card) card.status="ready"; }); draw(); })
    .catch(e=>toast(e.message));
}

V.campaign = () => {
  const c = db.campaigns.find(x=>x.id===state.id); if(!c||c.archived) return '<div class="card empty">Campaign not found.</div>';
  if(BACKEND==="supabase") ensureCampaignCardsLoaded(c.id);
  const f = state.cardFilter||"all";
  // Visibility on the supabase backend is already enforced by the
  // leads!inner join in campaignLeads.forCampaign() (leads' own RLS,
  // 0015_rls.sql) — canSee() itself would under-restrict here since
  // nothing in this stage populates db.teams from Supabase (same documented
  // simplification views/lead.js's V.lead() already relies on).
  let cards = db.campaignLeads.filter(x=>x.campaignId===c.id).map(x=>({card:x, lead:db.leads.find(l=>l.id===x.leadId)})).filter(x=>x.lead&&!x.lead.archived&&(BACKEND==="supabase"||canSee(x.lead)));
  const counts = {all:cards.length, draft:cards.filter(x=>x.card.status==="draft").length, ready:cards.filter(x=>x.card.status==="ready").length, sent:cards.filter(x=>x.card.status==="sent").length, replied:cards.filter(x=>x.card.status==="replied").length};
  if(f!=="all") cards = cards.filter(x=>x.card.status===f); cards = cards.slice(0, state.cardLimit||40);
  const lists = [...new Set(cards.flatMap(x=>x.lead!.listIds))].map(id=>db.lists.find(l=>l.id===id)?.name).filter(Boolean);
  return `<div class="page-head"><div><a href="#campaigns" onclick="go('campaigns');return false">‹ Campaigns</a><h2>${esc(c.name)}</h2><p><span class="badge blue">${CAMPAIGN_TYPES[c.type]}</span> ${counts.all} leads · ${counts.sent+counts.replied} sent · ${counts.replied} replied${lists.length?" · lists: "+lists.map(esc).join(", "):""}</p></div><div class="actions">${can("manageCampaigns")?`<button class="btn" onclick="addLeadsDlg(${c.id})">+ Add leads</button><button class="btn tint" onclick="campaignForm(db.campaigns.find(x=>x.id===${c.id}))">Edit template</button>`:""}<button class="btn tint" onclick="state.campaign='${c.id}';exportCsv('leads')">⇩ Export</button></div></div>
  <div class="card" style="margin-bottom:16px"><div class="grid g2"><div><label class="f" style="margin-top:0">Campaign template</label><pre class="tpl">${esc(c.body)}</pre></div><div class="alert blue small">How sending works: tap <b>Open in Messages</b> on a card — on an iPhone that opens the Messages app with the number and text filled in; you press send. Then tap <b>Mark sent</b> to log the text attempt. When someone replies, tap <b>Log reply</b>. Nothing is sent automatically.</div></div></div>
  <div class="actions" style="margin-bottom:12px"><span class="seg">${[["all","All"],["draft","Draft"],["ready","Ready"],["sent","Sent"],["replied","Replied"]].map(([k,t])=>`<button class="${f===k?"on":""}" onclick="state.cardFilter='${k}';draw()">${t} ${(counts as Record<string, number>)[k]}</button>`).join("")}</span>${can("manageCampaigns")&&counts.draft?`<button class="btn plain sm" onclick="${BACKEND==="supabase"?`markAllDraftsReady(${c.id})`:`db.campaignLeads.forEach(x=>{if(x.campaignId===${c.id}&&x.status==='draft')x.status='ready'});audit('updated','campaign_leads','all drafts → ready');draw()`}">Mark all drafts ready</button>`:""}</div>
  <div class="cardgrid">${cards.map(({card,lead})=>msgCard(card,lead!)).join("")||`<div class="card empty" style="grid-column:1/-1">${counts.all?"No cards with this status.":can("manageCampaigns")?"No leads on this campaign yet. Click <b>Add leads</b> and pick a list.":"Your manager hasn't added your leads to this campaign yet."}</div>`}</div>
  ${(counts as Record<string, number>)[f]>(state.cardLimit||40)?`<div style="text-align:center;margin-top:12px"><button class="btn tint" onclick="state.cardLimit=(state.cardLimit||40)+40;draw()">Show more</button></div>`:""}`;
};
export function msgCard(card: CampaignLead, lead: Lead){
  const camp = db.campaigns.find(c=>c.id===card.campaignId); const text = cardBody(card); const p = lead.phones.find(x=>x.type==="mobile")||lead.phones[0]; const blocked = isBlocked(lead,"text"); const st = ({draft:"",ready:"blue",sent:"green",replied:"green"} as Record<string, string>)[card.status];
  return `<div class="card msgcard" id="card${card.id}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><a href="#lead/${lead.id}" onclick="go('lead',${lead.id});return false"><b>${esc(full(lead))}</b></a><div class="small muted">${esc(lead.addr)}, ${esc(lead.city)} · ${pretty(p?.n)}</div><div style="margin-top:4px">${badge(lead)} ${dncBadges(lead)} <span class="badge ${st}">${card.status}${card.sentAt?" · "+fmtD(card.sentAt):""}</span>${card.body!==null?' <span class="badge orange">customised</span>':""}</div></div><button class="btn plain sm" onclick="editCard(${card.id})">✎ Edit</button></div>
  ${(()=>{ const fs=cardFieldsFor().map(f=>({f,t:cfDisplay(f,(lead.custom||{})[f.key])})).filter(x=>x.t); return fs.length?`<div class="small muted" style="margin-top:8px" data-testid="card-custom-fields">${fs.map(x=>`${esc(x.f.label)}: <b class="b" style="color:var(--ink)">${esc(x.t)}</b>`).join(" · ")}</div>`:""; })()}
  <div class="bubble" style="margin:10px 0 10px auto">${esc(text)}</div>
  ${blocked?`<div class="alert red small">⛔ Texting is blocked for this lead.</div>`:`<div class="actions">${p?`<a class="btn ${card.status==="sent"||card.status==="replied"?"tint":""} sm" href="sms:${p.n}" onclick="this.href=smsHref('${p.n}',${JSON.stringify(text).replace(/"/g,'&quot;')})">✉ Open in Messages</a>`:'<span class="small muted">No phone</span>'}<button class="btn tint sm" onclick="copyText(${JSON.stringify(text).replace(/"/g,'&quot;')})">Copy</button>${can("markSent")&&card.status!=="replied"?`<button class="btn success sm" onclick="markSent(${card.id})">${card.status==="sent"?"Send again":"Mark sent"}</button>`:""}${card.status==="sent"||card.status==="replied"?`<button class="btn tint sm" onclick="logReply(${card.id})">↩ Log reply</button>`:""}${can("manageCampaigns")?`<button class="btn plain sm" style="color:var(--danger)" onclick="removeCard(${card.id})">Remove</button>`:""}</div>`}</div>`;
}
export function useCampaignTemplate(id: number){
  const card=db.campaignLeads.find(x=>x.id===id)!;
  if(BACKEND==="supabase"){
    repoCampaignLeads.update(id, {body:null}).then(()=>{ card.body=null; closeDlg(); draw(); }).catch(e=>toast(e.message));
    return;
  }
  card.body=null; closeDlg(); draw();
}
export function editCard(id: number){
  const card=db.campaignLeads.find(x=>x.id===id)!; const lead=db.leads.find(l=>l.id===card.leadId)!; const camp=db.campaigns.find(c=>c.id===card.campaignId)!;
  openDlg(`<div class="body"><h3>Message for ${esc(full(lead))}</h3><p class="small muted">Merge fields are filled in when the message is opened. Leave it as the campaign template or write a custom message for this lead only.</p>${field("Message",`<textarea id="cb" rows="6">${esc(card.body ?? camp.body)}</textarea>`)}${field("Status",`<select id="cs">${opts([["draft","Draft"],["ready","Ready"],["sent","Sent"],["replied","Replied"]],card.status)}</select>`)}<label class="f">Preview</label><div class="bubble" id="pv" style="margin-left:0">${esc(cardBody(card))}</div></div><div class="foot"><button class="btn plain" onclick="useCampaignTemplate(${id})">Use campaign template</button><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="cOk">Save</button></div>`,{wide:true});
  $("#cb").oninput=()=>{ $("#pv").textContent=renderTpl($("#cb").value,lead); };
  $("#cOk").onclick=()=>{
    const b=$("#cb").value.trim(); const newBody = b===camp.body ? null : b; const newStatus=$("#cs").value;
    if(BACKEND==="supabase"){
      repoCampaignLeads.update(id, {body:newBody, status:newStatus}).then(()=>{ card.body=newBody; card.status=newStatus; closeDlg(); draw(); }).catch(e=>toast(e.message));
      return;
    }
    card.body = newBody; card.status=newStatus; audit("updated","campaign_leads",full(lead)); closeDlg(); draw();
  };
}
export function markSent(id: number){
  const card=db.campaignLeads.find(x=>x.id===id)!; const lead=db.leads.find(l=>l.id===card.leadId)!;
  openDlg(`<div class="body"><h3>Mark as sent</h3><p class="small muted">This logs a text attempt for ${esc(full(lead))} so it shows in reports and the scoreboard.</p>${field("Outcome",`<select id="mo">${opts(db.outcomes.filter(o=>!o.disabled&&!o.dnc).map(o=>[o.id,o.name]),db.outcomes.find(o=>o.name==="No answer")?.id)}</select>`)}${field("Follow-up date (optional)",`<input type="date" id="mf">`)}${field("Note",`<input id="mn" placeholder="Optional">`)}</div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn success" id="mOk">Mark sent</button></div>`);
  $("#mOk").onclick=()=>{
    const outcomeId=+$("#mo").value, note=$("#mn").value.trim(), fuDate=$("#mf").value, phone=lead.phones[0]?.n||null;
    if(BACKEND==="supabase"){
      repoActivities.log({ lead_id:lead.id, type:"text", outcome_id:outcomeId, note, fu_date: fuDate||null, fu_note: note, duration:null, campaign_id: card.campaignId, phone, list_id: null })
        .then(() => repoCampaignLeads.update(id, { status:"sent", sent_at:new Date().toISOString(), sent_by: me!.id }))
        .then(() => { card.status="sent"; card.sentAt=new Date().toISOString(); card.sentBy=me!.id; closeDlg(); toast("Marked sent · text attempt logged"); draw(); })
        .catch(e=>toast(e.message));
      return;
    }
    const ok=logActivity(lead.id,"text",outcomeId,{note,fuDate,campaignId:card.campaignId,phone}); if(!ok) return; card.status="sent"; card.sentAt=new Date().toISOString(); card.sentBy=me!.id; closeDlg(); toast("Marked sent · text attempt logged"); draw();
  };
}
export function logReply(id: number){
  const card=db.campaignLeads.find(x=>x.id===id)!; const lead=db.leads.find(l=>l.id===card.leadId)!;
  openDlg(`<div class="body"><h3>Log a reply from ${esc(full(lead))}</h3>${field("What did they say?",`<select id="ro">${opts(db.outcomes.filter(o=>!o.disabled&&!o.dnc).map(o=>[o.id,o.name]),db.outcomes.find(o=>o.name==="Interested")?.id)}</select>`)}${field("Follow-up date (optional)",`<input type="date" id="rf" value="${addDays(TODAY,1)}">`)}${field("Note",`<textarea id="rn" rows="2" placeholder="Paste or summarise the reply"></textarea>`)}<p class="small muted">A reply marks the number as a working mobile and, when the outcome counts as a conversation, counts toward contact rate and points.</p></div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="rOk">Log reply</button></div>`);
  $("#rOk").onclick=()=>{
    const outcomeId=+$("#ro").value, note=$("#rn").value.trim(), fuDate=$("#rf").value, phone=lead.phones[0]?.n||null;
    if(BACKEND==="supabase"){
      repoActivities.log({ lead_id:lead.id, type:"reply", outcome_id:outcomeId, note, fu_date: fuDate||null, fu_note: note, duration:null, campaign_id: card.campaignId, phone, list_id: null })
        .then(() => repoCampaignLeads.update(id, { status:"replied", replied_at:new Date().toISOString() }))
        .then(() => { card.status="replied"; card.repliedAt=new Date().toISOString(); closeDlg(); toast("Reply logged"); draw(); })
        .catch(e=>toast(e.message));
      return;
    }
    logActivity(lead.id,"reply",outcomeId,{note,fuDate,campaignId:card.campaignId,phone}); card.status="replied"; card.repliedAt=new Date().toISOString(); closeDlg(); toast("Reply logged"); draw();
  };
}
export function removeCard(id: number){
  const card=db.campaignLeads.find(x=>x.id===id)!; const lead=db.leads.find(l=>l.id===card.leadId)!;
  confirmDlg("Remove from campaign?", `${full(lead)} will be taken off this campaign. Logged texts are kept.`, "Remove", ()=>{
    if(BACKEND==="supabase"){
      repoCampaignLeads.remove(id).then(()=>{ db.campaignLeads=db.campaignLeads.filter(x=>x.id!==id); resetCampaignSummaries(); draw(); }).catch(e=>toast(e.message));
      return;
    }
    db.campaignLeads=db.campaignLeads.filter(x=>x.id!==id); audit("removed","campaign_leads",full(lead)); draw();
  });
}

// Stage 8, supabase backend: "search leads" add-mode fetches through the
// same search_leads() RPC #leads already uses (repoLeads.search()), cached
// by (campaign id + query) so re-typing a stable query doesn't refetch, and
// re-rendering the still-open dialog only if it's still open once the fetch
// resolves (the person may have closed it, or picked "from a list", first).
let addSearchCache: { key: string | null; results: Lead[] } = { key:null, results:[] };
function ensureAddSearchLoaded(cid: number, q: string){
  const key = cid+"|"+q;
  if(addSearchCache.key === key) return;
  addSearchCache = { key, results: addSearchCache.results };
  repoLeads.search({q, pageSize:15}).then(({rows}) => {
    addSearchCache = { key, results: rows };
    if($<HTMLDialogElement>("#dlg")?.open) addLeadsDlg(cid);
  }).catch(() => { addSearchCache = { key, results: [] }; });
}
export function addLeadsDlg(cid: number){
  const already=new Set(db.campaignLeads.filter(x=>x.campaignId===cid).map(x=>x.leadId)); const mode=state.addMode||"list"; const q=(state.addQ||"").toLowerCase();
  let found: Lead[] = [];
  if(mode==="search"){
    if(BACKEND==="supabase"){
      ensureAddSearchLoaded(cid, q);
      found = (addSearchCache.key===cid+"|"+q ? addSearchCache.results : []).filter(l=>!already.has(l.id));
    } else {
      found = db.leads.filter(l=>!l.archived&&!already.has(l.id)&&(!q||(full(l)+" "+l.addr+" "+l.city+" "+l.zip).toLowerCase().includes(q))).slice(0,15);
    }
  }
  openDlg(`<div class="body"><h3>Add leads to campaign</h3><div class="seg" style="margin-bottom:10px"><button class="${mode==="list"?"on":""}" onclick="state.addMode='list';addLeadsDlg(${cid})">From a prospecting list</button><button class="${mode==="search"?"on":""}" onclick="state.addMode='search';addLeadsDlg(${cid})">Search leads</button></div>
  ${mode==="list" ? `${field("Prospecting list",`<select id="aL">${listOpts(state.addList||"","Choose a list…")}</select>`)}<p class="small muted">Every lead in the list is added. Leads already on the campaign, and Do-Not-Text / Do-Not-Contact leads, are skipped.</p>` : `${field("Search",`<input id="aQ" value="${esc(state.addQ||"")}" placeholder="Name, address, city or ZIP" oninput="state.addQ=this.value;addLeadsDlg(${cid});document.getElementById('aQ').focus()">`)}<div class="checks">${found.map(l=>`<label><input type="checkbox" class="pick" value="${l.id}" ${state.picked?.has(l.id)?"checked":""} onchange="(state.picked=state.picked||new Set())[this.checked?'add':'delete'](${l.id})"> ${esc(full(l))} <span class="muted small">· ${esc(l.addr)}, ${esc(l.city)}</span> ${l.dnt||l.dncontact?'<span class="badge red">no texts</span>':""}</label>`).join("")||'<div class="muted small">No matches.</div>'}</div>`}</div>
  <div class="foot"><button class="btn plain" onclick="state.picked=null;closeDlg()">Cancel</button><button class="btn" id="aOk">${mode==="list"?"Add the whole list":`Add ${state.picked?.size||0} lead${state.picked?.size===1?"":"s"}`}</button></div>`);
  if(mode==="list") $("#aL").onchange=(e)=>state.addList=(e.target as HTMLInputElement).value;
  $("#aOk").onclick=()=>{
    const finish = (n: number, total: number) => { state.picked=null; closeDlg(); if(BACKEND==="supabase"){ resetCampaignSummaries(); campaignCardsLoaded.delete(cid); } toast(`${n} lead${n===1?"":"s"} added${total-n?` · ${total-n} skipped`:""}`); draw(); };
    if(mode==="list"){
      const lid=+($("#aL").value); if(!lid) return toast("Choose a list");
      if(BACKEND==="supabase"){
        repoLeads.search({list:lid, pageSize:10000}).then(({rows}) => {
          const ids = rows.map(r=>r.id);
          return Promise.resolve(addLeadsToCampaign(cid, ids)).then(n => finish(n, ids.length));
        }).catch(e=>toast(e.message));
        return;
      }
      const ids=db.leads.filter(l=>!l.archived&&l.listIds.includes(lid)).map(l=>l.id);
      finish(addLeadsToCampaign(cid, ids) as number, ids.length);
      return;
    }
    const ids=[...(state.picked||[])];
    Promise.resolve(addLeadsToCampaign(cid, ids)).then(n=>finish(n, ids.length)).catch(e=>toast(e.message));
  };
}

// ---------------------------------------------------------------- imports
