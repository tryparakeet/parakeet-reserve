// Privacy, Terms and Support (P-393, P-1440): the header's icon and wordmark are one link home. Tabbed to,
// it shows the site's whole focus ring (2 px ink, 2 px out), its top edge too, at the top of the page, and
// its target stays 44 px or more, the icon centred in the header.

import { test, expect, bbox } from './fixtures.mjs';
import { COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const WINDOWS = [
  { width: 375, height: 667 },
  { width: 393, height: 852 },
  { width: 1024, height: 768, computer: true },
  { width: 1440, height: 900, computer: true }
];

for (const w of WINDOWS) {
  test.describe(`the legal pages at ${w.width}x${w.height}`, () => {
    test.use(w.computer
      ? { viewport: { width: w.width, height: w.height }, isMobile: false, hasTouch: false, userAgent: COMPUTER_UAS.safari_mac }
      : { viewport: { width: w.width, height: w.height } });

    for (const path of ['/privacy', '/terms', '/support']) {
      test(`${path}: the link home shows its whole focus ring at the top of the page, its target 44 px or more`, async ({ page }) => {
        await page.goto(path);
        await page.keyboard.press('Tab');
        const link = page.locator('.logo-link');
        await expect(link).toBeFocused();
        const ring = await link.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset), scrollY: window.scrollY };
        });
        expect(ring.style, 'the site\'s focus ring').toBe('solid');
        expect(ring.scrollY).toBe(0);
        const box = await bbox(link);
        const header = await bbox(page.locator('.top'));
        const icon = await bbox(page.locator('.top .logo-icon'));
        expect(box.top - ring.offset - ring.width, 'the ring\'s top edge inside the page').toBeGreaterThanOrEqual(0);
        expect(box.bottom + ring.offset + ring.width, 'and its bottom edge inside the header').toBeLessThanOrEqual(header.bottom + 0.5);
        expect(box.height, 'the target is 44 px or more').toBeGreaterThanOrEqual(44);
        expect((icon.top + icon.bottom) / 2, 'the icon centred in the header').toBeCloseTo((header.top + header.bottom) / 2, 0);
      });
    }
  });
}
