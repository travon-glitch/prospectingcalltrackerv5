// Companion to demo-banner-gating.test.ts: VITE_DEMO_LOGIN=false case,
// isolated to its own file since BACKEND/VITE_DEMO_LOGIN are read once at
// module load (vitest isolates modules per file, not per test).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('login screen demo banner/hint — VITE_DEMO_LOGIN=false', () => {
  let loginScreen: any;

  beforeAll(async () => {
    vi.stubEnv('VITE_DEMO_LOGIN', 'false');
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    ({ loginScreen } = await import('../../src/views/login.js'));
  });

  it('hides the demo banner, the one-click buttons, and the password hint', () => {
    const html = loginScreen();
    expect(html).not.toContain('DEMO — sample users sign in with one click');
    expect(html).not.toMatch(/Sample users' password is/);
    expect(html).not.toContain('user-btn');
  });
});
