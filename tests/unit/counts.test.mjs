// The counts: uniques, the distinct tap counts and their splits, plan_rate rounding, leave stats, the
// per-visitor video rule, the zero-bucket shape and the BUTTONS / VID_SETS / COUNTERS invariant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../../netlify/functions/event.mjs';
import { vid, pageview, tap, email, seen, leave, video, run, ZERO_BUCKET } from '../helpers/rows.mjs';
import { EDGE_ROWS, EDGE_VIDS } from '../fixtures/rows.mjs';

const { BUTTONS, VID_SETS, COUNTERS, newBucket, newSummary, addRow, mergeSummary, finalizeBucket, finalizeDay } = mod;

const T = (s) => `2026-10-25T10:00:${String(s).padStart(2, '0')}.000Z`;
const C = { utm_content: 'sun25' };

test('every button has a vid set and a counter; the core sets exist', () => {
  for (const b of BUTTONS) {
    assert.ok(VID_SETS.includes(b), `VID_SETS lacks ${b}`);
    assert.ok(COUNTERS.includes(`n_tap_${b}`), `COUNTERS lacks n_tap_${b}`);
  }
  for (const set of ['pv', 'tap', 'email', 'seen', 'video_playing', 'video_blocked']) assert.ok(VID_SETS.includes(set), `VID_SETS lacks ${set}`);
  for (const n of ['n_pv', 'n_tap', 'n_email', 'n_video_playing', 'n_video_blocked']) assert.ok(COUNTERS.includes(n), `COUNTERS lacks ${n}`);
  const b = newBucket();
  for (const set of VID_SETS) assert.deepEqual(b[set], [], `${set} starts empty`);
  for (const n of COUNTERS) assert.equal(b[n], 0, `${n} starts at 0`);
  assert.deepEqual(b.bots, []);
  assert.deepEqual(b.content, {});
  assert.deepEqual(b.leave, {});
  assert.deepEqual(BUTTONS, new Set(['reserve', 'play', 'plan_yearly', 'plan_monthly']));
});

test('an empty bucket finalizes to the exact zero shape, in this key order', () => {
  const z = finalizeBucket(newBucket());
  assert.deepEqual(z, ZERO_BUCKET);
  assert.deepEqual(Object.keys(z), Object.keys(ZERO_BUCKET));
});

test('uniques are the distinct vids with a pageview, a tap or an email; seen, leave and video alone are not visitors', () => {
  const a = vid('u-a'), b = vid('u-b'), c = vid('u-c'), d = vid('u-d'), e = vid('u-e'), f = vid('u-f');
  const rows = [
    pageview(a, T(0), C), pageview(a, T(1), C),
    tap(b, 'reserve', T(2), C),
    email(c, T(3), C),
    seen(d, T(4), C),
    leave(e, 10, T(5), { ...C, video: 'blocked' }),
    video(f, 'playing', T(6), C)
  ];
  const { total } = run(mod, rows);
  const tt = total.sources.tiktok;
  assert.equal(tt.uniques, 3);
  assert.equal(tt.pageviews, 2);
  assert.equal(tt.seen, 1);
  assert.deepEqual(tt.leave, { n: 1, avg_seconds: 10 });
  assert.deepEqual(tt.video, { playing: 1, blocked: 1, both: 0 });
  assert.equal(total.blended.uniques, 3);
});

test('reserve, play and plan taps are distinct visitors; the event counters count rows', () => {
  const a = vid('t-a'), b = vid('t-b'), c = vid('t-c');
  const rows = [
    pageview(a, T(0), C), tap(a, 'reserve', T(1), C), tap(a, 'reserve', T(2), C), tap(a, 'reserve', T(3), C),
    tap(a, 'plan_yearly', T(4), C), tap(a, 'plan_monthly', T(5), C), tap(a, 'plan_yearly', T(6), C),
    pageview(b, T(10), C), tap(b, 'play', T(11), C), tap(b, 'play', T(12), C), tap(b, 'reserve', T(13), C),
    tap(b, 'plan_monthly', T(14), { ...C, via: 'hold' }),
    pageview(c, T(20), C)
  ];
  const { total } = run(mod, rows);
  const tt = total.sources.tiktok;
  assert.equal(tt.uniques, 3);
  assert.equal(tt.taps, 2);
  assert.equal(tt.reserve_taps, 2);
  assert.equal(tt.reserve_rate, 0.6667);
  assert.equal(tt.plan_taps, 2);
  assert.equal(tt.plan_yearly_taps, 1);
  assert.equal(tt.plan_monthly_taps, 2);
  assert.equal(tt.plan_rate, 0.6667);
  assert.equal(tt.play_taps, 1);
  assert.equal(tt.tap_events, 10);
  assert.equal(tt.tap_events_reserve, 4);
  assert.equal(tt.tap_events_play, 2);
  assert.equal(tt.tap_events_plan_yearly, 2);
  assert.equal(tt.tap_events_plan_monthly, 2);
  assert.deepEqual(tt.content.sun25.plan_taps, 2);
  assert.deepEqual(tt.content.sun25.tap_events, 10);
});

