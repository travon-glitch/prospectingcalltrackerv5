// Stage 15 e2e: import sample CSV (src/features/imports.js /
// src/views/imports.js's three-step wizard: pick file → map columns →
// check duplicates → import).
//
// There's no shipped sample-leads.csv fixture in the repo — downloadSample()
// (imports.js) generates one on the fly in the browser rather than reading
// a static file — so this spec ships its own tiny fixture at
// tests/e2e/fixtures/sample-leads.csv using the exact headers imports.js
// recognizes (First Name, Last Name, Phone 1, Email, Address, City, State,
// ZIP, Notes) with phone numbers that don't collide with the seed data.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { confirmAction, loginAsDemo, OWNER } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV = path.join(__dirname, 'fixtures', 'sample-leads.csv');

test.beforeEach(async ({ page }) => {
  // Importing requires the `import` permission, which the seed's agent
  // role doesn't carry (src/data/seed.js's AGENT_BASE) — sign in as the
  // owner, who has every permission.
  await loginAsDemo(page, OWNER);
});

test('importing a CSV adds its rows as new leads', async ({ page }) => {
  const before = await page.evaluate(() => (window as any).db.leads.length);

  await page.goto('/#imports');
  await page.locator('#fileIn').setInputFiles(SAMPLE_CSV);

  await expect(page.locator('h2')).toContainText('Match columns');
  // The recognized header names auto-map, so the mapping step needs no
  // changes — go straight to duplicate checking.
  await page.getByRole('button', { name: 'Next: check duplicates ›' }).click();

  await expect(page.locator('h2')).toContainText('Check duplicates');
  await page.getByRole('button', { name: /^Import \d+ leads?$/ }).click();

  await expect(page.locator('.toast')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).db.leads.length))
    .toBeGreaterThanOrEqual(before + 2);

  const imported = await page.evaluate(() =>
    (window as any).db.leads.filter((l: any) => l.last === 'Nakamura' || l.last === 'Delgado'));
  expect(imported.length).toBe(2);

  const job = await page.evaluate(() => (window as any).db.imports.at(-1));
  expect(job.status).toBe('completed');
  expect(job.imported).toBeGreaterThanOrEqual(2);
});

// importCheck()'s local-backend branch (src/features/imports.js) matches a
// row against an existing lead on phone/email/address+ZIP; below we build
// the duplicate-triggering CSV in-memory from a phone number read live off
// an existing seed lead (per this session's instructions, never a
// hardcoded/stale phone) rather than shipping a second static fixture that
// could drift from the seed.

