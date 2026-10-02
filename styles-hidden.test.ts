// Stage 14 fix #1: views/leads.js's filters panel and views/settings.js's
// custom-field "Options" textarea both toggle a `hidden` class
// (state.showFilters ? "" : "hidden", and
// $("#fChoicesWrap").classList.toggle("hidden", ...)) that styles.css never
// defined a rule for, so toggling it had no visual effect. This checks the
// stylesheet itself carries the rule, rather than re-testing every screen
// that relies on it.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(__dirname, '../../src/styles.css'), 'utf8');

describe('styles.css — .hidden utility class', () => {
  it('defines display:none !important for .hidden', () => {
    // !important is required, not decorative: views/leads.js's filters panel
    // also carries a .filters rule with its own `display` at equal
    // specificity, which would otherwise win the cascade tie by source order.
    expect(css).toMatch(/\.hidden\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/);
  });
});
