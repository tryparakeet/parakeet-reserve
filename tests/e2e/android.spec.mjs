// SITE-03 §4's browser runs on the new page (SITE-04 §6.2, §6.6 and §6.8 #9): an Android phone, in Chrome
// and in TikTok's in-app browser, at 412 x 915 (AN1-412) and 360 x 800. §1's words show: the bar's ink
// button "Email me when it’s on Android" (data-tap="android") and the iPhone-only line, with no reserve
// line. The button opens the sheet straight on its email step (the title "Where should we send it?", the
// button "Send", Android's small line), Tab and Shift+Tab keep the focus in it; a bad address shakes and
// stores nothing, a good one is sent with plan android and shows the done line with the address. No
// reserve, plan or seen row is ever stored, and the summary counts the tap and the email apart from the
// reservations. The band crosses the button 3 times from 1 s after load, 1.2 s each and 0.6 s apart, then
// rests; with Reduce Motion it never runs.
//
// At 1440 x 900 with an Android user agent only the words change: the header's and the white tile's sky
// buttons read "Email me when it’s on Android" (data-tap="android") and the iPhone-only line takes the
// reserve line's place and look; no band. An iPhone at 412 x 915 keeps the reserve page (reserve.spec and
// flow.spec run its flow and its rows, and a computer's).
//
// Every in-sheet click that follows an open awaits sheetSettled() (see fixtures.mjs).

