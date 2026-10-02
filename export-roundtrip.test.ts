// GATE G6 item 4 — export/round-trip certification on the local backend
// (demo-parity code path): export EVERY dataset src/features/exports.js
// offers, parse each CSV back with the app's OWN parseCsv(), and prove every
// value round-trips at the CSV-encoding level; then re-import the one
// dataset the product can re-import (leads) both into the same org (dup
// detection) and into an empty org (full recreation + field diff).
//
// Facts this file certifies (verified against src/features/exports.js /
// src/features/imports.js source, then proven by execution below):
//   - exportCsv() emits "﻿" (BOM) + header + rows joined by \r\n.
//   - csvCell() formula-injection guard (G3): any value starting with
//     = + - @ TAB or CR gets a leading apostrophe. Because every stored
//     phone is "+1XXXXXXXXXX", EVERY exported phone cell is "'+1XXXXXXXXXX"
//     — a KNOWN, deliberate round-trip exception. normPhone() strips the
//     apostrophe on re-import (digits() drops non-digits), so phones still
//     re-import byte-stable. The leading-"=" note exports as "'=SUM(...)";
//     on parse-back the apostrophe stays — asserted precisely below.
//   - csvCell() quote-wraps on [",\n\r] but NOT on TAB, while the app's own
//     parseCsv() treats an unquoted TAB as a column separator — a value
//     containing a tab shifts every following column on re-import. That is
//     a REAL DEFECT, kept red below ("[FAIL — real defect: ...]").
//   - parseCsv() does NOT strip the BOM (first header cell comes back as
//     "﻿First name"), but handleFile() runs String(h).trim() over the
//     headers and JS trim() removes U+FEFF, so the import wizard's header
//     mapping is NOT polluted by the exporter's own BOM. Asserted both ways.
//   - The ONLY re-importable dataset is leads (the wizard only imports
//     leads). Exported-leads columns that map back through guess():
//     first, last, phone, phone2, email, addr, city, zip, and the 4 custom
//     fields (their labels match). Structurally export-only columns (guess()
//     returns "" = Skip): Lists, Campaigns, Assigned to, Status, Attempts,
//     Last attempt, Last outcome, Next follow-up, Do Not Call, Do Not Text,
//     Do Not Contact, Added. State is not exported at all (and the importer
//     drops it too: mk() has no state field).
//   - exportCsv("leads") on the local backend uses filteredLeads(), which
//     respects state filters and state.sort; activities/team_performance use
//     rangeFor(state.range) whose DEFAULT is "week". This test pins every
//     filter to its cleared value and state.range to "all" (any key other
//     than week/month = all-time 2000-01-01..2999-12-31) so the export
//     covers everything, and asserts counts against that pinned range.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

import * as gen from './generate-dataset.ts';

