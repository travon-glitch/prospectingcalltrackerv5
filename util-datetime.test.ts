// Unit tests for the date/timezone/phone helpers in src/core/util.js.
// GATE G2: regression-safety net around already-shipped, already-correct
// behavior — every assertion here is against the real imported function,
// never a reimplementation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isoDate,
  todayD,
  daysAgo,
  addDays,
  fmtD,
  fmtDT,
  TODAY,
  digits,
  normPhone,
} from '../../src/core/util.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('isoDate', () => {
  it('zero-pads a single-digit month and single-digit day', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('formats a date at a year boundary (Dec 31)', () => {
    expect(isoDate(new Date(2025, 11, 31))).toBe('2025-12-31');
  });

  it('formats a leap-year Feb 29', () => {
    expect(isoDate(new Date(2028, 1, 29))).toBe('2028-02-29');
  });
});

describe('todayD', () => {
  it('returns a Date at local midnight matching the pinned "now"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 13, 45, 30, 250));
    const d = todayD();
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(isoDate(d)).toBe(isoDate(new Date()));
  });
});

describe('TODAY', () => {
  it('is a YYYY-MM-DD string computed at module-load time', () => {
    expect(TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TODAY).toBe(isoDate(todayD()));
  });
});

describe('daysAgo', () => {
  it('daysAgo(0) is today at the default hour (10)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 0));
    const result = new Date(daysAgo(0));
    expect(isoDate(result)).toBe(isoDate(todayD()));
    expect(result.getHours()).toBe(10);
  });

  it('daysAgo(7) is exactly 7 calendar days earlier', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 0));
    const result = new Date(daysAgo(7));
    expect(isoDate(result)).toBe('2026-06-08');
  });

  it('crosses a month boundary correctly', () => {
    vi.useFakeTimers();
    // Pin "now" to the 3rd of a month; daysAgo(10) should land in the
    // previous month.
    vi.setSystemTime(new Date(2026, 5, 3, 9, 0, 0));
    const result = new Date(daysAgo(10));
    expect(isoDate(result)).toBe('2026-05-24');
  });

  it('crosses a year boundary correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 3, 9, 0, 0));
    const result = new Date(daysAgo(10));
    expect(isoDate(result)).toBe('2025-12-24');
  });

  it('respects an explicit hour parameter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 0));
    const result = new Date(daysAgo(3, 14));
    expect(result.getHours()).toBe(14);
  });

  it('sets minute to (n*7)%60 for a non-wrapping n', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 0));
    // n=10 -> (10*7)%60 = 10
    const result = new Date(daysAgo(10));
    expect(result.getMinutes()).toBe(10);
  });

  it('relies on setHours overflow so (n*7)%60 wraps past 59 correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 0));
    // n=9 -> raw n*7 = 63, (63)%60 = 3; confirm the resulting minute is
    // 3 (the already-reduced value), not 63.
    const result = new Date(daysAgo(9));
    expect((9 * 7) % 60).toBe(3);
    expect(result.getMinutes()).toBe(3);
  });
});

describe('addDays', () => {
  it('rolls over a month boundary', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
  });

  it('rolls over a year boundary', () => {
    expect(addDays('2026-12-28', 5)).toBe('2027-01-02');
  });

  it('handles a negative n (going backward across a month boundary)', () => {
    expect(addDays('2026-03-05', -10)).toBe('2026-02-23');
  });

  it('is a no-op when n=0', () => {
    expect(addDays('2026-06-15', 0)).toBe('2026-06-15');
  });

  it('handles leap-day arithmetic: Feb 28 -> Feb 29 (leap year)', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('handles leap-day arithmetic: Feb 29 -> Mar 1 (leap year)', () => {
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('handles Feb 28 -> Mar 1 in a non-leap year', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('fmtD', () => {
  it('returns the em dash for empty string', () => {
    expect(fmtD('')).toBe('—');
  });

  it('returns the em dash for null', () => {
    expect(fmtD(null)).toBe('—');
  });

  it('returns the em dash for undefined', () => {
    expect(fmtD(undefined)).toBe('—');
  });

  it('parses a bare YYYY-MM-DD string as local midnight without day shift', () => {
    // Guards against the classic bug where a bare date string gets parsed
    // as UTC and shifts a day in negative-UTC-offset zones.
    const out = fmtD('2026-03-17');
    expect(out).toContain('17');
  });

  it('takes the "parsed as-is" branch for a longer ISO string with a time component', () => {
    const iso = new Date(2026, 2, 17, 8, 30, 0).toISOString();
    expect(iso.length).toBeGreaterThan(10);
    const out = fmtD(iso);
    expect(out).not.toBe('—');
  });
});

describe('fmtDT', () => {
  it('returns the em dash for empty/falsy input', () => {
    expect(fmtDT('')).toBe('—');
    expect(fmtDT(null)).toBe('—');
    expect(fmtDT(undefined)).toBe('—');
  });

  it('formats a real ISO datetime string into a non-dash, day-containing string', () => {
    const iso = new Date(2026, 2, 17, 8, 30, 0).toISOString();
    const out = fmtDT(iso);
    expect(out).not.toBe('—');
    expect(out).toContain('17');
  });
});

describe('digits', () => {
  it('strips all non-digit characters from a formatted phone number', () => {
    expect(digits('(404) 555-0170')).toBe('4045550170');
  });

  it('returns an empty string for null', () => {
    expect(digits(null)).toBe('');
  });

  it('returns an empty string for undefined', () => {
    expect(digits(undefined)).toBe('');
  });

  it('extracts only digits from a string mixed with unicode/emoji', () => {
    expect(digits('📞 404-555-0170 🎉')).toBe('4045550170');
  });
});

describe('normPhone', () => {
  it('normalizes a bare 10-digit US number', () => {
    expect(normPhone('4045550170')).toBe('+14045550170');
  });

  it('strips a leading US country code (11 digits starting with 1)', () => {
    expect(normPhone('14045550170')).toBe('+14045550170');
  });

  it('returns null for an 11-digit number not starting with 1', () => {
    expect(normPhone('24045550170')).toBeNull();
  });

  it('returns null for fewer than 10 digits', () => {
    expect(normPhone('404555017')).toBeNull();
  });

  it('returns null for more than 11 digits', () => {
    expect(normPhone('140455501700')).toBeNull();
  });

  it('normalizes formatted input with punctuation', () => {
    expect(normPhone('(404) 555-0170')).toBe('+14045550170');
  });
});
