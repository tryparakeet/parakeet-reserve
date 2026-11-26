// The brief's shots (SITE-04 §6.6 and SITE-03 §4), made as the acceptance shots always were: written to
// test-results/screenshots/ on every run (Playwright empties test-results/ when a run starts, so the set is
// always the current page), each the size of the window (not the whole page), after the motion has come to
// rest (every animation finished, then a wait).
//
// - At 393 x 852, 375 x 667 (an iPhone: DPR 2, touch, Safari's user agent, as the config has it), 1440 x 900
//   and 1024 x 768 (a computer: no touch, DPR 1, a Mac's Safari): the first screen; the headline under it;
//   the story with each of its four lines in focus (the line scrolled just past the focus line: halfway
//   between the held tile and the bar on a phone, the middle on a computer; each line shows whole); the
//   price; the stores; Prices and Recipes; the footer; and the sheet's three steps (the plans, the email with
//   an address typed, done for the yearly plan), the dialog in the middle on a computer.
// - An Android phone in Chrome at 412 x 915 and 360 x 800: the page at rest (the band has crossed), the
//   email step with an address typed, and the done line.
// - Privacy's top at 393 x 852 and 1440 x 900.
// - §6.4's windows, 375 x 550, 1440 x 780 and 1024 x 660: the first screen, and the story with its tile held
//   (on the phone a whole line between the tile and the pinned bar, on a computer the tile under the header).
//   An iPhone on its side, 852 x 393, adds the window too short for the words, a 200 px phone and the bar:
//   the first screen, and the bar where it sits in the page under it.
//
// Below the first screen the page is first scrolled through once, so every part has risen into place, as a
// visitor who has scrolled sees it. Only the pictures the shot needs are waited for: every image that isn't
// lazy, and the lazy stills in view. The container has no SF Pro, so the words render in a stand-in font.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, TAGGED_QS, RESULTS_DIR, sheetSettled, frames, focusLineAt, focusPartsAt } from './fixtures.mjs';
import { REAL_UAS, COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const DIR = join(RESULTS_DIR, 'screenshots');
const MAC = { isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: COMPUTER_UAS.safari_mac };
const ADDRESS = 'you@example.com';

function shooter(page, prefix) {
  mkdirSync(DIR, { recursive: true });
  return (name) => page.screenshot({ path: join(DIR, `${prefix}-${name}.png`), fullPage: false });
}

// Every animation and transition finished at its end state, then a wait.
async function settleMotion(page) {
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  await page.waitForTimeout(100);
}

// Every image that isn't lazy has loaded, and so has every lazy one with a box in the window.
function imagesReady(page) {
  return page.waitForFunction(() => [...document.images].every((img) => {
    if (img.loading === 'lazy') {
      if (!img.getClientRects().length) return true;
      const r = img.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return true;
    }
    return img.complete && img.naturalWidth > 0;
  }));
}

async function scrollTo(page, y) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await frames(page, 3);
}

// The page loaded with its tags, its pictures in, the first screen's motion at rest.
async function load(page, path = TAGGED_QS) {
  await page.goto(path);
  await expect(page.locator('h1')).toBeVisible();
  await imagesReady(page);
  await settleMotion(page);
}

// Scrolled through once, a third of the window at a time, so every part below the first screen has risen;
// then back to the top.
async function scrollThrough(page) {
  const { end, step } = await page.evaluate(() => ({ end: document.documentElement.scrollHeight - innerHeight, step: Math.round(innerHeight / 3) }));
  for (let y = 0; y < end + step; y += step) await scrollTo(page, Math.min(y, end));
  await page.waitForFunction(() => !document.querySelector('.wait'));
  await settleMotion(page);
  await scrollTo(page, 0);
}

// Where a part sits in the shot: in the middle of the room the window leaves it (under a computer's held
// header, above a phone's pinned bar), or 12 px under the room's top where it is taller than the room.
function partScroll(page, selector) {
  return page.evaluate((sel) => {
    const part = [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length > 0);
    const top = document.querySelector('.top');
    const bar = document.querySelector('.cta');
    const roomTop = getComputedStyle(top).position === 'sticky' ? top.getBoundingClientRect().height : 0;
    const roomBottom = innerHeight - (getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().height : 0);
    const r = part.getBoundingClientRect();
    const docTop = r.top + window.scrollY;
    const room = roomBottom - roomTop;
    return r.height <= room - 24 ? docTop - roomTop - (room - r.height) / 2 : docTop - roomTop - 12;
  }, selector);
}

