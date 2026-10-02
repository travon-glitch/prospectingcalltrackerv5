// Audit fix (post-Stage-15): src/views/login.js's top "DEMO — sample
// users..." banner and "Sample users' password is ..." hint were rendering
// unconditionally — they're specifically about the one-click demo-login
// buttons and should follow the same VITE_DEMO_LOGIN gate those buttons
// already use, not leak into a real deployment that has it turned off.
// (The companion src/views/shell.js banner fix has its own test file,
// tests/unit/shell-demo-banner-gating.test.ts — vitest isolates modules
// per file, and BACKEND/VITE_DEMO_LOGIN are read once at module load, so
// each env variant needs its own file rather than vi.resetModules() mid
// file, which broke on this codebase's circular seed/permissions imports.)
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('login screen demo banner/hint — VITE_DEMO_LOGIN=true (default test env)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
  });

  it('shows the demo banner and password hint', async () => {
    const { loginScreen }: any = await import('../../src/views/login.js');
    const html = loginScreen();
    expect(html).toContain('DEMO — sample users sign in with one click');
    expect(html).toMatch(/Sample users' password is/);
  });
});
