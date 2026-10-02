// GATE G6 items 1+2 — data-integrity certification of the import pipeline
// (local backend = demo-parity code path) against the 10,000-lead messy
// dataset produced by tests/certification/generate-dataset.ts.
//
// Certified demo-parity rules (verified byte-for-byte against
// docs/original-demo.html.ref):
//   - dedupe   (demo lines 1093-1101 / rebuild src/features/imports.js:116-125):
//     within-file key = first phone (dupPhone) else email (dupEmail) else
//     addr+zip (dupAddress), repeats -> bad[]; against-db match on any phone /
//     email / addr+zip of a non-archived lead -> dups[] with action skip/import/merge.
//   - merge    (demo line 1107 / rebuild imports.js:152): adds the list id,
//     appends missing phones, and fills ONLY EMPTY fields — for
//     email/addr/city/zip: `if(!l[k]&&d.row[k]) l[k]=d.row[k]` — i.e. the
//     EXISTING NON-EMPTY VALUE ALWAYS WINS; names are never touched.
//   - undo     (demo line 1108 / rebuild imports.js:156-166): removes only the
//     leads the job CREATED (job.leadIds), keeping any with logged activity;
//     merges are NOT reverted (merged leads were never in leadIds).
//
// This file runs its `it` blocks sequentially and intentionally shares db
// state between them: the five imports build on each other, exactly like five
// real consecutive imports in the app.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

import * as gen from './generate-dataset.ts';

