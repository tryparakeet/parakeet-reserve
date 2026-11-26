// The sizes that must hold (SITE-04 §6.1, §6.4 and §6.8 #2, #8 and #11; DESIGN.md §4 and §7):
// - no sideways scroll, on phones (an iPhone's page and an Android phone's) and computers, from 320 to
//   1600 wide, at the top and at the page's end, and no box crossing the window's sides;
// - Apple's bezel never under 200 px, on any of the page's three phones;
// - in 375 x 550 (an iPhone SE's Safari with its bars) and shorter phone windows, the bar is pinned while the
//   words, a 200 px phone and the bar fit, and otherwise sits in the page under the first screen with the
//   story's tile scrolling with its lines; while the bar is pinned a whole story line shows between the
//   held tile and the bar; on a computer at 1440 x 780 and 1024 x 660 (no bar) the held tile fits under the
//   header, and in a computer window too short to hold it whole (an Android phone on its side) it scrolls
//   with its lines, the focus line still working;
// - an upright iPad stops the phone at 343 x 700;
// - in a browser without svh units, the story's tile keeps its height and its phone;
// - above 1440 wide the page is a centred 1440 column;
// - the footer's giant row (the bird beside the wordmark) never overflows its row at 320 wide, nor at
//   196 (a 393 phone at 200% zoom).
//
// How many lines the words take depends on the font; the container has no SF Pro, so whether the words, a
// 200 px phone and the bar fit is measured on the page, never pinned.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, TAGGED_QS, ROOT, frames, bbox } from './fixtures.mjs';
import { REAL_UAS, COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const PHONES = { iPhone: REAL_UAS.safari_ios, Android: REAL_UAS.chrome_android };
const MAC = { isMobile: false, hasTouch: false, userAgent: COMPUTER_UAS.safari_mac };

async function load(page) {
  await page.goto(TAGGED_QS);
  await expect(page.locator('h1')).toHaveText('What’s for dinner this week?');
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  await frames(page);
}

// Everything that would scroll the page sideways: the page wider than the window, a sideways scroll that
// moves, and any box crossing the window's sides that nothing around it clips.
function sideways(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const y = window.scrollY;
    window.scrollTo(80, y);
    const moved = window.scrollX;
    window.scrollTo(0, y);
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.left >= -0.5 && r.right <= window.innerWidth + 0.5) continue;
      let clipped = false;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).overflowX !== 'visible') { clipped = true; break; }
      }
      if (!clipped) out.push(`${el.tagName.toLowerCase()}.${el.classList[0] || ''} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return { width: de.scrollWidth - de.clientWidth, body: document.body.scrollWidth - de.clientWidth, inner: window.innerWidth - de.clientWidth, moved, out };
  });
}

const phoneHeights = (page) => page.evaluate(() => [...document.querySelectorAll('.phone')]
  .filter((p) => p.getClientRects().length)
  .map((p) => ({ where: p.parentElement.className.split(' ')[0], height: p.getBoundingClientRect().height, ratio: p.getBoundingClientRect().width / p.getBoundingClientRect().height })));

/* ---------- no sideways scroll, and the bezel never under 200 ---------- */

const WINDOWS = [
  { width: 393, height: 852, kind: 'phone' },
  { width: 375, height: 667, kind: 'phone' },
  { width: 412, height: 915, kind: 'phone' },
  { width: 360, height: 800, kind: 'phone' },
  { width: 320, height: 568, kind: 'phone' },
  { width: 1440, height: 900, kind: 'computer' },
  { width: 1024, height: 768, kind: 'computer' },
  { width: 900, height: 700, kind: 'computer' },
  { width: 1600, height: 900, kind: 'computer' }
];

const RUNS = WINDOWS.flatMap((w) => (w.kind === 'phone'
  ? Object.entries(PHONES).map(([name, ua]) => ({ ...w, name, use: { viewport: { width: w.width, height: w.height }, userAgent: ua } }))
  : [{ ...w, name: 'a computer', use: { viewport: { width: w.width, height: w.height }, ...MAC } }]));

for (const run of RUNS) {
  test.describe(`${run.name} at ${run.width}x${run.height}`, () => {
    test.use(run.use);

    test('no sideways scroll, at the top or the page\'s end; every bezel at least 200 px tall', async ({ page }) => {
      await load(page);
      for (const at of ['the top', 'the end']) {
        if (at === 'the end') {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await frames(page);
          await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
        }
        const got = await sideways(page);
        expect(got.inner, `${at}: the window is the page's width (no zoomed-out layout)`).toBe(0);
        expect(got.width, `${at}: the page is no wider than the window`).toBeLessThanOrEqual(0);
        expect(got.body, `${at}: the body is no wider than the window`).toBeLessThanOrEqual(0);
        expect(got.moved, `${at}: a sideways scroll doesn't move`).toBe(0);
        expect(got.out, `${at}: no box crosses the window's sides`).toEqual([]);
      }
      const phones = await phoneHeights(page);
      expect(phones.map((p) => p.where)).toEqual(['first-tile', 'story-tile', 'tile-yours']);
      for (const p of phones) {
        expect(p.height, `${p.where}: the bezel is at least 200 px`).toBeGreaterThanOrEqual(199.99);
        expect(p.ratio, `${p.where}: the bezel at 224:457`).toBeCloseTo(224 / 457, 2);
      }
    });
  });
}

