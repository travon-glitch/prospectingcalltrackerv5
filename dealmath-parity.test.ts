// GATE G2: parity test between the local JS dealMath() (src/features/
// crm.js) and the equivalent SQL arithmetic already implemented inside
// supabase/migrations/0018_search_deals.sql's search_deals() CTE chain
// (gross_amt -> referral_amt -> after_ref/brokerage_amt -> after_brok ->
// net_amt -> weighted_amt).
//
// Standing up the full search_deals() function needs a fully-populated
// leads/deals/pipelines/stages schema plus RLS context, which is overkill
// for testing arithmetic parity. Instead this file extracts JUST that math
// chain into a minimal, throwaway SQL helper function
// (dealmath_check(...)), created in its own throwaway test database, whose
// body is copied VERBATIM from 0018_search_deals.sql's own CTEs (including
// the least/greatest clamps, which are that migration's version of
// pct()'s 0-100 clamp) - so a genuine SQL/JS drift would be caught here,
// not hidden behind a hand-reimplementation that could drift right along
// with a bug.
//
// Follows the exact real-Postgres test-harness pattern already used by
// tests/unit/stats.test.ts: pgReachable() via `pg_isready -q`,
// describe.skipIf(!supabaseAvailable)(...), dropdb/createdb in beforeAll,
// pg.Client over TCP with the vitest_test_pw password convention, cleanup
// in afterAll via dropdb. Uses a distinct throwaway DB name
// (vitest_dealmath_parity) so it can't collide with other suites' DBs.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import pg from 'pg';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;

// Same circular-import ordering fix as dealmath.test.ts/stats.test.ts:
// persist.js (and thus seed.js -> crm.js's newPipeline()) must resolve
// before features/crm.js is imported directly.
await import('../../src/data/persist.js');
const { dealMath }: any = await import('../../src/features/crm.js');

const TEST_DB = 'vitest_dealmath_parity';

function pgReachable() {
  try { execSync('pg_isready -q'); return true; } catch { return false; }
}
const supabaseAvailable = pgReachable();

if (!supabaseAvailable) {
  // The whole point of this file is that the SQL half actually executes
  // against the real local Postgres server (confirmed running for this
  // task) - a silent skip would defeat that, so fail loudly instead of
  // quietly matching stats.test.ts's "skip if unreachable" convention.
  throw new Error(
    'tests/unit/dealmath-parity.test.ts: local Postgres is not reachable ' +
    '(`pg_isready -q` failed), but this suite is required to actually run ' +
    'its SQL half, not skip it. Start the local Postgres server and re-run.'
  );
}

