// GATE G6, item 3 — "Kill the network mid-import, mid-activity-save and
// mid-status-change. Assert no half-saved records and a clear user message."
//
// LAYER 1 (exercised live, below): the client's behavior when the network
// dies mid-call on the supabase backend. The repo layer
// (src/data/repo-supabase.js) is the only place network I/O happens, so
// "killing the network" is simulated exactly where it would surface: the
// specific repo method the feature awaits rejects with the browser's own
// network-death error, `new Error('Failed to fetch')` (what fetch() throws
// when the connection drops). For each scenario the test asserts BOTH
// halves of the gate item: (a) the local db.* state is byte-for-byte
// unchanged — no half-saved client record — and (b) a clear user-facing
// message landed in the #toast element (core/util.js's toast() sets
// #toast.textContent).
//
// How BACKEND is forced to "supabase": core/session.js computes
//   export const BACKEND = (import.meta.env?.VITE_BACKEND === "supabase") ? "supabase" : "local"
// once, at module load. vi.stubEnv('VITE_BACKEND','supabase') is called in
// beforeAll BEFORE any src module is dynamically imported, so session.js
// evaluates with the stubbed env and every `if(BACKEND==="supabase")`
// branch in imports.js/activity.js/leads.js is live. The very first test
// below asserts BACKEND === "supabase" so this setup can never silently
// degrade into testing the local backend; every scenario additionally
// asserts its fake repo method was actually called, proving the supabase
// branch executed.
//
// How the network is mocked: vi.mock('../../src/data/repo-supabase.js')
// with a PARTIAL mock (importOriginal + spread) that replaces only the
// methods under test (imports.check/commit, activities.log, leads.setStatus/
// setDnc) with vi.fn()s, plus writeAuditLog (fire-and-forget audit write
// every mutation triggers on this backend). Everything else in the module
// — including the `supabase` client export permissions.js/fields.js/
// statuses.js import — stays the original (the client is null without
// VITE_SUPABASE_URL, which is fine: nothing on these failure paths touches
// it).
//
// LAYER 2 (static source verification, the last describe block): this
// sandbox has no Deno runtime and no live Supabase project (same stated
// limitation as tests/security/edge-functions-static.test.ts), so
// SERVER-side atomicity — what half-import the database itself is left
// with when the edge function dies mid-commit — is verified by reading
// the actual function/migration source and pinning the findings with
// assertions, including the intentionally-inverted "documents an absence"
// style that file already established for the rate-limiting gap.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

// vi.mock factories are hoisted above imports, so the controllable fakes
// they close over must be hoisted too.
const netFail = vi.hoisted(() => ({
  importsCheck: vi.fn(),
  importsCommit: vi.fn(),
  activitiesLog: vi.fn(),
  leadsSetStatus: vi.fn(),
  leadsSetDnc: vi.fn(),
  writeAuditLog: vi.fn(async () => {}),
}));

