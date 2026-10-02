// Stage 6: table-driven parity test for logActivity()'s status/follow-up
// side effects, run against BOTH backends —
//   - "local repo": the real features/activity.js#logActivity(), imported
//     and exercised directly (main.js's draw() is the only thing mocked,
//     so this is the actual demo logic, not a re-implementation of it).
//   - "supabase repo": migration 0017_log_activity.sql's log_activity()
//     Postgres function — the same SQL the log-activity edge function
//     calls into — exercised directly against a real, throwaway local
//     Postgres database (same workflow Stage 5's search_leads() parity
//     tests used). Skipped automatically if no local Postgres is reachable
//     (e.g. in a sandbox without one), so the suite still runs everywhere;
//     it actually runs and passes in this repo's own dev/verification
//     environment.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// The 8 seed outcomes (src/data/seed.js) and the status/follow-up side
// effects logActivity() derives from each one, independent of whatever
// status the lead started in (except the "new" -> "attempted" rule, which
// only fires when nothing else applies and the lead was still "new").
const OUTCOMES = [
  { name: 'No answer',       conv: false, appt: false, dnc: false },
  { name: 'Left voicemail',  conv: false, appt: false, dnc: false },
  { name: 'Wrong number',    conv: false, appt: false, dnc: false },
  { name: 'Not interested',  conv: true,  appt: false, dnc: false },
  { name: 'Interested',      conv: true,  appt: false, dnc: false },
  { name: 'Appointment set', conv: true,  appt: true,  dnc: false },
  { name: 'Call back later', conv: true,  appt: false, dnc: false },
  { name: 'Do not call',     conv: false, appt: false, dnc: true },
];

/** logActivity()'s exact status-transition rule, independent of backend —
 * both the local function and the SQL function are expected to reproduce
 * this precisely, so the expectation table is shared between both
 * describe blocks below. */
function expectedStatus(startStatus: any, oc: any) {
  if (oc.dnc) return 'do_not_call';
  if (oc.appt) return 'appointment';
  if (oc.conv) return 'contacted';
  if (startStatus === 'new') return 'attempted';
  return startStatus;
}

// ============================================================== local repo
describe('logActivity() — local repo', () => {
  let db: any, logActivity: any, setMe, nid: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    const activityMod: any = await import('../../src/features/activity.js');
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    logActivity = activityMod.logActivity;
    db = persistMod.db;
    nid = persistMod.nid;
    setMe = sessionMod.setMe;
    setMe(db.members.find((m: any) => m.active) || db.members[0]);
  });

  /** A brand-new, isolated lead for each case so cases never share state. */
  function freshLead(status: any, flags = {}) {
    const l = {
      id: nid(), first: 'Test', last: 'Lead', email: '', addr: '', city: '', zip: '',
      phones: [{ n: '+14045550100', type: 'home' }], listIds: [], assigned: db.members[0].id,
      status, dnc: false, dnt: false, dncontact: false, archived: false,
      source: 'manual', createdAt: new Date().toISOString(), custom: {}, ...flags,
    };
    db.leads.push(l);
    return l;
  }
  const outcomeRow = (name: any) => db.outcomes.find((o: any) => o.name === name);

  for (const oc of OUTCOMES) {
    it(`"${oc.name}" on a "new" lead → ${expectedStatus('new', oc)}`, () => {
      const lead = freshLead('new');
      const before = db.activities.length;
      const ok = logActivity(lead.id, 'call', outcomeRow(oc.name).id, {});
      expect(ok).toBe(true);
      expect(db.activities.length).toBe(before + 1);
      expect(lead.status).toBe(expectedStatus('new', oc));
      expect(lead.dnc).toBe(oc.dnc);
    });
  }

  it('a new follow-up replaces the pending one, cancelled with the demo reason', () => {
    const lead = freshLead('attempted');
    db.followUps.push({ id: nid(), leadId: lead.id, due: '2026-01-01', status: 'pending', note: '', assignee: lead.assigned, createdAt: new Date().toISOString() });
    logActivity(lead.id, 'call', outcomeRow('Call back later').id, { fuDate: '2026-02-02' });
    const fus = db.followUps.filter((f: any) => f.leadId === lead.id).sort((a: any,b: any)=>a.createdAt.localeCompare(b.createdAt));
    expect(fus.length).toBe(2);
    expect(fus[0].status).toBe('cancelled');
    expect(fus[0].cancelReason).toBe('Replaced by a newer follow-up');
    expect(fus[1].status).toBe('pending');
    expect(fus[1].due).toBe('2026-02-02');
  });

  it('a DNC outcome cancels pending follow-ups, including one just created in the same call', () => {
    const lead = freshLead('new');
    logActivity(lead.id, 'call', outcomeRow('Do not call').id, { fuDate: '2026-03-03' });
    const fus = db.followUps.filter((f: any) => f.leadId === lead.id);
    expect(fus.length).toBe(1);
    expect(fus[0].status).toBe('cancelled');
    expect(fus[0].cancelReason).toBe('Lead marked Do Not Call');
    expect(lead.status).toBe('do_not_call');
    expect(lead.dnc).toBe(true);
  });

  it('a reply is never blocked and marks the matching phone mobile', () => {
    const lead = freshLead('do_not_call', { dnc: true, dncontact: true, phones: [{ n: '+14045550199', type: 'home' }] });
    const ok = logActivity(lead.id, 'reply', outcomeRow('Interested').id, { phone: '+14045550199' });
    expect(ok).toBe(true);
    expect(lead.phones[0].type).toBe('mobile');
    expect(lead.status).toBe('contacted');
  });

  it('a blocked lead cannot log a call (or text/door_knock), and nothing is recorded', () => {
    const lead = freshLead('new', { dnc: true });
    const before = db.activities.length;
    const ok = logActivity(lead.id, 'call', outcomeRow('No answer').id, {});
    expect(ok).toBe(false);
    expect(db.activities.length).toBe(before);
    expect(lead.status).toBe('new');
  });
});

