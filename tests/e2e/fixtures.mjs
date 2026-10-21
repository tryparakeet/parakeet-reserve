// Shared fixtures for the e2e specs: a harness per test with a frozen clock, baseURL pointed at it, a
// passive same-origin guard on every request the browser makes, a CSP console-error guard, admin helpers,
// waitForRows over the memory store, the clip path read from public/index.html, and hide()/show() which
// dispatch pagehide / visibilitychange from inside the page (the beacons then land in the store).
//
//   test.use({ harnessOptions: { now: '2026-10-21T12:00:00.000Z', adminKey: null } })   per describe/file
//
// Beacons are asserted from the store, never from network events; a leave row is waited for before any
// absence is asserted. A spec that asserts a beacon sent by a REAL navigation or page close (leave.spec)
// must have no page.route in place: Playwright's request interception drops a pending beacon when the
// frame navigates, and the row then arrives or not by chance. hide()/show() below stay inside the page.

import { test as base, expect } from 'playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { startHarness } from '../helpers/harness.mjs';
import { ADMIN_KEY, T0, MINUTE, HOUR, DAY } from '../helpers/http.mjs';

export { expect, ADMIN_KEY, T0, MINUTE, HOUR, DAY };

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RESULTS_DIR = join(ROOT, 'test-results');

// The frozen clock every test starts with unless it says otherwise: Oct 25, mid-test, after GATE_START.
export const CLOCK_START = '2026-10-25T12:00:00.000Z';
export const GATE_START_ISO = '2026-10-23T05:00:00.000Z';

export const TAGGED = { utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'gate0', utm_content: 'fri23' };
export const TAGGED_QS = '/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=fri23';
export const SMOKE_QS = '/?utm_source=own&utm_campaign=smoke';
export const TYPED_LOCATION = '/?utm_source=typed&utm_medium=organic&utm_campaign=gate0&utm_content=endcard';

// The clip and poster paths as index.html ships them (Umyt's clip lands as -v2; no test changes).
export function clipPaths() {
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  const video = /<video\b[^>]*>/i.exec(html);
  if (!video) throw new Error('fixtures: no <video> in public/index.html');
  const src = /\ssrc="([^"]+)"/.exec(video[0]);
  const poster = /\sposter="([^"]+)"/.exec(video[0]);
  if (!src) throw new Error('fixtures: the <video> has no src attribute');
  return { clip: src[1], poster: poster ? poster[1] : '' };
}

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
// half of a double tap on "Reserve my free week" would land on "Hold my spot" or a card) and marks the end
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

export function bbox(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
  });
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
