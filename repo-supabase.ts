// Stage 3 added Supabase Auth (signInWithPassword/signOut/getSessionMember/
// updatePassword). Stage 4 adds roles.* (list/detail/save/create/rename/
// delete, backing views/admin.js's ADM.roles) and wires db.roles itself to
// load from the real roles/role_permissions tables instead of the local
// demo seed — see core/permissions.js's loadRolesAndPermissions(). Every
// other repo method a real backend eventually needs (leads, deals,
// campaigns, imports, ...) is still a later stage's job — same "implement
// now so a later stage only wires UI" pattern as
// supabase/functions/admin-create-user. Until then, the rest of the app
// keeps reading and writing the local in-memory `db` (data/persist.js)
// exactly as it always has, regardless of VITE_BACKEND — only *who you
// are* and *what your role can do* are decided by Supabase when
// VITE_BACKEND=supabase; everything else (leads, teams, ...) still comes
// from the local demo database.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Activity, AuditEntry, BuiltInField, Campaign, CampaignLead, CampaignSummary, CrmFilters, CustomField, CustomValues, Deal, DealHistoryEntry, FollowUp, ImportCfg, ImportRow, Lead, LeadPartial, LeadPhone, LeadSearchParams, List, Member, MemberStats, Note, Outcome, Pipeline, Role, SignInResult, Stage, Team, Template } from '../types.js';

/**
 * A raw Supabase payload before it is mapped into a types.ts model: a table
 * row, an RPC result row, or a joined/embedded row. The client is created
 * without generated Database types, so these are genuinely untyped JSON —
 * the map*Row() functions below are the one place each is given a real type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
/** A patch whose keys are already the table's own (snake_case) column names. */
type ColumnPatch = Record<string, unknown>;
/** Body of an edge-function call. */
type Payload = Record<string, unknown>;
import { db } from './persist.js';
import { loadRolesAndPermissions } from '../core/permissions.js';
import { cfClean, loadFieldConfig } from '../core/fields.js';
import { loadStatusConfig } from '../core/statuses.js';

const url = (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) || undefined;
const anonKey = (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) || undefined;

// Supabase's client persists its own session (localStorage, per its own
// defaults) — that's the "persist session per Supabase client defaults"
// the stage prompt asks for, so nothing here re-implements session storage.
export const supabase: SupabaseClient | null = (url && anonKey) ? createClient(url, anonKey) : null;

function requireClient(): SupabaseClient {
  if(!supabase) throw new Error("repo-supabase: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example)");
  return supabase;
}

/**
 * Real Supabase Auth check, demo-shaped result. Supabase's own error
 * message is deliberately not surfaced — like the original inline
 * signInWithPassword(), a wrong email and a wrong password produce the
 * exact same "invalid" outcome, never revealing which one was wrong.
 *
 * Stage 12: db.members is no longer the local seed roster stood in for a
 * real one — loadMembersConfig() (below, part of loadWorkspaceConfig())
 * now loads the actual `members` table, so `me` is resolved by matching
 * the signed-in email against that freshly-loaded array instead of the
 * old findLocalMember() lookup into the seed.
 */
export async function signInWithPassword(email: string, pw: string): Promise<SignInResult> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password: pw });
  if(error) return {ok:false, reason:"invalid"};
  await Promise.all([loadRolesAndPermissions(), loadWorkspaceConfig()]);
  const m = db.members.find(x=>x.email.toLowerCase()===String(email).toLowerCase());
  if(!m){
    // A real, authenticated Supabase session now exists for someone the
    // app is about to refuse — signing it back out immediately (not part
    // of the original demo, which had no real session to worry about) is
    // the only way to avoid leaving a live "signed in but blocked" token
    // lying around in the browser.
    await client.auth.signOut();
    return {ok:false, reason:"invalid"};
  }
  if(!m.active){
    await client.auth.signOut();
    return {ok:false, reason:"inactive"};
  }
  return {ok:true, member:m};
}

export async function signOut(): Promise<void> {
  if(!supabase) return;
  await supabase.auth.signOut();
}

/** Session restore on reload: ask Supabase who's signed in (it keeps its
 * own persisted session), then resolve that back to the real member row
 * the rest of the app already knows how to work with. */
export async function getSessionMember(): Promise<Member | null> {
  if(!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const email = data?.session?.user?.email;
  if(!email) return null;
  await Promise.all([loadRolesAndPermissions(), loadWorkspaceConfig()]);
  const m = db.members.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(!m || !m.active) return null;
  return m;
}

/** lists has no dedicated core/ module (unlike roles/fields/statuses) — its
 * loader lives here instead. Stage 5's #leads/#lead/#lists/#list/:id/
 * Settings only need db.lists' names/archived state for dropdowns, cards
 * and the lists index; the leads *in* a list come from leads.search()
 * below (p_list), not from this. */
async function loadListsConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const { data: rows, error } = await supabase
    .from('lists').select('id,name,archived,created_at').eq('org_id', memberRow.org_id);
  if(error || !rows) return;
  db.lists = rows.map(r => ({ id:r.id, name:r.name, archived:r.archived, createdAt:r.created_at }));
}

/** Stage 6: activityForm()'s outcome buttons and log_activity()'s own
 * outcome lookup both need the real `outcomes` table's rows — same
 * "no dedicated core/ module, loader lives here" shape as loadListsConfig()
 * above. Disabled outcomes are kept (not filtered out) since Settings'
 * Outcomes tab still lists and lets you re-enable them, exactly like
 * db.outcomes always has on the local backend. */
async function loadOutcomesConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const { data: rows, error } = await supabase
    .from('outcomes').select('id,name,conv,appt,dnc,disabled').eq('org_id', memberRow.org_id).order('id');
  if(error || !rows) return;
  db.outcomes = rows.map(r => ({ id:r.id, name:r.name, conv:r.conv, appt:r.appt, dnc:r.dnc, disabled:r.disabled }));
}

/** Stage 8: db.templates (templatesDlg()'s reusable message bodies) and
 * db.campaigns (V.campaigns/V.campaign/campaignForm()'s "Start from a
 * template" dropdown, campaign type, etc.) are both small, org-wide tables
 * with no per-member visibility rule — same "no dedicated core/ module,
 * loader lives here, no RLS needed" shape as loadListsConfig()/
 * loadOutcomesConfig() above. db.campaignLeads (one row per lead per
 * campaign, potentially large) is deliberately NOT loaded here — see the
 * comment on hydrateCampaignCard() in features/campaigns.js for why it's
 * cleared instead. */
async function loadTemplatesConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const { data: rows, error } = await supabase
    .from('templates').select('id,name,style,body').eq('org_id', memberRow.org_id).order('id');
  if(error || !rows) return;
  db.templates = rows.map(r => ({ id:r.id, name:r.name, style:r.style, body:r.body }));
}
async function loadCampaignsConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const { data: rows, error } = await supabase
    .from('campaigns').select('id,name,type,body,archived,duplicated_from,created_at').eq('org_id', memberRow.org_id).order('created_at');
  if(error || !rows) return;
  db.campaigns = rows.map(r => ({ id:r.id, name:r.name, type:r.type, body:r.body, archived:r.archived, duplicatedFrom:r.duplicated_from, createdAt:r.created_at }));
  db.campaignLeads = [];
}

/** Stage 9: db.imports (views/imports.js's "Import history" table) — same
 * small-org-wide-table shape as templates/campaigns above. The rows this
 * creates (leads/phones/notes/custom values) never come through here —
 * see features/imports.js and supabase/functions/import-run for why that
 * whole path (duplicate matching + the actual writes) runs server-side
 * instead. leadIds is left empty on this backend: every render that used
 * to read job.leadIds.length (the Undo button's visibility, the confirm
 * dialog's lead count) reads job.imported instead, which import-run's
 * commit/check actions already keep numerically identical to it. */
async function loadImportsConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const { data: rows, error } = await supabase
    .from('imports').select('id,file,list_id,rows,imported,dups,status,by_id,at').eq('org_id', memberRow.org_id).order('at');
  if(error || !rows) return;
  db.imports = rows.map(r => ({ id:r.id, file:r.file, listId:r.list_id, rows:r.rows, imported:r.imported, dups:r.dups, status:r.status, by:r.by_id, at:r.at, leadIds:[] }));
}

/** Stage 10: pipelines/stages have no RLS of their own (same "small,
 * org-wide table, client filters by org_id" shape as templates/campaigns —
 * Stages 8/9's own precedent) — loaded once at sign-in exactly like those.
 * db.deals is deliberately NOT loaded wholesale here (deals can be numerous
 * per pipeline, same reasoning as db.campaignLeads in loadCampaignsConfig()
 * above) — crm.search() below hydrates it page-window by page-window
 * instead, the same "search RPC + additive hydrate" shape leads.search()/
 * supabaseFilteredLeads() (features/leads.js) already use. */
async function loadCrmConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const [{ data: pipeRows, error: pErr }, { data: stageRows, error: sErr }] = await Promise.all([
    supabase.from('pipelines').select('id,name,kind,archived,created_at').eq('org_id', memberRow.org_id).order('created_at'),
    supabase.from('stages').select('id,pipeline_id,name,prob,kind,color,archived,position').eq('org_id', memberRow.org_id).order('position'),
  ]);
  if(pErr || sErr || !pipeRows) return;
  db.pipelines = pipeRows.map(p => ({
    id:p.id, name:p.name, kind:p.kind, archived:p.archived, createdAt:p.created_at,
    stages: (stageRows||[]).filter(s=>s.pipeline_id===p.id).map(s => ({ id:s.id, name:s.name, prob:s.prob, kind:s.kind, color:s.color, archived:s.archived, position:s.position })),
  }));
  db.deals = [];
}

/** Stage 12: db.members finally comes from the real `members` table
 * instead of standing in on the local seed's 3 rows forever — Admin's
 * Users tab (and every memberName()/teamsOf() lookup elsewhere in the
 * app) needs the real roster, not just real auth. member_lists (a
 * member's own list subscriptions, independent of team_lists) has no
 * dedicated UI of its own yet — Stage 12's own "member_lists ... saved,
 * still not used for scoping" note — but userDlg()'s Lists checklist
 * still needs to show what's already selected, so it's loaded here too. */
function mapMemberRow(r: Row, listIds: number[]=[]): Member {
  return {
    id:r.id, first:r.first, last:r.last, name:`${r.first} ${r.last}`.trim(),
    email:r.email, role:r.role_id, active:r.active, mustChangePw:r.must_change_pw,
    lastLogin:r.last_login, deactivatedAt:r.deactivated_at, createdBy:r.created_by,
    createdAt:r.created_at, listIds, demoLogin:false,
  };
}
async function loadMembersConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const [{ data: rows, error }, { data: mlRows }] = await Promise.all([
    supabase.from('members').select('*').eq('org_id', memberRow.org_id).order('created_at'),
    supabase.from('member_lists').select('member_id,list_id').eq('org_id', memberRow.org_id),
  ]);
  if(error || !rows) return;
  const listsByMember: Record<number, number[]> = {};
  for(const r of (mlRows||[])) (listsByMember[r.member_id] ??= []).push(r.list_id);
  db.members = rows.map(r => mapMemberRow(r, listsByMember[r.id]||[]));
}

/** Stage 12: db.teams (the current roster, colour/logo/manager, and the
 * lists/campaigns a team owns) from the real `teams`/`team_members`/
 * `team_lists`/`team_campaigns` tables — same "small org-wide tables,
 * client filters by org_id, no RLS of their own" shape as
 * pipelines/stages (loadCrmConfig() above). */
