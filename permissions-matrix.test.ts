// GATE G2: regression-test safety net for the permission primitives —
// can()/canUser()/sameTeam()/roleOf()/isSuperAdmin() in
// src/core/permissions.js. Purely sync, in-memory logic, so every case
// below is a plain synchronous assertion against the real imported
// functions (no reimplementation of the rules to compare against itself).
//
// Fixtures (temporary roles/members/teams) are pushed into the real,
// shared `db` (src/data/persist.js) additively and removed again in
// afterAll, leaving db.members/db.roles/db.teams exactly as this file
// found them — other test files in this vitest worker may run in the
// same process and share that module state.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;

const persistMod: any = await import('../../src/data/persist.js');
const sessionMod: any = await import('../../src/core/session.js');
const permMod: any = await import('../../src/core/permissions.js');

const { db } = persistMod;
const { setMe } = sessionMod;
const { can, canUser, sameTeam, roleOf, isSuperAdmin } = permMod;
const { PERMISSIONS, defaultRoles, LEGACY_CAP } = permMod;

// -------------------------------------------------------------- fixtures
// Temp ids, well out of the seed's range, so they never collide with real
// seed rows and are trivially identifiable for cleanup.
const TEMP_BASE = 900000;
let nextTempId = TEMP_BASE;
const freshId = () => ++nextTempId;

const addedRoleIds: any[] = [];
const addedMemberIds: any[] = [];
const addedTeamIds: any[] = [];

/** Installs a role object into db.roles if a role with that id isn't
 * already there (built-in roles may already have been added by
 * upgradeDb() when the seed was first loaded). Returns the installed (or
 * pre-existing) role object. Only roles this function actually added are
 * tracked for removal in afterAll. */
function ensureRole(role: any) {
  const existing = db.roles.find((r: any) => r.id === role.id);
  if (existing) return existing;
  db.roles.push(role);
  addedRoleIds.push(role.id);
  return role;
}

/** A throwaway member with the given role id (and any extra fields),
 * pushed into db.members and tracked for removal in afterAll. */
function addMember(roleId: any, extra = {}) {
  const m = { id: freshId(), name: `Fixture ${roleId} ${nextTempId}`, email: `fixture${nextTempId}@test.local`, role: roleId, active: true, ...extra };
  db.members.push(m);
  addedMemberIds.push(m.id);
  return m;
}

function addTeam(team: any) {
  const t = { id: freshId(), name: 'Fixture team', description: '', color: '#000', logo: null, managerId: null, memberIds: [], listIds: [], campaignIds: [], archived: false, createdAt: new Date().toISOString(), ...team };
  db.teams.push(t);
  addedTeamIds.push(t.id);
  return t;
}

// The 6 built-in roles, with their *real* perms objects straight from the
// pure, exported defaultRoles() — installed into db.roles (deduped) and
// given one throwaway member each, so can()/roleOf() resolve them exactly
// as they would for a real signed-in user of that role.
const ROLES = defaultRoles();
const roleMembers: any = {}; // roleId -> member

beforeAll(() => {
  for (const role of ROLES) {
    ensureRole(role);
    roleMembers[role.id] = addMember(role.id);
  }
});

afterAll(() => {
  // Members and teams are purely additive rows we created — drop them by id.
  for (const id of addedMemberIds) {
    const i = db.members.findIndex((m: any) => m.id === id);
    if (i !== -1) db.members.splice(i, 1);
  }
  for (const id of addedTeamIds) {
    const i = db.teams.findIndex((t: any) => t.id === id);
    if (i !== -1) db.teams.splice(i, 1);
  }
  // Roles: only remove the ones *this file* installed (built-ins that were
  // already present before this file ran are left untouched).
  for (const id of addedRoleIds) {
    const i = db.roles.findIndex((r: any) => r.id === id);
    if (i !== -1) db.roles.splice(i, 1);
  }
  setMe(null);
});

