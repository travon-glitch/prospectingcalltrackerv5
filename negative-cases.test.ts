// GATE G2 regression safety net: negative-path / edge-case coverage for
// already-shipped validation logic that had no unit tests yet.
//   - saveUser() (src/features/admin.js): empty-required-field guards,
//     malformed-email guard, case-insensitive duplicate-email guard, the
//     "editing my own unchanged email" exemption from that guard, and
//     .trim()'s whitespace-only handling.
//   - addNote() (src/features/activity.js): a 10,000-character note is
//     stored in full, with no silent truncation.
//   - esc() (src/core/util.js): doesn't choke or truncate at scale, and
//     produces the exact expected escaped output for HTML-special chars.
//   - full() (src/features/activity.js) + esc()/initials() (src/core/
//     session.js): emoji (including astral, surrogate-pair) names and
//     HTML-special-character names, locking in current (including
//     already-shipped-quirky) behavior as a baseline.
//
// Follows the same document.body.innerHTML + `vi.mock('../../src/main.js')`
// + dynamic import() pattern as the rest of tests/unit/*.test.ts (see
// activity.test.ts / stats.test.ts), and the same partial-module-mock
// pattern for toast() as export-crm-columns.test.ts's `importOriginal`
// wrapping of core/util.js.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

// Partially mock core/util.js: keep esc()/$()/TODO... all real (esc() is
// itself under test in Target 2/3), but replace toast() with a spy so we
// can assert exactly which validation message fired without depending on
// jsdom's setTimeout-driven #toast show/hide class dance.
vi.mock('../../src/core/util.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: vi.fn() };
});

