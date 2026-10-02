// GATE G3 — hostile security review, database layer.
//
// This suite proves (or disproves) row-level security at the only layer
// that actually matters against a direct PostgREST/REST call: the
// database itself. It does NOT trust src/ or supabase/functions/ — every
// test signs in as a specific role (via `set role authenticated` +
// `request.jwt.claim.sub`, the exact technique tests/unit/stats.test.ts
// and tests/unit/activity.test.ts already established for GATE G2) against
// a real, throwaway local Postgres 16 database with every migration in
// supabase/migrations/ applied, then attempts a FORBIDDEN action. Every
// forbidden action in this file MUST fail (either the query errors, or it
// succeeds but affects/returns zero rows — RLS policies fail "closed" by
// filtering rows, not always by raising an error, so both are checked).
//
// Two orgs (org 1 "Org A", org 2 "Org B") and two teams within org 1 are
// seeded so cross-org and cross-team isolation can both be exercised. Six
// built-in roles plus one custom, non-built-in role ("field_temp") are
// seeded in BOTH orgs, matching defaultRoles()/PERMISSIONS in
// src/core/permissions.js exactly, so the permission matrix these tests
// check against is the real one the app ships, not a hand-picked subset.
//
// Skipped automatically (like the existing supabase-parity suites) when no
// local Postgres is reachable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const TEST_DB = 'vitest_security_rls';
const shq = (s: any) => `'${s.replace(/'/g, `'\\''`)}'`;

function pgReachable() {
  try { execSync('pg_isready -q'); return true; } catch { return false; }
}
const supabaseAvailable = pgReachable();

// Fixed, memorable auth_user_ids per (org, role) so test bodies can read
// like a sentence: asUser(AUTH.orgA.agent, ...).
const AUTH = {
  orgA: {
    owner:      '10000000-0000-0000-0000-000000000001',
    manager:    '10000000-0000-0000-0000-000000000002',
    isaManager: '10000000-0000-0000-0000-000000000003',
    agent:      '10000000-0000-0000-0000-000000000004',
    reAgent:    '10000000-0000-0000-0000-000000000005',
    viewer:     '10000000-0000-0000-0000-000000000006',
    custom:     '10000000-0000-0000-0000-000000000007', // non-built-in "field_temp" role
    agent2:     '10000000-0000-0000-0000-000000000008', // second agent, different team, same org
    deactivated:'10000000-0000-0000-0000-000000000009',
  },
  orgB: {
    owner: '20000000-0000-0000-0000-000000000001',
    agent: '20000000-0000-0000-0000-000000000002',
  },
};

// Member ids (bigint identity columns — fixed here so lead/deal/etc. fixture
// rows can reference them deterministically without a lookup round trip).
const MID = {
  a_owner: 1, a_manager: 2, a_isaManager: 3, a_agent: 4, a_reAgent: 5,
  a_viewer: 6, a_custom: 7, a_agent2: 8, a_deactivated: 9,
  b_owner: 101, b_agent: 102,
};

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
const VIEWER_BASE = ['viewOwnLeads','viewTeamLeads','viewAttempts','viewOwnPipeline','viewTeamPipeline','viewPrices','viewTeamMembers','viewTeamReports','viewCompetitions','viewAllResults'];

const ROLE_PERMS = {
  owner: PERMS, // super_admin bypass covers the rest; row below still inserted for completeness
  manager: ADMIN_BASE,
  isa_manager: MANAGER_BASE,
  agent: AGENT_BASE,
  re_agent: [...AGENT_BASE,'viewCommissions'],
  viewer: VIEWER_BASE,
  // The one required "custom, non-built-in" role for item 1/2: a narrow
  // role that can only view+edit its own leads and log activity — nothing
  // else. Exists under BOTH orgs so the RLS tests can prove this role's
  // grants don't leak across the org boundary either.
  field_temp: ['viewOwnLeads','editLeads','makeCalls','editOutcomes','viewAttempts'],
};

describe.skipIf(!supabaseAvailable)('GATE G3 — RLS / row-level security (hostile review)', () => {
  let client: any;

  beforeAll(async () => {
    execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`);
    execSync(`sudo -u postgres createdb ${TEST_DB}`);
    execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(`create schema if not exists auth; create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid; $$;`)}`);
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = execSync(`ls ${migrationsDir}`).toString().trim().split('\n').filter(f => f.endsWith('.sql')).sort();
    for (const f of files) execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -f ${path.join(migrationsDir, f)}`);
    // Same authenticated-role simulation as the existing supabase-parity
    // suites: Supabase's own platform grants full table CRUD to
    // `authenticated` by default, and since the app's migrations never
    // issue any restricting GRANT of their own (confirmed: zero grant
    // statements anywhere in supabase/migrations/*.sql), this is the
    // faithful simulation of what a real project actually exposes, not an
    // artificially broad test fixture.
    execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(`do $$ begin if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists (select from pg_roles where rolname='anon') then create role anon; end if; end $$; grant usage on schema public to authenticated, anon; grant select, insert, update, delete on all tables in schema public to authenticated; grant select on all tables in schema public to anon; grant usage, select on all sequences in schema public to authenticated;`)}`);
    execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(`alter role authenticated set search_path = public; alter role anon set search_path = public; grant connect on database ${TEST_DB} to authenticated, anon;`)}`);
    execSync(`sudo -u postgres psql -v ON_ERROR_STOP=1 -c ${shq(`alter user postgres password 'vitest_test_pw';`)}`);
    client = new pg.Client({ host: '127.0.0.1', user: 'postgres', password: 'vitest_test_pw', database: TEST_DB });
    await client.connect();

    // ---------------------------------------------------------- two orgs
    await client.query(`insert into orgs (id, name) values (1,'Org A'), (2,'Org B')`);
    await client.query(`select setval(pg_get_serial_sequence('orgs','id'), 2, true)`);

    // ---------------------------------------------------- roles per org
    for (const org of [1, 2]) {
      await client.query(`insert into roles (org_id, id, name, built_in, super_admin) values
        ($1,'owner','Owner',true,true), ($1,'manager','Administrator',true,false),
        ($1,'isa_manager','Inside Sales Manager',true,false), ($1,'agent','Inside Sales Agent',true,false),
        ($1,'re_agent','Real Estate Agent',true,false), ($1,'viewer','Viewer',true,false),
        ($1,'field_temp','Field Temp (custom)',false,false)`, [org]);
      for (const [roleId, perms] of Object.entries(ROLE_PERMS)) {
        for (const p of PERMS) {
          await client.query(`insert into role_permissions (org_id, role_id, permission_key, allowed) values ($1,$2,$3,$4)`,
            [org, roleId, p, perms.includes(p)]);
        }
      }
    }

    // -------------------------------------------------------------- members
    // Org A: owner(1)/manager(2)/isaManager(3)/agent(4)/reAgent(5)/viewer(6)/
    // custom(7)/agent2(8, second team)/deactivated(9, role=agent but inactive).
    const orgAMembers = [
      [1,'owner','Owner','One','owner@a.test','owner',true,AUTH.orgA.owner],
      [2,'manager','Manager','One','manager@a.test','manager',true,AUTH.orgA.manager],
      [3,'isa_manager','ISA','Mgr','isamgr@a.test','isa_manager',true,AUTH.orgA.isaManager],
      [4,'agent','Agent','One','agent1@a.test','agent',true,AUTH.orgA.agent],
      [5,'re_agent','RE','Agent','reagent@a.test','re_agent',true,AUTH.orgA.reAgent],
      [6,'viewer','View','Er','viewer@a.test','viewer',true,AUTH.orgA.viewer],
      [7,'field_temp','Custom','Role','custom@a.test','field_temp',true,AUTH.orgA.custom],
      [8,'agent','Agent','Two','agent2@a.test','agent',true,AUTH.orgA.agent2],
      [9,'agent','De','Activated','deactivated@a.test','agent',false,AUTH.orgA.deactivated],
    ];
    for (const [id, roleId, first, last, email, role, active, uid] of orgAMembers) {
      await client.query(`insert into members (id, org_id, first, last, email, role_id, active, auth_user_id, deactivated_at) values ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, first, last, email, roleId, active, uid, active ? null : new Date().toISOString()]);
    }
    // Org B: owner(101)/agent(102) — a completely separate tenant.
    await client.query(`insert into members (id, org_id, first, last, email, role_id, active, auth_user_id) values
      (101,2,'Owner','B','owner@b.test','owner',true,$1), (102,2,'Agent','B','agent@b.test','agent',true,$2)`,
      [AUTH.orgB.owner, AUTH.orgB.agent]);
    await client.query(`select setval(pg_get_serial_sequence('members','id'), 102, true)`);

    // ------------------------------------------------------------- teams
    // Org A: "Team North" (agent #4) and "Team South" (agent2 #8) — not the
    // same team, so same_team() should say no between them.
    await client.query(`insert into teams (id, org_id, name, manager_id) values (1,1,'Team North',3), (2,1,'Team South',3)`);
    await client.query(`select setval(pg_get_serial_sequence('teams','id'), 2, true)`);
    await client.query(`insert into team_members (org_id, team_id, member_id) values (1,1,4), (1,2,8)`);

    // -------------------------------------------------------- statuses (FK)
    for (const org of [1, 2]) {
      await client.query(`insert into statuses (org_id, key, label, active, locked, "order") values ($1,'new','New',true,true,0) on conflict do nothing`, [org]);
    }

    // ---------------------------------------------------------------- leads
    // One lead per org, assigned within org A to agent #4 (Team North).
    await client.query(`insert into leads (id, org_id, first, last, assigned_id, status_key) values (1,1,'Lead','A',4,'new'), (2,2,'Lead','B',102,'new')`);
    await client.query(`select setval(pg_get_serial_sequence('leads','id'), 2, true)`);
    await client.query(`insert into lead_phones (org_id, lead_id, n, type, "position") values (1,1,'4045550001','mobile',0), (2,2,'4045559999','mobile',0)`);

    // ---------------------------------------------------------------- deals
    await client.query(`insert into pipelines (id, org_id, name, kind) values (1,1,'Main','sales'), (2,2,'Main','sales')`);
    await client.query(`select setval(pg_get_serial_sequence('pipelines','id'), 2, true)`);
    await client.query(`insert into stages (id, org_id, pipeline_id, name, prob, kind, "position") values (1,1,1,'New',10,'active',0), (2,2,2,'New',10,'active',0)`);
    await client.query(`select setval(pg_get_serial_sequence('stages','id'), 2, true)`);
    await client.query(`insert into deals (id, org_id, lead_id, pipeline_id, stage_id, assigned_id, price) values (1,1,1,1,1,4,300000)`);
    await client.query(`select setval(pg_get_serial_sequence('deals','id'), 1, true)`);

    // ------------------------------------------------------------ activities
    await client.query(`insert into outcomes (id, org_id, name, conv, appt, dnc, disabled) values (1,1,'No answer',false,false,false,false)`);
    await client.query(`select setval(pg_get_serial_sequence('outcomes','id'), 1, true)`);
    await client.query(`insert into activities (id, org_id, lead_id, type, outcome_id, user_id) values (1,1,1,'call',1,4)`);
    await client.query(`select setval(pg_get_serial_sequence('activities','id'), 1, true)`);

    // ----------------------------------------------------------------- audit
    await client.query(`insert into audit_log (id, org_id, user_id, action, table_name, detail) values (1,1,4,'signed in','auth','Agent One')`);
    await client.query(`select setval(pg_get_serial_sequence('audit_log','id'), 1, true)`);
  }, 120000);

  afterAll(async () => {
    if (client) await client.end();
    try { execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`); } catch { /* best effort */ }
  });

  async function asUser(authUid: any, fn: any) {
    await client.query(`set role authenticated`);
    await client.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUid]);
    try { return await fn(); } finally { await client.query(`reset role`); await client.query(`select set_config('request.jwt.claim.sub', '', false)`); }
  }
  async function asAnon(fn: any) {
    await client.query(`set role anon`);
    try { return await fn(); } finally { await client.query(`reset role`); }
  }

  // ================================================================ 1. leads
  describe('reading another team/org\'s leads', () => {
    it('org B agent cannot read org A\'s lead (cross-org — protected table)', async () => {
      const rows = await asUser(AUTH.orgB.agent, async () => (await client.query(`select * from leads where id = 1`)).rows);
      expect(rows.length).toBe(0);
    });
    it('org A agent2 (Team South) cannot read the Team North lead assigned to agent #4', async () => {
      const rows = await asUser(AUTH.orgA.agent2, async () => (await client.query(`select * from leads where id = 1`)).rows);
      expect(rows.length).toBe(0);
    });
    it('custom role (field_temp, viewOwnLeads only) cannot read a lead assigned to someone else', async () => {
      const rows = await asUser(AUTH.orgA.custom, async () => (await client.query(`select * from leads where id = 1`)).rows);
      expect(rows.length).toBe(0);
    });
    it('an unauthenticated (anon) request cannot read any lead', async () => {
      const rows = await asAnon(async () => (await client.query(`select * from leads`)).rows);
      expect(rows.length).toBe(0);
    });

    // -------------------------------------------------- KNOWN GAP (proven)
    // lead_phones/lead_lists/lead_custom_values have NO RLS of their own
    // (only the parent `leads` row is protected — see docs/certification/
    // security-audit.md, Finding "child lead tables have no RLS"). This
    // test is written to EXPECT the secure behavior (0 rows) and is
    // expected to currently FAIL, proving the gap with a real query rather
        // than just asserting it from reading the migration.
    it('[EXPECTED TO FAIL until fixed] org B agent cannot read org A lead\'s phone number via lead_phones directly', async () => {
      const rows = await asUser(AUTH.orgB.agent, async () => (await client.query(`select * from lead_phones where lead_id = 1`)).rows);
      expect(rows.length).toBe(0);
    });
  });

  // ============================================================= 2. activities
  describe('editing another team\'s activities', () => {
    it('agent2 (Team South) cannot insert an activity against Team North\'s lead', async () => {
      await expect(asUser(AUTH.orgA.agent2, () =>
        client.query(`insert into activities (org_id, lead_id, type, outcome_id, user_id) values (1,1,'call',1,8)`)
      )).rejects.toThrow();
    });
    it('agent2 cannot insert an activity impersonating agent #4 (user_id spoof)', async () => {
      await expect(asUser(AUTH.orgA.agent2, () =>
        client.query(`insert into activities (org_id, lead_id, type, outcome_id, user_id) values (1,1,'call',1,4)`)
      )).rejects.toThrow();
    });
    it('no update policy exists on activities — even the owning agent cannot edit a logged activity', async () => {
      const res = await asUser(AUTH.orgA.agent, () => client.query(`update activities set note = 'tampered' where id = 1`));
      expect(res.rowCount).toBe(0);
    });
  });

  // ======================================================= 3. role escalation
  describe('escalating own role / privilege escalation via members table', () => {
    it('[EXPECTED TO FAIL until fixed] an agent cannot promote themself to owner by updating members.role_id directly', async () => {
      let res;
      try {
        res = await asUser(AUTH.orgA.agent, () => client.query(`update members set role_id = 'owner' where id = 4`));
      } finally {
        // Reset regardless of the assertion's outcome so later tests
        // aren't polluted by this row actually having been changed.
        await client.query(`update members set role_id = 'agent' where id = 4`);
      }
      // Secure behavior: 0 rows affected (no RLS policy permits this).
      // members has NO RLS at all right now, so this currently SUCCEEDS —
      // proving the privilege-escalation path end-to-end.
      expect(res.rowCount).toBe(0);
    });
    it('[EXPECTED TO FAIL until fixed] an agent cannot hijack into org B by rewriting their own org_id', async () => {
      let res;
      try {
        res = await asUser(AUTH.orgA.agent, () => client.query(`update members set org_id = 2 where id = 4`));
      } finally {
        await client.query(`update members set org_id = 1 where id = 4`);
      }
      expect(res.rowCount).toBe(0);
    });
    it('[EXPECTED TO FAIL until fixed] a non-admin cannot grant themself an arbitrary permission via role_permissions', async () => {
      let res;
      try {
        res = await asUser(AUTH.orgA.agent, () =>
          client.query(`update role_permissions set allowed = true where org_id = 1 and role_id = 'agent' and permission_key = 'editPermissions'`));
      } finally {
        await client.query(`update role_permissions set allowed = false where org_id=1 and role_id='agent' and permission_key='editPermissions'`);
      }
      expect(res.rowCount).toBe(0);
    });
  });

  // ============================================================ 4. members
  describe('reading the users/members table of another team/org', () => {
    it('[EXPECTED TO FAIL until fixed] org B agent cannot read org A\'s member roster', async () => {
      const rows = await asUser(AUTH.orgB.agent, async () => (await client.query(`select * from members where org_id = 1`)).rows);
      expect(rows.length).toBe(0);
    });
    it('[EXPECTED TO FAIL until fixed] a plain agent (no viewTeamMembers/editUsers scoping beyond own team) cannot read every org A member including other teams\'/roles\' emails', async () => {
      const rows = await asUser(AUTH.orgA.agent, async () => (await client.query(`select * from members where org_id = 1`)).rows);
      // The demo's own intent: agents may see teammates (viewTeamMembers),
      // not a blanket "every member in the org" read with no policy at all.
      // Asserting strictly here documents the gap; see report for nuance.
      expect(rows.length).toBeLessThanOrEqual(3); // would be true team-scoped visibility
    });
  });

  // ======================================================= 5. deleting audit
  describe('deleting audit entries', () => {
    it('[EXPECTED TO FAIL until fixed] an agent without viewAudit/editUsers cannot delete an audit_log row', async () => {
      let res;
      try {
        res = await asUser(AUTH.orgA.agent, () => client.query(`delete from audit_log where id = 1`));
      } finally {
        // Re-seed unconditionally (idempotent via ON CONFLICT) so later
        // tests always find row id=1 present, regardless of whether this
        // delete succeeded (the vulnerability) or was blocked (the fix).
        await client.query(`insert into audit_log (id, org_id, user_id, action, table_name, detail) values (1,1,4,'signed in','auth','Agent One') on conflict (id) do nothing`);
      }
      expect(res.rowCount).toBe(0);
    });
    it('[EXPECTED TO FAIL until fixed] org B agent cannot delete org A\'s audit_log row', async () => {
      let res;
      try {
        res = await asUser(AUTH.orgB.agent, () => client.query(`delete from audit_log where id = 1`));
      } finally {
        await client.query(`insert into audit_log (id, org_id, user_id, action, table_name, detail) values (1,1,4,'signed in','auth','Agent One') on conflict (id) do nothing`);
      }
      expect(res.rowCount).toBe(0);
    });
  });

  // ================================================== 6. deactivated member
  describe('reading a deactivated user\'s data', () => {
    it('a deactivated member\'s own auth session can still read the leads table query surface (RLS has no active-flag check)', async () => {
      // This documents that leads_select's can_see_member() path does not
      // check members.active at all — current_member_id() resolves by
      // auth_user_id regardless of active state, and the app's own
      // sign-in flow (signInWithPassword) is what refuses an inactive
      // member, not the database. A still-valid Supabase Auth session for
      // a deactivated member is therefore still a live, working RLS
      // identity at the database layer.
      const rows = await asUser(AUTH.orgA.deactivated, async () => (await client.query(`select current_member_id()`)).rows);
      expect(Number(rows[0].current_member_id)).toBe(9);
    });
  });

  // ======================================================= deals / follow_ups
  describe('deals and follow_ups cross-team/role boundaries', () => {
    it('org B agent cannot read org A\'s deal', async () => {
      const rows = await asUser(AUTH.orgB.agent, async () => (await client.query(`select * from deals where id = 1`)).rows);
      expect(rows.length).toBe(0);
    });
    it('agent2 (Team South, not assigned) cannot move Team North\'s deal to a different stage', async () => {
      const res = await asUser(AUTH.orgA.agent2, () => client.query(`update deals set stage_id = 1 where id = 1`));
      expect(res.rowCount).toBe(0);
    });
    it('[informational, documented/deferred gap — not a hard failure] the assigned agent CAN edit deal price/commission without editDealFinancials, because RLS is row-level not column-level (see 0015_rls.sql deals_update comment)', async () => {
      const res = await asUser(AUTH.orgA.agent, () => client.query(`update deals set price = 999999 where id = 1`));
      expect(res.rowCount).toBe(1); // documents the accepted, comment-acknowledged gap
      await client.query(`update deals set price = 300000 where id = 1`); // restore fixture
    });
  });

  // ============================================================= custom role
  describe('custom (non-built-in) role — field_temp — is enforced by RLS the same as a built-in role', () => {
    it('field_temp (viewOwnLeads, no viewAllLeads/viewTeamLeads) cannot read a lead assigned to someone else', async () => {
      const rows = await asUser(AUTH.orgA.custom, async () => (await client.query(`select * from leads where id = 1`)).rows);
      expect(rows.length).toBe(0);
    });
  });
});
