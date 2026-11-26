// The first screen on a phone, as C-393 and C-375 draw it (DESIGN.md §4; SITE-04 §6.1, §6.4 and §6.8 #1,
// #8 and #11): the logo, the H1, the answer line, the phone on its sky tile and the bar, all in the window
// with no scroll. The words take C-375's sizes under 390 wide and C-393's from 390 up; within each set only
// the phone changes with the window's height, and Apple's bezel never goes under 200 px: in a window too
// short for the words, a 200 px phone and the bar, the bar sits in the page under the first screen. An
// upright iPad's phone stops at 343 x 700. Then the motion (DESIGN.md §6): the load rise (plain CSS, so it
// plays with the script off too), the answer line's one 5.8 s pass with the phone's screens moving with it,
// the six parts below the first screen that rise once, Reduce Motion's still end states and the script
// off. Then the pictures' weight, the bar while the page scrolls, the sheet under a keyboard-sized window,
// and closing the sheet with and without Reduce Motion.
//
// The container has no SF Pro: system-ui renders a stand-in, so how many lines the H1, the answer line and
// the bar's line take (and so the phone's exact height) is measured here, never pinned.

import { test, expect, TAGGED_QS, bbox, frames, sheetSettled } from './fixtures.mjs';
import { REAL_UAS } from '../fixtures/user-agents.mjs';

const ANDROID_UA = REAL_UAS.chrome_android;
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const CREAM = 'rgb(251, 246, 236)';
const INK = 'rgb(14, 27, 38)';
const INK_70 = 'rgba(14, 27, 38, 0.7)';
const INK_10 = 'rgba(14, 27, 38, 0.1)';
const SKY = 'rgb(79, 168, 232)';
const WHITE = 'rgb(255, 255, 255)';
const CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// The pictures that load at once: the logo's icon and the first screen's bezel and three screens. The
// story's and the price's stills are loading="lazy" and need not load while a test looks at the top.
async function eagerImages(page) {
  await page.waitForFunction(() => [...document.images]
    .filter((i) => i.getAttribute('loading') !== 'lazy')
    .every((i) => i.complete && i.naturalWidth > 0));
}

// Every animation played to its end (the load rise, the answer line), so the boxes are where they rest.
// With the script off no requestAnimationFrame callback runs, so there it doesn't wait for a frame.
async function atRest(page, { script = true } = {}) {
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  if (script) await frames(page);
}

// A part in place: no transform, or the identity an animation that has ended (fill: both) leaves.
const IN_PLACE = ['none', 'matrix(1, 0, 0, 1, 0, 0)'];

async function load(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(TAGGED_QS);
  await expect(page.locator('h1')).toHaveText('What’s for dinner this week?');
  await eagerImages(page);
  await atRest(page);
}

// The first screen's boxes and the bar's place, in one read.
function measure(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: window.scrollY,
      top: box('.top'),
      icon: box('.logo-icon'),
      word: box('.logo-word'),
      h1: box('h1'),
      answer: box('.answer'),
      androidLine: box('.first-words .android-line'),
      tile: box('.first-tile'),
      phone: box('.first-tile .phone'),
      first: box('.first'),
      cta: box('.cta'),
      ctaPosition: getComputedStyle(document.querySelector('.cta')).position
    };
  });
}

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

/* ---------- the first screen fits ---------- */

// 375 x 667 is C-375's window and 393 x 852 C-393's (§6.4); the others are the windows the paid links open
// in (inside TikTok and Instagram, Safari with its bars), all tall enough for the bar to stay pinned.
const FITS = [
  { width: 393, height: 852, note: 'iPhone 15, C-393' },
  { width: 375, height: 667, note: 'iPhone SE, C-375' },
  { width: 375, height: 617, note: 'iPhone SE inside TikTok' },
  { width: 393, height: 659, note: 'Pixel-class phone inside an app' },
  { width: 360, height: 640, note: 'small Android' },
  { width: 375, height: 553, note: 'iPhone SE, Safari with its bars' }
];

const FIRST_SCREEN = ['.top .logo-icon', '.top .logo-word', 'h1', '.answer-line.answer-3', '.first-tile .phone', '.cta .btn', '.cta-note'];

