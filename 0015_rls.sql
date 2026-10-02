-- Stage 4: server-side enforcement of the visibility/write rules
-- core/permissions.js's can()/canSee() already apply client-side, for the
-- five tables those checks actually gate: leads, deals, follow_ups,
-- activities, notes. Once this migration runs, a direct REST/PostgREST call
-- against these tables is bound by the same rules the UI already hides
-- behind — not just a client-side convenience.
--
-- Every policy resolves the caller through Supabase Auth (auth.uid()) to
-- their `members` row via the helper functions below; there is no bypass
-- for the anon/authenticated Postgres roles beyond what a real member's
-- role permissions allow. The service-role key (used by edge functions,
-- e.g. admin-create-user, save-permissions) still bypasses RLS entirely, by
-- design — that is how Postgres/Supabase service-role access always works.

-- ---------------------------------------------------------------- helpers
-- security definer + a pinned search_path: these run with the migration
-- owner's privileges regardless of caller, and can't be redirected by a
-- caller-controlled search_path, so they're safe to call from any policy.

create or replace function current_member_id()
returns bigint
language sql stable security definer set search_path = public
as $$
  select id from members where auth_user_id = auth.uid();
$$;

create or replace function current_org_id()
returns bigint
language sql stable security definer set search_path = public
as $$
  select org_id from members where auth_user_id = auth.uid();
$$;

-- core/permissions.js's isSuperAdmin(me): the Owner / Super Administrator
-- role (roles.super_admin) always passes every can() check.
create or replace function is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select r.super_admin
       from members m
       join roles r on r.org_id = m.org_id and r.id = m.role_id
      where m.auth_user_id = auth.uid()),
    false);
$$;