import { test, expect, TAGGED_QS, waitForRows, rowsOf, settle, sheetSettled, bbox, expectFocusTrapped } from './fixtures.mjs';
import { REAL_UAS, COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const BUTTON = 'Email me when it’s on Android';
const LINE = 'Parakeet is iPhone only for now. We plan to bring it to Android.';
const SMALL = 'We’ll email you when it’s on Android, and maybe once before, to ask if you’d like to try it early. Nothing else.';
const DONE = (email) => `We’ll email ${email} when Parakeet is on Android.`;
const RESERVE_SMALL = ['One email when we launch. Your 2 free weeks are tied to this email.', 'One email when we launch, nothing else.'];
const RESERVE_LINE = 'We don’t charge anything today. Reserve the yearly plan now and you will have 2 free weeks at launch.';

const BROWSERS = [
  { name: 'Chrome', ua: REAL_UAS.chrome_android, inapp: 'none' },
  { name: 'TikTok\'s in-app browser', ua: REAL_UAS.tiktok_android, inapp: 'tiktok' }
];
const WINDOWS = [{ width: 412, height: 915 }, { width: 360, height: 800 }];

const isReserveRow = (r) => (r.event === 'tap' && r.button !== 'android') || r.event === 'seen' || (r.event === 'email' && r.plan !== 'android');

// The words a visitor can see: each element with a box whose text is one of these, the innermost one.
function visibleTexts(page, texts) {
  return page.evaluate((list) => [...document.querySelectorAll('body *')]
    .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible')
    .map((el) => [el, (el.innerText || '').trim()])
    .filter(([el, t]) => list.includes(t) && ![...el.children].some((c) => (c.innerText || '').trim() === t))
    .map(([, t]) => t), texts);
}

// The band over its whole timeline, sampled every 50 ms: when it moves, and when it is over the button
// (the button clips it, so it shows only then). Each is a list of runs of samples, { from, to } in ms.
async function bandRuns(page) {
  return page.evaluate(() => {
    const button = document.querySelector('.cta .btn-final');
    const band = document.getAnimations().find((a) => a.animationName === 'band');
    if (!band) return null;
    const width = button.getBoundingClientRect().width;
    const moving = [];
    const over = [];
    const mark = (runs, on, t, was) => {
      if (on && !was) runs.push({ from: t, to: t });
      if (on) runs[runs.length - 1].to = t;
      return on;
    };
    let last = null;
    let wasMoving = false;
    let wasOver = false;
    for (let t = 0; t <= 6400; t += 50) {
      band.pause();
      band.currentTime = t;
      const cs = getComputedStyle(button, '::after');
      const left = cs.transform === 'none' ? 0 : Number(cs.transform.slice(7, -1).split(',')[4]);
      wasMoving = mark(moving, last !== null && left !== last, t, wasMoving);
      wasOver = mark(over, left < width && left + parseFloat(cs.width) > 0, t, wasOver);
      last = left;
    }
    band.play();
    return { moving, over };
  });
}

for (const browser of BROWSERS) {
  for (const win of WINDOWS) {
    test.describe(`an Android phone in ${browser.name} at ${win.width}x${win.height}`, () => {
      test.use({ userAgent: browser.ua, viewport: win });

      test('§1\'s words show; the sheet opens on its email step; a bad address shakes; a good one is sent with plan android and the done line shows; no reserve, plan or seen row', async ({ page, harness }) => {
        const { blobs } = harness;
        await page.goto(TAGGED_QS);
        const [pv] = await waitForRows(blobs, { event: 'pageview' });
        expect(pv).toMatchObject({ device: 'android', inapp: browser.inapp, flag: 'gate', scr: `${win.width}x${win.height}` });
        const vid = pv.vid;
        expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(true);

        // the words: the bar's ink button and the iPhone-only line, no reserve button or line anywhere
        const button = page.locator('.cta [data-tap="android"]');
        await expect(button).toBeVisible();
        await expect(button).toHaveText(BUTTON);
        expect(await button.evaluate((el) => [el.tagName, el.type, el.classList.contains('btn-final')]), 'a button in the final button\'s look').toEqual(['BUTTON', 'button', true]);
        // the final button's look (SITE-04 §6.2, AN1-412): ink, its label cream 17/600, a 1 px cream edge at 14%
        expect(await button.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            background: cs.backgroundColor,
            color: cs.color,
            font: [cs.fontSize, cs.fontWeight],
            edge: ['Top', 'Right', 'Bottom', 'Left'].map((s) => [cs[`border${s}Width`], cs[`border${s}Style`], cs[`border${s}Color`]].join(' '))
          };
        }), 'ink, a cream 17/600 label, a 1 px cream edge at 14%').toEqual({
          background: 'rgb(14, 27, 38)',
          color: 'rgb(251, 246, 236)',
          font: ['17px', '600'],
          edge: Array(4).fill('1px solid rgba(251, 246, 236, 0.14)')
        });
        await expect(page.locator('.first-words .android-line')).toBeVisible();
        await expect(page.locator('.first-words .android-line')).toHaveText(LINE);
        for (const sel of ['.cta [data-tap="reserve"]', '.cta-note']) await expect(page.locator(sel)).toBeHidden();
        expect(await visibleTexts(page, ['Reserve 2 free weeks', RESERVE_LINE]), 'no reserve words show').toEqual([]);
        expect(await visibleTexts(page, [BUTTON, LINE])).toEqual([LINE, BUTTON]);
        const shownTaps = await page.evaluate(() => [...document.querySelectorAll('[data-tap]')].filter((el) => el.getClientRects().length > 0).map((el) => el.getAttribute('data-tap')));
        expect(shownTaps, 'the one button on the page is Android\'s').toEqual(['android']);
        const bar = await bbox(page.locator('.cta'));
        const final = await bbox(button);
        expect(bar.bottom).toBeCloseTo(win.height, 0);
        expect(bar.height, 'AN1\'s bar holds only its button: 1 + 16 + the button + 23, its 96 box').toBeCloseTo(1 + 16 + final.height + 23, 0);

        // the button opens the sheet straight on its email step, the field focused inside the tap
        await button.click();
        const [tap] = await waitForRows(blobs, { event: 'tap', button: 'android' });
        expect(tap.vid).toBe(vid);
        expect(tap.via).toBeUndefined();
        await expect(page.locator('#sheet')).toBeVisible();
        await expect(page.locator('#step-2')).toBeVisible();
        await expect(page.locator('#step-1')).toBeHidden();
        await expect(page.locator('#step-3')).toBeHidden();
        await expect(page.locator('#email')).toBeFocused();
        await expect(page.locator('#sheet-panel')).toHaveAttribute('aria-labelledby', 'sheet-title-2');
        await expect(page.getByRole('heading', { name: 'Where should we send it?' })).toBeVisible();
        const send = page.locator('#email-form button[type="submit"]');
        await expect(send).toHaveAccessibleName('Send');
        await expect(page.getByText(SMALL, { exact: true })).toBeVisible();
        for (const small of RESERVE_SMALL) await expect(page.getByText(small, { exact: true })).toBeHidden();
        await sheetSettled(page);
        await expect(page.locator('#email')).toBeFocused();
        const panel = await bbox(page.locator('#sheet-panel'));
        expect(panel.bottom, 'the sheet rises from the bottom').toBeCloseTo(win.height, 0);
        expect(await page.locator('#sheet-panel').evaluate((el) => getComputedStyle(el).paddingBottom), 'AN2\'s padding under the sheet: 24').toBe('24px');
        await expectFocusTrapped(page, ['Close', '#email', 'Send'], 'the email step');

        // a bad address shakes and stores nothing
        await page.evaluate(() => {
          window.__shakes = [];
          document.getElementById('email').addEventListener('animationstart', (ev) => window.__shakes.push(ev.animationName));
        });
        await page.locator('#email').fill('nope@');
        await send.click();
        await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
        await page.waitForFunction(() => window.__shakes.includes('shake'));
        expect((await settle(blobs, { event: 'email' })).length, 'no email row').toBe(0);

        // a good one is sent with plan android, and the done line shows the address
        await page.locator('#email').fill('android@example.com');
        await send.click();
        const [row] = await waitForRows(blobs, { event: 'email' });
        expect(row).toMatchObject({ email: 'android@example.com', plan: 'android', vid, device: 'android', inapp: browser.inapp, flag: 'gate' });
        await expect(page.locator('#step-3')).toBeVisible();
        await expect(page.getByText(DONE('android@example.com'), { exact: true })).toBeVisible();
        for (const done of ['.done.if-yearly', '.done.if-monthly']) await expect(page.locator(done)).toBeHidden();
        await expect(page.getByText(SMALL, { exact: true }), 'the small line stays under the done line').toBeVisible();
        await expect(page.locator('#email')).toHaveValue('');
        await expect(page.locator('#email')).toBeDisabled();
        await expect(send).toBeDisabled();

        // closed by the X, Escape and the backdrop, the focus back on the button; it reopens on the email step
        await page.locator('.sheet-x').click();
        await expect(page.locator('#sheet')).toBeHidden();
        await expect(button).toBeFocused();
        await button.click();
        await expect(page.locator('#step-2')).toBeVisible();
        await expect(page.locator('#step-1')).toBeHidden();
        await expect(page.locator('#step-3')).toBeHidden();
        await expect(page.locator('#email')).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(page.locator('#sheet')).toBeHidden();
        await expect(button).toBeFocused();
        await button.click();
        await sheetSettled(page);
        await page.locator('.sheet-backdrop').click({ position: { x: 12, y: 12 } });
        await expect(page.locator('#sheet')).toBeHidden();
        await expect(button).toBeFocused();

        // the whole page scrolled through: still no reserve, plan or seen row
        const end = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y <= end; y += 400) await page.evaluate((top) => window.scrollTo(0, top), y);
        await settle(blobs, {}, 600);
        expect(rowsOf(blobs, isReserveRow), 'no reserve, plan or seen row').toEqual([]);
        expect(rowsOf(blobs, { event: 'tap', button: 'android' }).length).toBe(3);

        const out = await harness.admin();
        expect(out.version).toBe(8);
        const tt = out.total.sources.tiktok;
        expect(tt).toMatchObject({
          uniques: 1, android_taps: 1, tap_events_android: 3, android_emails: 1, email_events_android: 1,
          reserve_taps: 0, tap_events_reserve: 0, plan_taps: 0, plan_rate: 0, emails: 0, email_events: 0, seen: 0
        });
        expect(tt.device).toEqual({ ios: 0, android: 1, other: 0 });
        expect(tt.inapp[browser.inapp]).toBe(1);
        expect(out.emails.map((e) => [e.email, e.plan])).toEqual([['android@example.com', 'android']]);
        const table = await harness.admin({ table: 'emails' });
        expect(table.emails.map((e) => [e.email, e.plan, e.device])).toEqual([['android@example.com', 'android', 'android']]);
      });

      test('the band crosses the button 3 times from 1 s after load, 1.2 s each and 0.6 s apart, then rests', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto(TAGGED_QS);
        const button = page.locator('.cta .btn-final');
        await expect(button).toHaveClass(/\bband\b/);
        const timing = await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'band').map((a) => {
          const t = a.effect.getTiming();
          return {
            target: a.effect.target.className,
            pseudo: a.effect.pseudoElement,
            delay: t.delay,
            duration: t.duration,
            iterations: t.iterations,
            keyframes: a.effect.getKeyframes().map((k) => [Math.round(k.offset * 1000) / 1000, k.transform])
          };
        }));
        expect(timing).toEqual([{
          target: 'btn-final for-android band',
          pseudo: '::after',
          delay: 1000,
          duration: 1800,
          iterations: 3,
          keyframes: [[0, 'translateX(-110%)'], [0.667, 'translateX(330%)'], [1, 'translateX(330%)']]
        }]);
        const band = await button.evaluate((el) => {
          const cs = getComputedStyle(el, '::after');
          return { image: cs.backgroundImage, width: parseFloat(cs.width) / el.getBoundingClientRect().width, clip: getComputedStyle(el).overflow };
        });
        expect(band.image, 'cream, 24% at its middle, clear at both ends').toBe('linear-gradient(90deg, rgba(251, 246, 236, 0), rgba(251, 246, 236, 0.24), rgba(251, 246, 236, 0))');
        expect(band.width).toBeCloseTo(0.45, 2);
        expect(band.clip, 'the button clips it').toBe('hidden');

        // 3 crossings: each moves for 1.2 s, 0.6 s apart, from 1 s after load (the last ends at 5.8 s: 4.8 s of
        // motion); it is over the button only while it moves, and out of sight while it waits
        const runs = await bandRuns(page);
        expect(runs.moving).toHaveLength(3);
        expect(runs.over).toHaveLength(3);
        runs.moving.forEach((run, i) => {
          const start = 1000 + i * 1800;
          expect(run.from, `crossing ${i + 1} starts at ${start} ms`).toBeGreaterThanOrEqual(start);
          expect(run.from).toBeLessThanOrEqual(start + 50);
          expect(run.to, `crossing ${i + 1} ends 1.2 s later`).toBe(start + 1200);
          expect(runs.over[i].from, `crossing ${i + 1} shows on the button as it moves`).toBeGreaterThanOrEqual(run.from);
          expect(runs.over[i].to).toBeLessThanOrEqual(run.to);
          expect(runs.over[i].to - runs.over[i].from, `crossing ${i + 1} crosses the whole button`).toBeGreaterThanOrEqual(500);
        });

        // then it rests: the class goes, and nothing runs on the button
        await page.evaluate(() => { for (const a of document.getAnimations()) if (a.animationName === 'band') a.finish(); });
        await expect(button).not.toHaveClass(/\bband\b/);
        expect(await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'band').length)).toBe(0);
      });

      test('with Reduce Motion the band never runs', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(TAGGED_QS);
        await expect(page.locator('.cta .btn-final')).toBeVisible();
        await page.waitForTimeout(1300);
        await expect(page.locator('.cta .btn-final')).not.toHaveClass(/\bband\b/);
        expect(await page.evaluate(() => document.getAnimations().map((a) => a.animationName)), 'nothing runs').toEqual([]);
        expect(await page.locator('.cta .btn-final').evaluate((el) => getComputedStyle(el, '::after').content), 'no band drawn').toBe('none');
      });
    });
  }
}