for (const vp of FITS) {
  test(`the first screen fits at ${vp.width}x${vp.height} with no scroll (${vp.note})`, async ({ page }) => {
    await load(page, { width: vp.width, height: vp.height });
    const m = await measure(page);
    expect(m.scrollY).toBe(0);
    for (const sel of FIRST_SCREEN) {
      const box = await bbox(page.locator(sel));
      expect(box.height, `${sel} has a height`).toBeGreaterThan(0);
      expect(box.top, `${sel} top inside the window`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `${sel} bottom inside the window`).toBeLessThanOrEqual(vp.height + 0.5);
      expect(box.left, `${sel} left inside the window`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${sel} right inside the window`).toBeLessThanOrEqual(vp.width + 0.5);
    }
    expect(await page.evaluate(() => [...document.querySelectorAll('.top-btn, .first-btn, .first-note, .first-stores')]
      .filter((el) => el.getClientRects().length).length), 'the computer\'s header button, white tile and stores are not on a phone').toBe(0);

    // the bar is pinned at the bottom and never over the phone; the tile ends 12 px above it, and only that
    // gap narrows once the phone is down to 200 px
    expect(m.ctaPosition).toBe('fixed');
    expect(m.cta.bottom).toBeCloseTo(vp.height, 0);
    const gap = m.cta.top - m.tile.bottom;
    expect(gap, 'the tile ends above the bar').toBeGreaterThanOrEqual(-0.5);
    if (m.phone.height > 200.5) expect(gap, 'the tile ends 12 px above the bar').toBeCloseTo(12, 0);
    else expect(gap).toBeLessThanOrEqual(12.5);

    // the phone: Apple's bezel whole, at its own proportions, centred at the top of its tile with the tile's
    // padding above and below, the screen under the bezel's opening
    const bezel = await bbox(page.locator('.first-tile .bezel'));
    const screen = await bbox(page.locator('.first-tile .phone-screen'));
    expect(bezel).toEqual(m.phone);
    expect(m.phone.width / m.phone.height, 'the bezel is 224:457').toBeCloseTo(224 / 457, 2);
    expect(m.phone.height, 'the bezel is never under 200 px (DESIGN.md §7)').toBeGreaterThanOrEqual(199.99);
    expect(m.phone.top, 'nothing over the phone: the answer line ends above it').toBeGreaterThanOrEqual(m.answer.bottom);
    expect(m.phone.left - m.tile.left, 'the phone is centred in its tile').toBeCloseTo(m.tile.right - m.phone.right, 0);
    expect(m.phone.top - m.tile.top, 'the tile\'s padding is the same above and below the phone').toBeCloseTo(m.tile.bottom - m.phone.bottom, 0);
    expect(m.tile.left, 'the tile is 12 px in from the column').toBeCloseTo(12, 0);
    expect(m.tile.right).toBeCloseTo(vp.width - 12, 0);
    expect((screen.left - m.phone.left) / m.phone.width).toBeCloseTo(10.43 / 224, 2);
    expect((screen.top - m.phone.top) / m.phone.height).toBeCloseTo(9.05 / 457, 2);
    expect(screen.width / m.phone.width).toBeCloseTo(203.14 / 224, 2);
    expect(screen.height / m.phone.height).toBeCloseTo(438.89 / 457, 2);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth
    }));
    expect(overflow.scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(overflow.clientWidth);
    expect(overflow.bodyScrollWidth, 'no horizontal overflow (body)').toBeLessThanOrEqual(overflow.clientWidth);

    const styles = await page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      let fontFaces = 0;
      for (const sheet of document.styleSheets) {
        try { for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule) fontFaces += 1; } catch { /* cross-origin: none expected */ }
      }
      const cta = cs('.cta');
      return {
        body: cs('body').backgroundColor,
        iconRadius: cs('.logo-icon').borderRadius,
        word: cs('.logo-word').color,
        h1Color: cs('h1').color,
        h1Align: cs('h1').textAlign,
        h1Weight: cs('h1').fontWeight,
        answerColor: cs('.answer-line.answer-3').color,
        answerAlign: cs('.answer-line.answer-3').textAlign,
        tile: cs('.first-tile').backgroundColor,
        tileRadius: cs('.first-tile').borderRadius,
        bar: cta.backgroundColor,
        barBorder: [cta.borderTopWidth, cta.borderTopStyle, cta.borderTopColor, cta.borderBottomWidth],
        barRadius: [cta.borderTopLeftRadius, cta.borderTopRightRadius, cta.borderBottomRightRadius, cta.borderBottomLeftRadius],
        button: cs('.cta .btn').backgroundColor,
        buttonColor: cs('.cta .btn').color,
        buttonHeight: document.querySelector('.cta .btn').getBoundingClientRect().height,
        note: [cs('.cta-note').fontSize, cs('.cta-note').lineHeight, cs('.cta-note').color, cs('.cta-note').textAlign],
        fontFaces
      };
    });
    expect(styles.body).toBe(CREAM);
    expect(styles.iconRadius, 'the icon\'s corners as the app draws them').toBe('22.37%');
    expect(styles.word, 'the wordmark in ink').toBe(INK);
    expect(styles.h1Color).toBe(INK);
    expect(['start', 'left'], 'the H1 is left-aligned').toContain(styles.h1Align);
    expect(styles.h1Weight).toBe('700');
    expect(styles.answerColor).toBe(INK_70);
    expect(['start', 'left'], 'the answer line is left-aligned').toContain(styles.answerAlign);
    expect(styles.tile).toBe(SKY);
    expect(styles.tileRadius).toBe('28px');
    expect(styles.bar).toBe(WHITE);
    expect(styles.barBorder, 'a hairline with no bottom edge').toEqual(['1px', 'solid', INK_10, '0px']);
    expect(styles.barRadius, 'top corners 24').toEqual(['24px', '24px', '0px', '0px']);
    expect(styles.button).toBe(SKY);
    expect(styles.buttonColor, 'the button label is ink').toBe(INK);
    expect(contrast(styles.buttonColor, styles.button), 'the button label passes 4.5:1').toBeGreaterThanOrEqual(4.5);
    expect(styles.buttonHeight).toBe(56);
    expect(styles.note).toEqual(['13px', '18px', INK_70, 'center']);
    expect(styles.fontFaces, 'no @font-face').toBe(0);
  });
}

/* ---------- the words' sizes: C-375 under 390 wide, C-393 from 390 up ---------- */

const SETS = [
  { width: 389, board: 'C-375', top: 52, gap: 8, icon: 28, word: 19, h1: 30, h1mt: 8, answer: 16, answerLh: 22, answerMt: 8, tileMt: 14, tilePad: 16, bar: ['14px', '20px', '31px', '20px'], barH: 146 },
  { width: 390, board: 'C-393', top: 56, gap: 9, icon: 30, word: 20, h1: 34, h1mt: 12, answer: 17, answerLh: 24, answerMt: 10, tileMt: 18, tilePad: 20, bar: ['16px', '20px', '33px', '20px'], barH: 150 }
];

async function sizesOf(page) {
  const m = await measure(page);
  const css = await page.evaluate(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const cta = cs('.cta');
    return {
      h1: cs('h1').fontSize,
      answer: cs('.answer-line.answer-3').fontSize,
      answerLh: cs('.answer-line.answer-3').lineHeight,
      bar: [cta.paddingTop, cta.paddingRight, cta.paddingBottom, cta.paddingLeft],
      androidLine: [cs('.first-words .android-line').fontSize, cs('.first-words .android-line').lineHeight, cs('.first-words .android-line').fontWeight, cs('.first-words .android-line').color]
    };
  });
  return { m, css };
}

function expectSet({ m, css }, s) {
  expect(m.top.height, `${s.board}: the header`).toBeCloseTo(s.top, 1);
  expect(m.icon.width, `${s.board}: the icon`).toBeCloseTo(s.icon, 1);
  expect(m.icon.height).toBeCloseTo(s.icon, 1);
  expect((m.icon.top + m.icon.bottom) / 2, 'the icon is centred in the header').toBeCloseTo(m.top.height / 2, 0);
  expect(m.word.left - m.icon.right, `${s.board}: the gap beside the icon`).toBeCloseTo(s.gap, 1);
  expect(m.word.height, `${s.board}: the wordmark is as tall as the board's ${s.word} px word's capitals`).toBeCloseTo(0.736 * s.word, 1);
  expect(m.word.width / m.word.height, 'the wordmark at its own proportions').toBeCloseTo(4140 / 737, 2);
  expect(css.h1, `${s.board}: the H1`).toBe(`${s.h1}px`);
  expect(m.h1.top - m.top.bottom, `${s.board}: the H1's margin`).toBeCloseTo(s.h1mt, 1);
  expect(css.answer, `${s.board}: the answer line`).toBe(`${s.answer}px`);
  expect(css.answerLh).toBe(`${s.answerLh}px`);
  expect(m.answer.top - m.h1.bottom, `${s.board}: the answer line's margin`).toBeCloseTo(s.answerMt, 1);
  expect(m.phone.top - m.tile.top, `${s.board}: the tile's padding over the phone`).toBeCloseTo(s.tilePad, 1);
}

for (const s of SETS) {
  test(`at ${s.width} wide the words take ${s.board}'s sizes, and the bar its paddings`, async ({ page }) => {
    await load(page, { width: s.width, height: 852 });
    const got = await sizesOf(page);
    expectSet(got, s);
    expect(got.m.tile.top - got.m.answer.bottom, `${s.board}: the tile's margin`).toBeCloseTo(s.tileMt, 1);
    expect(got.css.bar, `${s.board}: the bar's padding`).toEqual(s.bar);
    expect(got.m.cta.height, `${s.board}: the bar is the board's ${s.barH} px box`).toBeCloseTo(s.barH, 1);
  });
}

test.describe('Android', () => {
  test.use({ userAgent: ANDROID_UA });
  for (const s of SETS) {
    test(`at ${s.width} wide the words take ${s.board}'s sizes; AN1's iPhone-only line and bar stay`, async ({ page }) => {
      await load(page, { width: s.width, height: 852 });
      expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(true);
      const got = await sizesOf(page);
      expectSet(got, s);
      const { m, css } = got;
      await expect(page.locator('.first-words .android-line')).toHaveText('Parakeet is iPhone only for now. We plan to bring it to Android.');
      expect(m.androidLine.top - m.answer.bottom, 'AN1: the line sits 12 under the answer line').toBeCloseTo(12, 1);
      expect(css.androidLine, 'AN1: 15/20, 600, ink').toEqual(['15px', '20px', '600', INK]);
      expect(m.tile.top - m.androidLine.bottom, `${s.board}: the tile's margin`).toBeCloseTo(s.tileMt, 1);
      expect(css.bar, 'AN1\'s bar: padding 16 20 24, with 23 showing under the button').toEqual(['16px', '20px', '23px', '20px']);
      const final = await bbox(page.locator('.cta .btn-final'));
      expect(m.cta.height, 'the bar holds only its button: AN1\'s 96 box').toBeCloseTo(1 + 16 + final.height + 23, 0);
      expect(m.cta.top - m.tile.bottom, 'the tile ends 12 px above the bar').toBeCloseTo(12, 0);
    });
  }
});

/* ---------- only the phone changes with the window's height ---------- */

const HEIGHTS = { 375: [900, 812, 740, 667, 600, 560], 393: [932, 852, 760, 700, 640, 600] };

for (const [width, heights] of Object.entries(HEIGHTS).map(([w, h]) => [Number(w), h])) {
  test(`at ${width} wide only the phone changes with the window's height: it shrinks first, the words never`, async ({ page }) => {
    await load(page, { width, height: heights[0] });
    const rows = [];
    for (const height of heights) {
      await page.setViewportSize({ width, height });
      await frames(page, 3);
      const m = await measure(page);
      const fonts = await page.evaluate(() => [getComputedStyle(document.querySelector('h1')).fontSize, getComputedStyle(document.querySelector('.answer-line.answer-3')).fontSize]);
      rows.push({ height, m, words: [m.top.height, m.h1.top, m.h1.height, m.answer.top, m.answer.height, m.tile.top, m.cta.height, ...fonts] });
    }
    for (const row of rows) {
      expect(row.words, `${width}x${row.height}: the words as at ${width}x${heights[0]}`).toEqual(rows[0].words);
      expect(row.m.phone.height, `${width}x${row.height}: the phone is over 200`).toBeGreaterThan(200);
      expect(row.m.cta.top - row.m.tile.bottom, `${width}x${row.height}: the tile ends 12 above the bar`).toBeCloseTo(12, 0);
    }
    for (let i = 1; i < rows.length; i++) {
      const window = rows[i - 1].height - rows[i].height;
      const phone = rows[i - 1].m.phone.height - rows[i].m.phone.height;
      expect(phone, `${width}x${rows[i].height}: the phone takes the whole ${window} px`).toBeCloseTo(window, 0);
    }
  });
}

/* ---------- the bezel is never under 200 px: pinned bar, or the bar in the page ---------- */

const SWEEP_WIDTHS = [320, 360, 375, 389, 390, 393, 430];

for (const [device, ua] of [['iPhone', undefined], ['Android', ANDROID_UA]]) {
  test.describe(`${device}: from 420 to 1000 tall`, () => {
    if (ua) test.use({ userAgent: ua });
    for (const width of SWEEP_WIDTHS) {
      test(`at ${width} wide the bezel is never under 200 px, and the bar is pinned over the window's bottom or in the page under the first screen`, async ({ page }) => {
        await load(page, { width, height: 1000 });
        let pinnedFrom = null;
        for (let height = 1000; height >= 420; height -= 10) {
          await page.setViewportSize({ width, height });
          await frames(page, 2);
          const m = await measure(page);
          const at = `${width}x${height}`;
          expect(m.phone.height, `${at}: the bezel is at least 200 px`).toBeGreaterThanOrEqual(199.99);
          expect(m.phone.width / m.phone.height, `${at}: the bezel at 224:457`).toBeCloseTo(224 / 457, 2);
          if (m.ctaPosition === 'fixed') {
            expect(pinnedFrom === null || pinnedFrom === height + 10, `${at}: the bar is pinned in every window taller than one where it is pinned`).toBe(true);
            pinnedFrom = height;
            expect(m.cta.bottom, `${at}: the bar at the window's bottom`).toBeCloseTo(height, 0);
            expect(m.tile.bottom, `${at}: the bar never covers the phone`).toBeLessThanOrEqual(m.cta.top + 0.5);
          } else {
            expect(m.phone.height, `${at}: in the page, the phone stays at 200`).toBeCloseTo(200, 1);
            expect(m.cta.top, `${at}: the bar sits under the first screen`).toBeGreaterThanOrEqual(m.first.bottom - 0.5);
          }
        }
        expect(pinnedFrom, `at ${width} wide the bar is pinned in a tall window`).not.toBeNull();
      });
    }
  });
}

/* ---------- a window too short: the bar in the page, the story's tile scrolls with its lines ---------- */

// The line in focus is the last whose text has crossed 66% of the window's height. Each step is 300 px or
// more, so a line placed at the middle has crossed and the next one hasn't.
async function focusLine(page, n) {
  await page.evaluate((k) => {
    const line = document.querySelectorAll('.story-line')[k];
    window.scrollBy(0, line.getBoundingClientRect().top - window.innerHeight * 0.5);
  }, n);
  await page.waitForFunction((k) => {
    const on = (sel) => [...document.querySelectorAll(sel)].map((el, i) => (el.classList.contains('on') ? i : -1)).filter((i) => i >= 0);
    const lines = on('.story-line');
    const shots = on('.story .shot');
    return lines.length === 1 && lines[0] === k && shots.length === 1 && shots[0] === k;
  }, n);
}

for (const vp of [{ width: 393, height: 560, note: 'a short window' }, { width: 852, height: 393, note: 'a phone on its side' }]) {
  test(`at ${vp.width}x${vp.height} (${vp.note}) the bar sits in the page under a 200 px phone, and the story's tile scrolls with its lines, its focus still working`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await load(page, { width: vp.width, height: vp.height });
    const m = await measure(page);
    expect(m.ctaPosition, 'not pinned').toBe('relative');
    expect(m.phone.height, 'the phone stays at 200').toBeCloseTo(200, 1);
    expect(m.cta.top, 'under the first screen').toBeGreaterThanOrEqual(m.first.bottom - 0.5);
    expect(m.cta.top).toBeGreaterThanOrEqual(m.tile.bottom);
    const bar = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.cta'));
      return {
        border: ['Top', 'Right', 'Bottom', 'Left'].map((side) => `${cs[`border${side}Width`]} ${cs[`border${side}Style`]} ${cs[`border${side}Color`]}`),
        radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
      };
    });
    expect(bar.border, 'its hairline closed').toEqual(Array(4).fill(`1px solid ${INK_10}`));
    expect(bar.radius, 'all four corners 24').toEqual(Array(4).fill('24px'));
    expect(bar.padding, 'its paddings kept (C-393)').toEqual(['16px', '20px', '33px', '20px']);

    // the bar scrolls with the page
    await page.evaluate(() => window.scrollTo(0, 100));
    await frames(page);
    expect((await bbox(page.locator('.cta'))).top).toBeCloseTo(m.cta.top - 100, 0);

    // the story's tile isn't held in place: it scrolls with its lines
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.story-pin')).position)).toBe('relative');
    await focusLine(page, 0);
    await expect(page.locator('.story-tile'), 'the tile has come into view').toHaveClass(/\bin\b/);
    await atRest(page);   // its rise
    const tile = await bbox(page.locator('.story-tile'));
    await page.evaluate(() => window.scrollBy(0, 60));
    await frames(page);
    expect((await bbox(page.locator('.story-tile'))).top, 'the tile moves with the page').toBeCloseTo(tile.top - 60, 0);

    // the focus line still works: each line in turn, its screen with it, and back to the first
    for (const n of [1, 2, 3, 0]) await focusLine(page, n);
  });
}

/* ---------- an upright iPad: the phone stops at 343 x 700, and the extra height is cream ---------- */

// In a narrow, tall window (an iPad's Slide Over, 320 wide) the phone stops sooner, where it would leave
// less than 12 px of sky at each side, as the story's phone does; its tile stops with it, and the extra
// height is cream there too.
const TALL = [
  { width: 820, height: 1180, note: 'an upright iPad', phone: 700, pad: 20 },
  { width: 834, height: 1194, note: 'an upright iPad', phone: 700, pad: 20 },
  { width: 320, height: 1100, note: 'an iPad\'s Slide Over', phone: (320 - 48) * 457 / 224, pad: 16 },
  { width: 375, height: 1100, note: 'a narrow Split View', phone: (375 - 48) * 457 / 224, pad: 16 }
];

for (const vp of TALL) {
  test(`at ${vp.width}x${vp.height} (${vp.note}) the phone stops at ${Math.round(vp.phone * 224 / 457)} x ${Math.round(vp.phone)} with sky at its sides, and the extra height is cream`, async ({ page }) => {
    await load(page, vp);
    const m = await measure(page);
    expect(m.ctaPosition).toBe('fixed');
    expect(m.phone.height).toBeCloseTo(vp.phone, 1);
    expect(m.phone.width).toBeCloseTo(vp.phone * 224 / 457, 1);
    expect(m.phone.left - m.tile.left, 'sky at the phone\'s left').toBeGreaterThanOrEqual(12 - 0.5);
    expect(m.tile.right - m.phone.right, 'and at its right').toBeGreaterThanOrEqual(12 - 0.5);
    expect(m.phone.left - m.tile.left, 'the phone centred').toBeCloseTo(m.tile.right - m.phone.right, 1);
    expect(m.tile.height, 'the tile is the phone and its padding, no more').toBeCloseTo(vp.phone + 2 * vp.pad, 1);
    const gap = m.cta.top - m.tile.bottom;
    expect(gap, 'more than the 12 px a phone leaves').toBeGreaterThan(12.5);
    const under = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { inPart: !!el.closest('.first-tile, .lede, .story, .tile-yours, .stores, .facts, .footer, .cta'), bg: getComputedStyle(document.body).backgroundColor };
    }, { x: vp.width / 2, y: m.tile.bottom + gap / 2 });
    expect(under.inPart, 'nothing but the page between the tile and the bar').toBe(false);
    expect(under.bg).toBe(CREAM);
  });
}

