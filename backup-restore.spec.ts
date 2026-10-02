// Backup + restore (Settings → Data & exports), src/data/persist.js.
// The backup half is already covered end to end by exports.spec.ts's own
// '"Save backup" downloads a valid JSON snapshot' test (same
// page.waitForEvent('download') + download.path() pattern, same JSON-shape
// assertions) — this file reuses that same download to get a real backup
// file onto disk, then tests the restore half, which nothing else covers.
//
// Restore handler (src/data/persist.js):
//   $("#restoreIn").addEventListener("change", async (e)=>{
//     const f=e.target.files[0]; e.target.value=""; if(!f) return;
//     if(BACKEND==="supabase"){ toast("Restoring a backup isn't available on
//       this backend — export only."); return; }
//     try{ const j=JSON.parse(await f.text()); if(!j.db||!j.db.leads) throw 0;
//       db=j.db; setMe(db.members.find(m=>m.id===me?.id)||db.members[0]);
//       toast("Backup restored"); go("dashboard"); }
//     catch{ toast("That isn't a valid backup file"); }
//   });
// On the local backend (which this e2e suite runs against) a successful
// restore wholesale-replaces the in-memory `db` with the backup's `db`,
// re-resolves `me` against the restored member list, and navigates to the
// dashboard — it does not reload the page or re-authenticate. `db` is
// exposed on window as a live getter (src/main.js) precisely so a wholesale
// reassignment like this stays visible to page.evaluate() reads afterward.
import { expect, test } from '@playwright/test';
import { OWNER, loginAsDemo } from './helpers.js';

test('a downloaded backup can restore the database to its earlier state', async ({ page }) => {
  await loginAsDemo(page, OWNER);
  await page.goto('/#settings');
  await page.click('[data-tab="data"]');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.actions button:has-text("⇩ Save backup")'),
  ]);
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  // Make a small, detectable change to the live database that postdates the
  // backup: push a marker lead. Only the fields the restore/assertion path
  // actually touches need to be real; this never goes through draw()/the
  // rendered leads table, so it doesn't need the full lead shape.
  const markerFirst = `ZZMarker${Date.now()}`;
  await page.evaluate((first) => {
    (window as any).db.leads.push({ id: (window as any).nid(), first, last: 'PostBackup', phones: [], listIds: [], assigned: null, status: 'new', dnc: false, dnt: false, dncontact: false, archived: false, createdAt: new Date().toISOString() });
  }, markerFirst);
  const markerPresentBefore = await page.evaluate((first) => (window as any).db.leads.some((l: any) => l.first === first), markerFirst);
  expect(markerPresentBefore).toBe(true);

  // Restore that same backup file via the hidden #restoreIn input.
  await page.locator('#restoreIn').setInputFiles(backupPath);

  await expect(page.locator('.toast')).toContainText('Backup restored');
  // go("dashboard") — confirm we actually landed there, not just that a
  // toast fired.
  await expect(page.locator('h2')).toContainText('Welcome back');

  // The marker record was added after the backup was taken, so a real
  // restore (not a no-op) makes it disappear.
  const markerPresentAfter = await page.evaluate((first) => (window as any).db.leads.some((l: any) => l.first === first), markerFirst);
  expect(markerPresentAfter).toBe(false);

  // And the restored database is a genuine, usable snapshot — the leads it
  // shipped with are still there.
  const leadCount = await page.evaluate(() => (window as any).db.leads.length);
  expect(leadCount).toBeGreaterThan(0);
});
