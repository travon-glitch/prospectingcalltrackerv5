// Stage 15: Playwright config for tests/e2e/*.spec.ts.
//
// The suite runs against a production build served by `vite preview`
// (rather than the dev server) so what's tested is the same static
// bundle the deploy runbook in README.md ships — see webServer below.
// Backend defaults to `local` (VITE_BACKEND unset), same as the app's own
// default, so the suite exercises the in-browser demo backend directly
// via window.db/window.state (both exposed for tests — see src/main.ts)
// without needing a real Supabase project. Point VITE_BACKEND=supabase at
// a real project (see .env.example) to run the same specs against it.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PW_PORT || 4310;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // This container ships a pre-installed Chromium at a fixed build
        // (/opt/pw-browsers) that doesn't always match the exact build the
        // installed @playwright/test version wants to download on its own
        // (it looks for a "headless shell" build `playwright install`
        // would normally fetch) — pointing at the pinned browser directly
        // avoids that download, which the sandbox's network policy blocks
        // anyway. See /root/.ccr/README.md.
        launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
      },
    },
    {
      // GATE G2: every spec in tests/e2e runs a second time at a 390px
      // mobile viewport (this repo's own CSS breaks to a single-column
      // mobile layout well above that width — src/views/crm.ts's own
      // comment mentions a CSS-hidden `.crm-mobile-one` board copy kept in
      // the DOM specifically for narrow widths) so the whole suite proves
      // itself on both desktop and mobile, not just desktop. Same pinned
      // Chromium binary — this is a viewport/UA emulation, not a different
      // browser engine.
      name: 'mobile',
      use: {
        // devices['iPhone 13'] ships `defaultBrowserType: "webkit"` — left
        // in place, Playwright Test launches the WebKit driver against the
        // executablePath below (which is a Chromium binary), and the two
        // speak incompatible startup protocols: the "browser" silently
        // fails at launch before producing any real output. Strip that one
        // field so this project stays on the same pinned Chromium engine
        // as the desktop project, keeping only the phone-shaped viewport/
        // UA/touch emulation from the preset.
        ...Object.fromEntries(Object.entries(devices['iPhone 13']).filter(([k]) => k !== 'defaultBrowserType')),
        viewport: { width: 390, height: 844 },
        // Root-in-container needs the sandbox disabled explicitly, same as
        // any headless Chromium CI setup running as root.
        launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
