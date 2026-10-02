// G6 item 1 — deterministic messy-dataset generator for the import-pipeline
// certification (tests/certification/import-integrity.test.ts) and reusable
// by the later export round-trip test.
//
// Runnable standalone:   node tests/certification/generate-dataset.ts
// Importable:            import * as gen from './generate-dataset.ts'
//
// Produces into tests/certification/.data/ :
//   dataset.json        { users:[20], teams:[4], leads:[10000], activities:[50000], ... }
//   leads-1.csv … leads-5.csv
//
// ---------------------------------------------------------------- overlap arithmetic
// 10,000 unique leads, indices i = 0..9999 ("uid" U0000..U9999).
// File k (k = 1..5) contains, in this order:
//   - its own 2,000 fresh unique leads: indices (k-1)*2000 .. k*2000-1,
//     with 5 fully-blank CSV rows sprinkled among them (parseCsv drops those);
//   - for k >= 2, an overlap block of 250 rows re-presenting file k-1's fresh
//     leads at offsets 250..499 of that file's range (absolute indices
//     (k-2)*2000+250 .. (k-2)*2000+499), with the same phone in a DIFFERENT
//     format (normPhone-equal), a brand-new second phone, a different last
//     name ("-Updated"), a fill-in email, and conflicting addr/city/zip —
//     these all match the existing lead on phone and land in dups[].
//     The test sets dup actions by position j in the dups array:
//       j =   0.. 99  (targets offset 250..349) -> action "merge"   (100 rows)
//       j = 100..109  (targets offset 350..359) -> action "import"  ( 10 rows, forced duplicates)
//       j = 110..249  (targets offset 360..499) -> action "skip"    (140 rows, default)
//   - 30 within-file exact duplicates of the file's own fresh rows at offsets
//     100..129 (same phone, different format) -> bad[] (within-file key dedupe).
//
// Expected per-file outcome (importCfg defaults: dupPhone+dupEmail+dupAddress
// all true; every row's dedupe key is its first phone because emails and
// addresses are unique by construction):
//   file 1:  dataRows 2030 (2000 fresh + 30 within-dups; 5 blanks dropped)
//            ready 2000, dups 0,   bad 30 -> imported 2000, created 2000
//   file 2-5: dataRows 2280 (2000 fresh + 250 overlap + 30 within-dups)
//            ready 2000, dups 250, bad 30 -> imported 2110 (2000 ready + 10
//            forced + 100 merges), created 2010 (leadIds; merges create none)
// Running db.leads totals: 2000, 4010, 6020, 8030, 10040.
// Final: 10,040 leads = 10,000 unique + 40 deliberately forced duplicates
// (4 files x 10), the ONLY normalized-phone collisions allowed.
// Undo of file 5 (leadIds 2010, 3 given activities): removes 2007, keeps 3,
// final db.leads = 8033; the 100 file-5 merges are NOT reverted (demo parity).
//
// Lead-level mess (all deterministic by index i):
//   - phone formats cycle: "(AAA) BBB-CCCC", "AAA-BBB-CCCC", "+1AAABBBCCCC",
//     "AAA.BBB.CCCC", "AAABBBCCCC" (variant = i % 5); overlap/dup rows use a
//     shifted variant so the raw text differs but normPhone is identical.
//   - missing emails: i % 5 === 0 (2,000) plus the 10 name-only and 10
//     phone-only rows = 2,020 of 10,000 (~20.2%).
//   - name-only rows (no phone/email/addr): i % 1000 === 7  (10 rows).
//   - phone-only rows (no name/email/addr): i % 1000 === 8  (10 rows).
//   - empty city (merge fill target): i % 10 === 3.
//   - unicode names at i = 3,4,5,6; emoji note at i = 13; 5,000-char note at
//     i = 10; 500-char street address at i = 11; leading "=" note at i = 12.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SEED = 42;