test('plan_rate and reserve_rate: 4 decimals, 0 when there are no uniques', () => {
  const rate = (n, u) => {
    const rows = [];
    for (let i = 0; i < u; i++) rows.push(pageview(vid(`r-${i}`), T(i), C));
    for (let i = 0; i < n; i++) rows.push(tap(vid(`r-${i}`), 'plan_yearly', T(30 + i), C));
    return run(mod, rows).total.sources.tiktok;
  };
  assert.equal(rate(1, 3).plan_rate, 0.3333);
  assert.equal(rate(2, 3).plan_rate, 0.6667);
  assert.equal(rate(1, 7).plan_rate, 0.1429);
  assert.equal(rate(3, 3).plan_rate, 1);
  assert.equal(rate(0, 3).plan_rate, 0);
  const b = newBucket();
  b.plan_yearly.push(vid('x'));
  b.video_playing.push(vid('x'));
  const f = finalizeBucket(b);
  assert.equal(f.uniques, 0);
  assert.equal(f.plan_taps, 1);
  assert.equal(f.plan_rate, 0, 'no division by zero');
  assert.equal(f.reserve_rate, 0);
});

test('leave: the max seconds per visitor, n and the rounded average', () => {
  const a = vid('l-a'), b = vid('l-b');
  const rows = [
    pageview(a, T(0), C), leave(a, 5, T(5), C), leave(a, 20, T(20), C), leave(a, 12, T(30), C),
    pageview(b, T(40), C), leave(b, 15, T(55), C)
  ];
  const { total } = run(mod, rows);
  assert.deepEqual(total.sources.tiktok.leave, { n: 2, avg_seconds: 18 }, '(20 + 15) / 2 = 17.5 -> 18');
  const one = run(mod, [pageview(a, T(0), C), leave(a, 9, T(9), C), leave(a, 9, T(19), C)]);
  assert.deepEqual(one.total.sources.tiktok.leave, { n: 1, avg_seconds: 9 });
});

test('leave rows in different hours keep the max across the hour summaries', () => {
  const a = vid('l-hours');
  const rows = [
    pageview(a, '2026-10-25T10:00:00.000Z', C),
    leave(a, 30, '2026-10-25T10:00:30.000Z', C),
    leave(a, 90, '2026-10-25T11:00:30.000Z', C),
    leave(a, 60, '2026-10-25T12:00:30.000Z', C)
  ];
  const { total, days } = run(mod, rows);
  assert.deepEqual(total.sources.tiktok.leave, { n: 1, avg_seconds: 90 });
  assert.deepEqual(days[0].sources.tiktok.content.sun25.leave, { n: 1, avg_seconds: 90 });
});

test('video per visitor: playing wins across loads and hours, both counts the overlap, video_events counts rows', () => {
  const a = vid('v-a'), b = vid('v-b'), c = vid('v-c'), d = vid('v-d');
  const rows = [
    // a: a standalone playing row in one hour, a blocked leave on a later load -> playing, both
    pageview(a, '2026-10-25T10:00:00.000Z', C), video(a, 'playing', '2026-10-25T10:00:02.000Z', C), leave(a, 20, '2026-10-25T10:00:20.000Z', C),
    pageview(a, '2026-10-25T14:00:00.000Z', C), leave(a, 5, '2026-10-25T14:00:05.000Z', { ...C, video: 'blocked' }),
    // b: blocked at leave on two loads -> blocked once, two rows
    pageview(b, '2026-10-25T10:10:00.000Z', C), leave(b, 8, '2026-10-25T10:10:08.000Z', { ...C, video: 'blocked' }),
    pageview(b, '2026-10-26T10:10:00.000Z', C), leave(b, 9, '2026-10-26T10:10:09.000Z', { ...C, video: 'blocked' }),
    // c: a blocked leave, then playing later in the same load (the summary resolves the pair)
    pageview(c, '2026-10-25T10:20:00.000Z', C), leave(c, 4, '2026-10-25T10:20:04.000Z', { ...C, video: 'blocked' }),
    video(c, 'playing', '2026-10-25T10:20:06.000Z', C), leave(c, 30, '2026-10-25T10:20:30.000Z', C),
    // d: playing on both loads
    pageview(d, '2026-10-25T10:30:00.000Z', C), video(d, 'playing', '2026-10-25T10:30:01.000Z', C),
    pageview(d, '2026-10-25T11:30:00.000Z', C), video(d, 'playing', '2026-10-25T11:30:01.000Z', C)
  ];
  const { total, days } = run(mod, rows);
  const tt = total.sources.tiktok;
  assert.deepEqual(tt.video, { playing: 3, blocked: 1, both: 2 });
  assert.deepEqual(tt.video_events, { playing: 4, blocked: 4 });
  assert.deepEqual(tt.content.sun25.video, { playing: 3, blocked: 1, both: 2 });
  assert.deepEqual(total.blended.video, { playing: 3, blocked: 1, both: 2 });
  // per day the second day only has b's second blocked load
  assert.equal(days.length, 2);
  assert.deepEqual(days[1].sources.tiktok.video, { playing: 0, blocked: 1, both: 0 });
  assert.deepEqual(days[1].sources.tiktok.video_events, { playing: 0, blocked: 1 });
});

