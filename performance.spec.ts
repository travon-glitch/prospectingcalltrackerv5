// Stage 15 e2e/perf: seed 10,000 leads / 2,000 deals directly into
// window.db (the same live-getter every other spec in this suite uses for
// setup) and time the first render of #leads and #crm after that seed,
// via window.draw() (src/main.js). Target: under 1.5s on a laptop.
//
// Actual measured numbers on the machine this suite last ran on are
// recorded in README.md's Performance section — re-run `npm run test:e2e`
// to reproduce them on a different machine.
import { expect, test } from '@playwright/test';
import { OWNER, loginAsDemo } from './helpers.js';

test.setTimeout(60_000);

test('renders 10,000 leads under 1.5s', async ({ page }) => {
  await loginAsDemo(page, OWNER); // superAdmin — sees every seeded lead, unfiltered.

  const ms = await page.evaluate(() => {
    const N = 10_000;
    let nextId = Math.max(0, ...(window as any).db.leads.map((l: any) => l.id)) + 1;
    const first = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Sam', 'Jamie', 'Drew', 'Quinn'];
    const last = ['Nguyen', 'Garcia', 'Smith', 'Patel', 'Johnson', 'Kim', 'Brown', 'Davis', 'Lopez', 'Chen'];
    const memberIds = (window as any).db.members.map((m: any) => m.id);
    const bulk = [];
    for (let i = 0; i < N; i++) {
      const id = nextId++;
      bulk.push({
        id, first: first[i % first.length], last: `${last[i % last.length]}${i}`,
        email: `perf.lead.${i}@example.com`, addr: `${100 + i} Perf St`, city: 'Atlanta', state: 'GA', zip: '30301',
        phones: [{ n: `+1470555${String(1000 + i).padStart(4, '0')}`, type: 'mobile' }],
        listIds: [], assigned: memberIds[i % memberIds.length], status: 'new',
        dnc: false, dnt: false, dncontact: false, archived: false, source: 'import',
        createdAt: new Date().toISOString(), custom: {},
      });
    }
    (window as any).db.leads.push(...bulk);

    (window as any).state.view = 'dashboard'; (window as any).draw(); // discard the "navigate to a page for the first time" JIT/layout cost
    const t0 = performance.now();
    (window as any).state.view = 'leads'; (window as any).draw();
    const t1 = performance.now();
    return t1 - t0;
  });

  console.log(`#leads first render with 10,000 leads: ${ms.toFixed(1)}ms`);
  await expect(page.locator('h2')).toContainText('Leads');
  expect(ms).toBeLessThan(1500);
});

test('renders 2,000 deals under 1.5s', async ({ page }) => {
  await loginAsDemo(page, OWNER);

  const ms = await page.evaluate(() => {
    const N = 2_000;
    let nextLeadId = Math.max(0, ...(window as any).db.leads.map((l: any) => l.id)) + 1;
    let nextDealId = Math.max(0, ...(window as any).db.deals.map((d: any) => d.id)) + 1;
    const pipeline = (window as any).db.pipelines.find((p: any) => !p.archived);
    const stages = pipeline.stages.filter((s: any) => !s.archived);
    const memberIds = (window as any).db.members.map((m: any) => m.id);

    const bulkLeads = [];
    const bulkDeals = [];
    for (let i = 0; i < N; i++) {
      const leadId = nextLeadId++;
      bulkLeads.push({
        id: leadId, first: 'Perf', last: `CrmLead${i}`, email: `perf.crm.${i}@example.com`,
        addr: `${200 + i} Deal Ave`, city: 'Atlanta', state: 'GA', zip: '30302',
        phones: [{ n: `+1470556${String(1000 + i).padStart(4, '0')}`, type: 'mobile' }],
        listIds: [], assigned: memberIds[i % memberIds.length], status: 'contacted',
        dnc: false, dnt: false, dncontact: false, archived: false, source: 'import',
        createdAt: new Date().toISOString(), custom: {},
      });
      const stage = stages[i % stages.length];
      bulkDeals.push({
        id: nextDealId++, leadId, pipelineId: pipeline.id, stageId: stage.id,
        assigned: memberIds[i % memberIds.length], temperature: 'warm', price: 300000 + (i % 50) * 1000,
        commPct: 3, referralPct: 0, teamSplitPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0,
        closeDate: null, nextFu: null, notes: '', createdAt: new Date().toISOString(),
        stageEnteredAt: new Date().toISOString(), createdBy: memberIds[0], history: [],
      });
    }
    (window as any).db.leads.push(...bulkLeads);
    (window as any).db.deals.push(...bulkDeals);

    (window as any).state.view = 'dashboard'; (window as any).draw();
    const t0 = performance.now();
    (window as any).state.crmPipe = pipeline.id; (window as any).state.view = 'crm'; (window as any).draw();
    const t1 = performance.now();
    return t1 - t0;
  });

  console.log(`#crm first render with 2,000 deals: ${ms.toFixed(1)}ms`);
  await expect(page.locator('h2')).toContainText('CRM Pipeline');
  expect(ms).toBeLessThan(1500);
});

test('search input stays responsive with 10,000 leads loaded', async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.evaluate(() => {
    const N = 10_000;
    let nextId = Math.max(0, ...(window as any).db.leads.map((l: any) => l.id)) + 1;
    const memberIds = (window as any).db.members.map((m: any) => m.id);
    const bulk = [];
    for (let i = 0; i < N; i++) {
      const id = nextId++;
      bulk.push({
        id, first: 'Search', last: `Perf${i}`, email: `search.perf.${i}@example.com`,
        addr: `${300 + i} Query Rd`, city: 'Atlanta', state: 'GA', zip: '30303',
        phones: [{ n: `+1470557${String(1000 + i).padStart(4, '0')}`, type: 'mobile' }],
        listIds: [], assigned: memberIds[i % memberIds.length], status: 'new',
        dnc: false, dnt: false, dncontact: false, archived: false, source: 'import',
        createdAt: new Date().toISOString(), custom: {},
      });
    }
    (window as any).db.leads.push(...bulk);
    (window as any).state.view = 'leads'; (window as any).draw();
  });

  const searchBox = page.locator('#q');
  await expect(searchBox).toBeVisible();
  const start = Date.now();
  await searchBox.pressSequentially('Search Perf9999', { delay: 30 });
  await expect(page.locator('table tbody tr, .card').first()).toBeVisible();
  const elapsed = Date.now() - start;
  console.log(`typing a 15-char query over 10,000 leads took ${elapsed}ms wall-clock`);
  // Not a strict perf gate on its own (typing delay dominates) — this is
  // mainly a regression guard: the page must not hang or crash while
  // filtering 10,000 rows on every keystroke.
  expect(elapsed).toBeLessThan(10_000);
});
