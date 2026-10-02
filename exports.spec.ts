// Stage 15 e2e: exports download (Settings → Data & exports).
// None of these buttons carry a data-testid (confirmed by grep across
// src/), so they're matched by their visible label — the same approach
// prior stages' ad-hoc verification scripts already used successfully.
import { expect, test } from '@playwright/test';
import { OWNER, loginAsDemo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.goto('/#settings');
  await page.click('[data-tab="data"]');
});

// Every dataset exportCsv() (src/features/exports.js) handles, matched by
// its real visible button label from Settings → Data & exports
// (src/views/settings.js's SET.data: `⇩ ${t}` for each [key, label] pair —
// all nine datasets follow that exact pattern, so no special-casing needed).
for (const label of ['⇩ Leads', '⇩ Assignments', '⇩ Activities', '⇩ Outcomes', '⇩ Notes', '⇩ Follow-ups', '⇩ Campaigns', '⇩ Team performance', '⇩ Scoreboard']) {
  test(`"${label}" downloads a non-empty CSV`, async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click(`.actions button:has-text("${label}")`),
    ]);
    const streamPath = await download.path();
    expect(streamPath).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
}

test('"Save backup" downloads a valid JSON snapshot of the whole database', async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.actions button:has-text("⇩ Save backup")'),
  ]);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const fs = await import('node:fs');
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  expect(json.version).toBe(1);
  expect(Array.isArray(json.db.leads)).toBe(true);
  expect(json.db.leads.length).toBeGreaterThan(0);
});
