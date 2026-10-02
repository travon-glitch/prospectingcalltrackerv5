import { can } from '../core/permissions.js';
import { BACKEND, me } from '../core/session.js';
import { TODAY, addDays, isoDate, toast, todayD } from '../core/util.js';
import { db } from '../data/persist.js';
import { stats as repoStats } from '../data/repo-supabase.js';
import { outcome } from './activity.js';
import { pct } from './crm.js';
import { draw } from '../main.js';
import type { Activity, CampaignCount, CrmAgentStats, CrmKindStats, CrmStageStats, DateRange, HourCount, MemberStats } from '../types.js';

/** A crmdash filter value: a <select> value ("" = any) or a real id. */
type DashArg = string | number | null | undefined;

export function weekRange(): [string, string] { const t=todayD(); const dow=(t.getDay()+6)%7; const s=new Date(t); s.setDate(t.getDate()-dow); const e=new Date(s); e.setDate(s.getDate()+6); return [isoDate(s), isoDate(e)]; }
export function monthRange(): [string, string] { const t=todayD(); return [isoDate(new Date(t.getFullYear(),t.getMonth(),1)), isoDate(new Date(t.getFullYear(),t.getMonth()+1,0))]; }
export function rangeFor(key: string): [string, string] { return key==="week" ? weekRange() : key==="month" ? monthRange() : ["2000-01-01","2999-12-31"]; }
export function inRange(a: Pick<Activity, 'at'>, [s,e]: DateRange): boolean { const d = a.at.slice(0,10); return d>=s && d<=e; }

// Stage 11, supabase backend: a small "cache by params key, kick off a
// fetch on a miss, draw() once it lands" wrapper, the exact same shape
// features/crm.js's supabaseCrmDeals()/crmSearchCache (Stage 10) and
// features/leads.js's supabaseFilteredLeads() (Stage 5) already use for
// "this can't be answered synchronously from a local array anymore" reads.
// Every aggregate below (stats(), and the reports.js/crmdash.js helpers
// further down) shares this one cache-map-per-kind approach: the caller
// gets `zero` back immediately (so the screen still renders on the very
// first draw), and a re-render follows once the real numbers arrive.
function cached<T>(cache: Map<string, T>, key: string, fetcher: () => Promise<T>, zero: T): T {
  if(!cache.has(key)){
    cache.set(key, zero);
    fetcher().then(v => { cache.set(key, v); draw(); }).catch(() => { toast("Couldn't load stats"); });
  }
  return cache.get(key)!;
}
const localTz = (): string => { try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }catch{ return "UTC"; } };

/**
 * pace()'s weekly-goal math (working days, expected/projected) is entirely
 * local (db.settings/db.members, both backend-agnostic — see stats.js's
 * own header note in the stage's design). Only `done` — calls logged this
 * week, team-or-own — needs a backend-aware count, and stats() below
 * already computes exactly that (calls) for either backend, so pace()
 * just calls it instead of re-deriving the same figure a second way.
 */
export function pace(): { done: number; goal: number; total: number; elapsed: number; projected: number; pct: number; expected: number } {
  const [s,e]=weekRange(); const wd=db.settings.workingDays; let total=0, elapsed=0;
  for(let d=s; d<=e; d=addDays(d,1)){ const dow=new Date(d+"T00:00").getDay()||7; if(wd.includes(dow)){ total++; if(d<=TODAY) elapsed++; } }
  const done = BACKEND==="supabase"
    ? stats(can("viewTeamReports") ? null : me!.id, [s,e]).calls
    : db.activities.filter(a=>a.type==="call" && inRange(a,[s,e]) && (can("viewTeamReports")||a.userId===me!.id)).length;
  const goal = db.settings.weeklyGoal * (can("viewTeamReports") ? db.members.filter(m=>m.active).length : 1);
  const projected = elapsed>0 ? Math.round(done/elapsed*total) : (done>0 ? done*total : 0);
  return {done, goal, total, elapsed, projected, pct:Math.min(100, goal? Math.round(done/goal*100):0), expected: total ? Math.round(goal*elapsed/total) : 0};
}

const ZERO_STATS: MemberStats = { calls:0, texts:0, doors:0, conv:0, appts:0, rate:0, points:0, minutes:0, total:0 };
let statsCache = new Map<string, MemberStats>();
function supabaseStats(userId: number | null | undefined, range: DateRange): MemberStats {
  const key = `${userId ?? "team"}|${range[0]}|${range[1]}`;
  return cached(statsCache, key, () => repoStats.member(userId as number | null, range[0], range[1]), ZERO_STATS);
}
export function stats(userId: number | null | undefined, range: DateRange): MemberStats {
  if(BACKEND==="supabase") return supabaseStats(userId, range);
  const acts = db.activities.filter(a=>(!userId||a.userId===userId) && inRange(a,range)); const calls=acts.filter(a=>a.type==="call"); const texts=acts.filter(a=>a.type==="text"); const doors=acts.filter(a=>a.type==="door_knock"); const convCalls=calls.filter(a=>outcome(a.outcomeId)?.conv); const conv=acts.filter(a=>outcome(a.outcomeId)?.conv); const appts=acts.filter(a=>outcome(a.outcomeId)?.appt); const s=db.settings; const fuIds = new Set(acts.map(a=>a.leadId)); const points = calls.length*s.ptsCall + texts.length*s.ptsText + doors.length*s.ptsDoor + conv.length*s.ptsConv + appts.length*s.ptsAppt; return {calls:calls.length, texts:texts.length, doors:doors.length, conv:conv.length, appts:appts.length, rate: calls.length ? Math.round(convCalls.length/calls.length*100) : 0, points, minutes: calls.reduce((n,a)=>n+(a.durationMin||0),0), total: acts.length};
}