describe('G6 certification — export every dataset, re-import where possible, diff (10,040 leads / 50,000 activities, local backend)', () => {
  let db: any, nid: any, setMe, state: any, parseCsv: any, handleFile: any, importCheck: any, importRun: any, exportCsv: any, CAMPAIGN_TYPES: any;
  let dataset: any;
  const saved: any = {};
  const jobs: any[] = [];                 // the 5 seed-import jobs
  const capturedBlobs: any[] = [];        // download() output, via URL.createObjectURL intercept
  const timings: any[] = [];              // per-export wall clock
  const csv: any = {};                  // dataset -> { text, head, rows (parsed data rows), exc }
  const uidLead = new Map();       // generator unique index i -> created db lead object
  let leadById = new Map();
  let sortedOriginals: any = null;      // the 10,040 leads in exported (name-sorted) order
  const EXP = gen.EXPECTED;

  function $(sel: any) { return document.querySelector(sel); }
  const fullName = (l: any) => `${l.first} ${l.last}`.trim();
  const memberNameX = (id: any) => db.members.find((m: any) => m.id === id)?.name ?? '—';
  /** csvCell()'s value transform MINUS the quoting (which parseCsv undoes):
   * what a parsed-back cell must equal for source value v. */
  const guard = (v: any) => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
  const rawStr = (v: any) => (v == null ? '' : String(v));

  /** Read the blob's BYTES and decode with ignoreBOM:true — blob.text()'s
   * standard UTF-8 decode strips a leading BOM, which would hide the very
   * byte sequence (EF BB BF) this certification must assert exportCsv emits. */
  async function blobText(b: any) {
    const buf = await (typeof b.arrayBuffer === 'function' ? b.arrayBuffer() : new Response(b).arrayBuffer());
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf);
  }
  function mkFile(text: any, name: any) {
    let f: any = new File([text], name, { type: 'text/csv' });
    if (typeof f.text !== 'function') f = { name, text: async () => text };
    return f;
  }
  async function runExport(ds: any) {
    const t0 = performance.now();
    await exportCsv(ds);
    const ms = Math.round(performance.now() - t0);
    const text = await blobText(capturedBlobs[capturedBlobs.length - 1]);
    timings.push({ ds, ms, bytes: text.length });
    return text;
  }
  /** Common per-dataset encoding assertions: BOM, \r\n endings, header, count. */
  function openExport(ds: any, text: any, expectedHead: any, expectedRows: any) {
    expect(text.charCodeAt(0)).toBe(0xFEFF);                       // BOM present
    // No value in the green datasets contains the two-char sequence \r\n, so
    // every \r\n in the file is a row separator: header + N rows, no trailing newline.
    expect(text.split('\r\n').length).toBe(1 + expectedRows);
    expect($('#toast').textContent).toBe(`Exported ${expectedRows} rows`);
    const rows = parseCsv(text.slice(1));                          // strip BOM before the app parser
    expect(rows.length).toBe(1 + expectedRows);                    // parseCsv drops nothing
    expect(rows[0]).toEqual(expectedHead);
    return rows.slice(1);
  }
  /** Field-by-field diff of parsed-back cells vs raw source values run
   * through guard(). Returns the apostrophe-exception count (cells where the
   * formula guard made the round trip non-identical). */
  function diffAll(ds: any, got: any, expectedRaw: any) {
    expect(got.length).toBe(expectedRaw.length);
    const mism = []; let exc = 0;
    for (let i = 0; i < expectedRaw.length; i++) {
      const e = expectedRaw[i], g = got[i];
      if (g.length !== e.length) { mism.push({ ds, row: i + 2, problem: `cell count ${g.length} != ${e.length}` }); continue; }
      for (let j = 0; j < e.length; j++) {
        const want = guard(e[j]);
        if (want !== rawStr(e[j])) exc++;
        if (g[j] !== want && mism.length < 10) mism.push({ ds, row: i + 2, col: j, want, got: g[j] });
      }
    }
    expect(mism).toEqual([]);
    return exc;
  }

  // ---------------------------------------------------------------- expected-value builders (independent of exports.js)
  function actsIndex() {
    const byLead = new Map();
    for (const a of db.activities) { let arr = byLead.get(a.leadId); if (!arr) { arr = []; byLead.set(a.leadId, arr); } arr.push(a); }
    for (const arr of byLead.values()) arr.sort((a: any, b: any) => b.at.localeCompare(a.at)); // same comparator as leadActs()
    return byLead;
  }
  function fuIndex() {
    const byLead = new Map();
    for (const f of db.followUps) { if (f.status !== 'pending') continue; let arr = byLead.get(f.leadId); if (!arr) { arr = []; byLead.set(f.leadId, arr); } arr.push(f); }
    for (const arr of byLead.values()) arr.sort((a: any, b: any) => a.due.localeCompare(b.due));
    return byLead;
  }

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog><input id="iL"><input id="iA"><input type="file" id="fileIn">`;
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.open = true; };
      HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.open = false; };
    }
    // Capture core/util.js download() output (tests/security/input-handling.test.ts pattern),
    // and stub revokeObjectURL so download()'s 2s cleanup timer can't throw in jsdom.
    URL.createObjectURL = (blob) => { capturedBlobs.push(blob); return 'blob:g6-export-' + capturedBlobs.length; };
    URL.revokeObjectURL = () => {};

    await import('../../src/data/persist.js'); // break the seed/fields circular-import cycle first
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const stateMod: any = await import('../../src/core/state.js');
    const importsMod: any = await import('../../src/features/imports.js');
    const exportsMod: any = await import('../../src/features/exports.js');
    const campaignsMod: any = await import('../../src/features/campaigns.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe; state = stateMod.state;
    parseCsv = importsMod.parseCsv; handleFile = importsMod.handleFile;
    importCheck = importsMod.importCheck; importRun = importsMod.importRun;
    exportCsv = exportsMod.exportCsv; CAMPAIGN_TYPES = campaignsMod.CAMPAIGN_TYPES;

    dataset = gen.generateDataset(); // deterministic, SEED=42

    for (const k of ['leads', 'notes', 'imports', 'followUps', 'campaignLeads', 'activities', 'lists', 'members', 'teams']) {
      saved[k] = db[k];
      db[k] = Array.isArray(db[k]) ? [...db[k]] : db[k];
    }
    saved.importCfg = { ...db.settings.importCfg };
    db.leads = []; db.notes = []; db.imports = []; db.followUps = []; db.campaignLeads = []; db.activities = [];

    db.members = [...db.members, ...dataset.users.map((u: any) => ({ ...u }))];
    db.teams = [...db.teams, ...dataset.teams.map((t: any) => ({ ...t }))];
    // An owner (super admin): viewAllLeads / viewTeamReports / managerNotes /
    // export all granted, so every export covers the whole org.
    setMe(db.members.find((m: any) => m.role === 'owner' && m.active) || db.members[0]);

    // Pin every lead filter to its cleared value, sort to the default "name",
    // and the stats range to all-time (default is "week" — documented above).
    Object.assign(state, { q: '', status: '', assigned: '', list: '', campaign: '', dnc: 'any', fu: 'any', outcome: '', attMin: '', attMax: '', laFrom: '', laTo: '', sort: 'name', range: 'all', importStep: null });
  });

  afterAll(() => {
    for (const k of ['leads', 'notes', 'imports', 'followUps', 'campaignLeads', 'activities', 'lists', 'members', 'teams']) db[k] = saved[k];
    db.settings.importCfg = saved.importCfg;
    state.importStep = null; state.range = 'week';
    // eslint-disable-next-line no-console
    console.log('[G6 export] wall-clock:', timings.map((t) => `${t.ds}: ${t.ms}ms (${t.bytes.toLocaleString()} chars)`).join(' · '));
  });

  // ================================================================ 1. SETUP — seed via the REAL import pipeline
  it('setup guard: demo-default importCfg and the signed-in exporter is a super admin (sees all leads/reports)', () => {
    expect(db.settings.importCfg).toEqual({ phoneSlots: 10, emailSlots: 1, dupPhone: true, dupEmail: true, dupAddress: true, maxRows: 50000, requireName: false, requirePhone: false, flagDnc: true, defaultAssign: '', defaultList: '' });
    expect(db.members.filter((m: any) => m.active).length).toBe(23); // 3 seed + 20 dataset users
    expect(dataset.leads.length).toBe(10000);
    expect(dataset.activities.length).toBe(50000);
  });

  for (const spec of gen.EXPECTED.perFile) {
    const k = spec.file;
    it(`seed import leads-${k}.csv through the real pipeline: ready=${spec.ready}/dups=${spec.dups}/bad=${spec.bad} -> db total ${spec.dbLeadsAfter}`, async () => {
      await handleFile(mkFile(gen.buildCsv(k), spec.csvName));
      const s = state.importStep;
      expect(s.step).toBe('map');
      expect(s.data.length).toBe(spec.dataRows);
      expect(s.map).toEqual(['first', 'last', 'phone', 'phone2', 'email', 'addr', 'city', 'state', 'zip', 'note', 'tags']);
      $('#iL').value = ''; $('#iA').value = '';
      await importCheck();
      expect(s.ready.length).toBe(spec.ready);
      expect(s.dups.length).toBe(spec.dups);
      expect(s.bad.length).toBe(spec.bad);
      if (k >= 2) s.dups.forEach((d: any, j: any) => { d.action = gen.actionForDupIndex(j); }); // merge x100, import x10, skip x140
      await importRun();
      const job = db.imports[db.imports.length - 1];
      jobs.push(job);
      expect(job.imported).toBe(spec.imported);
      expect(job.leadIds.length).toBe(spec.created);
      expect(db.leads.length).toBe(spec.dbLeadsAfter);
    });
  }

  it('seeds ALL 50,000 generator activities (valid leadId/userId refs) plus 220 notes, 250 follow-ups and 300 campaign rows', () => {
    expect(db.leads.length).toBe(EXP.finalLeads); // 10,040
    leadById = new Map(db.leads.map((l: any) => [l.id, l]));
    // ready order == data order, so job k's leadIds[0..1999] are exactly the
    // file's 2,000 fresh unique leads, i.e. unique index (k-1)*2000+off.
    for (let k = 1; k <= 5; k++) for (let off = 0; off < 2000; off++) uidLead.set((k - 1) * 2000 + off, leadById.get(jobs[k - 1].leadIds[off]));
    let idMismatch = 0;
    for (let i = 0; i < 10000; i++) {
      const L = gen.makeLead(i), lead = uidLead.get(i);
      if (L.phoneNorm ? lead.phones[0]?.n !== L.phoneNorm : (lead.first !== L.first || lead.last !== L.last)) idMismatch++;
    }
    expect(idMismatch).toBe(0); // the uid->lead map is proven for all 10,000 unique leads

    const t0 = performance.now();
    for (const a of dataset.activities) {
      db.activities.push({ id: a.id, leadId: uidLead.get(Number(a.leadUid.slice(1))).id, userId: a.userId, type: a.type, outcomeId: a.outcomeId, at: a.at, note: '', listId: null, campaignId: null, durationMin: a.durationMin, phone: null });
    }
    timings.push({ ds: 'seed 50k activities', ms: Math.round(performance.now() - t0), bytes: 0 });
    expect(db.activities.length).toBe(50000);
    const mids = new Set(db.members.map((m: any) => m.id));
    expect(db.activities.every((a: any) => leadById.has(a.leadId) && mids.has(a.userId))).toBe(true);

    // Deliberately nasty cell values (NO tabs here — tab is the red-test defect below):
    // formula-prefix candidates (=,+,-,@,\r), commas, embedded/doubled quotes,
    // embedded newlines, unicode+emoji. Deterministic by index.
    const NASTY = [
      '=2+2 formula-looking note',
      '+plus-leading note',
      '-minus-leading note',
      '@at-leading note',
      '\rcarriage-return-leading note',
      'comma, separated, clauses',
      'she said "double ""quotes"" everywhere"',
      'line one\nline two,\n"line three"',
      'Zoë 李雷 José Ólafur Þórðarson 🏠🔥😊 unicode',
      'plain note',
    ];
    const nasty = (j: any) => `${NASTY[j % NASTY.length]} [#${j}]`;
    for (let j = 0; j < 220; j++) {
      db.notes.push({ id: nid(), leadId: uidLead.get((j * 37) % 10000).id, userId: 101 + (j % 20), at: new Date(Date.parse('2026-09-01T00:00:00Z') + j * 3600000).toISOString(), text: nasty(j), kind: j % 7 === 0 ? 'manager' : 'quick' });
    }
    for (let j = 0; j < 250; j++) {
      db.followUps.push({ id: nid(), leadId: uidLead.get((j * 7) % 10000).id, due: new Date(Date.parse('2026-10-01T00:00:00Z') + (j % 30) * 86400000).toISOString().slice(0, 10), status: ['pending', 'done', 'cancelled'][j % 3], note: nasty(j), assignee: 101 + (j % 20), createdAt: new Date(Date.parse('2026-09-15T00:00:00Z') + j * 60000).toISOString() });
    }
    for (let j = 0; j < 300; j++) {
      db.campaignLeads.push({ id: nid(), campaignId: 1 + (j % 3), leadId: uidLead.get((j * 13) % 10000).id, body: null, status: ['draft', 'ready', 'sent', 'replied'][j % 4], sentAt: null, sentBy: null, repliedAt: null });
    }
    expect(db.notes.length).toBe(223); // 3 import-created (LONG/FORMULA/EMOJI) + 220
    expect(db.followUps.length).toBe(250);
    expect(db.campaignLeads.length).toBe(300);
  });

  // ================================================================ 2+3. EXPORT EVERY DATASET + parse-back diff
  it('exportCsv("leads"): 10,040 rows (= every non-archived lead, pinned clear filters), BOM + \\r\\n + exact header, full 10,040-row field diff; 10,430 phone cells are the only apostrophe exceptions', async () => {
    const head = ['First name', 'Last name', 'Phone', 'Phone 2', 'Email', 'Address', 'City', 'ZIP', 'Lists', 'Campaigns', 'Assigned to', 'Status', 'Attempts', 'Last attempt', 'Last outcome', 'Next follow-up', 'Do Not Call', 'Do Not Text', 'Do Not Contact', 'Listing price', 'Expired on', 'Motivation', 'Vacant', 'Added'];
    const expectedCount = db.leads.filter((l: any) => !l.archived).length;
    expect(expectedCount).toBe(10040);

    const text = await runExport('leads');
    const rows = openExport('leads', text, head, expectedCount);

    // Independent expected rows: replicate the documented mapping from db.
    const listName = new Map(db.lists.map((l: any) => [l.id, l.name]));
    const campById = new Map(db.campaigns.map((c: any) => [c.id, c]));
    const campsByLead = new Map();
    for (const cl of db.campaignLeads) { const c: any = campById.get(cl.campaignId); if (!c || c.archived) continue; let arr = campsByLead.get(cl.leadId); if (!arr) { arr = []; campsByLead.set(cl.leadId, arr); } arr.push(c.name); }
    const byLead = actsIndex(); const fus = fuIndex();
    const oName = new Map(db.outcomes.map((o: any) => [o.id, o.name]));
    sortedOriginals = db.leads.filter((l: any) => !l.archived).slice().sort((a: any, b: any) => fullName(a).localeCompare(fullName(b)));
    const expected = sortedOriginals.map((l: any) => {
      const acts = byLead.get(l.id) || []; const la = acts[0];
      return [l.first, l.last, l.phones[0]?.n, l.phones[1]?.n, l.email, l.addr, l.city, l.zip,
        l.listIds.map((id: any) => listName.get(id)).filter(Boolean).join('; '), (campsByLead.get(l.id) || []).join('; '),
        memberNameX(l.assigned), l.status, acts.length, la?.at || '', la ? oName.get(la.outcomeId) : '', (fus.get(l.id) || [])[0]?.due || '',
        l.dnc, l.dnt, l.dncontact, '', '', '', '', l.createdAt];
    });
    const exc = diffAll('leads', rows, expected);
    // The ONLY guard-transformed cells are phones: 10,030 leads have a first
    // phone (all but the 10 name-only leads) and the 400 merged leads have a
    // second — both stored as "+1..." which csvCell apostrophe-prefixes.
    expect(exc).toBe(10430);
    csv.leads = { text, head, rows };

    // Spot checks, byte-exact against generator constants:
    const zoe = rows.find((r: any) => r[0] === 'Zoë');
    expect(zoe[1]).toBe('Åström');
    expect(zoe[2]).toBe("'" + gen.normOf(gen.phoneDigits(3))); // documented apostrophe exception
    expect(rows.some((r: any) => r[0] === '李' && r[1] === '雷')).toBe(true);
    const longAddrRow = rows.find((r: any) => r[2] === "'" + gen.normOf(gen.phoneDigits(11)));
    expect(longAddrRow[5]).toBe(gen.LONG_ADDR);                 // 500-char address byte-exact
    expect(longAddrRow[5].length).toBe(500);
    expect(rows.every((r: any) => r[10] === '—' && r[11] === 'new' && r[16] === 'false' && r[17] === 'false' && r[18] === 'false')).toBe(true);
  });

  it('exportCsv("assignments"): 10,040 rows in db order, full field diff (export-only dataset — no assignments import path exists in the product)', async () => {
    const head = ['Lead', 'Phone', 'Lists', 'Assigned to', 'Role', 'Status'];
    const vis = db.leads.filter((l: any) => !l.archived);
    const text = await runExport('assignments');
    const rows = openExport('assignments', text, head, vis.length);
    const listName = new Map(db.lists.map((l: any) => [l.id, l.name]));
    const expected = vis.map((l: any) => [fullName(l), l.phones[0]?.n, l.listIds.map((id: any) => listName.get(id)).filter(Boolean).join('; '), memberNameX(l.assigned), db.members.find((m: any) => m.id === l.assigned)?.role || '', l.status]);
    expect(diffAll('assignments', rows, expected)).toBe(10030); // one apostrophe'd phone per lead that has one
  });

  it('exportCsv("activities"): ALL 50,000 rows with state.range pinned to all-time (default "week" would truncate — documented), FULL 50,000-row field diff', async () => {
    expect(state.range).toBe('all'); // rangeFor("all") -> ["2000-01-01","2999-12-31"]
    const head = ['When', 'Lead', 'Phone', 'Caller', 'Type', 'Outcome', 'Conversation', 'Duration (min)', 'List', 'Campaign', 'Note'];
    const text = await runExport('activities');
    const rows = openExport('activities', text, head, 50000);
    const oById = new Map(db.outcomes.map((o: any) => [o.id, o]));
    const expected = db.activities.map((a: any) => {
      const l = leadById.get(a.leadId), o: any = oById.get(a.outcomeId);
      return [a.at, fullName(l), a.phone || l.phones[0]?.n, memberNameX(a.userId), a.type, o?.name, !!o?.conv, a.durationMin ?? '', '', '', a.note];
    });
    const actsOnPhonedLeads = db.activities.filter((a: any) => leadById.get(a.leadId).phones.length > 0).length;
    expect(diffAll('activities', rows, expected)).toBe(actsOnPhonedLeads);
    csv.activities = { rows };
  });

  it('exportCsv("outcomes"): 8 rows, usage counts over all 50,000 activities, zero encoding exceptions (export-only dataset)', async () => {
    const head = ['Outcome', 'Counts as conversation', 'Appointment', 'Sets Do Not Call', 'Disabled', 'Times used'];
    const text = await runExport('outcomes');
    const rows = openExport('outcomes', text, head, db.outcomes.length);
    const counts = new Map();
    for (const a of db.activities) counts.set(a.outcomeId, (counts.get(a.outcomeId) || 0) + 1);
    const expected = db.outcomes.map((o: any) => [o.name, o.conv, o.appt, o.dnc, o.disabled, counts.get(o.id) || 0]);
    expect(diffAll('outcomes', rows, expected)).toBe(0);
    expect(rows.reduce((n: any, r: any) => n + Number(r[5]), 0)).toBe(50000); // every activity counted exactly once
  });

  it('exportCsv("notes"): 223 rows incl. 5,000-char note, emoji, unicode, embedded quotes/commas/newlines — all byte-exact; the leading-"=" note is the documented apostrophe exception (export-only dataset)', async () => {
    const head = ['When', 'Lead', 'Author', 'Kind', 'Note'];
    const text = await runExport('notes');
    const rows = openExport('notes', text, head, db.notes.length);
    const expected = db.notes.map((n: any) => [n.at, fullName(leadById.get(n.leadId)), memberNameX(n.userId), n.kind, n.text]);
    const exc = diffAll('notes', rows, expected);
    const guarded = db.notes.filter((n: any) => /^[=+\-@\t\r]/.test(n.text)).length;
    expect(guarded).toBe(111); // 110 seeded (=,+,-,@,\r variants x22 cycles) + the generator's FORMULA_NOTE
    expect(exc).toBe(guarded);

    // The 5,000-char note round-trips byte-exact through encode -> parse:
    const longRow = rows.find((r: any) => r[4].length === 5000);
    expect(longRow[4]).toBe(gen.LONG_NOTE);
    // Emoji note byte-exact:
    expect(rows.some((r: any) => r[4] === gen.EMOJI_NOTE)).toBe(true);
    // KNOWN deliberate exception (G3 formula-injection protection): the
    // leading-"=" note comes back with the protective apostrophe, NOT
    // byte-identical. Asserting the actual behavior precisely:
    const formulaRow = rows.find((r: any) => r[4].includes('=SUM(A1:A10)'));
    expect(formulaRow[4]).toBe("'" + gen.FORMULA_NOTE);
    expect(formulaRow[4]).not.toBe(gen.FORMULA_NOTE);
    // Multiline + doubled-quotes cells round-trip exactly:
    expect(rows.some((r: any) => r[4] === 'line one\nline two,\n"line three" [#7]')).toBe(true);
    expect(rows.some((r: any) => r[4] === 'she said "double ""quotes"" everywhere" [#6]')).toBe(true);
    expect(rows.some((r: any) => r[4] === "'\rcarriage-return-leading note [#4]")).toBe(true); // guarded AND quoted, \r preserved
  });

  it('[FAIL — real defect: csvCell() quote-wraps [",\\n\\r] but NOT tab, while the app\'s own parseCsv() splits unquoted tabs — any exported value containing a tab shifts every following column on re-parse/re-import]', async () => {
    const tabNote = { id: nid(), leadId: db.leads[0].id, userId: 101, at: '2026-09-30T00:00:00.000Z', text: 'before\tafter', kind: 'quick' };
    db.notes.push(tabNote);
    const text = await runExport('notes');
    db.notes.pop(); // clean up BEFORE asserting so the remaining tests are unaffected
    const rows = parseCsv(text.slice(1));
    const last = rows[rows.length - 1];
    // Correct round-trip behavior would be: same cell count as the header and
    // the note intact. Actual: the unquoted tab splits the Note column into
    // two cells ("before", "after"), so the row has 6 cells instead of 5.
    expect(last.length).toBe(rows[0].length); // RED: 6 !== 5 — the defect
    expect(last[4]).toBe('before\tafter');
  });

  it('exportCsv("follow_ups"): 250 rows, full field diff incl. nasty notes (export-only dataset)', async () => {
    const head = ['Due', 'Lead', 'Phone', 'Assignee', 'Status', 'Note', 'Created'];
    const text = await runExport('follow_ups');
    const rows = openExport('follow_ups', text, head, db.followUps.length);
    const expected = db.followUps.map((f: any) => { const l = leadById.get(f.leadId); return [f.due, fullName(l), l.phones[0]?.n, memberNameX(f.assignee), f.status, f.note, f.createdAt]; });
    const phoneCells = db.followUps.filter((f: any) => leadById.get(f.leadId).phones.length > 0).length;
    const guardedNotes = db.followUps.filter((f: any) => /^[=+\-@\t\r]/.test(f.note)).length;
    expect(diffAll('follow_ups', rows, expected)).toBe(phoneCells + guardedNotes);
  });

  it('exportCsv("campaigns"): 3 rows, per-status counts from 300 campaign rows exact, template bodies (commas, merge fields) byte-exact (export-only dataset)', async () => {
    const head = ['Campaign', 'Type', 'Leads', 'Draft', 'Ready', 'Sent', 'Replied', 'Template', 'Created'];
    const live = db.campaigns.filter((c: any) => !c.archived);
    const text = await runExport('campaigns');
    const rows = openExport('campaigns', text, head, live.length);
    const expected = live.map((c: any) => {
      const cs = db.campaignLeads.filter((x: any) => x.campaignId === c.id);
      const n = (s: any) => cs.filter((x: any) => x.status === s).length;
      return [c.name, CAMPAIGN_TYPES[c.type], cs.length, n('draft'), n('ready'), n('sent'), n('replied'), c.body, c.createdAt];
    });
    expect(diffAll('campaigns', rows, expected)).toBe(0);
    expect(rows.reduce((n: any, r: any) => n + Number(r[2]), 0)).toBe(300);
  });

  it('exportCsv("team_performance"): 23 rows (every active member), stats over all 50,000 activities recomputed independently, sorted by points desc; "scoreboard" is a byte-identical alias', async () => {
    const head = ['Caller', 'Role', 'Calls', 'Texts', 'Door knocks', 'Conversations', 'Contact rate %', 'Appointments', 'Talk time (min)', 'Points'];
    const ms = db.members.filter((m: any) => m.active);
    const text = await runExport('team_performance');
    const rows = openExport('team_performance', text, head, ms.length);

    const oById = new Map(db.outcomes.map((o: any) => [o.id, o]));
    const per = new Map(ms.map((m: any) => [m.id, { calls: 0, texts: 0, doors: 0, conv: 0, convCalls: 0, appts: 0, minutes: 0 }]));
    for (const a of db.activities) {
      const t: any = per.get(a.userId); if (!t) continue;
      const o: any = oById.get(a.outcomeId);
      if (a.type === 'call') { t.calls++; t.minutes += a.durationMin || 0; if (o?.conv) t.convCalls++; }
      if (a.type === 'text') t.texts++;
      if (a.type === 'door_knock') t.doors++;
      if (o?.conv) t.conv++;
      if (o?.appt) t.appts++;
    }
    const s = db.settings;
    const expected = ms.map((m: any) => {
      const t: any = per.get(m.id);
      const points = t.calls * s.ptsCall + t.texts * s.ptsText + t.doors * s.ptsDoor + t.conv * s.ptsConv + t.appts * s.ptsAppt;
      return [m.name, m.role, t.calls, t.texts, t.doors, t.conv, t.calls ? Math.round(t.convCalls / t.calls * 100) : 0, t.appts, t.minutes, points];
    }).sort((a: any, b: any) => b[9] - a[9]);
    expect(diffAll('team_performance', rows, expected)).toBe(0);
    expect(expected.reduce((n: any, r: any) => n + r[2] + r[3] + r[4], 0)).toBe(50000); // every activity attributed to exactly one member

    const text2 = await runExport('scoreboard');
    expect(text2).toBe(text); // same dataset under its other name
  });

  // ================================================================ BOM behavior on re-import — tested, not assumed
  it('BOM on re-import: parseCsv() itself does NOT strip it ("\\uFEFFFirst name"), but three independent layers each neutralize it — file.text()\'s UTF-8 decode, handleFile\'s String(h).trim() (U+FEFF is ES whitespace), and guess()\'s [^a-z0-9] strip — so the wizard maps every re-importable column correctly', async () => {
    // Layer 0 — the pollution is real at the parseCsv level: fed the BOM-bearing
    // string directly, the first header cell comes back polluted.
    const raw = parseCsv(csv.leads.text);
    expect(csv.leads.text.charCodeAt(0)).toBe(0xFEFF);
    expect(raw[0][0]).toBe('﻿First name');
    expect(raw[0][0]).not.toBe('First name');
    // Layer 1 — a real file read strips it first: the standard UTF-8 decode
    // behind File.text()/Blob.text() removes a leading BOM.
    const decoded = new TextDecoder('utf-8').decode(new TextEncoder().encode(csv.leads.text));
    expect(decoded.charCodeAt(0)).not.toBe(0xFEFF);
    expect(decoded.startsWith('First name')).toBe(true);
    // Layer 2 — even if the char survived decoding, handleFile's trim() strips
    // U+FEFF (it is ES WhiteSpace)…
    expect('﻿First name'.trim()).toBe('First name');
    // Layer 3 — …and even an untrimmed "﻿first name" still maps, because
    // guess() lowercases and strips every non-[a-z0-9] char, BOM included.

    await handleFile(mkFile(csv.leads.text, 'leads-roundtrip.csv')); // BOM included, real-world fidelity
    const st = state.importStep;
    expect(st.headers[0]).toBe('First name');
    expect(st.truncated).toBe(false);
    expect(st.data.length).toBe(10040);
    // Exactly which exported columns map back (and which are structurally Skip):
    expect(st.map).toEqual(['first', 'last', 'phone', 'phone2', 'email', 'addr', 'city', 'zip',
      '', '', '', '', '', '', '', '', '', '', '', // Lists..Do Not Contact: guess() -> Skip
      'custom:listing_price', 'custom:expired_on', 'custom:motivation', 'custom:vacant',
      '']); // Added -> Skip
  });

  // ================================================================ 4a. Re-import the export into the SAME org
  it('re-importing the exported leads CSV into the same org: dups=9,990 (all on phone), ready=10 (exactly the name-only leads — nothing to match on), bad=40 (second copy of each forced-duplicate phone, within-file dedupe)', async () => {
    const st = state.importStep; // from the handleFile in the BOM test above
    expect(st.file).toBe('leads-roundtrip.csv');
    $('#iL').value = ''; $('#iA').value = '';
    const t0 = performance.now();
    await importCheck();
    timings.push({ ds: 're-import check (same org, 10,040 rows vs 10,040 leads)', ms: Math.round(performance.now() - t0), bytes: 0 });

    expect(st.ready.length).toBe(10);
    expect(st.dups.length).toBe(9990);
    expect(st.bad.length).toBe(40);
    expect(st.ready.length + st.dups.length + st.bad.length).toBe(10040);

    // ready = the 10 name-only leads (i % 1000 === 7): no phone, no email, no
    // addr+zip — the dedupe rules have nothing to match on, so running this
    // import WOULD create 10 duplicate leads. Product behavior, not a code
    // defect: documented as the known limit of phone/email/address matching.
    const nameOnlyNames = new Set(Array.from({ length: 10 }, (_, x) => { const L = gen.makeLead(x * 1000 + 7); return `${L.first} ${L.last}`; }));
    for (const r of st.ready) {
      expect(r.phones.length).toBe(0); expect(r.email).toBe(''); expect(r.addr).toBe('');
      expect(nameOnlyNames.has(`${r.first} ${r.last}`)).toBe(true);
    }
    // every dup matched on phone (the first rule; every non-name-only lead has one)
    expect(st.dups.every((d: any) => d.on === 'phone')).toBe(true);
    // bad = within-file dedupe: the 40 forced-duplicate pairs share a
    // normalized phone, so the second occurrence of each phone in the file is
    // rejected before db matching. All 40 bad phones are the forced norms.
    const forced = new Set(dataset.forcedPhones.map((f: any) => f.norm));
    expect(st.bad.every((r: any) => forced.has(r.phones[0]))).toBe(true);
    expect(new Set(st.bad.map((r: any) => r.phones[0])).size).toBe(40);

    state.importStep = null; // abandon — this check must not mutate the org
    expect(db.leads.length).toBe(10040);
  });

  // ================================================================ 4b. Full re-import into an EMPTY org
  it('full re-import into an empty org: 10,000 of 10,040 recreated (the 40 forced-duplicate copies collapse via within-file phone dedupe); identity/contact fields value-exact for ALL 10,000; workflow fields are export-only by design', async () => {
    const fullDb = db.leads;
    db.leads = []; // simulate a brand-new org
    await handleFile(mkFile(csv.leads.text, 'leads-roundtrip.csv'));
    const st = state.importStep;
    $('#iL').value = ''; $('#iA').value = '';
    const t0 = performance.now();
    await importCheck();
    expect(st.ready.length).toBe(10000);
    expect(st.dups.length).toBe(0);
    expect(st.bad.length).toBe(40); // same within-file forced-pair collapse
    await importRun();
    timings.push({ ds: 're-import run (empty org, 10,000 created)', ms: Math.round(performance.now() - t0), bytes: 0 });

    const job = db.imports[db.imports.length - 1];
    expect(job.imported).toBe(10000);
    expect(db.leads.length).toBe(10000);

    // Which originals survive: replay the importer's own within-file key rule
    // (first phone, else email, else addr+zip) over the rows in export order
    // (== sortedOriginals order, proven cell-by-cell in the leads-export test).
    const seen = new Set(); const kept = []; const dropped = [];
    for (const l of sortedOriginals) {
      const key = l.phones[0]?.n || l.email || (l.addr && l.zip ? (l.addr + l.zip).toLowerCase() : '');
      if (key && seen.has(key)) { dropped.push(l); continue; }
      if (key) seen.add(key);
      kept.push(l);
    }
    expect(kept.length).toBe(10000);
    expect(dropped.length).toBe(40);
    // the dropped copy of each forced pair is the forced duplicate (its
    // "X-Updated" full name collates after the original's, a strict prefix)
    expect(dropped.every((l) => l.last.endsWith('-Updated') && l.email.startsWith('forced'))).toBe(true);

    // Field-by-field diff of ALL 10,000 recreated leads (created in ready
    // order == row order, so db.leads[j] <-> kept[j]):
    const mism = [];
    for (let j = 0; j < 10000; j++) {
      const rec = db.leads[j], org = kept[j];
      if (rec.id !== job.leadIds[j]) mism.push({ j, problem: 'leadIds order' });
      // VALUE-EXACT surviving set: first, last, email, addr, city, zip,
      // phone numbers (both slots; apostrophe stripped back by normPhone,
      // email already lowercase from the original import, zip 5-digit-stable).
      if (rec.first !== org.first || rec.last !== org.last) mism.push({ j, f: 'name', rec: `${rec.first} ${rec.last}`, org: `${org.first} ${org.last}` });
      if (rec.email !== org.email) mism.push({ j, f: 'email', rec: rec.email, org: org.email });
      if (rec.addr !== org.addr) mism.push({ j, f: 'addr' });
      if (rec.city !== org.city) mism.push({ j, f: 'city', rec: rec.city, org: org.city });
      if (rec.zip !== org.zip) mism.push({ j, f: 'zip', rec: rec.zip, org: org.zip });
      const rp = rec.phones.map((p: any) => p.n).join('|'), op = org.phones.map((p: any) => p.n).join('|');
      if (rp !== op) mism.push({ j, f: 'phones', rec: rp, org: op });
      // Structural (not value) notes, asserted for honesty:
      // - 2nd-phone TYPE label is not exported: original merged phones are
      //   [mobile, other], recreated are [mobile, home] (mk()'s slot typing).
      const types = rec.phones.map((p: any) => p.type).join('|');
      if (types !== (rec.phones.length === 2 ? 'mobile|home' : rec.phones.length === 1 ? 'mobile' : '')) mism.push({ j, f: 'phone types', types });
      // - workflow fields reset: fresh list, no assignee, status "new",
      //   flags off, no custom values (none were set), new createdAt.
      if (rec.status !== 'new' || rec.assigned !== null || rec.dnc || rec.dnt || rec.dncontact) mism.push({ j, f: 'workflow reset' });
      if (rec.listIds.length !== 1 || rec.listIds[0] !== job.listId) mism.push({ j, f: 'listIds' });
      if (Object.keys(rec.custom || {}).length !== 0 || Object.keys(org.custom || {}).length !== 0) mism.push({ j, f: 'custom' });
      if (mism.length >= 10) break;
    }
    expect(mism).toEqual([]);

    // Aggregates over the full set:
    expect(db.leads.reduce((n: any, l: any) => n + l.phones.length, 0)).toBe(kept.reduce((n, l) => n + l.phones.length, 0)); // 10,390 phone numbers survive
    expect(db.leads.filter((l: any) => l.email).length).toBe(kept.filter((l) => l.email).length);
    // Email lowercase stability (extractRow lowercases; originals already were):
    expect(kept.every((l) => l.email === l.email.toLowerCase())).toBe(true);
    // ZIP slice(0,5) stability (every original zip is already <= 5 chars):
    expect(kept.every((l) => l.zip.length <= 5)).toBe(true);

    db.leads = fullDb; // put the org back (afterAll restores the snapshot regardless)
  });
});
