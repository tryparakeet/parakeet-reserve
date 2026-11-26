// A Reduce Motion run (SITE-04 §6.3 and §6.6; DESIGN.md §6) on a phone at 393 x 852 and a computer at
// 1440 x 900: nothing moves. No element or ::before/::after carries an animation or a transition with a
// duration, and no animation or transition ever runs (document.getAnimations() stays empty) at load, while
// the page scrolls, as the story's focus changes, or through the sheet. The end states show: the last
// answer and the total, still; nothing waits below the first screen; the story's lines and screens change
// at once; the sheet and the dialog appear at once, and so do their steps, the plan's ring and tick, the
// done line, and the close.
//
// "At once" is read the moment a class or attribute changes, from a MutationObserver: a transition would
// still show its starting value there, an instant change shows its end.

import { test, expect, TAGGED_QS, sheetSettled, waitForRows } from './fixtures.mjs';
import { COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const LAYOUTS = [
  { name: 'a phone at 393x852', use: { viewport: { width: 393, height: 852 } }, computer: false, reserve: '.cta [data-tap="reserve"]' },
  { name: 'a computer at 1440x900', use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, userAgent: COMPUTER_UAS.safari_mac }, computer: true, reserve: '.top [data-tap="reserve"]' }
];

// Every element (and its drawn ::before and ::after) that would move: an animation, or a transition with a
// duration.
function moving(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of [document.documentElement, ...document.querySelectorAll('*')]) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && cs.content === 'none') continue;
        const timed = cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0);
        if (timed || cs.animationName !== 'none') {
          const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
          out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${cls}${pseudo || ''}: ${cs.animationName} / ${cs.transitionProperty} ${cs.transitionDuration}`);
        }
      }
    }
    return out;
  });
}

const running = (page) => page.evaluate(() => document.getAnimations().map((a) => a.animationName || a.transitionProperty || a.constructor.name));

// Records the page's state the moment any watched class or attribute changes.
function watch(page) {
  return page.evaluate(() => {
    window.__still = [];
    const cs = (el, p) => getComputedStyle(el, p);
    const panel = document.getElementById('sheet-panel');
    const snap = (target, attr) => ({
      target: target.id || (typeof target.className === 'string' ? target.className : ''),
      attr,
      running: document.getAnimations().length,
      open: document.getElementById('sheet').classList.contains('open'),
      panel: [cs(panel).transform, cs(panel).opacity],
      dim: cs(document.querySelector('.sheet-backdrop')).opacity,
      steps: ['step-1', 'step-2', 'step-3'].map((id) => {
        const s = document.getElementById(id);
        return { hidden: s.hidden, moving: s.classList.contains('step-in') || s.classList.contains('step-out'), opacity: cs(s).opacity };
      }),
      plans: [...document.querySelectorAll('.plan')].map((p) => ({
        checked: p.getAttribute('aria-checked'),
        ring: cs(p, '::before').opacity,
        tick: cs(p.querySelector('.tick'), '::before').opacity,
        pop: p.querySelector('.tick').classList.contains('pop')
      })),
      lines: [...document.querySelectorAll('.story-line')].map((l) => [l.classList.contains('on'), cs(l).opacity]),
      shots: [...document.querySelectorAll('.story .shot')].map((s) => [s.classList.contains('on'), cs(s).opacity])
    });
    const obs = new MutationObserver((list) => {
      for (const m of list) window.__still.push(snap(m.target, m.attributeName));
    });
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-checked'] });
  });
}

const records = (page) => page.evaluate(() => window.__still.splice(0));

for (const layout of LAYOUTS) {
  test.describe(`Reduce Motion, ${layout.name}`, () => {
    test.use({ ...layout.use, contextOptions: { reducedMotion: 'reduce' } });

    test('nothing moves at load or while the page scrolls; the last answer and the total show; nothing waits; the story\'s lines and screens change at once', async ({ page }) => {
      await page.goto(TAGGED_QS);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      expect(await moving(page), 'no animation and no timed transition anywhere').toEqual([]);
      expect(await running(page), 'nothing runs').toEqual([]);

      // the end states: the last answer and the total, still; the two passing ones never show
      const first = await page.evaluate(() => ['.answer-line.answer-1', '.answer-line.answer-2', '.answer-line.answer-3', '.first-tile .shot.answer-1', '.first-tile .shot.answer-2', '.first-tile .shot.answer-3']
        .map((sel) => {
          const cs = getComputedStyle(document.querySelector(sel));
          return cs.visibility === 'visible' ? cs.opacity : 'hidden';
        }));
      expect(first, 'the last answer and the total').toEqual(['hidden', 'hidden', '1', 'hidden', 'hidden', '1']);
      await expect(page.locator('.answer-line.answer-3')).toHaveText('Know what dinner costs before you shop.');
      const words = await page.evaluate(() => ['.first-words', '.first-tile', '.first-stores'].map((sel) => {
        const cs = getComputedStyle(document.querySelector(sel));
        return [cs.opacity, cs.transform];
      }));
      for (const [opacity, transform] of words) expect([opacity, transform], 'the first screen at rest from the start').toEqual(['1', 'none']);

      // nothing waits below the first screen, at load or after scrolling to the end
      const reveals = () => page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map((el) => {
        const cs = getComputedStyle(el);
        return { part: el.classList[0], waits: el.classList.contains('wait') || el.classList.contains('in'), opacity: cs.opacity, transform: cs.transform };
      }));
      const atRest = (parts) => parts.map((p) => ({ ...p, waits: false, opacity: '1', transform: 'none' }));
      const before = await reveals();
      expect(before, 'nothing waits').toEqual(atRest(before));

      await watch(page);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= height; y += 300) {
        await page.evaluate(() => window.scrollBy(0, 300));
        await page.waitForTimeout(30);
        expect(await running(page), `nothing runs at ${y}`).toEqual([]);
      }
      expect(await reveals(), 'no part rose').toEqual(atRest(before));

      // the story: each line in focus in turn; at the moment its class changes it is ink and its screen shows
      for (const n of [1, 2, 3, 0]) {
        await page.evaluate((k) => {
          const line = document.querySelectorAll('.story-line')[k];
          window.scrollBy(0, line.getBoundingClientRect().top - window.innerHeight * (innerWidth >= 900 ? 0.4 : 0.5));
        }, n);
        await page.waitForFunction((k) => document.querySelectorAll('.story-line')[k].classList.contains('on') && document.querySelectorAll('.story .shot')[k].classList.contains('on'), n);
      }
      const flips = (await records(page)).filter((r) => /story-line|shot/.test(r.target));
      expect(flips.length, 'the story\'s focus changed').toBeGreaterThanOrEqual(16);
      for (const r of flips) {
        expect(r.running, 'nothing runs as the focus changes').toBe(0);
        r.lines.forEach(([on, opacity], i) => expect(opacity, `line ${i + 1} at once`).toBe(on ? '1' : '0.62'));
        r.shots.forEach(([on, opacity], i) => expect(opacity, `screen ${i + 1} at once`).toBe(on ? '1' : '0'));
      }
      expect(await moving(page)).toEqual([]);
    });

    test('the sheet appears at once, and so do its plans\' ring and tick, its steps, the done line and the close; no shake', async ({ page, harness }) => {
      const { blobs } = harness;
      await page.goto(TAGGED_QS);
      await waitForRows(blobs, { event: 'pageview' });
      await watch(page);
      const reserve = page.locator(layout.reserve);
      await reserve.click();
      await sheetSettled(page);

      // open: the sheet (or the dialog) and the dim at their end the moment the sheet opens
      let recs = await records(page);
      const opened = recs.find((r) => r.target === 'sheet' && r.open);
      expect(opened, 'the sheet opened').toBeTruthy();
      expect(opened.panel, 'in place and opaque at once').toEqual(['none', '1']);
      expect(opened.dim, 'the page dimmed at once').toBe('1');
      expect(recs.every((r) => r.running === 0), 'nothing ran while it opened').toBe(true);
      expect(await moving(page)).toEqual([]);

      // a plan: its ring and its tick at once, no pop
      await page.locator('[data-tap="plan_monthly"]').click();
      await expect(page.locator('[data-tap="plan_monthly"]')).toHaveAttribute('aria-checked', 'true');
      recs = await records(page);
      const picked = recs.filter((r) => r.attr === 'aria-checked').pop();
      expect(picked.plans.map((p) => [p.checked, p.ring, p.tick, p.pop]), 'the ring and the tick at once').toEqual([['false', '0', '0', false], ['true', '1', '1', false]]);
      expect(recs.every((r) => r.running === 0 && r.plans.every((p) => !p.pop)), 'no pop, nothing ran').toBe(true);

      // the next step at once: the plans gone and the email step shown, neither fading
      await page.locator('#hold').click();
      await expect(page.locator('#step-2')).toBeVisible();
      recs = await records(page);
      const stepped = recs.filter((r) => r.attr === 'hidden').pop();
      expect(stepped.steps.map((s) => [s.hidden, s.moving, s.opacity])).toEqual([[true, false, '1'], [false, false, '1'], [true, false, '1']]);
      expect(recs.every((r) => r.running === 0 && r.steps.every((s) => !s.moving)), 'no crossfade').toBe(true);

      // a bad address: no shake, the field marked
      await page.evaluate(() => {
        window.__shakes = [];
        document.getElementById('email').addEventListener('animationstart', (ev) => window.__shakes.push(ev.animationName));
      });
      await page.locator('#email').fill('nope');
      await page.locator('#email-form button[type="submit"]').click();
      await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => window.__shakes), 'no shake').toEqual([]);

      // the done line at once
      await page.locator('#email').fill('still@example.com');
      await page.locator('#email-form button[type="submit"]').click();
      await expect(page.locator('#step-3')).toBeVisible();
      recs = await records(page);
      const done = recs.filter((r) => r.attr === 'hidden').pop();
      expect(done.steps.map((s) => [s.hidden, s.moving, s.opacity]), 'the done line under the email step, at once').toEqual([[true, false, '1'], [false, false, '1'], [false, false, '1']]);
      expect(recs.every((r) => r.running === 0)).toBe(true);
      const [row] = await waitForRows(blobs, { event: 'email' });
      expect(row.plan).toBe('monthly');

      // the close at once: hidden in the same moment as the press, by Escape and by the X
      expect(await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return [document.getElementById('sheet').hidden, document.getAnimations().length];
      }), 'Escape: hidden at once, nothing runs').toEqual([true, 0]);
      await expect(reserve).toBeFocused();
      await reserve.click();
      await sheetSettled(page);
      expect(await page.evaluate(() => {
        document.querySelector('.sheet-x').click();
        return [document.getElementById('sheet').hidden, document.getAnimations().length];
      }), 'the X: hidden at once, nothing runs').toEqual([true, 0]);
      await expect(reserve).toBeFocused();
      expect((await records(page)).every((r) => r.running === 0)).toBe(true);
      expect(await moving(page)).toEqual([]);
    });
  });
}
