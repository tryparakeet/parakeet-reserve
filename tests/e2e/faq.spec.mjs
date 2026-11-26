// The questions above the footer (SITE-04 §6.10; DESIGN.md §4, §6 and §8):
// - with the script off, every question still opens, and the iPhone's words show;
// - a tap opens one at once, with no motion, and its plus turns to a minus; another tap closes it, and any
//   number can be open;
// - an Android phone shows four questions, with its own answers to the launch, Android and the email;
// - the computer header's FAQ jumps to the questions at once and lands 'Questions' 16 px under the sticky
//   header, with the script on or off; a phone's header has no FAQ;
// - the boards' numbers at 393 and 375 (a phone), 1024 and 1440 (a computer), and half way at 1232;
// - at 320 wide and at 200% zoom, with every question open, nothing is cut off, drawn over or scrolls
//   sideways.

import { test, expect, TAGGED_QS, frames } from './fixtures.mjs';
import { REAL_UAS, COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const MAC = { isMobile: false, hasTouch: false, userAgent: COMPUTER_UAS.safari_mac };

const IPHONE = [
  ['When does Parakeet launch?', 'There’s no date yet. If you reserve, we’ll send you one email on launch day.'],
  ['Do you charge anything today?', 'No. Reserve the yearly plan now and you’ll have 2 free weeks at launch.'],
  ['What does it cost after that?', 'It’s $29.99 a year, or $9.99 a month. Those are the prices at launch.'],
  ['How do I cancel?', 'Cancel in your iPhone’s Settings, at least a day before your free weeks end. The app will remind you 2 days before, if you turn on its reminders.'],
  ['Does it fit my family?', 'You pick your budget, how many people and which nights, and some nights can be vegetarian.'],
  ['Is it on Android?', 'Parakeet is iPhone only for now. We plan to bring it to Android. On an Android phone, you can leave your email on this page, and we’ll tell you when it’s there.'],
  ['What do you do with my email?', 'We send you one email, on launch day, and nothing else. We never share or sell it, and we delete it 90 days after launch.']
];
const ANDROID = [
  ['When does Parakeet launch?', 'There’s no date yet.'],
  ['Does it fit my family?', 'You pick your budget, how many people and which nights, and some nights can be vegetarian.'],
  ['Is it on Android?', 'Parakeet is iPhone only for now. We plan to bring it to Android. Tap “Email me when it’s on Android” and we’ll tell you when it’s there.'],
  ['What do you do with my email?', 'We’ll email you when it’s on Android, and maybe once before, to ask if you’d like to try it early, and never for anything else. We never share or sell it, and we delete it 90 days after it’s on Android.']
];

async function load(page) {
  await page.goto(TAGGED_QS);
  await expect(page.locator('h1')).toHaveText('What’s for dinner this week?');
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  await frames(page);
}

// Each question shown, in order: its words, whether it is open, the answer shown under it, and the plus.
function questions(page) {
  return page.evaluate(() => [...document.querySelectorAll('.faq details')].filter((d) => d.getClientRects().length).map((d) => {
    // drawn: a closed question's answer has a box but isn't rendered (the details' content is hidden)
    const shown = [...d.querySelectorAll('p')].filter((p) => p.checkVisibility());
    const upright = d.querySelector('.faq-v');
    return {
      q: d.querySelector('.faq-q').textContent,
      open: d.open,
      answers: shown.map((p) => p.textContent),
      answerOpacity: shown.map((p) => getComputedStyle(p).opacity),
      minus: getComputedStyle(upright).opacity === '0'
    };
  }));
}

// A question by its words: its summary, to tap.
const summary = (page, q) => page.locator('.faq details').filter({ has: page.locator('.faq-q', { hasText: q }) }).locator('summary');

// Each in the middle of the window first, clear of a phone's pinned bar, as a visitor scrolls to it.
async function tap(page, q) {
  const s = summary(page, q);
  await s.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await s.click();
}

async function openEach(page, list) {
  for (const [q] of list) await tap(page, q);
  return questions(page);
}

/* ---------- the script off: every question still opens, in the iPhone's words ---------- */

for (const layout of [{ name: 'a phone at 393x852', use: { viewport: { width: 393, height: 852 } } }, { name: 'a computer at 1440x900', use: { viewport: { width: 1440, height: 900 }, ...MAC } }]) {
  test.describe(`the script off, ${layout.name}`, () => {
    test.use({ ...layout.use, javaScriptEnabled: false });

    test('the seven questions start closed, and every one opens with its iPhone answer', async ({ page }) => {
      await page.goto(TAGGED_QS);
      const before = await questions(page);
      expect(before.map((x) => x.q)).toEqual(IPHONE.map(([q]) => q));
      expect(before.every((x) => !x.open && !x.answers.length && !x.minus), 'all closed, each with its plus').toBe(true);
      const after = await openEach(page, IPHONE);
      expect(after.map((x) => [x.q, x.answers])).toEqual(IPHONE.map(([q, a]) => [q, [a]]));
      expect(after.every((x) => x.open && x.minus), 'all open, each with its minus').toBe(true);
    });
  });
}

/* ---------- a tap opens one at once ---------- */

test.describe('on an iPhone at 393x852', () => {
  test.use({ viewport: { width: 393, height: 852 }, userAgent: REAL_UAS.safari_ios });

  test('a tap opens a question at once, its plus a minus, with nothing moving; another tap closes it; any number can be open', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await load(page);
    const cancel = summary(page, 'How do I cancel?');
    await cancel.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // the tile's own rise, once, as it comes into view; then it rests
    await expect(page.locator('.faq')).toHaveClass(/\bin\b/);
    await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
    // the same task as the tap: the answer is drawn whole and the minus shows, with no animation or transition to wait for
    const atOnce = await cancel.evaluate((s) => {
      s.click();
      const d = s.parentElement;
      const p = d.querySelector('p');
      return {
        open: d.open,
        height: p.getBoundingClientRect().height,
        opacity: getComputedStyle(p).opacity,
        minus: getComputedStyle(d.querySelector('.faq-v')).opacity,
        running: document.querySelector('.faq').getAnimations({ subtree: true }).filter((a) => a.playState === 'running').map((a) => a.animationName || a.constructor.name),
        transitions: [d, s, p, d.querySelector('.faq-plus'), d.querySelector('.faq-v')].map((el) => getComputedStyle(el).transitionDuration)
      };
    });
    expect(atOnce.open).toBe(true);
    expect(atOnce.height, 'the answer is there at once').toBeGreaterThan(40);
    expect(atOnce.opacity).toBe('1');
    expect(atOnce.minus, 'the plus is a minus at once').toBe('0');
    expect(atOnce.running, 'nothing in the tile moves').toEqual([]);
    expect(atOnce.transitions.every((t) => t === '0s'), 'no transition on any of it').toBe(true);

    let state = await questions(page);
    expect(state.filter((x) => x.open).map((x) => x.q)).toEqual(['How do I cancel?']);
    expect(state.find((x) => x.q === 'How do I cancel?').answers).toEqual([IPHONE[3][1]]);

    await tap(page, 'Does it fit my family?');
    state = await questions(page);
    expect(state.filter((x) => x.open).map((x) => x.q), 'two open at once').toEqual(['How do I cancel?', 'Does it fit my family?']);

    await tap(page, 'How do I cancel?');
    state = await questions(page);
    expect(state.filter((x) => x.open).map((x) => x.q)).toEqual(['Does it fit my family?']);
    expect(state.find((x) => x.q === 'How do I cancel?').minus, 'closed, its plus again').toBe(false);
  });

  test('the keyboard opens and closes one too', async ({ page }) => {
    await load(page);
    await summary(page, 'When does Parakeet launch?').focus();
    await page.keyboard.press('Enter');
    expect((await questions(page))[0].open).toBe(true);
    await page.keyboard.press('Space');
    expect((await questions(page))[0].open).toBe(false);
  });
});

