// Stage 15 e2e: list → campaign → mark sent → log reply.
//
// campaignPanel() (src/features/campaigns.js) only shows a Send button for
// a card whose status is draft/ready, and only offers "Log reply" once a
// card is sent/replied — so this test sets up a known campaignLeads card
// directly via window.db (the same live-getter the performance spec relies
// on) rather than hunting the seed for a lead in exactly the right state,
// then drives the actual Send → confirm → Log reply UI.
import { expect, test } from '@playwright/test';
import { AGENT, OWNER, loginAsDemo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page, AGENT);
});

test('sending a campaign text then logging a reply updates the card status', async ({ page }) => {
  const setup = await page.evaluate(() => {
    const lead = (window as any).visibleLeads().find((l: any) => l.phones[0]?.n);
    let campaign = (window as any).db.campaigns[0];
    // Make sure this lead is actually in the campaign, in a "draft" state.
    let card = (window as any).db.campaignLeads.find((c: any) => c.leadId === lead.id && c.campaignId === campaign.id);
    if (!card) {
      card = { id: Math.max(0, ...(window as any).db.campaignLeads.map((c: any) => c.id)) + 1, campaignId: campaign.id, leadId: lead.id, body: null, status: 'draft', sentAt: null, sentBy: null, repliedAt: null };
      (window as any).db.campaignLeads.push(card);
    } else {
      Object.assign(card, { status: 'draft', sentAt: null, sentBy: null, repliedAt: null });
    }
    // campaignPanel() (features/campaigns.js) picks selectedCampaign(l) —
    // state.wsCampaign[l.id] if set, else the lead's first campaign — and
    // the Send button's onclick is wired to *that* campaign's id. If the
    // lead already belongs to another campaign that would otherwise be
    // picked first, force selection onto the one this test just set up so
    // Send/confirm actually touch our card instead of a different one.
    (window as any).state.wsCampaign = (window as any).state.wsCampaign || {};
    (window as any).state.wsCampaign[lead.id] = campaign.id;
    (window as any).state.queueList = null;
    (window as any).state.queueIdx = 0;
    return { leadId: lead.id, cardId: card.id, campaignId: campaign.id };
  });

  await page.goto(`/#lead/${setup.leadId}`);
  await expect(page.locator('[data-testid="campaign-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="campaign-text"]')).not.toBeEmpty();
  await expect(page.locator('[data-testid="send-campaign"]')).toBeVisible();

  // send-campaign is a real <a href="sms:...">; clicking it through
  // Playwright makes Chromium attempt (and abort) that sms: navigation,
  // which reliably wedges this environment's headless build so no further
  // real mouse click reaches the page afterwards (reproduced outside the
  // suite: even page.mouse.click() at the exact button coordinates stops
  // dispatching once an aborted sms: navigation is in flight). The visible
  // Send button above is still asserted on, but the "tap Send" step itself
  // is done the way onclick="...;sendingCampaign(...)" actually does it —
  // opening the same confirmation dialog sendingCampaign() (features/
  // campaigns.js) renders — so the rest of the flow (confirm → mark sent)
  // is driven through the real UI.
  await page.evaluate(({ leadId, campaignId }) => (window as any).sendingCampaign(leadId, campaignId), {
    leadId: setup.leadId, campaignId: setup.campaignId,
  });
  await expect(page.locator('[data-testid="sending-text"]')).toBeVisible();
  await page.locator('[data-testid="confirm-sent"]').click();

  await expect(page.locator('.toast')).toContainText(/sent/i);
  await expect
    .poll(() => page.evaluate((id) => (window as any).db.campaignLeads.find((c: any) => c.id === id)?.status, setup.cardId))
    .toBe('sent');

  // Reload so campaignPanel() re-renders with the now-sent card and offers
  // the "Log reply" action.
  await page.goto(`/#lead/${setup.leadId}`);
  await page.getByRole('button', { name: '↩ Log reply' }).click();
  await expect(page.locator('#dlg')).toBeVisible();
  await page.locator('#dlg textarea#rn').fill('Playwright e2e: interested, call back Tuesday.');
  await page.locator('#dlg #rOk').click();

  await expect(page.locator('.toast')).toContainText(/reply logged/i);
  const finalStatus = await page.evaluate((id) => (window as any).db.campaignLeads.find((c: any) => c.id === id)?.status, setup.cardId);
  expect(finalStatus).toBe('replied');
});