test('a duplicate row is detected and shown on the Check duplicates screen, not silently imported', async ({ page }) => {
  const target = await page.evaluate(() => {
    const lead = (window as any).db.leads.find((l: any) => !l.archived && l.phones[0]?.n);
    return { id: lead.id, phoneDigits: lead.phones[0].n.replace(/^\+1/, '') };
  });
  const before = await page.evaluate(() => (window as any).db.leads.length);

  const csv = `First Name,Last Name,Phone 1,Email,Address,City,State,ZIP,Notes\nDup,TestRow,${target.phoneDigits},dup.test@example.com,999 Nonexistent Ave,Atlanta,GA,00000,Playwright e2e duplicate-detection row\n`;

  await page.goto('/#imports');
  await page.locator('#fileIn').setInputFiles({ name: 'dupe-detect.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('h2')).toContainText('Match columns');
  await page.getByRole('button', { name: 'Next: check duplicates ›' }).click();

  await expect(page.locator('h2')).toContainText('Check duplicates');
  const dupRow = page.locator('tr', { hasText: 'Dup TestRow' });
  await expect(dupRow).toBeVisible();
  await expect(dupRow).toContainText('phone');

  const dups = await page.evaluate(() => (window as any).state.importStep.dups.map((d: any) => ({ matchId: d.match.id, action: d.action })));
  expect(dups.length).toBe(1);
  expect(dups[0].matchId).toBe(target.id);
  expect(dups[0].action).toBe('skip'); // default action — not silently imported as new

  // Completing the import with the default "skip" action must not create a
  // new lead for this row.
  await page.getByRole('button', { name: /^Import \d+ leads?$/ }).click();
  await expect(page.locator('.toast')).toBeVisible();

  const after = await page.evaluate(() => (window as any).db.leads.length);
  expect(after).toBe(before);
  const created = await page.evaluate(() => (window as any).db.leads.some((l: any) => l.last === 'TestRow' && l.first === 'Dup'));
  expect(created).toBe(false);
});

test('choosing "merge" for a duplicate row merges it into the existing lead instead of creating a new one', async ({ page }) => {
  const target = await page.evaluate(() => {
    // A lead with no email on file makes the merge visible: importRun()'s
    // local-backend branch (features/imports.js) only fills email/addr/
    // city/zip on the matched lead when that field was previously blank.
    const lead = (window as any).db.leads.find((l: any) => !l.archived && l.phones[0]?.n && !l.email);
    return { id: lead.id, phoneDigits: lead.phones[0].n.replace(/^\+1/, '') };
  });
  const before = await page.evaluate(() => (window as any).db.leads.length);

  const csv = `First Name,Last Name,Phone 1,Email,Address,City,State,ZIP,Notes\nMergeTest,PlaywrightRow,${target.phoneDigits},playwright.merge@example.com,777 Merge Way,Atlanta,GA,00000,Playwright e2e merge row\n`;

  await page.goto('/#imports');
  await page.locator('#fileIn').setInputFiles({ name: 'dupe-merge.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('h2')).toContainText('Match columns');
  await page.getByRole('button', { name: 'Next: check duplicates ›' }).click();

  await expect(page.locator('h2')).toContainText('Check duplicates');
  const dupRow = page.locator('tr', { hasText: 'MergeTest PlaywrightRow' });
  await expect(dupRow).toBeVisible();
  await dupRow.locator('select').selectOption('merge');

  await page.getByRole('button', { name: /^Import \d+ leads?$/ }).click();
  await expect(page.locator('.toast')).toBeVisible();

  const after = await page.evaluate(() => (window as any).db.leads.length);
  expect(after).toBe(before); // merged, not created as a new lead

  const merged = await page.evaluate((id) => (window as any).db.leads.find((l: any) => l.id === id), target.id);
  expect(merged.email).toBe('playwright.merge@example.com');
  const noNewLead = await page.evaluate(() => (window as any).db.leads.some((l: any) => l.first === 'MergeTest' && l.last === 'PlaywrightRow'));
  expect(noNewLead).toBe(false);
});

test('undo removes a freshly-imported lead but keeps one with logged activity', async ({ page }) => {
  const csv = `First Name,Last Name,Phone 1,Email,Address,City,State,ZIP,Notes\nUndo,KeepLead,4045551111,undokeep@example.com,1 Keep St,Atlanta,GA,10001,\nUndo,RemoveLead,4045552222,undoremove@example.com,2 Remove St,Atlanta,GA,10002,\n`;

  await page.goto('/#imports');
  await page.locator('#fileIn').setInputFiles({ name: 'undo-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('h2')).toContainText('Match columns');
  await page.getByRole('button', { name: 'Next: check duplicates ›' }).click();
  await expect(page.locator('h2')).toContainText('Check duplicates');
  await page.getByRole('button', { name: /^Import \d+ leads?$/ }).click();
  await expect(page.locator('.toast')).toBeVisible();

  const setup = await page.evaluate(() => {
    const job = (window as any).db.imports.at(-1);
    const keepLead = (window as any).db.leads.find((l: any) => l.first === 'Undo' && l.last === 'KeepLead');
    const removeLead = (window as any).db.leads.find((l: any) => l.first === 'Undo' && l.last === 'RemoveLead');
    const outcomeId = (window as any).db.outcomes[0].id;
    // undoImport(id) (features/imports.js) keeps any lead that already has a
    // logged activity — give the "keep" lead one directly, matching the
    // activity shape src/data/seed.js's A() helper produces.
    (window as any).db.activities.push({
      id: Math.max(0, ...(window as any).db.activities.map((a: any) => a.id)) + 1,
      leadId: keepLead.id, type: 'call', outcomeId, userId: (window as any).me.id,
      at: new Date().toISOString(), note: 'Playwright e2e: worked lead, must survive undo.',
      listId: null, campaignId: null, durationMin: 1,
    });
    return { jobId: job.id, jobFile: job.file, keepId: keepLead.id, removeId: removeLead.id };
  });

  await page.goto('/#imports');
  const jobRow = page.locator('tr', { hasText: setup.jobFile });
  await jobRow.getByRole('button', { name: 'Undo' }).click();
  await confirmAction(page);

  await expect(page.locator('.toast')).toBeVisible();
  await expect
    .poll(() => page.evaluate((id) => !!(window as any).db.leads.find((l: any) => l.id === id), setup.removeId))
    .toBe(false);
  const keptStill = await page.evaluate((id) => !!(window as any).db.leads.find((l: any) => l.id === id), setup.keepId);
  expect(keptStill).toBe(true);

  const jobStatus = await page.evaluate((id) => (window as any).db.imports.find((j: any) => j.id === id)?.status, setup.jobId);
  expect(jobStatus).toBe('undone');
});
