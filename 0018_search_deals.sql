-- Stage 10: server-side CRM board search, mirroring 0016_search_leads.sql's
-- own reasoning almost exactly. features/crm.js's crmDeals() walks the
-- whole in-memory db.deals array — filtering, computing dealMath() per row,
-- and sorting — every time #crm draws; search_deals() is that same filter/
-- sort logic, plus dealMath()'s net/weighted and dealFu()/dealLastContact()/
-- dealCalls()/dealTexts() as derived columns, done once in Postgres instead
-- of walking a client-side cache that a real backend can't always hold in
-- full. SECURITY INVOKER (the default) on purpose, same as search_leads():
-- it runs as the calling member, so 0015_rls.sql's deals_select policy
-- (can_see_member(assigned_id)) already scopes every row this function
-- touches — this only adds filtering, sorting and the derived math on top
-- of whatever the caller can already see.
--
-- p_pipeline is required (the board always shows one pipeline at a time).
-- Every other p_* mirrors one key of features/crm.js's crmDefaultFilters()
-- object 1:1 (p_q is state.crm.q; p_overdue is state.crm.overdue; and so
-- on), and p_sort mirrors state.crm.sort — unrecognised values fall back to
-- 'newest', same as crmDeals()'s own `sorters[f.sort] || sorters.newest`.
create or replace function search_deals(
  p_pipeline    bigint,
  p_q           text    default '',
  p_agent       bigint  default null,
  p_stage       bigint  default null,
  p_temp        text    default null,
  p_campaign    bigint  default null,
  p_source      text    default null,
  p_city        text    default null,
  p_zip         text    default null,
  p_overdue     boolean default false,
  p_fu_from     date    default null,
  p_fu_to       date    default null,
  p_price_min   numeric default null,
  p_price_max   numeric default null,
  p_comm_min    numeric default null,
  p_comm_max    numeric default null,
  p_close_from  date    default null,
  p_close_to    date    default null,
  p_added_from  date    default null,
  p_added_to    date    default null,
  p_active_from date    default null,
  p_sort        text    default 'newest'
)
returns table (
  id                bigint,
  lead_id           bigint,
  pipeline_id       bigint,
  stage_id          bigint,
  assigned_id       bigint,
  temperature       text,
  price             numeric,
  comm_pct          numeric,
  referral_pct      numeric,
  team_split_pct    numeric,
  brokerage_pct     numeric,
  brokerage_fee     numeric,
  closing_costs     numeric,
  close_date        date,
  next_fu           date,
  notes             text,
  stage_entered_at  timestamptz,
  created_by        bigint,
  created_at        timestamptz,
  net               numeric,
  weighted          numeric,
  fu_due            date,
  last_contact      timestamptz,
  calls             integer,
  texts             integer
)
language sql stable
as $$
  with qd as (
    select regexp_replace(coalesce(p_q,''), '\D', '', 'g') as digits
  ),
  fu as (
    -- nextFu(): the soonest-due pending follow-up on the lead itself —
    -- dealFu() prefers the deal's own next_fu and only falls back to this
    -- when the deal has none, exactly like the CASE below.
    select distinct on (f.lead_id) f.lead_id, f.due as next_follow_up_due
    from follow_ups f
    where f.status = 'pending'
    order by f.lead_id, f.due asc
  ),
  acts as (
    -- dealLastContact()/dealCalls()/dealTexts(): leadActs() is every logged
    -- activity, so a reply counts toward "last contact" same as a call or
    -- text does here.
    select a.lead_id,
      max(a.at)                                     as last_contact,
      count(*) filter (where a.type = 'call')        as calls,
      count(*) filter (where a.type = 'text')        as texts
    from activities a
    group by a.lead_id
  ),
  camps as (
    -- leadCampaigns(): only non-archived campaigns count.
    select distinct cl.lead_id, cl.campaign_id
    from campaign_leads cl
    join campaigns c on c.id = cl.campaign_id and not c.archived
  ),
  base as (
    select
      d.*,
      l.first, l.last, l.addr, l.city, l.zip, l.source, l.archived as lead_archived,
      s.prob as stage_prob, s.kind as stage_kind,
      coalesce(d.next_fu, fu.next_follow_up_due) as computed_fu_due,
      acts.last_contact,
      coalesce(acts.calls, 0) as calls,
      coalesce(acts.texts, 0) as texts,
      -- dealMath(): gross -> minus referral -> minus brokerage split/fee ->
      -- minus closing costs = net; weighted = net * stage probability.
      -- least/greatest here are pct()'s own 0-100 clamp, applied the same
      -- way dealMath() clamps every percentage before using it.
      (
        d.price * least(100, greatest(0, d.comm_pct)) / 100
      ) as gross_amt
    from deals d
    join leads l on l.id = d.lead_id
    join stages s on s.id = d.stage_id
    left join fu on fu.lead_id = d.lead_id
    left join acts on acts.lead_id = d.lead_id
    where d.pipeline_id = p_pipeline
      and not l.archived
  ),
  math as (
    select
      b.*,
      b.gross_amt * least(100, greatest(0, b.referral_pct)) / 100 as referral_amt
    from base b
  ),
  math2 as (
    select
      m.*,
      (m.gross_amt - m.referral_amt) as after_ref,
      (m.gross_amt - m.referral_amt) * least(100, greatest(0, m.brokerage_pct)) / 100 + m.brokerage_fee as brokerage_amt
    from math m
  ),
  math3 as (
    select
      m2.*,
      greatest(0, m2.after_ref - m2.brokerage_amt) as after_brok
    from math2 m2
  ),
  computed as (
    select
      m3.*,
      greatest(0, m3.after_brok - m3.closing_costs) as net_amt
    from math3 m3
  ),
  weighed as (
    select
      c.*,
      c.net_amt * least(100, greatest(0, c.stage_prob)) / 100 as weighted_amt,
      -- fuTone(): only an active-kind stage's follow-up can be "overdue";
      -- closed/lost deals never show the red state.
      (c.stage_kind = 'active' and c.computed_fu_due is not null and c.computed_fu_due < current_date) as is_overdue
    from computed c
  ),
  filtered as (
    select c.*
    from weighed c
    where
      (
        coalesce(p_q, '') = ''
        or strpos(
             lower(coalesce(c.first,'') || ' ' || coalesce(c.last,'') || ' ' || coalesce(c.addr,'') || ' ' || coalesce(c.city,'')),
             lower(p_q)
           ) > 0
        or (
          length((select digits from qd)) >= 1
          and exists (select 1 from lead_phones lp where lp.lead_id = c.lead_id and strpos(lp.n, (select digits from qd)) > 0)
        )
      )
      and (p_agent    is null or c.assigned_id = p_agent)
      and (p_stage    is null or c.stage_id = p_stage)
      and (p_temp     is null or p_temp = '' or c.temperature = p_temp)
      and (p_campaign is null or exists (select 1 from camps where camps.lead_id = c.lead_id and camps.campaign_id = p_campaign))
      and (p_source   is null or p_source = '' or c.source = p_source)
      and (p_city     is null or p_city = '' or lower(coalesce(c.city,'')) = lower(p_city))
      and (p_zip      is null or p_zip = '' or coalesce(c.zip,'') = p_zip)
      and (not p_overdue or c.is_overdue)
      and (p_fu_from  is null or (c.computed_fu_due is not null and c.computed_fu_due >= p_fu_from))
      and (p_fu_to    is null or (c.computed_fu_due is not null and c.computed_fu_due <= p_fu_to))
      and (p_price_min is null or c.price >= p_price_min)
      and (p_price_max is null or c.price <= p_price_max)
      and (p_comm_min  is null or c.net_amt >= p_comm_min)
      and (p_comm_max  is null or c.net_amt <= p_comm_max)
      and (p_close_from is null or (c.close_date is not null and c.close_date >= p_close_from))
      and (p_close_to   is null or (c.close_date is not null and c.close_date <= p_close_to))
      and (p_added_from is null or c.created_at::date >= p_added_from)
      and (p_added_to   is null or c.created_at::date <= p_added_to)
      and (p_active_from is null or (c.last_contact is not null and c.last_contact::date >= p_active_from))
  )
  select
    id, lead_id, pipeline_id, stage_id, assigned_id, temperature, price, comm_pct, referral_pct,
    team_split_pct, brokerage_pct, brokerage_fee, closing_costs, close_date, next_fu, notes,
    stage_entered_at, created_by, created_at,
    round(net_amt, 2) as net, round(weighted_amt, 2) as weighted,
    computed_fu_due as fu_due, last_contact, calls::integer, texts::integer
  from filtered
  order by
    -- Every CASE is null outside its own p_sort, so only the active sort's
    -- term affects ordering; `id asc` breaks every remaining tie, the same
    -- role it plays in search_leads() (Array.sort is stable in the demo, so
    -- an unresolved tie there keeps db.deals' own insertion/id order).
    case when p_sort = 'oldest' then created_at end asc,
    case when p_sort = 'price' then price end desc,
    case when p_sort = 'commission' then net_amt end desc,
    -- 'overdue' is deliberately identical to 'followup' — crmDeals()'s own
    -- two sorters are the same one-line comparator, so this is too.
    case when p_sort in ('followup','overdue') then computed_fu_due end asc nulls last,
    case when p_sort = 'stagetime' then stage_entered_at end asc,
    case when p_sort = 'activity' then coalesce(last_contact, created_at) end desc,
    case when p_sort is null or p_sort not in ('oldest','price','commission','followup','overdue','stagetime','activity') then created_at end desc,
    id asc;
$$;

comment on function search_deals is
  'features/crm.js crmDeals(), server-side: same 19 filters/8 sorts, plus net/weighted/fu_due/last_contact/calls/texts as derived columns (dealMath()/dealFu()/dealLastContact()/dealCalls()/dealTexts()). Runs as the caller (security invoker), so 0015_rls.sql''s deals_select policy already scopes every row.';
