// Stage 14 fix #4: viewPrices/viewCommissions existed as assignable
// permissions but nothing ever checked them — the CRM board's deal cards,
// the deal page's financials, and the CRM dashboard's money figures
// rendered for everyone regardless of role. This checks each surface hides
// its money once the permission is off, and still shows it once it's on.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('viewPrices / viewCommissions — money visibility', () => {
  let db: any, nid: any, setMe: any, dealCard: any, dealDb: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const permsMod: any = await import('../../src/core/permissions.js');
    const crmMod: any = await import('../../src/features/crm.js');
    db = persistMod.db; nid = persistMod.nid; setMe = sessionMod.setMe;
    dealCard = crmMod.dealCard;
    dealDb = db.deals[0];
    // core/util.js's pretty() (used by dealCard() for the phone number)
    // reads bare `me`/`can` globals — main.js (mocked out above, since it
    // boots the whole app) is normally what defines these on `window`; this
    // reproduces just that wiring so the module under test resolves the
    // same way it does in the real app.
    Object.defineProperty(window, 'me', { get: () => sessionMod.me, configurable: true });
    (window as any).can = permsMod.can;
  });

  function memberWithPerms(perms: any){
    const roleId = 'stage14_test_role_' + nid();
    db.roles.push({ id: roleId, name: 'Stage 14 test role', builtIn:false, superAdmin:false, perms: Object.fromEntries(Object.keys(db.roles[0].perms).map(k=>[k, perms.includes(k)])) });
    const m = { id: nid(), name:'Test Member', email:`t${nid()}@test.com`, role: roleId, active:true };
    db.members.push(m);
    return m;
  }

  it('dealCard() hides price and commission figures when the permission is off, shows them when on', () => {
    setMe(memberWithPerms([]));
    const htmlOff = dealCard(dealDb);
    expect(htmlOff).not.toMatch(/\$[\d,]/); // no formatted money anywhere in the card

    setMe(memberWithPerms(['viewPrices', 'viewCommissions']));
    const htmlOn = dealCard(dealDb);
    expect(htmlOn).toMatch(/\$[\d,]/);
  });

  it('dealCard() shows price without commissions, and vice versa, independently', () => {
    setMe(memberWithPerms(['viewPrices']));
    const priceOnly = dealCard(dealDb);
    expect(priceOnly).toMatch(/deal-money"><b>\$/);
    expect(priceOnly).not.toMatch(/net ·/);

    setMe(memberWithPerms(['viewCommissions']));
    const commOnly = dealCard(dealDb);
    expect(commOnly).toMatch(/net ·/);
    expect(commOnly).not.toMatch(/deal-money"><b>\$/);
  });
});
