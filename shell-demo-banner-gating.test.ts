// Audit fix (post-Stage-15): src/views/shell.js's "DEMO — everything runs
// in this page..." banner rendered on every screen regardless of backend —
// it specifically describes the local backend (no real login, no shared
// database) and was simply false once VITE_BACKEND=supabase is actually
// deployed. This checks it only appears for the local backend (the
// default test env — see tests/unit/shell-demo-banner-gating-supabase.test.ts
// for the supabase-backend case, split into its own file since BACKEND is
// a module-load-time constant and vitest isolates modules per file).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('app shell demo banner — local backend (default test env)', () => {
  let shell: any;

  beforeAll(async () => {
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    sessionMod.setMe(persistMod.db.members[0]);
    ({ shell } = await import('../../src/views/shell.js'));
  });

  it('shows the local-backend banner', () => {
    expect(shell('<p>content</p>')).toContain('DEMO — everything runs in this page');
  });
});