/* ---------- short windows: the bar pinned while the words, a 200 px phone and the bar fit ---------- */

// The first screen's needs: the header, the words with the margin under them, a 200 px phone with the
// tile's padding above and below, and the bar (without the bottom edge it gets in the page).
function firstScreenNeeds(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const cs = (s) => getComputedStyle(q(s));
    const r = (s) => q(s).getBoundingClientRect();
    const tilePad = parseFloat(cs('.first-tile').paddingTop) + parseFloat(cs('.first-tile').paddingBottom);
    const words = r('.first-words').height + parseFloat(cs('.first-words').marginBottom);
    const bar = r('.cta').height - parseFloat(cs('.cta').borderBottomWidth);
    return {
      needs: r('.top').height + words + 200 + tilePad + bar,
      height: window.innerHeight,
      bar: cs('.cta').position,
      pin: cs('.story-pin').position
    };
  });
}

// Holds the story's tile: the story's top scrolled 120 px past the window's top, once the tile has risen.
async function holdStory(page) {
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.story').getBoundingClientRect().top + window.scrollY + 120));
  await page.waitForFunction(() => {
    const tile = document.querySelector('.story-tile');
    return !tile.classList.contains('wait') && tile.getAnimations().every((a) => a.playState === 'finished');
  });
  await frames(page);
}

const SHORT_PHONES = [
  { width: 375, height: 550, ua: PHONES.iPhone, name: 'an iPhone SE\'s Safari with its bars (§6.4)' },
  { width: 375, height: 550, ua: PHONES.Android, name: 'an Android phone at 375x550' },
  { width: 375, height: 547, ua: PHONES.iPhone, name: 'an iPhone SE\'s Safari 3 px shorter' },
  { width: 320, height: 580, ua: PHONES.Android, name: 'an Android phone at 320x580, its own short-window height' },
  { width: 393, height: 582, ua: PHONES.Android, name: 'an Android phone at 393x582, its own short-window height' },
  { width: 375, height: 500, ua: PHONES.iPhone, name: 'a phone window too short' },
  { width: 320, height: 568, ua: PHONES.iPhone, name: 'a 320 phone with Safari\'s bars' },
  // under 360 wide styles.css's heights count a two-line answer line; where the words take fewer lines, the
  // measure keeps the bar pinned
  { width: 359, height: 560, ua: PHONES.iPhone, name: 'an iPhone at 359x560, under the height styles.css gives 359 wide' },
  { width: 356, height: 550, ua: PHONES.Android, name: 'an Android phone at 356x550, under the height styles.css gives 356 wide' },
  { width: 720, height: 450, ua: COMPUTER_UAS.safari_mac, mobile: false, name: 'a 1440x900 computer at 200% zoom' },
  // under about 280 wide the H1 takes a third line, which no height in styles.css counts: app.js measures it
  { width: 250, height: 600, ua: PHONES.iPhone, name: 'an iPhone at 250x600, its H1 in three lines' },
  { width: 270, height: 610, ua: PHONES.iPhone, name: 'an iPhone at 270x610, its H1 in three lines' },
  { width: 250, height: 600, ua: PHONES.Android, name: 'an Android phone at 250x600, its H1 in three lines' },
  { width: 250, height: 600, ua: COMPUTER_UAS.safari_mac, mobile: false, name: 'a 500x1200 computer window at 200% zoom' }
];

