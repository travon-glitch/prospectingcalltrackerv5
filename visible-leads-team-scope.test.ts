// GATE G5 / Part B — proves visibleLeads() (and canSee(), the single-lead
// check it shares per the Stage 14 fix documented in
// tests/unit/visible-leads.test.ts) correctly DENIES visibility across two
// DISTINCT named teams, not just "team member vs. no-team outsider" (which
// visible-leads.test.ts already covers). Same mock/import style as that
// file so it sits alongside it.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('visibleLeads() — denies across two distinct named teams', () => {
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

  it('a Team A viewer (isa_manager, viewTeamLeads only — no viewAllLeads) cannot see a Team B member\'s lead, but can see a fellow Team A member\'s lead', () => {
    // Team A: a manager (the viewer under test) + a second agent member
    // whose own lead should remain visible (the positive/sanity check).
    const managerA = { id: nid(), name:'Manager A', email:'mgrA@test.com', role:'isa_manager', active:true };
    const agentA2  = { id: nid(), name:'Agent A2',  email:'a2@test.com',   role:'agent',       active:true };
    // Team B: two distinct members, unrelated to Team A.
    const managerB = { id: nid(), name:'Manager B', email:'mgrB@test.com', role:'isa_manager', active:true };
    const agentB2  = { id: nid(), name:'Agent B2',  email:'b2@test.com',   role:'agent',       active:true };
    db.members.push(managerA, agentA2, managerB, agentB2);

    const teamAId = nid(), teamBId = nid();
    db.teams.push(
      { id: teamAId, name:'Team A', archived:false, memberIds:[managerA.id, agentA2.id] },
      { id: teamBId, name:'Team B', archived:false, memberIds:[managerB.id, agentB2.id] },
    );

    // A lead owned by a Team B member — must be DENIED to a Team A viewer.
    const teamBLead = freshLead(agentB2.id);
    // A lead owned by managerA's own Team A teammate — must remain VISIBLE
    // (proves this is selective denial, not a global lockout bug).
    const teamALead = freshLead(agentA2.id);

    // managerA's role (isa_manager, per defaultRoles()/MANAGER_BASE) has
    // viewTeamLeads but explicitly NOT viewAllLeads — exactly the scope
    // this test needs to exercise.
    setMe(managerA);

    // canSee() parity: single-lead check must agree with the list.
    expect(canSee(teamBLead)).toBe(false);
    expect(canSee(teamALead)).toBe(true);

    const visibleIds = visibleLeads().map((l: any) => l.id);
    expect(visibleIds).not.toContain(teamBLead.id);
    expect(visibleIds).toContain(teamALead.id);
  });
});
