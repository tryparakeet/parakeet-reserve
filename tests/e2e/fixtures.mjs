// Shared fixtures for the e2e specs: a harness per test with a frozen clock, baseURL pointed at it, a
// passive same-origin guard on every request the browser makes, a CSP console-error guard, admin helpers,
// waitForRows over the memory store, and hide()/show() which
// dispatch pagehide / visibilitychange from inside the page (the beacons then land in the store).
//
//   test.use({ harnessOptions: { now: '2026-10-21T12:00:00.000Z', adminKey: null } })   per describe/file
//
// Beacons are asserted from the store, never from network events; a leave row is waited for before any
// absence is asserted. A spec that asserts a beacon sent by a REAL navigation or page close (leave.spec)
// must have no page.route in place: Playwright's request interception drops a pending beacon when the
// frame navigates, and the row then arrives or not by chance. hide()/show() below stay inside the page.

import { test as base, expect } from 'playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { startHarness } from '../helpers/harness.mjs';
import { ADMIN_KEY, T0, MINUTE, HOUR, DAY } from '../helpers/http.mjs';

export { expect, ADMIN_KEY, T0, MINUTE, HOUR, DAY };

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RESULTS_DIR = join(ROOT, 'test-results');

// The frozen clock every test starts with unless it says otherwise: Oct 25, mid-test, after GATE_START.
export const CLOCK_START = '2026-10-25T12:00:00.000Z';
export const GATE_START_ISO = '2026-10-24T05:00:00.000Z';

export const TAGGED = { utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'gate0', utm_content: 'sat24' };
export const TAGGED_QS = '/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=sat24';
export const SMOKE_QS = '/?utm_source=own&utm_campaign=smoke';
export const TYPED_LOCATION = '/?utm_source=typed&utm_medium=organic&utm_campaign=gate0&utm_content=endcard';

// Rows of the events store matching `match`: an object of field equalities, or a predicate.
export function rowsOf(blobs, match = {}) {
  const fn = typeof match === 'function' ? match : (row) => Object.entries(match).every(([k, v]) => row[k] === v);
  return blobs.rows('events').filter(fn);
}