for (const w of SHORT_PHONES) {
  test.describe(`${w.name}, ${w.width}x${w.height}`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, userAgent: w.ua, ...(w.mobile === false ? { isMobile: false, hasTouch: false } : {}) });

    test('the bar is pinned while the words, a 200 px phone and the bar fit, and otherwise sits in the page and the story\'s tile scrolls; the bezel never under 200', async ({ page }) => {
      await load(page);
      const first = await firstScreenNeeds(page);
      const fits = first.needs <= first.height + 0.5;
      const phone = await bbox(page.locator('.first-tile .phone'));
      expect(phone.height, 'the bezel is at least 200 px').toBeGreaterThanOrEqual(199.99);
      if (fits) {
        expect(first.bar, `${first.needs.toFixed(1)} px fit in ${first.height}: the bar is pinned`).toBe('fixed');
        expect(first.pin, 'the story\'s tile is held').toBe('sticky');
        const cta = await bbox(page.locator('.cta'));
        expect(cta.bottom).toBeCloseTo(w.height, 0);
        expect((await bbox(page.locator('.first-tile'))).bottom, 'the bar never covers the phone').toBeLessThanOrEqual(cta.top + 0.5);

        // a whole story line shows between the held tile and the bar
        await holdStory(page);
        const tile = await bbox(page.locator('.story-tile'));
        const lines = await page.evaluate(() => [...document.querySelectorAll('.story-line')].map((l) => l.getBoundingClientRect().height));
        expect(tile.top, 'the tile is held at the top').toBeLessThan(20);
        expect(cta.top - tile.bottom, 'room for the tallest story line between the tile and the bar').toBeGreaterThanOrEqual(Math.max(...lines));
        for (const p of await phoneHeights(page)) expect(p.height, `${p.where}: at least 200 px`).toBeGreaterThanOrEqual(199.99);
      } else {
        expect(first.bar, `${first.needs.toFixed(1)} px don't fit in ${first.height}: the bar sits in the page`).toBe('relative');
        expect(phone.height, 'the phone stays at 200').toBeCloseTo(200, 1);
        const cta = await bbox(page.locator('.cta'));
        expect(cta.top, 'under the first screen').toBeGreaterThanOrEqual((await bbox(page.locator('.first'))).bottom - 0.5);
        const edge = await page.locator('.cta').evaluate((el) => {
          const cs = getComputedStyle(el);
          return [cs.borderBottomWidth, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
        });
        expect(edge, 'its hairline closed, all four corners 24').toEqual(['1px', '24px', '24px']);
        expect(first.pin, 'the story\'s tile isn\'t held').toBe('relative');
        await holdStory(page);
        const before = await bbox(page.locator('.story-tile'));
        await page.evaluate(() => window.scrollBy(0, 80));
        await frames(page);
        expect((await bbox(page.locator('.story-tile'))).top, 'the story\'s tile scrolls with its lines').toBeCloseTo(before.top - 80, 0);
        for (const p of await phoneHeights(page)) expect(p.height, `${p.where}: at least 200 px`).toBeGreaterThanOrEqual(199.99);
      }
    });
  });
}

