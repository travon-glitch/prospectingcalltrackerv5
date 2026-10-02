// e2e-level negative flows for GATE G2.
import { expect, test } from '@playwright/test';
import { OWNER, loginAsDemo } from './helpers.js';

// "Bad password" is already covered end to end by auth-and-leads.spec.ts's
// own 'wrong password is rejected with an inline message' test — not
// duplicated here.

test('leaving the New user dialog blank is rejected and creates nobody', async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.goto('/#admin');
  await page.click('[data-tab="users"]');

  const before = await page.evaluate(() => (window as any).db.members.length);
  await page.locator('[data-testid="new-user"]').click();
  await expect(page.locator('#dlg')).toBeVisible();

  // First name and email are both left blank (Temporary password is
  // pre-filled by generatePassword(), so that guard never fires here — this
  // is specifically the src/features/admin.js saveUser() guard
  // `if(!first || !email) return toast("First name and email are required")`).
  await page.locator('[data-testid="save-user"]').click();

  await expect(page.locator('.toast')).toContainText('First name and email are required');
  await expect(page.locator('#dlg')).toBeVisible();
  const after = await page.evaluate(() => (window as any).db.members.length);
  expect(after).toBe(before);
});

test('leaving both name fields blank on a new lead is rejected', async ({ page }) => {
  // src/features/leads.js's leadForm() save handler has no *required*
  // built-in field by default (defaultBuiltInFields() ships every field
  // with required:false — src/core/fields.js) — so there is no per-field
  // "X is required" guard to trigger honestly out of the box. The one real,
  // always-on guard it does have is: first AND last both blank →
  // `toast(\`Enter a ${fieldLabel("first").toLowerCase()} or ${fieldLabel("last").toLowerCase()}\`)`,
  // i.e. "Enter a first name or last name" with the seed's default labels.
  await loginAsDemo(page, OWNER);
  await page.goto('/#leads');
  await page.getByRole('button', { name: '+ New lead' }).click();
  await expect(page.locator('#dlg')).toBeVisible();

  const before = await page.evaluate(() => (window as any).db.leads.length);
  await page.locator('[data-testid="save-lead"]').click();

  await expect(page.locator('.toast')).toContainText('Enter a first name or last name');
  await expect(page.locator('#dlg')).toBeVisible();
  const after = await page.evaluate(() => (window as any).db.leads.length);
  expect(after).toBe(before);
});

test('a duplicate email (case-varied) is rejected and only one member is created', async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.goto('/#admin');
  await page.click('[data-tab="users"]');

  const stamp = Date.now();
  const email = `dup.email.${stamp}@example.com`;

  await page.locator('[data-testid="new-user"]').click();
  await page.locator('#uF').fill('Dup');
  await page.locator('#uL').fill('One');
  await page.locator('#uE').fill(email);
  await page.locator('[data-testid="save-user"]').click();
  await expect(page.locator('[data-testid="temp-password"]')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Second attempt, same email but uppercased.
  await page.locator('[data-testid="new-user"]').click();
  await page.locator('#uF').fill('Dup');
  await page.locator('#uL').fill('Two');
  await page.locator('#uE').fill(email.toUpperCase());
  await page.locator('[data-testid="save-user"]').click();

  await expect(page.locator('.toast')).toContainText('Another user already has that email');
  const matches = await page.evaluate((e) => (window as any).db.members.filter((m: any) => m.email.toLowerCase() === e.toLowerCase()).length, email);
  expect(matches).toBe(1);
});

test('a malformed (too-short) CSV upload is rejected without crashing the app', async ({ page }) => {
  const pageErrors: any[] = [];
  await loginAsDemo(page, OWNER);
  page.on('pageerror', (e) => pageErrors.push(e));
  await page.goto('/#imports');
  await expect(page.locator('h2')).toContainText('Imports');

  // A header-only file: after parseCsv() this is exactly 1 row, which fails
  // handleFile()'s `if(!rows || rows.length<2) return toast(...)` guard —
  // the real, current guard for "not enough to import", as opposed to a
  // genuine parse throw (this custom parseCsv() is very forgiving and
  // doesn't throw on an unterminated quote the way JSON.parse would).
  await page.locator('#fileIn').setInputFiles({
    name: 'too-short.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Col A,Col B,Col C\n'),
  });

  await expect(page.locator('.toast')).toContainText('The file needs a header row and at least one lead');
  // The app is still usable: still on the Imports screen, not bounced to
  // the login screen, and nothing threw.
  await expect(page.locator('h2')).toContainText('Imports');
  await expect(page.locator('.login')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('a CSV with unrecognized headers maps every column to Skip without crashing', async ({ page }) => {
  const pageErrors: any[] = [];
  await loginAsDemo(page, OWNER);
  page.on('pageerror', (e) => pageErrors.push(e));
  await page.goto('/#imports');

  await page.locator('#fileIn').setInputFiles({
    name: 'unknown-headers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Col A,Col B,Col C\nfoo,bar,baz\n'),
  });

  // handleFile()'s guess() returns "" for every unrecognized header, and
  // views/imports.js's Match-columns step renders state.importStep.map[i]
  // straight into each <select>'s selected value — "" is FIELDS' own
  // ["","Skip"] entry, so every column should show Skip (unmapped) rather
  // than throwing on an unrecognized header.
  await expect(page.locator('h2')).toContainText('Match columns');
  const selects = page.locator('.tbl select');
  await expect(selects).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(selects.nth(i)).toHaveValue('');

  // With every column unmapped, the one data row has no name, phone, email
  // or address+ZIP at all, so importCheck()'s own always-on guard
  // (`if(!r.first && !r.last && !r.phones.length && !r.email && !(r.addr&&r.zip))`)
  // puts it in `bad`, not `ready` — 0 ready rows, no crash, regardless of
  // db.settings.importCfg.requireName/requirePhone.
  await page.getByRole('button', { name: 'Next: check duplicates ›' }).click();
  await expect(page.locator('h2')).toContainText('Check duplicates');
  await expect(page.locator('.page-head p')).toContainText('0 ready to import');
  await expect(page.locator('.page-head p')).toContainText('1 rows without a name or phone (skipped)');
  await expect(page.locator('.login')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('an "expired session" lands back on the login screen', async ({ page }) => {
  // This is a local-storage-backed, single-page in-memory demo with no real
  // token-expiry concept on the local backend — a repo-wide grep for
  // expired/expire only turns up a comment about the Supabase branch's
  // writeAuditLog() catching an expired-session rejection from a real
  // Supabase JWT, not anything the local backend has. The honest, real
  // equivalent available here is: something else (another tab, an admin,
  // whatever) ends the session out from under the person while they're
  // mid-screen — which in this single-page app is exactly what the real
  // window.signOut() function does — and the app must land back on the
  // login screen rather than keep rendering protected content or throw.
  await loginAsDemo(page, OWNER);
  await page.goto('/#leads');
  await expect(page.locator('.login')).toHaveCount(0);

  await page.evaluate(() => (window as any).signOut());

  await expect(page.locator('.login')).toBeVisible();
});
