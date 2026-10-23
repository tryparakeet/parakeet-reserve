// Hero B, the first screen, is the whole page: at the phone viewports nothing needs a scroll, the wordmark,
// the H1, the answer line, the phone, the button and the line under it sit inside the viewport, the phone
// frame shrinks first and the copy never; the bezel is whole (nothing over it, the sheet below it); the
// colours, the type sizes, the button's contrast and the absence of a font file. Then: the Reserve sheet
// stays pinned while the page scrolls, the rows fade in once (and are visible with scripts off), the answer
// line's one pass (and its still last line under reduced motion), the transfer budget, the sheet under a
// keyboard-sized viewport, closing with and without reduced motion.

import { test, expect, TAGGED_QS, bbox, frames, viewportSize, sheetSettled } from './fixtures.mjs';

const VIEWPORTS = [
  { width: 375, height: 667, note: 'iPhone SE, full' },
  { width: 393, height: 852, note: 'iPhone 15, full' },
  { width: 375, height: 617, note: 'iPhone SE inside TikTok' },
  { width: 393, height: 659, note: 'Pixel-class Android inside an app' },
  { width: 360, height: 640, note: 'small Android' },
  { width: 375, height: 553, note: 'iPhone SE, Safari with toolbars', minPhone: 120 }
];

const FIRST_SCREEN = ['.wordmark', 'h1', '.answer-3', '.phone', '.cta .btn', '.cta-note'];