/* ---------- the held story tile ends above the focus line ---------- */

// A story line takes the focus as its text crosses 66% of the window's height, so the held tile ends above
// that line: otherwise a line turns ink, and the phone changes screen, while it is half under the tile.
// Android's bar is shorter than the iPhone's, so its tile would reach further down without the cap.
const FOCUS_WINDOWS = [
  { width: 360, height: 600, ua: PHONES.Android },
  { width: 393, height: 600, ua: PHONES.Android },
  { width: 412, height: 620, ua: PHONES.Android },
  { width: 412, height: 915, ua: PHONES.Android, tile: 404 },
  { width: 375, height: 550, ua: PHONES.iPhone },
  { width: 393, height: 600, ua: PHONES.iPhone },
  { width: 393, height: 852, ua: PHONES.iPhone, tile: 404 }
];

for (const w of FOCUS_WINDOWS) {
  test.describe(`${w.ua === PHONES.Android ? 'Android' : 'iPhone'} at ${w.width}x${w.height}`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, userAgent: w.ua });

    test('the held story tile ends above the focus line, 66% of the window\'s height', async ({ page }) => {
      await load(page);
      expect(await page.locator('.cta').evaluate((el) => getComputedStyle(el).position), 'the bar is pinned').toBe('fixed');
      await holdStory(page);
      const tile = await bbox(page.locator('.story-tile'));
      expect(tile.top, 'the tile is held at the top').toBeLessThan(20);
      expect(tile.bottom, 'the tile ends above the focus line').toBeLessThanOrEqual(w.height * 0.66);
      if (w.tile) expect(tile.height, 'a tall window\'s tile stays at its 404').toBeCloseTo(w.tile, 1);
    });
  });
}

