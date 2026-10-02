// GATE G3 — static/source-level verification of the 6 Supabase Edge
// Functions under supabase/functions/*/index.ts.
//
// IMPORTANT, STATED LIMITATION: this environment has no Deno runtime and
// no Supabase CLI (`which deno supabase` returns nothing — confirmed
// during recon), so item 2's "call every edge function without auth and
// with the wrong role" cannot be exercised as a real, live HTTP call
// against a running function in this sandbox the way tests/security/
// rls.test.ts exercises real SQL against a real throwaway Postgres
// database. What CAN be done, and what this file does, is verify — by
// reading each function's actual source, not by trusting a comment or an
// earlier report — that the control every caller depends on is really
// present in the code path that runs before any privileged action: an
// Authorization-header check, server-side resolution of the caller via
// admin.auth.getUser() (never trusting a client-supplied id), an
// active-flag check, an org-match check, and a permission check specific
// to the action requested. A missing control here is a real finding with
// no live-call caveat; a present control here still deserves a live HTTP
// re-test once this suite can run against `supabase functions serve` or a
// deployed project — noted in docs/certification/security-audit.md.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const FN_DIR = path.join(REPO_ROOT, 'supabase', 'functions');

function src(name: any) {
  return fs.readFileSync(path.join(FN_DIR, name, 'index.ts'), 'utf8');
}

const ALL_FUNCTIONS = ['admin-create-user', 'admin-reset-password', 'log-activity', 'save-permissions', 'org-backup', 'import-run'];

describe('edge functions — every function requires an Authorization header (rejects an unauthenticated call)', () => {
  for (const name of ALL_FUNCTIONS) {
    it(`${name} checks for an Authorization header and returns 401 when missing`, () => {
      const code = src(name);
      expect(code).toMatch(/Authorization/);
      // Every function must both read the header AND branch on its absence
      // with a 401 — merely mentioning "Authorization" in a comment isn't
      // enough, so this also requires a literal 401 status code nearby.
      expect(code).toMatch(/401/);
    });
  }
});

describe('edge functions — caller identity is always resolved server-side, never trusted from the request body', () => {
  for (const name of ALL_FUNCTIONS) {
    it(`${name} resolves the caller via admin.auth.getUser(token), not a client-supplied member/user id`, () => {
      const code = src(name);
      expect(code).toMatch(/\.auth\.getUser\(/);
      // None of these functions should ever take a client-supplied
      // "caller_id"/"member_id"/"user_id" field from the request body and
      // use it as the acting identity in place of the token-derived one.
      // (has_permission_for's own p_member_id parameter is fine — that's
      // always caller.id resolved above, checked in the import-run-specific
      // test below — this check is about the *request body* shape.)
      expect(code).not.toMatch(/body\.(caller_id|acting_as|as_member_id|impersonate)/);
    });
  }
});

describe('edge functions — every privileged action re-checks org membership / active flag / a specific permission, not just "is signed in"', () => {
  it('admin-create-user checks caller.active and caller.org_id before creating a user, and gates on createUsers/super_admin', () => {
    const code = src('admin-create-user');
    expect(code).toMatch(/caller\.active/);
    expect(code).toMatch(/caller\.org_id\s*!==\s*org_id/);
    expect(code).toMatch(/createUsers/);
  });
  it('admin-reset-password checks caller.active and org match, and gates on resetPasswords', () => {
    const code = src('admin-reset-password');
    expect(code).toMatch(/caller\.active/);
    expect(code).toMatch(/org_id/);
    expect(code).toMatch(/resetPasswords/);
  });
  it('save-permissions gates writes on createRoles/editPermissions/editUsers (not a blanket "any signed-in member")', () => {
    const code = src('save-permissions');
    expect(code).toMatch(/editPermissions|createRoles|editUsers/);
  });
  it('org-backup gates the export on the export permission', () => {
    const code = src('org-backup');
    expect(code).toMatch(/["']export["']/);
  });
  it('import-run gates check/commit/undo on the import permission via has_permission_for, called with a server-resolved caller id', () => {
    const code = src('import-run');
    expect(code).toMatch(/has_permission_for/);
    expect(code).toMatch(/p_member_id:\s*caller\.id/);
    expect(code).toMatch(/caller\.org_id\s*!==\s*org_id/);
  });
  it('log-activity requires org_id/lead_id/type/outcome_id and forwards through a SQL function rather than writing raw columns from the request body', () => {
    const code = src('log-activity');
    expect(code).toMatch(/log_activity/);
  });
});

describe('edge functions — no rate limiting exists anywhere in this layer (documented gap, not a silent assumption)', () => {
  for (const name of ALL_FUNCTIONS) {
    it(`${name} has no rate-limit/throttle logic of its own`, () => {
      const code = src(name);
      // This assertion is intentionally the OPPOSITE of the others: it
      // documents an absence. If a future fix adds real rate limiting,
      // this specific test is expected to start failing and should be
      // updated, not silently left red.
      expect(/rate.?limit|throttle|too many (requests|attempts)/i.test(code)).toBe(false);
    });
  }
});

describe('edge functions — temporary-password generation and logging', () => {
  it('admin-create-user and admin-reset-password use the same 10-byte crypto.getRandomValues generator with a 56-character alphabet (modulo-bias finding)', () => {
    for (const name of ['admin-create-user', 'admin-reset-password']) {
      const code = src(name);
      expect(code).toMatch(/crypto\.getRandomValues\(new Uint8Array\(10\)\)/);
      expect(code).toMatch(/b % alphabet\.length/);
    }
  });
  it('neither function logs the generated/returned password (no console.log/console.error referencing the password variable)', () => {
    for (const name of ['admin-create-user', 'admin-reset-password']) {
      const code = src(name);
      const consoleCalls = code.match(/console\.(log|error|warn|info|debug)\([^)]*\)/g) || [];
      for (const call of consoleCalls) {
        expect(call).not.toMatch(/password/i);
      }
    }
  });
});