/** What can()/canUser() should return for `cap` given a role's own perms
 * object — the same rule the source encodes (superAdmin always wins,
 * otherwise look the (possibly legacy-mapped) key up in perms). Computed
 * from the role's *own* data, never by re-deriving can()'s control flow,
 * so this is a genuine oracle rather than a copy of the implementation. */
function expectedFor(role: any, cap: any) {
  if (role.superAdmin) return true;
  const key = (LEGACY_CAP as any)[cap] || cap;
  return !!role.perms[key];
}

// ============================================================ 1) can() matrix
describe('can() — every built-in role x every permission key', () => {
  for (const role of ROLES) {
    describe(`role: ${role.id}`, () => {
      beforeAll(() => setMe(roleMembers[role.id]));

      it.each(PERMISSIONS as any[])('%s', (key) => {
        expect(can(key)).toBe(expectedFor(role, key));
      });
    });
  }
});

// ==================================================== 2) superAdmin override
describe('superAdmin override', () => {
  it('can() is true for a superAdmin role even when perms explicitly denies the key', () => {
    const perms = { ...permMod.ALL_PERMS() };
    const probeKey = PERMISSIONS[0][0];
    perms[probeKey] = false; // explicitly denied in the perms object itself
    const role = ensureRole({ id: `super_override_${freshId()}`, name: 'Super override fixture', builtIn: false, superAdmin: true, perms });
    const member = addMember(role.id);
    setMe(member);
    expect(role.perms[probeKey]).toBe(false); // sanity: the denial is really there
    expect(can(probeKey)).toBe(true); // superAdmin still overrides it
    expect(canUser(member, probeKey)).toBe(true);
  });
});

// ======================================================= 3) LEGACY_CAP mapping
describe('LEGACY_CAP mapping', () => {
  it('can("archiveLeads") always matches can("deleteLeads") for the same role', () => {
    setMe(roleMembers.manager); // ADMIN_BASE includes deleteLeads
    expect(can('deleteLeads')).toBe(true);
    expect(can('archiveLeads')).toBe(can('deleteLeads'));

    setMe(roleMembers.agent); // AGENT_BASE does not include deleteLeads
    expect(can('deleteLeads')).toBe(false);
    expect(can('archiveLeads')).toBe(can('deleteLeads'));
  });

  it('can("manageMembers") always matches can("editUsers") for the same role', () => {
    setMe(roleMembers.manager); // ADMIN_BASE includes editUsers
    expect(can('editUsers')).toBe(true);
    expect(can('manageMembers')).toBe(can('editUsers'));

    setMe(roleMembers.agent); // AGENT_BASE does not include editUsers
    expect(can('editUsers')).toBe(false);
    expect(can('manageMembers')).toBe(can('editUsers'));
  });

  it('canUser() resolves the same legacy mapping independent of me', () => {
    setMe(null);
    expect(canUser(roleMembers.manager, 'archiveLeads')).toBe(canUser(roleMembers.manager, 'deleteLeads'));
    expect(canUser(roleMembers.agent, 'archiveLeads')).toBe(canUser(roleMembers.agent, 'deleteLeads'));
    expect(canUser(roleMembers.manager, 'manageMembers')).toBe(canUser(roleMembers.manager, 'editUsers'));
    expect(canUser(roleMembers.agent, 'manageMembers')).toBe(canUser(roleMembers.agent, 'editUsers'));
  });
});

// ========================================================= 4) canUser() matrix
describe('canUser() — every built-in role x every permission key, independent of me', () => {
  for (const role of ROLES) {
    describe(`role: ${role.id}`, () => {
      // Deliberately set `me` to someone of a *different* role (or nobody
      // at all) before each assertion, so a pass here proves canUser()
      // reads the passed-in member, not the module-level `me`.
      const other = ROLES.find((r: any) => r.id !== role.id) || role;

      it.each(PERMISSIONS as any[])('%s (me = a different role)', (key) => {
        setMe(roleMembers[other.id]);
        expect(canUser(roleMembers[role.id], key)).toBe(expectedFor(role, key));
      });

      it.each(PERMISSIONS as any[])('%s (me = null)', (key) => {
        setMe(null);
        expect(canUser(roleMembers[role.id], key)).toBe(expectedFor(role, key));
      });
    });
  }
});

