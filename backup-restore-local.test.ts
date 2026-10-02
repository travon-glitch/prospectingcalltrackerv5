// GATE G6, item 5 (app level) — backup → restore round trip on the LOCAL
// backend, plus the pinned, documented Supabase restore gap.
//
// The product has TWO backup mechanisms:
//   (a) local backend: src/data/persist.js backup() downloads
//       {version:1, savedAt, db} JSON, and the #restoreIn change handler
//       restores it with a straight `db = j.db` swap. Fully round-trippable
//       in-app — that round trip is certified here, table by table, with
//       sha256 checksums.
//   (b) supabase backend: backup() calls orgBackup() → the org-backup edge
//       function, which is EXPORT ONLY. persist.js's own Stage 13 comment
//       (lines 25-31) and supabase/functions/org-backup/index.ts's header
//       both say restoring into a real Supabase org was judged unsafe to
//       build; the restore handler toasts "Restoring a backup isn't
//       available on this backend — export only." That gap is pinned
//       statically in the last describe below so it can't silently
//       regress-or-vanish; the DATABASE-level restore path it forces you to
//       use instead is certified separately in
//       tests/certification/backup-restore-staging.test.ts.
//
// Harness: same jsdom + vi.mock('../../src/main.js') pattern as
// tests/unit/import-dedupe-merge.test.ts (persist.js imported first to
// dodge the seed.js↔core/fields.js module cycle), and the same
// URL.createObjectURL blob-capture trick tests/security/input-handling.test.ts
// uses to read what core/util.js download() would have written to disk.
/* global document, URL, File, Event, HTMLDialogElement, setTimeout, console */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const sha256 = (s: any) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('GATE G6.5 — local-backend backup → restore round trip (app level)', () => {
  let persistMod: any, sessionMod, capturedBlobs: any;
  /** Live view of persist.js's `export let db` (reassigned by restore). */
  const db = () => persistMod.db;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.open = true; };
      HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.open = false; };
    }
    // Capture what download() writes instead of letting jsdom "navigate" to
    // a blob: URL (exact pattern from tests/security/input-handling.test.ts).
    capturedBlobs = [];
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => { capturedBlobs.push(blob); return origCreateObjectURL ? origCreateObjectURL(blob) : 'blob:test'; };
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

    persistMod = await import('../../src/data/persist.js');
    sessionMod = await import('../../src/core/session.js');
    sessionMod.setMe(db().members.find((m: any) => m.active) || db().members[0]);
  });

  function toastText() { return document.querySelector('#toast')!.textContent; }

  /** Per-table canonical JSON + sha256 checksum of the whole db object. */
  function snapshotChecksums(d: any) {
    const out: any = {};
    for (const key of Object.keys(d).sort()) {
      const json = JSON.stringify(d[key]);
      out[key] = { json, sha256: sha256(json) };
    }
    return out;
  }

  /** Drives persist.js's real #restoreIn change handler (bound at import
   * time) with a jsdom File, then waits for the async handler to finish
   * (it awaits f.text()) by polling the toast it always ends with. */
  async function driveRestore(fileText: any, expectToast: any) {
    const input = document.querySelector('#restoreIn');
    const file = new File([fileText], 'backup.json', { type: 'application/json' });
    document.querySelector('#toast')!.textContent = '';
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input!.dispatchEvent(new Event('change'));
    for (let i = 0; i < 200 && toastText() !== expectToast; i++) await new Promise((r) => setTimeout(r, 5));
    expect(toastText()).toBe(expectToast);
  }

  function seedNontrivialData() {
    const d = db();
    const nid = persistMod.nid;
    const longNote = ('Пример длинной заметки — ' + '€漢字🚀 line\nwith "quotes", commas, and =FORMULA() payloads; ').repeat(60); // ~3.4k chars
    const customField = { id: nid(), key: 'closing_gift', label: 'Closing gift 🎁', type: 'choice', choices: ['Bøttle of wine 🍷', '"Smart" lock'], hint: '', inTable: true, onCard: true, active: true, order: 99 };
    d.customFields.push(customField);
    const leads = [
      { first: 'Žofia 😀', last: "O'Brien-Ωmega", email: 'zofia@example.test', addr: '12 Üñíçødé Str.\nApt "B"', city: 'München', state: 'GA', zip: '30301', custom: { closing_gift: 'Bøttle of wine 🍷', notes_blob: longNote } },
      { first: '李', last: '小龍', email: '', addr: '456 Way', city: 'Atlanta', state: 'GA', zip: '30302', custom: {} },
      { first: 'عَرَبِيّ', last: 'Ñandú', email: 'rtl@example.test', addr: longNote, city: '', state: '', zip: '', custom: {} },
    ].map((o) => ({
      id: nid(), phones: [{ n: '+14045550199', type: 'mobile' }], listIds: [], assigned: d.members[0].id,
      status: 'new', dnc: false, dnt: false, dncontact: false, archived: false, source: 'manual',
      createdAt: new Date().toISOString(), ...o,
    }));
    // distinct phone per lead (lead_phones-style uniqueness not enforced locally, but keep it realistic)
    leads[1].phones = [{ n: '+14045550198', type: 'home' }];
    leads[2].phones = [{ n: '+14045550197', type: 'work' }, { n: '+14045550196', type: 'other' }];
    d.leads.push(...leads);
    d.followUps.push({ id: nid(), leadId: leads[0].id, due: '2026-10-15', status: 'pending', note: 'Call back about the Üñíçødé condo 🏠', assignee: d.members[0].id, createdAt: new Date().toISOString() });
    d.activities.push({ id: nid(), leadId: leads[0].id, type: 'call', outcomeId: d.outcomes[0].id, userId: d.members[0].id, at: new Date().toISOString(), note: longNote, listId: null, campaignId: null, durationMin: 7 });
    d.notes.push({ id: nid(), leadId: leads[1].id, userId: d.members[0].id, at: new Date().toISOString(), text: longNote, kind: 'quick' });
    d.deals.push({
      id: nid(), leadId: leads[2].id, pipelineId: d.pipelines[0].id, stageId: d.pipelines[0].stages[0].id,
      assigned: d.members[0].id, temperature: 'hot', price: 999999.99, commPct: 3, referralPct: 0, teamSplitPct: 0,
      brokeragePct: 0, brokerageFee: 0, closingCosts: 0, closeDate: null, nextFu: null, notes: longNote,
      createdAt: new Date().toISOString(), stageEnteredAt: new Date().toISOString(), createdBy: d.members[0].id, history: [],
    });
    return leads;
  }

  it('backup() downloads {version:1, savedAt, db} whose db serializes byte-identically to the live db', async () => {
    seedNontrivialData();
    persistMod.backup();
    expect(toastText()).toBe('Backup downloaded');
    const blob = capturedBlobs.at(-1);
    expect(blob).toBeTruthy();
    const text = await blob.text();
    const j = JSON.parse(text);
    expect(j.version).toBe(1);
    expect(typeof j.savedAt).toBe('string');
    expect(JSON.stringify(j.db)).toBe(JSON.stringify(db()));
  });

  it('restore of a backup round-trips EVERY db table byte-exactly (JSON.stringify + sha256 per table), evidenced by checksums', async () => {
    // 1. Snapshot + backup the current (nontrivial) db.
    const pre: any = snapshotChecksums(JSON.parse(JSON.stringify(db())));
    persistMod.backup();
    const backupText = await capturedBlobs.at(-1).text();

    // 2. Mutate the db heavily so a no-op "restore" could not pass.
    const d = db();
    d.leads.splice(0, Math.ceil(d.leads.length / 2));
    d.leads.push({ id: persistMod.nid(), first: 'Mutant', last: 'PostBackup', phones: [], listIds: [], custom: {}, status: 'new', dnc: false, dnt: false, dncontact: false, archived: false, source: 'manual', createdAt: new Date().toISOString() });
    d.members[0].first = 'Renamed';
    d.followUps.length = 0;
    d.activities.length = 0;
    d.deals.pop();
    d.settings.teamName = 'MUTATED';
    expect(sha256(JSON.stringify(d.leads))).not.toBe(pre.leads.sha256);

    // 3. Restore through the REAL #restoreIn change handler.
    await driveRestore(backupText, 'Backup restored');

    // 4. Every table (every top-level db key) must match the pre-backup
    //    snapshot byte-exactly. Checksums printed as certification evidence.
    const post: any = snapshotChecksums(db());
    expect(Object.keys(post).sort()).toEqual(Object.keys(pre).sort());
    const matrix = [];
    for (const key of Object.keys(pre).sort()) {
      matrix.push(`${key.padEnd(14)} pre=${pre[key].sha256.slice(0, 16)}… post=${post[key].sha256.slice(0, 16)}… ${pre[key].sha256 === post[key].sha256 ? 'MATCH' : 'MISMATCH'}`);
    }
    console.log('[G6.5 PART A] per-table sha256(JSON.stringify(table)) pre-backup vs post-restore:\n' + matrix.join('\n'));
    for (const key of Object.keys(pre)) {
      expect(post[key].sha256, `table "${key}" must round-trip byte-exactly`).toBe(pre[key].sha256);
      expect(post[key].json).toBe(pre[key].json);
    }
    // The expected table list, pinned so a schema change is a conscious re-certification:
    for (const t of ['leads', 'members', 'teams', 'roles', 'activities', 'followUps', 'notes', 'campaigns', 'campaignLeads', 'lists', 'deals', 'pipelines', 'settings', 'customFields', 'outcomes', 'imports', 'audit', 'templates', 'teamHistory', 'invites', 'seq']) {
      expect(pre, `expected db key "${t}" present`).toHaveProperty(t);
    }
    // (lead statuses live inside settings.statuses on this backend)
    expect(JSON.parse(pre.settings.json)).toHaveProperty('statuses');
  });

  it('restoring a garbage (non-JSON) file toasts "That isn\'t a valid backup file" and leaves db UNCHANGED', async () => {
    const before: any = snapshotChecksums(JSON.parse(JSON.stringify(db())));
    await driveRestore('this is not json {{{', "That isn't a valid backup file");
    const after: any = snapshotChecksums(db());
    for (const key of Object.keys(before)) expect(after[key].sha256).toBe(before[key].sha256);
  });

  it('restoring valid JSON that is not a backup (no db.leads) is rejected the same way, db unchanged', async () => {
    const before: any = snapshotChecksums(JSON.parse(JSON.stringify(db())));
    await driveRestore(JSON.stringify({ version: 1, db: { nope: true } }), "That isn't a valid backup file");
    const after: any = snapshotChecksums(db());
    for (const key of Object.keys(before)) expect(after[key].sha256).toBe(before[key].sha256);
  });
});

