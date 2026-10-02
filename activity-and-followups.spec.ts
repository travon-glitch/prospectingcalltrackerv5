// Stage 15 e2e: log a call attempt (src/features/activity.js's
// activityForm()) and mark a follow-up done (src/features/activity.js's
// fuDone(), rendered on the Follow-ups screen — src/views/followups.js).
import { expect, test } from '@playwright/test';
import { AGENT, loginAsDemo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page, AGENT);
});

test('logging a call attempt records an activity and clears the save button', async ({ page }) => {
  const leadId = await page.evaluate(() => (window as any).visibleLeads()[0].id);
  await page.goto(`/#lead/${leadId}`);

  const before = await page.evaluate((id) => (window as any).db.activities.filter((a: any) => a.leadId === id).length, leadId);

  // save-activity starts disabled until an outcome is picked (activity.js).
  await expect(page.locator('[data-testid="save-activity"]')).toBeDisabled();
  await page.locator('.outcomes button').first().click();
  await page.locator('#noteAct').fill('Playwright e2e: logged via automated test.');
  await expect(page.locator('[data-testid="save-activity"]')).toBeEnabled();
  await page.locator('[data-testid="save-activity"]').click();

  await expect(page.locator('.toast')).toBeVisible();
  const after = await page.evaluate((id) => (window as any).db.activities.filter((a: any) => a.leadId === id).length, leadId);
  expect(after).toBe(before + 1);
});

test('marking a follow-up done removes it from the pending list', async ({ page }) => {
  // Guarantee a pending follow-up exists regardless of seed drift: set one
  // directly, the same way the performance spec seeds bulk data, then
  // re-render with window.draw() (src/main.js) so the Follow-ups screen
  // reflects it.
  const fu = await page.evaluate(() => {
    const lead = (window as any).visibleLeads()[0];
    const id = Math.max(0, ...(window as any).db.followUps.map((f: any) => f.id)) + 1;
    const rec = {
      id, leadId: lead.id, due: (window as any).TODAY, status: 'pending',
      note: 'Playwright e2e follow-up', assignee: (window as any).me.id,
      createdAt: new Date().toISOString(),
    };
    (window as any).db.followUps.push(rec);
    return rec;
  });

  await page.goto('/#followups');
  const row = page.locator('tr', { hasText: 'Playwright e2e follow-up' }).first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.locator('tr', { hasText: 'Playwright e2e follow-up' })).toHaveCount(0);
  const status = await page.evaluate((id) => (window as any).db.followUps.find((f: any) => f.id === id)?.status, fu.id);
  expect(status).not.toBe('pending');
});
