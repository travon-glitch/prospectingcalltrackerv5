// Stage 14 fix #3: exportCrm()'s per-deal row (features/crm.js) had a
// stray extra "" cell right after the "Overdue" value, so every column
// from "Days in stage" onward was shifted one to the right of its own
// header. This locks the row shape to the header shape for every non-
// forecast `what` mode, so the two can never drift apart again silently.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

// download() (core/util.js) needs a real anchor click / Blob URL, which
// jsdom doesn't fully implement — capture what exportCrm() would have
// downloaded instead of going through the DOM, keeping everything else
// util.js exports (toast, $, ...) real.
const downloadedCsvs: any[] = [];
vi.mock('../../src/core/util.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, download: (name: any, text: any) => downloadedCsvs.push({ name, text }) };
});

/** Splits one CSV row on commas outside quotes, matching csvCell()'s own
 * escaping (features/exports.js) — a naive `.split(',')` would miscount a
 * quoted cell containing a comma. */
function splitCsvRow(line: any){
  const cells = []; let cur = ''; let inQ = false;
  for(let i=0;i<line.length;i++){
    const c = line[i];
    if(inQ){
      if(c === '"'){ if(line[i+1] === '"'){ cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if(c === '"') inQ = true;
      else if(c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

describe('exportCrm() — row/header column count', () => {
  let db: any, nid, setMe, exportCrm: any, pipelines: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog><dialog id="dlg2"></dialog>`;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const crmMod: any = await import('../../src/features/crm.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe;
    exportCrm = crmMod.exportCrm; pipelines = crmMod.pipelines;
    setMe(db.members.find((m: any) => m.active) || db.members[0]);
  });

  it('every deal row has exactly as many cells as the header, for every non-forecast mode', async () => {
    const p = pipelines()[0];
    expect(db.deals.length).toBeGreaterThan(0); // seed.js ships deals already in this pipeline
    for (const what of ['pipeline', 'stage', 'agent', 'closed', 'lost', 'followups']) {
      downloadedCsvs.length = 0;
      const stageId = p.stages[0].id;
      const agentId = db.deals[0].assigned;
      await exportCrm(what, p.id, stageId, agentId);
      expect(downloadedCsvs.length).toBe(1);
      // eslint-disable-next-line no-irregular-whitespace -- deliberately matching the UTF-8 BOM exportCsv() prepends
      const lines = downloadedCsvs[0].text.replace(/^﻿/, '').split('\r\n');
      const headerCols = splitCsvRow(lines[0]).length;
      for (const line of lines.slice(1)) {
        if (!line) continue;
        expect(splitCsvRow(line).length).toBe(headerCols);
      }
    }
  });
});
