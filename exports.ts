// Stage 13: exportCsv() — the demo's own csvCell()/exportCsv() body
// (verbatim, per-dataset headers/rows/escaping/filename), byte-identical on
// either backend by construction: the per-row mapping arrow functions below
// are unchanged from the demo either way, and only *how db.leads/
// db.activities/db.followUps/db.notes/db.campaignLeads get populated*
// differs first. On the local backend those arrays are already the org's
// full data, so ensureExportData() below is a no-op. On the supabase
// backend, exportCsv() is async and first bulk-fetches every row this
// caller's RLS lets through for whichever tables that dataset's mapping
// reads (data/repo-supabase.js's exportsRepo, same reasoning documented
// there) and replaces the matching db.* array with the full, unpaginated
// result — not the partial page/cache other views keep those arrays at —
// before falling into the exact same synchronous mapping code below.
import { activeFields, cfDisplay } from '../core/fields.js';
import { can } from '../core/permissions.js';
import { BACKEND, audit, me, memberName } from '../core/session.js';
import { state } from '../core/state.js';
import { $, TODAY, digits, download, toast } from '../core/util.js';
import { db } from '../data/persist.js';
import { exportsRepo, stats as repoStats } from '../data/repo-supabase.js';
import { attempts, canSee, full, lastAct, leadCampaigns, listNames, nextFu, outcome, visibleLeads } from './activity.js';
import { CAMPAIGN_TYPES } from './campaigns.js';
import { filteredLeads } from './leads.js';
import { inRange, rangeFor, stats } from './stats.js';
import type { Lead } from '../types.js';

