// Unit tests for csvCell() (src/features/exports.js) — the CSV/formula-
// injection escaping helper used by every export dataset. exports.js has a
// large import chain (core/fields, core/permissions, core/session,
// core/state, core/util, data/persist, data/repo-supabase, features/
// activity, features/campaigns, features/leads, features/stats), so this
// follows the exact setup pattern tests/unit/export-crm-columns.test.ts
// already uses for a sibling file with a similar chain: stub the DOM
// export.js's own module-scope code (and its imports) expect, and mock
// ../../src/main.js's draw() so nothing tries to touch a real app shell.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('csvCell()', () => {
  let csvCell: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    // Import persist.js (and its own transitive chain) first, matching
    // export-crm-columns.test.ts's proven order — exports.js and
    // core/fields.js/data/persist.js/data/seed.js form a circular import
    // (seed.js calls core/fields.js's defaultBuiltInFields() at module-eval
    // time), and importing persist.js as the very first module avoids
    // hitting that cycle mid-instantiation.
    await import('../../src/data/persist.js');
    const exportsMod: any = await import('../../src/features/exports.js');
    csvCell = exportsMod.csvCell;
  });

  it('turns null into an empty string', () => {
    expect(csvCell(null)).toBe('');
  });

  it('turns undefined into an empty string', () => {
    expect(csvCell(undefined)).toBe('');
  });

  it('returns a plain safe string unchanged and unquoted', () => {
    expect(csvCell('Jordan Miles')).toBe('Jordan Miles');
  });

  it('returns a plain safe number unchanged and unquoted', () => {
    expect(csvCell(42)).toBe('42');
  });

  it('returns an empty string input unchanged', () => {
    expect(csvCell('')).toBe('');
  });

  describe('formula-injection guard (leading = + - @ tab cr)', () => {
    it('prefixes a value starting with = with a single quote', () => {
      expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    });

    it('prefixes a value starting with + with a single quote', () => {
      expect(csvCell('+1234')).toBe("'+1234");
    });

    it('prefixes a value starting with - with a single quote, even an ordinary negative number', () => {
      // "-1234" reads like a completely normal negative number a user might
      // legitimately type, but csvCell() can't tell intent from a leading
      // minus sign — it applies the same regex regardless, so it STILL
      // gets the guard prefix. This is real, already-shipped, correct-
      // per-spec behavior, not a bug to "fix".
      expect(csvCell('-1234')).toBe("'-1234");
    });

    it('prefixes a value starting with @ with a single quote', () => {
      expect(csvCell('@mention')).toBe("'@mention");
    });

    it('prefixes a value starting with a literal tab character with a single quote', () => {
      expect(csvCell('\tafter tab')).toBe("'\tafter tab");
    });

    it('prefixes a value starting with a literal carriage-return character with a single quote', () => {
      // csvCell()'s own quoting guard also fires here (the value contains
      // a literal \r), so the fully-prefixed, already-\r-quoted result
      // additionally gets wrapped in double quotes.
      expect(csvCell('\rafter cr')).toBe('"\'\rafter cr"');
    });
  });

  describe('quoting guard (comma, double quote, \\n, \\r)', () => {
    it('wraps a value containing a comma in double quotes', () => {
      expect(csvCell('Atlanta, GA')).toBe('"Atlanta, GA"');
    });

    it('wraps a value containing a double quote in double quotes and doubles the internal quote', () => {
      expect(csvCell('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    });

    it('wraps a value containing a newline in double quotes', () => {
      expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
    });

    it('wraps a value containing a carriage return in double quotes', () => {
      expect(csvCell('line one\rline two')).toBe('"line one\rline two"');
    });
  });

  describe('composing both guards', () => {
    it('prefixes AND quotes a value that both starts with a formula trigger and contains a comma', () => {
      // The quoting check runs against the ALREADY-prefixed string, so the
      // injected leading `'` ends up inside the outer quotes too — it is
      // not itself escaped or doubled (only literal `"` chars get doubled).
      expect(csvCell('=1,2')).toBe('"\'=1,2"');
    });

    it('prefixes AND quotes a value starting with @ that also contains an internal double quote', () => {
      expect(csvCell('@"quoted"')).toBe('"\'@""quoted"""');
    });
  });

  describe('non-string input coercion', () => {
    it('coerces a number via String(v) first, then applies both checks — a safe number passes through unchanged', () => {
      expect(csvCell(42)).toBe('42');
    });

    it('coerces a negative number to its string form and still triggers the minus-sign prefix rule', () => {
      // csvCell(-5): the regex runs against the *stringified* value
      // regardless of the original type, so the numeric input "-5" is
      // treated exactly like the string "-5" would be.
      expect(csvCell(-5)).toBe("'-5");
    });

    it('coerces a boolean via String(v) first', () => {
      expect(csvCell(true)).toBe('true');
    });

    it('coerces an object via its default String() representation', () => {
      const obj = { toString: () => 'custom,value' };
      expect(csvCell(obj)).toBe('"custom,value"');
    });
  });
});
