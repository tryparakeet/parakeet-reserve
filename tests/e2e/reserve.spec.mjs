// The reserve flow on the new page (SITE-04 §6.6), from each place its button sits: the bottom bar on a
// phone at 393 x 852, and on a computer at 1440 x 900 and 1024 x 768 (no touch) the header's small Reserve,
// pressed after scrolling with the header held at the top, and the white tile's button. On a phone the
// sheet rises from the bottom; on a computer it is the dialog in the middle, at every step.
//
// Each run: Reserve, the plans, Hold my spot with the yearly plan as it opens (via: hold), a bad address
// shakes and stores nothing, a good one shows the yearly done line; closed by the X, the focus goes back to
// the pressed button; reopened on the plans, the monthly card (via: card), its email and done line; closed
// by Escape, then by the backdrop, the focus back each time. The rows the function stores are asserted from
// the store, as flow.spec does: reserve, seen once, the plan taps, each email with its plan, and never an
// Android row; then the summary the admin reads.
//
// On a phone the first tile is the phone's sky tile, which holds no button (C-393 draws the Reserve only in
// the bar), so a phone's run starts in the bar; the first tile's button is the computer's white tile.
//
// Every in-sheet click that follows an open awaits sheetSettled(): presses inside the sheet during its
// first 500 ms are dropped on purpose (see fixtures.mjs).

import { test, expect, TAGGED_QS, waitForRows, rowsOf, settle, sheetSettled, bbox } from './fixtures.mjs';
import { COMPUTER_UAS } from '../fixtures/user-agents.mjs';

const INK_48 = 'rgba(14, 27, 38, 0.48)';

const LINES = {
  yearly: {
    small: 'One email when we launch. Your 2 free weeks are tied to this email.',
    done: (email) => `Your 2 free weeks are reserved for ${email}. We’ll email you once, when Parakeet is live.`
  },
  monthly: {
    small: 'One email when we launch, nothing else.',
    done: (email) => `Your spot is saved for ${email}. We’ll email you once, when Parakeet is live.`
  }
};
const ANDROID_SMALL = 'We’ll email you when it’s on Android, and maybe once before, to ask if you’d like to try it early. Nothing else.';

const PHONE = { viewport: { width: 393, height: 852 } };
const computer = (width, height) => ({ viewport: { width, height }, isMobile: false, hasTouch: false, userAgent: COMPUTER_UAS.safari_mac });

const PLACES = [
  { name: 'a phone at 393x852, from the bottom bar', use: PHONE, button: '.cta [data-tap="reserve"]', computer: false },
  { name: 'a computer at 1440x900, from the header after scrolling', use: computer(1440, 900), button: '.top [data-tap="reserve"]', computer: true, scroll: true },
  { name: 'a computer at 1440x900, from the white tile', use: computer(1440, 900), button: '.first-words [data-tap="reserve"]', computer: true },
  { name: 'a computer at 1024x768, from the header after scrolling', use: computer(1024, 768), button: '.top [data-tap="reserve"]', computer: true, scroll: true },
  { name: 'a computer at 1024x768, from the white tile', use: computer(1024, 768), button: '.first-words [data-tap="reserve"]', computer: true }
];

const isPlanTap = (r) => r.event === 'tap' && String(r.button).startsWith('plan_');

// Where the sheet is: on a phone at the window's bottom, full width in the 430 column, top corners 28 and
// the grabber; on a computer the dialog in the middle, 480 wide, corners 36, its X at 14/14 and no grabber.
async function expectSheetPlace(page, { computer }, step) {
  const got = await page.evaluate(() => {
    const panel = document.getElementById('sheet-panel');
    const cs = getComputedStyle(panel);
    const r = panel.getBoundingClientRect();
    const x = document.querySelector('.sheet-x').getBoundingClientRect();
    return {
      w: innerWidth,
      h: innerHeight,
      panel: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width },
      x: { top: x.top, right: x.right },
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
      grabber: getComputedStyle(document.querySelector('.grabber')).display,
      dim: [getComputedStyle(document.querySelector('.sheet-backdrop')).backgroundColor, getComputedStyle(document.querySelector('.sheet-backdrop')).opacity]
    };
  });
  expect(got.dim, `${step}: the page dims to ink at 48%`).toEqual([INK_48, '1']);
  if (computer) {
    expect(got.panel.width, `${step}: the dialog is 480 wide`).toBeCloseTo(480, 1);
    expect((got.panel.left + got.panel.right) / 2, `${step}: the dialog is centred across`).toBeCloseTo(got.w / 2, 0);
    expect((got.panel.top + got.panel.bottom) / 2, `${step}: the dialog is centred up and down`).toBeCloseTo(got.h / 2, 0);
    expect(got.radius, `${step}: corners 36`).toEqual(Array(4).fill('36px'));
    expect(got.grabber, `${step}: no grabber on the dialog`).toBe('none');
    expect(got.x.top - got.panel.top, `${step}: the X 14 from the top`).toBeCloseTo(14, 0);
    expect(got.panel.right - got.x.right, `${step}: the X 14 from the right`).toBeCloseTo(14, 0);
  } else {
    expect(got.panel.bottom, `${step}: the sheet sits on the window's bottom`).toBeCloseTo(got.h, 0);
    expect([got.panel.left, got.panel.right], `${step}: the sheet is the window's width`).toEqual([0, got.w]);
    expect(got.radius, `${step}: top corners 28`).toEqual(['28px', '28px', '0px', '0px']);
    expect(got.grabber, `${step}: the grabber`).toBe('block');
  }
}