// The story with line n in focus: the line's top 12 px past the focus line (focusPartsAt: halfway between the
// held tile and the bar on a phone, the middle on a computer); the line is ink and the phone shows its screen.
// On a phone the line also shows whole (SITE-04 §6.4): where a line of two rows would run under the bar, its
// top goes higher, to end 12 px above the bar, though never nearer the held tile than 4 px. Once there, the
// line's box and its words lie between the held tile and the bar (on a computer, under the header and in the
// window), and its top is past the focus line, or the shot fails.
async function storyLine(page, n) {
  const parts = await focusPartsAt(page);
  const y = await page.evaluate(([i, p]) => {
    const r = document.querySelectorAll('.story-line')[i].getBoundingClientRect();
    const top = p.computer ? p.at - 12 : Math.max(Math.min(p.at - 12, p.barTop - r.height - 12), p.tileBottom + 4);
    return r.top + window.scrollY - top;
  }, [n, parts]);
  await scrollTo(page, y);
  await page.waitForFunction((i) => {
    const on = (list) => [...list].findIndex((el) => el.classList.contains('on'));
    return on(document.querySelectorAll('.story-line')) === i && on(document.querySelectorAll('.story .shot')) === i;
  }, n);
  await imagesReady(page);
  await settleMotion(page);
  const box = await page.evaluate((i) => {
    const line = document.querySelectorAll('.story-line')[i];
    const words = document.createRange();
    words.selectNodeContents(line);
    const rects = [line.getBoundingClientRect(), ...words.getClientRects()];
    const header = document.querySelector('.top');
    const bar = document.querySelector('.cta');
    const barStyle = getComputedStyle(bar);
    const computer = matchMedia('(min-width: 900px)').matches;
    return {
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      lineTop: rects[0].top,
      above: computer ? 'the header' : 'the held tile',
      roomTop: computer
        ? (getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom : 0)
        : document.querySelector('.story-tile').getBoundingClientRect().bottom,
      below: !computer && barStyle.position === 'fixed' ? 'the bar' : 'the window\'s bottom',
      roomBottom: !computer && barStyle.display !== 'none' && barStyle.position === 'fixed' ? bar.getBoundingClientRect().top : innerHeight
    };
  }, n);
  expect(box.top, `story line ${n + 1} starts below ${box.above}`).toBeGreaterThanOrEqual(box.roomTop);
  expect(box.bottom, `story line ${n + 1} ends above ${box.below}`).toBeLessThanOrEqual(box.roomBottom);
  expect(box.lineTop, `story line ${n + 1} is past the focus line`).toBeLessThan(await focusLineAt(page));
}

async function part(page, selector) {
  await scrollTo(page, await partScroll(page, selector));
  await imagesReady(page);
  await settleMotion(page);
}

// The sheet's three steps from `button`: the plans as it opens (the yearly plan picked), the email step
// with an address typed, and the yearly plan's done line.
async function sheetSteps(page, shot, button, first) {
  await scrollTo(page, 0);
  await settleMotion(page);
  await page.locator(button).click();
  await sheetSettled(page);
  await expect(page.locator('#step-1')).toBeVisible();
  await expect(page.locator('[data-tap="plan_yearly"]')).toHaveAttribute('aria-checked', 'true');
  await settleMotion(page);
  await shot(`${first}-plans`);

  await page.locator('#hold').click();
  await expect(page.locator('#step-2')).toBeVisible();
  await expect(page.locator('#step-1')).toBeHidden();
  await expect(page.locator('#email')).toBeFocused();
  await page.locator('#email').fill(ADDRESS);
  await settleMotion(page);
  await shot(`${first + 1}-email`);

  await page.locator('#email-form button[type="submit"]').click();
  await expect(page.locator('#step-3')).toBeVisible();
  await expect(page.locator('.done.if-yearly')).toBeVisible();
  await expect(page.locator('.done.if-yearly .done-email')).toHaveText(ADDRESS);
  await settleMotion(page);
  await shot(`${first + 2}-done`);
}

/* ---------- the home at 393x852, 375x667, 1440x900 and 1024x768 ---------- */

const SIZES = [
  { width: 393, height: 852, use: {} },
  { width: 375, height: 667, use: {} },
  { width: 1440, height: 900, use: MAC, computer: true },
  { width: 1024, height: 768, use: MAC, computer: true }
];

