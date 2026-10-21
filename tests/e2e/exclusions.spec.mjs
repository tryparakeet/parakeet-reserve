// What stays out of the gate counts, driven through the browser: smoke (and a tagged visit from the same
// cookie staying smoke), bots from the shared fixture (user agents, navigator.webdriver, a 2000x2000
// screen) with the real Instagram in-app browser not a bot, prestart visits with the clock before
// GATE_START (same day, cross-day after advance(4 d), the boundary minute), and the closed-hour cache.

import { test, expect, TAGGED_QS, SMOKE_QS, waitForRows, rowsOf, HOUR, MINUTE, DAY, GATE_START_ISO } from './fixtures.mjs';
import { BOT_UAS, REAL_UAS } from '../fixtures/user-agents.mjs';

const GATE_START = Date.parse(GATE_START_ISO);

test.describe('smoke', () => {
  test('a smoke visit is excluded.smoke, and a tagged visit from the same cookie stays smoke', async ({ page, harness }) => {
    const { blobs } = harness;
    await page.goto(SMOKE_QS);
    const [pv] = await waitForRows(blobs, { event: 'pageview' });
    expect(pv.flag).toBe('smoke');
    expect(pv.utm_source).toBe('own');
    let out = await harness.admin();
    expect(out.total.excluded.smoke.uniques).toBe(1);
    expect(out.total.blended.uniques).toBe(0);
    expect(out.total.sources.own).toBeUndefined();

    await page.goto(TAGGED_QS);
    await waitForRows(blobs, { event: 'pageview' }, { count: 2 });
    const [tagged] = rowsOf(blobs, { event: 'pageview', utm_source: 'tiktok' });
    expect(tagged.vid).toBe(pv.vid);
    expect(tagged.flag, 'stored as gate; the visitor is resolved to smoke at read').toBe('gate');
    await page.locator('[data-tap="reserve"]').click();
    await waitForRows(blobs, { event: 'tap', button: 'reserve' });
    out = await harness.admin();
    expect(out.total.excluded.smoke.uniques).toBe(1);
    expect(out.total.excluded.smoke.reserve_taps).toBe(1);
    expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
    expect((out.total.sources.tiktok && out.total.sources.tiktok.plan_taps) || 0).toBe(0);
    expect(out.total.blended.uniques).toBe(0);
  });
});