// The shake on a bad address: the field's shake animation starts, aria-invalid is set, nothing is sent.
async function expectShake(page, blobs) {
  await page.evaluate(() => {
    window.__shakes = [];
    document.getElementById('email').addEventListener('animationstart', (ev) => window.__shakes.push(ev.animationName));
  });
  const emailsBefore = rowsOf(blobs, { event: 'email' }).length;
  await page.locator('#email').fill('nope');
  await page.locator('#email-form button[type="submit"]').click();
  await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
  await page.waitForFunction(() => window.__shakes.includes('shake'));
  await expect(page.locator('#email')).toBeFocused();
  await expect(page.locator('#step-2')).toBeVisible();
  await expect(page.locator('#step-3')).toBeHidden();
  expect((await settle(blobs, { event: 'email' })).length, 'a bad address stores no email row').toBe(emailsBefore);
}

for (const place of PLACES) {
  test.describe(place.name, () => {
    test.use(place.use);

    test('Reserve, the plans, the email, both plans\' done lines, the shake, and the X, Escape and the backdrop each give the focus back; the rows', async ({ page, harness }) => {
      const { blobs } = harness;
      await page.goto(TAGGED_QS);
      const [pv] = await waitForRows(blobs, { event: 'pageview' });
      const vid = pv.vid;
      expect(pv.device).toBe(place.computer ? 'other' : 'ios');
      expect(pv.inapp).toBe('none');
      expect(await page.evaluate(() => document.documentElement.classList.contains('android'))).toBe(false);

      // the reserve buttons this layout shows, and none of Android's
      const shown = await page.evaluate(() => [...document.querySelectorAll('[data-tap="reserve"], [data-tap="android"]')]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => `${el.closest('.top, .first-words, .cta').className.split(' ')[0]}:${el.getAttribute('data-tap')}`));
      expect(shown).toEqual(place.computer ? ['top:reserve', 'first-words:reserve'] : ['cta:reserve']);

      const reserve = page.locator(place.button);
      await expect(reserve).toHaveText('Reserve 2 free weeks');
      // the first screen's load rise has ended (it moves the white tile's button for 800 ms)
      await page.waitForFunction(() => [...document.querySelectorAll('.first-words, .first-tile, .first-stores')]
        .every((el) => el.getAnimations().every((a) => a.playState === 'finished')));
      if (place.scroll) {
        await page.mouse.wheel(0, 1600);
        // scrolled, and come to rest (the same place two frames apart)
        await page.waitForFunction(() => new Promise((done) => {
          const y = window.scrollY;
          requestAnimationFrame(() => requestAnimationFrame(() => done(y > 1000 && window.scrollY === y)));
        }));
        const top = await bbox(page.locator('.top'));
        expect(top.top, 'the header holds the top while the page scrolls').toBe(0);
      }
      await expect(reserve).toBeInViewport();
      const scrolled = await page.evaluate(() => window.scrollY);
      const pressedAt = await bbox(reserve);

      // Reserve: a tap row, the sheet on its plans, seen once
      await reserve.click();
      const [tapReserve] = await waitForRows(blobs, { event: 'tap', button: 'reserve' });
      expect(tapReserve.vid).toBe(vid);
      expect(tapReserve.via).toBeUndefined();
      await expect(page.locator('#sheet')).toBeVisible();
      await expect(page.locator('#step-1')).toBeVisible();
      await expect(page.locator('#step-2')).toBeHidden();
      await expect(page.locator('#sheet-title-1')).toHaveText('Parakeet is coming soon. Which plan do you want?');
      await expect(page.locator('#sheet-panel')).toHaveAttribute('aria-labelledby', 'sheet-title-1');
      const [seen] = await waitForRows(blobs, { event: 'seen' });
      expect(seen.vid).toBe(vid);
      await sheetSettled(page);
      await expectSheetPlace(page, place, 'the plans');
      expect(await bbox(reserve), 'the page keeps its place under the sheet').toEqual(pressedAt);

      // Hold my spot with the yearly plan as it opens: plan_yearly via hold, the email step, the field focused
      const yearly = page.locator('[data-tap="plan_yearly"]');
      const monthly = page.locator('[data-tap="plan_monthly"]');
      await expect(yearly).toHaveAttribute('aria-checked', 'true');
      await expect(monthly).toHaveAttribute('aria-checked', 'false');
      await page.locator('#hold').click();
      const [holdTap] = await waitForRows(blobs, isPlanTap);
      expect(holdTap.button).toBe('plan_yearly');
      expect(holdTap.via).toBe('hold');
      await expect(page.locator('#step-2')).toBeVisible();
      await expect(page.locator('#step-1')).toBeHidden();
      await expect(page.locator('#email')).toBeFocused();
      await expect(page.locator('#sheet-panel')).toHaveAttribute('aria-labelledby', 'sheet-title-2');
      await expect(page.locator('#sheet-title-2')).toHaveText('Where should we send it?');
      await expect(page.locator('#email-form button[type="submit"]'), 'the reserve words on the button').toHaveAccessibleName('Send my invite');
      await expect(page.getByText(LINES.yearly.small, { exact: true })).toBeVisible();
      await expect(page.getByText(LINES.monthly.small, { exact: true })).toBeHidden();
      await expect(page.getByText(ANDROID_SMALL, { exact: true })).toBeHidden();
      await expectSheetPlace(page, place, 'the email');

      // a bad address shakes; a good one is sent with the plan and the yearly done line shows
      await expectShake(page, blobs);
      await page.locator('#email').fill('yearly@example.com');
      await page.locator('#email-form button[type="submit"]').click();
      const [yearlyEmail] = await waitForRows(blobs, { event: 'email' });
      expect(yearlyEmail).toMatchObject({ email: 'yearly@example.com', plan: 'yearly', vid, flag: 'gate', device: pv.device });
      await expect(page.locator('#step-3')).toBeVisible();
      await expect(page.getByText(LINES.yearly.done('yearly@example.com'), { exact: true })).toBeVisible();
      await expect(page.getByText(LINES.monthly.done('yearly@example.com'), { exact: true })).toBeHidden();
      await expect(page.locator('#email')).toHaveValue('');
      await expect(page.locator('#email')).toBeDisabled();
      await expect(page.locator('#email-form button[type="submit"]')).toBeDisabled();
      await expectSheetPlace(page, place, 'the done line');

      // the X closes; the focus goes back to the pressed button, the page where it was
      await page.locator('.sheet-x').click();
      await expect(page.locator('#sheet')).toBeHidden();
      await expect(reserve).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
      expect(await page.evaluate(() => document.documentElement.classList.contains('sheet-open'))).toBe(false);

      // reopened on the plans: the monthly card, its small line, its email and its done line
      await reserve.click();
      await waitForRows(blobs, { event: 'tap', button: 'reserve' }, { count: 2 });
      await expect(page.locator('#step-1')).toBeVisible();
      await expect(page.locator('#step-3')).toBeHidden();
      await expect(page.locator('#email')).toBeEnabled();
      await sheetSettled(page);
      await monthly.click();
      const [cardTap] = await waitForRows(blobs, { event: 'tap', button: 'plan_monthly' });
      expect(cardTap.via).toBe('card');
      expect(cardTap.vid).toBe(vid);
      await expect(monthly).toHaveAttribute('aria-checked', 'true');
      await expect(yearly).toHaveAttribute('aria-checked', 'false');
      await page.locator('#hold').click();
      await expect(page.locator('#step-2')).toBeVisible();
      await expect(page.getByText(LINES.monthly.small, { exact: true })).toBeVisible();
      await expect(page.getByText(LINES.yearly.small, { exact: true })).toBeHidden();
      await page.locator('#email').fill('monthly@example.com');
      await page.locator('#email-form button[type="submit"]').click();
      const emails = await waitForRows(blobs, { event: 'email' }, { count: 2 });
      expect(emails.find((r) => r.email === 'monthly@example.com')).toMatchObject({ plan: 'monthly', vid });
      await expect(page.getByText(LINES.monthly.done('monthly@example.com'), { exact: true })).toBeVisible();
      await expect(page.getByText(LINES.yearly.done('monthly@example.com'), { exact: true })).toBeHidden();
      await expectSheetPlace(page, place, 'the monthly done line');

      // Escape closes; the focus goes back
      await page.keyboard.press('Escape');
      await expect(page.locator('#sheet')).toBeHidden();
      await expect(reserve).toBeFocused();

      // the backdrop closes, once the sheet has settled; the focus goes back
      await reserve.click();
      await sheetSettled(page);
      await page.locator('.sheet-backdrop').click({ position: { x: 12, y: 12 } });
      await expect(page.locator('#sheet')).toBeHidden();
      await expect(reserve).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

      // the rows: three reserves, seen once, one plan tap per press, each email with its plan, no Android row
      await settle(blobs);
      expect(rowsOf(blobs, { event: 'tap', button: 'reserve' }).length).toBe(3);
      expect(rowsOf(blobs, { event: 'seen' }).length, 'seen once a load').toBe(1);
      expect(rowsOf(blobs, isPlanTap).map((r) => `${r.button} ${r.via}`).sort(), 'the clock is frozen, so the rows are compared as a set').toEqual(['plan_monthly card', 'plan_yearly hold']);
      expect(rowsOf(blobs, (r) => r.button === 'android' || r.plan === 'android')).toEqual([]);
      for (const r of blobs.rows('events')) expect(r.vid, `${r.event}: one visitor`).toBe(vid);

      const out = await harness.admin();
      expect(out.version).toBe(8);
      const tt = out.total.sources.tiktok;
      expect(tt).toMatchObject({
        uniques: 1, reserve_taps: 1, tap_events_reserve: 3, plan_taps: 1, plan_yearly_taps: 1, plan_monthly_taps: 1,
        plan_rate: 1, emails: 1, email_events: 2, seen: 1, android_taps: 0, tap_events_android: 0, android_emails: 0, email_events_android: 0
      });
      expect(tt.device[pv.device]).toBe(1);
      expect(out.total.excluded.bot.uniques, 'a real browser, never a bot').toBe(0);
      expect(out.emails.map((e) => `${e.email} ${e.plan}`).sort()).toEqual(['monthly@example.com monthly', 'yearly@example.com yearly']);
    });
  });
}

