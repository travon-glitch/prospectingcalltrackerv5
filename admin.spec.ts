// Stage 15 e2e: admin creates a user with a temporary password → that user
// is forced to change their password on first sign-in → an owner edits and
// saves a role's permissions.
//
// Uses the established pattern from prior stages' ad-hoc verification
// scripts: the new-user / forced-password-change parts run in their own
// browser context so they don't disturb the admin's own signed-in session.
import { expect, test } from '@playwright/test';
import { loginAsDemo, OWNER } from './helpers.js';

test('admin creates a user, who must change their password on first sign-in', async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.goto('/#admin');
  await page.locator('[data-testid="new-user"]').click();
  await expect(page.locator('#dlg')).toBeVisible();

  const stamp = Date.now();
  const email = `pw.newuser.${stamp}@example.com`;
  await page.locator('#uF').fill('Pw');
  await page.locator('#uL').fill(`Newuser${stamp}`);
  await page.locator('#uE').fill(email);

  await page.locator('[data-testid="save-user"]').click();
  await expect(page.locator('[data-testid="temp-password"]')).toBeVisible();
  const tempPassword = await page.locator('[data-testid="temp-password"]').innerText();
  await page.getByRole('button', { name: 'Done' }).click();

  const created = await page.evaluate((e) => (window as any).db.members.find((m: any) => m.email === e), email);
  expect(created).toBeTruthy();
  expect(created.mustChangePw).toBeTruthy();

  // Sign out and back in as the new user on the SAME page/context. The
  // local backend keeps everything in that one page's in-memory window.db
  // (persisted only to that page's own origin storage), so a genuinely
  // separate browser context — a different device — would boot from the
  // seed and never see the user this test just created; a new tab in the
  // same context would share storage but the app itself is a single-page
  // in-memory session, so signing out here is the accurate equivalent.
  await page.evaluate(() => (window as any).signOut());
  await page.waitForFunction(() => document.querySelector('.login'));
  await page.locator('[data-testid="login-email"]').fill(email);
  await page.locator('[data-testid="login-password"]').fill(tempPassword);
  await page.locator('[data-testid="login-submit"]').click();

  await expect(page.locator('[data-testid="change-password"]')).toBeVisible();
  await page.locator('#npw1').fill('PlaywrightNewPass1!');
  await page.locator('#npw2').fill('PlaywrightNewPass1!');
  await page.locator('[data-testid="change-password"]').click();

  await expect(page.locator('.login')).toHaveCount(0, { timeout: 10_000 });
});

test('owner edits and saves permissions for a role', async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.goto('/#admin');
  await page.click('[data-tab="roles"]');
  await expect(page.locator('[data-testid="new-role"]')).toBeVisible();

  // Pick a non-superAdmin role from the list so toggling a permission is
  // meaningful (an owner's own superAdmin role has every permission and
  // can't be turned off a la carte, and the roles panel locks it).
  // defaultRoles() (src/core/permissions.js) always ships 5 non-superAdmin
  // built-in roles (manager/isa_manager/agent/re_agent/viewer), so the seed
  // should never actually come back empty here — but this is made
  // self-sufficient rather than trusted: if it ever did come back empty,
  // push one of those known-shape roles (same {id,name,builtIn,description,
  // perms} defaultRoles() itself ships) straight into window.db.roles so
  // the rest of the test still has something real to click on.
  let roleId = await page.evaluate(() => (window as any).db.roles.find((r: any) => !r.superAdmin)?.id);
  if (!roleId) {
    roleId = await page.evaluate(() => {
      const fallback = { id: 'agent', name: 'Inside Sales Agent', builtIn: true, description: 'Works assigned leads: calls, texts, notes, follow-ups, outcomes, moves their leads through the CRM.', perms: { viewOwnLeads: true, createLeads: true } };
      (window as any).db.roles.push(fallback);
      return fallback.id;
    });
  }
  const roleName = await page.evaluate((id) => (window as any).db.roles.find((r: any) => r.id === id)?.name, roleId);
  // Match the role's <b> name exactly — some seed role names are
  // substrings of each other (e.g. "Administrator" vs "Owner / Super
  // Administrator"), so a plain hasText substring match is ambiguous.
  await page.locator('.role-list li').filter({ has: page.locator('b', { hasText: new RegExp(`^${roleName}$`) }) }).click();
  await expect(page.locator('#perms')).toHaveAttribute('data-role', roleId);

  const checkbox = page.locator(`#perms input[data-role="${roleId}"]`).first();
  await expect(checkbox).toBeVisible();
  const before = await checkbox.isChecked();
  await checkbox.setChecked(!before);

  await page.locator('[data-testid="save-permissions"]').click();
  await expect(page.locator('.toast')).toBeVisible();

  const cap = await checkbox.getAttribute('data-cap');
  const after = await page.evaluate(({ id, cap }: any) => (window as any).db.roles.find((r: any) => r.id === id)?.perms?.[cap], { id: roleId, cap });
  expect(after).toBe(!before);
});