for (const vp of [{ width: 1440, height: 780 }, { width: 1024, height: 660 }]) {
  test.describe(`a computer at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, ...MAC });

    test('no bar; the story\'s tile is held and fits under the header, its phone at least 200 px', async ({ page }) => {
      await load(page);
      expect(await page.locator('.cta').evaluate((el) => getComputedStyle(el).display)).toBe('none');
      expect(await page.locator('.story-pin').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
      await holdStory(page);
      const header = await bbox(page.locator('.top'));
      const tile = await bbox(page.locator('.story-tile'));
      expect(header.top, 'the header holds the top').toBe(0);
      expect(tile.top, 'the tile under the header').toBeGreaterThanOrEqual(header.bottom);
      expect(tile.bottom, 'the whole tile in the window').toBeLessThanOrEqual(vp.height);
      await page.evaluate(() => window.scrollBy(0, 100));
      await frames(page);
      expect((await bbox(page.locator('.story-tile'))).top, 'held in place as the lines scroll').toBeCloseTo(tile.top, 0);
      for (const p of await phoneHeights(page)) expect(p.height, `${p.where}: at least 200 px`).toBeGreaterThanOrEqual(199.99);
    });
  });
}

/* ---------- a computer window too short to hold the story's tile: it scrolls with its lines ---------- */

// Held, the story's tile sits at --story-top under the 72 px header (88 up to 1024 wide, 96 from 1440) and
// floors at 280 so its phone stays 200, so it needs a window of 368 + (width - 1024) / 52 px. In a shorter
// one (an Android phone on its side with Chrome's bars) it isn't held and scrolls with its lines, as on a
// phone (SITE-04 §6.8 #8), its fourth step as tall as the others with nothing to hold; in one just that
// tall it is held whole under the header, as before. Either way the focus line, the window's middle, still
// moves the lines and the screens.
const SHORT_COMPUTERS = [
  { width: 915, height: 332, use: { userAgent: PHONES.Android }, held: false, name: 'an Android phone on its side with Chrome\'s bars' },
  { width: 915, height: 356, use: { userAgent: PHONES.Android }, held: false, name: 'an Android phone on its side with Chrome\'s bars' },
  { width: 1024, height: 360, use: MAC, held: false, name: 'a computer window 8 px too short' },
  { width: 1024, height: 368, use: MAC, held: true, name: 'a computer window just tall enough' },
  { width: 1440, height: 375, use: MAC, held: false, name: 'a computer window 1 px too short' },
  { width: 1440, height: 376, use: MAC, held: true, name: 'a computer window just tall enough' }
];

// Line n's text a few px past the window's middle, the focus line on a computer: n is in focus, its screen on.
async function focusMiddle(page, n) {
  await page.evaluate((k) => {
    const line = document.querySelectorAll('.story-line')[k];
    window.scrollBy(0, line.getBoundingClientRect().top - (window.innerHeight * 0.5 - 8));
  }, n);
  await page.waitForFunction((k) => {
    const on = (sel) => [...document.querySelectorAll(sel)].map((el, i) => (el.classList.contains('on') ? i : -1)).filter((i) => i >= 0);
    const lines = on('.story-line');
    const shots = on('.story .shot');
    return lines.length === 1 && lines[0] === k && shots.length === 1 && shots[0] === k;
  }, n);
}

for (const w of SHORT_COMPUTERS) {
  test.describe(`${w.name}, ${w.width}x${w.height}`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, ...w.use });

    test(w.held
      ? 'the story\'s tile is held whole under the header, its phone at 200; the focus line moves the lines and the screens'
      : 'the story\'s tile isn\'t held and scrolls with its lines, its phone at 200; the focus line still moves the lines and the screens', async ({ page }) => {
      await load(page);
      expect(await page.locator('.cta').evaluate((el) => getComputedStyle(el).display), 'the computer\'s layout: no bar').toBe('none');
      await holdStory(page);
      const header = await bbox(page.locator('.top'));
      const tile = await bbox(page.locator('.story-tile'));
      expect(tile.height, 'the tile at its floor').toBeCloseTo(280, 1);
      for (const p of await phoneHeights(page)) expect(p.height, `${p.where}: at least 200 px`).toBeGreaterThanOrEqual(199.99);
      expect((await bbox(page.locator('.story-tile .phone'))).height, 'the story\'s phone at 200').toBeCloseTo(200, 1);
      await page.evaluate(() => window.scrollBy(0, 80));
      await frames(page);
      const after = await bbox(page.locator('.story-tile'));
      const pin = await page.locator('.story-pin').evaluate((el) => getComputedStyle(el).position);
      if (w.held) {
        expect(pin, 'the story\'s tile is held').toBe('sticky');
        expect(header.top, 'the header holds the top').toBe(0);
        expect(tile.top, 'the tile under the header').toBeGreaterThanOrEqual(header.bottom);
        expect(tile.bottom, 'the whole tile in the window').toBeLessThanOrEqual(w.height + 0.01);
        expect(after.top, 'held in place as the lines scroll').toBeCloseTo(tile.top, 0);
      } else {
        expect(pin, 'the story\'s tile isn\'t held').toBe('relative');
        expect(after.top, 'the story\'s tile scrolls with its lines').toBeCloseTo(tile.top - 80, 0);
        const steps = await page.evaluate(() => [...document.querySelectorAll('.story-step')].map((s) => s.getBoundingClientRect().height));
        expect(steps[3], 'the fourth step as tall as the others: nothing to hold').toBeCloseTo(steps[0], 0);
      }
      for (const n of [1, 2, 3, 0]) await focusMiddle(page, n);
    });
  });
}

/* ---------- a browser without svh units: the story's tile keeps its height and its phone ---------- */

// Safari before 15.4 and Chrome before 108 know no svh: there app.js sets --screen-h, and the story's tile
// takes its height from it. A browser like that is played here by serving styles.css with every svh renamed
// to a unit no browser knows, and app.js with its svh check failing; the story's tile, its phone and the
// fourth step (which holds the tile until line 4 reaches the header) come out as in a real load.
const NO_SVH = [
  { width: 393, height: 852, ua: PHONES.iPhone, tile: 404 },
  { width: 852, height: 393, ua: PHONES.iPhone, tile: 369 },
  { width: 250, height: 600, ua: PHONES.Android, tile: 404 },
  { width: 1440, height: 900, ua: COMPUTER_UAS.safari_mac, mobile: false, tile: 760 },
  { width: 1024, height: 768, ua: COMPUTER_UAS.safari_mac, mobile: false, tile: 640 },
  { width: 1440, height: 780, ua: COMPUTER_UAS.safari_mac, mobile: false, tile: 640 }
];

const storyBoxes = (page) => page.evaluate(() => ['.story-tile', '.story-tile .phone', '.story-step:last-child', '.first'].map((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return [sel, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
}));

for (const w of NO_SVH) {
  test.describe(`a browser without svh units at ${w.width}x${w.height}`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, userAgent: w.ua, ...(w.mobile === false ? { isMobile: false, hasTouch: false } : {}) });

    test('the story\'s tile keeps its height and its phone, as with svh', async ({ page }) => {
      await load(page);
      const real = await storyBoxes(page);
      expect(real[0][2], 'the story\'s tile').toBeCloseTo(w.tile, 1);

      const css = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8').replace(/svh/g, 'qqh');
      const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8').replace("'1svh'", "'1qqh'");
      await page.route('**/styles.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: css }));
      await page.route('**/app.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: js }));
      await load(page);
      expect(await page.evaluate(() => [
        [...document.styleSheets].some((s) => [...s.cssRules].some((r) => r.cssText.includes('qqh'))),
        CSS.supports('height', '1qqh'),
        getComputedStyle(document.documentElement).getPropertyValue('--screen-h')
      ]), 'no svh here: the stylesheet has none, and app.js has set --screen-h').toEqual([true, false, `${w.height}px`]);
      expect(await storyBoxes(page), 'the story\'s tile, its phone, the fourth step and the first screen, as with svh').toEqual(real);
    });
  });
}

/* ---------- the first screen on a computer keeps the boards' row heights ---------- */

// The white tile and the stores' tile take the boards' rows, 440 and 200 at 1024 wide and below, 520 and
// 252 at 1440, and the phone's tile spans both with the 16 px gap; three rows of chips (at 900 wide in any
// font) still fit the 200.
for (const vp of [{ width: 900, height: 768, rows: [440, 200] }, { width: 1024, height: 768, rows: [440, 200] }, { width: 1440, height: 900, rows: [520, 252] }]) {
  test.describe(`the first screen on a computer at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, ...MAC });

    test('the tiles keep the boards\' row heights, with three rows of chips too', async ({ page }) => {
      await load(page);
      const words = await bbox(page.locator('.first-words'));
      const stores = await bbox(page.locator('.first-stores'));
      const tile = await bbox(page.locator('.first-tile'));
      const chipRows = await page.evaluate(() => new Set([...document.querySelectorAll('.first-stores .chip')].map((c) => Math.round(c.getBoundingClientRect().top))).size);
      expect(words.height, 'the white tile').toBeCloseTo(vp.rows[0], 1);
      expect(stores.height, `the stores' tile, its chips in ${chipRows} rows`).toBeCloseTo(vp.rows[1], 1);
      expect(tile.height, 'the phone\'s tile spans both rows').toBeCloseTo(vp.rows[0] + 16 + vp.rows[1], 1);
    });
  });
}

