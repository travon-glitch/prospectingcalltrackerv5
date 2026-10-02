// Deploy safety: on the live (Supabase) backend there must be no way to
// sign in without a real login — the one-click demo buttons never render,
// even if VITE_DEMO_LOGIN was left on by mistake, and signIn(id) refuses
// outright instead of trying the well-known demo password.
// Isolated in its own file: BACKEND/VITE_DEMO_LOGIN are read once at
// module load (vitest isolates modules per file, not per test).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

const authAttempt = vi.hoisted(() => vi.fn());
vi.mock('../../src/data/repo-supabase.js', async (importOriginal) => {
  const orig = await importOriginal<any>();
  return { ...orig, signInWithPassword: authAttempt };
});

describe('live backend never offers or accepts demo sign-in', () => {
  let loginScreen: any, session: any, db: any;

  beforeAll(async () => {
    vi.stubEnv('VITE_BACKEND', 'supabase');
    vi.stubEnv('VITE_DEMO_LOGIN', 'true'); // the mistake this guards against
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    ({ db } = await import('../../src/data/persist.js'));
    session = await import('../../src/core/session.js');
    ({ loginScreen } = await import('../../src/views/login.js'));
  });

  it('is really running the live backend with the demo flag switched on', () => {
    expect(session.BACKEND).toBe('supabase');
    expect(import.meta.env.VITE_DEMO_LOGIN).toBe('true');
  });

  it('login screen shows only the email + password form', () => {
    const html = loginScreen();
    expect(html).not.toContain('user-btn');
    expect(html).not.toContain('DEMO — sample users sign in with one click');
    expect(html).not.toMatch(/Sample users' password is/);
    expect(html).not.toContain(session.DEMO_PASSWORD);
    expect(html).toContain('data-testid="login-email"');
    expect(html).toContain('data-testid="login-password"');
  });

  it('signIn(id) refuses: nobody is signed in and no auth attempt is made', async () => {
    const someone = db.members.find((m: any) => m.active);
    expect(someone).toBeTruthy();
    await session.signIn(someone.id);
    expect(session.me).toBeNull();
    expect(authAttempt).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toMatch(/Sign in with your email and password/);
  });
});