/* ---------- the motion at load ---------- */

function timingOf(page, selectors) {
  return page.evaluate((sels) => sels.map((sel) => document.querySelector(sel).getAnimations().map((a) => {
    const t = a.effect.getTiming();
    return {
      name: a.animationName,
      duration: t.duration,
      delay: t.delay,
      iterations: t.iterations,
      fill: t.fill,
      keyframes: a.effect.getKeyframes().map((k) => ({ offset: Math.round(k.offset * 1000) / 1000, opacity: k.opacity ?? null, transform: k.transform ?? null, easing: k.easing }))
    };
  })), selectors);
}

test('at load the words rise 16 px and fade in, the phone\'s tile only rises, 100 ms later; the header and the bar stay still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(TAGGED_QS);
  const [words, tile, h1, top, cta] = await timingOf(page, ['.first-words', '.first-tile', 'h1', '.top', '.cta']);
  expect(words).toEqual([{ name: 'first-in', duration: 600, delay: 0, iterations: 1, fill: 'both', keyframes: [
    { offset: 0, opacity: '0', transform: 'translateY(16px)', easing: CURVE },
    { offset: 1, opacity: '1', transform: 'none', easing: CURVE }
  ] }]);
  expect(tile, 'the bezel never fades').toEqual([{ name: 'first-rise', duration: 600, delay: 100, iterations: 1, fill: 'both', keyframes: [
    { offset: 0, opacity: null, transform: 'translateY(16px)', easing: CURVE },
    { offset: 1, opacity: null, transform: 'none', easing: CURVE }
  ] }]);
  expect(h1, 'the H1 rises with its words, not on its own').toEqual([]);
  expect(top).toEqual([]);
  expect(cta).toEqual([]);
});

