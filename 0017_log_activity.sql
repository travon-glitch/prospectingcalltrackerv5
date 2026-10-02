-- Stage 6: features/activity.js's logActivity() as a single atomic
-- server-side transaction, called from supabase/functions/log-activity
-- (which resolves the caller's member row from their access token, then
-- calls this function with that caller's id explicitly — has_permission()/
-- can_see_member() in 0015_rls.sql read auth.uid() through RLS policies,
-- but a SECURITY DEFINER function called via the edge function's
-- service-role client has no end-user JWT in its session, so the same
-- checks are re-derived here against an explicit p_caller_id instead of
-- auth.uid(). These *_for() helpers are the auth.uid()-free equivalents of
-- 0015_rls.sql's has_permission()/same_team()/can_see_member() — same
-- logic, parameterized by member id instead of relying on the session.

create or replace function has_permission_for(p_member_id bigint, perm_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select r.super_admin
       from members m
       join roles r on r.org_id = m.org_id and r.id = m.role_id
      where m.id = p_member_id),
    false)
  or coalesce(
    (select rp.allowed
       from members m
       join role_permissions rp
         on rp.org_id = m.org_id and rp.role_id = m.role_id
      where m.id = p_member_id
        and rp.permission_key = case perm_key
              when 'archiveLeads' then 'deleteLeads'
              when 'manageMembers' then 'editUsers'
              else perm_key
            end),
    false);
$$;

create or replace function same_team_for(p_member_id bigint, p_target_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_target_id = p_member_id
    or exists (
      select 1
        from team_members mine
        join team_members theirs on theirs.team_id = mine.team_id
        join teams t on t.id = mine.team_id
       where mine.member_id = p_member_id
         and theirs.member_id = p_target_id
         and not t.archived
    );
$$;

create or replace function can_see_member_for(p_member_id bigint, p_target_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select has_permission_for(p_member_id, 'viewAllLeads')
    or p_target_id = p_member_id
    or (has_permission_for(p_member_id, 'viewTeamLeads') and same_team_for(p_member_id, p_target_id));
$$;

-- features/activity.js's logActivity(leadId, type, outcomeId, {note, fuDate,
-- fuNote, duration, campaignId, phone}) — every side effect it has, in the
-- exact order the demo applies them (including the same-call ordering
-- quirk where a DNC outcome logged together with a follow-up date cancels
-- that brand-new follow-up right back out, same as the demo's own
-- `if(fuDate){...} if(oc?.dnc){...cancel ALL pending...}` sequence).
create or replace function log_activity(
  p_caller_id   bigint,
  p_org_id      bigint,
  p_lead_id     bigint,
  p_type        text,
  p_outcome_id  bigint,
  p_note        text default '',
  p_fu_date     date default null,
  p_fu_note     text default '',
  p_duration    integer default null,
  p_campaign_id bigint default null,
  p_phone       text default null,
  p_list_id     bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads%rowtype;
  v_oc   outcomes%rowtype;
  v_blocked boolean;
  v_activity_id bigint;
  v_full text;
begin
  if p_type not in ('call','text','reply','door_knock') then
    raise exception 'Unknown activity type "%"', p_type;
  end if;

  select * into v_lead from leads where id = p_lead_id and org_id = p_org_id;
  if not found then
    raise exception 'Lead not found' using errcode = '42501';
  end if;

  if not has_permission_for(p_caller_id, 'editOutcomes') then
    raise exception 'Logging attempts is turned off for your role' using errcode = '42501';
  end if;

  if not can_see_member_for(p_caller_id, v_lead.assigned_id) then
    raise exception 'Lead not found' using errcode = '42501';
  end if;

  select * into v_oc from outcomes where id = p_outcome_id and org_id = p_org_id;
  if not found then
    raise exception 'Unknown outcome';
  end if;

  -- isBlocked(l, type): reply is never blocked (a reply came in regardless).
  v_blocked := case p_type
    when 'call'       then (v_lead.dnc or v_lead.dncontact)
    when 'text'        then (v_lead.dnt or v_lead.dncontact)
    when 'door_knock'  then v_lead.dncontact
    else false
  end;
  if p_type <> 'reply' and v_blocked then
    raise exception 'That action is blocked for this lead' using errcode = '42501';
  end if;

  insert into activities (org_id, lead_id, type, outcome_id, user_id, note, list_id, campaign_id, duration_min, phone)
  values (p_org_id, p_lead_id, p_type, p_outcome_id, p_caller_id, coalesce(p_note,''), p_list_id, p_campaign_id, p_duration, p_phone)
  returning id into v_activity_id;

  -- reply marks phone mobile
  if p_type = 'reply' and p_phone is not null then
    update lead_phones set type = 'mobile' where lead_id = p_lead_id and n = p_phone;
  end if;

  -- status transition rules: dnc > appt > conv > new->attempted
  if v_oc.dnc then
    update leads set dnc = true, status_key = 'do_not_call' where id = p_lead_id;
  elsif v_oc.appt then
    update leads set status_key = 'appointment' where id = p_lead_id;
  elsif v_oc.conv then
    update leads set status_key = 'contacted' where id = p_lead_id;
  elsif v_lead.status_key = 'new' then
    update leads set status_key = 'attempted' where id = p_lead_id;
  end if;

  -- a new follow-up replaces the pending one
  if p_fu_date is not null then
    update follow_ups set status = 'cancelled', cancel_reason = 'Replaced by a newer follow-up'
      where lead_id = p_lead_id and status = 'pending';
    insert into follow_ups (org_id, lead_id, due, status, note, assignee_id)
    values (p_org_id, p_lead_id, p_fu_date, 'pending',
            case when coalesce(p_fu_note,'') <> '' then p_fu_note else p_note end,
            coalesce(v_lead.assigned_id, p_caller_id));
  end if;

  -- DNC cancels follow-ups (runs after the replacement above, same order
  -- the demo's own two `if` blocks run in — including on the follow-up
  -- just inserted, if this same call also passed a fu_date)
  if v_oc.dnc then
    update follow_ups set status = 'cancelled', cancel_reason = 'Lead marked Do Not Call'
      where lead_id = p_lead_id and status = 'pending';
  end if;

  v_full := trim(both ' ' from (coalesce(v_lead.first,'') || ' ' || coalesce(v_lead.last,'')));
  insert into audit_log (org_id, user_id, action, table_name, detail)
  values (p_org_id, p_caller_id, 'logged', 'activities',
          replace(p_type, '_', ' ') || ' · ' || v_oc.name || ' · ' || v_full);

  return v_activity_id;
end;
$$;
