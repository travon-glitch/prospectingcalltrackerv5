-- Stage 5: server-side leads search, plus the two write-time guards the
-- demo enforces before ever writing a lead's phone or a custom field
-- value — duplicate-phone (features/leads.js's leadForm()) and cfClean()'s
-- per-type validation (core/fields.js), now re-checked at the database so
-- a direct REST/RPC write can't skip either one.

-- ---------------------------------------------------------- search_leads
-- features/leads.js's filteredLeads(): same filters, same sort orders, same
-- substring-over-name/addr/city/zip/email/list-names/campaign-names search
-- (plus a >=3-digit phone match), now done in one query instead of walking
-- the whole array in the browser. SECURITY INVOKER (the default — not
-- declared security definer) on purpose: it runs as the calling user, so
-- Stage 4's RLS on leads/activities/follow_ups already scopes every row it
-- touches exactly the way canSee()/can_see_member() do — this function
-- does not re-implement visibility, only filtering/sorting/pagination on
-- top of whatever rows RLS already lets the caller see.
--
-- p_status/p_assigned/p_list/p_campaign/p_outcome: null/empty means "Any",
-- matching the demo's state.status===""/state.assigned===""/etc. p_dnc
-- ('any'|'blocked'|'dnc'|'dnt'|'none') and p_fu ('any'|'scheduled'|
-- 'overdue'|'none') mirror state.dnc/state.fu directly. p_sort
-- ('name'|'attempts'|'last'|'fu'|'newest') mirrors state.sort; anything
-- else falls back to 'name', same as filteredLeads()'s own sort switch
-- falling through to full-name compare.
create or replace function search_leads(
  p_q          text    default '',
  p_status     text    default null,
  p_assigned   bigint  default null,
  p_list       bigint  default null,
  p_campaign   bigint  default null,
  p_dnc        text    default 'any',
  p_fu         text    default 'any',
  p_outcome    bigint  default null,
  p_att_min    integer default null,
  p_att_max    integer default null,
  p_la_from    date    default null,
  p_la_to      date    default null,
  p_sort       text    default 'name',
  p_page       integer default 0,
  p_page_size  integer default 25
)
returns table (
  id                bigint,
  first             text,
  last              text,
  email             text,
  addr              text,
  city              text,
  state             text,
  zip               text,
  assigned_id       bigint,
  status_key        text,
  dnc               boolean,
  dnt               boolean,
  dncontact         boolean,
  source            text,
  created_at        timestamptz,
  phone             text,
  attempts          integer,
  last_attempt_at   timestamptz,
  last_outcome_id   bigint,
  next_follow_up_due date,
  list_names        text,
  campaign_names    text,
  total_count       bigint
)
language sql stable
as $$
  with qd as (
    -- digits(q): filteredLeads() only tries a phone match once the query
    -- has 3+ digits in it, exactly like this.
    select regexp_replace(coalesce(p_q,''), '\D', '', 'g') as digits
  ),
  base as (
    select l.*,
      (select p.n from lead_phones p where p.lead_id = l.id order by p.position asc, p.id asc limit 1) as primary_phone
    from leads l
    where not l.archived
  ),
  acts as (
    select a.lead_id,
      count(*) filter (where a.type <> 'reply')                                            as attempts,
      max(a.at) filter (where a.type <> 'reply')                                            as last_attempt_at,
      (array_agg(a.outcome_id order by a.at desc) filter (where a.type <> 'reply'))[1]       as last_outcome_id
    from activities a
    group by a.lead_id
  ),
  fu as (
    -- nextFu(): the soonest-due pending follow-up.
    select distinct on (f.lead_id) f.lead_id, f.due as next_follow_up_due
    from follow_ups f
    where f.status = 'pending'
    order by f.lead_id, f.due asc
  ),
  names as (
    select ll.lead_id, string_agg(li.name, ', ') as list_names
    from lead_lists ll join lists li on li.id = ll.list_id
    group by ll.lead_id
  ),
  camps as (
    select cl.lead_id, string_agg(c.name, ', ') as campaign_names
    from campaign_leads cl join campaigns c on c.id = cl.campaign_id and not c.archived
    group by cl.lead_id
  ),
  filtered as (
    select
      b.id, b.first, b.last, b.email, b.addr, b.city, b.state, b.zip,
      b.assigned_id, b.status_key, b.dnc, b.dnt, b.dncontact, b.source, b.created_at,
      b.primary_phone,
      coalesce(a.attempts, 0) as attempts,
      a.last_attempt_at,
      a.last_outcome_id,
      fu.next_follow_up_due,
      n.list_names,
      c2.campaign_names
    from base b
    left join acts  a  on a.lead_id  = b.id
    left join fu       on fu.lead_id = b.id
    left join names n  on n.lead_id  = b.id
    left join camps c2 on c2.lead_id = b.id
    where
      (
        coalesce(p_q, '') = ''
        or strpos(
             lower(
               coalesce(b.first,'') || ' ' || coalesce(b.last,'') || ' ' || coalesce(b.addr,'') || ' ' ||
               coalesce(b.city,'')  || ' ' || coalesce(b.zip,'')  || ' ' || coalesce(b.email,'') || ' ' ||
               coalesce(n.list_names,'') || ' ' || coalesce(c2.campaign_names,'')
             ),
             lower(p_q)
           ) > 0
        or (
          length((select digits from qd)) >= 3
          and exists (select 1 from lead_phones lp where lp.lead_id = b.id and strpos(lp.n, (select digits from qd)) > 0)
        )
      )
      and (p_status   is null or b.status_key = p_status)
      and (p_assigned is null or b.assigned_id = p_assigned)
      and (p_list     is null or exists (select 1 from lead_lists ll2 where ll2.lead_id = b.id and ll2.list_id = p_list))
      and (p_campaign is null or exists (select 1 from campaign_leads cl2 where cl2.lead_id = b.id and cl2.campaign_id = p_campaign))
      and (
        coalesce(p_dnc, 'any') = 'any'
        or (p_dnc = 'blocked' and (b.dnc or b.dnt or b.dncontact))
        or (p_dnc = 'dnc'     and b.dnc)
        or (p_dnc = 'dnt'     and b.dnt)
        or (p_dnc = 'none'    and not (b.dnc or b.dnt or b.dncontact))
      )
      and (
        coalesce(p_fu, 'any') = 'any'
        or (p_fu = 'scheduled' and fu.next_follow_up_due is not null)
        or (p_fu = 'overdue'   and fu.next_follow_up_due is not null and fu.next_follow_up_due < current_date)
        or (p_fu = 'none'      and fu.next_follow_up_due is null)
      )
      and (p_outcome is null or a.last_outcome_id = p_outcome)
      and (p_att_min is null or coalesce(a.attempts, 0) >= p_att_min)
      and (p_att_max is null or coalesce(a.attempts, 0) <= p_att_max)
      and (p_la_from is null or a.last_attempt_at >= p_la_from)
      and (p_la_to   is null or a.last_attempt_at::date <= p_la_to)
  ),
  counted as (
    select *, count(*) over () as total_count from filtered
  )
  select
    id, first, last, email, addr, city, state, zip, assigned_id, status_key, dnc, dnt, dncontact,
    source, created_at, primary_phone as phone, attempts, last_attempt_at, last_outcome_id,
    next_follow_up_due, list_names, campaign_names, total_count
  from counted
  order by
    -- Each CASE below is null for every row except under its own p_sort,
    -- so only the active sort's terms affect ordering; `id asc` at the end
    -- is the tie-break every one of these modes falls back to (JS's
    -- Array.sort is stable, so unresolved ties in the demo keep
    -- visibleLeads()'s own order — insertion/id order on seed data).
    case when p_sort = 'attempts' then attempts end desc,
    case when p_sort = 'attempts' then lower(coalesce(first,'') || ' ' || coalesce(last,'')) end asc,
    case when p_sort = 'last' then last_attempt_at end desc nulls last,
    case when p_sort = 'fu' then next_follow_up_due end asc nulls last,
    case when p_sort = 'newest' then created_at end desc,
    case when p_sort is null or p_sort not in ('attempts','last','fu','newest') then lower(coalesce(first,'') || ' ' || coalesce(last,'')) end asc,
    id asc
  offset greatest(p_page, 0) * greatest(p_page_size, 1)
  limit greatest(p_page_size, 1);
$$;

comment on function search_leads is
  'features/leads.js filteredLeads(), server-side: same filters/sort/pagination, plus attempts/last_attempt_at/last_outcome_id/next_follow_up_due as derived columns and total_count for the pager. Runs as the caller (security invoker), so Stage 4''s RLS already scopes every row.';

-- ------------------------------------------------------- duplicate phones
-- leadForm()'s create-time guard ("That number already belongs to ...") and
-- addPhone()'s own-lead guard ("Already on this lead") both only ever check
-- non-archived leads; this mirrors exactly that — archiving a lead frees up
-- its numbers, same as the client-side check already implied.
create or replace function check_duplicate_lead_phone()
returns trigger
language plpgsql
as $$
declare
  dup_name text;
begin
  select trim(l.first || ' ' || l.last) into dup_name
    from lead_phones p
    join leads l on l.id = p.lead_id
   where p.n = new.n
     and p.lead_id <> new.lead_id
     and not l.archived
   limit 1;

  if dup_name is not null then
    -- leadForm()'s own text: `That number already belongs to ${full(dup)}`
    raise exception 'That number already belongs to %', dup_name using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger check_duplicate_lead_phone
  before insert or update of n, lead_id on lead_phones
  for each row execute function check_duplicate_lead_phone();

-- ------------------------------------------------------ custom value type
-- core/fields.js's cfClean(), re-checked at the database: lead_custom_values
-- stores raw jsonb, so nothing about its column types stops a client from
-- writing a string into a 'number' field or an out-of-list value into a
-- 'choice' field — this trigger is that missing check. Mirrors cfClean()'s
-- per-type rules; setCustom() on the client already keeps well-formed
-- clients out of this path entirely (it calls cfClean() itself first), so
-- this only ever fires for a value that skipped the client-side check.
create or replace function validate_lead_custom_value()
returns trigger
language plpgsql
as $$
declare
  f record;
begin
  select key, label, type, choices into f
    from custom_fields
   where org_id = new.org_id and key = new.field_key;

  if not found then
    raise exception 'Unknown custom field "%"', new.field_key;
  end if;

  if f.type = 'number' or f.type = 'money' then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception '% needs a number', f.label;
    end if;
  elsif f.type = 'date' then
    if jsonb_typeof(new.value) <> 'string' or new.value::text !~ '^"[0-9]{4}-[0-9]{2}-[0-9]{2}"$' then
      raise exception '% needs a date', f.label;
    end if;
  elsif f.type = 'yes_no' then
    if jsonb_typeof(new.value) <> 'boolean' then
      raise exception '% needs Yes or No', f.label;
    end if;
  elsif f.type = 'choice' then
    if jsonb_typeof(new.value) <> 'string' or not (new.value #>> '{}') = any (select jsonb_array_elements_text(f.choices)) then
      raise exception '% must be one of: %', f.label, (select string_agg(x, ', ') from jsonb_array_elements_text(f.choices) x);
    end if;
  elsif f.type = 'long_text' then
    if jsonb_typeof(new.value) <> 'string' or length(new.value #>> '{}') > 2000 then
      raise exception '% must be 2000 characters or fewer', f.label;
    end if;
  else -- 'text'
    if jsonb_typeof(new.value) <> 'string' or length(new.value #>> '{}') > 200 then
      raise exception '% must be 200 characters or fewer', f.label;
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_lead_custom_value
  before insert or update of value, field_key on lead_custom_values
  for each row execute function validate_lead_custom_value();