const LINES = ['.answer-line.answer-1', '.answer-line.answer-2', '.answer-line.answer-3'];
const STILLS = ['.first-tile .shot.answer-1', '.first-tile .shot.answer-2', '.first-tile .shot.answer-3'];

test('the answer line: one 5.8 s pass from 0.3 s through its three answers (about 2.5 s each, 400 ms fades), the phone\'s week, list and total with it, then the last stays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(TAGGED_QS);
  const all = await timingOf(page, [...LINES, ...STILLS]);
  const offsets = [[0, 0.431, 0.5, 1], [0, 0.431, 0.5, 0.931, 1], [0, 0.931, 1]];
  const opacities = [['1', '1', '0', '0'], ['0', '0', '1', '1', '0'], ['0', '0', '1']];
  all.forEach((anims, i) => {
    const n = i % 3;
    expect(anims.length, `${[...LINES, ...STILLS][i]}: one animation`).toBe(1);
    const [a] = anims;
    expect({ name: a.name, duration: a.duration, delay: a.delay, iterations: a.iterations, fill: a.fill }).toEqual({ name: `answer-${n + 1}`, duration: 5800, delay: 300, iterations: 1, fill: 'both' });
    expect(a.keyframes.map((k) => k.offset)).toEqual(offsets[n]);
    expect(a.keyframes.map((k) => k.opacity)).toEqual(opacities[n]);
    for (const k of a.keyframes) expect(k.easing).toBe('ease-in-out');
  });

  const opacityAt = (ms) => page.evaluate(({ t, sels }) => sels.map((sel) => {
    const el = document.querySelector(sel);
    for (const a of el.getAnimations()) { a.pause(); a.currentTime = t; }
    return Number(getComputedStyle(el).opacity);
  }), { t: ms, sels: [...LINES, ...STILLS] });
  for (const [ms, want] of [[0, [1, 0, 0]], [1000, [1, 0, 0]], [2700, [1, 0, 0]], [4000, [0, 1, 0]], [5600, [0, 1, 0]], [6200, [0, 0, 1]], [9000, [0, 0, 1]]]) {
    const got = await opacityAt(ms);
    expect(got.slice(0, 3), `the answers at ${ms} ms`).toEqual(want);
    expect(got.slice(3), `the phone's screens at ${ms} ms`).toEqual(want);
  }
  const mid = await opacityAt(3000);
  expect(mid[0], 'the first answer fading out at 3 s').toBeGreaterThan(0);
  expect(mid[0]).toBeLessThan(1);
  expect(mid[1], 'the second fading in').toBeGreaterThan(0);
  expect(mid[1]).toBeLessThan(1);
  expect(mid.slice(3), 'the screens fade with them').toEqual(mid.slice(0, 3));
});