describe('negative / edge cases', () => {
  let db: any, nid: any, setMe, saveUser: any, addNote: any, full: any, esc: any, initials: any, toast: any;

  beforeAll(async () => {
    // jsdom doesn't implement <dialog>'s showModal()/close() — closeDlg()
    // (core/dialog.js) calls $("#dlg").close(), so polyfill it, same as
    // tests/unit/list-to-campaign-promise.test.ts does.
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.open = true; };
      HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.open = false; };
    }
    document.body.innerHTML = `
      <div id="app"></div><div id="toast"></div>
      <input type="file" id="restoreIn"><dialog id="dlg">
        <input id="uF"><input id="uL"><input id="uE"><select id="uR"><option value="agent">Agent</option></select>
        <input id="uP"><input type="checkbox" id="uMust">
        <input id="noteIn">
      </dialog>`;
    const adminMod: any = await import('../../src/features/admin.js');
    const activityMod: any = await import('../../src/features/activity.js');
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    const utilMod: any = await import('../../src/core/util.js');
    saveUser = adminMod.saveUser;
    addNote = activityMod.addNote;
    full = activityMod.full;
    db = persistMod.db;
    nid = persistMod.nid;
    setMe = sessionMod.setMe;
    initials = sessionMod.initials;
    esc = utilMod.esc;
    toast = utilMod.toast;
    setMe(db.members.find((m: any) => m.active) || db.members[0]);
  });

  // saveUser()'s success paths re-render #dlg's innerHTML (e.g.
  // userCreatedDlg() after creating a user), which wipes out the #uF/#uL/
  // #uE/#uR/#uP/#uMust/#noteIn stand-in fields we rely on — so rebuild the
  // whole stand-in DOM fresh before every test rather than just clearing
  // field values.
  beforeEach(() => {
    toast.mockClear();
    document.body.innerHTML = `
      <div id="app"></div><div id="toast"></div>
      <input type="file" id="restoreIn"><dialog id="dlg">
        <input id="uF"><input id="uL"><input id="uE"><select id="uR"><option value="agent">Agent</option></select>
        <input id="uP"><input type="checkbox" id="uMust">
        <input id="noteIn">
      </dialog>`;
  });

  // Fields saveUser() reads live off the DOM, by exact id/selector.
  function fillUserForm({ first = '', last = '', email = '', role = 'agent' } = {}) {
    (document.getElementById('uF') as any)!.value = first;
    (document.getElementById('uL') as any)!.value = last;
    (document.getElementById('uE') as any)!.value = email;
    (document.getElementById('uR') as any)!.value = role;
  }

  // ======================================================== Target 1: saveUser()
  describe('saveUser() — empty required fields', () => {
    it('rejects an empty first name (email present), with no new member created', async () => {
      fillUserForm({ first: '', email: 'someone@example.com' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith('First name and email are required');
      expect(db.members.length).toBe(before);
    });

    it('rejects an empty email (first name present), with no new member created', async () => {
      fillUserForm({ first: 'Pat', email: '' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith('First name and email are required');
      expect(db.members.length).toBe(before);
    });

    it('rejects when both first name and email are empty, with no new member created', async () => {
      fillUserForm({ first: '', email: '' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith('First name and email are required');
      expect(db.members.length).toBe(before);
    });

    it('treats a whitespace-only first name as empty (matching .trim()), and rejects it', async () => {
      fillUserForm({ first: '   ', email: 'someone@example.com' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith('First name and email are required');
      expect(db.members.length).toBe(before);
    });

    it('trims leading/trailing whitespace off first name and email before accepting them', async () => {
      // Whitespace-padded but non-empty after trim → must NOT hit the
      // "required" guard (proves trim() runs before the emptiness check).
      fillUserForm({ first: '  Pat  ', email: '  pat.new.unique@example.com  ' });
      (document.getElementById('uP') as any)!.value = 'TempPass123';
      await saveUser(null);
      expect(toast).not.toHaveBeenCalledWith('First name and email are required');
      const created = db.members.find((m: any) => m.email === 'pat.new.unique@example.com');
      expect(created).toBeTruthy();
      expect(created.first).toBe('Pat');
      // cleanup: don't leak this member into other test files
      db.members.splice(db.members.indexOf(created), 1);
    });
  });

  describe('saveUser() — malformed email', () => {
    it('rejects an email with no "@" at all', async () => {
      fillUserForm({ first: 'Pat', email: 'not-an-email' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith("That email address doesn't look right");
      expect(db.members.length).toBe(before);
    });

    it('rejects an email with no "." after the "@"', async () => {
      fillUserForm({ first: 'Pat', email: 'foo@bar' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith("That email address doesn't look right");
      expect(db.members.length).toBe(before);
    });

    it('rejects an email with a trailing dot and nothing after it', async () => {
      fillUserForm({ first: 'Pat', email: 'foo@bar.' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith("That email address doesn't look right");
      expect(db.members.length).toBe(before);
    });
  });

  describe('saveUser() — duplicate email', () => {
    let existing: any;

    beforeAll(() => {
      existing = { id: nid(), first: 'Jane', last: 'Doe', name: 'Jane Doe', email: 'jane@example.com', role: 'agent', active: true, listIds: [] };
      db.members.push(existing);
    });

    it('rejects a new submission whose email collides case-insensitively with an existing member', async () => {
      fillUserForm({ first: 'Someone', email: 'Jane@Example.COM' });
      const before = db.members.length;
      await saveUser(null);
      expect(toast).toHaveBeenCalledWith('Another user already has that email');
      expect(db.members.length).toBe(before);
    });

    it('does NOT reject editing that same existing member and resubmitting their own unchanged email', async () => {
      fillUserForm({ first: existing.first, last: existing.last, email: existing.email });
      await saveUser(existing.id);
      // The `&& m.id!==id` guard must let this one through — assert the
      // duplicate-email message specifically never fired (the update path
      // beyond this guard needs team/list checkbox DOM we haven't stubbed
      // here, so we only prove it got past the duplicate-email check).
      expect(toast).not.toHaveBeenCalledWith('Another user already has that email');
    });

    it('cleanup: removes the fixture member', () => {
      const idx = db.members.indexOf(existing);
      if (idx !== -1) db.members.splice(idx, 1);
    });
  });

  // ================================================== Target 2: long notes
  describe('addNote() — very long notes', () => {
    it('stores a 10,000-character note in full, with no silent truncation', () => {
      const lead = { id: nid(), first: 'Long', last: 'Note', email: '', addr: '', city: '', zip: '', phones: [], listIds: [], assigned: db.members[0].id, status: 'new', dnc: false, dnt: false, dncontact: false, archived: false, source: 'manual', createdAt: new Date().toISOString(), custom: {} };
      db.leads.push(lead);
      const longText = 'a'.repeat(10000);
      (document.getElementById('noteIn') as any)!.value = longText;
      const before = db.notes.length;
      addNote(lead.id);
      expect(db.notes.length).toBe(before + 1);
      const note = db.notes[db.notes.length - 1];
      expect(note.text.length).toBe(10000);
      expect(note.text).toBe(longText);
      // cleanup
      db.notes.splice(db.notes.indexOf(note), 1);
      db.leads.splice(db.leads.indexOf(lead), 1);
    });

    it('esc() does not choke or truncate a 10,000-character input with HTML-special characters sprinkled in', () => {
      // Seed a 10,000-char string: every 10th character is one of & < > " ',
      // cycling through the 5 special chars; everything else is a plain
      // letter. Each special char expands to a longer entity in esc()'s
      // output, so we can predict the exact resulting length.
      const specials = ['&', '<', '>', '"', "'"];
      const entities: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      let longString = '';
      let specialCount = 0;
      for (let i = 0; i < 10000; i++) {
        if (i % 10 === 0) { const c = specials[specialCount % specials.length]; longString += c; specialCount++; }
        else longString += 'x';
      }
      const result = esc(longString);
      expect(result.length).toBeGreaterThanOrEqual(longString.length);
      // Exact predicted length: every non-special char stays 1 char; every
      // special char (specialCount of them) becomes its entity's length.
      let expectedLength = longString.length - specialCount; // remove the 1-char specials
      for (let i = 0; i < specialCount; i++) {
        expectedLength += entities[specials[i % specials.length]].length;
      }
      expect(result.length).toBe(expectedLength);
    });
  });

  // ============================================ Target 3: emoji / special chars
  describe('special characters and emoji in names', () => {
    it('full() concatenates a name containing a multi-code-unit emoji without mangling it', () => {
      const lead = { first: 'José🔥', last: "O'Brien" };
      const fullName = full(lead);
      expect(fullName).toBe("José🔥 O'Brien");
      // Real Unicode-aware iteration: the emoji grapheme (a surrogate pair,
      // U+1F525) must survive intact as a single code point, not as a
      // mangled lone surrogate.
      const chars = [...fullName];
      expect(chars).toContain('🔥');
      // Confirm it really is a surrogate pair in UTF-16 (length 2 code units).
      expect('🔥'.length).toBe(2);
      expect(fullName.includes('🔥')).toBe(true);
    });

    it('esc() escapes & < > " \' to their exact entities, safe to re-insert into innerHTML as literal text', () => {
      expect(esc('<script>')).toBe('&lt;script&gt;');
      expect(esc("O'Brien")).toBe('O&#39;Brien');
      expect(esc('Anne "Annie" Smith')).toBe('Anne &quot;Annie&quot; Smith');
    });

    it('initials() on an emoji-first name does not throw and returns at most 2 characters', () => {
      // Locks in the existing (already-shipped) quirk: initials() uses
      // x[0] (a single UTF-16 code unit), not Unicode-aware iteration, so
      // an astral emoji's first "word" yields its lone leading surrogate,
      // not the whole emoji grapheme.
      const name = 'José🔥 O\'Brien';
      let result: any;
      expect(() => { result = initials(name); }).not.toThrow();
      expect(result.length).toBeLessThanOrEqual(2);
      // First word is "José🔥" -> x[0] is "J"; second word "O'Brien" -> x[0]
      // is "O" -> "JO" uppercased.
      expect(result).toBe('JO');
    });

    it('initials() on a name whose sole "word" starts with an astral emoji returns the lone leading surrogate, not the full grapheme', () => {
      const name = '🔥Blaze';
      const result = initials(name);
      expect(result.length).toBeLessThanOrEqual(2);
      // x[0] on "🔥Blaze" is the emoji's high surrogate alone (not the full
      // 2-code-unit grapheme) — a real, already-shipped Unicode quirk.
      expect(result).toBe('🔥'[0].toUpperCase());
      expect(result.length).toBe(1);
    });

    it('initials() on a single-word name returns just that word\'s first letter, uppercased, at most 2 chars', () => {
      expect(initials('Madonna')).toBe('M');
    });

    it('initials("") falls back to "?" via the (name||"?") default for a literal empty string', () => {
      expect(initials('')).toBe('?');
    });

    it('initials("   ") (whitespace-only, non-empty) does NOT hit the "?" fallback — split/filter/map/join all collapse to "" instead, per the existing implementation', () => {
      // "   ".split(" ") -> ["", "", "", ""]; .filter(Boolean) removes all
      // of them (empty strings are falsy) -> []; .map(x=>x[0]) never runs;
      // .join("") of [] -> ""; .slice(0,2) -> ""; .toUpperCase() -> "".
      // The `||` fallback only catches null/undefined/literal "", never a
      // non-empty whitespace string, so the real result is "", not "?".
      expect(initials('   ')).toBe('');
    });
  });
});