/* ---------- an Android device at 1440 x 900: only the words change (§6.8 #9) ---------- */

const WIDE = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false };

// The computer's first screen's buttons and line, their look and their place in the tile.
function firstScreenLook(page, kind) {
  return page.evaluate((k) => {
    const look = (sel) => {
      const el = document.querySelector(sel);
      if (!el || !el.getClientRects().length) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: el.innerText.trim(),
        tap: el.getAttribute('data-tap'),
        top: Math.round(r.top * 100) / 100,
        height: Math.round(r.height * 100) / 100,
        css: ['backgroundColor', 'backgroundImage', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'borderRadius', 'paddingLeft', 'paddingRight', 'marginTop', 'maxWidth', 'borderTopWidth'].map((p) => cs[p])
      };
    };
    const tile = document.querySelector('.first-words').getBoundingClientRect();
    const line = look(k === 'android' ? '.first-words .android-line' : '.first-note');
    const tileButton = look(`.first-words [data-tap="${k}"]`);
    return {
      header: look(`.top [data-tap="${k}"]`),
      tileButton,
      line,
      lineLeft: Math.round(document.querySelector(k === 'android' ? '.first-words .android-line' : '.first-note').getBoundingClientRect().left - tile.left),
      buttonLeft: Math.round(document.querySelector(`.first-words [data-tap="${k}"]`).getBoundingClientRect().left - tile.left),
      buttonUnderAnswer: Math.round((tileButton.top - document.querySelector('.first-words .answer').getBoundingClientRect().bottom) * 100) / 100,
      lineUnderButton: Math.round((line.top - (tileButton.top + tileButton.height)) * 100) / 100,
      shownTaps: [...document.querySelectorAll('[data-tap]')].filter((el) => el.getClientRects().length > 0).map((el) => el.getAttribute('data-tap')),
      bar: getComputedStyle(document.querySelector('.cta')).display
    };
  }, kind);
}