/* ---------- an Android phone: four questions, its own answers ---------- */

for (const [ua, win] of [['chrome_android', { width: 412, height: 915 }], ['chrome_android', { width: 360, height: 800 }], ['tiktok_android', { width: 412, height: 915 }]]) {
  test.describe(`Android (${ua}) at ${win.width}x${win.height}`, () => {
    test.use({ viewport: win, userAgent: REAL_UAS[ua] });

    test('four questions: the three about reserving hide, and the launch, Android and the email take Android\'s answers', async ({ page }) => {
      await load(page);
      expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(true);
      const before = await questions(page);
      expect(before.map((x) => x.q)).toEqual(ANDROID.map(([q]) => q));
      const after = await openEach(page, ANDROID);
      expect(after.map((x) => [x.q, x.answers])).toEqual(ANDROID.map(([q, a]) => [q, [a]]));
      // the hairline still runs between the rows shown: every row after the first has one
      const lines = await page.evaluate(() => [...document.querySelectorAll('.faq details')].filter((d) => d.getClientRects().length).map((d) => getComputedStyle(d).borderTopWidth));
      expect(lines).toEqual(['0px', '1px', '1px', '1px']);
    });
  });
}

/* ---------- the computer header's FAQ ---------- */

for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  for (const js of [true, false]) {
    test.describe(`a computer at ${size.width}x${size.height}, the script ${js ? 'on' : 'off'}`, () => {
      test.use({ viewport: size, ...MAC, javaScriptEnabled: js });

      test('the header\'s FAQ, a 44 px target before Reserve, jumps at once and lands Questions 16 px under the header', async ({ page }) => {
        await page.goto(TAGGED_QS);
        const link = page.locator('.top .top-link');
        await expect(link).toHaveText('FAQ');
        const box = await link.evaluate((a) => {
          const r = a.getBoundingClientRect();
          const btn = [...document.querySelectorAll('.top-btn')].find((b) => b.getClientRects().length).getBoundingClientRect();
          const cs = getComputedStyle(a);
          return { h: r.height, before: btn.left - r.right, font: `${cs.fontSize} ${cs.fontWeight}`, color: cs.color, line: cs.textDecorationLine, tap: a.hasAttribute('data-tap') };
        });
        expect(box.h, 'a 44 px target').toBeCloseTo(44, 1);
        expect(box.before, 'just before Reserve, as faq-head-1440 draws it (8 px and the header\'s 10 px gap)').toBeCloseTo(18, 1);
        expect(box).toMatchObject({ font: '15px 600', color: 'rgb(14, 27, 38)', line: 'none', tap: false });

        await link.click();
        // no smooth scrolling: the page is where it lands in the same frame, and stays there
        const at = await page.evaluate(() => ({ y: scrollY, hash: location.hash, behavior: getComputedStyle(document.documentElement).scrollBehavior }));
        expect(at.hash).toBe('#faq');
        expect(at.behavior).toBe('auto');
        expect(at.y).toBeGreaterThan(1000);
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => scrollY), 'it jumped; nothing scrolled after').toBe(at.y);
        const land = await page.evaluate(() => ({
          header: document.querySelector('.top').getBoundingClientRect().bottom,
          tile: document.querySelector('.faq').offsetTop - scrollY,
          label: document.querySelector('#faq-title').getBoundingClientRect().top
        }));
        expect(land.tile - land.header, 'the tile 16 px under the sticky header').toBeCloseTo(16, 0);
        expect(land.label, 'Questions shows below the header').toBeGreaterThan(land.header);
      });
    });
  }
}

