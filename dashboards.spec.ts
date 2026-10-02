// Stage 15 e2e: smoke-level "view each dashboard" check for the 4 dashboard
// screens (V.dashboard/V.reports/V.scoreboard/V.crmdash, registered in
// src/views/dashboard.js/reports.js/scoreboard.js/crmdash.js). This is
// intentionally shallow — tests/unit/stats.test.ts already covers the
// underlying metric math — this just confirms each screen renders real
// content for the signed-in user rather than a blank page or an error.
import { expect, test } from '@playwright/test';
import { loginAsDemo, OWNER } from './helpers.js';

test.beforeEach(async ({ page }) => {
  // OWNER has every permission (superAdmin), so every dashboard's
  // permission-gated section (viewTeamReports, viewCommissions, viewPrices,
  // exportCrm, …) renders its real content instead of a "—"/hidden state.
  await loginAsDemo(page, OWNER);
});

test('dashboard (Welcome back) shows the weekly KPI cards', async ({ page }) => {
  await page.goto('/#dashboard');
  await expect(page.locator('h2')).toContainText('Welcome back');
  const kpis = page.locator('.card.kpi');
  await expect(kpis).toHaveCount(4);
  // Each KPI card has a numeric/percentage .value — assert at least one is
  // visible and non-empty rather than just present in the DOM.
  await expect(kpis.first().locator('.value')).toBeVisible();
  await expect(kpis.first().locator('.value')).not.toBeEmpty();
});

test('reports shows the per-caller performance table', async ({ page }) => {
  await page.goto('/#reports');
  await expect(page.locator('h2')).toContainText('Reports');
  // who = db.members.filter(m=>m.active) when viewTeamReports is held (OWNER
  // is), so the table always has at least one row (the signed-in owner).
  const rows = page.locator('.tbl table tbody tr');
  await expect(rows.first()).toBeVisible();
  await expect(rows).not.toHaveCount(0);
});

test('scoreboard shows ranked members with points', async ({ page }) => {
  await page.goto('/#scoreboard');
  await expect(page.locator('h2')).toContainText('Scoreboard');
  const rows = page.locator('.grid > .card');
  await expect(rows.first()).toBeVisible();
  // Every active member is ranked, so there's always at least one row, and
  // the signed-in owner is tagged "you".
  await expect(page.locator('.card', { hasText: 'you' })).toBeVisible();
});

test('CRM dashboard shows the pipeline KPI cards', async ({ page }) => {
  await page.goto('/#crmdash');
  await expect(page.locator('h2')).toContainText('CRM Dashboard');
  const kpis = page.locator('.card.kpi');
  await expect(kpis.first()).toBeVisible();
  // "Active opportunities" is always rendered first, regardless of filters.
  await expect(kpis.first()).toContainText('Active opportunities');
  await expect(kpis.first().locator('.value')).toBeVisible();
});
