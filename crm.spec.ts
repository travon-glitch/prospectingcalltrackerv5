// Stage 15 e2e: add a lead to the CRM, drag its card to a new stage on the
// pipeline board, then edit its price on the deal detail page.
import { expect, test } from '@playwright/test';
import { AGENT, loginAsDemo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page, AGENT);
});

test('add to CRM, drag to a new stage, and edit price', async ({ page }) => {
  const leadName = await page.evaluate(() => {
    const inAnyPipeline = new Set((window as any).db.deals.map((d: any) => d.leadId));
    let lead = (window as any).visibleLeads().find((l: any) => !inAnyPipeline.has(l.id) && l.phones[0]);
    if (!lead) {
      // GATE G2: no test may bail out via test.skip — if every visible lead
      // is already in a pipeline, create a fresh one deterministically
      // instead, matching the exact shape seed leads take (src/data/seed.js's
      // L() helper / other specs' fixtures, e.g. activity-and-followups.spec.ts).
      lead = {
        id: Math.max(0, ...(window as any).db.leads.map((l: any) => l.id)) + 1,
        first: 'Playwright', last: 'CrmFixture',
        phones: [{ n: '4045550199', type: 'mobile' }],
        email: '', addr: '100 Test Ave', city: 'Atlanta', state: 'GA', zip: '30301',
        listIds: [], assigned: (window as any).me.id, status: 'new',
        dnc: false, dnt: false, dncontact: false, archived: false,
        source: 'import', createdAt: new Date().toISOString(),
      };
      (window as any).db.leads.push(lead);
    }
    return `${lead.first} ${lead.last}`;
  });

  // ---- add to CRM ----
  await page.goto('/#crm');
  await page.locator('[data-testid="crm-add"]').click();
  const row = page.locator('#pll li', { hasText: leadName });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('#dlg')).toBeVisible();
  await page.locator('#cpr').fill('350000');
  await page.locator('[data-testid="crm-add-save"]').click();
  await expect(page.locator('#dlg[open]')).toHaveCount(0);

  const deal = await page.evaluate((name) => {
    const [first, ...rest] = name.split(' ');
    const last = rest.join(' ');
    const lead = (window as any).db.leads.find((l: any) => l.first === first && l.last === last);
    return (window as any).db.deals.find((d: any) => d.leadId === lead.id);
  }, leadName);
  expect(deal).toBeTruthy();

  // ---- move to a new stage ----
  // The board is rendered twice — #crmBoard (desktop, every column,
  // drag-and-drop between them) and a second .crm-mobile-one copy (ONE
  // column at a time, navigated via col-prev/col-pick/col-next, CSS-hidden
  // at desktop widths — src/views/crm.js:42-50). src/features/crm.js says
  // so itself: "Drag and drop on desktop." Since .crm-mobile-one only ever
  // shows a single stage's column, there's no second column to drag a card
  // into there even in principle — the app's own answer for changing a
  // deal's stage on a narrow viewport is the "Move stage" dialog
  // (data-testid="deal-move" opens it on the deal detail page, src/views/
  // deal.js; "move-save" confirms it, src/features/crm.js's
  // moveStageDlg()/moveDeal()). So
  // this test drives whichever of the two real, designed interactions
  // matches the viewport actually in use, rather than forcing a
  // desktop-only drag gesture against a hidden element under mobile.
  await page.goto('/#crm');
  const isMobileLayout = await page.evaluate(() => !document.getElementById('crmBoard') || getComputedStyle(document.getElementById('crmBoard')!).display === 'none');
  const startStage = await page.evaluate((id) => (window as any).db.deals.find((d: any) => d.id === id)?.stageId, deal.id);

  if (!isMobileLayout) {
    const card = page.locator(`#crmBoard [data-testid="deal-card"][data-deal="${deal.id}"]`);
    await expect(card).toBeVisible();

    let columns = page.locator('#crmBoard .crm-col');
    let colCount = await columns.count();
    const findTarget = async () => {
      for (let i = 0; i < colCount; i++) {
        const stageId = await columns.nth(i).getAttribute('data-stage');
        if (stageId && stageId !== String(startStage)) return columns.nth(i);
      }
      return null;
    };
    let target = await findTarget();

    if (!target) {
      // defaultStages() (src/features/crm.js) always seeds 14 stages for a
      // new pipeline, so a real pipeline having only one should never
      // actually happen — but rather than trust that assumption silently,
      // add a second stage deterministically so the drag-to-a-different-
      // stage assertion below always has a real target, matching the shape
      // defaultStages()'s own S() helper gives every stage (id/name/prob/
      // kind/color/archived).
      await page.evaluate((dealId) => {
        const d = (window as any).db.deals.find((x: any) => x.id === dealId);
        const p = (window as any).db.pipelines.find((x: any) => x.id === d.pipelineId);
        const id = Math.max(0, ...p.stages.map((s: any) => s.id)) + 1;
        p.stages.push({ id, name: 'Playwright Fallback Stage', prob: 50, kind: 'active', color: '#0A84FF', archived: false });
        (window as any).draw();
      }, deal.id);
      await page.goto('/#crm');
      columns = page.locator('#crmBoard .crm-col');
      colCount = await columns.count();
      target = await findTarget();
    }
    expect(target).toBeTruthy();

    await card.dragTo(target!, { targetPosition: { x: 20, y: 20 } });
  } else {
    // Mobile: the real path is Deal detail -> "Move stage" -> pick a
    // different stage -> Move. Guarantee a second stage exists first (same
    // reasoning as the desktop branch's fallback above).
    const otherStageId = await page.evaluate((dealId) => {
      const d = (window as any).db.deals.find((x: any) => x.id === dealId);
      const p = (window as any).db.pipelines.find((x: any) => x.id === d.pipelineId);
      let other = p.stages.find((s: any) => !s.archived && s.id !== d.stageId);
      if (!other) {
        const id = Math.max(0, ...p.stages.map((s: any) => s.id)) + 1;
        other = { id, name: 'Playwright Fallback Stage', prob: 50, kind: 'active', color: '#0A84FF', archived: false };
        p.stages.push(other);
      }
      return other.id;
    }, deal.id);

    await page.goto(`/#deal/${deal.id}`);
    await page.locator('[data-testid="deal-move"]').click();
    await expect(page.locator('#dlg')).toBeVisible();
    await page.locator('#ms').selectOption(String(otherStageId));
    await page.locator('[data-testid="move-save"]').click();
  }

  await expect
    .poll(() => page.evaluate((id) => (window as any).db.deals.find((d: any) => d.id === id)?.stageId, deal.id))
    .not.toBe(startStage);

  // ---- edit price on the deal detail page ----
  await page.goto(`/#deal/${deal.id}`);
  // Scoped to #main: the closed "Add to CRM" dialog's own price field
  // (#cpr) stays in the DOM under #dlg after closeDlg() (it just drops the
  // dialog's [open] attribute), and it carries the same "Potential sale
  // price" label text, so an unscoped .fld lookup matches both.
  const priceInput = page.locator('#main .fld', { hasText: 'Potential sale price' }).locator('input');
  await priceInput.fill('412500');
  await priceInput.dispatchEvent('change');

  await expect
    .poll(() => page.evaluate((id) => (window as any).db.deals.find((d: any) => d.id === id)?.price, deal.id))
    .toBe(412500);
});