export function mulberry32(a: any) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CONFIG = {
  N_UNIQUE: 10000, FILES: 5, FRESH_PER_FILE: 2000,
  OVERLAP: 250, MERGE: 100, FORCE_IMPORT: 10, SKIP: 140,
  WITHIN_DUPS: 30, BLANKS: 5,
};

// ---------------------------------------------------------------- phones
const AREAS = ['404', '470', '678', '770', '312', '212', '415', '206'];
export const phoneDigits = (i: any) => AREAS[i % AREAS.length] + String(2000000 + i); // 10 digits, unique per i
export const mergePhoneDigits = (i: any) => AREAS[(i + 3) % AREAS.length] + String(3000000 + i); // merge-appended 2nd phone
export const normOf = (d10: any) => '+1' + d10; // what src/core/util.js normPhone() yields
export function fmtPhone(d10: any, variant: any) {
  const a = d10.slice(0, 3), b = d10.slice(3, 6), c = d10.slice(6);
  switch (((variant % 5) + 5) % 5) {
    case 0: return `(${a}) ${b}-${c}`;
    case 1: return `${a}-${b}-${c}`;
    case 2: return `+1${d10}`;
    case 3: return `${a}.${b}.${c}`;
    default: return d10;
  }
}

// ---------------------------------------------------------------- identity pools
const FIRSTS = ['Jordan', 'Casey', 'Angela', 'Marcus', 'Denise', 'Robert', 'Sharon', 'Kevin', 'Latoya', 'Thomas',
  'Priya', 'William', 'Monica', 'Jerome', 'Brianna', 'Samuel', 'Aaliyah', 'Diego', 'Yuki', 'Fatima',
  'Lars', 'Chidi', 'Ingrid', 'Mateo', 'Noor', 'Dmitri', 'Keisha', 'Hiro', 'Svetlana', 'Omar'];
const LASTS = ['Miles', 'Brooks', 'Ruiz', 'Bell', 'Okafor', 'Nguyen', 'Whitfield', 'Patel', 'Green', 'Reed',
  'Shah', 'Foster', 'Alvarez', 'Hicks', 'Cole', 'Ortiz', 'Kim', 'Haddad', 'Novak', 'Mbeki',
  'Lindqvist', 'Tanaka', 'Castillo', 'Petrov', 'Osei', 'Fernandez', 'Walsh', 'Yamamoto', 'Dubois', 'Khan'];
const CITIES = ['Atlanta', 'Decatur', 'Marietta', 'Roswell', 'Smyrna', 'Sandy Springs', 'Alpharetta', 'Duluth', 'Kennesaw'];
const STREETS = ['Peachtree Ln', 'Ridge Ave', 'Oak Hollow Dr', 'Mill Creek Ct', 'Lenox Pointe', 'Glenwood Ave',
  'Powers Ferry Rd', 'Johnson Ferry', 'Howell Mill Rd', 'Church St', 'Ansley Walk', 'Canton Rd', 'Highland Ave'];
const STATES = ['GA', 'GA', 'GA', 'GA', 'TN', 'AL', 'FL', 'NC'];

// 5,000-char note, with commas and doubled-quote-worthy quotes (CSV-quoted).
// Deliberately free of \bdnc\b / "do not call" so flagDnc never fires on it.
const NOTE_CHUNK = 'Owner said, "price it right, then we talk" — spoke at length about comps, timing, and the spring market; follow-up pending. ';
export const LONG_NOTE = NOTE_CHUNK.repeat(Math.ceil(5000 / NOTE_CHUNK.length)).slice(0, 5000);
export const LONG_ADDR = ('1142 ' + 'Extraordinarily Long Carriageway of the Seventeenth Addition '.repeat(10)).slice(0, 500);
export const EMOJI_NOTE = 'Met at open house 🏠🔥 — very motivated to sell 😊';
export const FORMULA_NOTE = '=SUM(A1:A10) looks like a spreadsheet formula but is just lead data';

