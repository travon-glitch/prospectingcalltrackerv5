// Stage 7: queue()/callQueue()/queueGo()/queueSkipToUnworked() — moved here
// from features/activity.js and core/router.js (previously split across the
// two, and already circularly imported from each other; that's unchanged,
// just collected into one module) so #workspace and the #lead call-bar share
// one definition of "what's in the queue" for both backends.
//
// Local backend: identical logic to before, byte-for-byte — queue() filters
// db.leads (already the full seed/demo dataset in memory), callQueue() falls
// back to an alphabetical, dncontact-excluded, list-scoped sweep of
// visibleLeads() when the open lead isn't in that queue.
//
// Supabase backend: db.leads only ever holds whatever a previous fetch
// hydrated into it (leads.search() pages, a single #lead/:id, follow-ups'
// listAll()) — never the *whole* candidate set #workspace needs to compute
// "Lead N of M" and "Up next" correctly. So on this backend queue() and
// callQueue()'s fallback each fetch their own full candidate set once per
// distinct set of params (mirroring features/leads.js's own
// supabaseFilteredLeads() cache-by-key pattern) via the same leads.search()
// RPC #leads already uses, with a page size (10000) far beyond any team this
// demo models — effectively "no pagination" for a query that otherwise
// requires one. Every fetched row is hydrated into db.leads the normal
// additive way, so the rest of this file — and moreInfo()/V.workspace() in
// views/workspace.js — read it exactly like the local backend's queue would.
//
// Ordering: the local backend's primary queue is simply db.leads' own array
// order, filtered — an accident of insertion order in an in-memory demo
// array with no equivalent in a real, shared database. leads.search() has no
// "insertion order" sort, so the supabase queue is ordered alphabetically by
// name (search's own default sort) — the same order the demo's own
// callQueue() fallback already uses below when a lead opened from a list
// isn't in the workspace queue, so it's an order the demo itself already
// treats as a reasonable stand-in for "the" queue order, not a new one
// invented for this port. This is a documented behavior difference, not a
// bug: counts, membership, and every filter combination match the local
// backend; only the row order within an unsorted local queue does not.
import { can } from './permissions.js';
import { BACKEND, me } from './session.js';
import { state } from './state.js';
import { TODAY, toast } from './util.js';
import { db } from '../data/persist.js';
import { attempts, full, nextFu, visibleLeads } from '../features/activity.js';
import { hydrateLead } from '../features/leads.js';
import { leads as repoLeads } from '../data/repo-supabase.js';
import { draw } from '../main.js';
import type { Lead } from '../types.js';

const QUEUE_PAGE_SIZE = 10000;
/** attempts()/nextFu() read db.activities/db.followUps, which are only
 * populated per-lead on the supabase backend (hydrateLeadActivity()) — a
 * row that only ever went through leads.search() carries the same
 * information as the "_"-prefixed fields instead (same pattern
 * views/leads.js's leadCell() and views/lead.js already use). */
const qAttempts = (l: Lead): number => BACKEND==="supabase" ? (l._attempts||0) : attempts(l);
const qFuDue = (l: Lead): string | null | undefined => BACKEND==="supabase" ? l._nextFollowUpDue : (nextFu(l)?.due);

let queueCache: { key: string | null; ids: number[] } = { key:null, ids:[] };
function queueParams(){
  return {
    list: state.queueList ? +state.queueList : null,
    assigned: (!can("viewAllLeads") || state.queueMine!==false) ? me!.id : null,
    sort: 'name', page: 0, pageSize: QUEUE_PAGE_SIZE,
  };
}
function ensureQueueLoaded(){
  const params = queueParams(); const key = JSON.stringify(params);
  if(queueCache.key === key) return;
  queueCache = { key, ids: queueCache.ids };
  repoLeads.search(params).then(({rows}) => {
    queueCache = { key, ids: rows.map(r => { hydrateLead(r); return r.id; }) };
    draw();
  }).catch(() => { queueCache = { key:null, ids:[] }; toast("Couldn't load queue"); draw(); });
}

let fallbackCache: { key: string | null; ids: number[] } = { key:null, ids:[] };
function fallbackParams(){
  return { list: state.queueList ? +state.queueList : null, assigned: null, sort: 'name', page: 0, pageSize: QUEUE_PAGE_SIZE };
}
function ensureFallbackLoaded(){
  const params = fallbackParams(); const key = JSON.stringify(params);
  if(fallbackCache.key === key) return;
  fallbackCache = { key, ids: fallbackCache.ids };
  repoLeads.search(params).then(({rows}) => {
    fallbackCache = { key, ids: rows.map(r => { hydrateLead(r); return r.id; }) };
    draw();
  }).catch(() => { fallbackCache = { key:null, ids:[] }; draw(); });
}

/** #workspace's queue: exclude Do Not Contact and closed leads, then the
 * active list/mode/"only my leads" filters — ported unchanged from the
 * demo's own queue(), except the candidate set and the two derived values
 * (attempts/next follow-up) are backend-aware (see file header). */
export function queue(): Lead[] {
  let q: Lead[] = BACKEND==="supabase"
    ? (ensureQueueLoaded(), queueCache.ids.map(id=>db.leads.find(l=>l.id===id)).filter(Boolean) as Lead[])
    : visibleLeads();
  q = q.filter(l=>!l.dncontact && !["closed"].includes(l.status));
  if(BACKEND!=="supabase" && state.queueList) q = q.filter(l=>l.listIds.includes(+state.queueList));
  if(state.queueMode==="fresh") q = q.filter(l=>qAttempts(l)===0);
  if(state.queueMode==="due") q = q.filter(l=>{ const d=qFuDue(l); return d && d<=TODAY; });
  if(BACKEND!=="supabase"){
    if(!can("viewAllLeads")) q = q.filter(l=>l.assigned===me!.id);
    else if(state.queueMine!==false) q = q.filter(l=>l.assigned===me!.id);
  }
  return q;
}

/**
 * Where this lead sits in the current call queue. Normally the workspace
 * queue; when the lead was opened from a list it is that whole list, so
 * Next keeps working even for leads assigned to someone else.
 */
export function callQueue(): { q: Lead[]; i: number } {
  let q = queue();
  if(!q.some(x=>x.id===state.id)){
    if(BACKEND==="supabase"){
      ensureFallbackLoaded();
      q = (fallbackCache.ids.map(id=>db.leads.find(l=>l.id===id)).filter(Boolean) as Lead[]).filter(l=>!l.dncontact);
    } else {
      q = visibleLeads().filter(l=>!l.dncontact);
      if(state.queueList) q = q.filter(l=>l.listIds.includes(+state.queueList));
      q.sort((a,b)=>full(a).localeCompare(full(b)));
    }
  }
  const i = q.findIndex(x=>x.id===state.id);
  return {q, i};
}
export function queueGo(dir: number): void {
  const {q,i} = callQueue(); if(!q.length) return;
  const j = i<0 ? 0 : (i+dir+q.length)%q.length;
  state.id = q[j].id; state.actOutcome=null; location.hash="lead/"+state.id; draw(); window.scrollTo(0,0);
}
export function queueSkipToUnworked(): void {
  const {q,i} = callQueue(); if(!q.length) return;
  const after = q.slice(i+1).find(x=>qAttempts(x)===0) || q.slice(0,Math.max(i,0)).find(x=>qAttempts(x)===0);
  if(!after) return toast("Every lead in this queue has been attempted");
  state.id = after.id; state.actOutcome=null; location.hash="lead/"+state.id; draw(); window.scrollTo(0,0);
}
