import { LEGACY_CAP, PERMISSIONS, defaultRoles } from '../core/permissions.js';
import type { Db, RawDb } from '../types.js';

export function upgradeDb(d: RawDb): Db {
  if(!d.roles){
    d.roles = defaultRoles();
    // Whatever the owner had ticked for managers and agents carries over.
    const old = d.settings?.permissions;
    if(old){ for(const rid of ["manager","agent"]){ const r = d.roles.find(x=>x.id===rid)!; const map: Record<string, boolean> = old[rid as "manager" | "agent"]||{}; for(const k of Object.keys(map)){ const key = (LEGACY_CAP as Record<string, string>)[k] || k; if(key in r.perms) (r.perms as Record<string, boolean>)[key] = !!map[k]; } } }
  }
  for(const r of d.roles){ for(const [k] of PERMISSIONS){ if(!(k in r.perms)) r.perms[k] = !!r.superAdmin; } }
  if(!d.teams){ d.teams = [{ id: ++d.seq, name:"Alpha Prospecting Team", description:"Everyone who prospects. The team you start with.", color:"#2F6FEB", logo:null, managerId: d.members.find(m=>m.role==="manager")?.id ?? d.members[0].id, memberIds: d.members.map(m=>m.id), listIds:[], campaignIds:[], archived:false, createdAt:new Date().toISOString() }]; }
  for(const m of d.members){
    if(!m.first){ const [first, ...rest] = (m.name||"").split(" "); m.first = first||""; m.last = rest.join(" "); }
    if(m.demoLogin === undefined) m.demoLogin = !m.pwHash;  // sample users sign in with one click
    if(m.mustChangePw === undefined) m.mustChangePw = false;
    if(!m.listIds) m.listIds = [];
    if(!m.createdAt) m.createdAt = "2026-09-01T09:00:00.000Z";
    if(m.lastLogin === undefined) m.lastLogin = null;
    if(!d.roles.some(r=>r.id===m.role)) m.role = "agent";
  }
  if(!d.teamHistory) d.teamHistory = [];   // {userId, teamId, joined, left}
  return d as Db;
}
/** Seeded members get the demo password once, so the email + password form also works for them. */