// ============================================ 5) no signed-in / no member
describe('can()/canUser() with no member', () => {
  it('can(cap) is false for every permission key when me is null', () => {
    setMe(null);
    for (const [key] of PERMISSIONS) expect(can(key)).toBe(false);
  });

  // canUser(m, cap) resolves via roleOf(m), and roleOf's own fallback
  // (`db.roles.find(r=>r.id===m?.role) || db.roles.find(r=>r.id==="viewer")`)
  // means a null/undefined member resolves to the viewer role rather than
  // "no role" — so canUser(null/undefined, cap) mirrors the viewer role's
  // own perms, exactly like roleOf()'s documented fallback (see the
  // "roleOf() fallback to viewer" suite below), not a blanket false.
  it('canUser(null, cap) falls back to the viewer role, matching roleOf(null)', () => {
    const viewerRole = ROLES.find((r: any) => r.id === 'viewer');
    expect(roleOf(null).id).toBe('viewer');
    for (const [key] of PERMISSIONS) expect(canUser(null, key)).toBe(expectedFor(viewerRole, key));
  });

  it('canUser(undefined, cap) falls back to the viewer role, matching roleOf(undefined)', () => {
    const viewerRole = ROLES.find((r: any) => r.id === 'viewer');
    expect(roleOf(undefined).id).toBe('viewer');
    for (const [key] of PERMISSIONS) expect(canUser(undefined, key)).toBe(expectedFor(viewerRole, key));
  });
});

// ==================================================== 6) roleOf() fallback
describe('roleOf() fallback to viewer', () => {
  it('a member whose role id does not exist in db.roles resolves to the viewer role', () => {
    const ghost = addMember('no_such_role_id_xyz');
    const resolved = roleOf(ghost);
    expect(resolved).toBeTruthy();
    expect(resolved.id).toBe('viewer');
  });

  it('can() for such a member matches the viewer role perms exactly, not blanket-deny', () => {
    const ghost = addMember('another_bogus_role');
    setMe(ghost);
    const viewerRole = ROLES.find((r: any) => r.id === 'viewer');
    for (const [key] of PERMISSIONS) {
      expect(can(key)).toBe(expectedFor(viewerRole, key));
    }
    // Prove it's really "falls back to viewer", not "everything happens to
    // be false": viewer does grant some permissions, and this member gets them.
    const grantedKey = Object.keys(viewerRole!.perms).find(k => viewerRole!.perms[k]);
    expect(grantedKey).toBeTruthy();
    expect(can(grantedKey)).toBe(true);
  });

  it('isSuperAdmin() is false for a member falling back to viewer', () => {
    const ghost = addMember('yet_another_bogus_role');
    expect(isSuperAdmin(ghost)).toBe(false);
  });
});

// ============================================================== 7) sameTeam()
describe('sameTeam()', () => {
  let me_: any, teammate: any, archivedOnly: any, stranger: any;

  beforeAll(() => {
    me_ = addMember('agent');
    teammate = addMember('agent');
    archivedOnly = addMember('agent');
    stranger = addMember('agent');

    addTeam({ name: 'Shared active team', memberIds: [me_.id, teammate.id], archived: false });
    // me_ and archivedOnly share ONLY an archived team — no other shared team.
    addTeam({ name: 'Old disbanded team', memberIds: [me_.id, archivedOnly.id], archived: true });
    // stranger shares no team with me_ at all.

    setMe(me_);
  });

  it('sameTeam(me.id) is true (self)', () => {
    expect(sameTeam(me_.id)).toBe(true);
  });

  it('sameTeam() is true for a member sharing a non-archived team', () => {
    expect(sameTeam(teammate.id)).toBe(true);
  });

  it('sameTeam() is false for a member sharing only an archived team', () => {
    expect(sameTeam(archivedOnly.id)).toBe(false);
  });

  it('sameTeam() is false for a member with no shared team at all', () => {
    expect(sameTeam(stranger.id)).toBe(false);
  });
});
