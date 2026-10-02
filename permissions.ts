import { builtIn } from './fields.js';
import { me } from './session.js';
import { db } from '../data/persist.js';
import { supabase } from '../data/repo-supabase.js';
import type { Cap, Member, PermMap, PermissionKey, Role } from '../types.js';

export const PERMISSIONS = [
  // Leads
  ["viewOwnLeads",     "View own leads",                       "Leads"],
  ["viewTeamLeads",    "View team leads (same team)",          "Leads"],
  ["viewAllLeads",     "View all leads",                       "Leads"],
  ["createLeads",      "Create leads",                         "Leads"],
  ["editLeads",        "Edit leads",                           "Leads"],
  ["deleteLeads",      "Delete / archive leads",               "Leads"],
  ["assignLeads",      "Assign leads",                         "Leads"],
  ["reassign",         "Reassign leads",                       "Leads"],
  ["export",           "Export leads",                         "Leads"],
  ["import",           "Upload lead lists",                    "Leads"],
  ["manageLists",      "Create and edit prospecting lists",    "Leads"],
  ["editDnc",          "Remove a Do Not Call / Text / Contact flag", "Leads"],
  // Prospecting
  ["makeCalls",        "Make calls",                           "Prospecting"],
  ["sendTexts",        "Send or prepare texts",                "Prospecting"],
  ["addNotes",         "Add notes",                            "Prospecting"],
  ["createFollowUps",  "Create follow-ups",                    "Prospecting"],
  ["editOutcomes",     "Log and edit call outcomes",           "Prospecting"],
  ["viewAttempts",     "View previous attempts",               "Prospecting"],
  ["browserDialer",    "Use the browser dialer",               "Prospecting"],
  ["viewPhones",       "View phone numbers",                   "Prospecting"],
  ["markSent",         "Mark campaign messages as sent",       "Prospecting"],
  ["managerNotes",     "Write manager-only notes",             "Prospecting"],
  // CRM Pipeline
  ["viewOwnPipeline",  "View own pipeline",                    "CRM Pipeline"],
  ["viewTeamPipeline", "View team pipeline",                   "CRM Pipeline"],
  ["viewAllPipelines", "View all pipelines",                   "CRM Pipeline"],
  ["moveStages",       "Move leads between stages",            "CRM Pipeline"],
  ["manageCrm",        "Edit pipeline stages",                 "CRM Pipeline"],
  ["viewPrices",       "View potential sale prices",           "CRM Pipeline"],
  ["viewCommissions",  "View commissions",                     "CRM Pipeline"],
  ["editDealFinancials","Edit financial information",          "CRM Pipeline"],
  ["exportCrm",        "Export pipeline information",          "CRM Pipeline"],
  // Campaigns
  ["manageCampaigns",  "Create campaigns",                     "Campaigns"],
  ["editCampaigns",    "Edit campaigns",                       "Campaigns"],
  ["deleteCampaigns",  "Delete campaigns",                     "Campaigns"],
  ["assignCampaigns",  "Assign campaigns",                     "Campaigns"],
  ["createTemplates",  "Create message templates",             "Campaigns"],
  ["creativeMessages", "Use creative-message generation",      "Campaigns"],
  // Team management
  ["viewTeamMembers",  "View team members",                    "Team management"],
  ["createTeams",      "Create teams",                         "Team management"],
  ["editTeams",        "Edit teams",                           "Team management"],
  ["assignMembers",    "Assign members to teams",              "Team management"],
  ["assignManagers",   "Assign team managers",                 "Team management"],
  ["viewTeamReports",  "View team performance",                "Team management"],
  // Competitions
  ["viewCompetitions", "View competitions",                    "Competitions"],
  ["participate",      "Participate in competitions",          "Competitions"],
  ["createCompetitions","Create competitions",                 "Competitions"],
  ["editCompetitions", "Edit competitions",                    "Competitions"],
  ["manageScoring",    "Manage scoring rules",                 "Competitions"],
  ["viewAllResults",   "View all competition results",         "Competitions"],
  // Administration
  ["createUsers",      "Create users",                         "Administration"],
  ["editUsers",        "Edit users",                           "Administration"],
  ["deactivateUsers",  "Deactivate users",                     "Administration"],
  ["resetPasswords",   "Reset passwords",                      "Administration"],
  ["createRoles",      "Create roles",                         "Administration"],
  ["editPermissions",  "Edit permissions",                     "Administration"],
  ["manageIntegrations","Manage integrations",                 "Administration"],
  ["viewAudit",        "View audit logs",                      "Administration"],
  ["exportReports",    "Export reports",                       "Administration"],
  ["manageSettings",   "Change system settings",               "Administration"],
  ["manageOutcomes",   "Edit call outcomes list",              "Administration"],
  ["manageFields",     "Add and edit fields and columns",      "Administration"],
  ["manageStatuses",   "Edit lead statuses",                   "Administration"],
] as const;
export const LEGACY_CAP = { archiveLeads:"deleteLeads", manageMembers:"editUsers" } as const satisfies Record<string, PermissionKey>;
export const PERM_LABEL = Object.fromEntries(PERMISSIONS.map(c=>[c[0],c[1]]));
export const PERM_GROUPS = [...new Set(PERMISSIONS.map(c=>c[2]))];
export const ALL_PERMS = (): PermMap => Object.fromEntries(PERMISSIONS.map(c=>[c[0], true])) as PermMap;
export const permsFrom = (keys: readonly string[]): PermMap => Object.fromEntries(PERMISSIONS.map(c=>[c[0], keys.includes(c[0])])) as PermMap;
// Kept for the older code paths that still read it.
export const CAPABILITIES = PERMISSIONS; const CAP_LABEL = PERM_LABEL; const CAP_GROUPS = PERM_GROUPS;