/* ---------- the six parts below the first screen rise once ---------- */

const REVEALS = ['lede', 'story-tile', 'tile-yours', 'stores', 'facts', 'footer'];

async function revealState(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map((el) => ({
    part: el.classList[0],
    kind: el.getAttribute('data-reveal'),
    shown: el.getClientRects().length > 0,
    wait: el.classList.contains('wait'),
    in: el.classList.contains('in'),
    opacity: getComputedStyle(el).opacity,
    transform: getComputedStyle(el).transform
  })));
}

async function scrollThrough(page) {
  const end = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 100; y <= end; y += 100) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await frames(page, 2);
  }
}

test('the six parts below the first screen: the headline, the story\'s tile, the price\'s tile, the stores, Prices and Recipes, the footer', async ({ page }) => {
  await page.goto(TAGGED_QS);
  const parts = await revealState(page);
  expect(parts.map((p) => p.part)).toEqual(REVEALS);
  expect(parts.filter((p) => p.kind === 'rise').map((p) => p.part), 'the tiles with a phone only rise').toEqual(['story-tile', 'tile-yours']);
  expect(parts.filter((p) => p.kind === '').map((p) => p.part)).toEqual(['lede', 'stores', 'facts', 'footer']);
});

test('on a phone the parts below the bar wait, then rise 14 px once, 500 ms on the curve, the first time they show above it; the tiles with a phone don\'t fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load(page, { width: 393, height: 852 });
  const below = ['story-tile', 'tile-yours', 'stores', 'facts', 'footer'];
  const before = await revealState(page);
  for (const p of before.filter((x) => below.includes(x.part))) {
    expect(p.wait, `${p.part} waits`).toBe(true);
    expect(p.in, `${p.part} has not risen`).toBe(false);
    expect(p.transform, `${p.part} waits 14 px low`).toBe('matrix(1, 0, 0, 1, 0, 14)');
    expect(p.opacity, `${p.part}: ${p.kind === 'rise' ? 'never faded' : 'faded out'}`).toBe(p.kind === 'rise' ? '1' : '0');
  }
  // each rise read as it starts (a stores tile rests once its rise has ended, so it isn't read after)
  await page.evaluate(() => {
    window.rises = {};
    document.addEventListener('animationstart', (ev) => {
      if (!ev.target.hasAttribute || !ev.target.hasAttribute('data-reveal')) return;
      const a = ev.target.getAnimations().find((x) => x.animationName === ev.animationName);
      window.rises[ev.target.classList[0]] = a ? { name: a.animationName, duration: a.effect.getTiming().duration, easing: a.effect.getKeyframes()[0].easing } : null;
    });
  });
  await scrollThrough(page);
  await page.waitForFunction((parts) => parts.every((p) => document.querySelector(`.${p}`).classList.contains('in')), below);
  const anims = await page.evaluate((parts) => parts.map((p) => window.rises[p] || null), below);
  expect(anims).toEqual(below.map((p) => ({ name: ['story-tile', 'tile-yours'].includes(p) ? 'rise-only' : 'rise', duration: 500, easing: CURVE })));
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page, 3);
  await page.waitForTimeout(600);
  const after = await revealState(page);
  for (const p of after.filter((x) => below.includes(x.part))) {
    expect(p.in, `${p.part}: once, the class stays`).toBe(true);
    expect(p.wait).toBe(false);
    expect(p.opacity, `${p.part} at rest`).toBe('1');
    expect(IN_PLACE, `${p.part} in place`).toContain(p.transform);
  }
});

