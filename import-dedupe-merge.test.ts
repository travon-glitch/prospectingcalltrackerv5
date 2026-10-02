// Unit tests for CSV parsing, row extraction and the local-backend import
// dedupe/merge logic in src/features/imports.js (parseCsv, handleFile's
// row extraction via extractRow, importCheck, importRun, undoImport).
//
// imports.js pulls in a similar large chain to exports.js (core/dialog,
// core/fields, core/router, core/session, core/state, core/util,
// data/persist, data/repo-supabase, main.js) which itself involves a
// circular import (data/seed.js calls core/fields.js's
// defaultBuiltInFields() at module-eval time) — importing data/persist.js
// first, exactly like tests/unit/export-crm-columns.test.ts does for its
// own similar chain, avoids hitting that cycle mid-instantiation.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('imports.js — CSV parsing, row extraction, dedupe/merge (local backend)', () => {
  let db: any, nid: any, setMe, parseCsv: any, importCheck: any, importRun: any, undoImport: any, state: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog><input id="iL"><input id="iA"><input type="file" id="fileIn">`;
    if(!HTMLDialogElement.prototype.showModal){
      HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open',''); this.open = true; };
      HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; };
    }
    await import('../../src/data/persist.js');
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const stateMod: any = await import('../../src/core/state.js');
    const importsMod: any = await import('../../src/features/imports.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe; state = stateMod.state;
    parseCsv = importsMod.parseCsv; importCheck = importsMod.importCheck; importRun = importsMod.importRun; undoImport = importsMod.undoImport;
    setMe(db.members.find((m: any) => m.active) || db.members[0]);
  });

  // ---------------------------------------------------------------- shared cleanup
  // Every test that mutates shared db.* arrays or db.settings.importCfg
  // restores them afterward so this file never leaks state into other test
  // files running in the same process. Tests only ever touch importCfg via
  // save/restore, and any leads/lists/activities/notes/etc they push are
  // recorded and removed again in afterEach.
  let savedImportCfg: any;
  const pushedLeads: any[] = [];
  const pushedLists: any[] = [];
  const pushedActivities: any[] = [];
  const pushedImports: any[] = [];
  const pushedCampaignLeads: any[] = [];
  const pushedFollowUps: any[] = [];
  const pushedNotes: any[] = [];

  beforeEach(() => {
    savedImportCfg = { ...db.settings.importCfg };
    pushedLeads.length = 0; pushedLists.length = 0; pushedActivities.length = 0;
    pushedImports.length = 0; pushedCampaignLeads.length = 0; pushedFollowUps.length = 0; pushedNotes.length = 0;
    state.importStep = null;
    $('#iL').value = ''; $('#iA').value = '';
  });

  afterEach(() => {
    db.settings.importCfg = savedImportCfg;
    db.leads = db.leads.filter((l: any) => !pushedLeads.includes(l.id));
    db.lists = db.lists.filter((l: any) => !pushedLists.includes(l.id));
    db.activities = db.activities.filter((a: any) => !pushedActivities.includes(a.id));
    db.imports = db.imports.filter((j: any) => !pushedImports.includes(j.id));
    db.campaignLeads = db.campaignLeads.filter((c: any) => !pushedCampaignLeads.includes(c.id));
    db.followUps = db.followUps.filter((f: any) => !pushedFollowUps.includes(f.id));
    db.notes = db.notes.filter((n: any) => !pushedNotes.includes(n.id));
    state.importStep = null;
  });

  function $(sel: any) { return document.querySelector(sel); }

  function addLead(overrides = {}) {
    const l = {
      id: nid(), first: 'Existing', last: 'Lead', email: '', addr: '', city: '', state: '', zip: '',
      phones: [], listIds: [], assigned: null, status: 'new', dnc: false, dnt: false, dncontact: false,
      archived: false, source: 'manual', createdAt: new Date().toISOString(), custom: {},
      ...overrides,
    };
    db.leads.push(l); pushedLeads.push(l.id);
    return l;
  }

  function addList(overrides = {}) {
    const l = { id: nid(), name: 'Test list', archived: false, createdAt: new Date().toISOString(), ...overrides };
    db.lists.push(l); pushedLists.push(l.id);
    return l;
  }

  /** Sets state.importStep to the shape handleFile() would have produced,
   * bypassing the DOM/File/FileReader path entirely. */
  function setImportStep({ data, map, listId = '', assignee = '' }: any) {
    state.importStep = { step: 'map', file: 'test.csv', headers: map, data, map, FIELDS: [], truncated: false, listId, assignee };
    // importCheck() reads s.listId/s.assignee straight from these DOM
    // inputs (overwriting whatever was set above), the same way
    // handleFile()'s real "map" screen would have left them populated.
    $('#iL').value = listId; $('#iA').value = assignee;
  }

  const STD_MAP = ['first', 'last', 'phone', 'email', 'addr', 'city', 'state', 'zip', 'note', 'tags'];

  // ================================================================ parseCsv()
  describe('parseCsv()', () => {
    it('parses a simple 2-column, 3-row CSV with a header row', () => {
      const rows = parseCsv('First,Last\nJordan,Miles\nCasey,Brooks\nAngela,Ruiz\n');
      expect(rows).toEqual([
        ['First', 'Last'],
        ['Jordan', 'Miles'],
        ['Casey', 'Brooks'],
        ['Angela', 'Ruiz'],
      ]);
    });

    it('handles a quoted field containing a comma', () => {
      const rows = parseCsv('Last,First\n"Smith, Jr.",Pat\n');
      expect(rows).toEqual([
        ['Last', 'First'],
        ['Smith, Jr.', 'Pat'],
      ]);
    });

    it('handles a doubled-quote-escaped internal quote', () => {
      const rows = parseCsv('Note,First\n"He said ""hi""",Pat\n');
      expect(rows).toEqual([
        ['Note', 'First'],
        ['He said "hi"', 'Pat'],
      ]);
    });

    it('handles \\r\\n line endings', () => {
      const rows = parseCsv('First,Last\r\nJordan,Miles\r\nCasey,Brooks\r\n');
      expect(rows).toEqual([
        ['First', 'Last'],
        ['Jordan', 'Miles'],
        ['Casey', 'Brooks'],
      ]);
    });

    it('handles bare \\n line endings', () => {
      const rows = parseCsv('First,Last\nJordan,Miles\nCasey,Brooks\n');
      expect(rows).toEqual([
        ['First', 'Last'],
        ['Jordan', 'Miles'],
        ['Casey', 'Brooks'],
      ]);
    });

    it('handles a lone trailing \\r-only line ending', () => {
      const rows = parseCsv('First,Last\rJordan,Miles\r');
      expect(rows).toEqual([
        ['First', 'Last'],
        ['Jordan', 'Miles'],
      ]);
    });

    it('drops fully-blank rows in the middle of the file', () => {
      const rows = parseCsv('First,Last\nJordan,Miles\n,\nCasey,Brooks\n');
      expect(rows).toEqual([
        ['First', 'Last'],
        ['Jordan', 'Miles'],
        ['Casey', 'Brooks'],
      ]);
    });

    it('returns just the header row for a file with only a header and no data rows', () => {
      const rows = parseCsv('First,Last\n');
      expect(rows).toEqual([['First', 'Last']]);
    });

    it('is lenient with an unterminated quote: it absorbs the rest of the file into one cell, including embedded newlines', () => {
      // There's no error-recovery layer — an opened quote that never
      // closes just keeps consuming characters (including what would
      // otherwise have been row/line boundaries) until EOF.
      const rows = parseCsv('First,Last\n"Jordan,Miles\nCasey,Brooks\n');
      expect(rows).toEqual([
        ['First', 'Last'],
        ['Jordan,Miles\nCasey,Brooks\n'],
      ]);
    });

    it('does not normalize or pad inconsistent column counts row-to-row', () => {
      const rows = parseCsv('A,B,C,D,E\n1,2,3\n');
      expect(rows).toEqual([
        ['A', 'B', 'C', 'D', 'E'],
        ['1', '2', '3'],
      ]);
    });
  });

  // ================================================================ extractRow() via importCheck()
  describe('row extraction (via importCheck()) — short/malformed rows', () => {
    it('does not throw on a row shorter than the header, and missing trailing fields come back as ""', async () => {
      db.settings.importCfg = { ...savedImportCfg, requireName: false, requirePhone: false, dupPhone: false, dupEmail: false, dupAddress: false, flagDnc: false };
      // 5-column map, but the row only has 3 cells — state/zip missing.
      setImportStep({ data: [['Jordan', 'Miles', '4045550170']], map: ['first', 'last', 'phone', 'city', 'zip'] });
      await expect(importCheck()).resolves.not.toThrow();
      const s = state.importStep;
      expect(s.bad.length + s.ready.length + s.dups.length).toBe(1);
      const row = s.ready[0] || s.dups[0]?.row || s.bad[0];
      expect(row.city).toBe('');
      expect(row.zip).toBe('');
    });
  });

  describe('wrong header (no column matches a known field)', () => {
    it('with requireName and requirePhone off, unmatched rows land safely without throwing', async () => {
      db.settings.importCfg = { ...savedImportCfg, requireName: false, requirePhone: false, dupPhone: false, dupEmail: false, dupAddress: false, flagDnc: false };
      setImportStep({ data: [['x', 'y', 'z']], map: ['', '', ''] });
      await expect(importCheck()).resolves.not.toThrow();
      const s = state.importStep;
      // every column resolves to "" (Skip) -> no identifying info at all -> bad[]
      expect(s.bad.length).toBe(1);
      expect(s.ready.length).toBe(0);
      expect(s.dups.length).toBe(0);
    });

    it('with requireName on, every row with an unmatched header lands in bad[]', async () => {
      db.settings.importCfg = { ...savedImportCfg, requireName: true, requirePhone: false, dupPhone: false, dupEmail: false, dupAddress: false, flagDnc: false };
      setImportStep({ data: [['x', 'y', 'z'], ['a', 'b', 'c']], map: ['', '', ''] });
      await expect(importCheck()).resolves.not.toThrow();
      const s = state.importStep;
      expect(s.bad.length).toBe(2);
      expect(s.ready.length).toBe(0);
    });
  });

  // ================================================================ dedupe by phone
  describe('dedupe by phone (cfg.dupPhone)', () => {
    beforeEach(() => {
      db.settings.importCfg = { ...savedImportCfg, dupPhone: true, dupEmail: false, dupAddress: false, requireName: false, requirePhone: false, flagDnc: false };
    });

    it('rejects the second of two same-file rows with an identically-formatted duplicate phone to bad[]', async () => {
      setImportStep({
        data: [
          ['Jordan', 'Miles', '(404) 555-0170', '', '', '', '', '', '', ''],
          ['Other', 'Person', '(404) 555-0170', '', '', '', '', '', '', ''],
        ],
        map: STD_MAP,
      });
      await importCheck();
      const s = state.importStep;
      expect(s.bad.length).toBe(1);
      expect(s.bad[0].first).toBe('Other');
      expect(s.ready.length + s.dups.length).toBe(1);
    });

    it('rejects a second row whose phone normalizes to the same number despite different formatting', async () => {
      setImportStep({
        data: [
          ['Jordan', 'Miles', '(404) 555-0170', '', '', '', '', '', '', ''],
          ['Other', 'Person', '4045550170', '', '', '', '', '', '', ''],
        ],
        map: STD_MAP,
      });
      await importCheck();
      const s = state.importStep;
      expect(s.bad.length).toBe(1);
      expect(s.bad[0].first).toBe('Other');
    });

    it('matches an existing non-archived lead by phone into dups[] with on:"phone"', async () => {
      addLead({ phones: [{ n: '+14045551234', type: 'mobile' }], archived: false });
      setImportStep({ data: [['Jordan', 'Miles', '4045551234', '', '', '', '', '', '', '']], map: STD_MAP });
      await importCheck();
      const s = state.importStep;
      expect(s.dups.length).toBe(1);
      expect(s.dups[0].on).toBe('phone');
      expect(s.bad.length).toBe(0);
      expect(s.ready.length).toBe(0);
    });

    it('does not match an existing ARCHIVED lead by phone — the row lands in ready[] instead', async () => {
      addLead({ phones: [{ n: '+14045559876', type: 'mobile' }], archived: true });
      setImportStep({ data: [['Jordan', 'Miles', '4045559876', '', '', '', '', '', '', '']], map: STD_MAP });
      await importCheck();
      const s = state.importStep;
      expect(s.dups.length).toBe(0);
      expect(s.ready.length).toBe(1);
    });
  });

  // ================================================================ dedupe by email
  describe('dedupe by email (cfg.dupEmail)', () => {
    beforeEach(() => {
      db.settings.importCfg = { ...savedImportCfg, dupPhone: false, dupEmail: true, dupAddress: false, requireName: false, requirePhone: false, flagDnc: false };
    });

    it('rejects a same-file duplicate email to bad[]', async () => {
      setImportStep({
        data: [
          ['Jordan', 'Miles', '', 'jane@example.com', '', '', '', '', '', ''],
          ['Other', 'Person', '', 'jane@example.com', '', '', '', '', '', ''],
        ],
        map: STD_MAP,
      });
      await importCheck();
      const s = state.importStep;
      expect(s.bad.length).toBe(1);
      expect(s.bad[0].first).toBe('Other');
    });

    it('matches an existing lead by email case-insensitively into dups[]', async () => {
      addLead({ email: 'jane@example.com' });
      setImportStep({ data: [['Jane', 'Doe', '', 'Jane@Example.com', '', '', '', '', '', '']], map: STD_MAP });
      await importCheck();
      const s = state.importStep;
      expect(s.dups.length).toBe(1);
      expect(s.dups[0].on).toBe('email');
    });
  });

  // ================================================================ dedupe by address+zip
  describe('dedupe by address + zip (cfg.dupAddress)', () => {
    beforeEach(() => {
      db.settings.importCfg = { ...savedImportCfg, dupPhone: false, dupEmail: false, dupAddress: true, requireName: false, requirePhone: false, flagDnc: false };
    });

    it('matches an existing lead by address (case-insensitive) + exact zip into dups[]', async () => {
      addLead({ addr: '123 Main St', zip: '30301' });
      setImportStep({ data: [['Jane', 'Doe', '', '', '123 MAIN ST', '', '', '30301', '', '']], map: STD_MAP });
      await importCheck();
      const s = state.importStep;
      expect(s.dups.length).toBe(1);
      expect(s.dups[0].on).toBe('address + ZIP');
    });

    it('does NOT match when the address matches but the zip differs', async () => {
      addLead({ addr: '123 Main St', zip: '30301' });
      setImportStep({ data: [['Jane', 'Doe', '', '', '123 Main St', '', '', '99999', '', '']], map: STD_MAP });
      await importCheck();
      const s = state.importStep;
      expect(s.dups.length).toBe(0);
      expect(s.ready.length).toBe(1);
    });
  });

  // ================================================================ required-field rejection
  describe('required-field rejection', () => {
    it('cfg.requireName=true rejects a row with no first/last name to bad[]', async () => {
      db.settings.importCfg = { ...savedImportCfg, requireName: true, requirePhone: false, dupPhone: false, dupEmail: false, dupAddress: false, flagDnc: false };
      setImportStep({ data: [['', '', '4045550170', '', '', '', '', '', '', '']], map: STD_MAP });
      await importCheck();
      expect(state.importStep.bad.length).toBe(1);
    });

    it('cfg.requirePhone=true rejects a row with no phone to bad[]', async () => {
      db.settings.importCfg = { ...savedImportCfg, requireName: false, requirePhone: true, dupPhone: false, dupEmail: false, dupAddress: false, flagDnc: false };
      setImportStep({ data: [['Jordan', 'Miles', '', '', '', '', '', '', '', '']], map: STD_MAP });
      await importCheck();
      expect(state.importStep.bad.length).toBe(1);
    });

    it('rejects a row with absolutely nothing identifying, regardless of the require* flags', async () => {
      db.settings.importCfg = { ...savedImportCfg, requireName: false, requirePhone: false, dupPhone: false, dupEmail: false, dupAddress: false, flagDnc: false };
      setImportStep({ data: [['', '', '', '', '', '', '', '', '', '']], map: STD_MAP });
      await importCheck();
      expect(state.importStep.bad.length).toBe(1);
    });
  });

  // ================================================================ DNC auto-flag
  describe('DNC auto-flag (cfg.flagDnc)', () => {
    beforeEach(() => {
      db.settings.importCfg = { ...savedImportCfg, flagDnc: true, requireName: false, requirePhone: false, dupPhone: false, dupEmail: false, dupAddress: false };
    });

    it('flags a row whose tags contain the whole word "DNC" (case-insensitive)', async () => {
      setImportStep({ data: [['Jordan', 'Miles', '', '', '', '', '', '', '', 'DNC']], map: STD_MAP });
      await importCheck();
      const row = state.importStep.ready[0] || state.importStep.dups[0]?.row;
      expect(row.dnc).toBe(true);
    });

    it('flags a row whose note contains "do not call" (case-insensitive)', async () => {
      setImportStep({ data: [['Jordan', 'Miles', '', '', '', '', '', '', 'Please Do Not Call this number', '']], map: STD_MAP });
      await importCheck();
      const row = state.importStep.ready[0] || state.importStep.dups[0]?.row;
      expect(row.dnc).toBe(true);
    });

    it('does NOT flag "DNCx" (not a whole word)', async () => {
      setImportStep({ data: [['Jordan', 'Miles', '', '', '', '', '', '', '', 'DNCx']], map: STD_MAP });
      await importCheck();
      const row = state.importStep.ready[0] || state.importStep.dups[0]?.row;
      expect(row.dnc).toBe(false);
    });

    it('after importRun(), a flagged row creates a lead with status "do_not_call" and dnc:true', async () => {
      const list = addList();
      setImportStep({ data: [['Jordan', 'Miles', '4045550111', '', '', '', '', '', '', 'DNC']], map: STD_MAP, listId: String(list.id) });
      await importCheck();
      expect(state.importStep.ready.length).toBe(1);
      await importRun();
      const job = db.imports[db.imports.length - 1];
      pushedImports.push(job.id);
      const newLeadId = job.leadIds[0];
      pushedLeads.push(newLeadId);
      const lead = db.leads.find((l: any) => l.id === newLeadId);
      expect(lead.status).toBe('do_not_call');
      expect(lead.dnc).toBe(true);
    });
  });

  // ================================================================ importRun() merge
  describe('importRun() merge behavior', () => {
    beforeEach(() => {
      db.settings.importCfg = { ...savedImportCfg, dupPhone: true, dupEmail: false, dupAddress: false, requireName: false, requirePhone: false, flagDnc: false };
    });

    it('adds the import list id, appends a NEW phone (skipping one already present), and fills empty fields without overwriting set ones', async () => {
      const existing = addLead({
        phones: [{ n: '+14045552222', type: 'mobile' }],
        email: 'already@set.com', // already set -> must NOT be overwritten
        addr: '', // empty -> must be filled in from the import row
        city: '',
        zip: '',
        listIds: [],
      });
      const list = addList();
      setImportStep({
        data: [[
          'New', 'Name',
          '4045552222', '4045553333', // phone col1 (matches existing), phone col2? -- see map below
          'new@import.com',
          '456 Import Ave', 'Importville', 'GA', '12345', '', '',
        ]],
        map: ['first', 'last', 'phone', 'phone2', 'email', 'addr', 'city', 'state', 'zip', 'note', 'tags'],
        listId: String(list.id),
      });
      // cfg.phoneSlots defaults to 10 in the seed, so extractRow() reads
      // "phone2" as a genuine second phone slot key.
      await importCheck();
      const s = state.importStep;
      expect(s.dups.length).toBe(1);
      expect(s.dups[0].match.id).toBe(existing.id);
      s.dups[0].action = 'merge';
      await importRun();
      const job = db.imports[db.imports.length - 1];
      pushedImports.push(job.id);

      expect(existing.listIds).toContain(list.id);
      // existing phone kept once, new phone appended
      expect(existing.phones.some((p: any) => p.n === '+14045552222')).toBe(true);
      expect(existing.phones.filter((p: any) => p.n === '+14045552222').length).toBe(1);
      expect(existing.phones.some((p: any) => p.n === '+14045553333')).toBe(true);
      // email already set -> left alone
      expect(existing.email).toBe('already@set.com');
      // addr/city/zip were empty -> filled in from the import row
      expect(existing.addr).toBe('456 Import Ave');
      expect(existing.city).toBe('Importville');
      expect(existing.zip).toBe('12345');
    });

    it('leaves an already-set field alone even when the import row has a different value for it', async () => {
      const existing = addLead({
        phones: [{ n: '+14045554444', type: 'mobile' }],
        addr: '999 Original Rd', // already set
        city: 'OriginalCity',    // already set
        zip: '00001',            // already set
        email: '',               // empty -> should get filled
        listIds: [],
      });
      const list = addList();
      setImportStep({
        data: [[
          'New', 'Name', '4045554444', '',
          'filled@import.com',
          '456 Different Ave', 'DifferentCity', 'GA', '99999', '', '',
        ]],
        map: ['first', 'last', 'phone', 'phone2', 'email', 'addr', 'city', 'state', 'zip', 'note', 'tags'],
        listId: String(list.id),
      });
      await importCheck();
      const s = state.importStep;
      expect(s.dups.length).toBe(1);
      s.dups[0].action = 'merge';
      await importRun();
      const job = db.imports[db.imports.length - 1];
      pushedImports.push(job.id);

      // addr/city/zip already set -> untouched despite different import values
      expect(existing.addr).toBe('999 Original Rd');
      expect(existing.city).toBe('OriginalCity');
      expect(existing.zip).toBe('00001');
      // email was empty -> filled in
      expect(existing.email).toBe('filled@import.com');
    });
  });

  // ================================================================ undoImport()
  describe('undoImport()', () => {
    it('removes a lead created by the import with no logged activity, and keeps one that already has activity', async () => {
      db.settings.importCfg = { ...savedImportCfg, dupPhone: false, dupEmail: false, dupAddress: false, requireName: false, requirePhone: false, flagDnc: false };
      const list = addList();
      setImportStep({
        data: [
          ['NoActivity', 'Person', '4045557777', '', '', '', '', '', '', ''],
          ['HasActivity', 'Person', '4045558888', '', '', '', '', '', '', ''],
        ],
        map: STD_MAP,
        listId: String(list.id),
      });
      await importCheck();
      expect(state.importStep.ready.length).toBe(2);
      await importRun();
      const job = db.imports[db.imports.length - 1];
      const [leadNoActivityId, leadHasActivityId] = job.leadIds;
      pushedLeads.push(leadNoActivityId, leadHasActivityId);

      // Log an activity against the second created lead so it should survive the undo.
      const act = { id: nid(), leadId: leadHasActivityId, type: 'call', outcomeId: 1, userId: db.members[0].id, at: new Date().toISOString(), note: '', listId: list.id, campaignId: null, durationMin: 1 };
      db.activities.push(act); pushedActivities.push(act.id);

      // undoImport() gates its real removal logic behind a confirmDlg —
      // drive it through the same confirm-click pattern other tests in
      // this repo (list-to-campaign-promise.test.ts) use for a dialog-
      // gated action rather than re-implementing the removal separately.
      undoImport(job.id);
      const confirmBtn: any = document.querySelector('#cYes');
      expect(confirmBtn).toBeTruthy();
      confirmBtn!.click();

      expect(db.leads.some((l: any) => l.id === leadNoActivityId)).toBe(false);
      expect(db.leads.some((l: any) => l.id === leadHasActivityId)).toBe(true);
      expect(job.status).toBe('undone');

      // leadHasActivityId legitimately survives -> it's not in pushedLeads
      // removal scope; leave its activity to clean up in afterEach, and
      // manually drop the kept lead here so it doesn't leak either.
      db.leads = db.leads.filter((l: any) => l.id !== leadHasActivityId);
    });
  });
});