test.describe('a phone\'s header', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('has no FAQ: the questions are a scroll away', async ({ page }) => {
    await load(page);
    await expect(page.locator('.top-link')).toBeHidden();
  });
});

/* ---------- the boards' numbers ---------- */

const NUMBERS = [
  { name: 'faq-open-393', viewport: { width: 393, height: 852 }, use: {}, tile: { side: 12, r: 28, pad: '24px 20px 8px' }, row: 56, q: '17px 24px', ls: 'normal', plus: 20, stroke: 1.8, a: '17px 24px', aw: 393 - 24 - 2 - 40, apb: 16, above: 16, below: 40 },
  { name: 'faq-open-375', viewport: { width: 375, height: 667 }, use: {}, tile: { side: 12, r: 28, pad: '24px 20px 8px' }, row: 56, q: '17px 24px', ls: 'normal', plus: 20, stroke: 1.8, a: '17px 24px', aw: 375 - 24 - 2 - 40, apb: 16, above: 16, below: 40 },
  { name: 'faq-open-1024', viewport: { width: 1024, height: 768 }, use: MAC, tile: { side: 32, r: 32, pad: '32px 40px 8px' }, row: 64, q: '20px 28px', ls: '-0.2px', plus: 24, stroke: 1.8, a: '17px 25px', aw: 600, apb: 20, above: 16, below: 64 },
  { name: 'half way, 1232', viewport: { width: 1232, height: 900 }, use: MAC, tile: { side: 36, r: 34, pad: '36px 48px 10px' }, row: 68, q: '22px 30px', ls: '-0.22px', plus: 26, stroke: 1.9, a: '18px 26px', aw: 620, apb: 22, above: 16, below: 64 },
  { name: 'faq-open-1440', viewport: { width: 1440, height: 900 }, use: MAC, tile: { side: 40, r: 36, pad: '40px 56px 12px' }, row: 72, q: '24px 32px', ls: '-0.24px', plus: 28, stroke: 2, a: '19px 27px', aw: 640, apb: 24, above: 16, below: 64 }
];