// The headline sits behind the pinned bar at load on a phone (its top is inside the window, under the bar),
// so app.js never gives it the waiting state and it never rises, though §6.8 #6 asks it to rise as it comes
// into view and the reveal counts what shows above the bar. Marked as failing until the page waits for it;
// it then passes, and the mark comes off.
test('on a phone the headline under the first screen waits behind the bar and rises once (SITE-04 §6.8 #6)', async ({ page }) => {
  test.fail(true, 'app.js gives .wait only to a part whose top is below the window, not below the pinned bar');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load(page, { width: 393, height: 852 });
  const lede = await bbox(page.locator('.lede'));
  const cta = await bbox(page.locator('.cta'));
  expect(lede.top, 'the headline starts under the bar\'s top').toBeGreaterThan(cta.top);
  const [p] = (await revealState(page)).filter((x) => x.part === 'lede');
  expect(p.wait, 'the headline waits').toBe(true);
  await scrollThrough(page);
  await expect(page.locator('.lede')).toHaveClass(/\bin\b/);
});

test.describe('on a computer', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, userAgent: MAC_UA });

  test('the parts below the first screen wait, then rise 14 px once as they come into view; the headline fades in too; the stores sit on the first screen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await load(page);
    const below = ['lede', 'story-tile', 'tile-yours', 'facts', 'footer'];
    const before = await revealState(page);
    expect(before.filter((p) => !p.shown).map((p) => p.part), 'the phone\'s stores tile isn\'t shown').toEqual(['stores']);
    for (const p of before.filter((x) => below.includes(x.part))) {
      expect(p.wait, `${p.part} waits`).toBe(true);
      expect(p.opacity).toBe(p.kind === 'rise' ? '1' : '0');
    }
    await expect(page.locator('.first-stores')).toBeVisible();
    await scrollThrough(page);
    await page.waitForFunction((parts) => parts.every((p) => document.querySelector(`.${p}`).classList.contains('in')), below);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    for (const p of (await revealState(page)).filter((x) => below.includes(x.part))) {
      expect(p.in, `${p.part}: once`).toBe(true);
      expect(p.opacity).toBe('1');
      expect(IN_PLACE, `${p.part} in place`).toContain(p.transform);
    }
  });
});

/* ---------- Reduce Motion and the script off ---------- */

/* ---------- a rise plays once, even when a window crosses 900 wide ---------- */

// The computer's stores tile shows only from 900 wide, and the phone's stores tile only below, so a window
// crossing 900 (a resize, an iPad's turn) shows one of them anew: its rise has played, so it rests.
const settled = (page, sel) => page.waitForFunction((q) => document.querySelector(q).getAnimations().every((a) => a.playState === 'finished'), sel);
const still = (page, sel) => page.locator(sel).evaluate((el) => ({ running: el.getAnimations().filter((a) => a.playState !== 'finished').length, opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform }));

test.describe('a computer crossing 900 wide', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, userAgent: MAC_UA });

  test('the stores tile on the first screen rises once at load, not again after a trip to 880 wide', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(TAGGED_QS);
    await settled(page, '.first-stores');
    await frames(page, 2);
    for (const width of [880, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await frames(page, 2);
    }
    expect(await still(page, '.first-stores')).toEqual({ running: 0, opacity: '1', transform: 'none' });
  });
});

test('an upright iPad turned on its side shows the computer\'s stores tile at rest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(TAGGED_QS);
  await settled(page, '.first-tile');
  await frames(page, 2);
  await page.setViewportSize({ width: 1180, height: 820 });
  await frames(page, 2);
  expect(await still(page, '.first-stores')).toEqual({ running: 0, opacity: '1', transform: 'none' });
});