// WCAG relative luminance contrast of two rgb() strings (no alpha)
function contrast(a, b) {
  const lum = (s) => {
    const [r, g, bl] = s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const vp of VIEWPORTS) {
  test(`fits at ${vp.width}x${vp.height} (${vp.note})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(TAGGED_QS);
    await expect(page.locator('h1')).toHaveText('What’s for dinner this week?');
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
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

    // the phone: Apple's bezel whole, at its own proportions, above the sheet, with the screen under its opening
    const phone = await bbox(page.locator('.phone'));
    const bezel = await bbox(page.locator('.bezel'));
    const screen = await bbox(page.locator('.phone-screen'));
    const cta = await bbox(page.locator('.cta'));
    const answer = await bbox(page.locator('.answer'));
    expect(bezel).toEqual(phone);
    expect(phone.width / phone.height, 'the bezel is 224:457').toBeCloseTo(224 / 457, 2);
    expect(phone.height, 'the phone is at most its 3x image size').toBeLessThanOrEqual(457.5);
    expect(phone.height, 'the phone is at least 200 px tall (DESIGN.md §7)').toBeGreaterThanOrEqual(vp.minPhone || 200);
    expect(phone.top, 'nothing over the phone: the answer line ends above it').toBeGreaterThanOrEqual(answer.bottom);
    expect(phone.bottom, 'the sheet sits below the phone, not over it').toBeLessThanOrEqual(cta.top + 0.5);
    expect((screen.left - phone.left) / phone.width).toBeCloseTo(10.43 / 224, 2);
    expect((screen.top - phone.top) / phone.height).toBeCloseTo(9.05 / 457, 2);
    expect(screen.width / phone.width).toBeCloseTo(203.14 / 224, 2);
    expect(screen.height / phone.height).toBeCloseTo(438.89 / 457, 2);

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
        sky: cs('.sky', 'background-color'),
        h1: parseFloat(cs('h1', 'font-size')),
        h1Color: cs('h1', 'color'),
        h1Align: cs('h1', 'text-align'),
        answer: parseFloat(cs('.answer-3', 'font-size')),
        answerAlign: cs('.answer-3', 'text-align'),
        wordmark: cs('.wordmark', 'color'),
        cta: cs('.cta .btn', 'background-color'),
        ctaColor: cs('.cta .btn', 'color'),
        sheet: cs('.cta', 'background-color'),
        note: parseFloat(cs('.cta-note', 'font-size')),
        noteAlign: cs('.cta-note', 'text-align'),
        fontFaces,
        ctaPosition: cs('.cta', 'position')
      };
    });
    expect(styles.body).toBe('rgb(251, 246, 236)');
    expect(styles.sky).toBe('rgb(79, 168, 232)');
    expect(styles.h1, 'the copy never shrinks').toBe(34);
    expect(styles.h1Color).toBe('rgb(255, 255, 255)');
    expect(styles.h1Align).toBe('center');
    expect(styles.answer).toBe(17);
    expect(styles.answerAlign).toBe('center');
    expect(styles.wordmark).toBe('rgb(255, 255, 255)');
    expect(styles.cta).toBe('rgb(79, 168, 232)');
    expect(styles.ctaColor, 'the button label is ink').toBe('rgb(14, 27, 38)');
    expect(contrast(styles.ctaColor, styles.cta), 'the button label passes 4.5:1').toBeGreaterThanOrEqual(4.5);
    expect(styles.sheet).toBe('rgb(255, 255, 255)');
    expect(styles.note).toBe(13);
    expect(styles.noteAlign).toBe('center');
    expect(styles.fontFaces, 'no @font-face').toBe(0);
    expect(styles.ctaPosition).toBe('fixed');
  });
}

test('the phone frame shrinks first: smaller at 375x667 than at 393x852, the H1 the same', async ({ page }) => {
  const sizes = [];
  for (const vp of [{ width: 393, height: 852 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(vp);
    await page.goto(TAGGED_QS);
    await frames(page);
    sizes.push(await page.evaluate(() => ({
      phone: document.querySelector('.phone').getBoundingClientRect().height,
      h1: getComputedStyle(document.querySelector('h1')).fontSize
    })));
  }
  expect(sizes[0].phone).toBeGreaterThan(450);
  expect(sizes[1].phone).toBeLessThan(sizes[0].phone - 150);
  expect(sizes[1].h1).toBe(sizes[0].h1);
});

test('the Reserve sheet stays in view after a scroll, and the footer\'s last line clears it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(TAGGED_QS);
  const before = await bbox(page.locator('.cta'));
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => window.scrollY > 300);
  const mid = await bbox(page.locator('.cta'));
  expect(mid).toEqual(before);
  expect(mid.bottom).toBeCloseTo(667, 0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await frames(page);
  const end = await bbox(page.locator('.cta'));
  expect(end).toEqual(before);
  const copy = await bbox(page.locator('.foot-copy'));
  expect(copy.bottom, '© 2026 Parakeet. ends above the sheet').toBeLessThanOrEqual(end.top);
  // the sheet's button is the same reserve button: one press opens the plan sheet from anywhere
  await page.locator('.cta .btn').click();
  await expect(page.locator('#step-1')).toBeVisible();
});

test('the rows and the footer fade in once: .in the first time they enter the viewport, never removed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(TAGGED_QS);
  await frames(page, 3);
  const reveals = page.locator('[data-reveal]');
  await expect(reveals).toHaveCount(4);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reveal].in').length), 'nothing below the first screen yet').toBe(0);
  for (let y = 100; y <= 1200; y += 100) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await frames(page, 2);
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-reveal].in').length === 4);
  const anim = await page.evaluate(() => {
    const a = document.querySelector('.footer').getAnimations()[0];
    return a ? { name: a.animationName, duration: a.effect.getTiming().duration } : null;
  });
  expect(anim).toEqual({ name: 'rise', duration: 500 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page, 3);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reveal].in').length), 'once: the class stays').toBe(4);
  await page.waitForTimeout(600);
  for (let i = 0; i < 4; i++) expect(await reveals.nth(i).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test.describe('scripts off', () => {
  test.use({ javaScriptEnabled: false });
  test('the rows, the footer and the last answer are visible at rest', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(TAGGED_QS);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    for (const sel of ['.fact >> nth=0', '.fact >> nth=1', '.fact >> nth=2', '.footer']) {
      const el = page.locator(sel);
      await expect(el).toBeVisible();
      expect(await el.evaluate((n) => getComputedStyle(n).opacity), `${sel} opacity`).toBe('1');
      expect(await el.evaluate((n) => n.classList.contains('in')), `${sel} has no .in`).toBe(false);
    }
    expect(await page.locator('.answer-3').evaluate((n) => getComputedStyle(n).opacity)).toBe('1');
  });
});

test('the answer line: one pass through three answers (2.5 s each, 400 ms fades), then the last stays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(TAGGED_QS);
  const timing = await page.evaluate(() => ['.answer-1', '.answer-2', '.answer-3'].map((sel) => {
    const [a] = document.querySelector(sel).getAnimations();
    const t = a.effect.getTiming();
    return { duration: t.duration, delay: t.delay, iterations: t.iterations, fill: t.fill };
  }));
  expect(timing).toEqual([
    { duration: 2900, delay: 0, iterations: 1, fill: 'both' },
    { duration: 5400, delay: 0, iterations: 1, fill: 'both' },
    { duration: 400, delay: 5000, iterations: 1, fill: 'both' }
  ]);
  const opacityAt = (ms) => page.evaluate((t) => {
    const out = [];
    for (const sel of ['.answer-1', '.answer-2', '.answer-3']) {
      const el = document.querySelector(sel);
      for (const a of el.getAnimations()) { a.pause(); a.currentTime = t; }
      out.push(Number(getComputedStyle(el).opacity));
    }
    return out;
  }, ms);
  expect(await opacityAt(1000)).toEqual([1, 0, 0]);
  expect(await opacityAt(4000)).toEqual([0, 1, 0]);
  expect(await opacityAt(9000)).toEqual([0, 0, 1]);
  expect((await opacityAt(2700))[0], 'mid-fade').toBeLessThan(1);
  // the H1 never moves
  expect(await page.locator('h1').evaluate((h) => h.getAnimations().length)).toBe(0);
});

test('reduced motion: the last answer shows, still; the passing ones are hidden', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(TAGGED_QS);
  const state = await page.evaluate(() => ['.answer-1', '.answer-2', '.answer-3'].map((sel) => {
    const el = document.querySelector(sel);
    const cs = getComputedStyle(el);
    return { animations: el.getAnimations().length, opacity: cs.opacity, visibility: cs.visibility };
  }));
  expect(state[2]).toEqual({ animations: 0, opacity: '1', visibility: 'visible' });
  expect(state[0].visibility).toBe('hidden');
  expect(state[1].visibility).toBe('hidden');
  await expect(page.locator('.answer-3')).toHaveText('Know what dinner costs before you shop.');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await frames(page, 3);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reveal].in').length), 'no scroll fade').toBe(0);
});

test('the first screen\'s transfer: at most 300 KB in all, no image over 40 KB but the bezel (at most 80 KB)', async ({ page }) => {
  const sizes = [];
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith('/api/')) return;
    try { sizes.push({ path: url.pathname, type: res.headers()['content-type'] || '', bytes: (await res.body()).length }); } catch { /* aborted */ }
  });
  await page.goto(TAGGED_QS);
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);
  const total = sizes.reduce((n, s) => n + s.bytes, 0);
  expect(total, JSON.stringify(sizes)).toBeLessThanOrEqual(300 * 1024);
  for (const s of sizes.filter((x) => x.type.startsWith('image/'))) {
    const cap = s.path === '/media/iphone-bezel-v1.webp' ? 80 * 1024 : 40 * 1024;
    expect(s.bytes, s.path).toBeLessThanOrEqual(cap);
  }
  expect(sizes.map((s) => s.path)).toEqual(expect.arrayContaining(['/', '/styles.css', '/app.js', '/media/iphone-bezel-v1.webp', '/media/dish-quesadillas-480.webp', '/media/dish-wraps-480.webp']));
  // nothing render-blocking beyond the one stylesheet: the one script is deferred
  const blocking = await page.evaluate(() => [...document.querySelectorAll('head script:not([defer]):not([async]), link[rel="stylesheet"]')].map((n) => n.getAttribute('src') || n.getAttribute('href')));
  expect(blocking).toEqual(['/styles.css']);
});

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