test.describe('bots', () => {
  for (const [name, ua] of Object.entries(BOT_UAS)) {
    test.describe(`user agent: ${name}`, () => {
      test.use({ userAgent: ua });
      test(`a visit with the ${name} user agent is excluded.bot`, async ({ page, harness }) => {
        const { blobs } = harness;
        await page.goto(TAGGED_QS);
        const [pv] = await waitForRows(blobs, { event: 'pageview' });
        expect(pv.ua).toBe(ua.slice(0, 400));
        expect(pv.flag).toBe('gate');
        const out = await harness.admin();
        // per-visitor lists move to the bot bucket; per-row counters (pageviews) stay where the rows were stored
        expect(out.total.excluded.bot.uniques).toBe(1);
        expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
        expect(out.total.blended.uniques).toBe(0);
      });
    });
  }

  test('navigator.webdriver true is excluded.bot (with every row of the visitor)', async ({ page, harness }) => {
    const { blobs } = harness;
    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true }); });
    await page.goto(TAGGED_QS);
    const [pv] = await waitForRows(blobs, { event: 'pageview' });
    expect(pv.wd).toBe(true);
    await page.locator('[data-tap="reserve"]').click();
    await waitForRows(blobs, { event: 'tap', button: 'reserve' });
    const out = await harness.admin();
    expect(out.total.excluded.bot.uniques).toBe(1);
    expect(out.total.excluded.bot.reserve_taps).toBe(1);
    expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
    expect((out.total.sources.tiktok && out.total.sources.tiktok.reserve_taps) || 0).toBe(0);
  });

  test.describe('screen 2000x2000', () => {
    // `screen` is a BrowserContext option, not a test option: it goes through contextOptions
    test.use({ contextOptions: { screen: { width: 2000, height: 2000 } } });
    test('a 2000x2000 screen is excluded.bot', async ({ page, harness }) => {
      const { blobs } = harness;
      await page.goto(TAGGED_QS);
      const [pv] = await waitForRows(blobs, { event: 'pageview' });
      expect(pv.scr).toBe('2000x2000');
      expect(pv.wd).toBe(false);
      const out = await harness.admin();
      expect(out.total.excluded.bot.uniques).toBe(1);
      expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
    });
  });

  test.describe('the real Instagram in-app browser', () => {
    test.use({ userAgent: REAL_UAS.instagram_ios });
    test('is not a bot: counted under sources.tiktok with inapp instagram', async ({ page, harness }) => {
      const { blobs } = harness;
      await page.goto(TAGGED_QS);
      const [pv] = await waitForRows(blobs, { event: 'pageview' });
      expect(pv.wd).toBe(false);
      expect(pv.inapp).toBe('instagram');
      expect(pv.device).toBe('ios');
      const out = await harness.admin();
      expect(out.total.excluded.bot.uniques).toBe(0);
      expect(out.total.sources.tiktok.uniques).toBe(1);
      expect(out.total.sources.tiktok.inapp.instagram).toBe(1);
    });
  });

  test.describe('the real TikTok in-app browser', () => {
    test.use({ userAgent: REAL_UAS.tiktok_ios });
    test('is not a bot: counted under sources.tiktok with inapp tiktok', async ({ page, harness }) => {
      const { blobs } = harness;
      await page.goto(TAGGED_QS);
      const [pv] = await waitForRows(blobs, { event: 'pageview' });
      expect(pv.inapp).toBe('tiktok');
      const out = await harness.admin();
      expect(out.total.excluded.bot.uniques).toBe(0);
      expect(out.total.sources.tiktok.uniques).toBe(1);
      expect(out.total.sources.tiktok.inapp.tiktok).toBe(1);
    });
  });
});

test.describe('prestart', () => {
  test.describe('with the clock at today', () => {
    test.use({ harnessOptions: { now: '2026-10-21T12:00:00.000Z' } });

    test('a tagged visit before GATE_START is excluded.prestart, and stays so cross-day after advance(4 d)', async ({ page, harness }) => {
      const { blobs, clock } = harness;
      await page.goto(TAGGED_QS);
      const [pv] = await waitForRows(blobs, { event: 'pageview' });
      expect(pv.received).toBe('2026-10-21T12:00:00.000Z');
      expect(pv.flag).toBe('gate');
      let out = await harness.admin();
      expect(out.total.excluded.prestart.uniques).toBe(1);
      expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
      expect(out.total.blended.uniques).toBe(0);

      clock.advance(4 * DAY);
      await page.goto(TAGGED_QS);
      const pvs = await waitForRows(blobs, { event: 'pageview' }, { count: 2 });
      expect(pvs[1].vid).toBe(pv.vid);
      expect(pvs[1].received, 'sorted by received: the later visit').toBe('2026-10-25T12:00:00.000Z');
      await page.locator('[data-tap="reserve"]').click();
      await waitForRows(blobs, { event: 'tap', button: 'reserve' });

      out = await harness.admin();
      expect(out.days.map((d) => d.day)).toEqual(['2026-10-21', '2026-10-25']);
      expect(out.total.excluded.prestart.uniques).toBe(1);
      expect(out.total.excluded.prestart.reserve_taps).toBe(1);
      expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
      expect((out.total.sources.tiktok && out.total.sources.tiktok.reserve_taps) || 0).toBe(0);
      expect(out.total.blended.uniques).toBe(0);

      // the same with day params: the prestart ids come from every earlier day
      out = await harness.admin({ day: '2026-10-25' });
      expect(out.days.map((d) => d.day)).toEqual(['2026-10-25']);
      expect(out.total.excluded.prestart.uniques).toBe(1);
      expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
    });
  });

  test.describe('one minute before the start', () => {
    test.use({ harnessOptions: { now: '2026-10-23T04:59:00.000Z' } });
    test('a visit at 04:59:00Z is prestart', async ({ page, harness }) => {
      await page.goto(TAGGED_QS);
      const [pv] = await waitForRows(harness.blobs, { event: 'pageview' });
      expect(Date.parse(pv.received)).toBeLessThan(GATE_START);
      const out = await harness.admin();
      expect(out.total.excluded.prestart.uniques).toBe(1);
      expect((out.total.sources.tiktok && out.total.sources.tiktok.uniques) || 0).toBe(0);
    });
  });

  test.describe('at the exact instant', () => {
    test.use({ harnessOptions: { now: GATE_START_ISO } });
    test('a visit at 05:00:00.000Z is gate', async ({ page, harness }) => {
      await page.goto(TAGGED_QS);
      const [pv] = await waitForRows(harness.blobs, { event: 'pageview' });
      expect(pv.received).toBe(GATE_START_ISO);
      const out = await harness.admin();
      expect(out.total.excluded.prestart.uniques).toBe(0);
      expect(out.total.sources.tiktok.uniques).toBe(1);
      expect(out.total.blended.uniques).toBe(1);
    });
  });
});

