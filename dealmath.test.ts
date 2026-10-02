// GATE G2: pure-JS unit tests for features/crm.js's dealMath() (the
// commission/forecast math: gross -> minus referral -> minus brokerage
// split/fee -> minus closing costs = net; net split team/agent by
// teamSplitPct; weighted = net * stage probability). Covers zero,
// negative, rounding/float, junk-string and no-stage edge cases, plus one
// fully hand-computed realistic scenario. Every assertion is against the
// real imported dealMath()/num()/pct() from src/features/crm.js — never a
// reimplementation compared to itself.
//
// crm.js pulls in a wide import chain (core/dialog.js, core/permissions.js,
// core/router.js, core/session.js, data/persist.js, data/repo-supabase.js,
// main.js for `draw`), so this file follows the exact same import-chain
// setup already used successfully by tests/unit/stats.test.ts: mock
// main.js's `draw`, stub the DOM bits crm.js's module-load path touches,
// then dynamic-import crm.js.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;

// crm.js <-> data/persist.js <-> data/seed.js have a circular import
// (seed.js calls crm.js's newPipeline() at module-init time), so - exactly
// like tests/unit/stats.test.ts - persist.js must be imported (and thus
// finish its module graph resolution) before features/crm.js is used, or
// newPipeline is still undefined when seed() runs.
await import('../../src/data/persist.js');
const crmMod: any = await import('../../src/features/crm.js');
const { dealMath, num, pct } = crmMod;

describe('num()', () => {
  it('strips currency formatting and keeps digits/./-', () => {
    expect(num('$425,000.50')).toBe(425000.5);
    expect(num('425,000')).toBe(425000);
  });

  it('returns 0 for undefined', () => {
    expect(num(undefined)).toBe(0);
  });

  it('returns 0 when parseFloat on the stripped string is NaN', () => {
    // "not a number" strips (regex keeps [0-9.\-]) down to "" (no digits,
    // dots or hyphens survive) -> parseFloat("") is NaN -> Number.isFinite
    // guard falls back to 0.
    expect(num('not a number')).toBe(0);
  });
});

describe('pct() clamps to [0,100]', () => {
  it('clamps below 0 and above 100, passes through in-range', () => {
    expect(pct(-10)).toBe(0);
    expect(pct(150)).toBe(100);
    expect(pct(50)).toBe(50);
  });
});

describe('dealMath() - zero cases', () => {
  it('price:0 -> every output field is 0 regardless of other percentages', () => {
    const r = dealMath({ price: 0, commPct: 50, referralPct: 25, brokeragePct: 20, brokerageFee: 100, closingCosts: 50, teamSplitPct: 70 }, { prob: 80 });
    expect(r.price).toBe(0);
    expect(r.gross).toBe(0);
    expect(r.referral).toBe(0);
    expect(r.brokerage).toBe(100); // brokerageFee is a flat add, independent of price
    expect(r.net).toBe(0); // clamped at 0 by Math.max(0, afterBrok - closingCosts)
    expect(r.teamShare).toBe(0);
    expect(r.agentShare).toBe(0);
    expect(r.weighted).toBe(0);
  });

  it('commPct:0 -> gross and everything downstream is 0', () => {
    const r = dealMath({ price: 400000, commPct: 0, referralPct: 25, brokeragePct: 20, brokerageFee: 0, closingCosts: 0, teamSplitPct: 70 }, { prob: 80 });
    expect(r.gross).toBe(0);
    expect(r.referral).toBe(0);
    expect(r.brokerage).toBe(0);
    expect(r.net).toBe(0);
    expect(r.teamShare).toBe(0);
    expect(r.agentShare).toBe(0);
    expect(r.weighted).toBe(0);
  });

  it('all fields 0/undefined and no stage -> every field 0, prob 0', () => {
    const r = dealMath({}, undefined);
    expect(r).toEqual({
      price: 0, gross: 0, referral: 0, brokerage: 0, net: 0,
      teamShare: 0, agentShare: 0, prob: 0, weighted: 0,
    });
  });
});

