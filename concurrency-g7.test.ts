// GATE G7 — concurrency certification (report-only).
//
// Three scenarios, each probed against a real throwaway Postgres 16 database
// with every migration in supabase/migrations/ applied (same setup technique
// as tests/security/rls.test.ts, reused wholesale):
//
//   1. Two users editing the same lead at once (leadForm save path).
//   2. Two users logging a call on the same lead at once (log_activity()).
//   3. Two users "claiming" the same lead from the queue (there is no claim
//      write — the nearest real write, reassign-to-self, is tested instead).
//
// True concurrency is exercised with MULTIPLE pg connections (one connection
// = one session = one transaction at a time). Tests assert only the
// invariants that deterministically hold; where the outcome is a genuine
// race, the trial loop records the distribution and asserts the envelope
// (e.g. pending follow-ups ∈ {1,2}) plus zero errors/deadlocks, and the
// afterAll console output reports the observed frequencies for the
// certification report.
//
// This file does NOT implement any conflict rule — it only characterizes the
// current behavior so the user can choose one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const TEST_DB = 'vitest_cert_concurrency';
const shq = (s: any) => `'${s.replace(/'/g, `'\\''`)}'`;

function pgReachable() {
  try { execSync('pg_isready -q'); return true; } catch { return false; }
}
const available = pgReachable();

// auth_user_ids (same scheme as tests/security/rls.test.ts).
const AUTH = {
  owner:   '30000000-0000-0000-0000-000000000001', // member 1, super_admin
  manager: '30000000-0000-0000-0000-000000000002', // member 2, viewAllLeads+editLeads+reassign
  agent:   '30000000-0000-0000-0000-000000000004', // member 4, own-leads agent
};
const MID = { owner: 1, manager: 2, agent: 4 };

// Same permission matrix as tests/security/rls.test.ts (= src/core/permissions.js).
const PERMS = [
  'viewOwnLeads','viewTeamLeads','viewAllLeads','createLeads','editLeads','deleteLeads','assignLeads','reassign','export','import','manageLists','editDnc',
  'makeCalls','sendTexts','addNotes','createFollowUps','editOutcomes','viewAttempts','browserDialer','viewPhones','markSent','managerNotes',
  'viewOwnPipeline','viewTeamPipeline','viewAllPipelines','moveStages','manageCrm','viewPrices','viewCommissions','editDealFinancials','exportCrm',
  'manageCampaigns','editCampaigns','deleteCampaigns','assignCampaigns','createTemplates','creativeMessages',
  'viewTeamMembers','createTeams','editTeams','assignMembers','assignManagers','viewTeamReports',
  'viewCompetitions','participate','createCompetitions','editCompetitions','manageScoring','viewAllResults',
  'createUsers','editUsers','deactivateUsers','resetPasswords','createRoles','editPermissions','manageIntegrations','viewAudit','exportReports','manageSettings','manageOutcomes','manageFields','manageStatuses',
];
const AGENT_BASE = ['viewOwnLeads','createLeads','editLeads','makeCalls','sendTexts','addNotes','createFollowUps','editOutcomes','viewAttempts','browserDialer','viewPhones','markSent','viewOwnPipeline','moveStages','viewPrices','viewTeamMembers','viewCompetitions','participate','export'];
const MANAGER_BASE = [...AGENT_BASE,'viewTeamLeads','assignLeads','reassign','import','manageLists','editDnc','managerNotes','viewTeamPipeline','viewCommissions','editDealFinancials','exportCrm','manageCampaigns','editCampaigns','assignCampaigns','createTemplates','creativeMessages','viewTeamReports','assignMembers','createCompetitions','editCompetitions','manageScoring','viewAllResults','exportReports'];
const ADMIN_BASE = [...MANAGER_BASE,'viewAllLeads','deleteLeads','viewAllPipelines','manageCrm','deleteCampaigns','createTeams','editTeams','assignManagers','createUsers','editUsers','deactivateUsers','resetPasswords','viewAudit','manageOutcomes','manageFields','manageStatuses','manageSettings'];
const ROLE_PERMS = { owner: PERMS, manager: ADMIN_BASE, agent: AGENT_BASE };

// The exact column set leadForm's edit branch sends on EVERY save
// (src/features/leads.js:195) — always all seven built-in columns, never a
// diff. Phone goes separately through updatePrimaryPhone().
const LEAD_FORM_COLS = ['first', 'last', 'email', 'addr', 'city', 'state', 'zip'];

const sleep = (ms: any) => new Promise(r => setTimeout(r, ms));

// Observed race-frequency tallies, printed in afterAll for the report.
const observed: any = {};

describe.skipIf(!available)('GATE G7 — concurrency (two real connections, report-only)', () => {
  /** @type {pg.Client} superuser admin connection (seeding, resets, reads) */
  let admin: any;
  /** Two extra superuser connections for log_activity() races — in production
   * log_activity is called by the edge function's service-role client (RLS-
   * exempt, SECURITY DEFINER, perms re-derived from p_caller_id), so calling
   * it as postgres on two connections is the faithful simulation. */
  let svcA: any, svcB: any;
  /** Two end-user connections (set role authenticated + jwt sub), as
   * PostgREST would hold for two different signed-in browsers. */
  let userManager: any, userOwner: any;

  async function connect(db = TEST_DB) {
    const c = new pg.Client({ host: '127.0.0.1', user: 'postgres', password: 'vitest_test_pw', database: db });
    await c.connect();
    return c;
  }
  async function connectAs(authUid: any) {
    const c = await connect();
    await c.query(`set role authenticated`);
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUid]);
    return c;
  }

  beforeAll(async () => {
    execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`);
    execSync(`sudo -u postgres createdb ${TEST_DB}`);
    execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(`create schema if not exists auth; create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid; $$;`)}`);
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = execSync(`ls ${migrationsDir}`).toString().trim().split('\n').filter(f => f.endsWith('.sql')).sort();
    for (const f of files) execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -f ${path.join(migrationsDir, f)}`);
    // Supabase-platform-equivalent grants (same rationale/comment as
    // tests/security/rls.test.ts: the migrations issue no GRANTs of their own).
    execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(`do $$ begin if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists (select from pg_roles where rolname='anon') then create role anon; end if; end $$; grant usage on schema public to authenticated, anon; grant select, insert, update, delete on all tables in schema public to authenticated; grant select on all tables in schema public to anon; grant usage, select on all sequences in schema public to authenticated;`)}`);
    execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(`alter role authenticated in database ${TEST_DB} set search_path = public; grant connect on database ${TEST_DB} to authenticated, anon;`)}`);
    execSync(`sudo -u postgres psql -v ON_ERROR_STOP=1 -c ${shq(`alter user postgres password 'vitest_test_pw';`)}`);

    admin = await connect();

    // ------------------------------------------------------------- seed
    await admin.query(`insert into orgs (id, name) values (1,'Org A')`);
    await admin.query(`select setval(pg_get_serial_sequence('orgs','id'), 1, true)`);
    await admin.query(`insert into roles (org_id, id, name, built_in, super_admin) values
      (1,'owner','Owner',true,true), (1,'manager','Administrator',true,false), (1,'agent','Inside Sales Agent',true,false)`);
    const rpRows = [];
    for (const [roleId, perms] of Object.entries(ROLE_PERMS))
      for (const p of PERMS) rpRows.push(`(1,'${roleId}','${p}',${perms.includes(p)})`);
    await admin.query(`insert into role_permissions (org_id, role_id, permission_key, allowed) values ${rpRows.join(',')}`);
    await admin.query(`insert into members (id, org_id, first, last, email, role_id, active, auth_user_id) values
      (1,1,'Owner','One','owner@a.test','owner',true,$1),
      (2,1,'Manager','One','manager@a.test','manager',true,$2),
      (4,1,'Agent','One','agent1@a.test','agent',true,$3)`, [AUTH.owner, AUTH.manager, AUTH.agent]);
    await admin.query(`select setval(pg_get_serial_sequence('members','id'), 4, true)`);
    // The locked statuses log_activity()'s transitions write.
    await admin.query(`insert into statuses (org_id, key, label, active, locked, "order") values
      (1,'new','New',true,true,0), (1,'attempted','Attempted',true,true,1), (1,'contacted','Contacted',true,true,2),
      (1,'appointment','Appointment',true,true,3), (1,'do_not_call','Do Not Call',true,true,4)`);
    // Outcome 1 is NEUTRAL (no conv/appt/dnc side effect) — the outcome that
    // skips log_activity()'s `update leads` entirely when status != 'new'.
    await admin.query(`insert into outcomes (id, org_id, name, conv, appt, dnc, disabled) values
      (1,1,'No answer',false,false,false,false), (2,1,'Interested',true,false,false,false)`);
    await admin.query(`select setval(pg_get_serial_sequence('outcomes','id'), 2, true)`);
    await admin.query(`insert into leads (id, org_id, first, last, email, addr, city, state, zip, assigned_id, status_key)
      values (1,1,'Lead','One','old@example.com','1 Old St','OldCity','GA','30301',4,'new')`);
    await admin.query(`select setval(pg_get_serial_sequence('leads','id'), 1, true)`);

    svcA = await connect();
    svcB = await connect();
    userManager = await connectAs(AUTH.manager); // member 2: editLeads + viewAllLeads + reassign
    userOwner = await connectAs(AUTH.owner);     // member 1: super_admin
  }, 120000);

  afterAll(async () => {
    // Observed race frequencies — the numbers the certification report cites.
    // eslint-disable-next-line no-console
    console.log('\n[G7 concurrency] observed outcomes:', JSON.stringify(observed, null, 2));
    for (const c of [userManager, userOwner, svcA, svcB, admin]) { try { if (c) await c.end(); } catch { /* */ } }
    try { execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`); } catch { /* best effort */ }
  });

  const leadRow = async () => (await admin.query(`select * from leads where id = 1`)).rows[0];
  async function resetLead(statusKey = 'new') {
    await admin.query(`delete from follow_ups where lead_id = 1`);
    await admin.query(`delete from activities where lead_id = 1`);
    await admin.query(`delete from audit_log where table_name = 'activities'`);
    await admin.query(`update leads set first='Lead', last='One', email='old@example.com', addr='1 Old St',
      city='OldCity', state='GA', zip='30301', assigned_id=4, status_key=$1, dnc=false, dnt=false, dncontact=false where id=1`, [statusKey]);
  }

  // The full-form patch leadForm actually sends: ALL seven columns every time.
  const fullPatch = (conn: any, over: any) => {
    const form = { first: 'Lead', last: 'One', email: 'old@example.com', addr: '1 Old St', city: 'OldCity', state: 'GA', zip: '30301', ...over };
    const sets = LEAD_FORM_COLS.map((c, i) => `${c === 'first' || c === 'last' ? `"${c}"` : c} = $${i + 1}`).join(', ');
    return conn.query(`update leads set ${sets} where id = 1`, LEAD_FORM_COLS.map(c => form[c]));
  };

  // ================================================================
  // SCENARIO 1 — two users editing the same lead at once
  // ================================================================
  describe('scenario 1: two users saving the same lead edit form', () => {
    it('demo rule: the demo has NO conflict handling on lead save (in-memory Object.assign, single browser)', () => {
      const demo = readFileSync(path.join(REPO_ROOT, 'docs', 'original-demo.html.ref'), 'utf8');
      // The demo's entire "save" is a client-side merge into the in-memory db:
      expect(demo).toContain('Object.assign(l, {first, last, ...rest});');
      // and the demo contains no optimistic-lock / CAS / conflict vocabulary at all:
      expect(demo).not.toMatch(/compare[- ]and[- ]swap|optimistic|someone else edited|edit conflict|version\s*mismatch/i);
    });

    it('rebuild mechanics: leadForm sends ALL 7 built-in columns every save, and leads.update() has no updated_at/version guard', () => {
      const leadsJs = readFileSync(path.join(REPO_ROOT, 'src', 'features', 'leads.ts'), 'utf8');
      const repoJs = readFileSync(path.join(REPO_ROOT, 'src', 'data', 'repo-supabase.ts'), 'utf8');
      // src/features/leads.js:195 — the patch is the whole form, not a diff:
      expect(leadsJs).toContain('const patch = {first, last, email:rest.email, addr:rest.addr, city:rest.city, state:rest.state, zip:rest.zip};');
      // src/data/repo-supabase.js:663 — plain PATCH by id, no .eq('updated_at', ...) CAS:
      expect(repoJs).toMatch(/supabase!?\.from\('leads'\)\.update\(patch\)\.eq\('id', id\)/); // `!?` tolerates the TS non-null assertion
      expect(repoJs).not.toMatch(/from\('leads'\)\.update\([^)]*\)\s*\.eq\('id',\s*id\)\s*\.eq\('updated_at'/);
      // The schema HAS leads.updated_at (0009_leads.sql) — it is simply never used as a guard.
    });

    it('interleaved transactions: B blocks on A\'s row lock, then proceeds and overwrites — last committed write wins, no error, no lost-update detection', async () => {
      await resetLead();
      await userManager.query('begin');
      const a = await fullPatch(userManager, { first: 'Alice-Edit', email: 'alice@example.com' });
      expect(a.rowCount).toBe(1);

      // B's identical-shape UPDATE on the same row must block on A's lock.
      let bDone = false;
      const bPromise = fullPatch(userOwner, { first: 'Bob-Edit', email: 'bob@example.com' }).then((r: any) => { bDone = true; return r; });
      await sleep(300);
      expect(bDone).toBe(false); // genuinely blocked on the row lock — no error, no "conflict" signal

      await userManager.query('commit');
      const b = await bPromise;       // proceeds the moment A commits
      expect(b.rowCount).toBe(1);     // succeeds silently (READ COMMITTED EvalPlanQual re-check passes)

      const row = await leadRow();
      // Last committed write (B) wins on EVERY column it sent — A's committed
      // values survive zero milliseconds. Nothing reports the overwrite.
      expect(row.first).toBe('Bob-Edit');
      expect(row.email).toBe('bob@example.com');
    });

    it('THE lost update: A edits only email, B edits only city — but because each save sends all 7 columns from its own stale form snapshot, B silently reverts A\'s email', async () => {
      await resetLead();
      // Both users open the edit dialog at the same time: both forms snapshot
      // email='old@example.com', city='OldCity'.
      // A changes ONLY the email field and saves (full 7-column patch):
      const a = await fullPatch(userManager, { email: 'new@example.com' });
      expect(a.rowCount).toBe(1);
      expect((await leadRow()).email).toBe('new@example.com'); // A's save landed

      // B changes ONLY the city field and saves — but B's form still holds the
      // old email, and leadForm sends every column:
      const b = await fullPatch(userOwner, { city: 'NewCity' });
      expect(b.rowCount).toBe(1);

      const row = await leadRow();
      expect(row.city).toBe('NewCity');            // B's edit landed...
      expect(row.email).toBe('old@example.com');   // ...and silently DESTROYED A's email edit
      // No error, no warning, no audit of the reversion. A's "Saved" toast lied in hindsight.
    });

    it('autocommit near-simultaneous saves, 20 trials: final row is always exactly ONE writer\'s full column set (statement-level last-write-wins, never torn), zero errors', async () => {
      const A = { first: 'Alice-Edit', last: 'One', email: 'alice@example.com', addr: '9 A St', city: 'ACity', state: 'GA', zip: '11111' };
      const B = { first: 'Bob-Edit', last: 'One', email: 'bob@example.com', addr: '9 B St', city: 'BCity', state: 'FL', zip: '22222' };
      let aWins = 0, bWins = 0, errors = 0;
      for (let t = 0; t < 20; t++) {
        await resetLead();
        const results = await Promise.allSettled([fullPatch(userManager, A), fullPatch(userOwner, B)]);
        errors += results.filter(r => r.status === 'rejected').length;
        const row = await leadRow();
        const matches = (p: any) => LEAD_FORM_COLS.every(c => row[c] === p[c]);
        expect(matches(A) || matches(B)).toBe(true); // exactly one full set, never a column mix
        if (matches(A)) aWins++; else bWins++;
      }
      expect(errors).toBe(0);
      expect(aWins + bWins).toBe(20);
      observed.scenario1_autocommit_20_trials = { aWins, bWins, errors };
    });
  });

  // ================================================================
  // SCENARIO 2 — two users logging a call on the same lead at once
  // ================================================================
  describe('scenario 2: two concurrent log_activity() calls on the same lead', () => {
    const logCall = (conn: any, callerId: any, { outcome = 1, fu = null }: any = {}) =>
      conn.query(`select log_activity($1, 1, 1, 'call', $2, 'note', $3, '', null, null, null, null)`, [callerId, outcome, fu]);

    async function pendingCount() {
      return Number((await admin.query(`select count(*) n from follow_ups where lead_id = 1 and status = 'pending'`)).rows[0].n);
    }
    async function trialLoop(trials: any, statusKey: any, { fu = true } = {}) {
      const tally = { onePending: 0, twoPending: 0, other: 0, errors: 0, activitiesAlways2: true };
      for (let t = 0; t < trials; t++) {
        await resetLead(statusKey);
        const results = await Promise.allSettled([
          logCall(svcA, MID.owner, { fu: fu ? '2026-10-10' : null }),
          logCall(svcB, MID.manager, { fu: fu ? '2026-10-12' : null }),
        ]);
        for (const r of results) if (r.status === 'rejected') { tally.errors++; }
        const acts = Number((await admin.query(`select count(*) n from activities where lead_id = 1`)).rows[0].n);
        if (acts !== 2) tally.activitiesAlways2 = false;
        const p = await pendingCount();
        if (!fu) { expect(p).toBe(0); continue; }
        if (p === 1) tally.onePending++; else if (p === 2) tally.twoPending++; else tally.other++;
        // Status sanity (neutral outcome): 'new' lead must end 'attempted';
        // an already-'attempted' lead must stay 'attempted'.
        expect((await leadRow()).status_key).toBe('attempted');
      }
      return tally;
    }

    it('both WITH follow-up dates, lead already worked (status=attempted, neutral outcome — no leads-row write): 50 trials, race distribution recorded', async () => {
      // This is the exposed path: log_activity() takes NO lock on the leads
      // row (neutral outcome + status != 'new' skips every `update leads`),
      // so under READ COMMITTED both transactions run
      //   UPDATE follow_ups ... WHERE status='pending'   -- sees 0 rows (the
      //     other txn's INSERT is uncommitted and invisible)
      //   INSERT follow_ups (..., 'pending')
      // fully in parallel → BOTH inserts survive → 2 pending follow-ups,
      // violating the app's implicit ≤1-pending-per-lead invariant ("a new
      // follow-up replaces the pending one", 0017_log_activity.sql:147).
      const tally = await trialLoop(50, 'attempted');
      observed.scenario2_fu_status_attempted_50_trials = tally;
      expect(tally.errors).toBe(0);               // never an error or deadlock
      expect(tally.activitiesAlways2).toBe(true); // no activity row is ever lost
      expect(tally.other).toBe(0);                // always exactly 1 or 2 pending
      expect(tally.onePending + tally.twoPending).toBe(50);
      // The race is real: it must have reproduced at least once in 50 tries.
      expect(tally.twoPending).toBeGreaterThan(0);
    }, 120000);

    it('both WITH follow-up dates, fresh lead (status=new): the status write on the leads row serializes the two calls — 50 trials recorded', async () => {
      // Here both calls hit `update leads set status_key='attempted'` on the
      // same row: the second blocks until the first commits, and its later
      // UPDATE follow_ups statement then runs with a fresh READ COMMITTED
      // snapshot that SEES the first call's committed pending follow-up and
      // cancels it. The ≤1-pending invariant holds here only as an accident
      // of the status transition taking a row lock first.
      const tally = await trialLoop(50, 'new');
      observed.scenario2_fu_status_new_50_trials = tally;
      expect(tally.errors).toBe(0);
      expect(tally.activitiesAlways2).toBe(true);
      expect(tally.other).toBe(0);
      expect(tally.onePending + tally.twoPending).toBe(50);
    }, 120000);

    it('both WITHOUT follow-up dates: trivially fine — both activities land, no follow-ups, no errors (10 trials)', async () => {
      const tally = await trialLoop(10, 'attempted', { fu: false });
      observed.scenario2_no_fu_10_trials = tally;
      expect(tally.errors).toBe(0);
      expect(tally.activitiesAlways2).toBe(true);
    }, 120000);

    it('when 2 pending follow-ups exist, nextFu() (min due) hides one but list views and exports show both', async () => {
      // Force the double-pending state the race produces and document what the
      // app layer does with it: src/features/activity.js:27 nextFu() sorts
      // pending by due and takes [0] — so badges/queue "due" mode show the
      // earliest — but views/followups.js & exportCsv('follow_ups') list every
      // pending row, so the user sees duplicate follow-ups for one lead.
      await resetLead('attempted');
      await admin.query(`insert into follow_ups (org_id, lead_id, due, status, note, assignee_id) values
        (1,1,'2026-10-10','pending','from A',4), (1,1,'2026-10-12','pending','from B',4)`);
      const rows = (await admin.query(`select due from follow_ups where lead_id=1 and status='pending' order by due`)).rows;
      expect(rows.length).toBe(2); // both are live "pending" rows — nothing in the schema forbids it (no partial unique index)
      // And the next log_activity() WITH a fu date cancels BOTH (its cancel is
      // `where lead_id=.. and status='pending'`, not "the one"), self-healing
      // the count back to 1:
      await logCall(svcA, MID.owner, { fu: '2026-10-20' });
      expect(await pendingCount()).toBe(1);
    });
  });

  // ================================================================
  // SCENARIO 3 — two users claiming the same lead from the queue
  // ================================================================
  describe('scenario 3: two users "claiming" the same lead from the queue', () => {
    it('there is NO claim write: the queue is a pure client-side read (demo parity), so two users can work the same lead in parallel by design', () => {
      const queueJs = readFileSync(path.join(REPO_ROOT, 'src', 'core', 'queue.ts'), 'utf8');
      const demo = readFileSync(path.join(REPO_ROOT, 'docs', 'original-demo.html.ref'), 'utf8');
      // The rebuild's queue() is a filter over fetched leads; queueGo() only
      // moves state.id / location.hash. Neither writes assigned_id or any
      // other column — no UPDATE/INSERT appears anywhere in core/queue.js:
      expect(queueJs).not.toMatch(/\.update\(|\.insert\(|assigned_id\s*[:=]/);
      // Demo parity: the demo's queue() (original-demo.html.ref:865) is the
      // same pure filter — starting on a queue lead never sets l.assigned:
      expect(demo).toMatch(/function queue\(\)\{ let q = visibleLeads\(\)\.filter/);
    });

    it('nearest real write — interleaved reassign-to-self: B blocks on the row lock, last commit wins, loser gets rowCount 1 and NO signal they lost', async () => {
      await resetLead('attempted');
      await admin.query(`insert into follow_ups (org_id, lead_id, due, status, note, assignee_id) values (1,1,'2026-10-15','pending','call back',4)`);

      // bulkReassign() = two statements in order (repo-supabase.js:688-693):
      // UPDATE leads SET assigned_id=.., then UPDATE follow_ups SET assignee_id=..
      await userManager.query('begin');
      const a1 = await userManager.query(`update leads set assigned_id = ${MID.manager} where id = 1`);
      expect(a1.rowCount).toBe(1);
      await userManager.query(`update follow_ups set assignee_id = ${MID.manager} where lead_id = 1 and status = 'pending'`);

      let bDone = false;
      const bPromise = (async () => {
        const r1 = await userOwner.query(`update leads set assigned_id = ${MID.owner} where id = 1`); // blocks
        const r2 = await userOwner.query(`update follow_ups set assignee_id = ${MID.owner} where lead_id = 1 and status = 'pending'`);
        bDone = true;
        return [r1, r2];
      })();
      await sleep(300);
      expect(bDone).toBe(false); // blocked, not failed

      await userManager.query('commit');
      const [r1, r2] = await bPromise;
      expect(r1.rowCount).toBe(1); // B's claim "succeeds" too — both users were told it worked
      expect(r2.rowCount).toBe(1);

      const row = await leadRow();
      expect(Number(row.assigned_id)).toBe(MID.owner); // last commit wins — manager's claim silently gone
      const fu = (await admin.query(`select assignee_id from follow_ups where lead_id=1 and status='pending'`)).rows[0];
      expect(Number(fu.assignee_id)).toBe(MID.owner);
    });

    it('autocommit simultaneous reassign-to-self, 50 trials: both succeed every time, final assignee is one of the two; lead/follow-up assignee can TEAR (two separate statements, no transaction) — distribution recorded', async () => {
      // The app's bulkReassign() runs its two UPDATEs as two separate
      // PostgREST requests (autocommit each) — so A-leads, B-leads, B-fus,
      // A-fus is a legal interleaving that leaves the LEAD assigned to B but
      // its pending FOLLOW-UP assigned to A.
      const reassignTo = async (conn: any, mid: any) => {
        await conn.query(`update leads set assigned_id = ${mid} where id = 1`);
        await conn.query(`update follow_ups set assignee_id = ${mid} where lead_id = 1 and status = 'pending'`);
      };
      let managerWins = 0, ownerWins = 0, torn = 0, errors = 0;
      for (let t = 0; t < 50; t++) {
        await resetLead('attempted');
        await admin.query(`insert into follow_ups (org_id, lead_id, due, status, note, assignee_id) values (1,1,'2026-10-15','pending','call back',4)`);
        const results = await Promise.allSettled([reassignTo(userManager, MID.manager), reassignTo(userOwner, MID.owner)]);
        errors += results.filter(r => r.status === 'rejected').length;
        const lead = Number((await leadRow()).assigned_id);
        const fu = Number((await admin.query(`select assignee_id from follow_ups where lead_id=1 and status='pending'`)).rows[0].assignee_id);
        expect([MID.manager, MID.owner]).toContain(lead); // always a clean last-write winner on the lead itself
        if (lead === MID.manager) managerWins++; else ownerWins++;
        if (fu !== lead) torn++;
      }
      expect(errors).toBe(0); // no deadlocks (both writers touch leads then follow_ups, same order)
      observed.scenario3_reassign_50_trials = { managerWins, ownerWins, tornLeadVsFollowUp: torn, errors };
    }, 120000);

    it('after losing the claim, BOTH users\' activity logs still attach to the lead (assignment does not gate logging for callers who can see it)', async () => {
      await resetLead('attempted');
      // Owner "won" the lead:
      await admin.query(`update leads set assigned_id = ${MID.owner} where id = 1`);
      // Both the winner and the loser log a call — log_activity() gates on
      // editOutcomes + can_see_member_for(caller, lead.assigned_id); the
      // manager (viewAllLeads) and owner (super_admin) both pass regardless
      // of who the lead is assigned to.
      const r = await Promise.allSettled([
        svcA.query(`select log_activity($1, 1, 1, 'call', 1, 'winner call', null, '', null, null, null, null)`, [MID.owner]),
        svcB.query(`select log_activity($1, 1, 1, 'call', 1, 'loser call', null, '', null, null, null, null)`, [MID.manager]),
      ]);
      expect(r.every(x => x.status === 'fulfilled')).toBe(true);
      const acts = (await admin.query(`select user_id from activities where lead_id = 1 order by id`)).rows.map((x: any) => Number(x.user_id));
      expect(acts.sort()).toEqual([MID.owner, MID.manager].sort());
    });

    it('no user-visible "you lost the claim" signal exists: reassign() only patches the ACTING user\'s local cache; nothing refetches for the other user (no realtime subscriptions anywhere)', () => {
      const leadsJs = readFileSync(path.join(REPO_ROOT, 'src', 'features', 'leads.ts'), 'utf8');
      const repoJs = readFileSync(path.join(REPO_ROOT, 'src', 'data', 'repo-supabase.ts'), 'utf8');
      const queueJs = readFileSync(path.join(REPO_ROOT, 'src', 'core', 'queue.ts'), 'utf8');
      // reassign()'s supabase branch (src/features/leads.js:132) updates only
      // the local db.leads mirror of the user who clicked:
      expect(leadsJs).toContain(`repoLeads.bulkReassign(ids, to).then(()=>{ ids.forEach(id=>{ const l=db.leads.find(x=>x.id===id); if(l) l.assigned=to; });`);
      // No realtime/subscription machinery exists in the repo layer, and the
      // queue cache is only invalidated when its own params change:
      expect(repoJs).not.toMatch(/\.channel\(|subscribe|realtime/i);
      expect(queueJs).toContain('if(queueCache.key === key) return;');
    });
  });
});