export const isNameOnly = (i: any) => i % 1000 === 7;
export const isPhoneOnly = (i: any) => i % 1000 === 8;
export const hasEmail = (i: any) => i % 5 !== 0 && !isNameOnly(i) && !isPhoneOnly(i);
export const cityEmpty = (i: any) => i % 10 === 3;

const UNICODE_NAMES: any = { 3: ['Zoë', 'Åström'], 4: ['李', '雷'], 5: ['José', 'Muñoz-Ferreira'], 6: ['Ólafur', 'Þórðarson'] };

export function makeLead(i: any) {
  const uid = 'U' + String(i).padStart(4, '0');
  const file = Math.floor(i / CONFIG.FRESH_PER_FILE) + 1;
  let first = FIRSTS[(i * 17 + 3) % FIRSTS.length];
  let last = LASTS[(i * 31 + 7) % LASTS.length];
  if (UNICODE_NAMES[i]) [first, last] = UNICODE_NAMES[i];
  const nameOnly = isNameOnly(i), phoneOnly = isPhoneOnly(i);
  if (phoneOnly) { first = ''; last = ''; }
  const d10 = nameOnly ? null : phoneDigits(i);
  let note = '';
  if (i === 10) note = LONG_NOTE;
  else if (i === 12) note = FORMULA_NOTE;
  else if (i === 13) note = EMOJI_NOTE;
  let addr = nameOnly || phoneOnly ? '' : `${100 + i} ${STREETS[i % STREETS.length]}`;
  if (i === 11) addr = LONG_ADDR;
  return {
    i, uid, file, first, last,
    phoneRaw: d10 ? fmtPhone(d10, i) : '',
    phoneDigits: d10 || '',
    phoneNorm: d10 ? normOf(d10) : '',
    email: hasEmail(i) ? `lead${i}@example.com` : '',
    addr,
    city: nameOnly || phoneOnly || cityEmpty(i) ? '' : CITIES[i % CITIES.length],
    state: nameOnly || phoneOnly ? '' : STATES[i % STATES.length],
    zip: nameOnly || phoneOnly ? '' : String(10000 + (i % 89999)),
    note,
    tags: i % 97 === 0 ? 'hot lead' : '',
    nameOnly, phoneOnly,
  };
}

export function generateLeads() {
  return Array.from({ length: CONFIG.N_UNIQUE }, (_, i) => makeLead(i));
}

// ---------------------------------------------------------------- users / teams / activities
export function generateUsers() {
  const roles = ['manager', 'agent', 'agent', 'agent', 'agent'];
  return Array.from({ length: 20 }, (_, n) => ({
    id: 101 + n,
    name: `${FIRSTS[(n * 3 + 1) % FIRSTS.length]} ${LASTS[(n * 7 + 2) % LASTS.length]}`,
    email: `user${101 + n}@thebggroupreal.com`,
    role: roles[n % 5],
    active: true,
  }));
}

export function generateTeams(users: any) {
  const colors = ['#2F6FEB', '#2E9E6B', '#C2581C', '#7A4FD6'];
  return Array.from({ length: 4 }, (_, t) => {
    const memberIds = users.slice(t * 5, t * 5 + 5).map((u: any) => u.id); // 4 x 5 covers all 20
    return {
      id: 201 + t, name: `Cert Team ${t + 1}`, description: 'G6 certification team', color: colors[t],
      logo: null, managerId: memberIds[0], memberIds, listIds: [], campaignIds: [],
      archived: false, createdAt: '2026-09-01T00:00:00.000Z',
    };
  });
}

export function generateActivities(leads: any, users: any) {
  const rnd = mulberry32(SEED);
  const types = ['call', 'call', 'call', 'text', 'door_knock'];
  const acts = new Array(50000);
  const base = Date.parse('2026-09-30T12:00:00Z');
  for (let n = 0; n < 50000; n++) {
    const type = types[Math.floor(rnd() * types.length)];
    acts[n] = {
      id: 'A' + String(n).padStart(5, '0'),
      leadUid: leads[Math.floor(rnd() * leads.length)].uid,
      userId: users[Math.floor(rnd() * users.length)].id,
      type,
      outcomeId: 1 + Math.floor(rnd() * 8),
      at: new Date(base - Math.floor(rnd() * 60 * 86400000)).toISOString(),
      durationMin: type === 'call' ? Math.floor(rnd() * 5) : null,
    };
  }
  return acts;
}

