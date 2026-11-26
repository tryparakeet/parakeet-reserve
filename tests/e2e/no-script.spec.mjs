// The page with the script off (SITE-04 §6.3 and §6.6), on a phone at 393 x 852 and a computer at
// 1440 x 900: everything shows. The script only ever adds the waiting state, so with it off no part below
// the first screen waits. Once the load rise and the answer line (plain CSS, which still play) have ended by
// themselves, every tile, every line of words, each phone's still and bezel, and the footer are drawn at
// full opacity, visible and in place: no transform on them or on anything around them, inside the window's
// width, and the parts in their order down the page. Each phone shows one still: the total on the first
// screen, the nights on the story's phone (its focus needs the script) and the price typed in.

import { test, expect, TAGGED_QS } from './fixtures.mjs';
import { COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const BOTH = [
  '.top .logo-icon', '.top .logo-word', 'h1', '.answer-line.answer-3',
  '.first-tile', '.first-tile .shot.answer-3', '.first-tile .bezel',
  '.lede', '.lede h2', '.lede p',
  '.story-tile', '.story .shot.on', '.story-tile .bezel', '.story-line',
  '.tile-yours', '.yours-line', '.tile-yours .shot', '.tile-yours .bezel',
  '.facts', '.fact', '.fact .label', '.fact p',
  '.footer', '.footer > p', '.foot-links a', '.giant', '.giant-bird', '.giant-word'
];

const LAYOUTS = [
  {
    name: 'a phone at 393x852',
    use: { viewport: { width: 393, height: 852 } },
    parts: [...BOTH, '.cta', '.cta .btn.for-reserve', '.cta-note', '.stores', '.stores .label', '.stores .chip'],
    hidden: ['.top-btn', '.first-btn', '.first-note', '.first-stores', '.for-android'],
    order: ['.first-tile', '.lede', '.story', '.tile-yours', '.stores', '.facts', '.footer']
  },
  {
    name: 'a computer at 1440x900',
    use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, userAgent: COMPUTER_UAS.safari_mac },
    parts: [...BOTH, '.top-btn.for-reserve', '.first-words', '.first-btn.for-reserve', '.first-note', '.first-stores', '.first-stores .label', '.first-stores .chip'],
    hidden: ['.cta', '.stores', '.for-android'],
    order: ['.first', '.lede', '.story', '.tile-yours', '.facts', '.footer']
  }
];

// Each matching element: how it is drawn, counting everything around it (opacity multiplies down the tree,
// and a transform anywhere above moves it).
function drawn(page, selectors) {
  return page.evaluate((sels) => sels.flatMap((sel) => {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) return [{ sel, missing: true }];
    return els.map((el, i) => {
      let opacity = 1;
      const moved = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        opacity *= Number(cs.opacity);
        if (cs.transform !== 'none' && cs.transform !== 'matrix(1, 0, 0, 1, 0, 0)') moved.push(`${n.tagName.toLowerCase()}.${n.classList[0] || ''} ${cs.transform}`);
      }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        sel: els.length > 1 ? `${sel} #${i + 1}` : sel,
        shown: el.getClientRects().length > 0 && r.width > 0 && r.height > 0,
        visibility: cs.visibility,
        opacity: Math.round(opacity * 1000) / 1000,
        moved,
        inside: r.left >= -0.5 && r.right <= innerWidth + 0.5,
        image: el.tagName === 'IMG' ? el.complete && el.naturalWidth > 0 : null
      };
    });
  }), selectors);
}