test('full lifecycle: draft to ready to sent to replied', async ({ page }) => {
  // "Mark all drafts ready" (views/campaigns.js's markAllDraftsReady()/its
  // inline local-backend onclick) is gated behind manageCampaigns, which
  // AGENT_BASE doesn't carry (src/core/permissions.js) — sign in as the
  // owner (every permission via superAdmin) for this whole flow instead of
  // juggling a role switch mid-test. beforeEach already signed in as AGENT
  // and the demo session persists across page.goto('/') (it's saved in the
  // browser, per the app's own demo banner), so the login picker won't
  // reappear without first signing out via the real signOut() (core/
  // session.js, exposed on window by src/main.js).
  await page.evaluate(() => (window as any).signOut());
  await loginAsDemo(page, OWNER);

  const setup = await page.evaluate(() => {
    const lead = (window as any).visibleLeads().find((l: any) => l.phones[0]?.n);
    const campaign = (window as any).db.campaigns[0];
    let card = (window as any).db.campaignLeads.find((c: any) => c.leadId === lead.id && c.campaignId === campaign.id);
    if (!card) {
      card = { id: Math.max(0, ...(window as any).db.campaignLeads.map((c: any) => c.id)) + 1, campaignId: campaign.id, leadId: lead.id, body: null, status: 'draft', sentAt: null, sentBy: null, repliedAt: null };
      (window as any).db.campaignLeads.push(card);
    } else {
      Object.assign(card, { status: 'draft', sentAt: null, sentBy: null, repliedAt: null });
    }
    (window as any).state.wsCampaign = (window as any).state.wsCampaign || {};
    (window as any).state.wsCampaign[lead.id] = campaign.id;
    (window as any).state.queueList = null;
    (window as any).state.queueIdx = 0;
    return { leadId: lead.id, cardId: card.id, campaignId: campaign.id };
  });

  // ---- draft -> ready, via the real "Mark all drafts ready" button ----
  await page.goto(`/#campaign/${setup.campaignId}`);
  await page.getByRole('button', { name: 'Mark all drafts ready' }).click();

  await expect
    .poll(() => page.evaluate((id) => (window as any).db.campaignLeads.find((c: any) => c.id === id)?.status, setup.cardId))
    .toBe('ready');

  // The lead's own campaign-panel badge should reflect "Ready" too.
  await page.goto(`/#lead/${setup.leadId}`);
  await expect(page.locator('[data-testid="campaign-panel"]')).toContainText('Ready');

  // ---- ready -> sent (same real confirm-dialog flow as the test above) ----
  await page.evaluate(({ leadId, campaignId }) => (window as any).sendingCampaign(leadId, campaignId), {
    leadId: setup.leadId, campaignId: setup.campaignId,
  });
  await expect(page.locator('[data-testid="sending-text"]')).toBeVisible();
  await page.locator('[data-testid="confirm-sent"]').click();

  await expect(page.locator('.toast')).toContainText(/sent/i);
  await expect
    .poll(() => page.evaluate((id) => (window as any).db.campaignLeads.find((c: any) => c.id === id)?.status, setup.cardId))
    .toBe('sent');

  // ---- sent -> replied ----
  await page.goto(`/#lead/${setup.leadId}`);
  await page.getByRole('button', { name: '↩ Log reply' }).click();
  await expect(page.locator('#dlg')).toBeVisible();
  await page.locator('#dlg textarea#rn').fill('Playwright e2e: full lifecycle test.');
  await page.locator('#dlg #rOk').click();

  await expect(page.locator('.toast')).toContainText(/reply logged/i);
  await expect
    .poll(() => page.evaluate((id) => (window as any).db.campaignLeads.find((c: any) => c.id === id)?.status, setup.cardId))
    .toBe('replied');
});