/* ---------- the headline under the first screen: the boards' measure ---------- */

// The headline's box is the boards' 860 at 1024 wide and 1000 at 1440 (the page's own side padding around
// it); at 900 the page holds it to 900 less that padding.
for (const vp of [{ width: 900, height: 768, measure: 836 }, { width: 1024, height: 768, measure: 860 }, { width: 1440, height: 900, measure: 1000 }, { width: 1600, height: 900, measure: 1000 }]) {
  test.describe(`the headline on a computer at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, ...MAC });

    test('it takes the boards\' measure, centred', async ({ page }) => {
      await load(page);
      const h2 = await bbox(page.locator('.lede h2'));
      expect(h2.width, 'the headline\'s measure').toBeCloseTo(vp.measure, 1);
      expect((h2.left + h2.right) / 2, 'centred').toBeCloseTo(vp.width / 2, 1);
    });
  });
}

/* ---------- the story on a computer: each line in the middle of its step, and the hold ---------- */

// Each story line sits in the middle of its step, as the boards draw it, the fourth too, whether it takes
// one line or two (at 900 wide every line takes two in any font). The fourth step is the taller one, so the
// tile stays put until line 4 reaches the header, then leaves with it (SITE-04 §6.8 #3).
for (const vp of [{ width: 900, height: 768 }, { width: 1024, height: 768 }, { width: 1232, height: 900 }, { width: 1440, height: 900 }]) {
  test.describe(`the story on a computer at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, ...MAC });

    test('each line sits in the middle of its step, the fourth too; the tile holds until line 4 reaches the header', async ({ page }) => {
      await load(page);
      await holdStory(page);
      const steps = await page.evaluate(() => [...document.querySelectorAll('.story-step')].map((st) => {
        const l = st.querySelector('.story-line').getBoundingClientRect();
        return { top: l.top - st.getBoundingClientRect().top, line: l.height, step: st.getBoundingClientRect().height };
      }));
      const stepH = steps[0].step;
      for (const [i, st] of steps.entries()) {
        expect(st.top, `line ${i + 1} (${Math.round(st.line)} px) in the middle of its step's ${stepH}`).toBeCloseTo((stepH - st.line) / 2, 0);
      }

      const header = (await bbox(page.locator('.top'))).bottom;
      const line4To = async (y) => {
        await page.evaluate((to) => window.scrollBy(0, document.querySelectorAll('.story-line')[3].getBoundingClientRect().top - to), y);
        await frames(page);
        return (await bbox(page.locator('.story-tile'))).top;
      };
      const held = await line4To(header + 40);
      expect(held, 'the tile is held under the header').toBeGreaterThanOrEqual(header);
      expect(Math.abs(await line4To(header + 4) - held), 'still held as line 4 reaches the header').toBeLessThan(1);
      expect(Math.abs(await line4To(header - 20) - (held - 20)), 'then it leaves with line 4').toBeLessThan(1);
    });
  });
}

