// Audit fix (post-Stage-15): Stage 14 gated dealCard()/deal.js/crmdash.js
// behind viewPrices/viewCommissions but missed the CRM board's own page
// header ("$X potential · $Y net · $Z weighted forecast") and every
// column's crm-stats row (src/views/crm.js) — both kept showing
// pipeline-wide dollar totals to a role whose per-card money was already
// hidden. This checks both surfaces now follow the same permission.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('CRM board — viewPrices / viewCommissions gate the header and column totals too', () => {
  let db: any, nid: any, setMe: any, state: any, V: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const permsMod: any = await import('../../src/core/permissions.js');
    const stateMod: any = await import('../../src/core/state.js');
    await import('../../src/views/crm.js'); // registers V.crm
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe; state = stateMod.state; V = stateMod.V;
    Object.defineProperty(window, 'me', { get: () => sessionMod.me, configurable: true });
    (window as any).can = permsMod.can;
  });

  function memberWithPerms(perms: any){
    const roleId = 'crmboard_test_role_' + nid();
    db.roles.push({ id: roleId, name: 'CRM board test role', builtIn:false, superAdmin:false, perms: Object.fromEntries(Object.keys(db.roles[0].perms).map(k=>[k, perms.includes(k)])) });
    const m = { id: nid(), name:'Test Member', email:`t${nid()}@test.com`, role: roleId, active:true };
    db.members.push(m);
    return m;
  }

  function renderBoard(){ state.crm = null; state.crmPipe = null; state.crmCol = 0; return V.crm(); }

  it('hides potential/net/weighted dollar figures from the page header and column stats when both permissions are off', () => {
    setMe(memberWithPerms([]));
    const html = renderBoard();
    expect(html).not.toMatch(/potential/);
    expect(html).not.toMatch(/weighted forecast/);
    expect(html).not.toMatch(/title="Potential sales volume"/);
    expect(html).not.toMatch(/title="Potential net commission"/);
  });

  it('shows price figures but not commission/net/weighted with only viewPrices', () => {
    setMe(memberWithPerms(['viewPrices']));
    const html = renderBoard();
    expect(html).toMatch(/potential/);
    expect(html).not.toMatch(/weighted forecast/);
    expect(html).toMatch(/title="Potential sales volume"/);
    expect(html).not.toMatch(/title="Potential net commission"/);
  });

  it('shows net/weighted but not potential price with only viewCommissions', () => {
    setMe(memberWithPerms(['viewCommissions']));
    const html = renderBoard();
    expect(html).not.toMatch(/potential/);
    expect(html).toMatch(/weighted forecast/);
    expect(html).not.toMatch(/title="Potential sales volume"/);
    expect(html).toMatch(/title="Potential net commission"/);
  });

  it('shows everything with both permissions on', () => {
    setMe(memberWithPerms(['viewPrices', 'viewCommissions']));
    const html = renderBoard();
    expect(html).toMatch(/potential/);
    expect(html).toMatch(/weighted forecast/);
    expect(html).toMatch(/title="Potential sales volume"/);
    expect(html).toMatch(/title="Potential net commission"/);
  });
});