vi.mock('../../src/data/repo-supabase.js', async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    imports: { ...orig.imports, check: netFail.importsCheck, commit: netFail.importsCommit },
    activities: { ...orig.activities, log: netFail.activitiesLog },
    leads: { ...orig.leads, setStatus: netFail.leadsSetStatus, setDnc: netFail.leadsSetDnc },
    writeAuditLog: netFail.writeAuditLog,
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const NET_ERR = 'Failed to fetch'; // what a dropped connection makes fetch() throw

function $(sel: any) { return document.querySelector(sel); }

/** Deep, order-preserving snapshot of every db array a half-save could touch. */
function snapshotDb(db: any) {
  return JSON.stringify({
    leads: db.leads, lists: db.lists, imports: db.imports,
    activities: db.activities, followUps: db.followUps, notes: db.notes,
  });
}

describe('G6 item 3 — network death mid-write (supabase backend, client layer)', () => {
  let db: any, nid: any, setMe, state: any, BACKEND: any;
  let importCheck: any, importRun: any, saveActivity: any, setLeadStatus: any, setDnc: any, canUser: any;

  beforeAll(async () => {
    // Must run before ANY src module loads — core/session.js reads
    // import.meta.env.VITE_BACKEND once, at module evaluation.
    vi.stubEnv('VITE_BACKEND', 'supabase');

    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog><input id="iL"><input id="iA"><input type="file" id="fileIn"><textarea id="noteAct"></textarea><input type="date" id="fuIn">`;
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.open = true; };
      HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.open = false; };
    }

    // persist.js first — same circular-import avoidance every other test
    // file with this import chain uses (see tests/unit/import-dedupe-merge.test.ts).
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const stateMod: any = await import('../../src/core/state.js');
    const permsMod: any = await import('../../src/core/permissions.js');
    const importsMod: any = await import('../../src/features/imports.js');
    const activityMod: any = await import('../../src/features/activity.js');
    const leadsMod: any = await import('../../src/features/leads.js');

    db = persistMod.db; nid = persistMod.nid;
    setMe = sessionMod.setMe; BACKEND = sessionMod.BACKEND;
    state = stateMod.state; canUser = permsMod.canUser;
    importCheck = importsMod.importCheck; importRun = importsMod.importRun;
    saveActivity = activityMod.saveActivity;
    setLeadStatus = leadsMod.setLeadStatus; setDnc = leadsMod.setDnc;

    // An actor whose role can import / log attempts / edit leads — the
    // local seed's owner (super admin) qualifies for everything, which
    // keeps every scenario's failure attributable to the network mock,
    // never to a permission gate.
    const owner = db.members.find((m: any) => m.active && canUser(m, 'editLeads') && canUser(m, 'editOutcomes')) || db.members[0];
    setMe(owner);
  });

  // ------------------------------------------------------- shared cleanup
  const pushedLeads: any[] = [];
  let before; // db snapshot taken by each scenario right before the failing call

  beforeEach(() => {
    netFail.importsCheck.mockReset();
    netFail.importsCommit.mockReset();
    netFail.activitiesLog.mockReset();
    netFail.leadsSetStatus.mockReset();
    netFail.leadsSetDnc.mockReset();
    netFail.writeAuditLog.mockReset().mockResolvedValue(undefined);
    pushedLeads.length = 0;
    state.importStep = null;
    $('#toast').textContent = '';
    $('#iL').value = ''; $('#iA').value = '';
  });

  afterEach(() => {
    db.leads = db.leads.filter((l: any) => !pushedLeads.includes(l.id));
    state.importStep = null;
    state.actOutcome = null;
  });

  function addLead(overrides = {}) {
    const l = {
      id: nid(), first: 'Net', last: 'Fail', email: '', addr: '', city: '', state: '', zip: '',
      phones: [{ n: '+14045550199', type: 'mobile' }], listIds: [], assigned: null, status: 'new',
      dnc: false, dnt: false, dncontact: false, archived: false, source: 'manual',
      createdAt: new Date().toISOString(), custom: {},
      ...overrides,
    };
    db.leads.push(l); pushedLeads.push(l.id);
    return l;
  }

  /** One extracted row in the exact shape extractRow()/the check step produce. */
  function importRow(n = 2) {
    return { n, first: 'Jordan', last: 'Miles', phones: ['+14045550170'], email: '', emails: [], addr: '', city: '', state: '', zip: '', note: '', tags: '', custom: {}, dnc: false };
  }

  // ------------------------------------------------------------ harness sanity
  it('sanity: BACKEND really is "supabase" (vi.stubEnv before module load worked)', () => {
    expect(BACKEND).toBe('supabase');
  });

  // ================================================================ 1. MID-IMPORT
  describe('scenario 1 — network dies mid-import', () => {
    it('mid-CHECK: repoImports.check() rejects → step returns to "map", a clear toast shows, nothing written locally', async () => {
      netFail.importsCheck.mockRejectedValue(new Error(NET_ERR));
      state.importStep = { step: 'map', file: 'netfail.csv', headers: ['First', 'Last', 'Phone'], data: [['Jordan', 'Miles', '4045550170']], map: ['first', 'last', 'phone'], FIELDS: [], truncated: false, listId: '', assignee: '' };
      before = snapshotDb(db);

      await importCheck();

      // the supabase branch really ran — the fake network call was made
      expect(netFail.importsCheck).toHaveBeenCalledTimes(1);
      // documented recovery behavior (imports.js:105): back to the mapping
      // step so the person can retry, loading spinner cleared
      expect(state.importStep.step).toBe('map');
      expect(state.importStep.loading).toBe(false);
      // the person's file/mapping are NOT lost — a retry needs no re-upload
      expect(state.importStep.data.length).toBe(1);
      // clear user message
      expect($('#toast').textContent).toBe(NET_ERR);
      // no half-saved records anywhere
      expect(snapshotDb(db)).toBe(before);
    });

    it('mid-COMMIT: repoImports.commit() rejects → no lead/list/import-job appears locally, importStep is kept for retry, toast shows the error', async () => {
      netFail.importsCommit.mockRejectedValue(new Error(NET_ERR));
      // the ready-to-commit state the check step leaves behind
      state.importStep = {
        step: 'check', file: 'netfail.csv', headers: [], data: [['Jordan', 'Miles', '4045550170']],
        map: ['first', 'last', 'phone'], FIELDS: [], truncated: false, listId: '', assignee: '',
        ready: [importRow()], dups: [], bad: [], loading: false,
      };
      before = snapshotDb(db);
      const hashBefore = location.hash;

      await importRun();

      expect(netFail.importsCommit).toHaveBeenCalledTimes(1);
      // the payload proves which branch ran: the supabase path sends the
      // would-be new list's NAME to the server (new_list_name) instead of
      // creating a local db.lists row first — verified in source
      // (imports.js:149 creates the local list only on the local branch,
      // which the supabase branch returns before ever reaching)
      expect(netFail.importsCommit).toHaveBeenCalledWith(expect.objectContaining({
        file: 'netfail.csv', list_id: null, new_list_name: 'netfail',
        assignee: null, total_rows: 1, dup_count: 0,
        create: [expect.objectContaining({ first: 'Jordan', last: 'Miles' })],
        merge: [],
      }));
      // (a) no half-saved client state: leads, lists, imports, notes,
      // followUps, activities all byte-identical to before the attempt —
      // in particular NO local list and NO local import-job row was created
      expect(snapshotDb(db)).toBe(before);
      // the wizard state survives, so the person can click Import again
      // without re-uploading or re-mapping (importRun's catch only toasts;
      // it does not clear state.importStep — that happens on success only)
      expect(state.importStep).not.toBeNull();
      expect(state.importStep.ready.length).toBe(1);
      // no navigation happened (go("list", ...) is success-path only)
      expect(location.hash).toBe(hashBefore);
      // (b) clear user message
      expect($('#toast').textContent).toBe(NET_ERR);
    });
  });

  // ================================================================ 2. MID-ACTIVITY-SAVE
  describe('scenario 2 — network dies mid-activity-save', () => {
    it('repoActivities.log() rejects → no activity, no follow-up, no status/dnc change locally; toast shows the error', async () => {
      // Source-order fact this test certifies (activity.js:163-172): on the
      // supabase branch saveActivity() mutates NOTHING before the await —
      // it only reads the form and db.leads, then calls repoActivities.log();
      // the local-state refresh (hydrateLeadActivity) and afterSave()
      // (queue advance, actOutcome reset, success toast) are both .then()
      // continuations that a rejection skips entirely.
      netFail.activitiesLog.mockRejectedValue(new Error(NET_ERR));
      const l = addLead({ status: 'new' });
      state.actType = 'call';
      state.actOutcome = db.outcomes.find((o: any) => !o.disabled)?.id ?? 1;
      $('#noteAct').value = 'network died right here';
      $('#fuIn').value = '2026-10-15'; // a follow-up side effect that must not half-apply
      before = snapshotDb(db);
      const queueIdxBefore = state.queueIdx;

      saveActivity(l.id); // fires the promise chain; not awaited by design
      await vi.waitFor(() => expect($('#toast').textContent).toBe(NET_ERR));

      expect(netFail.activitiesLog).toHaveBeenCalledTimes(1);
      expect(netFail.activitiesLog).toHaveBeenCalledWith(expect.objectContaining({
        lead_id: l.id, type: 'call', note: 'network died right here', fu_date: '2026-10-15',
      }));
      // (a) no half-saved state: no activity row, no follow-up row, no
      // cancelled older follow-up, lead's status and dnc untouched
      expect(snapshotDb(db)).toBe(before);
      expect(db.activities.some((a: any) => a.leadId === l.id)).toBe(false);
      expect(db.followUps.some((f: any) => f.leadId === l.id)).toBe(false);
      expect(l.status).toBe('new');
      expect(l.dnc).toBe(false);
      // form/queue state: afterSave() never ran — the chosen outcome is
      // still selected (the form is not cleared) and the queue did not
      // advance, so the person can simply press "Save attempt" again
      expect(state.actOutcome).not.toBeNull();
      expect(state.queueIdx).toBe(queueIdxBefore);
      // (b) clear user message (already asserted via waitFor above)
      expect($('#toast').textContent).toBe(NET_ERR);
    });
  });

  // ================================================================ 3. MID-STATUS-CHANGE
  describe('scenario 3 — network dies mid-status-change', () => {
    it('repoLeads.setStatus() rejects → lead status NOT changed locally (write-then-mirror, not optimistic), toast shows the error', async () => {
      // Source-order fact (leads.js:209-218): the supabase branch calls
      // repoLeads.setStatus() FIRST and only mirrors l.status = key inside
      // the .then() — there is no optimistic local write to roll back.
      netFail.leadsSetStatus.mockRejectedValue(new Error(NET_ERR));
      const l = addLead({ status: 'new' });
      before = snapshotDb(db);

      setLeadStatus(l.id, 'contacted');
      await vi.waitFor(() => expect($('#toast').textContent).toBe(NET_ERR));

      expect(netFail.leadsSetStatus).toHaveBeenCalledTimes(1);
      expect(netFail.leadsSetStatus).toHaveBeenCalledWith(l.id, 'contacted');
      // (a) the failed server write left no local trace
      expect(l.status).toBe('new');
      expect(snapshotDb(db)).toBe(before);
      // (b) clear user message
      expect($('#toast').textContent).toBe(NET_ERR);
    });

    it('bonus — mid-DNC-toggle: repoLeads.setDnc() rejects → dnc flag and status NOT changed locally, toast shows the error', async () => {
      // Same write-then-mirror shape (leads.js:86-119): the patch is
      // computed, sent, and only applied to the in-memory lead in .then().
      netFail.leadsSetDnc.mockRejectedValue(new Error(NET_ERR));
      const l = addLead({ status: 'new', dnc: false });
      before = snapshotDb(db);

      setDnc(l, 'dnc', true);
      await vi.waitFor(() => expect($('#toast').textContent).toBe(NET_ERR));

      expect(netFail.leadsSetDnc).toHaveBeenCalledTimes(1);
      expect(netFail.leadsSetDnc).toHaveBeenCalledWith(l.id, expect.objectContaining({ dnc: true, status_key: 'do_not_call' }));
      expect(l.dnc).toBe(false);
      expect(l.status).toBe('new');
      expect(snapshotDb(db)).toBe(before);
      expect($('#toast').textContent).toBe(NET_ERR);
    });
  });
});

// ==================================================================== LAYER 2
// Server-side atomicity, verified statically (no Deno/live project in this
// sandbox — same limitation tests/security/edge-functions-static.test.ts
// documents). These tests read the deployed-function and migration SOURCE
// and pin what a network/function death halfway through each operation
// leaves behind in the database.
describe('G6 item 3 — server-side atomicity of the underlying writes (static source verification)', () => {
  const fnSrc = (name: any) => fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'functions', name, 'index.ts'), 'utf8');
  const sqlSrc = (name: any) => fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'migrations', name), 'utf8');
  const repoSrc = () => fs.readFileSync(path.join(REPO_ROOT, 'src', 'data', 'repo-supabase.ts'), 'utf8');

  describe('import commit (supabase/functions/import-run, "commit" action) — NOT atomic: a sequence of separate PostgREST writes', () => {
    it('the commit path is many separate inserts/updates across 8 tables, NOT one SQL function/transaction (documented absence — if a future fix wraps it in a transaction, this test should start failing and be updated)', () => {
      const code = fnSrc('import-run');
      // every write the commit makes, each its own awaited PostgREST call:
      expect(code).toMatch(/from\("lists"\)\.insert/);            // ① new list (when none chosen)
      expect(code).toMatch(/from\("imports"\)\.insert/);          // ② job row, status "running"
      expect(code).toMatch(/from\("leads"\)\.insert/);            // ③ leads, per 500-row batch
      expect(code).toMatch(/from\("lead_phones"\)\.insert/);      // ④ phones
      expect(code).toMatch(/from\("lead_lists"\)\.insert/);       // ⑤ list links
      expect(code).toMatch(/from\("lead_custom_values"\)\.insert/); // ⑥ custom values
      expect(code).toMatch(/from\("notes"\)\.insert/);            // ⑦ notes
      expect(code).toMatch(/from\("import_leads"\)\.insert/);     // ⑧ undo-tracking links
      expect(code).toMatch(/from\("imports"\)\.update\(\{ imported, status: "completed" \}\)/); // ⑨ finalize, LAST
      // intentionally-inverted assertions, documenting the absence of any
      // transaction boundary around ②–⑨: the only rpc() the function makes
      // is the permission check, and no SQL transaction verbs appear.
      const rpcCalls = code.match(/\.rpc\("([^"]+)"/g) || [];
      expect(rpcCalls).toEqual(['.rpc("has_permission_for"']);
      expect(/begin;|start transaction|pg_advisory|savepoint/i.test(code)).toBe(false);
    });

    it('write ORDER: job row is recorded FIRST (status "running") and finalized LAST — so a death mid-commit leaves a visible "running" job, created leads, and possibly-missing phones/list-links/notes/import_leads links', () => {
      const code = fnSrc('import-run');
      const jobInsert = code.indexOf('from("imports").insert');
      const leadsInsert = code.indexOf('from("leads").insert');
      const importLeadsInsert = code.indexOf('from("import_leads").insert');
      const finalize = code.indexOf('status: "completed"');
      expect(jobInsert).toBeGreaterThan(-1);
      // job FIRST, before any lead:
      expect(jobInsert).toBeLessThan(leadsInsert);
      // leads before their own side-tables (the per-batch cut can land
      // between a batch's leads insert and its phones/links/notes inserts):
      expect(leadsInsert).toBeLessThan(importLeadsInsert);
      // finalize LAST:
      expect(finalize).toBeGreaterThan(importLeadsInsert);
    });

    it("the side-table inserts (phones/list-links/custom/notes/import_leads) don't even check their own errors — a partial failure there is silently swallowed (documented defect)", () => {
      const code = fnSrc('import-run');
      // Each of these is literally `if (rows.length) await admin.from(...)
      // .insert(rows);` with no { error } destructuring and no return-on-
      // error — unlike the leads insert right above them (insErr).
      expect(code).toMatch(/if \(phoneRows\.length\) await admin\.from\("lead_phones"\)\.insert\(phoneRows\);/);
      expect(code).toMatch(/if \(listRows\.length\) await admin\.from\("lead_lists"\)\.insert\(listRows\);/);
      expect(code).toMatch(/if \(customRows\.length\) await admin\.from\("lead_custom_values"\)\.insert\(customRows\);/);
      expect(code).toMatch(/if \(noteRows\.length\) await admin\.from\("notes"\)\.insert\(noteRows\);/);
      expect(code).toMatch(/if \(importLeadRows\.length\) await admin\.from\("import_leads"\)\.insert\(importLeadRows\);/);
    });

    it('a half-committed import CANNOT be undone: the undo action requires status === "completed", but a death mid-commit leaves the job "running" forever (documented defect)', () => {
      const code = fnSrc('import-run');
      expect(code).toMatch(/if \(job\.status !== "completed"\) return json\(\{ error: "This import can't be undone" \}, 400\);/);
      // and undo only removes leads reachable via import_leads links — a
      // cut before a batch's import_leads insert orphans that batch's
      // leads from undo permanently:
      expect(code).toMatch(/from\("import_leads"\)\.select\("lead_id"\)\.eq\("import_id", jobId\)/);
    });
  });

  describe('activity save (supabase/functions/log-activity + migrations/0017_log_activity.sql) — ATOMIC', () => {
    it('the edge function makes exactly one database write call: rpc("log_activity") — no direct table writes of its own', () => {
      const code = fnSrc('log-activity');
      expect(code).toMatch(/admin\.rpc\("log_activity"/);
      // no raw inserts/updates anywhere in the function:
      expect(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(code)).toBe(false);
    });

    it('log_activity() is ONE plpgsql function containing the activity insert, the status transition, the follow-up replacement/creation, the DNC cancellation and the audit row — a single function call is a single transaction, so a mid-call network death commits all of it or none of it', () => {
      const sql = sqlSrc('0017_log_activity.sql');
      const fnStart = sql.indexOf('create or replace function log_activity(');
      expect(fnStart).toBeGreaterThan(-1);
      const body = sql.slice(fnStart);
      expect(body).toMatch(/language plpgsql/);
      expect(body).toMatch(/insert into activities/);
      expect(body).toMatch(/update leads set dnc = true, status_key = 'do_not_call'/);
      expect(body).toMatch(/update follow_ups set status = 'cancelled', cancel_reason = 'Replaced by a newer follow-up'/);
      expect(body).toMatch(/insert into follow_ups/);
      expect(body).toMatch(/cancel_reason = 'Lead marked Do Not Call'/);
      expect(body).toMatch(/insert into audit_log/);
    });
  });

  describe('status change (src/data/repo-supabase.js leads.setStatus / leads.setDnc) — ATOMIC per statement', () => {
    it('setStatus() is a single UPDATE on the leads row — single-statement, atomic by construction', () => {
      const code = repoSrc();
      const m = code.match(/async setStatus\(id(?::[^,)]+)?, statusKey(?::[^,)]+)?\)(?::[^{]+)?\s*\{([\s\S]*?)\n  \},/);
      expect(m).not.toBeNull();
      const body = m![1];
      expect(body).toMatch(/from\('leads'\)\.update\(\{status_key: statusKey\}\)\.eq\('id', id\)/);
      // exactly one write in the body — nothing for a cut to land between:
      expect((body.match(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/g) || []).length).toBe(1);
    });

    it('setDnc() is a single UPDATE on the leads row (the dnc/dnt/dncontact/status_key patch travels together, atomically); the dncontact follow-up cancellations are separate, later client calls — documented residual gap, see report', () => {
      const code = repoSrc();
      const m = code.match(/async setDnc\(id(?::[^,)]+)?, patch(?::[^,)]+)?\)(?::[^{]+)?\s*\{([\s\S]*?)\n  \},/);
      expect(m).not.toBeNull();
      const body = m![1];
      expect(body).toMatch(/from\('leads'\)\.update\(patch\)\.eq\('id', id\)/);
      expect((body.match(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/g) || []).length).toBe(1);
    });
  });
});