test.describe('closed-hour cache', () => {
  test('after advance(2 h 5 min) the hour is cached with v and gs, and an injected row does not change it', async ({ page, harness }) => {
    const { blobs, clock } = harness;
    await page.goto(TAGGED_QS);
    const [pv] = await waitForRows(blobs, { event: 'pageview' });
    await page.locator('[data-tap="reserve"]').click();
    await waitForRows(blobs, { event: 'tap', button: 'reserve' });
    expect(Object.keys(blobs.dump('summaries'))).toEqual([]);

    let out = await harness.admin();
    expect(Object.keys(blobs.dump('summaries')), 'the open hour is never cached').toEqual([]);
    expect(out.total.sources.tiktok.uniques).toBe(1);

    clock.advance(2 * HOUR + 5 * MINUTE);
    out = await harness.admin();
    expect(out.generated).toBe('2026-10-25T14:05:00.000Z');
    const cached = blobs.dump('summaries');
    expect(Object.keys(cached)).toEqual(['2026-10-25/12']);
    expect(cached['2026-10-25/12'].v).toBe(7);
    expect(cached['2026-10-25/12'].gs).toBe(GATE_START);
    expect(cached['2026-10-25/12'].rows).toBe(blobs.rows('events').length);
    expect(out.total.sources.tiktok.uniques).toBe(1);
    expect(out.total.sources.tiktok.reserve_taps).toBe(1);

    // a row written straight into the cached hour is not read again
    const extra = { ...pv, vid: 'zzzzzzzzzzzzzzzzzzzzzzzz', received: '2026-10-25T12:30:00.000Z', ts: '2026-10-25T12:30:00.000Z' };
    await blobs.getStore({ name: 'events' }).setJSON(`2026-10-25/12/${Date.parse(extra.received)}-deadbeef-pageview`, extra);
    const logStart = blobs.log.length;
    out = await harness.admin();
    expect(out.total.sources.tiktok.uniques, 'the cached hour is served as cached').toBe(1);
    expect(out.total.sources.tiktok.pageviews).toBe(1);
    const reads = blobs.log.slice(logStart).filter((l) => l.store === 'events' && l.op === 'get' && l.key.startsWith('2026-10-25/12/') && !l.key.endsWith('-email'));
    expect(reads, 'no events.get for the cached hour').toEqual([]);
    expect(blobs.dump('summaries')['2026-10-25/12'].rows).toBe(cached['2026-10-25/12'].rows);
  });
});
