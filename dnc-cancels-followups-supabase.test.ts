// Audit fix (post-Stage-15): on the local backend, marking a lead Do Not
// Contact (setDnc(l,"dncontact",true), src/features/leads.js) also cancels
// every pending follow-up on that lead — the demo's own behavior. The
// Supabase branch only ever patched the leads row and never touched
// follow_ups at all, so a DNC'd lead's follow-up stayed "pending" and kept
// showing as due/overdue. This checks the supabase branch now cancels them
// too, the same way.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));
vi.mock('../../src/data/repo-supabase.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    leads: { ...actual.leads, setDnc: vi.fn().mockResolvedValue(undefined) },
    followUps: {
      ...actual.followUps,
      forLead: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe('setDnc() — supabase backend cancels pending follow-ups on Do Not Contact', () => {
  let db: any, nid: any, setMe, setDnc: any, repoSupabase: any;

  beforeAll(async () => {
    vi.stubEnv('VITE_BACKEND', 'supabase');
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const leadsMod: any = await import('../../src/features/leads.js');
    repoSupabase = await import('../../src/data/repo-supabase.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe;
    setDnc = leadsMod.setDnc;
    setMe(db.members[0]);
  });

  afterAll(() => { vi.unstubAllEnvs(); });

  it('cancels every pending follow-up returned for the lead, leaves non-pending ones alone', async () => {
    const lead = { id: nid(), first:'DNC', last:'Test', email:'', addr:'', city:'', zip:'', phones:[{n:'+14045550123',type:'mobile'}], listIds:[], assigned:db.members[0].id, status:'new', dnc:false, dnt:false, dncontact:false, archived:false, source:'manual', createdAt:new Date().toISOString(), custom:{} };
    db.leads.push(lead);

    const pendingFu = { id: nid(), leadId: lead.id, due:'2026-10-01', status:'pending', note:'call back' };
    const doneFu = { id: nid(), leadId: lead.id, due:'2026-09-01', status:'done', note:'already handled' };
    repoSupabase.followUps.forLead.mockResolvedValue([pendingFu, doneFu]);

    setDnc(lead, 'dncontact', true);
    // setDnc's supabase branch is async (awaits setDnc(), then forLead(),
    // then cancel() for each pending row) — flush microtasks.
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(repoSupabase.leads.setDnc).toHaveBeenCalledWith(lead.id, expect.objectContaining({ dncontact:true, dnc:true, dnt:true }));
    expect(repoSupabase.followUps.cancel).toHaveBeenCalledTimes(1);
    expect(repoSupabase.followUps.cancel).toHaveBeenCalledWith(pendingFu.id, 'Lead marked Do Not Contact', db.members[0].id);

    const updatedPending = db.followUps.find((f: any) => f.id === pendingFu.id);
    expect(updatedPending.status).toBe('cancelled');
    expect(updatedPending.cancelReason).toBe('Lead marked Do Not Contact');

    const updatedDone = db.followUps.find((f: any) => f.id === doneFu.id);
    expect(updatedDone.status).toBe('done'); // untouched — wasn't pending

    expect(lead.dnc).toBe(true);
    expect(lead.dnt).toBe(true);
    expect(lead.dncontact).toBe(true);
    expect(lead.status).toBe('do_not_contact');
  });
});