const shq = (s: any) => `'${s.replace(/'/g, `'\\''`)}'`;

// -----------------------------------------------------------------------
// The SAME input matrix exercised in tests/unit/dealmath.test.ts: zero,
// negative (where applicable), rounding/float, junk-input-already-parsed
// (num()/pct() happen on the JS side before the SQL call - the SQL half
// only re-proves the gross->referral->brokerage->net->weighted arithmetic,
// which is numeric-in/numeric-out, same as 0018_search_deals.sql's CTEs),
// the realistic full scenario, and a few random-ish combinations.
const cases = [
  {
    name: 'zero case: price 0',
    d: { price: 0, commPct: 50, referralPct: 25, brokeragePct: 20, brokerageFee: 100, closingCosts: 50, teamSplitPct: 70 },
    prob: 80,
  },
  {
    name: 'zero case: commPct 0',
    d: { price: 400000, commPct: 0, referralPct: 25, brokeragePct: 20, brokerageFee: 0, closingCosts: 0, teamSplitPct: 70 },
    prob: 80,
  },
  {
    name: 'zero case: everything 0, no stage',
    d: { price: 0, commPct: 0, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 },
    prob: 0,
  },
  {
    name: 'negative price propagates through, net floors at 0',
    d: { price: -100000, commPct: 6, referralPct: 25, brokeragePct: 20, brokerageFee: 0, closingCosts: 500, teamSplitPct: 70 },
    prob: 80,
  },
  {
    name: 'negative brokerageFee/closingCosts (credits) flow through uncapped',
    d: { price: 100000, commPct: 6, referralPct: 25, brokeragePct: 20, brokerageFee: -200, closingCosts: -500, teamSplitPct: 70 },
    prob: 80,
  },
  {
    name: 'percent fields below 0 clamp to 0 (commPct/referralPct/brokeragePct/teamSplitPct/prob)',
    d: { price: 100000, commPct: -10, referralPct: -10, brokeragePct: -10, brokerageFee: 0, closingCosts: 0, teamSplitPct: -10 },
    prob: -10,
  },
  {
    name: 'percent fields above 100 clamp to 100',
    d: { price: 100000, commPct: 150, referralPct: 150, brokeragePct: 150, brokerageFee: 0, closingCosts: 0, teamSplitPct: 150 },
    prob: 150,
  },
  {
    name: 'rounding: repeating-decimal commPct (33.33% of 100000)',
    d: { price: 100000, commPct: 33.33, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 },
    prob: 0,
  },
  {
    name: 'rounding: chain of three sequential percent deductions compounding float error',
    d: { price: 333333.33, commPct: 15, referralPct: 33.33, brokeragePct: 12.5, brokerageFee: 10, closingCosts: 123.45, teamSplitPct: 55.55 },
    prob: 45,
  },
  {
    name: 'clean whole numbers, no float artifact',
    d: { price: 500000, commPct: 6, referralPct: 20, brokeragePct: 10, brokerageFee: 0, closingCosts: 0, teamSplitPct: 50 },
    prob: 100,
  },
  {
    name: 'realistic full scenario (JSDoc chain)',
    d: { price: 400000, commPct: 6, referralPct: 25, brokeragePct: 20, brokerageFee: 0, closingCosts: 500, teamSplitPct: 70 },
    prob: 80,
  },
  {
    name: 'random-ish combination #1',
    d: { price: 725000, commPct: 2.5, referralPct: 10, brokeragePct: 15, brokerageFee: 350.75, closingCosts: 899.99, teamSplitPct: 62 },
    prob: 65,
  },
  {
    name: 'random-ish combination #2',
    d: { price: 189950, commPct: 4.75, referralPct: 0, brokeragePct: 30, brokerageFee: 0, closingCosts: 1250, teamSplitPct: 40 },
    prob: 25,
  },
  {
    name: 'random-ish combination #3: brokerage/closing costs exceed afterRef, net clamps to 0',
    d: { price: 50000, commPct: 3, referralPct: 0, brokeragePct: 90, brokerageFee: 2000, closingCosts: 5000, teamSplitPct: 50 },
    prob: 90,
  },
];

describe('0018_search_deals.sql dealMath chain — parity with features/crm.js dealMath()', () => {
  let client: any;

  beforeAll(async () => {
    execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`);
    execSync(`sudo -u postgres createdb ${TEST_DB}`);

    // Copied VERBATIM from supabase/migrations/0018_search_deals.sql's
    // `math`/`math2`/`math3`/`computed`/`weighed` CTEs (the block
    // commented "dealMath(): gross -> minus referral -> minus brokerage
    // split/fee -> minus closing costs = net; weighted = net * stage
    // probability."), just parameterised instead of reading from `deals`/
    // `stages` columns, so a drift between the migration and this test
    // would have to be introduced by hand-editing this copy, not silently
    // inherited.
    const fnSql = `
      create or replace function dealmath_check(
        price          numeric,
        comm_pct       numeric,
        referral_pct   numeric,
        brokerage_pct  numeric,
        brokerage_fee  numeric,
        closing_costs  numeric,
        team_split_pct numeric,
        stage_prob     numeric
      )
      returns table (
        gross      numeric,
        referral   numeric,
        brokerage  numeric,
        net        numeric,
        team_share numeric,
        agent_share numeric,
        weighted   numeric
      )
      language sql
      as $$
        with base as (
          select
            price * least(100, greatest(0, comm_pct)) / 100 as gross_amt
        ),
        math as (
          select
            b.*,
            b.gross_amt * least(100, greatest(0, referral_pct)) / 100 as referral_amt
          from base b
        ),
        math2 as (
          select
            m.*,
            (m.gross_amt - m.referral_amt) as after_ref,
            (m.gross_amt - m.referral_amt) * least(100, greatest(0, brokerage_pct)) / 100 + brokerage_fee as brokerage_amt
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
            greatest(0, m3.after_brok - closing_costs) as net_amt
          from math3 m3
        )
        select
          c.gross_amt as gross,
          c.referral_amt as referral,
          c.brokerage_amt as brokerage,
          c.net_amt as net,
          c.net_amt * least(100, greatest(0, team_split_pct)) / 100 as team_share,
          c.net_amt - (c.net_amt * least(100, greatest(0, team_split_pct)) / 100) as agent_share,
          c.net_amt * least(100, greatest(0, stage_prob)) / 100 as weighted
        from computed c;
      $$;
    `;
    execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(fnSql)}`);

    // pg.Client connects over TCP, which requires scram-sha-256 auth on
    // this box's pg_hba.conf - give postgres a known password (idempotent,
    // test-only, throwaway DB), same convention as stats.test.ts.
    execSync(`sudo -u postgres psql -v ON_ERROR_STOP=1 -c ${shq(`alter user postgres password 'vitest_test_pw';`)}`);
    client = new pg.Client({ host: '127.0.0.1', user: 'postgres', password: 'vitest_test_pw', database: TEST_DB });
    await client.connect();
  }, 60000);

  afterAll(async () => {
    if (client) await client.end();
    try { execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`); } catch { /* best effort */ }
  });

  for (const { name, d, prob } of cases) {
    it(`matches JS dealMath() — ${name}`, async () => {
      const expected = dealMath(d, { prob });

      const { rows } = await client.query(
        `select * from dealmath_check($1,$2,$3,$4,$5,$6,$7,$8)`,
        [d.price, d.commPct, d.referralPct, d.brokeragePct, d.brokerageFee, d.closingCosts, d.teamSplitPct, prob]
      );
      const row = rows[0];

      expect(Number(row.gross)).toBeCloseTo(expected.gross, 2);
      expect(Number(row.referral)).toBeCloseTo(expected.referral, 2);
      expect(Number(row.brokerage)).toBeCloseTo(expected.brokerage, 2);
      expect(Number(row.net)).toBeCloseTo(expected.net, 2);
      expect(Number(row.team_share)).toBeCloseTo(expected.teamShare, 2);
      expect(Number(row.agent_share)).toBeCloseTo(expected.agentShare, 2);
      expect(Number(row.weighted)).toBeCloseTo(expected.weighted, 2);
    });
  }
});
