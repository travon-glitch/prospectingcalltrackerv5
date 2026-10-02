-- Stage 11: server-side aggregation for #dashboard/#reports/#scoreboard/
-- #crmdash. Every function here is SECURITY INVOKER (the default) on
-- purpose, same reasoning as 0016_search_leads.sql/0018_search_deals.sql:
-- it runs as the calling member, so activities_select/deals_select's own
-- RLS already scopes every row before any of this ever sums it — an agent
-- who can only see their own leads' activities/deals gets own-only
-- figures, a manager who can see everyone's gets the team's, with no
-- separate "am I a manager" branch needed in the SQL itself.
--
-- features/stats.js's stats(userId, range) and pace() take a concrete
-- [from, to] date pair (rangeFor()'s own week/month/all-time strings,
-- "all" being the sentinel ["2000-01-01","2999-12-31"] the local backend
-- already uses) — every p_from/p_to below is that same pair, always
-- supplied, never null, so there is no separate "no range" branch to
-- reason about here either.

-- ---------------------------------------------------------------- member_stats
-- stats(userId, range)'s own math, ported 1:1: conv/appts count *every*
-- activity type with a conv/appt outcome (not just calls) — that is what
-- feeds the points formula and the displayed "conv"/"appts" columns — while
-- `rate` alone is call-type-conv ÷ calls, a narrower ratio than the `conv`
-- count above it. p_member_id null means every activity this caller's RLS
-- lets through (views/dashboard.js's own `can("viewTeamReports")?null:me.id`
-- call), matching stats(null, range) on the local backend.
-- `total` is every matched activity regardless of type (calls+texts+
-- doors+replies) — views/reports.js's page header ("Built from N logged
-- activities") is the local backend's own `acts.length`, which counts
-- 'reply' rows too, unlike calls/texts/doors above.
create or replace function member_stats(p_member_id bigint, p_from date, p_to date)
returns table (
  calls integer, texts integer, doors integer, conv integer, appts integer,
  rate integer, points numeric, minutes integer, total integer
)
language sql stable
as $$
  with s as (
    select pts_call, pts_text, pts_door, pts_conv, pts_appt
    from org_settings where org_id = current_org_id()
  ),
  acts as (
    select a.type, a.duration_min, oc.conv as oc_conv, oc.appt as oc_appt
    from activities a
    left join outcomes oc on oc.id = a.outcome_id
    where a.org_id = current_org_id()
      and (p_member_id is null or a.user_id = p_member_id)
      and a.at::date >= p_from and a.at::date <= p_to
  )
  select
    count(*) filter (where type='call')::int as calls,
    count(*) filter (where type='text')::int as texts,
    count(*) filter (where type='door_knock')::int as doors,
    count(*) filter (where oc_conv)::int as conv,
    count(*) filter (where oc_appt)::int as appts,
    case when count(*) filter (where type='call') = 0 then 0
      else round(100.0 * count(*) filter (where type='call' and oc_conv) / count(*) filter (where type='call'))::int
    end as rate,
    (count(*) filter (where type='call') * s.pts_call
      + count(*) filter (where type='text') * s.pts_text
      + count(*) filter (where type='door_knock') * s.pts_door
      + count(*) filter (where oc_conv) * s.pts_conv
      + count(*) filter (where oc_appt) * s.pts_appt) as points,
    coalesce(sum(duration_min) filter (where type='call'), 0)::int as minutes,
    count(*)::int as total
  from acts, s
  group by s.pts_call, s.pts_text, s.pts_door, s.pts_conv, s.pts_appt;
$$;

comment on function member_stats is
  'features/stats.js stats(userId, range), server-side. p_member_id null = every activity this caller can see (team); a member id = that member only.';

-- --------------------------------------------------------------- outcome_counts
-- views/reports.js's byOutcome: how many logged activities (any type)
-- landed on each outcome, in range and within this caller's own
-- team-vs-own scope.
create or replace function outcome_counts(p_member_id bigint, p_from date, p_to date)
returns table (outcome_id bigint, n bigint)
language sql stable
as $$
  select a.outcome_id, count(*) as n
  from activities a
  where a.org_id = current_org_id()
    and (p_member_id is null or a.user_id = p_member_id)
    and a.at::date >= p_from and a.at::date <= p_to
  group by a.outcome_id;