async function loadTeamsConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const org_id = memberRow.org_id;
  const [{ data: teamRows, error }, { data: tm }, { data: tl }, { data: tc }] = await Promise.all([
    supabase.from('teams').select('*').eq('org_id', org_id).order('created_at'),
    supabase.from('team_members').select('team_id,member_id').eq('org_id', org_id),
    supabase.from('team_lists').select('team_id,list_id').eq('org_id', org_id),
    supabase.from('team_campaigns').select('team_id,campaign_id').eq('org_id', org_id),
  ]);
  if(error || !teamRows) return;
  const membersByTeam: Record<number, number[]> = {}, listsByTeam: Record<number, number[]> = {}, campsByTeam: Record<number, number[]> = {};
  for(const r of (tm||[])) (membersByTeam[r.team_id] ??= []).push(r.member_id);
  for(const r of (tl||[])) (listsByTeam[r.team_id] ??= []).push(r.list_id);
  for(const r of (tc||[])) (campsByTeam[r.team_id] ??= []).push(r.campaign_id);
  db.teams = teamRows.map(t => ({
    id:t.id, name:t.name, description:t.description, color:t.color, logo:t.logo_url,
    managerId:t.manager_id, memberIds: membersByTeam[t.id]||[], listIds: listsByTeam[t.id]||[],
    campaignIds: campsByTeam[t.id]||[], archived:t.archived, createdAt:t.created_at,
  }));
}

/** Stage 12: db.teamHistory (userActivity()'s "Team history" list,
 * teamDlg()'s own join/leave bookkeeping) from the real `team_history`
 * table — same shape as loadTeamsConfig() above. */
async function loadTeamHistoryConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const { data: rows, error } = await supabase
    .from('team_history').select('team_id,member_id,joined,left').eq('org_id', memberRow.org_id);
  if(error || !rows) return;
  db.teamHistory = rows.map(r => ({ userId:r.member_id, teamId:r.team_id, joined:r.joined, left:r.left }));
}

async function loadWorkspaceConfig(): Promise<void> {
  await Promise.all([loadFieldConfig(), loadStatusConfig(), loadListsConfig(), loadOutcomesConfig(), loadTemplatesConfig(), loadCampaignsConfig(), loadImportsConfig(), loadCrmConfig(), loadMembersConfig(), loadTeamsConfig(), loadTeamHistoryConfig()]);
}

/** "Change your password" screen, Supabase backend: a real credential
 * update. Unlike the local backend, there's no cheap way to check the new
 * password against the old one first (that would need a second real
 * sign-in call), so that one demo nicety — "Choose a different password
 * from the temporary one" — only fires on the local backend; see
 * core/session.js's changePasswordSubmit(). */
export async function updatePassword(_member: unknown, newPw: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.updateUser({ password: newPw });
  if(error) throw error;
  // Stage 12: must_change_pw lives on the real members row now (it's what
  // loadMembersConfig() reloads on every sign-in), so it has to be cleared
  // there too — otherwise a user who just changed their forced temporary
  // password would be sent straight back to "Choose a new password" the
  // very next time they signed in.
  const id = await myMemberId();
  if(id){ const { error: mErr } = await supabase!.from('members').update({ must_change_pw:false }).eq('id', id); if(mErr) throw mErr; }
}

/** Which org the signed-in Supabase user belongs to — the client has no
 * standing org concept (the demo itself is single-tenant), so this is
 * looked up fresh each time a roles.* call needs to send org_id to
 * save-permissions. */
async function myOrgId(): Promise<number | string | null> {
  const { data:{ user } } = await supabase!.auth.getUser();
  if(!user) return null;
  const { data } = await supabase!.from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  return data?.org_id ?? null;
}

/** logActivity()'s follow-up fallback assignee (`l.assigned || me.id`) and
 * addNote()'s user_id both need "my own member id", same lookup shape as
 * myOrgId() just for the other column. */
async function myMemberId(): Promise<number | null> {
  const { data:{ user } } = await supabase!.auth.getUser();
  if(!user) return null;
  const { data } = await supabase!.from('members').select('id').eq('auth_user_id', user.id).maybeSingle();
  return data?.id ?? null;
}

/** roles/role_permissions have no RLS of their own (Stage 4's migration only
 * covers the five tables can() itself gates) — every write here goes
 * through the save-permissions edge function instead, which re-checks the
 * same can("createRoles")/can("editPermissions") the client already
 * checked before showing the button, plus the demo's save-time guards
 * (own-Edit-permissions, the immutable Super Administrator role, the
 * in-use guard on delete). Its error messages are the demo's own toast
 * text, so views/admin.js can show them unchanged. */
