// Companion to shell-demo-banner-gating.test.ts: VITE_BACKEND=supabase case.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main.js', () => ({ draw: vi.fn() }));

describe('app shell demo banner — supabase backend', () => {
  let shell: any;

  beforeAll(async () => {
    vi.stubEnv('VITE_BACKEND', 'supabase');
    document.body.innerHTML = `<div id="app"></div><div id="toast"></div><input type="file" id="restoreIn"><dialog id="dlg"></dialog>`;
    const persistMod: any = await import('../../src/data/persist.js');
    const sessionMod: any = await import('../../src/core/session.js');
    sessionMod.setMe(persistMod.db.members[0]);
    ({ shell } = await import('../../src/views/shell.js'));
  });

  it('hides the local-backend banner', () => {
    expect(shell('<p>content</p>')).not.toContain('DEMO — everything runs in this page');
  });
});