$$;

-- ------------------------------------------------------------------ list_counts
-- views/reports.js's byList: attempts (any activity type) per list.
create or replace function list_counts(p_member_id bigint, p_from date, p_to date)
returns table (list_id bigint, n bigint)
language sql stable
as $$
  select a.list_id, count(*) as n
  from activities a
  where a.org_id = current_org_id()
    and (p_member_id is null or a.user_id = p_member_id)
    and a.at::date >= p_from and a.at::date <= p_to
    and a.list_id is not null
  group by a.list_id;
$$;

-- -------------------------------------------------------------- campaign_counts
-- views/reports.js's byCamp: texts sent and replies logged per campaign —
-- a campaign only appears if it has *some* logged activity in range (any
-- type), same as the local backend's own `.filter(([,a])=>a.length)`, even
-- though only the text/reply counts are ever displayed.
create or replace function campaign_counts(p_member_id bigint, p_from date, p_to date)
returns table (campaign_id bigint, sent bigint, replies bigint)
language sql stable
as $$
  select a.campaign_id,
    count(*) filter (where a.type='text') as sent,
    count(*) filter (where a.type='reply') as replies
  from activities a
  where a.org_id = current_org_id()
    and (p_member_id is null or a.user_id = p_member_id)
    and a.at::date >= p_from and a.at::date <= p_to
    and a.campaign_id is not null
  group by a.campaign_id;
$$;

-- -------------------------------------------------------------- calls_by_hour
-- views/reports.js's byHour groups by `new Date(a.at).getHours()` — the
-- caller's *local* clock hour, not UTC — so p_tz (the browser's own IANA
-- zone, Intl.DateTimeFormat().resolvedOptions().timeZone) is required to
-- reproduce that grouping server-side; the date-range bound above stays a
-- plain UTC-calendar-day compare, same as every other range filter in this
-- file and in 0018_search_deals.sql.
create or replace function calls_by_hour(p_member_id bigint, p_from date, p_to date, p_tz text default 'UTC')
returns table (hour integer, calls bigint, contacted bigint)
language sql stable
as $$
  select extract(hour from a.at at time zone p_tz)::int as hour,
    count(*) as calls,
    count(*) filter (where oc.conv) as contacted
  from activities a
  left join outcomes oc on oc.id = a.outcome_id
  where a.org_id = current_org_id()
    and a.type = 'call'
    and (p_member_id is null or a.user_id = p_member_id)
    and a.at::date >= p_from and a.at::date <= p_to
  group by 1;
$$;