/* ---------- an upright iPad: the phone stops at 343 x 700 ---------- */

test.describe('an upright iPad at 820x1180', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('the first screen\'s phone stops at 343 x 700, the page in its 430 column', async ({ page }) => {
    await load(page);
    const phone = await bbox(page.locator('.first-tile .phone'));
    expect(phone.height).toBeCloseTo(700, 1);
    expect(phone.width).toBeCloseTo(343, 0);
    const column = await bbox(page.locator('.page'));
    expect(column.width).toBeCloseTo(430, 1);
    expect(column.left).toBeCloseTo((820 - 430) / 2, 1);
    expect(await page.locator('.cta').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  });
});

/* ---------- above 1440: a centred 1440 column ---------- */

for (const vp of [{ width: 1600, height: 900 }, { width: 1920, height: 1080 }]) {
  test.describe(`a computer at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, ...MAC });

    test('the page is a centred 1440 column: the header, the first screen, every part and the footer inside it', async ({ page }) => {
      await load(page);
      const left = (vp.width - 1440) / 2;
      for (const at of ['the top', 'scrolled']) {
        if (at === 'scrolled') {
          await page.evaluate(() => window.scrollTo(0, 2000));
          await frames(page);
        }
        const got = await page.evaluate(() => {
          const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
          const outside = [];
          const col = document.querySelector('.page').getBoundingClientRect();
          for (const el of document.querySelectorAll('.page *')) {
            if (!el.getClientRects().length) continue;
            const r = el.getBoundingClientRect();
            if (r.left < col.left - 0.5 || r.right > col.right + 0.5) outside.push(`${el.tagName.toLowerCase()}.${el.classList[0] || ''}`);
          }
          return { page: box(document.querySelector('.page')), top: box(document.querySelector('.top')), first: box(document.querySelector('.first')), footer: box(document.querySelector('.footer')), outside };
        });
        expect(got.page.width, `${at}: the column is 1440 wide`).toBeCloseTo(1440, 1);
        expect(got.page.left, `${at}: centred`).toBeCloseTo(left, 1);
        for (const part of ['top', 'first', 'footer']) {
          expect([got[part].left, got[part].right], `${at}: the ${part} spans the column`).toEqual([got.page.left, got.page.right]);
        }
        expect(got.outside, `${at}: nothing outside the column`).toEqual([]);
      }
    });
  });
}

/* ---------- the footer's giant row never overflows ---------- */

const GIANT = [
  { width: 320, height: 568, ua: PHONES.iPhone, name: 'an iPhone at 320x568' },
  { width: 320, height: 568, ua: PHONES.Android, name: 'an Android phone at 320x568' },
  { width: 196, height: 426, ua: PHONES.iPhone, name: 'a 393 phone at 200% zoom (196x426)' },
  { width: 900, height: 768, computer: true, name: 'a computer at 900x768' },
  { width: 1024, height: 768, computer: true, name: 'a computer at 1024x768' },
  { width: 1232, height: 900, computer: true, name: 'a computer at 1232x900' }
];

for (const w of GIANT) {
  test.describe(w.name, () => {
    test.use(w.computer ? { viewport: { width: w.width, height: w.height }, ...MAC } : { viewport: { width: w.width, height: w.height }, userAgent: w.ua });

    test('the footer\'s giant row, the bird beside the wordmark, stays inside its row', async ({ page }) => {
      await load(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator('.footer')).toHaveClass(/\bin\b/);
      await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
      const got = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const footer = r('.footer');
        const cs = getComputedStyle(document.querySelector('.footer'));
        const giant = document.querySelector('.giant');
        return {
          row: [footer.left + parseFloat(cs.paddingLeft), footer.right - parseFloat(cs.paddingRight)],
          giant: [r('.giant').left, r('.giant').right, giant.scrollWidth, giant.clientWidth],
          bird: [r('.giant-bird').left, r('.giant-bird').right, r('.giant-bird').height],
          word: [r('.giant-word').left, r('.giant-word').right, r('.giant-word').height],
          gap: parseFloat(getComputedStyle(giant).columnGap)
        };
      });
      expect(got.giant[2], 'nothing in the row past its width').toBeLessThanOrEqual(got.giant[3]);
      expect(got.giant[0]).toBeGreaterThanOrEqual(got.row[0] - 0.5);
      expect(got.giant[1], 'the row inside the footer\'s padding').toBeLessThanOrEqual(got.row[1] + 0.5);
      expect(got.bird[0]).toBeGreaterThanOrEqual(got.row[0] - 0.5);
      expect(got.word[0], 'the wordmark beside the bird').toBeGreaterThan(got.bird[1]);
      expect(got.word[1], 'the wordmark ends inside the row').toBeLessThanOrEqual(got.row[1] + 0.5);
      expect(got.bird[2]).toBeGreaterThan(0);
      expect(got.word[2]).toBeGreaterThan(0);
      expect((await sideways(page)).out, 'nothing crosses the window\'s sides').toEqual([]);
      if (w.computer) {
        // as large as the band allows: the board's min(296px, 20.5vw), held under (the row - its own gap) / 4.3
        const fit = Math.min(296, 0.205 * w.width, (got.row[1] - got.row[0] - got.gap) / 4.3);
        expect(got.bird[2], `the bird as large as the row allows with its ${got.gap} px gap`).toBeCloseTo(fit, 1);
      }
    });
  });
}