test('owner creates a team from the Teams tab', async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.goto('/#admin');
  // The Team management tab is a different tab set from Settings' own tabs
  // (src/views/admin.js's ADMIN_TABS: users/roles/teams) — data-tab="teams".
  await page.click('[data-tab="teams"]');
  await page.locator('[data-testid="new-team"]').click();
  await expect(page.locator('#dlg')).toBeVisible();

  const name = `Playwright Team ${Date.now()}`;
  await page.locator('#tN').fill(name);
  // Colour already has a default radio checked (teamDlg's own TEAM_COLORS
  // default), and Description/Logo/Manager/Members/Lists are all optional —
  // the only client-side guard in the save handler is a non-empty, unique
  // name (src/features/admin.js's teamDlg() $("#tOk2").onclick).
  await page.locator('[data-testid="save-team"]').click();

  await expect(page.locator('.toast')).toContainText('Team saved');
  const created = await page.evaluate((n) => (window as any).db.teams.find((t: any) => t.name === n), name);
  expect(created).toBeTruthy();
  expect(created.archived).toBeFalsy();

  // Teams tab redraws onto "Active" by default, so the new team's card
  // should already be visible without switching state.teamsArchived.
  await expect(page.locator(`.team-card[data-team="${created.id}"]`)).toBeVisible();
  await expect(page.locator(`.team-card[data-team="${created.id}"]`)).toContainText(name);
});

test("owner changes a member's role from the Users tab", async ({ page }) => {
  // src/features/admin.js's setRole(id, role) — `m.role=role; audit(...);
  // toast("Role updated"); draw();` — is the function this scenario is
  // named after, but a repo-wide grep finds it wired to no onclick/onchange
  // anywhere in src/views (it's dead code kept, per its own comment, "for
  // older buttons"). The real, current UI path to change a member's role is
  // the Users tab's "Edit" button → the same New/Edit user dialog
  // (userDlg()/saveUser() in src/features/admin.js) that has a role
  // <select id="uR">, saved via saveUser() — which shows the toast "User
  // saved", not "Role updated". This test drives that real control and
  // asserts the real toast/state saveUser() actually produces, rather than
  // the message a UI-less setRole() would show.
  await loginAsDemo(page, OWNER);
  await page.goto('/#admin');
  await page.click('[data-tab="users"]');

  // Pick a clearly safe, non-owner, non-superAdmin target so there's no
  // chance of tripping the "last Super Administrator" guard in saveUser().
  const target = await page.evaluate(() => {
    const m = (window as any).db.members.find((x: any) => x.active && x.role !== 'owner' && !(window as any).db.roles.find((r: any) => r.id === x.role)?.superAdmin);
    return m ? { id: m.id, role: m.role } : null;
  });
  expect(target).toBeTruthy();
  const nextRole = await page.evaluate(({ role }: any) => (window as any).db.roles.find((r: any) => !r.superAdmin && r.id !== role)?.id, target);
  expect(nextRole).toBeTruthy();

  await page.locator(`tr[data-user="${target!.id}"] [data-testid="edit-user"]`).click();
  await expect(page.locator('#dlg')).toBeVisible();
  await page.locator('#uR').selectOption(nextRole);
  await page.locator('[data-testid="save-user"]').click();

  await expect(page.locator('.toast')).toContainText('User saved');
  const updatedRole = await page.evaluate((id) => (window as any).db.members.find((m: any) => m.id === id)?.role, target!.id);
  expect(updatedRole).toBe(nextRole);
  // Throwaway in-memory browser session, never persisted past this test —
  // restoring the seed member's original role isn't needed for correctness.
});
