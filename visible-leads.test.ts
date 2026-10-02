// Stage 14 fix #2: visibleLeads() (features/activity.js) used to only ever
// include a lead assigned to the viewer themself (or every lead, with
// viewAllLeads) — a role with viewTeamLeads but not viewAllLeads (e.g. the
// seed's "Inside Sales Manager" role) couldn't see a teammate's own leads
// here, even though canSee() — the single-lead check used everywhere
// else — already granted it. This checks the two are consistent again.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('visibleLeads() — team scope parity with canSee()', () => {
  let db: any, nid: any, setMe: any, visibleLeads: any, canSee: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const activityMod: any = await import('../../src/features/activity.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe;
    visibleLeads = activityMod.visibleLeads; canSee = activityMod.canSee;
  });

  function freshLead(assigned: any){
    const l = { id: nid(), first: 'T', last: 'Lead'+nid(), email:'', addr:'', city:'', zip:'', phones:[], listIds:[], assigned, status:'new', dnc:false, dnt:false, dncontact:false, archived:false, source:'manual', createdAt:new Date().toISOString(), custom:{} };
    db.leads.push(l);
    return l;
  }

  it('a viewTeamLeads (not viewAllLeads) manager sees a teammate\'s own lead, and canSee() agrees', () => {
    const manager = { id: nid(), name:'Manager', email:'mgr@test.com', role:'isa_manager', active:true };
    const teammate = { id: nid(), name:'Teammate', email:'mate@test.com', role:'agent', active:true };
    const outsider = { id: nid(), name:'Outsider', email:'out@test.com', role:'agent', active:true };
    db.members.push(manager, teammate, outsider);
    db.teams.push({ id: nid(), name:'QA Team', archived:false, memberIds:[manager.id, teammate.id] });

    const teammateLead = freshLead(teammate.id);
    const outsiderLead = freshLead(outsider.id);

    setMe(manager);
    expect(canSee(teammateLead)).toBe(true);
    expect(canSee(outsiderLead)).toBe(false);

    const visibleIds = visibleLeads().map((l: any)=>l.id);
    expect(visibleIds).toContain(teammateLead.id);
    expect(visibleIds).not.toContain(outsiderLead.id);
  });
});