// ---------------------------------------------------------------- overlap / CSV construction
export function overlapTargets(k: any) { // k = 2..5 -> ascending absolute indices; position j in dups[] = targets[j]
  const base = (k - 2) * CONFIG.FRESH_PER_FILE;
  return Array.from({ length: CONFIG.OVERLAP }, (_, j) => base + 250 + j);
}
export const actionForDupIndex = (j: any) => (j < CONFIG.MERGE ? 'merge' : j < CONFIG.MERGE + CONFIG.FORCE_IMPORT ? 'import' : 'skip');

/** The overlap CSV row re-presenting unique lead t (same person, newer messier data). */
export function overlapRow(t: any, action: any) {
  const L = makeLead(t);
  return {
    first: L.first,
    last: L.last + '-Updated',                       // merge must NOT touch names
    phone1: fmtPhone(phoneDigits(t), t + 1),         // same number, different format
    phone2: action === 'merge' ? fmtPhone(mergePhoneDigits(t), t + 2) : '', // union-append on merge
    email: action === 'import' ? `forced${t}@example.com` : `mfill${t}@merged.example.com`,
    // Unique per target: forced-import rows CREATE leads carrying this addr,
    // and a shared constant here would make later files' overlap rows match
    // those earlier forced leads on "address + ZIP" instead of their real
    // target on phone (the db-match loop takes the first lead matching ANY rule).
    addr: `99${t} Should Not Overwrite St`,          // existing non-empty addr must win
    city: 'Mergetown',                               // fills only if original city was empty (t % 10 === 3)
    state: 'GA',
    zip: '00000',                                    // existing non-empty zip must win
    note: '', tags: '',
  };
}

/** Expected post-merge state of each merge target: demo rule = fill ONLY empty
 * fields (existing non-empty values always win), union phones, name untouched. */
export function expectedMergeStates() {
  const out: any[] = [];
  for (let k = 2; k <= CONFIG.FILES; k++) {
    overlapTargets(k).slice(0, CONFIG.MERGE).forEach((t) => {
      const L = makeLead(t);
      out.push({
        mergedByFile: k, t, uid: L.uid,
        first: L.first, last: L.last,                               // unchanged
        email: L.email ? L.email : `mfill${t}@merged.example.com`,  // fill only if empty (t % 5 === 0)
        addr: L.addr,                                               // original wins (always non-empty here)
        city: L.city ? L.city : 'Mergetown',                        // fill only if empty (t % 10 === 3)
        zip: L.zip,                                                 // original wins
        phones: [normOf(phoneDigits(t)), normOf(mergePhoneDigits(t))], // union, no dupes
      });
    });
  }
  return out;
}

export function forcedPhoneNorms() { // the only normalized phones allowed on 2 leads
  const out: any[] = [];
  for (let k = 2; k <= CONFIG.FILES; k++) {
    overlapTargets(k).slice(CONFIG.MERGE, CONFIG.MERGE + CONFIG.FORCE_IMPORT)
      .forEach((t) => out.push({ file: k, t, norm: normOf(phoneDigits(t)) }));
  }
  return out;
}

export const CSV_HEADER = ['First Name', 'Last Name', 'Phone 1', 'Phone 2', 'Email', 'Address', 'City', 'State', 'ZIP', 'Notes', 'Tags'];