export const AGENT_BASE: PermissionKey[] = ["viewOwnLeads","createLeads","editLeads","makeCalls","sendTexts","addNotes","createFollowUps","editOutcomes","viewAttempts","browserDialer","viewPhones","markSent","viewOwnPipeline","moveStages","viewPrices","viewTeamMembers","viewCompetitions","participate","export"];
export const MANAGER_BASE: PermissionKey[] = [...AGENT_BASE, "viewTeamLeads","assignLeads","reassign","import","manageLists","editDnc","managerNotes","viewTeamPipeline","viewCommissions","editDealFinancials","exportCrm","manageCampaigns","editCampaigns","assignCampaigns","createTemplates","creativeMessages","viewTeamReports","assignMembers","createCompetitions","editCompetitions","manageScoring","viewAllResults","exportReports"];
export const ADMIN_BASE: PermissionKey[] = [...MANAGER_BASE, "viewAllLeads","deleteLeads","viewAllPipelines","manageCrm","deleteCampaigns","createTeams","editTeams","assignManagers","createUsers","editUsers","deactivateUsers","resetPasswords","viewAudit","manageOutcomes","manageFields","manageStatuses","manageSettings"];

/** The roles every team starts with. Ids are stable so old saves keep working. */
export function defaultRoles(): Role[] {
  return [
    { id:"owner",       name:"Owner / Super Administrator", builtIn:true, superAdmin:true, description:"Complete control over the platform, including administrators, roles and system settings.", perms: ALL_PERMS() },
    { id:"manager",     name:"Administrator",               builtIn:true, description:"Creates and manages users, assigns leads and lists, manages campaigns, CRM stages and competitions, exports data.", perms: permsFrom(ADMIN_BASE) },
    { id:"isa_manager", name:"Inside Sales Manager",        builtIn:true, description:"Coaches the callers: assigns leads, reviews calls, texts and notes, monitors follow-ups and runs competitions — without system-administrator access.", perms: permsFrom(MANAGER_BASE) },
    { id:"agent",       name:"Inside Sales Agent",          builtIn:true, description:"Works assigned leads: calls, texts, notes, follow-ups, outcomes, moves their leads through the CRM.", perms: permsFrom(AGENT_BASE) },
    { id:"re_agent",    name:"Real Estate Agent",           builtIn:true, description:"Works assigned leads and their own CRM opportunities.", perms: permsFrom([...AGENT_BASE, "viewCommissions"]) },
    { id:"viewer",      name:"Viewer / Coach",              builtIn:true, description:"Reads dashboards, reports and activity. Cannot edit, delete or reassign anything.", perms: permsFrom(["viewOwnLeads","viewTeamLeads","viewAttempts","viewOwnPipeline","viewTeamPipeline","viewPrices","viewTeamMembers","viewTeamReports","viewCompetitions","viewAllResults"]) },
  ];
}
// Old saves stored a manager/agent map; it is now derived from the roles list.
export function defaultPermissions(): { manager: PermMap; agent: PermMap } { const r = defaultRoles(); return { manager: r[1].perms, agent: r[3].perms }; }
export const roleOf = (m: Pick<Member, 'role'> | null | undefined): Role | undefined => db.roles.find(r=>r.id===(m?.role)) || db.roles.find(r=>r.id==="viewer");
export const roleName = (m: Pick<Member, 'role'> | null | undefined): string => roleOf(m)?.name || m?.role || "";
export const isSuperAdmin = (m: Pick<Member, 'role'> | null | undefined): boolean => !!roleOf(m)?.superAdmin;
/** May the signed-in person do this? Super administrators always may. */
export function can(cap: Cap): boolean {
  if(!me) return false;
  const r = roleOf(me); if(!r) return false; if(r.superAdmin) return true;
  return !!r.perms[((LEGACY_CAP as Partial<Record<Cap, PermissionKey>>)[cap] || cap) as PermissionKey];
}
/** May this member (not necessarily me) do this? Used for teammates' visibility. */
export function canUser(m: Pick<Member, 'role'> | null | undefined, cap: Cap): boolean { const r = roleOf(m); return !!r && (r.superAdmin || !!r.perms[((LEGACY_CAP as Partial<Record<Cap, PermissionKey>>)[cap] || cap) as PermissionKey]); }
/** Same team as me, for “team” level permissions. */
export const sameTeam = (userId: number | null | undefined): boolean => userId===me?.id || db.teams.some(t=>!t.archived && t.memberIds.includes(me?.id as number) && t.memberIds.includes(userId as number));