// ===================================================================
// PART C — the Supabase restore gap, pinned statically so the certified
// fact ("org backup is export-only; restore requires an out-of-band
// database-level restore") can't silently regress or vanish. The DB-level
// restore itself is certified in backup-restore-staging.test.ts.
describe('GATE G6.5 — Supabase backend backup is EXPORT ONLY (documented product gap, pinned)', () => {
  const persistSrc = readFileSync(path.join(REPO_ROOT, 'src/data/persist.ts'), 'utf8');
  const orgBackupSrc = readFileSync(path.join(REPO_ROOT, 'supabase/functions/org-backup/index.ts'), 'utf8');

  it('persist.js refuses in-app restore on the supabase backend with the documented toast', () => {
    expect(persistSrc).toContain(`if(BACKEND==="supabase"){ toast("Restoring a backup isn't available on this backend — export only."); return; }`);
    // The Stage 13 rationale comment that documents WHY (quoted in the report):
    expect(persistSrc).toContain('restoring a backup into a real Supabase org was judged unsafe');
    expect(persistSrc).toContain('id remapping across every');
    expect(persistSrc).toContain('broken Auth account for every restored member');
  });

  it('org-backup edge function declares itself EXPORT ONLY and contains no restore/import action', () => {
    expect(orgBackupSrc).toContain('Stage 13 scope: EXPORT ONLY.');
    expect(orgBackupSrc).toContain('there is\n// deliberately no "restore" action in this function.');
    // Strip the comments (which legitimately DISCUSS restoring) — the CODE
    // itself must contain no restore/import action of any kind:
    const codeOnly = orgBackupSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codeOnly).not.toMatch(/restore/i);
    expect(codeOnly).not.toMatch(/\bimport_|"import"|'import'/);
    // No write surface besides the single audit_log bookkeeping insert:
    expect(orgBackupSrc).not.toMatch(/\.upsert\s*\(/);
    expect(orgBackupSrc).not.toMatch(/\.delete\s*\(/);
    expect(orgBackupSrc).not.toMatch(/\.update\s*\(/);
    const inserts = [...orgBackupSrc.matchAll(/from\("([^"]+)"\)\.insert\(/g)].map((m) => m[1]);
    expect(inserts).toEqual(['audit_log']);
  });

  it('supabase-backend backup() routes to orgBackup() and never offers a restore path', () => {
    expect(persistSrc).toMatch(/if\(BACKEND==="supabase"\)\{\s*\n?\s*orgBackup\(\)/);
  });
});