describe('dealMath() - negative inputs propagate through (not clamped, by design)', () => {
  it('negative price flows through as negative gross/referral/brokerage, but net/agentShare/teamShare floor at 0', () => {
    // num() does NOT clamp price - only pct() clamps percent fields.
    // Math.max(0, ...) only guards afterBrok and net, not gross/referral/
    // brokerage themselves. Hand-traced: gross=-100000*6/100=-6000;
    // referral=-6000*25/100=-1500; afterRef=-6000-(-1500)=-4500;
    // brokerage=-4500*20/100+0=-900; afterBrok=max(0,-4500-(-900))=max(0,-3600)=0;
    // net=max(0,0-500)=0.
    const r = dealMath({ price: -100000, commPct: 6, referralPct: 25, brokeragePct: 20, brokerageFee: 0, closingCosts: 500, teamSplitPct: 70 }, { prob: 80 });
    expect(r.price).toBe(-100000);
    expect(r.gross).toBe(-6000);
    expect(r.referral).toBe(-1500);
    expect(r.brokerage).toBe(-900);
    expect(r.net).toBe(0);
    expect(r.teamShare).toBe(0);
    expect(r.agentShare).toBe(0);
    expect(r.weighted).toBe(0);
  });

  it('negative brokerageFee (a credit) and negative closingCosts (a credit) both flow through via num(), uncapped', () => {
    // Hand-traced: gross=100000*6/100=6000; referral=6000*25/100=1500;
    // afterRef=4500; brokerage=4500*20/100+(-200)=900-200=700;
    // afterBrok=max(0,4500-700)=3800; net=max(0,3800-(-500))=max(0,4300)=4300.
    const r = dealMath({ price: 100000, commPct: 6, referralPct: 25, brokeragePct: 20, brokerageFee: -200, closingCosts: -500, teamSplitPct: 70 }, { prob: 80 });
    expect(r.gross).toBe(6000);
    expect(r.referral).toBe(1500);
    expect(r.brokerage).toBe(700);
    expect(r.net).toBe(4300);
    expect(r.teamShare).toBe(3010);
    expect(r.agentShare).toBe(1290);
    expect(r.weighted).toBe(3440);
  });

  it('negative or >100 commPct is clamped by pct() to 0/100', () => {
    const base = { price: 100000, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 };
    expect(dealMath({ ...base, commPct: -10 }, null).gross).toBe(dealMath({ ...base, commPct: 0 }, null).gross);
    expect(dealMath({ ...base, commPct: 150 }, null).gross).toBe(dealMath({ ...base, commPct: 100 }, null).gross);
  });

  it('negative or >100 referralPct is clamped by pct() to 0/100', () => {
    const base = { price: 100000, commPct: 10, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 };
    expect(dealMath({ ...base, referralPct: -10 }, null).referral).toBe(dealMath({ ...base, referralPct: 0 }, null).referral);
    expect(dealMath({ ...base, referralPct: 150 }, null).referral).toBe(dealMath({ ...base, referralPct: 100 }, null).referral);
  });

  it('negative or >100 brokeragePct is clamped by pct() to 0/100', () => {
    const base = { price: 100000, commPct: 10, referralPct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 };
    expect(dealMath({ ...base, brokeragePct: -10 }, null).brokerage).toBe(dealMath({ ...base, brokeragePct: 0 }, null).brokerage);
    expect(dealMath({ ...base, brokeragePct: 150 }, null).brokerage).toBe(dealMath({ ...base, brokeragePct: 100 }, null).brokerage);
  });

  it('negative or >100 teamSplitPct is clamped by pct() to 0/100', () => {
    const base = { price: 100000, commPct: 10, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0 };
    expect(dealMath({ ...base, teamSplitPct: -10 }, null).teamShare).toBe(dealMath({ ...base, teamSplitPct: 0 }, null).teamShare);
    expect(dealMath({ ...base, teamSplitPct: 150 }, null).teamShare).toBe(dealMath({ ...base, teamSplitPct: 100 }, null).teamShare);
  });

  it('negative or >100 stage.prob is clamped by pct() to 0/100', () => {
    const d = { price: 100000, commPct: 10, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 };
    expect(dealMath(d, { prob: -10 }).weighted).toBe(dealMath(d, { prob: 0 }).weighted);
    expect(dealMath(d, { prob: 150 }).weighted).toBe(dealMath(d, { prob: 100 }).weighted);
    expect(dealMath(d, { prob: -10 }).prob).toBe(0);
    expect(dealMath(d, { prob: 150 }).prob).toBe(100);
  });
});

describe('dealMath() - rounding / floating point', () => {
  it('returns the raw unrounded float for a repeating-decimal combination (no implicit rounding inside dealMath)', () => {
    // 100000 * 33.33 / 100 = 33330 exactly in this case, and dealMath
    // performs no Math.round anywhere - callers round for display, the
    // function itself must return raw floats.
    const r = dealMath({ price: 100000, commPct: 33.33 }, null);
    expect(r.gross).toBeCloseTo(33330, 2);
    expect(r.net).toBeCloseTo(33330, 2); // no referral/brokerage/closing costs given
  });

  it('a chain of three sequential percent deductions compounds float error - close but not necessarily exact', () => {
    // Hand-verified via a direct run of this exact formula (not a
    // reimplementation used for comparison, just confirming the float
    // artifact is real and expected): gross=49999.9995, referral=16664.99983335,
    // brokerage=4176.874958331251, net=29034.674708318755.
    const r = dealMath({ price: 333333.33, commPct: 15, referralPct: 33.33, brokeragePct: 12.5, brokerageFee: 10, closingCosts: 123.45, teamSplitPct: 55.55 }, { prob: 45 });
    expect(r.gross).toBeCloseTo(50000, 2);
    expect(r.referral).toBeCloseTo(16665, 2);
    expect(r.net).toBeCloseTo(29034.67, 2);
    expect(r.teamShare + r.agentShare).toBeCloseTo(r.net, 8);
  });

  it('clean whole-number inputs produce exact integer results (no float artifact)', () => {
    const r = dealMath({ price: 500000, commPct: 6, referralPct: 20, brokeragePct: 10, brokerageFee: 0, closingCosts: 0, teamSplitPct: 50 }, { prob: 100 });
    // gross=30000; referral=6000; afterRef=24000; brokerage=2400; afterBrok=21600; net=21600
    expect(r.gross).toBe(30000);
    expect(r.referral).toBe(6000);
    expect(r.brokerage).toBe(2400);
    expect(r.net).toBe(21600);
    expect(r.teamShare).toBe(10800);
    expect(r.agentShare).toBe(10800);
    expect(r.weighted).toBe(21600);
  });
});