for (const layout of LAYOUTS) {
  test.describe(`the script off, ${layout.name}`, () => {
    test.use({ ...layout.use, javaScriptEnabled: false });

    test('everything shows: every tile, line, still and the footer at full opacity and in place; nothing waits', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(TAGGED_QS);
      await expect(page.locator('h1')).toHaveText('What’s for dinner this week?');

      // the load rise and the answer line play from CSS and end by themselves (by 6.1 s); with the script off
      // the page's own timers don't run, so the waiting is done from here
      const until = Date.now() + 9000;
      for (;;) {
        const left = await page.evaluate(() => document.getAnimations().filter((a) => a.playState !== 'finished').map((a) => a.animationName));
        if (!left.length) break;
        expect(Date.now(), `still running: ${left.join(', ')}`).toBeLessThan(until);
        await page.waitForTimeout(250);
      }

      // the script never ran: no device class, no story focus, no waiting state anywhere
      const state = await page.evaluate(() => ({
        html: document.documentElement.className,
        focus: document.querySelector('.story').classList.contains('focus'),
        waiting: document.querySelectorAll('.wait, .in, .band, [data-reveal].wait, [data-reveal].in').length,
        reveals: [...document.querySelectorAll('[data-reveal]')].map((el) => el.classList[0])
      }));
      expect(state).toEqual({ html: '', focus: false, waiting: 0, reveals: ['lede', 'story-tile', 'tile-yours', 'stores', 'facts', 'footer'] });

      // every part, at the top and after scrolling to the end
      for (const at of ['top', 'end']) {
        if (at === 'end') await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        for (const part of await drawn(page, layout.parts)) {
          expect(part.missing, `${part.sel} is on the page`).toBeUndefined();
          expect(part.shown, `${part.sel} has a box (${at})`).toBe(true);
          expect(part.visibility, `${part.sel} is visible (${at})`).toBe('visible');
          expect(part.opacity, `${part.sel} at full opacity (${at})`).toBe(1);
          expect(part.moved, `${part.sel} in place: nothing around it moved (${at})`).toEqual([]);
          expect(part.inside, `${part.sel} inside the window's width (${at})`).toBe(true);
          if (part.image !== null) expect(part.image, `${part.sel} loaded`).toBe(true);
        }
      }
      for (const sel of layout.hidden) {
        const shown = await page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.getClientRects().length > 0).length, sel);
        expect(shown, `${sel}: not in this layout`).toBe(0);
      }

      // each phone shows its one still: the total, the nights, the price typed in
      const stills = await page.evaluate(() => [...document.querySelectorAll('.shot')].map((s) => `${s.closest('.first-tile, .story, .tile-yours').className.split(' ')[0]} ${/screen-([a-z]+)-/.exec(s.currentSrc || s.src)[1]} ${getComputedStyle(s).opacity}`));
      expect(stills.filter((s) => s.endsWith(' 1'))).toEqual(['first-tile total 1', 'story nights 1', 'tile-yours yours 1']);

      // the parts in their order down the page, none over another
      const boxes = await page.evaluate((sels) => sels.map((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { sel, top: r.top + scrollY, bottom: r.bottom + scrollY };
      }), layout.order);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].top, `${boxes[i].sel} starts under ${boxes[i - 1].sel}`).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 0.5);
      }
    });
  });
}

/* ---------- a phone under 360 wide, the script off: the bar's own height ---------- */

// Under 360 wide the line under the button takes a third line (at 320 it does in any likely face), and with
// the script off nothing measures the bar, so its fallback height has to count that line: otherwise the
// pinned bar covers the bottom of the phone's tile. Where the line keeps two, the gap is only wider.
for (const width of [320, 340, 356]) {
  test.describe(`the script off, a phone at ${width}x640`, () => {
    test.use({ viewport: { width, height: 640 }, javaScriptEnabled: false });

    test('the bar is pinned and the phone\'s tile ends 12 px or more above it', async ({ page }) => {
      await page.goto(TAGGED_QS);
      await expect(page.locator('h1')).toHaveText('What’s for dinner this week?');
      await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
      const got = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        return { tile: r('.first-tile').bottom, phone: r('.first-tile .phone').height, bar: r('.cta').top, barBottom: r('.cta').bottom, lines: Math.round(r('.cta-note').height / 18), position: getComputedStyle(document.querySelector('.cta')).position };
      });
      expect(got.position, 'the bar is pinned').toBe('fixed');
      expect(got.barBottom).toBeCloseTo(640, 0);
      expect(got.bar - got.tile, `the tile ends 12 or more above the bar (its line in ${got.lines} lines)`).toBeGreaterThanOrEqual(11.5);
      if (got.lines === 3) expect(got.bar - got.tile, 'with three lines, exactly the 12').toBeCloseTo(12, 0);
      expect(got.phone, 'the bezel at least 200 px').toBeGreaterThanOrEqual(199.99);
    });
  });
}