// ---------------------------------------------------- views/reports.js aggregates
// Stage 11: byOutcome/byList/byCamp/byHour used to be computed inline in
// views/reports.js straight off db.activities; on the supabase backend
// that array isn't loaded team-wide, so these four now live here as
// backend-aware helpers reports.js calls instead, each returning a plain
// id-keyed object either way (outcome_counts()/list_counts()/
// campaign_counts()/calls_by_hour(), 0019_stats.sql, mirror the same shape).
let outcomeCache = new Map<string, Record<number, number>>(), listCache = new Map<string, Record<number, number>>(), campCache = new Map<string, Record<number, CampaignCount>>(), hourCache = new Map<string, Record<number, HourCount>>();
export function outcomeCounts(userId: number | null | undefined, range: DateRange): Record<number, number> {
  if(BACKEND==="supabase"){
    const key = `${userId ?? "team"}|${range[0]}|${range[1]}`;
    return cached(outcomeCache, key, () => repoStats.outcomeCounts(userId as number | null, range[0], range[1]), {});
  }
  const acts = db.activities.filter(a=>(!userId||a.userId===userId) && inRange(a,range));
  return Object.fromEntries(db.outcomes.map(o=>[o.id, acts.filter(a=>a.outcomeId===o.id).length]).filter(([,n])=>n));
}
export function listCounts(userId: number | null | undefined, range: DateRange): Record<number, number> {
  if(BACKEND==="supabase"){
    const key = `${userId ?? "team"}|${range[0]}|${range[1]}`;
    return cached(listCache, key, () => repoStats.listCounts(userId as number | null, range[0], range[1]), {});
  }
  const acts = db.activities.filter(a=>(!userId||a.userId===userId) && inRange(a,range));
  return Object.fromEntries(db.lists.map(l=>[l.id, acts.filter(a=>a.listId===l.id).length]).filter(([,n])=>n));
}
export function campaignCounts(userId: number | null | undefined, range: DateRange): Record<number, CampaignCount> {
  if(BACKEND==="supabase"){
    const key = `${userId ?? "team"}|${range[0]}|${range[1]}`;
    return cached(campCache, key, () => repoStats.campaignCounts(userId as number | null, range[0], range[1]), {});
  }
  const acts = db.activities.filter(a=>(!userId||a.userId===userId) && inRange(a,range));
  return Object.fromEntries(db.campaigns.map((c): [number, Required<CampaignCount>]=>{ const a = acts.filter(x=>x.campaignId===c.id); return [c.id, {sent:a.filter(x=>x.type==="text").length, replies:a.filter(x=>x.type==="reply").length, any:a.length}]; }).filter(([,v])=>v.any));
}
export function callsByHour(userId: number | null | undefined, range: DateRange): Record<number, HourCount> {
  if(BACKEND==="supabase"){
    const key = `${userId ?? "team"}|${range[0]}|${range[1]}|${localTz()}`;
    return cached(hourCache, key, () => repoStats.callsByHour(userId as number | null, range[0], range[1], localTz()), {});
  }
  const acts = db.activities.filter(a=>(!userId||a.userId===userId) && inRange(a,range));
  const byHour: Record<number, HourCount> = {};
  acts.filter(a=>a.type==="call").forEach(a=>{ const h=new Date(a.at).getHours(); byHour[h]=byHour[h]||{c:0,v:0}; byHour[h].c++; if(outcome(a.outcomeId)?.conv) byHour[h].v++; });
  return byHour;
}

// ---------------------------------------------------- views/crmdash.js aggregates
// Same reasoning as the reports.js block above: crmdash.js's own `ds`
// (a local, RLS-shaped filter of db.deals) isn't loaded team-wide on the
// supabase backend, so its kinds/stageRows/byAgent aggregates move here
// too, each a thin cache over crm_dashboard_by_kind/_by_stage/_by_agent
// (0019_stats.sql) keyed by the same 5 filter params crmdash.js's toolbar
// already exposes (state.crmDash).
let kindCache = new Map<string, Record<string, CrmKindStats>>(), stageCache = new Map<string, CrmStageStats[]>(), agentCache = new Map<string, Record<number, CrmAgentStats>>();
function crmKey(pipe: DashArg, agent: DashArg, campaign: DashArg, from: string | null | undefined, to: string | null | undefined): string { return `${pipe||""}|${agent||""}|${campaign||""}|${from||""}|${to||""}`; }
export function crmDashByKind(pipe: DashArg, agent: DashArg, campaign: DashArg, from: string | null | undefined, to: string | null | undefined): Record<string, CrmKindStats> {
  const key = crmKey(pipe, agent, campaign, from, to);
  return cached(kindCache, key, () => repoStats.crmByKind(pipe?+pipe:null, agent?+agent:null, campaign?+campaign:null, from||null, to||null), {});
}
export function crmDashByStage(pipe: DashArg, agent: DashArg, campaign: DashArg, from: string | null | undefined, to: string | null | undefined): CrmStageStats[] {
  const key = crmKey(pipe, agent, campaign, from, to);
  return cached(stageCache, key, () => repoStats.crmByStage(+pipe!, agent?+agent:null, campaign?+campaign:null, from||null, to||null), []);
}
export function crmDashByAgent(pipe: DashArg, agent: DashArg, campaign: DashArg, from: string | null | undefined, to: string | null | undefined): Record<number, CrmAgentStats> {
  const key = crmKey(pipe, agent, campaign, from, to);
  return cached(agentCache, key, () => repoStats.crmByAgent(pipe?+pipe:null, agent?+agent:null, campaign?+campaign:null, from||null, to||null), {});
}