describe('dealMath() - string/junk inputs', () => {
  it('a formatted-currency price string is parsed via num()', () => {
    const r = dealMath({ price: '$425,000.50', commPct: 6 }, null);
    expect(r.price).toBe(425000.5);
    expect(r.gross).toBeCloseTo(425000.5 * 0.06, 6);
  });

  it('commPct: undefined is treated as 0', () => {
    const r = dealMath({ price: 100000, commPct: undefined }, null);
    expect(r.gross).toBe(0);
  });

  it('commPct: "not a number" falls back to 0 via num()\'s NaN guard', () => {
    const r = dealMath({ price: 100000, commPct: 'not a number' }, null);
    expect(r.gross).toBe(0);
  });
});

describe('dealMath() - no stage / falsy stage', () => {
  it('undefined stage gives prob:0, weighted:0 regardless of price/commission', () => {
    const r = dealMath({ price: 1000000, commPct: 6, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 }, undefined);
    expect(r.prob).toBe(0);
    expect(r.weighted).toBe(0);
  });

  it('null stage gives prob:0, weighted:0 regardless of price/commission', () => {
    const r = dealMath({ price: 1000000, commPct: 6, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 }, null);
    expect(r.prob).toBe(0);
    expect(r.weighted).toBe(0);
  });
});

describe('dealMath() - invariant: teamShare + agentShare reconstitutes net', () => {
  const cases = [
    { price: 400000, commPct: 6, referralPct: 25, brokeragePct: 20, brokerageFee: 0, closingCosts: 500, teamSplitPct: 70 },
    { price: 100000, commPct: 33.33, referralPct: 10, brokeragePct: 5, brokerageFee: 250, closingCosts: 1000, teamSplitPct: 33 },
    { price: 0, commPct: 50, referralPct: 25, brokeragePct: 20, brokerageFee: 100, closingCosts: 50, teamSplitPct: 70 },
    { price: 750000, commPct: 3, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 100 },
    { price: 750000, commPct: 3, referralPct: 0, brokeragePct: 0, brokerageFee: 0, closingCosts: 0, teamSplitPct: 0 },
  ];
  it.each(cases)('teamShare + agentShare === net for %j', (d) => {
    const r = dealMath(d, { prob: 60 });
    expect(r.teamShare + r.agentShare).toBeCloseTo(r.net, 8);
  });
});

describe('dealMath() - realistic full scenario (matches the JSDoc chain)', () => {
  it('hand-computed: price 400000, commPct 6, referralPct 25, brokeragePct 20, brokerageFee 0, closingCosts 500, teamSplitPct 70, stage.prob 80', () => {
    // Hand computation:
    //   gross      = 400000 * 6 / 100                = 24000
    //   referral   = 24000 * 25 / 100                 = 6000
    //   afterRef   = 24000 - 6000                     = 18000
    //   brokerage  = 18000 * 20 / 100 + 0              = 3600
    //   afterBrok  = max(0, 18000 - 3600)              = 14400
    //   net        = max(0, 14400 - 500)               = 13900
    //   teamShare  = 13900 * 70 / 100                  = 9730
    //   agentShare = 13900 - 9730                      = 4170
    //   prob       = 80
    //   weighted   = 13900 * 80 / 100                  = 11120
    const d = { price: 400000, commPct: 6, referralPct: 25, brokeragePct: 20, brokerageFee: 0, closingCosts: 500, teamSplitPct: 70 };
    const r = dealMath(d, { prob: 80 });
    expect(r.price).toBe(400000);
    expect(r.gross).toBe(24000);
    expect(r.referral).toBe(6000);
    expect(r.brokerage).toBe(3600);
    expect(r.net).toBe(13900);
    expect(r.teamShare).toBe(9730);
    expect(r.agentShare).toBe(4170);
    expect(r.prob).toBe(80);
    expect(r.weighted).toBe(11120);
  });
});