export function csvCell(v: unknown): string { let s = v==null ? "" : String(v); if(/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }

function replaceAll<T>(arr: T[], rows: T[]): void { arr.length = 0; arr.push(...rows); }

/**
 * leads.js's own filteredLeads() can't be reused unchanged here: on the
 * supabase backend it returns whatever page search_leads() last cached
 * (views/leads.js's own pager), never "every matching row", which is what
 * an export needs. This is that same local-backend filter chain
 * (features/leads.js, lines unchanged) run instead against the full,
 * just-hydrated db.leads/db.campaignLeads — kept here rather than exported
 * from leads.js so leads.js itself needs no Stage 13 changes.
 */
function allFilteredLeads(): Lead[] {
  const q = state.q.trim().toLowerCase(); const qd = digits(q);
  let rows = visibleLeads();
  if(q) rows = rows.filter(l => [full(l), l.addr, l.city, l.zip, l.email, ...listNames(l), ...leadCampaigns(l).map(c=>c.name)].join(" ").toLowerCase().includes(q) || (qd.length>=3 && l.phones.some(p=>p.n.includes(qd))));
  if(state.status) rows = rows.filter(l=>l.status===state.status);
  if(state.assigned) rows = rows.filter(l=>String(l.assigned)===state.assigned);
  if(state.list) rows = rows.filter(l=>l.listIds.includes(+state.list));
  if(state.campaign) rows = rows.filter(l=>db.campaignLeads.some(c=>c.leadId===l.id && c.campaignId===+state.campaign));
  if(state.dnc==="blocked") rows = rows.filter(l=>l.dnc||l.dnt||l.dncontact); if(state.dnc==="dnc") rows = rows.filter(l=>l.dnc); if(state.dnc==="dnt") rows = rows.filter(l=>l.dnt); if(state.dnc==="none") rows = rows.filter(l=>!(l.dnc||l.dnt||l.dncontact));
  if(state.fu==="scheduled") rows = rows.filter(l=>nextFu(l)); if(state.fu==="overdue") rows = rows.filter(l=>{const f=nextFu(l); return f && f.due<TODAY;}); if(state.fu==="none") rows = rows.filter(l=>!nextFu(l));
  if(state.outcome) rows = rows.filter(l=>lastAct(l)?.outcomeId===+state.outcome);
  if(state.attMin!=="") rows = rows.filter(l=>attempts(l)>=+state.attMin); if(state.attMax!=="") rows = rows.filter(l=>attempts(l)<=+state.attMax);
  if(state.laFrom) rows = rows.filter(l=>(lastAct(l)?.at||"")>=state.laFrom); if(state.laTo) rows = rows.filter(l=>{const a=lastAct(l); return a && a.at.slice(0,10)<=state.laTo;});
  const s=state.sort;
  rows.sort((a,b)=> s==="attempts" ? attempts(b)-attempts(a) || full(a).localeCompare(full(b)) : s==="last" ? (lastAct(b)?.at||"").localeCompare(lastAct(a)?.at||"") : s==="fu" ? (nextFu(a)?.due||"9").localeCompare(nextFu(b)?.due||"9") : s==="newest" ? b.createdAt.localeCompare(a.createdAt) : full(a).localeCompare(full(b)));
  return rows;
}

async function ensureExportData(dataset: string): Promise<void> {
  if(BACKEND!=="supabase") return;
  if(dataset==="leads"){
    const [leads, activities, followUps, campaignLeads] = await Promise.all([exportsRepo.allLeads(), exportsRepo.allActivities(), exportsRepo.allFollowUps(), exportsRepo.allCampaignLeads()]);
    replaceAll(db.leads, leads); replaceAll(db.activities, activities); replaceAll(db.followUps, followUps); replaceAll(db.campaignLeads, campaignLeads);
  } else if(dataset==="assignments"){
    replaceAll(db.leads, await exportsRepo.allLeads());
  } else if(dataset==="activities"){
    const [leads, activities] = await Promise.all([exportsRepo.allLeads(), exportsRepo.allActivities()]);
    replaceAll(db.leads, leads); replaceAll(db.activities, activities);
  } else if(dataset==="outcomes"){
    replaceAll(db.activities, await exportsRepo.allActivities());
  } else if(dataset==="notes"){
    const [leads, notes] = await Promise.all([exportsRepo.allLeads(), exportsRepo.allNotes()]);
    replaceAll(db.leads, leads); replaceAll(db.notes, notes);
  } else if(dataset==="follow_ups"){
    const [leads, followUps] = await Promise.all([exportsRepo.allLeads(), exportsRepo.allFollowUps()]);
    replaceAll(db.leads, leads); replaceAll(db.followUps, followUps);
  } else if(dataset==="campaigns"){
    const [leads, campaignLeads] = await Promise.all([exportsRepo.allLeads(), exportsRepo.allCampaignLeads()]);
    replaceAll(db.leads, leads); replaceAll(db.campaignLeads, campaignLeads);
  }
  // "team_performance"/"scoreboard" need no array hydration — stats come
  // straight from repoStats.member() per member, awaited directly below
  // (stats.js's own stats() wrapper is a fire-and-forget cache meant for a
  // redrawing screen, not for a one-shot synchronous export).
}

export async function exportCsv(dataset: string): Promise<void> {
  await ensureExportData(dataset);
  const r = rangeFor(state.range); let head: string[]=[], rows: unknown[][]=[];
  const mine = (l: Pick<Lead, 'assigned'>) => canSee(l);
  if(dataset==="leads"){ const fs=activeFields();
    head=["First name","Last name","Phone","Phone 2","Email","Address","City","ZIP","Lists","Campaigns","Assigned to","Status","Attempts","Last attempt","Last outcome","Next follow-up","Do Not Call","Do Not Text","Do Not Contact", ...fs.map(f=>f.label), "Added"];
    const list = BACKEND==="supabase" ? allFilteredLeads() : filteredLeads();
    rows=list.map(l=>[l.first,l.last,l.phones[0]?.n,l.phones[1]?.n,l.email,l.addr,l.city,l.zip,listNames(l).join("; "),leadCampaigns(l).map(c=>c.name).join("; "),memberName(l.assigned),l.status,attempts(l),lastAct(l)?.at||"",lastAct(l)?outcome(lastAct(l)!.outcomeId)?.name:"",nextFu(l)?.due||"",l.dnc,l.dnt,l.dncontact, ...fs.map(f=>cfDisplay(f,(l.custom||{})[f.key])), l.createdAt]); }
  if(dataset==="assignments"){ head=["Lead","Phone","Lists","Assigned to","Role","Status"]; rows=visibleLeads().map(l=>[full(l),l.phones[0]?.n,listNames(l).join("; "),memberName(l.assigned),db.members.find(m=>m.id===l.assigned)?.role||"",l.status]); }
  if(dataset==="activities"){ head=["When","Lead","Phone","Caller","Type","Outcome","Conversation","Duration (min)","List","Campaign","Note"]; rows=db.activities.filter(a=>inRange(a,r)&&(can("viewTeamReports")||a.userId===me!.id)).map(a=>{const l=db.leads.find(x=>x.id===a.leadId)!;return [a.at,full(l),a.phone||l.phones[0]?.n,memberName(a.userId),a.type,outcome(a.outcomeId)?.name,!!outcome(a.outcomeId)?.conv,a.durationMin??"",db.lists.find(x=>x.id===a.listId)?.name||"",db.campaigns.find(x=>x.id===a.campaignId)?.name||"",a.note];}); }
  if(dataset==="outcomes"){ head=["Outcome","Counts as conversation","Appointment","Sets Do Not Call","Disabled","Times used"]; rows=db.outcomes.map(o=>[o.name,o.conv,o.appt,o.dnc,o.disabled,db.activities.filter(a=>a.outcomeId===o.id&&(can("viewTeamReports")||a.userId===me!.id)).length]); }
  if(dataset==="notes"){ head=["When","Lead","Author","Kind","Note"]; rows=db.notes.filter(n=>mine(db.leads.find(l=>l.id===n.leadId)||{})&&(n.kind!=="manager"||can("managerNotes"))).map(n=>[n.at,full(db.leads.find(l=>l.id===n.leadId)!),memberName(n.userId),n.kind,n.text]); }
  if(dataset==="follow_ups"){ head=["Due","Lead","Phone","Assignee","Status","Note","Created"]; rows=db.followUps.filter(f=>can("viewAllLeads")||f.assignee===me!.id).map(f=>{const l=db.leads.find(x=>x.id===f.leadId)!;return [f.due,full(l),l.phones[0]?.n,memberName(f.assignee),f.status,f.note,f.createdAt];}); }
  if(dataset==="campaigns"){ head=["Campaign","Type","Leads","Draft","Ready","Sent","Replied","Template","Created"]; rows=db.campaigns.filter(c=>!c.archived).map(c=>{const cs=db.campaignLeads.filter(x=>x.campaignId===c.id&&mine(db.leads.find(l=>l.id===x.leadId)||{}));const n=(s: string)=>cs.filter(x=>x.status===s).length;return [c.name,CAMPAIGN_TYPES[c.type],cs.length,n("draft"),n("ready"),n("sent"),n("replied"),c.body,c.createdAt];}); }
  if(dataset==="team_performance"||dataset==="scoreboard"){
    head=["Caller","Role","Calls","Texts","Door knocks","Conversations","Contact rate %","Appointments","Talk time (min)","Points"];
    const ms = db.members.filter(m=>m.active&&(can("viewTeamReports")||m.id===me!.id));
    const ts = BACKEND==="supabase" ? await Promise.all(ms.map(m=>repoStats.member(m.id, r[0], r[1]))) : ms.map(m=>stats(m.id, r));
    rows = ms.map((m,i)=>{const t=ts[i]; return [m.name,m.role,t.calls,t.texts,t.doors,t.conv,t.rate,t.appts,t.minutes,t.points];}).sort((a,b)=>(b[9] as number)-(a[9] as number));
  }
  if(!head.length) return toast("Unknown export");
  const csv = "﻿" + [head, ...rows].map(r=>r.map(csvCell).join(",")).join("\r\n");
  download(`${dataset}-${TODAY}.csv`, csv); audit("exported","exports",`${dataset} (${rows.length} rows)`); toast(`Exported ${rows.length} rows`);
}