for (const n of NUMBERS) {
  test.describe(`the questions' numbers, ${n.name}`, () => {
    test.use({ viewport: n.viewport, ...n.use });

    test('the tile, the rows, the question, the plus and the answer', async ({ page }) => {
      await load(page);
      await tap(page, 'How do I cancel?');
      const m = await page.evaluate(() => {
        const faq = document.querySelector('.faq');
        const d = [...faq.querySelectorAll('details')].find((x) => x.open);
        const s = d.querySelector('summary'), q = d.querySelector('.faq-q'), plus = d.querySelector('.faq-plus'), p = d.querySelector('p');
        const cs = (el) => getComputedStyle(el);
        const r = (el) => el.getBoundingClientRect();
        const laid = (el) => {
          const dy = new DOMMatrixReadOnly(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform).m42;
          return { top: r(el).top - dy, bottom: r(el).bottom - dy };
        };
        return {
          left: r(faq).left, right: innerWidth - r(faq).right, radius: cs(faq).borderRadius, pad: cs(faq).padding,
          bg: cs(faq).backgroundColor, border: `${cs(faq).borderTopWidth} ${cs(faq).borderTopColor}`,
          label: `${faq.querySelector('.label').textContent} ${cs(faq.querySelector('.label')).fontSize}`,
          rows: [...faq.querySelectorAll('summary')].map((x) => r(x).height),
          hairlines: [...faq.querySelectorAll('details')].map((x) => cs(x).borderTopWidth),
          q: `${cs(q).fontSize} ${cs(q).lineHeight}`, qw: cs(q).fontWeight, ls: cs(q).letterSpacing, balance: cs(q).textWrap || cs(q).textWrapStyle,
          plus: [r(plus).width, r(plus).height], stroke: parseFloat(cs(plus.querySelector('path')).strokeWidth), plusRight: r(s).right - r(plus).right,
          a: `${cs(p).fontSize} ${cs(p).lineHeight}`, ac: cs(p).color, aw: r(p).width, apb: parseFloat(cs(p).paddingBottom), apr: parseFloat(cs(p).paddingRight),
          // the gaps as laid out, not as a part still waiting 14 px low to rise draws them
          above: laid(faq).top - laid(document.querySelector('.facts')).bottom, below: laid(document.querySelector('.footer')).top - laid(faq).bottom
        };
      });
      expect(m.left).toBeCloseTo(n.tile.side, 0);
      expect(m.right).toBeCloseTo(n.tile.side, 0);
      expect(m.radius).toBe(`${n.tile.r}px`);
      expect(m.pad).toBe(n.tile.pad);
      expect(m.bg).toBe('rgb(255, 255, 255)');
      expect(m.border).toBe('1px rgba(14, 27, 38, 0.1)');
      expect(m.label).toBe('Questions 15px');
      for (const h of m.rows) expect(h, 'each row').toBeCloseTo(n.row, 1);
      expect(m.hairlines).toEqual(['0px', ...Array(6).fill('1px')]);
      expect(m.q).toBe(n.q);
      expect(m.qw).toBe('600');
      expect(m.ls).toBe(n.ls);
      expect(m.balance).toContain('balance');
      expect(m.plus[0]).toBeCloseTo(n.plus, 1);
      expect(m.plus[1]).toBeCloseTo(n.plus, 1);
      expect(m.stroke).toBeCloseTo(n.stroke, 2);
      expect(m.plusRight, 'the plus at the row\'s right').toBeCloseTo(0, 1);
      expect(m.a).toBe(n.a);
      expect(m.ac).toBe('rgba(14, 27, 38, 0.7)');
      expect(m.aw).toBeCloseTo(n.aw, 0);
      expect(m.apb).toBeCloseTo(n.apb, 1);
      expect(m.above).toBeCloseTo(n.above, 0);
      expect(m.below).toBeCloseTo(n.below, 0);
    });
  });
}

