// Stage 15 e2e: login (demo one-click + real email/password) and create lead.
import { expect, test } from '@playwright/test';
import { AGENT, loginAsDemo, loginWithPassword, OWNER, withDb } from './helpers.js';

test.describe('login', () => {
  test('demo one-click login lands on the dashboard', async ({ page }) => {
    await loginAsDemo(page, OWNER);
    await expect(page.locator('.login')).toHaveCount(0);
    // V.dashboard's own heading is a personalized greeting, not the literal
    // word "Dashboard" — src/views/dashboard.js.
    await expect(page.locator('h2')).toContainText('Welcome back');
  });

  test('email + password sign-in works for a seeded user', async ({ page }) => {
    const { email, password } = await withDb(page, () => ({
      email: (window as any).db.members[0].email, password: (window as any).DEMO_PASSWORD,
    }));
    await loginWithPassword(page, email, password);
    await expect(page.locator('.login')).toHaveCount(0);
  });

  test('wrong password is rejected with an inline message', async ({ page }) => {
    const email = await withDb(page, () => (window as any).db.members[0].email);
    await loginWithPassword(page, email, 'definitely-wrong');
    await expect(page.locator('#liMsg')).not.toBeEmpty();
    await expect(page.locator('.login')).toBeVisible();
  });
});

test.describe('create lead', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, AGENT);
  });

  test('agent can create a new lead from the Leads screen', async ({ page }) => {
    await page.goto('/#leads');
    await page.getByRole('button', { name: '+ New lead' }).click();
    await expect(page.locator('#dlg')).toBeVisible();

    const stamp = Date.now();
    await page.locator('#lf_first').fill('Playwright');
    await page.locator('#lf_last').fill(`Test${stamp}`);
    await page.locator('#lf_phone').fill('(404) 555-0199');
    await page.locator('#lf_email').fill(`pw.${stamp}@example.com`);

    await page.locator('[data-testid="save-lead"]').click();
    await expect(page.locator('#dlg[open]')).toHaveCount(0);

    // save-lead navigates straight to the new lead's detail page.
    await expect(page.locator('h2')).toContainText(`Test${stamp}`);

    const created = await page.evaluate((last) => (window as any).db.leads.find((l: any) => l.last === last), `Test${stamp}`);
    expect(created).toBeTruthy();
    expect(created.phones[0].n).toContain('4045550199');
  });

  test('a duplicate phone number is rejected', async ({ page }) => {
    // Guarantee a phone-bearing lead exists regardless of seed drift: if the
    // seed happens not to have one, push a minimal lead with a known phone
    // directly into window.db.leads first (same shape other specs push —
    // see activity-and-followups.spec.ts's second test), then proceed.
    const existingPhone = await page.evaluate(() => {
      const found = (window as any).db.leads.find((l: any) => l.phones[0])?.phones[0].n;
      if (found) return found;
      const id = Math.max(0, ...(window as any).db.leads.map((l: any) => l.id)) + 1;
      const rec = {
        id, first: 'Seed', last: 'Phone', email: '', addr: '', city: '', state: '', zip: '',
        phones: [{ n: '+14045551234', type: 'mobile' }], listIds: [], assigned: (window as any).me.id,
        status: 'new', dnc: false, dnt: false, dncontact: false, archived: false,
        source: 'manual', createdAt: new Date().toISOString(), custom: {},
      };
      (window as any).db.leads.push(rec);
      return rec.phones[0].n;
    });
    const digits = existingPhone.replace(/^\+1/, '');
    const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;

    await page.goto('/#leads');
    await page.getByRole('button', { name: '+ New lead' }).click();
    await page.locator('#lf_first').fill('Dup');
    await page.locator('#lf_last').fill('Phone');
    await page.locator('#lf_phone').fill(formatted);
    await page.locator('[data-testid="save-lead"]').click();

    await expect(page.locator('.toast')).toContainText('already belongs to');
    await expect(page.locator('#dlg')).toBeVisible();
  });
});