// Polls the store until at least `count` rows match (default 1); returns them (received order).
export async function waitForRows(blobs, match = {}, { count = 1, timeout = 5000, interval = 40 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const rows = rowsOf(blobs, match).sort((a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : 0));
    if (rows.length >= count) return rows;
    if (Date.now() > until) {
      const all = blobs.rows('events').map((r) => `${r.event}${r.button ? ':' + r.button : ''}${r.video ? ' video=' + r.video : ''}`);
      throw new Error(`waitForRows: wanted ${count} row(s) matching ${typeof match === 'function' ? 'predicate' : JSON.stringify(match)}, have ${rows.length}; store: [${all.join(', ')}]`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

// Waits `ms` of real time and returns the matching rows: for "no new row" assertions after a wait.
export async function settle(blobs, match = {}, ms = 400) {
  await new Promise((r) => setTimeout(r, ms));
  return rowsOf(blobs, match);
}

// The page goes hidden the way the in-app browsers do it: visibilitychange (hidden) first, then pagehide.
export function hide(page) {
  return page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
}

// Back from hidden: pageshow, then visibilitychange (visible); the client resets its per-hide latch.
export function show(page) {
  return page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// Two animation frames inside the page (the client fits the sheet on the next frame).
export function frames(page, n = 2) {
  return page.evaluate((count) => new Promise((done) => {
    const step = (k) => (k <= 0 ? done() : requestAnimationFrame(() => step(k - 1)));
    step(count);
  }), n);
}

// The sheet is open, its slide-in transition has ended (the panel's transform is back to none) and its
// settle window has passed: app.js drops every press inside the sheet during its first 500 ms (the second
// half of a double tap on "Reserve 2 free weeks" would land on "Hold my spot" or a card) and marks the end
// of that window with the class `settled`. An in-sheet click that follows an open must await this first;
// the drop itself is what the double-tap cases in flow.spec assert.
export async function sheetSettled(page) {
  await expect(page.locator('#sheet')).toBeVisible();
  await page.waitForFunction(() => {
    const root = document.getElementById('sheet');
    const panel = document.getElementById('sheet-panel');
    return root && panel && root.classList.contains('open') && root.classList.contains('settled') &&
      getComputedStyle(panel).transform === 'none';
  });
}

// The sheet's focus trap (kept with the instrument): Tab four times, then Shift+Tab three times, from where
// the focus is (the panel as the sheet opens, or one of its controls). Each press lands on the next or the
// previous of `ring`, the open step's controls in order, going round at both ends, and never leaves
// #sheet-panel. A control is named by its id, its data-tap, its aria-label or its words.
export async function expectFocusTrapped(page, ring, what) {
  const at = () => page.evaluate(() => {
    const a = document.activeElement;
    const name = a.id ? `#${a.id}` : a.getAttribute('data-tap') || a.getAttribute('aria-label') || (a === document.body ? '' : (a.innerText || '').trim().slice(0, 40)) || a.tagName.toLowerCase();
    return document.getElementById('sheet-panel').contains(a) ? name : `outside the sheet: ${name}`;
  });
  const start = await at();
  expect([...ring, '#sheet-panel'], `${what}: the focus starts in the sheet`).toContain(start);
  let i = ring.indexOf(start);
  const want = [];
  const got = [];
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    i = key === 'Tab' ? (i + 1) % ring.length : (i <= 0 ? ring.length - 1 : i - 1);
    want.push(ring[i]);
    got.push(await at());
  }
  expect(got, `${what}: Tab and Shift+Tab go round the sheet's controls and never leave it`).toEqual(want);
}

export function bbox(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
  });
}

// The story's focus line (SITE-04 §6.3), in px from the window's top, worked out from the page's boxes by
// the brief's rule, not read from app.js: on a computer (900 wide and up) the window's middle; on a phone
// halfway between the held tile's bottom and the bar's top. The held tile's bottom is where the tile ends
// while its pin is stuck, wherever the page is scrolled: the pin's sticky top, plus the tile's place in the
// pin (its box's, less the translate its rise may give it), plus its height. Where the pin isn't sticky the
// tile isn't held, and the window's top (0) stands for its bottom; where the bar isn't pinned (it sits in
// the page) the window's bottom stands for its top. So with neither, a phone's focus line is the middle too.
// focusPartsAt gives the line (at) with the two edges it lies between on a phone; focusLineAt, the line.
export function focusPartsAt(page) {
  return page.evaluate(() => {
    if (matchMedia('(min-width: 900px)').matches) return { computer: true, at: innerHeight / 2 };
    const pin = document.querySelector('.story-pin');
    const tile = document.querySelector('.story-tile');
    const bar = document.querySelector('.cta');
    const pinStyle = getComputedStyle(pin);
    let tileBottom = 0;
    if (pinStyle.position === 'sticky') {
      const t = tile.getBoundingClientRect();
      const moved = getComputedStyle(tile).transform;
      const lift = moved === 'none' ? 0 : new DOMMatrixReadOnly(moved).m42;
      tileBottom = parseFloat(pinStyle.top) + (t.top - lift - pin.getBoundingClientRect().top) + t.height;
    }
    const barStyle = getComputedStyle(bar);
    const barTop = barStyle.display !== 'none' && barStyle.position === 'fixed' ? bar.getBoundingClientRect().top : innerHeight;
    return { computer: false, tileBottom, barTop, at: (tileBottom + barTop) / 2 };
  });
}

export async function focusLineAt(page) {
  return (await focusPartsAt(page)).at;
}

export async function viewportSize(page) {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

export const test = base.extend({
  // Per-test harness options; a describe block overrides them with test.use({ harnessOptions: {...} }).
  harnessOptions: [{}, { option: true }],

  harness: async ({ harnessOptions }, use) => {
    const h = await startHarness({ adminKey: ADMIN_KEY, now: CLOCK_START, ...harnessOptions });
    await use(h);
    await h.close();
  },

  baseURL: async ({ harness }, use) => {
    await use(harness.url);
  },

  // The same-origin guard (passive: it records, never blocks) and the CSP console guard on every test.
  context: async ({ context, harness }, use) => {
    const foreign = [];
    const cspErrors = [];
    const pageErrors = [];
    const okPrefixes = [harness.url + '/', 'about:', 'data:', 'blob:', 'chrome-error:'];
    context.on('request', (req) => {
      const u = req.url();
      if (!okPrefixes.some((p) => u.startsWith(p))) foreign.push(u);
    });
    const watch = (page) => {
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const t = msg.text();
        if (/Content Security Policy|Refused to (load|connect|execute|apply|send|frame)/i.test(t)) cspErrors.push(t);
      });
      page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
    };
    context.on('page', watch);
    for (const p of context.pages()) watch(p);
    await use(context);
    expect(foreign, 'every request stayed on the harness origin').toEqual([]);
    expect(cspErrors, 'no CSP violation was logged').toEqual([]);
    expect(pageErrors, 'no uncaught exception in the page').toEqual([]);
  }
});