/* ---------- 320 wide and 200% zoom: nothing cut off ---------- */

for (const w of [
  { width: 320, height: 568, ua: REAL_UAS.safari_ios, list: IPHONE },
  { width: 196, height: 426, ua: REAL_UAS.safari_ios, list: IPHONE },
  { width: 320, height: 568, ua: REAL_UAS.chrome_android, list: ANDROID },
  { width: 206, height: 458, ua: REAL_UAS.chrome_android, list: ANDROID }
]) {
  test.describe(`${w.ua === REAL_UAS.chrome_android ? 'Android' : 'iPhone'} at ${w.width}x${w.height}`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, userAgent: w.ua });

    test('every question open: nothing cut off, drawn over or scrolled sideways', async ({ page }) => {
      await load(page);
      await openEach(page, w.list);
      await page.locator('.faq').scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const faq = document.querySelector('.faq').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.faq details')].filter((d) => d.getClientRects().length).map((d) => {
          const words = document.createRange();
          words.selectNodeContents(d.querySelector('.faq-q'));
          const q = words.getBoundingClientRect();
          const plus = d.querySelector('.faq-plus').getBoundingClientRect();
          const p = [...d.querySelectorAll('p')].find((x) => x.getClientRects().length);
          const a = document.createRange();
          a.selectNodeContents(p);
          const ar = a.getBoundingClientRect();
          return { q: [q.left, q.right], plus: [plus.left, plus.right, plus.width], a: [ar.left, ar.right], scroll: [p.scrollWidth - p.clientWidth, d.querySelector('.faq-q').scrollWidth - d.querySelector('.faq-q').clientWidth] };
        });
        return { sideways: de.scrollWidth - de.clientWidth, faq: [faq.left, faq.right], rows };
      });
      expect(m.sideways, 'no sideways scroll').toBe(0);
      expect(m.faq[0]).toBeGreaterThanOrEqual(0);
      expect(m.faq[1]).toBeLessThanOrEqual(w.width + 0.5);
      for (const r of m.rows) {
        expect(r.q[0], 'the question inside the tile').toBeGreaterThanOrEqual(m.faq[0]);
        expect(r.q[1], 'the question clear of the plus').toBeLessThanOrEqual(r.plus[0] + 0.5);
        expect(r.plus[2], 'the plus whole').toBeCloseTo(20, 1);
        expect(r.plus[1], 'the plus inside the tile').toBeLessThanOrEqual(m.faq[1]);
        expect(r.a[0]).toBeGreaterThanOrEqual(m.faq[0]);
        expect(r.a[1], 'the answer inside the tile').toBeLessThanOrEqual(m.faq[1]);
        expect(r.scroll, 'no word runs out of its box').toEqual([0, 0]);
      }
    });
  });
}