test('the phone\'s stores tile rises once as it comes into view, not again after a trip to 1000 wide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load(page, { width: 393, height: 852 });
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.stores').getBoundingClientRect().top + window.scrollY - 300));
  await expect(page.locator('.stores')).toHaveClass(/\bin\b/);
  await settled(page, '.stores');
  await frames(page, 2);
  for (const width of [1000, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await frames(page, 2);
  }
  expect(await still(page, '.stores')).toEqual({ running: 0, opacity: '1', transform: 'none' });
});

/* ---------- after a turn, the rise counts the bar as it is then ---------- */

// A part rises once 12% of it shows above the bar where the bar is pinned, and above the window's bottom
// where it sits in the page or isn't shown (a computer). A turn can change which: Prices and Recipes, still
// waiting, is placed with 5% and then 30% of it over that edge.
async function overEdge(page, fraction) {
  await page.evaluate((f) => {
    const el = document.querySelector('.facts');
    const cta = document.querySelector('.cta');
    const pinned = cta.getClientRects().length > 0 && getComputedStyle(cta).position === 'fixed';
    const edge = pinned ? cta.getBoundingClientRect().top : window.innerHeight;
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - (edge - f * r.height));
  }, fraction);
  await frames(page, 3);
  return page.locator('.facts').evaluate((el) => el.classList.contains('in'));
}

const TURNS = [
  { from: { width: 393, height: 852 }, to: { width: 852, height: 393 }, note: 'a phone turned on its side: the bar now in the page' },
  { from: { width: 852, height: 393 }, to: { width: 393, height: 852 }, note: 'a phone turned upright: the bar now pinned' },
  { from: { width: 820, height: 1180 }, to: { width: 1180, height: 820 }, note: 'an iPad turned on its side: no bar' },
  { from: { width: 1180, height: 820 }, to: { width: 820, height: 1180 }, note: 'an iPad turned upright: the bar now pinned' }
];

for (const turn of TURNS) {
  test(`after a turn from ${turn.from.width}x${turn.from.height} to ${turn.to.width}x${turn.to.height} (${turn.note}), a part rises once 12% of it shows over the bar or the window's bottom`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await load(page, turn.from);
    await expect(page.locator('.facts')).toHaveClass(/\bwait\b/);
    await page.setViewportSize(turn.to);
    await frames(page, 3);
    expect(await overEdge(page, 0.05), 'with 5% of it shown, it still waits').toBe(false);
    expect(await overEdge(page, 0.3), 'with 30% shown, it has risen').toBe(true);
  });
}

test('Reduce Motion: nothing moves; the last answer and the total show, the passing ones are hidden; nothing waits below; the story changes at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(TAGGED_QS);
  await eagerImages(page);
  const state = await page.evaluate((sels) => sels.map((sel) => {
    const el = document.querySelector(sel);
    const cs = getComputedStyle(el);
    return { animations: el.getAnimations().length, opacity: cs.opacity, visibility: cs.visibility };
  }), [...LINES, ...STILLS]);
  for (const i of [2, 5]) expect(state[i], 'the last answer and the total, still').toEqual({ animations: 0, opacity: '1', visibility: 'visible' });
  for (const i of [0, 1, 3, 4]) {
    expect(state[i].animations).toBe(0);
    expect(state[i].visibility).toBe('hidden');
  }
  await expect(page.locator('.answer-line.answer-3')).toHaveText('Know what dinner costs before you shop.');
  expect(await page.evaluate(() => document.getAnimations().length), 'no animation anywhere').toBe(0);
  expect(await page.evaluate(() => [getComputedStyle(document.querySelector('.story-line')).transitionDuration, getComputedStyle(document.querySelector('.story .shot')).transitionDuration])).toEqual(['0s', '0s']);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reveal].wait, [data-reveal].in').length), 'nothing waits').toBe(0);
  await focusLine(page, 2);
  expect(await page.locator('.story-line').nth(2).evaluate((el) => getComputedStyle(el).opacity), 'the line in focus is ink at once').toBe('1');
  expect(await page.locator('.story .shot').nth(2).evaluate((el) => getComputedStyle(el).opacity), 'its screen at once').toBe('1');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await frames(page, 3);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reveal].wait, [data-reveal].in').length), 'no rise on scroll').toBe(0);
});

test.describe('the script off', () => {
  test.use({ javaScriptEnabled: false });

  test('everything shows: the six parts, every story line in ink, the nights\' screen, the price\'s screen and the last answer', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(TAGGED_QS);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const parts = await revealState(page);
    expect(parts.map((p) => p.part)).toEqual(REVEALS);
    for (const p of parts) {
      expect(p.wait || p.in, `${p.part}: no waiting state`).toBe(false);
      expect(p.opacity, `${p.part} opacity`).toBe('1');
      expect(p.transform, `${p.part} in place`).toBe('none');
    }
    for (const sel of ['.lede', '.story-tile', '.tile-yours', '.stores', '.facts', '.footer']) await expect(page.locator(sel)).toBeVisible();
    const story = await page.evaluate(() => ({
      focus: document.querySelector('.story').classList.contains('focus'),
      lines: [...document.querySelectorAll('.story-line')].map((el) => getComputedStyle(el).opacity),
      shots: [...document.querySelectorAll('.story .shot')].map((el) => getComputedStyle(el).opacity),
      yours: getComputedStyle(document.querySelector('.tile-yours .shot')).opacity
    }));
    expect(story).toEqual({ focus: false, lines: ['1', '1', '1', '1'], shots: ['1', '0', '0', '0'], yours: '1' });
    expect(await page.locator('.answer-line.answer-3').evaluate((n) => getComputedStyle(n).opacity)).toBe('1');
    expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(false);
  });

  test('the load rise and the answer line still play, from CSS alone, and end at rest', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(TAGGED_QS);
    const [words, tile, ...answers] = await timingOf(page, ['.first-words', '.first-tile', ...LINES, ...STILLS]);
    expect(words.map((a) => a.name)).toEqual(['first-in']);
    expect(tile.map((a) => a.name)).toEqual(['first-rise']);
    expect(answers.map((as) => as.map((a) => `${a.name} ${a.duration} ${a.delay}`))).toEqual([1, 2, 3, 1, 2, 3].map((n) => [`answer-${n} 5800 300`]));
    await atRest(page, { script: false });
    const end = await page.evaluate((sels) => sels.map((sel) => {
      const cs = getComputedStyle(document.querySelector(sel));
      return [cs.opacity, cs.transform];
    }), ['.first-words', '.first-tile', ...LINES, ...STILLS]);
    expect(end.map(([opacity]) => opacity), 'the words, the tile, then the last answer and the total').toEqual(['1', '1', '0', '0', '1', '0', '0', '1']);
    for (const [, transform] of end) expect(IN_PLACE).toContain(transform);
  });
});

