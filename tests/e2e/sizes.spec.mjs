// The sizes that must hold (SITE-04 §6.1, §6.4 and §6.8 #2, #8 and #11; DESIGN.md §4 and §7):
// - no sideways scroll, on phones (an iPhone's page and an Android phone's) and computers, from 320 to
//   1600 wide, at the top and at the page's end, and no box crossing the window's sides;
// - Apple's bezel never under 200 px, on any of the page's three phones;
// - in 375 x 550 (an iPhone SE's Safari with its bars) and shorter phone windows, the bar is pinned while the
//   words, a 200 px phone and the bar fit, and otherwise sits in the page under the first screen with the
//   story's tile scrolling with its lines; while the bar is pinned a whole story line shows between the
//   held tile and the bar; on a computer at 1440 x 780 and 1024 x 660 (no bar) the held tile fits under the
//   header;
// - an upright iPad stops the phone at 343 x 700;
// - above 1440 wide the page is a centred 1440 column;
// - the footer's giant row (the bird beside the wordmark) never overflows its row at 320 wide, nor at
//   196 (a 393 phone at 200% zoom).
//
// How many lines the words take depends on the font; the container has no SF Pro, so whether the words, a
// 200 px phone and the bar fit is measured on the page, never pinned.

import { test, expect, TAGGED_QS, frames, bbox } from './fixtures.mjs';
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
  { width: 375, height: 500, ua: PHONES.iPhone, name: 'a phone window too short' },
  { width: 320, height: 568, ua: PHONES.iPhone, name: 'a 320 phone with Safari\'s bars' },
  { width: 720, height: 450, ua: COMPUTER_UAS.safari_mac, mobile: false, name: 'a 1440x900 computer at 200% zoom' }
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
  { width: 196, height: 426, ua: PHONES.iPhone, name: 'a 393 phone at 200% zoom (196x426)' }
];

for (const w of GIANT) {
  test.describe(w.name, () => {
    test.use({ viewport: { width: w.width, height: w.height }, userAgent: w.ua });

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
          word: [r('.giant-word').left, r('.giant-word').right, r('.giant-word').height]
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
    });
  });
}