for (const size of SIZES) {
  test.describe(`shots at ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, ...size.use });

    test('the first screen, the headline, the story\'s four lines, the price, the stores, Prices and Recipes, the footer, the sheet\'s three steps', async ({ page }) => {
      test.setTimeout(60_000);
      const shot = shooter(page, `${size.width}x${size.height}`);
      await load(page);
      expect(await page.evaluate(() => matchMedia('(min-width: 900px)').matches), 'the layout').toBe(!!size.computer);
      await shot('01-first-screen');

      await scrollThrough(page);
      await part(page, '.lede');
      await shot('02-headline');
      for (let n = 0; n < 4; n++) {
        await storyLine(page, n);
        await shot(`0${3 + n}-story-${n + 1}`);
      }
      await part(page, '.tile-yours');
      await shot('07-price');
      // on a phone the stores are their own tile under the price; on a computer, the first screen's tile
      await part(page, size.computer ? '.first-stores' : '.stores');
      await shot('08-stores');
      await part(page, '.facts');
      await shot('09-prices-recipes');
      await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
      await imagesReady(page);
      await settleMotion(page);
      await shot('10-footer');

      await sheetSteps(page, shot, size.computer ? '.first-words [data-tap="reserve"]' : '.cta [data-tap="reserve"]', 11);
    });
  });
}

/* ---------- an Android phone in Chrome at 412x915 and 360x800 (SITE-03 §4) ---------- */

for (const win of [{ width: 412, height: 915 }, { width: 360, height: 800 }]) {
  test.describe(`Android shots at ${win.width}x${win.height}`, () => {
    test.use({ viewport: win, userAgent: REAL_UAS.chrome_android });

    test('the page at rest, the email step, the done line', async ({ page }) => {
      const shot = shooter(page, `android-${win.width}x${win.height}`);
      await load(page);
      expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(true);
      await expect(page.locator('.cta [data-tap="android"]')).toBeVisible();
      await shot('1-page');

      await page.locator('.cta [data-tap="android"]').click();
      await sheetSettled(page);
      await expect(page.locator('#step-2')).toBeVisible();
      await expect(page.locator('#step-1')).toBeHidden();
      await expect(page.locator('#email')).toBeFocused();
      await page.locator('#email').fill(ADDRESS);
      await settleMotion(page);
      await shot('2-email');

      await page.locator('#email-form button[type="submit"]').click();
      await expect(page.locator('#step-3')).toBeVisible();
      await expect(page.locator('.done.if-android')).toBeVisible();
      await expect(page.locator('.done.if-android .done-email')).toHaveText(ADDRESS);
      await settleMotion(page);
      await shot('3-done');
    });
  });
}

/* ---------- Privacy's top at 393x852 and 1440x900 ---------- */

for (const size of [{ width: 393, height: 852, use: {} }, { width: 1440, height: 900, use: MAC }]) {
  test.describe(`Privacy at ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, ...size.use });

    test('its top', async ({ page }) => {
      await load(page, '/privacy');
      await expect(page.locator('h1')).toHaveText('Privacy');
      await page.screenshot({ path: join(DIR, `privacy-${size.width}.png`), fullPage: false });
    });
  });
}

/* ---------- §6.4's windows, and one too short for the pinned bar ---------- */

const WINDOWS = [
  { width: 375, height: 550, use: {}, bar: 'fixed' },
  { width: 1440, height: 780, use: MAC, bar: 'none' },
  { width: 1024, height: 660, use: MAC, bar: 'none' },
  { width: 852, height: 393, use: {}, bar: 'relative' }
];

for (const win of WINDOWS) {
  test.describe(`the window ${win.width}x${win.height}`, () => {
    test.use({ viewport: { width: win.width, height: win.height }, ...win.use });

    test(win.bar === 'relative' ? 'the first screen, and the bar in the page under it' : 'the first screen, and the story with its tile held', async ({ page }) => {
      const shot = shooter(page, `window-${win.width}x${win.height}`);
      await load(page);
      const bar = await page.locator('.cta').evaluate((el) => (getComputedStyle(el).display === 'none' ? 'none' : getComputedStyle(el).position));
      expect(bar, 'where the bar is').toBe(win.bar);
      await shot('1-first-screen');

      await scrollThrough(page);
      if (win.bar === 'relative') {
        await part(page, '.cta');
        await shot('2-bar-in-page');
      } else {
        await storyLine(page, 1);
        const held = await page.evaluate(() => {
          const top = document.querySelector('.top');
          return document.querySelector('.story-tile').getBoundingClientRect().top - (getComputedStyle(top).position === 'sticky' ? top.getBoundingClientRect().bottom : 0);
        });
        expect(held, 'the story\'s tile is held at the top').toBeLessThan(40);
        await shot('2-story');
      }
    });
  });
}