async function firstAtRest(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.first-words, .first-tile, .first-stores')]
    .every((el) => el.getAnimations().every((a) => a.playState === 'finished')));
}

test.describe('an Android device at 1440x900', () => {
  test.use({ ...WIDE, userAgent: REAL_UAS.chrome_android });

  test('only the words change: the header\'s and the tile\'s sky buttons are Android\'s, its line takes the reserve line\'s place and look; no band; the header\'s button opens the email step in the dialog', async ({ page, browser, harness }) => {
    const { blobs } = harness;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(TAGGED_QS);
    const [pv] = await waitForRows(blobs, { event: 'pageview' });
    expect(pv.device).toBe('android');
    expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(true);
    await firstAtRest(page);
    const android = await firstScreenLook(page, 'android');

    // the same window on a computer's Safari, for the reserve words' look and place
    const mac = await browser.newContext({ ...WIDE, userAgent: COMPUTER_UAS.safari_mac, baseURL: harness.url, deviceScaleFactor: 2 });
    try {
      const macPage = await mac.newPage();
      await macPage.goto(TAGGED_QS);
      await firstAtRest(macPage);
      const reserve = await firstScreenLook(macPage, 'reserve');

      expect(android.shownTaps, 'the header and the tile hold Android\'s button').toEqual(['android', 'android']);
      expect(reserve.shownTaps).toEqual(['reserve', 'reserve']);
      expect([android.header.text, android.tileButton.text]).toEqual([BUTTON, BUTTON]);
      expect(android.line.text).toBe(LINE);
      expect(reserve.line.text).toBe(RESERVE_LINE);
      for (const part of ['header', 'tileButton', 'line']) {
        expect(android[part].css, `${part}: the reserve words' look`).toEqual(reserve[part].css);
      }
      expect(android.header.css[0], 'the header\'s button stays sky').toBe('rgb(79, 168, 232)');
      expect(android.tileButton.css[1], 'no gradient on the tile\'s button').toBe('none');
      expect([android.header.top, android.header.height], 'the header\'s button where the reserve one is').toEqual([reserve.header.top, reserve.header.height]);
      // the tile's words are centred up and down, so a shorter line moves them all; the button keeps its place
      // under the answer line and its height, and the line its place under the button
      expect([android.buttonUnderAnswer, android.tileButton.height, android.buttonLeft], 'the tile\'s button where the reserve one is').toEqual([reserve.buttonUnderAnswer, reserve.tileButton.height, reserve.buttonLeft]);
      expect([android.lineLeft, android.lineUnderButton], 'the line where the reserve line is').toEqual([reserve.lineLeft, reserve.lineUnderButton]);
      expect([android.bar, reserve.bar], 'no bottom bar on a computer').toEqual(['none', 'none']);
    } finally {
      await mac.close();
    }

    // no band, before or after its time
    await page.waitForTimeout(1300);
    expect(await page.evaluate(() => document.querySelectorAll('.band').length)).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'band').length)).toBe(0);

    // the header's button: an android tap, the dialog in the middle on its email step, plan android
    const header = page.locator('.top [data-tap="android"]');
    await header.click();
    await waitForRows(blobs, { event: 'tap', button: 'android' });
    await expect(page.locator('#step-2')).toBeVisible();
    await expect(page.locator('#step-1')).toBeHidden();
    await sheetSettled(page);
    const dialog = await bbox(page.locator('#sheet-panel'));
    expect(dialog.width).toBeCloseTo(480, 1);
    expect((dialog.top + dialog.bottom) / 2, 'the dialog in the middle').toBeCloseTo(450, 0);
    await expectFocusTrapped(page, ['Close', '#email', 'Send'], 'the dialog\'s email step');
    await expect(page.locator('#email-form button[type="submit"]')).toHaveAccessibleName('Send');
    await expect(page.getByText(SMALL, { exact: true })).toBeVisible();
    await page.locator('#email').fill('tablet@example.com');
    await page.locator('#email-form button[type="submit"]').click();
    const [row] = await waitForRows(blobs, { event: 'email' });
    expect(row).toMatchObject({ plan: 'android', email: 'tablet@example.com', device: 'android' });
    await expect(page.getByText(DONE('tablet@example.com'), { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet')).toBeHidden();
    await expect(header).toBeFocused();
    expect(rowsOf(blobs, isReserveRow), 'no reserve, plan or seen row').toEqual([]);
  });
});

/* ---------- an iPhone in the same window keeps the reserve page ---------- */

test.describe('an iPhone at 412x915', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test('the reserve words, no Android words, no band; Reserve opens the plans', async ({ page, harness }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(TAGGED_QS);
    const [pv] = await waitForRows(harness.blobs, { event: 'pageview' });
    expect(pv.device).toBe('ios');
    expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(false);
    await expect(page.locator('.cta [data-tap="reserve"]')).toBeVisible();
    await expect(page.locator('.cta-note')).toHaveText(RESERVE_LINE);
    expect(await visibleTexts(page, [BUTTON, LINE]), 'no Android words show').toEqual([]);
    await page.waitForTimeout(1300);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'band').length)).toBe(0);
    await page.locator('.cta [data-tap="reserve"]').click();
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('#step-2')).toBeHidden();
    await waitForRows(harness.blobs, { event: 'seen' });
  });
});
