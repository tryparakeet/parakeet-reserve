// The first screen is the whole page: at five phone viewports nothing scrolls, every element of the first
// screen and the fixed CTA sit inside the viewport, the clip shrinks first (never below 80 px) and the copy
// never; the colours, the type sizes and the absence of a font file; the sheet under a keyboard-sized
// viewport; closing with and without reduced motion.

import { test, expect, TAGGED_QS, bbox, frames, viewportSize, sheetSettled } from './fixtures.mjs';

const VIEWPORTS = [
  { width: 375, height: 553, note: 'iPhone SE, Safari with toolbars' },
  { width: 375, height: 617, note: 'iPhone SE inside TikTok' },
  { width: 375, height: 667, note: 'iPhone SE, full' },
  { width: 393, height: 659, note: 'Pixel-class Android inside an app' },
  { width: 360, height: 640, note: 'small Android' }
];

const FIRST_SCREEN = ['.wordmark', 'h1', '.lede', '#clip-box', '.play', '.facts li >> nth=0', '.facts li >> nth=1', '.facts li >> nth=2', '.cta .btn'];

for (const vp of VIEWPORTS) {
  test(`fits at ${vp.width}x${vp.height} (${vp.note})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(TAGGED_QS);
    await expect(page.locator('h1')).toHaveText('5 dinners that fit your budget.');
    await frames(page);

    const { width, height } = await viewportSize(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const sel of FIRST_SCREEN) {
      const box = await bbox(page.locator(sel));
      expect(box.height, `${sel} has a height`).toBeGreaterThan(0);
      expect(box.top, `${sel} top inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `${sel} bottom inside the viewport`).toBeLessThanOrEqual(height + 0.5);
      expect(box.left, `${sel} left inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${sel} right inside the viewport`).toBeLessThanOrEqual(width + 0.5);
    }
    const clip = await bbox(page.locator('#clip-box'));
    expect(clip.height, 'clip height at most 40% of the viewport').toBeLessThanOrEqual(height * 0.4 + 0.5);
    expect(clip.height, 'clip height at least 80 px').toBeGreaterThanOrEqual(80);
    expect(clip.width / clip.height, 'clip is 9:16').toBeCloseTo(9 / 16, 1);
    const cta = await bbox(page.locator('.cta .btn'));
    const facts = await bbox(page.locator('.facts'));
    expect(facts.bottom, 'the facts end above the CTA').toBeLessThanOrEqual(cta.top + 0.5);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth
    }));
    expect(overflow.scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(overflow.clientWidth);
    expect(overflow.bodyScrollWidth, 'no horizontal overflow (body)').toBeLessThanOrEqual(overflow.clientWidth);

    const styles = await page.evaluate(() => {
      const cs = (sel, prop) => getComputedStyle(document.querySelector(sel)).getPropertyValue(prop);
      let fontFaces = 0;
      for (const sheet of document.styleSheets) {
        try { for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule) fontFaces += 1; } catch { /* cross-origin: none expected */ }
      }
      return {
        body: cs('body', 'background-color'),
        cta: cs('.cta .btn', 'background-color'),
        badgeless: true,
        h1: parseFloat(cs('h1', 'font-size')),
        fact: parseFloat(cs('.facts li', 'font-size')),
        fontFaces,
        ctaPosition: cs('.cta', 'position')
      };
    });
    expect(styles.body).toBe('rgb(251, 246, 236)');
    expect(styles.cta).toBe('rgb(79, 168, 232)');
    expect(styles.h1).toBeGreaterThanOrEqual(28);
    expect(styles.h1).toBeLessThanOrEqual(32);
    expect(styles.fact).toBeGreaterThanOrEqual(13);
    expect(styles.fontFaces, 'no @font-face').toBe(0);
    expect(styles.ctaPosition).toBe('fixed');
  });
}

test('keyboard proxy: with the sheet open at 375x380, --vvh follows innerHeight and the panel and its button stay in view', async ({ page }) => {
  await page.goto(TAGGED_QS);
  await page.locator('[data-tap="reserve"]').click();
  await sheetSettled(page);
  await expect(page.locator('#step-1')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 380 });
  await frames(page, 3);
  const vvh = await page.evaluate(() => ({
    value: getComputedStyle(document.documentElement).getPropertyValue('--vvh').trim(),
    inner: window.innerHeight,
    vv: window.visualViewport ? Math.round(window.visualViewport.height) : null
  }));
  expect(vvh.inner).toBe(380);
  expect(vvh.value).toBe(`${vvh.inner}px`);
  const panel = await bbox(page.locator('#sheet-panel'));
  expect(panel.top).toBeGreaterThanOrEqual(0);
  expect(panel.bottom).toBeLessThanOrEqual(380 + 0.5);
  const hold = await bbox(page.locator('#hold'));
  expect(hold.top).toBeGreaterThanOrEqual(0);
  expect(hold.bottom).toBeLessThanOrEqual(380 + 0.5);
  expect(hold.height).toBeGreaterThan(0);
});

test('the sheet closes without reduced motion (after the transition) and the page is left as it was', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(TAGGED_QS);
  await page.locator('[data-tap="reserve"]').click();
  await sheetSettled(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(true);
  await page.locator('.sheet-x').click();
  await expect(page.locator('#sheet')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(false);
  expect(await page.evaluate(() => document.body.style.top)).toBe('');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the sheet closes with prefers-reduced-motion (no transition to wait for)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(TAGGED_QS);
  await page.locator('[data-tap="reserve"]').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden({ timeout: 1000 });
  expect(await page.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(false);
  // and it reopens cleanly
  await page.locator('[data-tap="reserve"]').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('#step-1')).toBeVisible();
});