async function callRolesFunction(action: string, payload: Payload){
  const client = requireClient();
  const org_id = await myOrgId();
  if(!org_id) throw new Error("Not signed in");
  const { data, error } = await client.functions.invoke('save-permissions', { body: { action, org_id, ...payload } });
  if(error){
    let message = error.message;
    try{ const body = await error.context?.json?.(); if(body?.error) message = body.error; }catch{ /* fall back to error.message */ }
    throw new Error(message);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}

/**
 * Port of views/admin.js's ADM.roles data access. "Select all" / "Clear
 * all" / "Copy from" stay pure client-side checkbox toggles in admin.js
 * (permsSetAll/permsCopyFrom already touch nothing but the DOM, nothing to
 * port) — list/detail/save/create/rename/delete are the calls that
 * actually read or write role data, so those are what live here.
 */
export const roles = {
  /** db.roles is already the full, current list — loadRolesAndPermissions()
   * (core/permissions.js) keeps it in sync at session start and after every
   * write below. */
  list: (): Role[] => db.roles,
  detail: (id: string): Role | undefined => db.roles.find(r=>r.id===id),
  /** savePermissions(): the full next perms map for one non-super-admin role. */
  async save(roleId: string, perms: Record<string, boolean>): Promise<void> {
    await callRolesFunction('save_permissions', { role_id: roleId, perms });
    await loadRolesAndPermissions();
  },
  /** roleDlg()'s "New role" path: id is generated client-side the same way
   * nid() would (a short random slug), matching the demo's own "r"+nid(). */
  async create(roleId: string, name: string, description: string, baseRoleId?: string | null): Promise<void> {
    await callRolesFunction('create_role', { role_id: roleId, name, description, base_role_id: baseRoleId || null });
    await loadRolesAndPermissions();
  },
  /** roleDlg()'s "Rename role" path. */
  async rename(roleId: string, name: string, description: string): Promise<void> {
    await callRolesFunction('rename_role', { role_id: roleId, name, description });
    await loadRolesAndPermissions();
  },
  /** deleteRole(): the edge function itself re-checks the in-use guard, so
   * the exact demo toast text ("N users have this role — move them to
   * another role first") comes back as this rejection's message either way. */
  async delete(roleId: string): Promise<void> {
    await callRolesFunction('delete_role', { role_id: roleId });
    await loadRolesAndPermissions();
  },
};

/** Two privileged operations — creating a real Supabase Auth account and
 * resetting someone else's password — that a client can never do with its
 * own anon-key session, so both go through a service-role edge function,
 * same "server re-checks the permission the client already gated the
 * button on" shape callRolesFunction()/save-permissions uses above. Every
 * other user/team write below has no such privileged step (no auth.admin
 * call needed), so it's a plain table write instead, same "no RLS of its
 * own, client filters/gates by org_id and can()" shape lists/templates/
 * campaigns/pipelines already use. */
async function callAdminFunction(name: string, payload: Payload){
  const client = requireClient();
  const { data, error } = await client.functions.invoke(name, { body: payload });
  if(error){
    let message = error.message;
    try{ const body = await error.context?.json?.(); if(body?.error) message = body.error; }catch{ /* fall back to error.message */ }
    throw new Error(message);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}

// ------------------------------------------------------------------ users
export const users = {
  /** saveUser()'s "New user" path: admin-create-user creates the real
   * Auth account and members row server-side (re-checking createUsers
   * itself) and returns the one-time temporary password the "User
   * created" dialog shows — the same password the admin already chose or
   * regenerated in the dialog, passed through unchanged. */
  async create({first, last, email, roleId, temporaryPassword, mustChangePw}: { first: string; last: string; email: string; roleId: string; temporaryPassword: string; mustChangePw: boolean }): Promise<{ member: Member; password: string }> {
    const org_id = await myOrgId();
    if(!org_id) throw new Error("Not signed in");
    const data = await callAdminFunction('admin-create-user', {
      org_id, first, last, email, role_id: roleId,
      temporary_password: temporaryPassword, must_change_pw: mustChangePw,
    });
    return { member: mapMemberRow(data.member, []), password: data.temporary_password };
  },
  /** saveUser()'s "Edit user" path, and toggleMember()/deactivate()'s
   * active flag — patch is already the members table's own column names. */
  async update(id: number, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('members').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** userDlg()'s Lists checklist. */
  async setLists(memberId: number, listIds: number[]): Promise<void> {
    const org_id = await myOrgId();
    const { error: delErr } = await supabase!.from('member_lists').delete().eq('member_id', memberId);
    if(delErr) throw new Error(delErr.message);
    if(listIds.length){
      const { error } = await supabase!.from('member_lists').insert(listIds.map(list_id => ({org_id, member_id:memberId, list_id})));
      if(error) throw new Error(error.message);
    }
  },
  /** resetPasswordDlg(): admin-reset-password sets a new Auth password and
   * must_change_pw server-side and returns that one-time password, same
   * shape as create() above. */
  async resetPassword(id: number, {temporaryPassword, mustChangePw}: { temporaryPassword: string; mustChangePw: boolean }): Promise<string> {
    const org_id = await myOrgId();
    if(!org_id) throw new Error("Not signed in");
    const data = await callAdminFunction('admin-reset-password', {
      org_id, member_id: id, temporary_password: temporaryPassword, must_change_pw: mustChangePw,
    });
    return data.temporary_password;
  },
};

// ------------------------------------------------------------------ teams
export const TEAM_STORAGE_BUCKET = 'team-logos';
export const teams = {
  async create({name, description, color, logo, managerId, memberIds, listIds, campaignIds}: Pick<Team, 'name' | 'description' | 'color' | 'memberIds' | 'listIds' | 'campaignIds'> & { logo?: string | null; managerId?: number | null }): Promise<number> {
    const org_id = await myOrgId();
    if(!org_id) throw new Error("Not signed in");
    const { data, error } = await supabase!.from('teams').insert({
      org_id, name, description, color, logo_url: logo||null, manager_id: managerId||null,
    }).select().single();
    if(error) throw new Error(error.message);
    await Promise.all([
      teams.setMembers(data.id, memberIds),
      teams.setLists(data.id, listIds),
      teams.setCampaigns(data.id, campaignIds),
    ]);
    return data.id;
  },
  async update(id: number, {name, description, color, logo, managerId}: Pick<Team, 'name' | 'description' | 'color'> & { logo?: string | null; managerId?: number | null }): Promise<void> {
    const { error } = await supabase!.from('teams').update({
      name, description, color, logo_url: logo||null, manager_id: managerId||null,
    }).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** teamDlg()'s Members checklist, from the team's side: diff the
   * current roster against the submitted one, writing team_members and a
   * team_history row for every join/leave — the exact same bookkeeping
   * the local backend's own setUserTeams() does, just from the other
   * direction (one team, many members here; setForMember below is one
   * member, many teams, for userDlg()'s own Teams checklist). */
  async setMembers(teamId: number, memberIds: number[]): Promise<void> {
    const org_id = await myOrgId();
    const { data: current, error } = await supabase!.from('team_members').select('member_id').eq('team_id', teamId);
    if(error) throw new Error(error.message);
    const currentIds = (current||[]).map(r=>r.member_id);
    const toAdd = memberIds.filter(id=>!currentIds.includes(id));
    const toRemove = currentIds.filter(id=>!memberIds.includes(id));
    const now = new Date().toISOString();
    if(toAdd.length){
      const { error: e1 } = await supabase!.from('team_members').insert(toAdd.map(member_id=>({org_id, team_id:teamId, member_id})));
      if(e1) throw new Error(e1.message);
      const { error: e2 } = await supabase!.from('team_history').insert(toAdd.map(member_id=>({org_id, team_id:teamId, member_id, joined:now})));
      if(e2) throw new Error(e2.message);
    }
    for(const member_id of toRemove){
      const { error: e3 } = await supabase!.from('team_members').delete().eq('team_id', teamId).eq('member_id', member_id);
      if(e3) throw new Error(e3.message);
      const { data: openHist } = await supabase!.from('team_history').select('id').eq('team_id', teamId).eq('member_id', member_id).is('left', null).order('joined', {ascending:false}).limit(1).maybeSingle();
      if(openHist){ const { error: e4 } = await supabase!.from('team_history').update({left:now}).eq('id', openHist.id); if(e4) throw new Error(e4.message); }
    }
  },
  /** userDlg()'s own Teams checklist: same diff/history bookkeeping as
   * setMembers() above, but for every team relative to one member — the
   * exact shape setUserTeams(userId, teamIds) already loops through
   * locally, including clearing a team's managerId if the member removed
   * from it was that team's manager. */
  async setForMember(memberId: number, teamIds: number[]): Promise<void> {
    const org_id = await myOrgId();
    const { data: current, error } = await supabase!.from('team_members').select('team_id').eq('member_id', memberId);
    if(error) throw new Error(error.message);
    const currentTeamIds = (current||[]).map(r=>r.team_id);
    const toAdd = teamIds.filter(id=>!currentTeamIds.includes(id));
    const toRemove = currentTeamIds.filter(id=>!teamIds.includes(id));
    const now = new Date().toISOString();
    if(toAdd.length){
      const { error: e1 } = await supabase!.from('team_members').insert(toAdd.map(team_id=>({org_id, team_id, member_id:memberId})));
      if(e1) throw new Error(e1.message);
      const { error: e2 } = await supabase!.from('team_history').insert(toAdd.map(team_id=>({org_id, team_id, member_id:memberId, joined:now})));
      if(e2) throw new Error(e2.message);
    }
    for(const team_id of toRemove){
      const { error: e3 } = await supabase!.from('team_members').delete().eq('team_id', team_id).eq('member_id', memberId);
      if(e3) throw new Error(e3.message);
      const { data: openHist } = await supabase!.from('team_history').select('id').eq('team_id', team_id).eq('member_id', memberId).is('left', null).order('joined', {ascending:false}).limit(1).maybeSingle();
      if(openHist){ const { error: e4 } = await supabase!.from('team_history').update({left:now}).eq('id', openHist.id); if(e4) throw new Error(e4.message); }
      await supabase!.from('teams').update({manager_id:null}).eq('id', team_id).eq('manager_id', memberId);
    }
  },
  async setLists(teamId: number, listIds: number[]): Promise<void> {
    const org_id = await myOrgId();
    const { error: delErr } = await supabase!.from('team_lists').delete().eq('team_id', teamId);
    if(delErr) throw new Error(delErr.message);
    if(listIds.length){ const { error } = await supabase!.from('team_lists').insert(listIds.map(list_id=>({org_id, team_id:teamId, list_id}))); if(error) throw new Error(error.message); }
  },
  async setCampaigns(teamId: number, campaignIds: number[]): Promise<void> {
    const org_id = await myOrgId();
    const { error: delErr } = await supabase!.from('team_campaigns').delete().eq('team_id', teamId);
    if(delErr) throw new Error(delErr.message);
    if(campaignIds.length){ const { error } = await supabase!.from('team_campaigns').insert(campaignIds.map(campaign_id=>({org_id, team_id:teamId, campaign_id}))); if(error) throw new Error(error.message); }
  },
  async archive(id: number): Promise<void> { const { error } = await supabase!.from('teams').update({archived:true}).eq('id', id); if(error) throw new Error(error.message); },
  async restore(id: number): Promise<void> { const { error } = await supabase!.from('teams').update({archived:false}).eq('id', id); if(error) throw new Error(error.message); },
  /** teamLogoPick(): uploads to the `team-logos` Storage bucket (public,
   * created once as an ops step — same "assumed to exist" shape the
   * edge functions' own "Deploy: supabase functions deploy ..." comments
   * document elsewhere in this repo) and returns only the resulting public
   * URL — it does NOT touch the teams table itself. teamLogoPick() fires
   * on the file input's change event, which for a brand-new team happens
   * before "Create team" is clicked, so there's no teamId yet to write to
   * at upload time; instead this uploads to an org-scoped path and hands
   * the URL back for teamDlg()'s save handler to stash in window._tLogo,
   * exactly like the local backend already does with its base64 dataURL.
   * create()/update() above are the only places logo_url is ever written,
   * via their existing `logo` param. The ≤400 KB check is also enforced
   * here, not just client-side in teamLogoPick(), since nothing stops a
   * direct API call from skipping the UI's own check. */
  async uploadLogo(file: File): Promise<string> {
    if(file.size > 400*1024) throw new Error("Logo must be under 400 KB");
    const org_id = await myOrgId();
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${org_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabase!.storage.from(TEAM_STORAGE_BUCKET).upload(path, file, { upsert:true, contentType: file.type || undefined });
    if(upErr) throw new Error(upErr.message);
    const { data } = supabase!.storage.from(TEAM_STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  },
};

// ------------------------------------------------------------------ leads
/** search_leads()'s row shape -> the local demo lead shape everything else
 * (leadCell()/badge()/dncBadges()/full()/...) already expects. A row from
 * this function is a read-only snapshot for display, not a live db.leads
 * entry — there's no local activities/follow_ups/lead_lists array to back
 * attempts()/lastAct()/nextFu()/listNames()/leadCampaigns() the way the
 * local backend's do, so those derived values are carried directly on the
 * mapped object (the "_"-prefixed fields) instead; views/leads.js and
 * views/lists.js read those instead of calling attempts()/lastAct()/etc.
 * when BACKEND is "supabase". */
function mapSearchRow(r: Row): Lead {
  return {
    id:r.id, first:r.first, last:r.last, email:r.email||"", addr:r.addr||"", city:r.city||"",
    state:r.state||"", zip:r.zip||"", assigned:r.assigned_id, status:r.status_key,
    dnc:r.dnc, dnt:r.dnt, dncontact:r.dncontact, archived:false, source:r.source, createdAt:r.created_at,
    phones: r.phone ? [{n:r.phone, type:"mobile"}] : [], listIds:[], custom:{},
    _attempts:r.attempts, _lastAttemptAt:r.last_attempt_at, _lastOutcomeId:r.last_outcome_id,
    _nextFollowUpDue:r.next_follow_up_due, _listNamesText:r.list_names||"", _campaignNamesText:r.campaign_names||"",
  };
}

export const leads = {
  /** #lead/:id, outside of any search: fetch one lead's full record (every
   * phone, every list, every custom value — not just the primary phone
   * search_leads() carries) so views/lead.js can render it exactly like a
   * local db.leads entry. */
  async get(id: number): Promise<Lead | null> {
    const [{ data: lead, error }, { data: phones }, { data: listRows }, { data: customRows }] = await Promise.all([
      supabase!.from('leads').select('*').eq('id', id).maybeSingle(),
      supabase!.from('lead_phones').select('n,type,position').eq('lead_id', id).order('position'),
      supabase!.from('lead_lists').select('list_id').eq('lead_id', id),
      supabase!.from('lead_custom_values').select('field_key,value').eq('lead_id', id),
    ]);
    if(error) throw new Error(error.message);
    if(!lead) return null;
    const custom: CustomValues = {}; for(const r of customRows || []) custom[r.field_key] = r.value;
    return {
      id: lead.id, first: lead.first, last: lead.last, email: lead.email || "", addr: lead.addr || "",
      city: lead.city || "", state: lead.state || "", zip: lead.zip || "", assigned: lead.assigned_id,
      status: lead.status_key, dnc: lead.dnc, dnt: lead.dnt, dncontact: lead.dncontact, archived: lead.archived,
      source: lead.source, createdAt: lead.created_at,
      phones: (phones || []).map(p => ({n: p.n, type: p.type})),
      listIds: (listRows || []).map(r => r.list_id),
      custom,
    };
  },
  /** features/leads.js's filteredLeads(), server-side: same params
   * (q/status/assigned/list/campaign/dnc/fu/outcome/attMin/attMax/laFrom/
   * laTo/sort), plus page/pageSize since search_leads() paginates too —
   * returns {rows, total} for the pager views/leads.js already draws. */
  async search(params: LeadSearchParams): Promise<{ rows: Lead[]; total: number }> {
    const client = requireClient();
    const { data, error } = await client.rpc('search_leads', {
      p_q: params.q || '', p_status: params.status || null, p_assigned: params.assigned || null,
      p_list: params.list || null, p_campaign: params.campaign || null,
      p_dnc: params.dnc || 'any', p_fu: params.fu || 'any', p_outcome: params.outcome || null,
      p_att_min: params.attMin ?? null, p_att_max: params.attMax ?? null,
      p_la_from: params.laFrom || null, p_la_to: params.laTo || null,
      p_sort: params.sort || 'name', p_page: params.page || 0, p_page_size: params.pageSize || 25,
    });
    if(error) throw new Error(error.message);
    const rows = (data || []).map(mapSearchRow);
    const total = data?.[0]?.total_count ?? 0;
    return { rows, total };
  },
  /** leadForm()'s isNew branch. Duplicate-phone rejection comes back from
   * the lead_phones trigger (migration 0016) with the demo's own message
   * ("That number already belongs to <name>"), same text either backend. */
  async create({first, last, email, addr, city, state, zip, phone, listId, assigned}: { first: string; last: string; email?: string; addr?: string; city?: string; state?: string; zip?: string; phone?: string | null; listId?: number | null; assigned?: number | null }): Promise<number> {
    const org_id = await myOrgId();
    const { data: lead, error } = await supabase!.from('leads').insert({
      org_id, first, last, email: email||'', addr: addr||'', city: city||'', state: state||'', zip: zip||'',
      assigned_id: assigned || null, status_key: 'new', source: 'manual',
    }).select().single();
    if(error) throw new Error(error.message);
    if(phone){
      const { error: pErr } = await supabase!.from('lead_phones').insert({ org_id, lead_id: lead.id, n: phone, type: 'mobile', position: 0 });
      if(pErr) throw new Error(pErr.message);
    }
    if(listId){
      const { error: lErr } = await supabase!.from('lead_lists').insert({ org_id, lead_id: lead.id, list_id: listId });
      if(lErr) throw new Error(lErr.message);
    }
    return lead.id;
  },
  /** leadForm()'s edit branch: first/last/email/addr/city/state/zip, plus
   * the primary phone number if the form's Phone field changed. */
  async update(id: number, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('leads').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async updatePrimaryPhone(leadId: number, n: string): Promise<void> {
    const { data: existing } = await supabase!.from('lead_phones').select('id').eq('lead_id', leadId).order('position').limit(1).maybeSingle();
    if(existing){ const { error } = await supabase!.from('lead_phones').update({n}).eq('id', existing.id); if(error) throw new Error(error.message); }
    else { const org_id = await myOrgId(); const { error } = await supabase!.from('lead_phones').insert({org_id, lead_id:leadId, n, type:'mobile', position:0}); if(error) throw new Error(error.message); }
  },
  async setStatus(id: number, statusKey: string): Promise<void> {
    const { error } = await supabase!.from('leads').update({status_key: statusKey}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async setDnc(id: number, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('leads').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async archive(id: number): Promise<void> {
    const { error } = await supabase!.from('leads').update({archived:true}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async bulkArchive(ids: number[]): Promise<void> {
    const { error } = await supabase!.from('leads').update({archived:true}).in('id', ids);
    if(error) throw new Error(error.message);
  },
  /** reassign(): also reassigns that lead's pending follow-ups. */
  async bulkReassign(ids: number[], toMemberId: number | null): Promise<void> {
    const { error } = await supabase!.from('leads').update({assigned_id: toMemberId}).in('id', ids);
    if(error) throw new Error(error.message);
    const { error: fErr } = await supabase!.from('follow_ups').update({assignee_id: toMemberId}).in('lead_id', ids).eq('status', 'pending');
    if(fErr) throw new Error(fErr.message);
  },
  async bulkAddToList(ids: number[], listId: number): Promise<void> {
    const org_id = await myOrgId();
    const { error } = await supabase!.from('lead_lists').upsert(ids.map(lead_id => ({org_id, lead_id, list_id: listId})), {onConflict: 'lead_id,list_id', ignoreDuplicates: true});
    if(error) throw new Error(error.message);
  },
  /** addPhone(): "Already on this lead" is checked here (cheap, and a
   * clearer message than the trigger's cross-lead one); the trigger still
   * catches the cross-lead case as the source of truth. */
  async addPhone(leadId: number, n: string, type: string): Promise<void> {
    const { data: mine } = await supabase!.from('lead_phones').select('id').eq('lead_id', leadId).eq('n', n).maybeSingle();
    if(mine) throw new Error('Already on this lead');
    const org_id = await myOrgId();
    const { error } = await supabase!.from('lead_phones').insert({org_id, lead_id: leadId, n, type});
    if(error) throw new Error(error.message);
  },
  /** saveCustom(): cfClean() runs here first, same as setCustom() does
   * locally — migration 0016's validate_lead_custom_value trigger is the
   * server-side re-check the stage asks for, catching anything that
   * reaches the database without having gone through cfClean() first. */
  async saveCustom(leadId: number, values: Record<string, unknown>): Promise<string[]> {
    const org_id = await myOrgId();
    const problems: string[] = [];
    for(const k of Object.keys(values)){
      const f = db.customFields.find(x => x.key === k && x.active); if(!f) continue;
      let clean;
      try{ clean = cfClean(f, values[k]); }
      catch(e){ problems.push((e as Error).message); continue; }
      if(clean === null){
        const { error } = await supabase!.from('lead_custom_values').delete().eq('lead_id', leadId).eq('field_key', k);
        if(error) problems.push(error.message);
      } else {
        const { error } = await supabase!.from('lead_custom_values').upsert({org_id, lead_id: leadId, field_key: k, value: clean}, {onConflict: 'lead_id,field_key'});
        if(error) problems.push(error.message);
      }
    }
    return problems;
  },
};

// ------------------------------------------------------------------ lists
export const lists = {
  list: (): List[] => db.lists,
  async create(name: string): Promise<List> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('lists').insert({org_id, name}).select().single();
    if(error) throw new Error(error.message);
    return { id:data.id, name:data.name, archived:data.archived, createdAt:data.created_at };
  },
  async rename(id: number, name: string): Promise<void> {
    const { error } = await supabase!.from('lists').update({name}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async archive(id: number): Promise<void> {
    const { error } = await supabase!.from('lists').update({archived:true}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async removeLead(leadId: number, listId: number): Promise<void> {
    const { error } = await supabase!.from('lead_lists').delete().eq('lead_id', leadId).eq('list_id', listId);
    if(error) throw new Error(error.message);
  },
  /** assignList(): every non-archived lead currently on the list. Returns
   * how many were reassigned, same as the demo's own toast count. */
  async assignAll(listId: number, memberId: number | null): Promise<number> {
    const { data: rows, error: selErr } = await supabase!
      .from('lead_lists').select('lead_id, leads!inner(archived)').eq('list_id', listId).eq('leads.archived', false);
    if(selErr) throw new Error(selErr.message);
    const ids = (rows || []).map(r => r.lead_id);
    if(ids.length){
      const { error } = await supabase!.from('leads').update({assigned_id: memberId}).in('id', ids);
      if(error) throw new Error(error.message);
    }
    return ids.length;
  },
};

// --------------------------------------------------------------- statuses
export const statuses = {
  list: () => db.settings.statuses,
  async create(key: string, label: string, tone?: string): Promise<void> {
    const org_id = await myOrgId();
    const order = Math.max(0, ...db.settings.statuses.map((_,i)=>i)) + 1;
    const { error } = await supabase!.from('statuses').insert({org_id, key, label, tone: tone||'', active:true, order});
    if(error) throw new Error(error.message);
  },
  async update(key: string, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('statuses').update(patch).eq('key', key);
    if(error) throw new Error(error.message);
  },
  /** deleteStatus(): every lead on this status moves to "new" first (same
   * order the demo does it in, so nothing is ever left pointing at a
   * status row that's about to disappear), then the status itself goes. */
  async delete(key: string): Promise<void> {
    const org_id = await myOrgId();
    const { error: e1 } = await supabase!.from('leads').update({status_key: 'new'}).eq('org_id', org_id).eq('status_key', key);
    if(e1) throw new Error(e1.message);
    const { error: e2 } = await supabase!.from('statuses').delete().eq('org_id', org_id).eq('key', key);
    if(e2) throw new Error(e2.message);
  },
};

// ----------------------------------------------------------------- fields
export const fields = {
  /** fieldForm()'s create path. Unique-key violations surface as
   * keyProblem()'s own "Another field already uses that name." text. */
  async customCreate(patch: Pick<CustomField, 'key' | 'label' | 'type'> & Partial<CustomField>): Promise<void> {
    const org_id = await myOrgId();
    const order = Math.max(0, ...db.customFields.map(x => x.order)) + 10;
    const { error } = await supabase!.from('custom_fields').insert({
      org_id, key: patch.key, label: patch.label, type: patch.type, choices: patch.choices || [],
      hint: patch.hint || '', in_table: !!patch.inTable, on_card: !!patch.onCard, active: true, order,
    });
    if(error) throw new Error(error.code === '23505' ? 'Another field already uses that name.' : error.message);
  },
  async customUpdate(id: number, patch: Partial<CustomField>): Promise<void> {
    const { error } = await supabase!.from('custom_fields').update({
      label: patch.label, type: patch.type, choices: patch.choices || [], hint: patch.hint || '',
      in_table: !!patch.inTable, on_card: !!patch.onCard,
    }).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async customToggle(id: number, active: boolean): Promise<void> {
    const { error } = await supabase!.from('custom_fields').update({active}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** deleteField(): its saved values and any column/card-field reference
   * are removed too, same three-part cleanup the demo does. */
  async customDelete(id: number, key: string): Promise<void> {
    const { error: e1 } = await supabase!.from('lead_custom_values').delete().eq('field_key', key);
    if(e1) throw new Error(e1.message);
    const { error: e2 } = await supabase!.from('custom_fields').delete().eq('id', id);
    if(e2) throw new Error(e2.message);
    await fields.saveColumns(
      (db.settings.tableColumns || []).filter(x => x !== key),
      (db.settings.cardFields || []).filter(x => x !== key),
    );
  },
  async customReorder(id: number, order: number): Promise<void> {
    const { error } = await supabase!.from('custom_fields').update({order}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** saveBuiltInFields(): all 8 rows at once, same as the demo's own
   * querySelectorAll("[data-bif]") loop. */
  async builtInSave(list: BuiltInField[]): Promise<void> {
    const org_id = await myOrgId();
    const rows = list.map(f => ({org_id, key: f.key, label: f.label, visible: f.visible, required: f.required, always: !!f.always}));
    const { error } = await supabase!.from('built_in_fields').upsert(rows, {onConflict: 'org_id,key'});
    if(error) throw new Error(error.message);
  },
  /** saveColumns(): org_settings' table_columns/card_fields jsonb arrays. */
  async saveColumns(tableColumns: string[], cardFields: string[]): Promise<void> {
    const org_id = await myOrgId();
    const { error } = await supabase!.from('org_settings').update({table_columns: tableColumns, card_fields: cardFields}).eq('org_id', org_id);
    if(error) throw new Error(error.message);
  },
  /** Stage 9: saveImportCfg() (views/settings.js) — the whole Settings →
   * Import tab, same one-jsonb-blob shape loadFieldConfig() reads it back
   * as. */
  async saveImportCfg(importCfg: ImportCfg): Promise<void> {
    const org_id = await myOrgId();
    const { error } = await supabase!.from('org_settings').update({import_cfg: importCfg}).eq('org_id', org_id);
    if(error) throw new Error(error.message);
  },
  /** Stage 13: saveTeamName() (views/settings.js) — Settings → Team &
   * permissions' team name / agent name fields. */
  async saveTeamName(teamName: string, agentName: string): Promise<void> {
    const org_id = await myOrgId();
    const { error } = await supabase!.from('org_settings').update({team_name: teamName, agent_name: agentName}).eq('org_id', org_id);
    if(error) throw new Error(error.message);
  },
  /** Stage 13: saveSettings() (views/settings.js) — Settings → Scoring &
   * goals' points-per-activity, weekly goal and working days. `patch` is
   * already snake_case org_settings columns (ptsCall -> pts_call etc.),
   * same "caller already knows the column names" shape stages.update()/
   * crm.update() use elsewhere in this file. */
  async saveScoring(patch: ColumnPatch): Promise<void> {
    const org_id = await myOrgId();
    const { error } = await supabase!.from('org_settings').update(patch).eq('org_id', org_id);
    if(error) throw new Error(error.message);
  },
};

/**
 * Stage 13: audit()'s (core/session.js) real persistence, plus #audit's
 * (views/audit.js) read side. audit_log has no RLS of its own (same "plain
 * client write/read, gated only by can('viewAudit') client-side" convention
 * org_settings and every other admin-only table in this file already
 * follows) so both of these are plain inserts/selects scoped to the
 * caller's own org.
 */
export async function writeAuditLog(action: string, table: string, detail: string, userId: number | null | undefined): Promise<void> {
  const org_id = await myOrgId();
  if(!org_id) return; // not signed in yet / local backend never calls this
  const { error } = await supabase!.from('audit_log').insert({ org_id, user_id: userId, action, table_name: table, detail });
  if(error) console.error('writeAuditLog:', error.message); // fire-and-forget — never block the UI action that triggered it
}
export async function listAuditLog(tableFilter?: string | null): Promise<AuditEntry[]> {
  const org_id = await myOrgId();
  if(!org_id) return [];
  let q = supabase!.from('audit_log').select('id,at,user_id,action,table_name,detail').eq('org_id', org_id).order('at', { ascending:false }).limit(200);
  if(tableFilter) q = q.eq('table_name', tableFilter);
  const { data, error } = await q;
  if(error) throw new Error(error.message);
  return (data||[]).map(r => ({ id:r.id, at:r.at, userId:r.user_id, action:r.action, table:r.table_name, detail:r.detail }));
}

/** log-activity is the only write in this file that touches more than one
 * table's worth of interlocking rules atomically (status transitions,
 * follow-up replacement, the DNC cancellation, the audit row) — same
 * "can't be five separate RLS-gated client calls without a race" reason
 * save-permissions exists, so it goes through an edge function too. Its
 * error text is the demo's own toast copy (log_activity()'s own raise
 * messages, migration 0017), so features/activity.js can show it
 * unchanged. */
/** Stage 13: data/persist.js's backup() on the supabase backend — the
 * org-backup edge function's read-only export (see its own header for why
 * there's no matching restore call). */
export async function orgBackup(){
  const client = requireClient();
  const { data: { session } } = await client.auth.getSession();
  if(!session) throw new Error("Not signed in");
  const { data, error } = await client.functions.invoke('org-backup', { body: {} });
  if(error){
    let message = error.message;
    try{ const body = await error.context?.json?.(); if(body?.error) message = body.error; }catch{ /* fall back to error.message */ }
    throw new Error(message);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}

async function callLogActivity(payload: Payload){
  const client = requireClient();
  const org_id = await myOrgId();
  if(!org_id) throw new Error("Not signed in");
  const { data, error } = await client.functions.invoke('log-activity', { body: { org_id, ...payload } });
  if(error){
    let message = error.message;
    try{ const body = await error.context?.json?.(); if(body?.error) message = body.error; }catch{ /* fall back to error.message */ }
    throw new Error(message);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}

// --------------------------------------------------------------- activities
export const activities = {
  /** logActivity(): the edge function does the whole thing as one
   * transaction (migration 0017's log_activity()) and returns the new
   * activity's id; features/activity.js refetches this lead's full
   * activity/follow-up/lead state afterward rather than re-deriving the
   * same status-transition rules a second time client-side. */
  async log(params: Payload){ return callLogActivity(params); },
  /** #lead/:id's timeline (leadActs()/attempts()/lastAct()): every
   * activity for one lead, most-recent-first — same order leadActs()
   * already sorts to, so the hydrated rows need no re-sorting. */
  async forLead(leadId: number): Promise<Activity[]> {
    const { data, error } = await supabase!
      .from('activities').select('id,lead_id,type,outcome_id,user_id,at,note,list_id,campaign_id,duration_min,phone')
      .eq('lead_id', leadId).order('at', { ascending:false });
    if(error) throw new Error(error.message);
    return (data||[]).map(r => ({
      id:r.id, leadId:r.lead_id, type:r.type, outcomeId:r.outcome_id, userId:r.user_id, at:r.at,
      note:r.note||"", listId:r.list_id, campaignId:r.campaign_id, durationMin:r.duration_min, phone:r.phone,
    }));
  },
  /** views/dashboard.js's "Recent activity" list: the most recent
   * activities this caller's RLS lets through (activities_select scopes by
   * the lead's own assignment, same visibility boundary member_stats()'s
   * null-p_member_id branch relies on), each with just enough of its lead
   * (first/last) for full() to render — hydrated into db.leads the same
   * additive way every other search path in this file already works.
   * memberId narrows to one caller's own logged activities, the same
   * "own, not just visible" distinction the local backend's own
   * `a.userId===me.id` filter draws for anyone without viewTeamReports —
   * done here (not client-side after the fact) so a non-manager still
   * gets a full page of their own most-recent rows, not whatever's left
   * after slicing an RLS-wide top-N down to their own. */
  async recent(limitN: number, memberId?: number | null): Promise<{ activity: Activity; lead: LeadPartial }[]> {
    let q = supabase!
      .from('activities')
      .select('id,lead_id,type,outcome_id,user_id,at,note,list_id,campaign_id,duration_min,phone,leads!inner(id,first,last)')
      .order('at', { ascending:false }).limit(limitN);
    if(memberId) q = q.eq('user_id', memberId);
    const { data, error } = await q;
    if(error) throw new Error(error.message);
    return (data||[]).map((r: Row) => ({
      activity: { id:r.id, leadId:r.lead_id, type:r.type, outcomeId:r.outcome_id, userId:r.user_id, at:r.at, note:r.note||"", listId:r.list_id, campaignId:r.campaign_id, durationMin:r.duration_min, phone:r.phone },
      lead: { id:r.leads.id, first:r.leads.first, last:r.leads.last },
    }));
  },
};

// --------------------------------------------------------------- followUps
export const followUps = {
  /** #lead/:id's Follow-ups card: every follow-up for one lead (any
   * status), newest-first — same order the demo's own db.followUps.filter
   * ().sort() already uses. */
  async forLead(leadId: number): Promise<FollowUp[]> {
    const { data, error } = await supabase!
      .from('follow_ups').select('id,lead_id,due,status,note,assignee_id,cancel_reason,cancelled_by,done_at,created_at')
      .eq('lead_id', leadId).order('created_at', { ascending:false });
    if(error) throw new Error(error.message);
    return (data||[]).map(mapFollowUpRow);
  },
  /** #followups: every follow-up RLS lets the caller see, joined with just
   * enough of its lead (name/address/phone/DNC flags) to render a row and
   * work its Call button — hydrated into db.leads (additive fields only,
   * see hydrateFollowUpLead()) so full()/callBtn()/isBlocked() all work
   * unchanged. archived leads are excluded, same as views/followups.js's
   * own `db.leads.find(x=>x.id===f.leadId && !x.archived)` filter. */
  async listAll(): Promise<{ fu: FollowUp; lead: LeadPartial }[]> {
    const { data, error } = await supabase!
      .from('follow_ups')
      .select('id,lead_id,due,status,note,assignee_id,cancel_reason,cancelled_by,done_at,created_at,' +
              'leads!inner(id,first,last,addr,city,zip,dnc,dnt,dncontact,assigned_id,archived,lead_phones(n,type,position))')
      .eq('leads.archived', false)
      .order('due', { ascending:true });
    if(error) throw new Error(error.message);
    return (data||[]).map((r: Row) => ({ fu: mapFollowUpRow(r), lead: mapFollowUpLeadRow(r.leads) }));
  },
  async done(id: number): Promise<void> {
    const { error } = await supabase!.from('follow_ups').update({status:'done', done_at:new Date().toISOString()}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** fuSnooze(): the caller computes the new due date (addDays(f.due<TODAY
   * ? TODAY : f.due, days)) exactly like the demo does, since that's a pure
   * date calculation with nothing server-side to re-derive. */
  async snooze(id: number, due: string): Promise<void> {
    const { error } = await supabase!.from('follow_ups').update({due}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async reschedule(id: number, {due, note, assigneeId}: { due: string; note: string; assigneeId?: number | null }): Promise<void> {
    const patch: { due: string; note: string; assignee_id?: number | null } = {due, note}; if(assigneeId!==undefined) patch.assignee_id = assigneeId;
    const { error } = await supabase!.from('follow_ups').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async cancel(id: number, cancelReason: string, cancelledById: number | null | undefined): Promise<void> {
    const { error } = await supabase!.from('follow_ups').update({status:'cancelled', cancel_reason:cancelReason, cancelled_by:cancelledById}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** Stage 10: dealFuDlg()'s own schedule — the local backend's
   * db.followUps.push({...}); this is the same row, just server-side. */
  async create({leadId, due, note, assigneeId}: { leadId: number; due: string; note?: string; assigneeId?: number | null }): Promise<FollowUp> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('follow_ups').insert({
      org_id, lead_id:leadId, due, status:'pending', note:note||'', assignee_id:assigneeId||null,
    }).select().single();
    if(error) throw new Error(error.message);
    return mapFollowUpRow(data);
  },
};
function mapFollowUpRow(r: Row): FollowUp {
  return { id:r.id, leadId:r.lead_id, due:r.due, status:r.status, note:r.note||"", assignee:r.assignee_id,
           cancelReason:r.cancel_reason, cancelledBy:r.cancelled_by, doneAt:r.done_at, createdAt:r.created_at };
}
/** Only the fields views/followups.js's row(f) actually reads — no listIds/
 * custom/status keys, so merging this into an already-hydrated db.leads
 * entry (hydrateLead(), features/leads.js) never clobbers richer data
 * #lead/:id fetched separately for the same lead. */
function mapFollowUpLeadRow(l: Row): LeadPartial {
  const phones: LeadPhone[] = (l.lead_phones||[]).slice().sort((a: Row,b: Row)=>a.position-b.position).map((p: Row)=>({n:p.n, type:p.type}));
  return { id:l.id, first:l.first, last:l.last, addr:l.addr||"", city:l.city||"", zip:l.zip||"",
           dnc:l.dnc, dnt:l.dnt, dncontact:l.dncontact, assigned:l.assigned_id, phones };
}

// -------------------------------------------------------------------- notes
export const notes = {
  /** #lead/:id's Notes card: manager-only notes are already excluded by
   * RLS (notes_select's `kind <> 'manager' or has_permission('managerNotes')`)
   * for anyone who can't see them, so no client-side re-filtering by
   * can("managerNotes") is needed the way the local backend's V.lead() does. */
  async forLead(leadId: number): Promise<Note[]> {
    const { data, error } = await supabase!
      .from('notes').select('id,lead_id,user_id,at,text,kind').eq('lead_id', leadId).order('at', { ascending:false });
    if(error) throw new Error(error.message);
    return (data||[]).map(r => ({ id:r.id, leadId:r.lead_id, userId:r.user_id, at:r.at, text:r.text, kind:r.kind }));
  },
  async create(leadId: number, text: string, kind: string): Promise<Note> {
    const org_id = await myOrgId(); const user_id = await myMemberId();
    const { data, error } = await supabase!.from('notes').insert({org_id, lead_id:leadId, user_id, text, kind}).select().single();
    if(error) throw new Error(error.message);
    return { id:data.id, leadId:data.lead_id, userId:data.user_id, at:data.at, text:data.text, kind:data.kind };
  },
};

// ----------------------------------------------------------------- outcomes
export const outcomes = {
  /** outcomeForm()'s create path — the demo never deletes an outcome, only
   * disables it (kept in history, hidden from the log form), so there is
   * no delete() here to mirror. */
  async create(patch: Pick<Outcome, 'name'> & Partial<Outcome>): Promise<Outcome> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('outcomes').insert({
      org_id, name:patch.name, conv:!!patch.conv, appt:!!patch.appt, dnc:!!patch.dnc, disabled:false,
    }).select().single();
    if(error) throw new Error(error.code === '23505' ? 'An outcome with that name already exists' : error.message);
    return { id:data.id, name:data.name, conv:data.conv, appt:data.appt, dnc:data.dnc, disabled:data.disabled };
  },
  async update(id: number, patch: Pick<Outcome, 'name'> & Partial<Outcome>): Promise<void> {
    const { error } = await supabase!.from('outcomes').update({
      name:patch.name, conv:!!patch.conv, appt:!!patch.appt, dnc:!!patch.dnc, disabled:!!patch.disabled,
    }).eq('id', id);
    if(error) throw new Error(error.code === '23505' ? 'An outcome with that name already exists' : error.message);
  },
};

// --------------------------------------------------------------- templates
export const templates = {
  list: (): Template[] => db.templates,
  async create(patch: Pick<Template, 'name' | 'style' | 'body'>): Promise<Template> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('templates').insert({org_id, name:patch.name, style:patch.style, body:patch.body}).select().single();
    if(error) throw new Error(error.message);
    return { id:data.id, name:data.name, style:data.style, body:data.body };
  },
  async update(id: number, patch: Pick<Template, 'name' | 'style' | 'body'>): Promise<void> {
    const { error } = await supabase!.from('templates').update({name:patch.name, style:patch.style, body:patch.body}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async delete(id: number): Promise<void> {
    const { error } = await supabase!.from('templates').delete().eq('id', id);
    if(error) throw new Error(error.message);
  },
};

// --------------------------------------------------------------- campaigns
export const campaigns = {
  list: (): Campaign[] => db.campaigns,
  async create(patch: Pick<Campaign, 'name' | 'type' | 'body'>): Promise<Campaign> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('campaigns').insert({org_id, name:patch.name, type:patch.type, body:patch.body}).select().single();
    if(error) throw new Error(error.message);
    return mapCampaignRow(data);
  },
  async update(id: number, patch: Pick<Campaign, 'name' | 'type' | 'body'>): Promise<void> {
    const { error } = await supabase!.from('campaigns').update({name:patch.name, type:patch.type, body:patch.body}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** duplicateCampaign(): a new, independent copy of the body — same
   * "copy by value, not a live link" the local backend's own {...c, id:nid()}
   * spread already does; duplicated_from just records provenance. */
  async duplicate(id: number): Promise<Campaign> {
    const c = db.campaigns.find(x=>x.id===id)!;
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('campaigns').insert({
      org_id, name: c.name+" (copy)", type: c.type, body: c.body, duplicated_from: id,
    }).select().single();
    if(error) throw new Error(error.message);
    return mapCampaignRow(data);
  },
  async archive(id: number): Promise<void> {
    const { error } = await supabase!.from('campaigns').update({archived:true}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** V.campaigns' per-campaign card: total/sent/replied counts, plus one
   * visible lead to preview the template against. leads!inner enforces the
   * same canSee(lead) visibility the local backend's own
   * `canSee(db.leads.find(l=>l.id===x.leadId)||{})` filter does, through
   * leads' existing RLS (0015_rls.sql) — the same technique
   * followUps.listAll() (Stage 6) already uses. */
  async summaries(): Promise<Map<number, CampaignSummary>> {
    const { data, error } = await supabase!
      .from('campaign_leads')
      .select('campaign_id,status,leads!inner(id,first,last,addr,city,zip,archived)')
      .eq('leads.archived', false);
    if(error) throw new Error(error.message);
    const byId = new Map<number, CampaignSummary>();
    for(const row of (data||[])){
      let s = byId.get(row.campaign_id);
      if(!s){ s = { total:0, sent:0, replied:0, sample:null }; byId.set(row.campaign_id, s); }
      s.total++;
      if(row.status==='sent'||row.status==='replied') s.sent++;
      if(row.status==='replied') s.replied++;
      if(!s.sample){ const l: Row=row.leads; s.sample = { id:l.id, first:l.first, last:l.last, addr:l.addr||"", city:l.city||"", zip:l.zip||"", listIds:[], custom:{} }; }
    }
    return byId;
  },
};
function mapCampaignRow(r: Row): Campaign {
  return { id:r.id, name:r.name, type:r.type, body:r.body, archived:r.archived, duplicatedFrom:r.duplicated_from, createdAt:r.created_at };
}

// ----------------------------------------------------------- campaignLeads
export const campaignLeads = {
  /** V.campaign's card grid: every card for one campaign plus its lead
   * (enough for msgCard()/editCard()/cardBody() — phones and on-card custom
   * values included) and that lead's on-card custom values
   * (cardFieldsFor()). leads!inner enforces canSee(lead) the same way
   * campaigns.summaries() above does. */
  async forCampaign(campaignId: number): Promise<{ card: CampaignLead; lead: LeadPartial }[]> {
    const { data, error } = await supabase!
      .from('campaign_leads')
      .select('id,campaign_id,lead_id,body,status,sent_at,sent_by,replied_at,created_at,' +
              'leads!inner(id,first,last,addr,city,zip,dnc,dnt,dncontact,assigned_id,archived,' +
              'lead_phones(n,type,position),lead_custom_values(field_key,value))')
      .eq('campaign_id', campaignId).eq('leads.archived', false)
      .order('id');
    if(error) throw new Error(error.message);
    return (data||[]).map((r: Row) => ({ card: mapCardRow(r), lead: mapCardLeadRow(r.leads) }));
  },
  /** campaignPanel()'s "Which campaign"/card status for one lead, across
   * every campaign it's on — the lead itself is already hydrated separately
   * (hydrateLeadActivity(), Stage 6), so only the card rows are needed here. */
  async forLead(leadId: number): Promise<CampaignLead[]> {
    const { data, error } = await supabase!
      .from('campaign_leads')
      .select('id,campaign_id,lead_id,body,status,sent_at,sent_by,replied_at,created_at')
      .eq('lead_id', leadId).order('created_at');
    if(error) throw new Error(error.message);
    return (data||[]).map(mapCardRow);
  },
  /** addLeadsToCampaign(): archived/dnt/dncontact are re-checked here from
   * fresh leads rows — RLS also silently drops any id the caller can't see,
   * matching the local backend's own `if(!l) return`. "Already on the
   * campaign" is left to the table's own unique(campaign_id,lead_id)
   * constraint via upsert+ignoreDuplicates, the same technique
   * leads.bulkAddToList() already uses. Returns the count actually added. */
  async addLeads(campaignId: number, ids: number[]): Promise<number> {
    if(!ids.length) return 0;
    const { data: rows, error: selErr } = await supabase!.from('leads').select('id,archived,dnt,dncontact').in('id', ids);
    if(selErr) throw new Error(selErr.message);
    const okIds = (rows||[]).filter(l=>!l.archived && !l.dnt && !l.dncontact).map(l=>l.id);
    if(!okIds.length) return 0;
    const org_id = await myOrgId();
    const { data: inserted, error } = await supabase!.from('campaign_leads')
      .upsert(okIds.map(lead_id => ({org_id, campaign_id:campaignId, lead_id, body:null, status:'draft'})), {onConflict:'campaign_id,lead_id', ignoreDuplicates:true})
      .select('id');
    if(error) throw new Error(error.message);
    return (inserted||[]).length;
  },
  /** editCard()'s save: body (null to fall back to the campaign template)
   * and/or status. */
  async update(id: number, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('campaign_leads').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async remove(id: number): Promise<void> {
    const { error } = await supabase!.from('campaign_leads').delete().eq('id', id);
    if(error) throw new Error(error.message);
  },
};
function mapCardRow(r: Row): CampaignLead {
  return { id:r.id, campaignId:r.campaign_id, leadId:r.lead_id, body:r.body, status:r.status,
           sentAt:r.sent_at, sentBy:r.sent_by, repliedAt:r.replied_at, createdAt:r.created_at };
}
function mapCardLeadRow(l: Row): LeadPartial {
  const phones: LeadPhone[] = (l.lead_phones||[]).slice().sort((a: Row,b: Row)=>a.position-b.position).map((p: Row)=>({n:p.n, type:p.type}));
  const custom: CustomValues = {}; for(const c of (l.lead_custom_values||[])) custom[c.field_key] = c.value;
  return { id:l.id, first:l.first, last:l.last, addr:l.addr||"", city:l.city||"", zip:l.zip||"",
           dnc:l.dnc, dnt:l.dnt, dncontact:l.dncontact, assigned:l.assigned_id, phones, listIds:[], custom };
}

// ------------------------------------------------------------------ exports
/**
 * Stage 13: exportCsv()/exportCrm()'s (features/exports.js, features/crm.js)
 * supabase-backend data supply. Every per-row mapping function in those two
 * files is the demo's own, byte-for-byte, and stays completely unchanged on
 * either backend — only *how db.leads/db.activities/db.followUps/db.notes/
 * db.campaignLeads/db.deals get populated* differs. Each method here
 * bulk-fetches every row the caller's RLS lets through for its table (no
 * pagination — export needs the whole set, not a page of it) and returns it
 * already shaped like the matching local demo array; exports.js/crm.js then
 * replace the relevant db.* array with the result and fall straight into
 * the same synchronous local-backend code that already exists.
 *
 * lead_phones/lead_lists/lead_custom_values/campaign_leads have no RLS of
 * their own (same convention as org_settings/audit_log), so allLeads() and
 * allCampaignLeads() only filter by the ids that came back from an RLS-
 * scoped `leads`/`activities`/etc. select — never a blanket, unscoped read
 * of a gated table.
 */
export const exportsRepo = {
  /** Every RLS-visible lead, full shape (every phone, every list, every
   * custom value) — leads.get()'s single-lead shape, for every row RLS
   * lets through at once instead of one id at a time. */
  async allLeads(): Promise<Lead[]> {
    const { data: leadRows, error } = await supabase!.from('leads').select('*');
    if(error) throw new Error(error.message);
    const ids = (leadRows||[]).map(l=>l.id);
    if(!ids.length) return [];
    const [{ data: phoneRows }, { data: listRows }, { data: customRows }] = await Promise.all([
      supabase!.from('lead_phones').select('lead_id,n,type,position').in('lead_id', ids).order('position'),
      supabase!.from('lead_lists').select('lead_id,list_id').in('lead_id', ids),
      supabase!.from('lead_custom_values').select('lead_id,field_key,value').in('lead_id', ids),
    ]);
    const phonesBy = new Map<number, LeadPhone[]>(), listsBy = new Map<number, number[]>(), customBy = new Map<number, CustomValues>();
    for(const p of phoneRows||[]){ if(!phonesBy.has(p.lead_id)) phonesBy.set(p.lead_id, []); phonesBy.get(p.lead_id)!.push({n:p.n, type:p.type}); }
    for(const l of listRows||[]){ if(!listsBy.has(l.lead_id)) listsBy.set(l.lead_id, []); listsBy.get(l.lead_id)!.push(l.list_id); }
    for(const c of customRows||[]){ if(!customBy.has(c.lead_id)) customBy.set(c.lead_id, {}); customBy.get(c.lead_id)![c.field_key] = c.value; }
    return (leadRows||[]).map(l => ({
      id:l.id, first:l.first, last:l.last, email:l.email||"", addr:l.addr||"", city:l.city||"", state:l.state||"", zip:l.zip||"",
      assigned:l.assigned_id, status:l.status_key, dnc:l.dnc, dnt:l.dnt, dncontact:l.dncontact, archived:l.archived,
      source:l.source, createdAt:l.created_at,
      phones: phonesBy.get(l.id) || [], listIds: listsBy.get(l.id) || [], custom: customBy.get(l.id) || {},
    }));
  },
  async allActivities(): Promise<Activity[]> {
    const { data, error } = await supabase!.from('activities').select('id,lead_id,type,outcome_id,user_id,at,note,list_id,campaign_id,duration_min,phone');
    if(error) throw new Error(error.message);
    return (data||[]).map(r => ({ id:r.id, leadId:r.lead_id, type:r.type, outcomeId:r.outcome_id, userId:r.user_id, at:r.at, note:r.note||"", listId:r.list_id, campaignId:r.campaign_id, durationMin:r.duration_min, phone:r.phone }));
  },
  async allFollowUps(): Promise<FollowUp[]> {
    const { data, error } = await supabase!.from('follow_ups').select('id,lead_id,due,status,note,assignee_id,cancel_reason,cancelled_by,done_at,created_at');
    if(error) throw new Error(error.message);
    return (data||[]).map(mapFollowUpRow);
  },
  async allNotes(): Promise<Note[]> {
    const { data, error } = await supabase!.from('notes').select('id,lead_id,user_id,at,text,kind');
    if(error) throw new Error(error.message);
    return (data||[]).map(r => ({ id:r.id, leadId:r.lead_id, userId:r.user_id, at:r.at, text:r.text, kind:r.kind }));
  },
  /** campaign_leads is unscoped by RLS, so this is a blanket read (every
   * card for every campaign) — exportCsv()'s own `mine(lead)` filter
   * (features/exports.js) is what narrows it down afterward, the same
   * client-side check the local backend already applies. */
  async allCampaignLeads(): Promise<CampaignLead[]> {
    const { data, error } = await supabase!.from('campaign_leads').select('id,campaign_id,lead_id,body,status,sent_at,sent_by,replied_at,created_at');
    if(error) throw new Error(error.message);
    return (data||[]).map(mapCardRow);
  },
  /** exportCrm(): every RLS-visible deal, in the same shape mapDealRow()
   * gives search_deals() rows (including the _calls/_texts/_lastContact
   * derived fields dealCalls()/dealTexts()/dealLastContact() read on this
   * backend) — but across every pipeline at once, which search_deals()
   * can't do (p_pipeline is required there), so this reads the deals table
   * directly and computes the same three aggregates client-side from a
   * bulk activities fetch instead of Postgres doing it per-row. */
  async allDeals(): Promise<Deal[]> {
    const { data: dealRows, error } = await supabase!.from('deals').select('*');
    if(error) throw new Error(error.message);
    const leadIds = [...new Set((dealRows||[]).map(d=>d.lead_id))];
    if(!leadIds.length) return [];
    const { data: actRows, error: aErr } = await supabase!.from('activities').select('lead_id,type,at').in('lead_id', leadIds);
    if(aErr) throw new Error(aErr.message);
    const byLead = new Map<number, { calls: number; texts: number; lastContact: string | null }>();
    for(const a of actRows||[]){
      let s = byLead.get(a.lead_id); if(!s){ s = {calls:0, texts:0, lastContact:null}; byLead.set(a.lead_id, s); }
      if(a.type==="call") s.calls++; if(a.type==="text") s.texts++;
      if(!s.lastContact || a.at > s.lastContact) s.lastContact = a.at;
    }
    return (dealRows||[]).map(d => {
      const agg = byLead.get(d.lead_id) || {calls:0, texts:0, lastContact:null};
      return {
        id:d.id, leadId:d.lead_id, pipelineId:d.pipeline_id, stageId:d.stage_id, assigned:d.assigned_id,
        temperature:d.temperature, price:Number(d.price), commPct:Number(d.comm_pct), referralPct:Number(d.referral_pct),
        teamSplitPct:Number(d.team_split_pct), brokeragePct:Number(d.brokerage_pct), brokerageFee:Number(d.brokerage_fee),
        closingCosts:Number(d.closing_costs), closeDate:d.close_date, nextFu:d.next_fu, notes:d.notes||"",
        stageEnteredAt:d.stage_entered_at, createdBy:d.created_by, createdAt:d.created_at, history:[],
        _calls:agg.calls, _texts:agg.texts, _lastContact:agg.lastContact,
      };
    });
  },
};

/** Stage 9: import-run is the third "whole-thing-has-to-be-one-server-side-
 * call" edge function (log-activity, save-permissions, this) — duplicate
 * matching has to run against the org's *real* leads table, not whatever
 * page of it happens to be in the browser, and the commit itself (create
 * or merge up to tens of thousands of rows) has to be one server-side pass
 * so two people importing at once can't race each other's dup checks. Its
 * `action` field plays the same role save-permissions' does. */
async function callImportRunFunction(action: string, payload: Payload){
  const client = requireClient();
  const org_id = await myOrgId();
  if(!org_id) throw new Error("Not signed in");
  const { data, error } = await client.functions.invoke('import-run', { body: { action, org_id, ...payload } });
  if(error){
    let message = error.message;
    try{ const body = await error.context?.json?.(); if(body?.error) message = body.error; }catch{ /* fall back to error.message */ }
    throw new Error(message);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}

// ------------------------------------------------------------------ imports
export const imports = {
  list: () => db.imports,
  /** features/imports.js's importCheck(): mapped rows in (already batched
   * client-side so one call never carries the whole file), {ready, dups,
   * bad} out — every row shape unchanged from the local backend's own
   * check step so views/imports.js's rendering needs no branching. */
  check(rows: ImportRow[], cfg: ImportCfg){
    return callImportRunFunction('check', {
      rows, max_rows: cfg.maxRows,
      dup_phone: cfg.dupPhone, dup_email: cfg.dupEmail, dup_address: cfg.dupAddress,
      require_name: cfg.requireName, require_phone: cfg.requirePhone, flag_dnc: cfg.flagDnc,
    });
  },
  /** importRun(): creates the import job plus every lead it touches
   * (created new, or merged onto an existing one) in one server-side pass. */
  commit(payload: Payload){ return callImportRunFunction('commit', payload); },
  /** undoImport(): { kept, removed } — the same counts the local backend's
   * own loop over job.leadIds already produces. */
  undo(jobId: number){ return callImportRunFunction('undo', { job_id: jobId }); },
};

// --------------------------------------------------------------- pipelines
/** Stage 10: pipelineDlg()'s create/rename path. The 14 default stages a
 * new pipeline ships with are the caller's job to pass in (crm.js's own
 * defaultStages(), computed client-side — importing it here would be a
 * circular import back into features/crm.js), same "business logic stays
 * in features/, this file only does the Supabase calls" split every other
 * repo namespace in this file already follows. */
export const pipelines = {
  list: (): Pipeline[] => db.pipelines,
  async create(name: string, kind: string, stageDefs?: Pick<Stage, 'name' | 'prob' | 'kind' | 'color'>[] | null): Promise<Pipeline> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('pipelines').insert({org_id, name, kind}).select().single();
    if(error) throw new Error(error.message);
    const { data: stageRows, error: sErr } = await supabase!.from('stages').insert(
      (stageDefs||[]).map((s,i) => ({org_id, pipeline_id:data.id, name:s.name, prob:s.prob, kind:s.kind, color:s.color, archived:false, position:i}))
    ).select();
    if(sErr) throw new Error(sErr.message);
    return {
      id:data.id, name:data.name, kind:data.kind, archived:data.archived, createdAt:data.created_at,
      stages: (stageRows||[]).map(s => ({id:s.id, name:s.name, prob:s.prob, kind:s.kind, color:s.color, archived:s.archived, position:s.position})),
    };
  },
  async rename(id: number, name: string, kind: string): Promise<void> {
    const { error } = await supabase!.from('pipelines').update({name, kind}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async archive(id: number): Promise<void> {
    const { error } = await supabase!.from('pipelines').update({archived:true}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async restore(id: number): Promise<void> {
    const { error } = await supabase!.from('pipelines').update({archived:false}).eq('id', id);
    if(error) throw new Error(error.message);
  },
};

// ------------------------------------------------------------------ stages
export const stages = {
  /** addStageDlg()'s save: position is always appended at the end (the
   * caller passes p.stages.length, same as the local backend's own
   * STAGE_COLORS[p.stages.length % STAGE_COLORS.length] color pick uses). */
  async create(pipelineId: number, {name, prob, kind, color, position}: Pick<Stage, 'name' | 'prob' | 'kind' | 'color'> & { position: number }): Promise<Stage> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('stages').insert({org_id, pipeline_id:pipelineId, name, prob, kind, color, archived:false, position}).select().single();
    if(error) throw new Error(error.message);
    return { id:data.id, name:data.name, prob:data.prob, kind:data.kind, color:data.color, archived:data.archived, position:data.position };
  },
  /** stageMenu()'s save: name/prob/kind/color together. */
  async update(id: number, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('stages').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** moveStage(): the two swapped stages' new positions, one call each — the
   * local backend swaps them in the in-memory array; this is that same swap
   * written back so `order by position` (loadCrmConfig()) sorts them the
   * same way afterward. */
  async swapPositions(aId: number, aPos: number, bId: number, bPos: number): Promise<void> {
    const [{error:e1},{error:e2}] = await Promise.all([
      supabase!.from('stages').update({position:aPos}).eq('id', aId),
      supabase!.from('stages').update({position:bPos}).eq('id', bId),
    ]);
    if(e1) throw new Error(e1.message); if(e2) throw new Error(e2.message);
  },
  async archive(id: number): Promise<void> {
    const { error } = await supabase!.from('stages').update({archived:true}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async restore(id: number): Promise<void> {
    const { error } = await supabase!.from('stages').update({archived:false}).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** deleteStage(): every deal currently on this stage moves to `toId`
   * first (with its own "(stage deleted)" history row), then the stage row
   * itself goes — the same order the local backend's own deleteStage()
   * does it in, just as separate awaited calls instead of one in-memory
   * pass, since stages/deals have no RLS-free "do this whole thing
   * atomically" edge function backing them (see 0015_rls.sql's comment on
   * deals_update's coarse permission check — the caller's own moveStages
   * permission already has to cover every one of these updates). */
  async delete(id: number, dealIds: number[], toId: number | null, fromName: string, toName: string | null, userId: number | null | undefined): Promise<void> {
    for(const dealId of dealIds){
      const { error } = await supabase!.from('deals').update({stage_id:toId, stage_entered_at:new Date().toISOString()}).eq('id', dealId);
      if(error) throw new Error(error.message);
      const { error: hErr } = await supabase!.from('deal_history').insert({
        org_id: await myOrgId(), deal_id:dealId, user_id:userId, type:'stage', detail:`${fromName} → ${toName} (stage deleted)`,
      });
      if(hErr) throw new Error(hErr.message);
    }
    const { error } = await supabase!.from('stages').delete().eq('id', id);
    if(error) throw new Error(error.message);
  },
};

// -------------------------------------------------------------------- crm
function mapDealRow(r: Row): Deal {
  return {
    id:r.id, leadId:r.lead_id, pipelineId:r.pipeline_id, stageId:r.stage_id, assigned:r.assigned_id,
    temperature:r.temperature, price:r.price, commPct:r.comm_pct, referralPct:r.referral_pct,
    teamSplitPct:r.team_split_pct, brokeragePct:r.brokerage_pct, brokerageFee:r.brokerage_fee,
    closingCosts:r.closing_costs, closeDate:r.close_date, nextFu:r.next_fu, notes:r.notes||"",
    stageEnteredAt:r.stage_entered_at, createdBy:r.created_by, createdAt:r.created_at, history:[],
    // search_deals()'s own derived columns — dealFu()/dealCalls()/dealTexts()/
    // dealLastContact() read these on the supabase backend instead of
    // recomputing from a full activities/follow_ups array that isn't
    // necessarily loaded for every lead on the board. Absent on a row from
    // crm.get() (a plain `select *`, no derived columns), so those three
    // accessors fall back to null/0 the same way a brand-new local deal would.
    _fuDue:r.fu_due, _lastContact:r.last_contact, _calls:r.calls, _texts:r.texts,
  };
}
export const crm = {
  /** crmDeals(), server-side: search_deals() (migration 0018) does the
   * filtering/sorting and the dealMath()-adjacent derived columns; only the
   * deal rows come back, so the leads they point at are fetched separately
   * (leadsByIds below) and hydrated into db.leads the same additive way
   * every other search path in this file already works. */
  async search(pipelineId: number, f: Partial<CrmFilters>): Promise<Deal[]> {
    const client = requireClient();
    const { data, error } = await client.rpc('search_deals', {
      p_pipeline: pipelineId, p_q: f.q||'', p_agent: f.agent ? +f.agent : null, p_stage: f.stage ? +f.stage : null,
      p_temp: f.temp||null, p_campaign: f.campaign ? +f.campaign : null, p_source: f.source||null,
      p_city: f.city||null, p_zip: f.zip||null, p_overdue: !!f.overdue,
      p_fu_from: f.fuFrom||null, p_fu_to: f.fuTo||null,
      p_price_min: f.priceMin!==""&&f.priceMin!=null ? +f.priceMin : null,
      p_price_max: f.priceMax!==""&&f.priceMax!=null ? +f.priceMax : null,
      p_comm_min: f.commMin!==""&&f.commMin!=null ? +f.commMin : null,
      p_comm_max: f.commMax!==""&&f.commMax!=null ? +f.commMax : null,
      p_close_from: f.closeFrom||null, p_close_to: f.closeTo||null,
      p_added_from: f.addedFrom||null, p_added_to: f.addedTo||null,
      p_active_from: f.activeFrom||null, p_sort: f.sort||'newest',
    });
    if(error) throw new Error(error.message);
    return (data||[]).map(mapDealRow);
  },
  /** #deal/:id's direct-navigation fetch (bookmarked or reloaded, not
   * reached through the board) — a plain single-row read, same role
   * leads.get() plays for #lead/:id. */
  async get(id: number): Promise<Deal | null> {
    const { data, error } = await supabase!.from('deals').select('*').eq('id', id).maybeSingle();
    if(error) throw new Error(error.message);
    return data ? mapDealRow(data) : null;
  },
  /** Every lead a page of deals points at, with just enough to draw
   * dealCard()/the deal page's contact card. */
  async leadsByIds(ids: number[]): Promise<LeadPartial[]> {
    if(!ids.length) return [];
    const { data, error } = await supabase!
      .from('leads').select('id,first,last,email,addr,city,state,zip,source,archived,lead_phones(n,type,position)')
      .in('id', ids);
    if(error) throw new Error(error.message);
    return (data||[]).map(l => ({
      id:l.id, first:l.first, last:l.last, email:l.email||"", addr:l.addr||"", city:l.city||"",
      state:l.state||"", zip:l.zip||"", source:l.source, archived:l.archived,
      phones:(l.lead_phones||[]).slice().sort((a,b)=>a.position-b.position).map(p=>({n:p.n, type:p.type})),
      listIds:[], custom:{},
    }));
  },
  /** addToCrm()'s save, one lead at a time — the unique(lead_id,pipeline_id)
   * constraint (0013_crm_pipeline.sql) is the server-side "already in that
   * pipeline" check, same text either way. */
  async create(deal: Pick<Deal, 'leadId' | 'pipelineId' | 'stageId'> & Partial<Deal>): Promise<Deal> {
    const org_id = await myOrgId();
    const { data, error } = await supabase!.from('deals').insert({
      org_id, lead_id:deal.leadId, pipeline_id:deal.pipelineId, stage_id:deal.stageId, assigned_id:deal.assigned,
      temperature:deal.temperature, price:deal.price, comm_pct:deal.commPct, referral_pct:deal.referralPct,
      team_split_pct:deal.teamSplitPct, brokerage_pct:deal.brokeragePct, brokerage_fee:deal.brokerageFee,
      closing_costs:deal.closingCosts, close_date:deal.closeDate, next_fu:deal.nextFu, notes:deal.notes,
      stage_entered_at:new Date().toISOString(), created_by:deal.createdBy,
    }).select().single();
    if(error) throw new Error(error.code === '23505' ? 'Already in that pipeline' : error.message);
    return mapDealRow(data);
  },
  /** setDealField()'s save — patch is already the DB column name(s). */
  async update(id: number, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('deals').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  /** moveDeal()/moveStageDlg()'s pipeline-switch branch. */
  async move(id: number, patch: ColumnPatch): Promise<void> {
    const { error } = await supabase!.from('deals').update(patch).eq('id', id);
    if(error) throw new Error(error.message);
  },
  async addHistory(dealId: number, type: string, detail: string): Promise<void> {
    const org_id = await myOrgId(); const user_id = await myMemberId();
    const { error } = await supabase!.from('deal_history').insert({org_id, deal_id:dealId, user_id, type, detail});
    if(error) throw new Error(error.message);
  },
  /** dealTimeline()'s merge, this deal's slice of it. */
  async historyFor(dealId: number): Promise<DealHistoryEntry[]> {
    const { data, error } = await supabase!.from('deal_history').select('id,at,user_id,type,detail').eq('deal_id', dealId).order('at', {ascending:false});
    if(error) throw new Error(error.message);
    return (data||[]).map(r => ({ id:r.id, at:r.at, userId:r.user_id, type:r.type, detail:r.detail }));
  },
};

// -------------------------------------------------------------------- stats
// Stage 11: the SQL side of features/stats.js's stats(userId, range)/
// pace() and views/reports.js's/views/crmdash.js's own inline aggregations
// (0019_stats.sql) — every function here is a thin RPC wrapper, mapping
// each SQL function's row(s) into the exact shape the calling view/feature
// module already works with, the same "RPC in, plain JS object(s) out"
// role search_deals()/search_leads() play for crm.js/leads.js.
export const stats = {
  /** stats(userId, range), server-side. p_member_id null = every
   * activity this caller's RLS lets through (team), matching the local
   * backend's own stats(null, range) call. */
  async member(memberId: number | null, from: string | null, to: string | null): Promise<MemberStats> {
    const client = requireClient();
    const { data, error } = await client.rpc('member_stats', { p_member_id: memberId, p_from: from, p_to: to });
    if(error) throw new Error(error.message);
    const r = (data && data[0]) || {};
    return { calls:r.calls||0, texts:r.texts||0, doors:r.doors||0, conv:r.conv||0, appts:r.appts||0, rate:r.rate||0, points:Number(r.points)||0, minutes:r.minutes||0, total:r.total||0 };
  },
  /** views/reports.js's byOutcome, keyed by outcome id. */
  async outcomeCounts(memberId: number | null, from: string | null, to: string | null): Promise<Record<number, number>> {
    const client = requireClient();
    const { data, error } = await client.rpc('outcome_counts', { p_member_id: memberId, p_from: from, p_to: to });
    if(error) throw new Error(error.message);
    return Object.fromEntries((data||[]).map((r: Row) => [r.outcome_id, Number(r.n)]));
  },
  /** views/reports.js's byList, keyed by list id. */
  async listCounts(memberId: number | null, from: string | null, to: string | null): Promise<Record<number, number>> {
    const client = requireClient();
    const { data, error } = await client.rpc('list_counts', { p_member_id: memberId, p_from: from, p_to: to });
    if(error) throw new Error(error.message);
    return Object.fromEntries((data||[]).map((r: Row) => [r.list_id, Number(r.n)]));
  },
  /** views/reports.js's byCamp, keyed by campaign id. */
  async campaignCounts(memberId: number | null, from: string | null, to: string | null): Promise<Record<number, { sent: number; replies: number }>> {
    const client = requireClient();
    const { data, error } = await client.rpc('campaign_counts', { p_member_id: memberId, p_from: from, p_to: to });
    if(error) throw new Error(error.message);
    return Object.fromEntries((data||[]).map((r: Row) => [r.campaign_id, { sent:Number(r.sent), replies:Number(r.replies) }]));
  },
  /** views/reports.js's byHour, keyed by local hour (0-23) — p_tz is the
   * browser's own IANA zone (Intl.DateTimeFormat().resolvedOptions().
   * timeZone), matching the local backend's `new Date(a.at).getHours()`. */
  async callsByHour(memberId: number | null, from: string | null, to: string | null, tz: string): Promise<Record<number, { c: number; v: number }>> {
    const client = requireClient();
    const { data, error } = await client.rpc('calls_by_hour', { p_member_id: memberId, p_from: from, p_to: to, p_tz: tz });
    if(error) throw new Error(error.message);
    return Object.fromEntries((data||[]).map((r: Row) => [r.hour, { c:Number(r.calls), v:Number(r.contacted) }]));
  },
  /** views/crmdash.js's `kinds` (active/closed/lost cards), keyed by kind
   * — a kind with zero matching deals gets no row here, same as the local
   * backend's own `byKind(k)` producing an empty array for one. */
  async crmByKind(pipe: number | null, agent: number | null, campaign: number | null, from: string | null, to: string | null){
    const client = requireClient();
    const { data, error } = await client.rpc('crm_dashboard_by_kind', { p_pipeline: pipe, p_agent: agent, p_campaign: campaign, p_from: from, p_to: to });
    if(error) throw new Error(error.message);
    return Object.fromEntries((data||[]).map((r: Row) => [r.kind, {
      n:r.n, price:Number(r.price), gross:Number(r.gross), net:Number(r.net), weighted:Number(r.weighted),
      appt:r.appt_count, listing:r.listing_count, contract:r.contract_count,
      overdue:r.overdue_count, overdueSample:r.overdue_sample||"",
    }]));
  },
  /** views/crmdash.js's "By stage" table for one resolved pipeline. */
  async crmByStage(pipe: number | null, agent: number | null, campaign: number | null, from: string | null, to: string | null){
    const client = requireClient();
    const { data, error } = await client.rpc('crm_dashboard_by_stage', { p_pipeline: pipe, p_agent: agent, p_campaign: campaign, p_from: from, p_to: to });
    if(error) throw new Error(error.message);
    return (data||[]).map((r: Row) => ({ stageId:r.stage_id, name:r.stage_name, color:r.stage_color, prob:r.stage_prob, position:r.position, leads:r.leads, share:r.share_pct, avgDays:r.avg_days, weighted:Number(r.weighted) }));
  },
  /** views/crmdash.js's "Production by agent" table, keyed by agent id. */
  async crmByAgent(pipe: number | null, agent: number | null, campaign: number | null, from: string | null, to: string | null){
    const client = requireClient();
    const { data, error } = await client.rpc('crm_dashboard_by_agent', { p_pipeline: pipe, p_agent: agent, p_campaign: campaign, p_from: from, p_to: to });
    if(error) throw new Error(error.message);
    return Object.fromEntries((data||[]).map((r: Row) => [r.agent_id, { active:r.active_n, appts:r.appts, listings:r.listings, closed:r.closed_n, forecast:Number(r.forecast), closedNet:Number(r.closed_net) }]));
  },
};

const authMethods = { signInWithPassword, signOut, getSessionMember, updatePassword, supabase, roles, users, teams, leads, lists, statuses, fields, activities, followUps, notes, outcomes, templates, campaigns, campaignLeads, imports, pipelines, stages, crm, stats };

/**
 * Everything else (leads, deals, campaigns, imports, the whole rest of a
 * real repo interface) belongs to later stages. Reaching for one of those
 * methods here is a loud reminder of that, not a silent no-op — matching
 * the stage instructions ("other methods throw 'not implemented in stage
 * 3'") without having to guess at a full interface Stage 1 never defined.
 */
export const repoSupabase = new Proxy(authMethods, {
  get(target, prop){
    if(prop in target) return target[prop as keyof typeof target];
    if(typeof prop === "symbol" || prop === "then") return undefined;
    return (..._args: unknown[]) => { throw new Error(`repo-supabase.${String(prop)}() is not implemented in stage 3`); };
  }
});

export default repoSupabase;