-- ============================================================= CRM dashboard
-- views/crmdash.js's own filtered `ds` (pipeline/agent/campaign/added-date,
-- plus canSeeDeal()/archived-lead/archived-pipeline exclusion — the latter
-- two are the WHERE clause below, the former is deals_select's RLS on a
-- SECURITY INVOKER function, same as crm_dashboard_rows()'s siblings), with
-- dealMath()'s own gross->referral->brokerage->net->weighted chain
-- (0018_search_deals.sql's own CTE-per-step shape, for the same "a computed
-- alias can't be reused in the same SELECT's WHERE" reason) computed once
-- per deal. crm_dashboard_by_kind/_by_stage/_by_agent below all build on
-- this shared row set instead of repeating the math three times.
create or replace function crm_dashboard_rows(
  p_pipeline bigint default null, p_agent bigint default null, p_campaign bigint default null,
  p_from date default null, p_to date default null
)
returns table (
  deal_id bigint, pipeline_id bigint, stage_id bigint, assigned_id bigint,
  stage_name text, stage_kind text, stage_prob numeric, stage_color text,
  price numeric, gross_amt numeric, net_amt numeric, weighted_amt numeric,
  stage_entered_at timestamptz, computed_fu_due date, is_overdue boolean,
  first text, last text
)
language sql stable
as $$
  with camps as (
    select distinct cl.lead_id, cl.campaign_id
    from campaign_leads cl join campaigns c on c.id = cl.campaign_id and not c.archived
  ),
  fu as (
    select distinct on (f.lead_id) f.lead_id, f.due as next_follow_up_due
    from follow_ups f where f.status='pending' order by f.lead_id, f.due asc
  ),
  base as (
    select d.id as deal_id, d.pipeline_id, d.stage_id, d.assigned_id, d.price, d.comm_pct, d.referral_pct,
      d.brokerage_pct, d.brokerage_fee, d.closing_costs, d.stage_entered_at, d.next_fu,
      l.first, l.last,
      s.name as stage_name, s.kind as stage_kind, s.prob as stage_prob, s.color as stage_color,
      coalesce(d.next_fu, fu.next_follow_up_due) as computed_fu_due,
      (d.price * least(100, greatest(0, d.comm_pct)) / 100) as gross_amt
    from deals d
    join leads l on l.id = d.lead_id
    join stages s on s.id = d.stage_id
    join pipelines pl on pl.id = d.pipeline_id
    left join fu on fu.lead_id = d.lead_id
    where not l.archived and not pl.archived
      and (p_pipeline is null or d.pipeline_id = p_pipeline)
      and (p_agent is null or d.assigned_id = p_agent)
      and (p_campaign is null or exists (select 1 from camps where camps.lead_id = d.lead_id and camps.campaign_id = p_campaign))
      and (p_from is null or d.created_at::date >= p_from)
      and (p_to is null or d.created_at::date <= p_to)
  ),
  m1 as (
    select b.*, b.gross_amt * least(100, greatest(0, b.referral_pct)) / 100 as referral_amt from base b
  ),
  m2 as (
    select m.*, (m.gross_amt - m.referral_amt) as after_ref,
      (m.gross_amt - m.referral_amt) * least(100, greatest(0, m.brokerage_pct)) / 100 + m.brokerage_fee as brokerage_amt
    from m1 m
  ),
  m3 as (
    select m2.*, greatest(0, m2.after_ref - m2.brokerage_amt) as after_brok from m2 m2
  ),
  computed as (
    select m3.*, greatest(0, m3.after_brok - m3.closing_costs) as net_amt from m3 m3
  )
  select c.deal_id, c.pipeline_id, c.stage_id, c.assigned_id,
    c.stage_name, c.stage_kind, c.stage_prob, c.stage_color,
    c.price, c.gross_amt, c.net_amt,
    c.net_amt * least(100, greatest(0, c.stage_prob)) / 100 as weighted_amt,
    c.stage_entered_at, c.computed_fu_due,
    (c.stage_kind = 'active' and c.computed_fu_due is not null and c.computed_fu_due < current_date) as is_overdue,
    c.first, c.last
  from computed c;
$$;

-- kpi()'s active/closed/lost cards: n/price/gross/net/weighted per kind,
-- plus the three regex-named sub-counts the "Appointments scheduled" /
-- "Listings signed" / "Under contract" KPI cards use (nameHas() against
-- `active` only in the local backend, but harmless to compute per kind
-- here since a non-active stage almost never matches these names), and the
-- first 3 overdue leads' names per kind for the "Overdue follow-ups" card's
-- sample text.
create or replace function crm_dashboard_by_kind(
  p_pipeline bigint default null, p_agent bigint default null, p_campaign bigint default null,
  p_from date default null, p_to date default null
)
returns table (
  kind text, n integer, price numeric, gross numeric, net numeric, weighted numeric,
  appt_count integer, listing_count integer, contract_count integer,
  overdue_count integer, overdue_sample text
)
language sql stable
as $$
  with rows as (
    select * from crm_dashboard_rows(p_pipeline, p_agent, p_campaign, p_from, p_to)
  ),
  overdue_by_kind as (
    select stage_kind, string_agg(first || ' ' || last, ', ' order by computed_fu_due) as sample
    from (
      select stage_kind, first, last, computed_fu_due,
        row_number() over (partition by stage_kind order by computed_fu_due) as rn
      from rows where is_overdue
    ) x
    where rn <= 3
    group by stage_kind
  )
  select r.stage_kind as kind,
    count(*)::int as n,
    coalesce(sum(r.price), 0) as price,
    coalesce(sum(r.gross_amt), 0) as gross,
    coalesce(sum(r.net_amt), 0) as net,
    coalesce(sum(r.weighted_amt), 0) as weighted,
    count(*) filter (where r.stage_name ~* 'appointment scheduled')::int as appt_count,
    count(*) filter (where r.stage_name ~* 'listing signed|active listing')::int as listing_count,
    count(*) filter (where r.stage_name ~* 'under contract')::int as contract_count,
    count(*) filter (where r.is_overdue)::int as overdue_count,
    coalesce(ob.sample, '') as overdue_sample
  from rows r
  left join overdue_by_kind ob on ob.stage_kind = r.stage_kind
  group by r.stage_kind, ob.sample;
$$;

-- "By stage" table: p_pipeline is required here (unlike the shared row
-- function above) — the local backend always resolves one concrete
-- pipeline to show stage rows for (`pipeline(f.pipe) || pipelines()[0]`)
-- even when the toolbar's own pipeline filter is blank, and the client
-- passes that resolved id. avg_days floors each deal's days-in-stage
-- first, then averages and rounds — same two-step daysIn()-then-
-- Math.round() order the local backend uses, not round-then-average.
create or replace function crm_dashboard_by_stage(
  p_pipeline bigint, p_agent bigint default null, p_campaign bigint default null,
  p_from date default null, p_to date default null
)
returns table (
  stage_id bigint, stage_name text, stage_color text, stage_prob numeric, "position" integer,
  leads integer, share_pct integer, avg_days integer, weighted numeric
)
language sql stable
as $$
  with rows as (
    select * from crm_dashboard_rows(p_pipeline, p_agent, p_campaign, p_from, p_to)
  ),
  total as (select count(*) as n from rows),
  by_stage as (
    select stage_id, count(*) as n,
      round(avg(floor(extract(epoch from (now() - stage_entered_at)) / 86400))) as avg_days,
      sum(weighted_amt) as weighted
    from rows group by stage_id
  )
  select s.id as stage_id, s.name as stage_name, s.color as stage_color, s.prob as stage_prob, s."position",
    coalesce(b.n, 0)::int as leads,
    case when t.n = 0 then 0 else round(100.0 * coalesce(b.n, 0) / t.n)::int end as share_pct,
    coalesce(b.avg_days, 0)::int as avg_days,
    coalesce(b.weighted, 0) as weighted
  from stages s
  cross join total t
  left join by_stage b on b.stage_id = s.id
  where s.pipeline_id = p_pipeline and not s.archived
  order by s."position";
$$;

-- "Production by agent" table: the regex sets here are the by-agent
-- table's own — deliberately different from crm_dashboard_by_kind's
-- ("appointment" alone, not "appointment scheduled"; "under contract"
-- folded into the listings count too) — and computed over *every* kind of
-- deal (active/closed/lost alike), matching the local backend's own
-- `mine.filter(d=>nameHas(...))` calls, which never restrict `mine` to the
-- active subset the way the KPI cards above do.
create or replace function crm_dashboard_by_agent(
  p_pipeline bigint default null, p_agent bigint default null, p_campaign bigint default null,
  p_from date default null, p_to date default null
)
returns table (
  agent_id bigint, active_n integer, appts integer, listings integer, closed_n integer,
  forecast numeric, closed_net numeric
)
language sql stable
as $$
  select assigned_id as agent_id,
    count(*) filter (where stage_kind='active')::int as active_n,
    count(*) filter (where stage_name ~* 'appointment')::int as appts,
    count(*) filter (where stage_name ~* 'signed|active listing|under contract')::int as listings,
    count(*) filter (where stage_kind='closed')::int as closed_n,
    coalesce(sum(weighted_amt) filter (where stage_kind='active'), 0) as forecast,
    coalesce(sum(net_amt) filter (where stage_kind='closed'), 0) as closed_net
  from crm_dashboard_rows(p_pipeline, p_agent, p_campaign, p_from, p_to)
  group by assigned_id;
$$;

comment on function crm_dashboard_rows is
  'views/crmdash.js''s filtered deal set with dealMath() computed per row, security invoker so deals_select''s RLS already scopes it; crm_dashboard_by_kind/_by_stage/_by_agent build on it.';