-- core/permissions.js's can(cap): super admin bypass, else the caller's role
-- must have that permission_key set. LEGACY_CAP's two aliases
-- (archiveLeads -> deleteLeads, manageMembers -> editUsers) are translated
-- the same way can() does, so a policy can use either name.
create or replace function has_permission(perm_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_super_admin() or coalesce(
    (select rp.allowed
       from members m
       join role_permissions rp
         on rp.org_id = m.org_id and rp.role_id = m.role_id
      where m.auth_user_id = auth.uid()
        and rp.permission_key = case perm_key
              when 'archiveLeads' then 'deleteLeads'
              when 'manageMembers' then 'editUsers'
              else perm_key
            end),
    false);
$$;

-- core/permissions.js's sameTeam(userId): true for yourself, or if you and
-- they are both on the same non-archived team right now (team_members is
-- the current roster; team_history is the join/leave log and isn't
-- consulted here, matching sameTeam's own db.teams.memberIds check).
create or replace function same_team(target_member_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select target_member_id = current_member_id()
    or exists (
      select 1
        from team_members mine
        join team_members theirs on theirs.team_id = mine.team_id
        join teams t on t.id = mine.team_id
       where mine.member_id = current_member_id()
         and theirs.member_id = target_member_id
         and not t.archived
    );
$$;

-- features/activity.js's canSee(l): viewAllLeads sees everything, otherwise
-- only what's assigned to you, or (viewTeamLeads + same active team as the
-- assignee). An unassigned row (target_member_id null) is only visible
-- under viewAllLeads — null never equals current_member_id() or passes
-- same_team(), matching canSee()'s own l.assigned===me.id check on a null
-- assigned value. This is canSee()'s full model, not visibleLeads()'s
-- narrower one (visibleLeads() ignoring team scope is a documented,
-- preserved client-side quirk — the stage brief specifies this fuller model
-- for what the server actually enforces).
create or replace function can_see_member(target_member_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select has_permission('viewAllLeads')
    or target_member_id = current_member_id()
    or (has_permission('viewTeamLeads') and same_team(target_member_id));
$$;

-- ---------------------------------------------------------------- leads
alter table leads enable row level security;

create policy leads_select on leads for select
  using (org_id = current_org_id() and can_see_member(assigned_id));

-- views/leads.js's "+ Add lead" / features/leads.js's import path: gated by
-- can("createLeads").
create policy leads_insert on leads for insert
  with check (org_id = current_org_id() and has_permission('createLeads'));

-- features/leads.js's saveLead(): `if(!l || !can("editLeads")) return;` —
-- you also have to be able to see the row to reach its edit screen at all.
create policy leads_update on leads for update
  using (org_id = current_org_id() and can_see_member(assigned_id))
  with check (org_id = current_org_id() and has_permission('editLeads'));

-- The demo never issues a real SQL DELETE on a lead (archiveLead() just
-- sets `archived = true`, an UPDATE, covered above) — this policy exists so
-- a hard delete is at least as gated as the demo's own LEGACY_CAP
-- archiveLeads -> deleteLeads alias, should anything ever call for one.
create policy leads_delete on leads for delete
  using (org_id = current_org_id() and has_permission('deleteLeads'));

-- ---------------------------------------------------------------- deals
alter table deals enable row level security;

create policy deals_select on deals for select
  using (org_id = current_org_id() and can_see_member(assigned_id));

-- features/crm.js's addToCrm(): no separate "create a deal" permission in
-- the demo — any lead you can already see, you can add to the CRM.
create policy deals_insert on deals for insert
  with check (
    org_id = current_org_id()
    and exists (
      select 1 from leads l
       where l.id = deals.lead_id and l.org_id = deals.org_id
         and can_see_member(l.assigned_id)
    )
  );

-- moveDeal(): can("moveStages"). saveDealField()/similar: can("reassign")
-- to change the assignee, can("editDealFinancials") OR being the deal's own
-- assigned agent to change price/commission/etc. RLS policies are per-row,
-- not per-column, so this single UPDATE policy is the coarse union of all
-- three demo-side gates rather than a field-by-field match; enforcing which
-- *specific* columns each permission may touch is deferred to a later
-- stage's edge function, same as the temporary-password/user-role guards.
create policy deals_update on deals for update
  using (org_id = current_org_id() and can_see_member(assigned_id))
  with check (
    org_id = current_org_id()
    and (
      has_permission('moveStages')
      or has_permission('reassign')
      or has_permission('editDealFinancials')
      or assigned_id = current_member_id()
    )
  );

-- The demo has no UI path that deletes a deal (a lost/closed deal just
-- moves to a closed/lost stage) — deny by default (no delete policy);
-- super admins can still act through has_permission()'s own bypass if a
-- later stage adds one.

-- ---------------------------------------------------------------- follow_ups
alter table follow_ups enable row level security;

create policy follow_ups_select on follow_ups for select
  using (org_id = current_org_id() and can_see_member(assignee_id));

-- Created from a lead's follow-up dialog: can("createFollowUps"), and you
-- have to be able to see the lead you're scheduling it for.
create policy follow_ups_insert on follow_ups for insert
  with check (
    org_id = current_org_id()
    and has_permission('createFollowUps')
    and exists (
      select 1 from leads l
       where l.id = follow_ups.lead_id and l.org_id = follow_ups.org_id
         and can_see_member(l.assigned_id)
    )
  );

-- fuDone()/fuSnooze()/fuCancel()/fuReschedule(): none of these are gated by
-- a specific can() check in the demo beyond being able to see the follow-up
-- in the first place (fuReschedule's own "change the assignee" field is the
-- one sub-action gated by can("reassign"), which — like deals_update above
-- — isn't something a single row-level policy can single out from the rest
-- of the same UPDATE without a trigger; deferred the same way).
create policy follow_ups_update on follow_ups for update
  using (org_id = current_org_id() and can_see_member(assignee_id))
  with check (org_id = current_org_id() and can_see_member(assignee_id));

-- No delete policy: the demo never deletes a follow-up, only changes its
-- status (covered by the update policy above).

-- ---------------------------------------------------------------- activities
alter table activities enable row level security;

create policy activities_select on activities for select
  using (
    org_id = current_org_id()
    and exists (
      select 1 from leads l
       where l.id = activities.lead_id and l.org_id = activities.org_id
         and can_see_member(l.assigned_id)
    )
  );

-- features/activity.js's logActivity() sits behind can("editOutcomes")
-- ("Logging attempts is turned off for your role"), and is always logged as
-- the signed-in member — never on someone else's behalf.
create policy activities_insert on activities for insert
  with check (
    org_id = current_org_id()
    and user_id = current_member_id()
    and has_permission('editOutcomes')
    and exists (
      select 1 from leads l
       where l.id = activities.lead_id and l.org_id = activities.org_id
         and can_see_member(l.assigned_id)
    )
  );

-- Activities are an append-only log in the demo — nothing ever edits or
-- deletes a logged attempt, so no update/delete policy is created and both
-- are denied by default once RLS is enabled.

-- ---------------------------------------------------------------- notes
alter table notes enable row level security;

-- views/lead.js and friends additionally hide kind='manager' notes from
-- anyone without can("managerNotes") — folded into the select policy here
-- exactly as those views filter it client-side.
create policy notes_select on notes for select
  using (
    org_id = current_org_id()
    and exists (
      select 1 from leads l
       where l.id = notes.lead_id and l.org_id = notes.org_id
         and can_see_member(l.assigned_id)
    )
    and (notes.kind <> 'manager' or has_permission('managerNotes'))
  );

-- addNote(): can("addNotes"), always as the signed-in member; a manager-only
-- note additionally requires can("managerNotes") (the "Manager-only"
-- checkbox in views/lead.js only renders when that permission is present).
create policy notes_insert on notes for insert
  with check (
    org_id = current_org_id()
    and user_id = current_member_id()
    and has_permission('addNotes')
    and (notes.kind <> 'manager' or has_permission('managerNotes'))
    and exists (
      select 1 from leads l
       where l.id = notes.lead_id and l.org_id = notes.org_id
         and can_see_member(l.assigned_id)
    )
  );

-- Notes are never edited or deleted in the demo once added — no
-- update/delete policy, denied by default once RLS is enabled.
