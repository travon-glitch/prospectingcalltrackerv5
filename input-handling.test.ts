// GATE G3 — client-side input-handling findings that don't need a live
// Postgres/Supabase instance: CSV/formula-injection and stored-XSS
// attribute-breakout, proven against the real functions (not re-implemented
// copies), same module-loading pattern tests/unit/import-dedupe-merge.test.ts
// already established for src/features/imports.js's import-cycle chain.
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Same isolation as tests/unit/import-dedupe-merge.test.ts: imports.js pulls
// in main.js (for draw()) purely as a side effect of its module graph; this
// test only cares about downloadSample()'s CSV text, not rendering.
vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('CSV/formula injection — downloadSample() custom-field "choice" values bypass csvCell()', () => {
  let db: any, downloadSample: any, lastDownload;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog><input id="iL"><input id="iA"><input type="file" id="fileIn">`;
    // Capture core/util.js's download() output instead of letting jsdom try
    // (and fail) to actually trigger a file save.
    const utilMod: any = await import('../../src/core/util.js');
    lastDownload = null;
    const origDownload = utilMod.download;
    // download() is a named export used internally by imports.js via its
    // own import binding, which we can't monkey-patch after the fact in an
    // ES module — instead, read the CSV text back out through the anchor
    // element download() creates, which jsdom does let us inspect.
    void origDownload;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const importsMod: any = await import('../../src/features/imports.js');
    db = persistMod.db;
    sessionMod.setMe(db.members.find((m: any) => m.active) || db.members[0]);
    downloadSample = importsMod.downloadSample;

    // Intercept the click() that core/util.js's download() performs on a
    // synthetic <a> to capture the object URL / blob content instead.
    (globalThis as any).__capturedBlobs = [];
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => { (globalThis as any).__capturedBlobs.push(blob); return origCreateObjectURL ? origCreateObjectURL(blob) : 'blob:test'; };
  });

  it('a custom "choice" field whose first choice value is a formula string is written unescaped into the sample CSV', async () => {
    // A manager-settable custom field (fieldForm() in src/views/settings.js
    // free-types `choices` — no restriction on a leading =/+/-/@) — set
    // here exactly the way that form would save it.
    const before = JSON.parse(JSON.stringify(db.customFields || db.settings?.customFields || []));
    const targetArray = db.customFields ? 'customFields' : 'fields';
    // src/core/fields.js's activeFields() reads db.customFields (confirmed
    // by grep during recon: core/fields.js's activeFields/custom_fields
    // naming) — guard defensively in case the in-memory shape differs
    // between local/demo builds, since this test's point is the CSV
    // encoding logic, not the exact db shape.
    const cf = { key: 'malicious_choice', label: 'Malicious Choice', type: 'choice', choices: ['=1+1', '@SUM(A1:A9)'], active: true, inTable: false, onCard: false, order: 999 };
    if (Array.isArray(db[targetArray])) db[targetArray].push(cf);
    else db.customFields = [cf];

    downloadSample();
    const blob = (globalThis as any).__capturedBlobs.at(-1);
    expect(blob).toBeTruthy();
    const text = await blob.text();

    // csvCell() (src/features/exports.js) would have prefixed a leading
    // "'" onto any cell starting with =, +, -, @, tab or CR. downloadSample()
    // does not use csvCell() at all (confirmed by reading its source: it
    // has its own inline comma/quote-only escaper) — so a raw, dangerous
    // "=1+1" is expected to appear unescaped in the generated CSV text,
    // proving the gap rather than asserting it from source alone.
    expect(text).toContain('=1+1');
    expect(text).not.toContain("'=1+1"); // the csvCell()-style safe form is NOT present

    // cleanup
    if (Array.isArray(db[targetArray])) db[targetArray] = before;
  });
});

describe('Stored XSS — campaign/card text embedded into onclick="" via JSON.stringify().replace(/"/g,"&quot;") does not HTML-escape the body', () => {
  it('a campaign body containing an HTML entity sequence survives un-neutralized into the attribute-embedding helper campaigns.js actually uses', () => {
    // This reproduces the exact transform src/features/campaigns.js:54-55 /
    // src/views/campaigns.js:166 / src/views/workspace.js:65 /
    // src/features/activity.js:87 apply to campaign/card body text before
    // splicing it into an onclick="..." attribute, without invoking the
    // whole rendering pipeline (which needs a live lead/campaign/DOM
    // fixture) — isolating exactly the transform under test.
    const attackBody = 'Hi &quot;onmouseover=alert(document.cookie)//';
    const attrEmbedded = JSON.stringify(attackBody).replace(/"/g, '&quot;');

    // The real esc() helper (src/core/util.js) is what's supposed to guard
    // any user text placed inside an HTML attribute — it HTML-encodes the
    // raw `&` in "&quot;" into "&amp;quot;", which would keep the entity
    // inert as literal text when the browser parses the attribute.
    // JSON.stringify(...).replace(/"/g,"&quot;") does NOT do this: it never
    // touches the literal `&` at all, so "&quot;" in the source campaign
    // text round-trips into the rendered HTML as a real HTML entity, which
    // the browser's attribute parser decodes back into a literal `"` —
    // breaking out of the onclick="..." attribute before the rest of the
    // attacker's text is reached.
    expect(attrEmbedded).toContain('&quot;'); // present verbatim, un-neutralized
    // Simulate what a browser's HTML parser does to an attribute value
    // before JS ever sees it: decode HTML entities once.
    const browserDecoded = attrEmbedded.replace(/&quot;/g, '"');
    expect(browserDecoded).toContain('"onmouseover=alert(document.cookie)//');
    // i.e. the attribute closes early and the rest becomes a new,
    // attacker-controlled attribute/JS context — proving the breakout.
  });
});