export function csvEscape(v: any) {
  v = String(v ?? '');
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
const rowToLine = (cells: any) => cells.map(csvEscape).join(',');

export function buildCsv(k: any) {
  const lines = [rowToLine(CSV_HEADER)];
  const start = (k - 1) * CONFIG.FRESH_PER_FILE;
  const blankAfter = new Set([100, 500, 900, 1300, 1700]); // 5 blank rows, dropped by parseCsv
  for (let off = 0; off < CONFIG.FRESH_PER_FILE; off++) {
    const L = makeLead(start + off);
    lines.push(rowToLine([L.first, L.last, L.phoneRaw, '', L.email, L.addr, L.city, L.state, L.zip, L.note, L.tags]));
    if (blankAfter.has(off)) lines.push(',,,,,,,,,,');
  }
  if (k >= 2) {
    overlapTargets(k).forEach((t, j) => {
      const r = overlapRow(t, actionForDupIndex(j));
      lines.push(rowToLine([r.first, r.last, r.phone1, r.phone2, r.email, r.addr, r.city, r.state, r.zip, r.note, r.tags]));
    });
  }
  for (let d = 0; d < CONFIG.WITHIN_DUPS; d++) { // dup of this file's own fresh row at offset 100+d
    const orig = start + 100 + d;
    lines.push(rowToLine(['Dupe', 'WithinFile', fmtPhone(phoneDigits(orig), orig + 2), '', '', '', '', '', '', '', '']));
  }
  return lines.join('\n') + '\n';
}

export const EXPECTED = {
  perFile: Array.from({ length: CONFIG.FILES }, (_, x) => {
    const k = x + 1, overlap = k >= 2 ? CONFIG.OVERLAP : 0;
    const imported = CONFIG.FRESH_PER_FILE + (k >= 2 ? CONFIG.FORCE_IMPORT + CONFIG.MERGE : 0);
    const created = CONFIG.FRESH_PER_FILE + (k >= 2 ? CONFIG.FORCE_IMPORT : 0);
    return {
      file: k, csvName: `leads-${k}.csv`,
      rawLines: 1 + CONFIG.FRESH_PER_FILE + overlap + CONFIG.WITHIN_DUPS + CONFIG.BLANKS,
      dataRows: CONFIG.FRESH_PER_FILE + overlap + CONFIG.WITHIN_DUPS,
      ready: CONFIG.FRESH_PER_FILE, dups: overlap, bad: CONFIG.WITHIN_DUPS,
      imported, created,
      dbLeadsAfter: k * CONFIG.FRESH_PER_FILE + (k >= 2 ? (k - 1) * CONFIG.FORCE_IMPORT : 0),
    };
  }),
  finalLeads: 10040,          // 10,000 unique + 40 forced duplicates
  forcedPhonePairs: 40,
  mergesTotal: 400,           // 4 files x 100
  undo: { jobLeadIds: 2010, kept: 3, removed: 2007, finalLeads: 8033 },
};

// ---------------------------------------------------------------- assembly + IO
export function generateDataset() {
  const users = generateUsers();
  const teams = generateTeams(users);
  const leads = generateLeads();
  const activities = generateActivities(leads, users);
  return {
    seed: SEED, config: CONFIG, users, teams, leads, activities,
    expected: EXPECTED, expectedMerges: expectedMergeStates(), forcedPhones: forcedPhoneNorms(),
  };
}

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');

export function writeAll() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const ds = generateDataset();
  fs.writeFileSync(path.join(DATA_DIR, 'dataset.json'), JSON.stringify(ds));
  for (let k = 1; k <= CONFIG.FILES; k++) {
    fs.writeFileSync(path.join(DATA_DIR, `leads-${k}.csv`), buildCsv(k));
  }
  return ds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ds = writeAll();
  console.log(`Wrote ${DATA_DIR}`);
  console.log(`  dataset.json: ${ds.users.length} users, ${ds.teams.length} teams, ${ds.leads.length} leads, ${ds.activities.length} activities`);
  for (const f of EXPECTED.perFile) {
    console.log(`  ${f.csvName}: ${f.rawLines} raw lines -> ${f.dataRows} data rows (ready ${f.ready}, dups ${f.dups}, bad ${f.bad}) -> imported ${f.imported}, created ${f.created}, db total ${f.dbLeadsAfter}`);
  }
}
