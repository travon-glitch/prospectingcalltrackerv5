// Stage 15: shared helpers for tests/e2e/*.spec.ts.
//
// The app exposes `window.db`, `window.me`, `window.state`, `window.draw`
// and ~150 other functions by name (src/main.js, so inline onclick="..."
// handlers in the rendered HTML can reach them) — the same surface these
// helpers, and the tests themselves, use to set up state directly instead
// of clicking through screens that aren't part of the flow under test.

/** Demo one-click login (VITE_DEMO_LOGIN=true, on by default — see
 * .env.example). `name` matches the seed member's full name exactly. */
export async function loginAsDemo(page: any, name: any) {
  await page.goto('/');
  await page.locator('.user-btn', { hasText: name }).click();
  await page.waitForSelector('#app nav, #app .shell, [data-testid="ws-more-toggle"], .topbar', { timeout: 10_000 }).catch(() => {});
  // Simplest reliable "we're signed in" signal: the login screen is gone.
  await page.waitForFunction(() => !document.querySelector('.login'));
}

export const OWNER = 'Travon Burnette';
export const MANAGER = 'Maria Lopez';
export const AGENT = 'Devin Carter';

/** Real email/password sign-in, used for the admin-created-user flow. */
export async function loginWithPassword(page: any, email: any, password: any) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).db?.members?.length > 0);
  await page.locator('[data-testid="login-email"]').fill(email);
  await page.locator('[data-testid="login-password"]').fill(password);
  await page.locator('[data-testid="login-submit"]').click();
}

/** Waits until the app's boot sequence has populated window.db, then
 * returns it via the callback — for tests that need to read seed data
 * before signing in (e.g. to find a seeded user's email). */
export async function withDb(page: any, fn: any) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).db?.members?.length > 0);
  return page.evaluate(fn);
}

/** Confirms whatever confirm-dialog is open via its data-testid button. */
export async function confirmAction(page: any) {
  await page.locator('[data-testid="confirm-action"]').click();
}