test('the edge rows: a playing row on one load and a blocked leave on another is playing and both', () => {
  const rows = EDGE_ROWS.filter((r) => r.vid === EDGE_VIDS.bothVideo);
  const { total } = run(mod, rows);
  assert.deepEqual(total.sources.tiktok.video, { playing: 1, blocked: 0, both: 1 });
  assert.deepEqual(total.sources.tiktok.video_events, { playing: 1, blocked: 1 });
  assert.deepEqual(total.sources.tiktok.leave, { n: 1, avg_seconds: 31 });
});

test('a video state in a leave row is dropped from the counts when it is not a known state', () => {
  const a = vid('v-bad');
  const rows = [pageview(a, T(0), C), leave(a, 10, T(10), { ...C, video: 'paused' }), video(a, 'blocked', T(11), C)];
  const { total } = run(mod, rows);
  assert.deepEqual(total.sources.tiktok.video, { playing: 0, blocked: 1, both: 0 });
  assert.deepEqual(total.sources.tiktok.video_events, { playing: 0, blocked: 1 });
  assert.deepEqual(total.sources.tiktok.leave, { n: 1, avg_seconds: 10 });
});

test('device and inapp count pageview rows; seen is distinct visitors; emails distinct, email_events rows', () => {
  const a = vid('d-a'), b = vid('d-b');
  const rows = [
    pageview(a, T(0), { ...C, device: 'ios', inapp: 'tiktok' }),
    pageview(a, T(1), { ...C, device: 'ios', inapp: 'tiktok' }),
    pageview(b, T(2), { ...C, device: 'android', inapp: 'none' }),
    seen(a, T(3), C), seen(a, T(4), C), seen(b, T(5), C),
    email(a, T(6), C), email(a, T(7), C)
  ];
  const { total } = run(mod, rows);
  const tt = total.sources.tiktok;
  assert.deepEqual(tt.device, { ios: 2, android: 1, other: 0 });
  assert.deepEqual(tt.inapp, { tiktok: 2, instagram: 0, facebook: 0, none: 1 });
  assert.equal(tt.seen, 2);
  assert.equal(tt.emails, 1);
  assert.equal(tt.email_events, 2);
});

test('mergeSummary unions the vid sets across hours and adds the counters', () => {
  const a = vid('m-a');
  const h1 = newSummary('2026-10-25', '10');
  const h2 = newSummary('2026-10-25', '11');
  addRow(h1, pageview(a, '2026-10-25T10:00:00.000Z', C));
  addRow(h1, tap(a, 'plan_yearly', '2026-10-25T10:00:05.000Z', C));
  addRow(h2, pageview(a, '2026-10-25T11:00:00.000Z', C));
  addRow(h2, tap(a, 'plan_yearly', '2026-10-25T11:00:05.000Z', C));
  const day = newSummary('2026-10-25', '');
  mergeSummary(day, JSON.parse(JSON.stringify(h1)));
  mergeSummary(day, h2);
  assert.equal(day.rows, 4);
  const f = JSON.parse(JSON.stringify(finalizeDay(day, new Set())));
  assert.equal(f.sources.tiktok.uniques, 1);
  assert.equal(f.sources.tiktok.pageviews, 2);
  assert.equal(f.sources.tiktok.plan_taps, 1);
  assert.equal(f.sources.tiktok.tap_events_plan_yearly, 2);
  assert.equal(f.sources.tiktok.plan_rate, 1);
  assert.equal(f.rows, 4);
  assert.equal(f.day, '2026-10-25');
});

test('a tap row with an unknown button counts as a tap but joins no button list', () => {
  const a = vid('old-button');
  const s = newSummary('2026-10-25', '10');
  addRow(s, pageview(a, T(0), C));
  addRow(s, { ...tap(a, 'reserve', T(1), C), button: 'card' });
  const f = finalizeBucket(s.buckets['gate|tiktok']);
  assert.equal(f.taps, 1);
  assert.equal(f.tap_events, 1);
  assert.equal(f.reserve_taps, 0);
  assert.equal(f.plan_taps, 0);
  assert.equal(f.tap_events_reserve, 0);
});
