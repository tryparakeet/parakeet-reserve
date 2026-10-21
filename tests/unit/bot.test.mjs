// The bot rule: positive evidence only (navigator.webdriver, a 0x0 or 2000x2000 screen, Meta's
// "Instagram <digit>" label, or BOT_UA), and a bot visitor's whole row set lands in excluded.bot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../../netlify/functions/event.mjs';
import { BOT_UAS, REAL_UAS, DEFAULT_MOBILE_UA } from '../fixtures/user-agents.mjs';
import { vid, pageview, tap, email, seen, leave, video, run, SMOKE } from '../helpers/rows.mjs';

const { isBotPageview, BOT_UA, APP_LABEL_UA } = mod;
const T = '2026-10-24T10:00:00.000Z';
const pv = (o) => pageview(vid('bot-rule'), T, o);

test('every bot user agent is positive evidence', () => {
  for (const [name, ua] of Object.entries(BOT_UAS)) {
    assert.equal(isBotPageview(pv({ ua })), true, `${name} should be a bot`);
  }
});

test('BOT_UA catches every bot UA but the Instagram label, which APP_LABEL_UA catches', () => {
  for (const [name, ua] of Object.entries(BOT_UAS)) {
    if (name === 'instagram_label') {
      assert.equal(BOT_UA.test(ua), false);
      assert.equal(APP_LABEL_UA.test(ua), true);
    } else {
      assert.equal(BOT_UA.test(ua), true, `${name} should match BOT_UA`);
    }
  }
});

test('no real browser is a bot: TikTok, Instagram and Facebook in-app, Safari, Chrome with a real Build/ token', () => {
  for (const [name, ua] of Object.entries(REAL_UAS)) {
    assert.equal(isBotPageview(pv({ ua })), false, `${name} must not be a bot`);
    assert.equal(BOT_UA.test(ua), false, `${name} must not match BOT_UA`);
    assert.equal(APP_LABEL_UA.test(ua), false, `${name} must not match the label`);
  }
  assert.equal(isBotPageview(pv({ ua: '' })), false, 'no evidence is not evidence');
  assert.equal(isBotPageview(pv({ ua: DEFAULT_MOBILE_UA, wd: false, scr: '390x844' })), false);
});

test('webdriver and the two checker screen sizes are evidence; other screens are not', () => {
  assert.equal(isBotPageview(pv({ wd: true })), true);
  assert.equal(isBotPageview(pv({ wd: 'true' })), false, 'wd must be the boolean true');
  assert.equal(isBotPageview(pv({ scr: '0x0' })), true);
  assert.equal(isBotPageview(pv({ scr: '2000x2000' })), true);
  assert.equal(isBotPageview(pv({ scr: '2000x1000' })), false);
  assert.equal(isBotPageview(pv({ scr: '' })), false);
  assert.equal(isBotPageview({ event: 'pageview', vid: vid('x') }), false, 'missing evidence fields are not evidence');
});

test('the label rule is "Instagram" plus a digit at the very start', () => {
  assert.equal(isBotPageview(pv({ ua: 'Instagram 123.0.0.1 Android' })), true);
  assert.equal(isBotPageview(pv({ ua: 'Instagram' })), false);
  assert.equal(isBotPageview(pv({ ua: 'Instagram app' })), false);
  assert.equal(isBotPageview(pv({ ua: 'Mozilla/5.0 Instagram 123.0' })), false);
});

test('a bot vid takes its whole row set into excluded.bot; the row counts stay where they were stored', () => {
  const b = vid('bot-a');
  const real = vid('real-a');
  const rows = [
    pageview(b, T, { ua: BOT_UAS.headless_chrome, utm_content: 'fri23' }),
    tap(b, 'reserve', '2026-10-24T10:00:02.000Z', { utm_content: 'fri23' }),
    seen(b, '2026-10-24T10:00:03.000Z', { utm_content: 'fri23' }),
    tap(b, 'plan_yearly', '2026-10-24T10:00:05.000Z', { utm_content: 'fri23' }),
    email(b, '2026-10-24T10:00:09.000Z', { utm_content: 'fri23' }),
    video(b, 'playing', '2026-10-24T10:00:01.000Z', { utm_content: 'fri23' }),
    leave(b, 30, '2026-10-24T10:00:30.000Z', { utm_content: 'fri23' }),
    pageview(real, '2026-10-24T11:00:00.000Z', { utm_content: 'fri23' }),
    tap(real, 'reserve', '2026-10-24T11:00:02.000Z', { utm_content: 'fri23' })
  ];
  const { total } = run(mod, rows);
  const bot = total.excluded.bot;
  assert.equal(bot.uniques, 1);
  assert.equal(bot.reserve_taps, 1);
  assert.equal(bot.plan_taps, 1);
  assert.equal(bot.plan_yearly_taps, 1);
  assert.equal(bot.emails, 1);
  assert.equal(bot.seen, 1);
  assert.deepEqual(bot.video, { playing: 1, blocked: 0, both: 0 });
  assert.deepEqual(bot.leave, { n: 1, avg_seconds: 30 });
  assert.equal(bot.pageviews, 0, 'row counts do not move');
  assert.equal(bot.tap_events, 0);
  const tt = total.sources.tiktok;
  assert.equal(tt.uniques, 1, 'only the real visitor');
  assert.equal(tt.reserve_taps, 1);
  assert.equal(tt.plan_taps, 0);
  assert.equal(tt.emails, 0);
  assert.equal(tt.seen, 0);
  assert.deepEqual(tt.video, { playing: 0, blocked: 0, both: 0 });
  assert.deepEqual(tt.video_events, { playing: 1, blocked: 0 }, 'the bot row count stays');
  assert.equal(tt.pageviews, 2);
  assert.equal(tt.tap_events, 3);
  assert.equal(tt.content.fri23.uniques, 1);
  assert.equal(tt.content.fri23.plan_taps, 0);
  assert.equal(total.blended.uniques, 1);
  assert.equal(total.blended.plan_rate, 0);
});

test('bot beats smoke: a smoke visitor whose pageview carries bot evidence is a bot', () => {
  const v = vid('bot-smoke');
  const rows = [
    pageview(v, '2026-10-22T18:00:00.000Z', { tags: SMOKE, ua: BOT_UAS.bulid }),
    tap(v, 'reserve', '2026-10-22T18:00:02.000Z', { tags: SMOKE }),
    pageview(v, '2026-10-24T09:00:00.000Z', { utm_content: 'sat24' }),
    tap(v, 'plan_monthly', '2026-10-24T09:00:05.000Z', { utm_content: 'sat24' })
  ];
  const { total } = run(mod, rows);
  assert.equal(total.excluded.bot.uniques, 1);
  assert.equal(total.excluded.bot.plan_taps, 1);
  assert.equal(total.excluded.smoke.uniques, 0);
  assert.equal(total.sources.tiktok.uniques, 0);
});

test('bot evidence on one load is enough: a later clean load of the same vid is a bot too', () => {
  const v = vid('bot-later');
  const rows = [
    pageview(v, '2026-10-24T09:00:00.000Z', { utm_content: 'sat24', scr: '2000x2000' }),
    pageview(v, '2026-10-24T15:00:00.000Z', { utm_content: 'sat24' }),
    tap(v, 'reserve', '2026-10-24T15:00:02.000Z', { utm_content: 'sat24' })
  ];
  const { total, days } = run(mod, rows);
  assert.equal(total.excluded.bot.uniques, 1);
  assert.equal(total.sources.tiktok.uniques, 0);
  assert.equal(days[0].excluded.bot.uniques, 1);
});