/* ---------- the pictures' weight ---------- */

test('on a phone the first screen\'s pictures (the icon, the bezel, the three screens) weigh under 300 KB; the story\'s and the price\'s stills are lazy', async ({ page }) => {
  const bodies = new Map();
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/media/')) return;
    bodies.set(url.pathname, res.body().then((b) => b.length, () => null));
  });
  await page.goto(TAGGED_QS);
  await page.waitForLoadState('load');
  await eagerImages(page);
  const first = await page.evaluate(() => [...document.querySelectorAll('.top .logo-icon, .first-tile .shot, .first-tile .bezel')].map((i) => new URL(i.currentSrc).pathname));
  expect(first).toHaveLength(5);
  let total = 0;
  for (const path of new Set(first)) {
    expect(bodies.has(path), `${path} was fetched`).toBe(true);
    const bytes = await bodies.get(path);
    expect(bytes, `${path} has a body`).toBeGreaterThan(0);
    total += bytes;
  }
  expect(total, JSON.stringify(first)).toBeLessThan(300 * 1024);
  const loading = await page.evaluate(() => ({
    first: [...document.querySelectorAll('.top img, .first-tile img')].map((i) => i.getAttribute('loading')),
    below: [...document.querySelectorAll('.story img, .tile-yours img')].map((i) => i.getAttribute('loading'))
  }));
  expect(loading.first, 'the first screen\'s pictures load at once').toEqual([null, null, null, null, null]);
  expect(loading.below, 'the story\'s and the price\'s stills and bezels load lazily').toEqual(Array(7).fill('lazy'));
  // nothing render-blocking beyond the one stylesheet: the one script is deferred
  const blocking = await page.evaluate(() => [...document.querySelectorAll('head script:not([defer]):not([async]), link[rel="stylesheet"]')].map((n) => n.getAttribute('src') || n.getAttribute('href')));
  expect(blocking).toEqual(['/styles.css']);
});

/* ---------- the bar while the page scrolls, and the sheet ---------- */

test('the bar stays pinned while the page scrolls; at the page\'s end the footer\'s giant row ends 28 px above it, and its Reserve opens the plans', async ({ page }) => {
  await load(page, { width: 375, height: 667 });
  const before = await bbox(page.locator('.cta'));
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => window.scrollY > 300);
  expect(await bbox(page.locator('.cta'))).toEqual(before);
  expect(before.bottom).toBeCloseTo(667, 0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.footer')).toHaveClass(/\bin\b/);
  await atRest(page);   // the footer's rise
  const end = await bbox(page.locator('.cta'));
  expect(end).toEqual(before);
  const giant = await bbox(page.locator('.giant'));
  const copy = await bbox(page.locator('.foot-copy'));
  expect(copy.bottom, '© 2026 Parakeet. ends above the bar').toBeLessThanOrEqual(end.top);
  expect(end.top - giant.bottom, 'the sky shows 28 px under the giant row').toBeCloseTo(28, 0);
  await page.locator('.cta [data-tap="reserve"]').click();
  await expect(page.locator('#step-1')).toBeVisible();
});

test('keyboard proxy: with the sheet open at 375x380, --vvh follows innerHeight and the panel and its button stay in view', async ({ page }) => {
  await page.goto(TAGGED_QS);
  await page.locator('.cta [data-tap="reserve"]').click();
  await sheetSettled(page);
  await expect(page.locator('#step-1')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 380 });
  await frames(page, 3);
  const vvh = await page.evaluate(() => ({
    value: getComputedStyle(document.documentElement).getPropertyValue('--vvh').trim(),
    inner: window.innerHeight
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

// A pinch zoom shrinks the visual viewport. The phone's bottom sheet sits on what it leaves (its bottom
// offset), but the computer's dialog stays in the middle of the window, its title and plans in reach.
test.describe('a computer zoomed in by a pinch', () => {
  test.use({ viewport: { width: 1180, height: 820 }, isMobile: false, hasTouch: false, userAgent: MAC_UA });

  test('the dialog stays in the middle of the window, with no bottom offset', async ({ page }) => {
    await page.goto(TAGGED_QS);
    await atRest(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.waitForFunction(() => window.visualViewport.height < window.innerHeight);
    await page.evaluate(() => document.querySelector('.top-btn[data-tap="reserve"]').click());
    await sheetSettled(page);
    await atRest(page);
    const got = await page.evaluate(() => {
      const panel = document.getElementById('sheet-panel');
      const r = panel.getBoundingClientRect();
      return { bottom: panel.style.bottom, top: r.top, end: r.bottom, title: document.getElementById('sheet-title-1').getBoundingClientRect().top, inner: window.innerHeight };
    });
    expect(got.bottom, 'no bottom offset on the dialog').toBe('');
    expect(got.title, 'its title inside the window').toBeGreaterThanOrEqual(0);
    expect(got.top + got.end, 'in the middle').toBeCloseTo(got.inner, 0);
  });
});

test('the sheet closes without Reduce Motion (after its slide down) and the page is left as it was', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(TAGGED_QS);
  await page.locator('.cta [data-tap="reserve"]').click();
  await sheetSettled(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(true);
  await page.locator('.sheet-x').click();
  await expect(page.locator('#sheet')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(false);
  expect(await page.evaluate(() => document.body.style.top)).toBe('');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the sheet closes with Reduce Motion (no transition to wait for) and reopens on its plans', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(TAGGED_QS);
  await page.locator('.cta [data-tap="reserve"]').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden({ timeout: 1000 });
  expect(await page.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(false);
  await page.locator('.cta [data-tap="reserve"]').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('#step-1')).toBeVisible();
});