describe('G6 certification — import dedupe/merge/count/undo on 10,000 messy leads (local backend, demo parity)', () => {
  let db: any, nid: any, setMe, state: any, parseCsv: any, handleFile: any, importCheck: any, importRun: any, undoImport: any;
  let dataset: any;
  const saved: any = {};             // original db arrays, restored in afterAll
  const jobs: any[] = [];              // the 5 import jobs, in order
  const wallTimes: any[] = [];         // per-file wall-clock ms
  let usedRealFile: any = null;      // whether handleFile() was driven with a real File
  const EXP = gen.EXPECTED;

  function $(sel: any) { return document.querySelector(sel); }
  const leadsByPhone = (norm: any) => db.leads.filter((l: any) => !l.archived && l.phones.some((p: any) => p.n === norm));
  const leadByPhone = (norm: any) => {
    const hits = leadsByPhone(norm);
    expect(hits.length).toBe(1);
    return hits[0];
  };

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog><input id="iL"><input id="iA"><input type="file" id="fileIn">`;
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.open = true; };
      HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.open = false; };
    }
    await import('../../src/data/persist.js'); // break the seed/fields circular-import cycle first
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const stateMod: any = await import('../../src/core/state.js');
    const importsMod: any = await import('../../src/features/imports.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe; state = stateMod.state;
    parseCsv = importsMod.parseCsv; handleFile = importsMod.handleFile;
    importCheck = importsMod.importCheck; importRun = importsMod.importRun; undoImport = importsMod.undoImport;

    // G6 item 1: regenerate the dataset on disk (the generator is the
    // deliverable; .data/ is reproduced on demand) and keep it in memory.
    dataset = gen.writeAll();

    // Snapshot + clear the arrays this certification owns, so every count
    // below is exact. db here is the in-memory local backend; afterAll
    // restores everything.
    for (const k of ['leads', 'notes', 'imports', 'followUps', 'campaignLeads', 'activities', 'lists', 'members', 'teams']) {
      saved[k] = db[k];
      db[k] = Array.isArray(db[k]) ? [...db[k]] : db[k];
    }
    saved.importCfg = { ...db.settings.importCfg };
    db.leads = []; db.notes = []; db.imports = []; db.followUps = []; db.campaignLeads = []; db.activities = [];

    // Seed the 20 users + 4 teams from dataset.json into the local db.
    db.members = [...db.members, ...dataset.users.map((u: any) => ({ ...u }))];
    db.teams = [...db.teams, ...dataset.teams.map((t: any) => ({ ...t }))];
    setMe(db.members.find((m: any) => m.role === 'owner' && m.active) || db.members[0]);
  });

  afterAll(() => {
    for (const k of ['leads', 'notes', 'imports', 'followUps', 'campaignLeads', 'activities', 'lists', 'members', 'teams']) db[k] = saved[k];
    db.settings.importCfg = saved.importCfg;
    state.importStep = null;
    // Evidence for the certification report: wall-clock time per import.
    // eslint-disable-next-line no-console
    console.log('[G6] import wall-clock times:', wallTimes.map((w) => `${w.file}: ${w.ms}ms (check ${w.checkMs}ms + run ${w.runMs}ms)`).join(' · '),
      `— total ${wallTimes.reduce((a, w) => a + w.ms, 0)}ms; handleFile driven with ${usedRealFile ? 'a real jsdom File object' : 'a {name,text()} stub (jsdom File lacked .text())'}`);
  });

  // ---------------------------------------------------------------- setup facts
  it('uses the demo-default importCfg (incl. maxRows 50000 — far above the 2,280-row files, so nothing truncates)', () => {
    const c = db.settings.importCfg;
    expect(c).toEqual({ phoneSlots: 10, emailSlots: 1, dupPhone: true, dupEmail: true, dupAddress: true, maxRows: 50000, requireName: false, requirePhone: false, flagDnc: true, defaultAssign: '', defaultList: '' });
  });

  it('seeded the local db with the dataset\'s 20 users and 4 teams (covering all 20), and dataset.json holds 10,000 leads + 50,000 activities', () => {
    expect(dataset.users.length).toBe(20);
    expect(dataset.teams.length).toBe(4);
    expect(dataset.leads.length).toBe(10000);
    expect(dataset.activities.length).toBe(50000);
    for (const u of dataset.users) expect(db.members.some((m: any) => m.id === u.id && m.email === u.email)).toBe(true);
    const covered = new Set(dataset.teams.flatMap((t: any) => t.memberIds));
    expect([...covered].sort((a: any, b: any) => a - b)).toEqual(dataset.users.map((u: any) => u.id));
    for (const t of dataset.teams) expect(db.teams.some((x: any) => x.id === t.id)).toBe(true);
    const uids = new Set(db.members.map((m: any) => m.id));
    for (const a of dataset.activities.slice(0, 100)) expect(uids.has(a.userId)).toBe(true);
  });

  it('the generator is deterministic (two runs produce identical CSVs and identical seeded activities)', () => {
    for (let k = 1; k <= 5; k++) expect(gen.buildCsv(k)).toBe(gen.buildCsv(k));
    const a1 = gen.generateActivities(dataset.leads, dataset.users);
    const a2 = gen.generateActivities(dataset.leads, dataset.users);
    expect(JSON.stringify(a1.slice(0, 500))).toBe(JSON.stringify(a2.slice(0, 500)));
    expect(JSON.stringify(a1.at(-1))).toBe(JSON.stringify(a2.at(-1)));
  });

  it('parseCsv drops the deliberately blank rows: raw line counts vs parsed data rows match the generator arithmetic', () => {
    for (const f of EXP.perFile) {
      const text = gen.buildCsv(f.file);
      const rawLines = text.split('\n').filter((l) => l.length).length;
      expect(rawLines).toBe(f.rawLines); // header + data + 5 blank ,,,,-rows
      const parsed = parseCsv(text);
      expect(parsed.length).toBe(1 + f.dataRows); // blanks gone, header kept
    }
  });

  // ---------------------------------------------------------------- the 5 imports
  // Each file is driven through the REAL pipeline entry point: a real jsdom
  // File object into handleFile() (falling back to a {name, text()} stub only
  // if this jsdom's File lacks .text() — which of the two ran is asserted and
  // logged), then importCheck(), dup actions, importRun().
  for (const spec of gen.EXPECTED.perFile) {
    const k = spec.file;
    it(`leads-${k}.csv: auto-maps all 11 columns, checks to ready=${spec.ready}/dups=${spec.dups}/bad=${spec.bad}, imports ${spec.imported} (created ${spec.created}) -> db total ${spec.dbLeadsAfter}`, async () => {
      const text = gen.buildCsv(k);
      const t0 = performance.now();

      let file: any = new File([text], spec.csvName, { type: 'text/csv' });
      if (typeof file.text !== 'function') { file = { name: spec.csvName, text: async () => text }; usedRealFile = false; }
      else if (usedRealFile === null) usedRealFile = true;
      await handleFile(file);

      const s = state.importStep;
      expect(s).toBeTruthy();
      expect(s.step).toBe('map');
      expect(s.file).toBe(spec.csvName);
      expect(s.truncated).toBe(false);           // maxRows 50000 untouched
      expect(s.data.length).toBe(spec.dataRows); // blanks already dropped
      // handleFile's header guesser must map every column of our header.
      expect(s.map).toEqual(['first', 'last', 'phone', 'phone2', 'email', 'addr', 'city', 'state', 'zip', 'note', 'tags']);

      $('#iL').value = ''; // create a new list from the file name (demo default)
      $('#iA').value = ''; // leave unassigned
      const tCheck0 = performance.now();
      await importCheck();
      const checkMs = Math.round(performance.now() - tCheck0);

      expect(s.ready.length).toBe(spec.ready);
      expect(s.dups.length).toBe(spec.dups);
      expect(s.bad.length).toBe(spec.bad);

      if (k >= 2) {
        const targets = gen.overlapTargets(k);
        s.dups.forEach((d: any, j: any) => {
          expect(d.on).toBe('phone');
          expect(d.action).toBe('skip'); // default
          // dups come back in row order == ascending target order, and each
          // matches exactly the lead created for that unique index.
          expect(d.match.phones.some((p: any) => p.n === gen.normOf(gen.phoneDigits(targets[j])))).toBe(true);
          d.action = gen.actionForDupIndex(j); // merge x100, import x10, skip x140
        });
      }

      const tRun0 = performance.now();
      await importRun();
      const runMs = Math.round(performance.now() - tRun0);
      wallTimes.push({ file: spec.csvName, ms: Math.round(performance.now() - t0), checkMs, runMs });

      const job = db.imports[db.imports.length - 1];
      jobs.push(job);
      expect(job.file).toBe(spec.csvName);
      expect(job.rows).toBe(spec.dataRows);
      expect(job.dups).toBe(spec.dups);
      expect(job.imported).toBe(spec.imported);
      expect(job.leadIds.length).toBe(spec.created);
      expect(job.status).toBe('completed');
      // Running total after each file matches the arithmetic exactly.
      expect(db.leads.length).toBe(spec.dbLeadsAfter);
    });
  }

  // ---------------------------------------------------------------- post-import integrity
  it('final unique-lead count is exactly 10,040 = 10,000 unique + 40 forced duplicates, and leads created carry their import job id', () => {
    expect(db.leads.length).toBe(EXP.finalLeads);
    expect(jobs.length).toBe(5);
    const jobIds = new Set(jobs.map((j) => j.id));
    for (const l of db.leads) expect(jobIds.has(l.importId)).toBe(true);
  });

  it('no two non-archived leads share a normalized phone, EXCEPT the exact 40 deliberately forced (action="import") duplicates', () => {
    const count = new Map();
    for (const l of db.leads) {
      if (l.archived) continue;
      for (const p of l.phones) count.set(p.n, (count.get(p.n) || 0) + 1);
    }
    const dupNorms = [...count.entries()].filter(([, c]) => c > 1);
    expect(dupNorms.length).toBe(EXP.forcedPhonePairs); // exactly 40
    for (const [, c] of dupNorms) expect(c).toBe(2);    // each exactly a pair
    const forced = new Set(dataset.forcedPhones.map((f: any) => f.norm));
    expect(new Set(dupNorms.map(([n]) => n))).toEqual(forced);
  });

  it('mixed phone formats of the same number were normalized: every unique lead with a phone holds exactly its +1-normalized form', () => {
    // spot-check across all 5 format variants
    for (const i of [0, 1, 2, 3, 4, 2500, 5001, 7502, 9003, 9999]) {
      const L = gen.makeLead(i);
      if (!L.phoneNorm) continue;
      const hits = leadsByPhone(L.phoneNorm);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].phones[0].n).toBe(L.phoneNorm);
    }
  });

  it('unicode names, a 5,000-char note, a 500-char address, an emoji note and a leading-"=" note all survived byte-exact', () => {
    const byUid = (i: any) => leadByPhone(gen.makeLead(i).phoneNorm);
    expect(byUid(3).first).toBe('Zoë'); expect(byUid(3).last).toBe('Åström');
    expect(byUid(4).first).toBe('李'); expect(byUid(4).last).toBe('雷');
    expect(byUid(5).last).toBe('Muñoz-Ferreira');
    expect(byUid(6).first).toBe('Ólafur'); expect(byUid(6).last).toBe('Þórðarson');

    const noteOf = (lead: any) => db.notes.find((n: any) => n.leadId === lead.id)?.text;
    const longNoteLead = byUid(10);
    expect(noteOf(longNoteLead)).toBe(gen.LONG_NOTE);
    expect(noteOf(longNoteLead).length).toBe(5000);
    const longAddrLead = byUid(11);
    expect(longAddrLead.addr).toBe(gen.LONG_ADDR);
    expect(longAddrLead.addr.length).toBe(500);
    expect(noteOf(byUid(12))).toBe(gen.FORMULA_NOTE); // leading "=" kept as plain data
    expect(noteOf(byUid(12)).startsWith('=')).toBe(true);
    expect(noteOf(byUid(13))).toBe(gen.EMOJI_NOTE);   // emoji intact
  });

  it('name-only and phone-only rows imported as leads (requireName/requirePhone are off in the demo defaults)', () => {
    // ready order == data order, so file 1 offsets index straight into job 1's leadIds
    const nameOnly = db.leads.find((l: any) => l.id === jobs[0].leadIds[7]);
    expect(nameOnly.first).toBe(gen.makeLead(7).first);
    expect(nameOnly.last).toBe(gen.makeLead(7).last);
    expect(nameOnly.phones.length).toBe(0);
    expect(nameOnly.email).toBe('');
    const phoneOnly = db.leads.find((l: any) => l.id === jobs[0].leadIds[8]);
    expect(phoneOnly.first).toBe('');
    expect(phoneOnly.last).toBe('');
    expect(phoneOnly.phones.map((p: any) => p.n)).toEqual([gen.makeLead(8).phoneNorm]);
  });

  it('every one of the 400 merges kept existing non-empty fields (demo rule: fill-blanks-only — existing values ALWAYS win), filled only empty ones, and unioned phones without duplicates', () => {
    expect(dataset.expectedMerges.length).toBe(EXP.mergesTotal);
    for (const em of dataset.expectedMerges) {
      const lead = leadByPhone(em.phones[0]);
      expect(lead.first).toBe(em.first);              // merge never touches names ("-Updated" row name discarded)
      expect(lead.last).toBe(em.last);
      expect(lead.email).toBe(em.email);              // original kept when non-empty; filled when empty
      expect(lead.addr).toBe(em.addr);                // conflicting "999 Should Not Overwrite St" discarded
      expect(lead.city).toBe(em.city);                // "Mergetown" only where city was empty
      expect(lead.zip).toBe(em.zip);                  // conflicting "00000" discarded
      expect(lead.phones.map((p: any) => p.n)).toEqual(em.phones); // union, original first, no dupes
      expect(new Set(lead.phones.map((p: any) => p.n)).size).toBe(lead.phones.length);
    }
  });

  it('byte-exact deep check of 5 known merged leads (file 2 merges into file 1 leads), incl. list membership of both imports', () => {
    const targets = gen.overlapTargets(2).slice(0, 5); // unique indices 250..254
    for (const t of targets) {
      const em = dataset.expectedMerges.find((m: any) => m.t === t);
      const lead = leadByPhone(em.phones[0]);
      expect({
        first: lead.first, last: lead.last, email: lead.email, addr: lead.addr,
        city: lead.city, zip: lead.zip, phones: lead.phones,
        listIds: lead.listIds, assigned: lead.assigned, status: lead.status,
        source: lead.source, importId: lead.importId, archived: lead.archived,
      }).toEqual({
        first: em.first, last: em.last, email: em.email, addr: em.addr,
        city: em.city, zip: em.zip,
        phones: [{ n: em.phones[0], type: 'mobile' }, { n: em.phones[1], type: 'other' }],
        listIds: [jobs[0].listId, jobs[1].listId], // created by file 1's list, merged into file 2's
        assigned: null, status: 'new', source: 'import', importId: jobs[0].id, archived: false,
      });
    }
    // sanity on the fill-direction split inside those 5: t=250 had no email
    // (250%5===0) so it was filled; t=251..254 kept their original email;
    // t=253 had an empty city (253%10===3) so it got "Mergetown".
    expect(leadByPhone(gen.normOf(gen.phoneDigits(250))).email).toBe('mfill250@merged.example.com');
    expect(leadByPhone(gen.normOf(gen.phoneDigits(251))).email).toBe('lead251@example.com');
    expect(leadByPhone(gen.normOf(gen.phoneDigits(253))).city).toBe('Mergetown');
    expect(leadByPhone(gen.normOf(gen.phoneDigits(254))).city).toBe(gen.makeLead(254).city);
  });

  // ---------------------------------------------------------------- undo
  it('undoImport() on the last job removes exactly its created leads minus the 3 with activities, reverts NO merge, and leaves the earlier 4 imports untouched (demo parity)', () => {
    const job5 = jobs[4];
    expect(job5.leadIds.length).toBe(EXP.undo.jobLeadIds); // 2010 = 2000 fresh + 10 forced

    // Give 3 known file-5 leads logged activity so undo must keep them.
    const keepIds = [job5.leadIds[0], job5.leadIds[500], job5.leadIds[1999]];
    for (const lid of keepIds) {
      db.activities.push({ id: nid(), leadId: lid, type: 'call', outcomeId: 1, userId: db.members[0].id, at: new Date().toISOString(), note: '', listId: job5.listId, campaignId: null, durationMin: 1 });
    }
    const before = db.leads.length;
    expect(before).toBe(EXP.finalLeads);
    const earlierIds = jobs.slice(0, 4).flatMap((j) => j.leadIds);
    expect(earlierIds.length).toBe(8030);

    // Drive the real confirm dialog programmatically.
    undoImport(job5.id);
    const confirmBtn = $('#cYes');
    expect(confirmBtn).toBeTruthy();
    confirmBtn.click();

    expect(job5.status).toBe('undone');
    expect($('#toast').textContent).toBe(`Undone · ${EXP.undo.kept} worked leads kept`); // kept count = 3
    expect(db.leads.length).toBe(EXP.undo.finalLeads); // 10040 - 2007 = 8033
    expect(before - db.leads.length).toBe(EXP.undo.removed);

    const present = new Set(db.leads.map((l: any) => l.id));
    for (const lid of keepIds) expect(present.has(lid)).toBe(true); // the 3 worked leads survive
    const removedIds = job5.leadIds.filter((lid: any) => !keepIds.includes(lid));
    expect(removedIds.length).toBe(EXP.undo.removed);
    for (const lid of removedIds) expect(present.has(lid)).toBe(false); // every other job-5 lead is gone
    // ...and their dependent rows are gone too.
    const removedSet = new Set(removedIds);
    expect(db.notes.some((n: any) => removedSet.has(n.leadId))).toBe(false);
    expect(db.followUps.some((f: any) => removedSet.has(f.leadId))).toBe(false);
    expect(db.campaignLeads.some((c: any) => removedSet.has(c.leadId))).toBe(false);

    // NO lead from the earlier 4 imports was touched — full count plus id check.
    for (const lid of earlierIds) expect(present.has(lid)).toBe(true);
    expect(db.leads.length).toBe(earlierIds.length + keepIds.length); // 8030 + 3

    // Demo parity: undo removes only created leads; merges are NOT reverted.
    // File 5's 100 merges went into file-4 leads — still present, still merged.
    for (const em of dataset.expectedMerges.filter((m: any) => m.mergedByFile === 5)) {
      const lead = leadByPhone(em.phones[0]);
      expect(lead.email).toBe(em.email);
      expect(lead.city).toBe(em.city);
      expect(lead.phones.map((p: any) => p.n)).toEqual(em.phones); // merged-in 2nd phone still there
      expect(lead.listIds).toContain(job5.listId);            // merged-in list membership still there
    }
  });

  it('the first 4 import jobs remain completed with their exact recorded counts', () => {
    for (let k = 1; k <= 4; k++) {
      const spec = EXP.perFile[k - 1];
      expect(jobs[k - 1].status).toBe('completed');
      expect(jobs[k - 1].imported).toBe(spec.imported);
      expect(jobs[k - 1].dups).toBe(spec.dups);
      expect(jobs[k - 1].rows).toBe(spec.dataRows);
    }
  });
});