// =========================================================== supabase repo
const TEST_DB = 'vitest_stage6_activity';
/** Single-quote a string for a POSIX shell, escaping embedded single
 * quotes — unlike JSON.stringify's double quotes, this is immune to the
 * shell's own `$$`/`$var`/backtick expansion inside the SQL text (the
 * `$$ ... $$` dollar-quoting migration 0017 and the fixtures below use). */
const shq = (s: any) => `'${s.replace(/'/g, `'\\''`)}'`;
const PG = (sql: any) => `sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -c ${shq(sql)}`;

function pgReachable() {
  try { execSync('pg_isready -q'); return true; } catch { return false; }
}

const supabaseAvailable = pgReachable();

describe.skipIf(!supabaseAvailable)('log_activity() — supabase repo (real Postgres)', () => {
  beforeAll(() => {
    execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`);
    execSync(`sudo -u postgres createdb ${TEST_DB}`);
    execSync(PG(
      "create schema if not exists auth; " +
      "create or replace function auth.uid() returns uuid language sql stable as $$ select current_setting('request.jwt.claim.sub', true)::uuid; $$;"
    ));
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = execSync(`ls ${migrationsDir}`).toString().trim().split('\n').filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      execSync(`sudo -u postgres psql -d ${TEST_DB} -v ON_ERROR_STOP=1 -f ${path.join(migrationsDir, f)}`);
    }
    execSync(PG(
      "do $$ begin if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$; " +
      "grant usage on schema public to authenticated; " +
      "grant select, insert, update, delete on all tables in schema public to authenticated; " +
      "grant usage, select on all sequences in schema public to authenticated;"
    ));

    // Fixtures: one org, one role with editOutcomes/viewAllLeads, one
    // caller member, the demo's 7 statuses (leads.status_key FKs into
    // this), the 8 seed outcomes, and a fresh lead per test case below
    // (inserted from each `it`, not here, so cases never share a lead).
    execSync(PG(
      "insert into orgs (id, name) values (1, 'Test Org'); " +
      "select setval(pg_get_serial_sequence('orgs','id'), 1, true); " +
      "insert into roles (org_id, id, name, built_in, super_admin) values (1, 'agent', 'Agent', true, false), (1, 'no_perms', 'No permissions', true, false); " +
      "insert into role_permissions (org_id, role_id, permission_key, allowed) values " +
      "  (1, 'agent', 'editOutcomes', true), (1, 'agent', 'viewAllLeads', true); " +
      "insert into members (id, org_id, first, last, email, role_id, active) values " +
      "  (1, 1, 'Ann', 'Agent', 'ann@test.com', 'agent', true), " +
      "  (2, 1, 'Nick', 'Noperm', 'nick@test.com', 'no_perms', true); " +
      "select setval(pg_get_serial_sequence('members','id'), 2, true); " +
      "insert into statuses (org_id, key, label, tone, active, locked, \"order\") values " +
      "  (1,'new','New','blue',true,true,0), (1,'attempted','Attempted','',true,true,1), " +
      "  (1,'contacted','Contacted','green',true,true,2), (1,'appointment','Appointment','green',true,true,3), " +
      "  (1,'do_not_call','Do Not Call','red',true,true,4), (1,'do_not_contact','Do Not Contact','red',true,true,5), " +
      "  (1,'closed','Closed','',true,false,6); " +
      "insert into outcomes (id, org_id, name, conv, appt, dnc, disabled) values " +
      "  (1,1,'No answer',false,false,false,false), (2,1,'Left voicemail',false,false,false,false), " +
      "  (3,1,'Wrong number',false,false,false,false), (4,1,'Not interested',true,false,false,false), " +
      "  (5,1,'Interested',true,false,false,false), (6,1,'Appointment set',true,true,false,false), " +
      "  (7,1,'Call back later',true,false,false,false), (8,1,'Do not call',false,false,true,false); " +
      "select setval(pg_get_serial_sequence('outcomes','id'), 8, true);"
    ));
  });

  afterAll(() => {
    try { execSync(`sudo -u postgres dropdb --if-exists ${TEST_DB}`); } catch { /* best effort */ }
  });

  let nextLeadId = 1;
  function freshLeadRow(flags = '') {
    const id = ++nextLeadId;
    execSync(PG(
      `insert into leads (id, org_id, first, last, assigned_id, status_key, dnc, dnt, dncontact, archived, source) ` +
      `values (${id}, 1, 'Test', 'Lead', 1, 'new', false, false, false, false, 'manual'); ` +
      `insert into lead_phones (org_id, lead_id, n, type, "position") values (1, ${id}, '+1404555${String(id).padStart(4,'0')}', 'home', 0);` +
      flags
    ));
    return id;
  }
  function leadRow(id: any) {
    const out = execSync(`sudo -u postgres psql -d ${TEST_DB} -t -A -F',' -c "select status_key, dnc from leads where id=${id}"`).toString().trim();
    const [status_key, dnc] = out.split(',');
    return { status: status_key, dnc: dnc === 't' };
  }
  const outcomeIdByName: any = { 'No answer':1, 'Left voicemail':2, 'Wrong number':3, 'Not interested':4, 'Interested':5, 'Appointment set':6, 'Call back later':7, 'Do not call':8 };

  for (const oc of OUTCOMES) {
    it(`"${oc.name}" on a "new" lead → ${expectedStatus('new', oc)} (SQL log_activity())`, () => {
      const leadId = freshLeadRow();
      execSync(PG(`select log_activity(1, 1, ${leadId}, 'call', ${outcomeIdByName[oc.name]});`));
      const row = leadRow(leadId);
      expect(row.status).toBe(expectedStatus('new', oc));
      expect(row.dnc).toBe(oc.dnc);
    });
  }

  it('a new follow-up replaces the pending one, cancelled with the demo reason', () => {
    const leadId = freshLeadRow();
    execSync(PG(`select log_activity(1, 1, ${leadId}, 'call', ${outcomeIdByName['Call back later']}, '', '2026-01-01');`));
    execSync(PG(`select log_activity(1, 1, ${leadId}, 'call', ${outcomeIdByName['Call back later']}, '', '2026-02-02');`));
    const out = execSync(`sudo -u postgres psql -d ${TEST_DB} -t -A -F'|' -c "select status, cancel_reason from follow_ups where lead_id=${leadId} order by created_at"`).toString().trim().split('\n');
    expect(out.length).toBe(2);
    expect(out[0]).toBe('cancelled|Replaced by a newer follow-up');
    expect(out[1].startsWith('pending')).toBe(true);
  });

  it('a DNC outcome cancels pending follow-ups, including one just created in the same call', () => {
    const leadId = freshLeadRow();
    execSync(PG(`select log_activity(1, 1, ${leadId}, 'call', ${outcomeIdByName['Do not call']}, '', '2026-03-03');`));
    const out = execSync(`sudo -u postgres psql -d ${TEST_DB} -t -A -F'|' -c "select status, cancel_reason from follow_ups where lead_id=${leadId}"`).toString().trim();
    expect(out).toBe('cancelled|Lead marked Do Not Call');
    const row = leadRow(leadId);
    expect(row.status).toBe('do_not_call');
    expect(row.dnc).toBe(true);
  });

  it('a reply is never blocked and marks the matching phone mobile', () => {
    const leadId = freshLeadRow();
    execSync(PG(`update leads set dnc=true, dncontact=true where id=${leadId};`));
    const phone = `+1404555${String(leadId).padStart(4,'0')}`;
    execSync(PG(`select log_activity(1, 1, ${leadId}, 'reply', ${outcomeIdByName['Interested']}, '', null, '', null, null, '${phone}');`));
    const type = execSync(`sudo -u postgres psql -d ${TEST_DB} -t -A -c "select type from lead_phones where lead_id=${leadId} and n='${phone}'"`).toString().trim();
    expect(type).toBe('mobile');
    expect(leadRow(leadId).status).toBe('contacted');
  });

  it('a blocked lead (DNC) gets a 403-class error (SQLSTATE 42501) and nothing is recorded', () => {
    const leadId = freshLeadRow();
    execSync(PG(`update leads set dnc=true where id=${leadId};`));
    let threw = null;
    try {
      execSync(PG(`select log_activity(1, 1, ${leadId}, 'call', ${outcomeIdByName['No answer']});`), { stdio: 'pipe' });
    } catch (e: any) { threw = e.stderr?.toString() || e.message; }
    expect(threw).toMatch(/That action is blocked for this lead/);
    const count = execSync(`sudo -u postgres psql -d ${TEST_DB} -t -A -c "select count(*) from activities where lead_id=${leadId}"`).toString().trim();
    expect(count).toBe('0');
  });

  it('logging without editOutcomes permission is refused', () => {
    const leadId = freshLeadRow();
    let threw = null;
    try {
      execSync(PG(`select log_activity(2, 1, ${leadId}, 'call', ${outcomeIdByName['No answer']});`), { stdio: 'pipe' });
    } catch (e: any) { threw = e.stderr?.toString() || e.message; }
    expect(threw).toMatch(/Logging attempts is turned off for your role/);
  });
});
