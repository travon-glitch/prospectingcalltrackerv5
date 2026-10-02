// Audit fix (post-Stage-15): listToCampaign() (src/views/lists.js) called
// addLeadsToCampaign() and used its return value directly as a lead count
// — fine on the local backend, where it's a plain number, but on the
// Supabase backend addLeadsToCampaign() returns a Promise (it awaits a
// real insert), so the toast read "[object Promise] leads added to the
// campaign" and the code navigated to the campaign page before the insert
// had actually landed. This checks the supabase branch now waits for the
// real count.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));
vi.mock('../../src/data/repo-supabase.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    campaignLeads: { ...actual.campaignLeads, addLeads: vi.fn().mockResolvedValue(3) },
  };
});

describe('listToCampaign() — supabase backend Promise handling', () => {
  let db: any, nid: any, setMe, listToCampaign: any, repoSupabase: any;
  const originalBackend = import.meta.env.VITE_BACKEND;

  beforeAll(async () => {
    vi.stubEnv('VITE_BACKEND', 'supabase');
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    // jsdom doesn't implement <dialog>'s showModal()/close() — openDlg()/
    // closeDlg() (src/core/dialog.js) call them directly, so stub minimal
    // versions the same way a real <dialog> tracks its [open] state.
    if(!HTMLDialogElement.prototype.showModal){
      HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open',''); this.open = true; };
      HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; };
    }
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const listsMod: any = await import('../../src/views/lists.js');
    repoSupabase = await import('../../src/data/repo-supabase.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe;
    listToCampaign = listsMod.listToCampaign;
    setMe(db.members[0]);
  });

  afterAll(() => { vi.unstubAllEnvs(); });

  it('awaits the real count instead of stringifying a pending Promise into the toast', async () => {
    const list = { id: nid(), name: 'Audit test list', archived: false, createdAt: new Date().toISOString() };
    db.lists.push(list);
    const campaign = { id: nid(), name: 'Audit test campaign', type: 'custom', body: 'Hi {{first_name}}', archived: false, createdAt: new Date().toISOString() };
    db.campaigns.push(campaign);
    db.leads.push({ id: nid(), first:'A', last:'One', email:'', addr:'', city:'', zip:'', phones:[], listIds:[list.id], assigned:db.members[0].id, status:'new', dnc:false, dnt:false, dncontact:false, archived:false, source:'manual', createdAt:new Date().toISOString(), custom:{} });

    listToCampaign(list.id);
    (document.getElementById('aC') as any)!.value = String(campaign.id);
    document.getElementById('aOk')!.click();

    // The click handler's own work is async (awaits the mocked Promise);
    // flush microtasks before asserting.
    await new Promise(r => setTimeout(r, 0));

    expect(repoSupabase.campaignLeads.addLeads).toHaveBeenCalled();
    const toastText = document.getElementById('toast')!.textContent;
    expect(toastText).toBe('3 leads added to the campaign');
    expect(toastText).not.toMatch(/object Promise/);
  });
});