/* ---------- a classic scroll bar: nothing behind the dim moves ---------- */

// Windows, and a Mac set to always show them, draw a classic scroll bar, which the sheet's scroll lock takes
// away. The page behind the dim keeps its width, so nothing in it moves sideways as the sheet opens or
// closes, and the dim still covers the whole window. Playwright hides scroll bars, so each run launches its
// own browser with them shown.
const SCROLL_BARS = [
  { width: 1440, height: 900, scroll: 0, button: '.top-btn[data-tap="reserve"]' },
  { width: 1440, height: 900, scroll: 1200, button: '.top-btn[data-tap="reserve"]' },
  { width: 800, height: 900, scroll: 0, button: '.cta [data-tap="reserve"]' }
];

for (const run of SCROLL_BARS) {
  test(`with a classic scroll bar at ${run.width}x${run.height}, scrolled ${run.scroll}, nothing behind the dim moves as the sheet opens and closes`, async ({ playwright, launchOptions, harness }) => {
    const browser = await playwright.chromium.launch({ ...launchOptions, ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      // a computer's context (the runner's own defaults are the iPhone's, whose scroll bars overlay the page)
      const context = await browser.newContext({ baseURL: harness.url, viewport: { width: run.width, height: run.height }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: COMPUTER_UAS.safari_mac });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const rest = async () => {
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      };
      await page.goto(TAGGED_QS);
      await rest();
      if (run.scroll) await page.evaluate((y) => window.scrollTo(0, y), run.scroll);
      await rest();
      expect(await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth), 'the window draws a classic scroll bar').toBeGreaterThan(0);
      const where = () => page.evaluate(() => ['.top', '.top-btn', 'h1', '.first-tile', '.lede h2', '.story-tile', '.cta'].map((sel) => {
        const el = document.querySelector(sel);
        if (!el.getClientRects().length) return `${sel} not shown`;
        const r = el.getBoundingClientRect();
        return `${sel} ${r.left.toFixed(1)}..${r.right.toFixed(1)} at ${r.top.toFixed(1)}`;
      }));
      const before = await where();
      await page.evaluate((sel) => document.querySelector(sel).click(), run.button);
      await sheetSettled(page);
      expect(await where(), 'nothing behind the dim moved').toEqual(before);
      const dim = await bbox(page.locator('.sheet-backdrop'));
      expect([dim.left, dim.right], 'the dim covers the whole window').toEqual([0, run.width]);
      await page.keyboard.press('Escape');
      await expect(page.locator('#sheet')).toBeHidden();
      expect(await where(), 'nor as it closed').toEqual(before);
      expect(errors, 'no uncaught exception in the page').toEqual([]);
    } finally {
      await browser.close();
    }
  });
}
