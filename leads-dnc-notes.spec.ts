// GATE G2 e2e: edit an existing lead, toggle a lead's Do Not
// Call/Text/Contact flags (src/features/leads.js's setDnc(), rendered on the
// lead detail page — src/views/lead.js), add a note (features/activity.js's
// addNote()), and create a prospecting list (src/views/lists.js's
// listForm()).
import { expect, test } from '@playwright/test';
import { AGENT, MANAGER, loginAsDemo } from './helpers.js';

test.describe('lead edit, DNC and notes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, AGENT);
  });

  test('agent can edit an existing lead and the change persists', async ({ page }) => {
    const leadId = await page.evaluate(() => (window as any).visibleLeads()[0].id);
    await page.goto(`/#lead/${leadId}`);

    // "Edit" also appears on the custom-fields panel's own inline edit
    // button (customPanel(), src/features/leads.js) — the page-head's Edit
    // button (which opens leadForm()) is the first one in DOM order.
    await page.locator('.page-head').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#dlg')).toBeVisible();

    const stamp = Date.now();
    const phoneDigits = String(stamp).slice(-10);
    const formatted = `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
    await page.locator('#lf_first').fill('Edited');
    await page.locator('#lf_last').fill(`Lead${stamp}`);
    await page.locator('#lf_phone').fill(formatted);
    await page.locator('#lf_email').fill(`edited.${stamp}@example.com`);

    await page.locator('[data-testid="save-lead"]').click();
    await expect(page.locator('#dlg[open]')).toHaveCount(0);

    await expect
      .poll(() => page.evaluate((id) => (window as any).db.leads.find((l: any) => l.id === id)?.last, leadId))
      .toBe(`Lead${stamp}`);

    const updated = await page.evaluate((id) => (window as any).db.leads.find((l: any) => l.id === id), leadId);
    expect(updated.first).toBe('Edited');
    expect(updated.email).toBe(`edited.${stamp}@example.com`);
    expect(updated.phones[0].n).toContain(phoneDigits);
  });

  test('marking Do Not Call flips dnc/status; Do Not Contact additionally cancels pending follow-ups', async ({ page }) => {
    // Build a lead with a guaranteed pending follow-up directly, the same
    // way activity-and-followups.spec.ts's second test does.
    const { leadId, fuId } = await page.evaluate(() => {
      const lead = (window as any).visibleLeads()[0];
      const id = Math.max(0, ...(window as any).db.followUps.map((f: any) => f.id)) + 1;
      (window as any).db.followUps.push({
        id, leadId: lead.id, due: (window as any).TODAY, status: 'pending',
        note: 'Playwright DNC follow-up', assignee: (window as any).me.id,
        createdAt: new Date().toISOString(),
      });
      return { leadId: lead.id, fuId: id };
    });

    await page.goto(`/#lead/${leadId}`);

    const dncBox = page.locator('label', { hasText: 'Do Not Call' }).locator('input[type=checkbox]');
    await dncBox.check();

    await expect
      .poll(() => page.evaluate((id) => (window as any).db.leads.find((l: any) => l.id === id)?.dnc, leadId))
      .toBe(true);
    await expect
      .poll(() => page.evaluate((id) => (window as any).db.leads.find((l: any) => l.id === id)?.status, leadId))
      .toBe('do_not_call');

    // setDnc()'s cascade (src/features/leads.js) only cancels a lead's
    // pending follow-ups on the 'dncontact' path, not plain 'dnc' — confirm
    // the follow-up is untouched by Do Not Call alone rather than assuming
    // it mirrors logActivity()'s own (different) DNC cascade.
    let fuStatus = await page.evaluate((id) => (window as any).db.followUps.find((f: any) => f.id === id)?.status, fuId);
    expect(fuStatus).toBe('pending');

    const dncontactBox = page.locator('label', { hasText: 'Do Not Contact (blocks everything)' }).locator('input[type=checkbox]');
    await dncontactBox.check();

    await expect
      .poll(() => page.evaluate((id) => (window as any).db.leads.find((l: any) => l.id === id)?.dncontact, leadId))
      .toBe(true);
    await expect
      .poll(() => page.evaluate((id) => (window as any).db.leads.find((l: any) => l.id === id)?.status, leadId))
      .toBe('do_not_contact');

    // Now the dncontact path's own cascade should cancel the still-pending
    // follow-up.
    await expect
      .poll(() => page.evaluate((id) => (window as any).db.followUps.find((f: any) => f.id === id)?.status, fuId))
      .toBe('cancelled');
  });

  test('adding a note appends it to window.db.notes and renders on the page', async ({ page }) => {
    const leadId = await page.evaluate(() => (window as any).visibleLeads()[0].id);
    await page.goto(`/#lead/${leadId}`);

    const noteText = `Playwright note ${Date.now()}`;
    await page.locator('#noteIn').fill(noteText);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText(noteText)).toBeVisible();

    const note = await page.evaluate(
      ({ id, text }) => (window as any).db.notes.find((n: any) => n.leadId === id && n.text === text),
      { id: leadId, text: noteText },
    );
    expect(note).toBeTruthy();
    expect(note.leadId).toBe(leadId);
  });
});

test.describe('create a list', () => {
  // manageLists isn't in AGENT_BASE (src/core/permissions.js) — only
  // managers/admins see the "+ New list" button on the Lists screen.
  test('manager can create a new prospecting list', async ({ page }) => {
    await loginAsDemo(page, MANAGER);
    await page.goto('/#lists');

    await page.getByRole('button', { name: '+ New list' }).click();
    await expect(page.locator('#dlg')).toBeVisible();

    const name = `Playwright List ${Date.now()}`;
    await page.locator('#ln').fill(name);
    await page.locator('#lOk').click();
    await expect(page.locator('#dlg[open]')).toHaveCount(0);

    await expect
      .poll(() => page.evaluate((n) => (window as any).db.lists.some((l: any) => l.name === n), name))
      .toBe(true);
    await expect(page.locator('.card', { hasText: name })).toBeVisible();
  });
});