/**
 * can()/canUser()/isSuperAdmin() above are unchanged — they always read the
 * in-memory `db.roles` (same shape defaultRoles() ships: id/name/
 * description/builtIn/superAdmin/perms). What changes on the Supabase
 * backend is *where db.roles comes from*: instead of the local demo seed,
 * it's loaded here from the real `roles` + `role_permissions` tables (Stage
 * 2's schema, now enforced server-side by Stage 4's RLS + the
 * save-permissions edge function) once, at session start.
 *
 * Called from data/repo-supabase.js right after a sign-in or a restored
 * session resolves to a member — before that promise settles, so db.roles
 * is already populated by the time the first can()/isSuperAdmin() call of
 * the new session runs. A no-op wherever there's no Supabase session to
 * load for (local backend, or supabase backend with nobody signed in yet).
 */
export async function loadRolesAndPermissions(): Promise<void> {
  if(!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;

  const [{ data: roleRows, error: rErr }, { data: permRows, error: pErr }] = await Promise.all([
    supabase.from('roles').select('id,name,description,built_in,super_admin').eq('org_id', memberRow.org_id),
    supabase.from('role_permissions').select('role_id,permission_key,allowed').eq('org_id', memberRow.org_id),
  ]);
  if(rErr || pErr || !roleRows) return;

  const allowedByRole: Record<string, Set<string>> = {};
  for(const p of permRows||[]){ if(p.allowed) (allowedByRole[p.role_id] ??= new Set()).add(p.permission_key); }

  db.roles = roleRows.map(r => ({
    id: r.id, name: r.name, description: r.description,
    builtIn: r.built_in, superAdmin: r.super_admin,
    perms: r.super_admin ? ALL_PERMS() : permsFrom([...(allowedByRole[r.id] || [])]),
  }));
}

// ---------------------------------------------------------------- built-in fields
/** The fields that ship with the app. Teams rename, hide or require them. */
