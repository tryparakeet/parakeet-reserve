// Per-visitor resolution at read: bot > smoke > prestart > gate > no_utm, through run() (the admin's
// pipeline over rows with the pure functions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../../netlify/functions/event.mjs';
import { vid, pageview, tap, email, seen, leave, video, run, TIKTOK, TYPED, SMOKE, NO_UTM } from '../helpers/rows.mjs';
import { EDGE_ROWS, EDGE_VIDS } from '../fixtures/rows.mjs';

const { GATE_START } = mod;

test('a smoke pageview pulls the vid out of a gate bucket and its creative; row counts stay', () => {
  const v = vid('smoke-gate');
  const rows = [
    pageview(v, '2026-10-22T18:00:00.000Z', { tags: SMOKE }),
    pageview(v, '2026-10-24T09:00:00.000Z', { utm_content: 'sat24' }),
    tap(v, 'reserve', '2026-10-24T09:00:02.000Z', { utm_content: 'sat24' }),
    tap(v, 'plan_yearly', '2026-10-24T09:00:05.000Z', { utm_content: 'sat24' }),
    seen(v, '2026-10-24T09:00:03.000Z', { utm_content: 'sat24' }),
    email(v, '2026-10-24T09:00:09.000Z', { utm_content: 'sat24' })
  ];
  const { total } = run(mod, rows);
  const tt = total.sources.tiktok;
  assert.equal(tt.uniques, 0);
  assert.equal(tt.reserve_taps, 0);
  assert.equal(tt.plan_taps, 0);
  assert.equal(tt.seen, 0);
  assert.equal(tt.emails, 0);
  assert.equal(tt.pageviews, 1, 'the row count stays');
  assert.equal(tt.tap_events, 2);
  assert.equal(tt.content.sat24.uniques, 0);
  assert.equal(tt.content.sat24.plan_taps, 0);
  assert.equal(tt.content.sat24.pageviews, 1);
  const smoke = total.excluded.smoke;
  assert.equal(smoke.uniques, 1);
  assert.equal(smoke.reserve_taps, 1);
  assert.equal(smoke.plan_taps, 1);
  assert.equal(smoke.seen, 1);
  assert.equal(smoke.emails, 1);
  assert.equal(total.blended.uniques, 0);
});

test('a gate pageview before GATE_START makes the vid prestart for good, with and without day params', () => {
  const v = vid('pre-1');
  const other = vid('gate-1');
  const rows = [
    pageview(v, '2026-10-22T21:00:00.000Z', { utm_content: 'fri23' }),
    pageview(v, '2026-10-24T10:00:00.000Z', { utm_content: 'fri23' }),
    tap(v, 'reserve', '2026-10-24T10:00:02.000Z', { utm_content: 'fri23' }),
    tap(v, 'plan_yearly', '2026-10-24T10:00:05.000Z', { utm_content: 'fri23' }),
    pageview(other, '2026-10-24T10:30:00.000Z', { utm_content: 'fri23' })
  ];
  const all = run(mod, rows);
  assert.deepEqual(all.prestart, [v]);
  assert.equal(all.total.sources.tiktok.uniques, 1);
  assert.equal(all.total.sources.tiktok.plan_taps, 0);
  assert.equal(all.total.excluded.prestart.uniques, 1);
  assert.equal(all.total.excluded.prestart.plan_taps, 1);
  assert.equal(all.total.excluded.prestart.reserve_taps, 1);
  assert.equal(all.total.sources.tiktok.content.fri23.uniques, 1);
  // only Oct 24 requested: the Oct 22 pageview still excludes the vid
  const day = run(mod, rows, { from: '2026-10-24', to: '2026-10-24' });
  assert.equal(day.days.length, 1);
  assert.equal(day.days[0].day, '2026-10-24');
  assert.equal(day.total.sources.tiktok.uniques, 1);
  assert.equal(day.total.excluded.prestart.uniques, 1);
  assert.equal(day.total.excluded.prestart.plan_taps, 1);
  assert.equal(day.days[0].sources.tiktok.pageviews, 2, 'the Oct 24 rows are counted on Oct 24');
});

test('GATE_START boundary: received at the instant is gate, 1 ms before is prestart', () => {
  const rows = EDGE_ROWS.filter((r) => r.vid === EDGE_VIDS.boundaryGate || r.vid === EDGE_VIDS.boundaryPre);
  const { total, prestart } = run(mod, rows);
  assert.deepEqual(prestart, [EDGE_VIDS.boundaryPre]);
  assert.equal(total.sources.tiktok.uniques, 1);
  assert.equal(total.sources.tiktok.reserve_taps, 1);
  assert.equal(total.excluded.prestart.uniques, 1);
  assert.equal(total.excluded.prestart.reserve_taps, 1);
  assert.equal(Date.parse(rows.find((r) => r.vid === EDGE_VIDS.boundaryGate && r.event === 'pageview').received), GATE_START);
  assert.equal(Date.parse(rows.find((r) => r.vid === EDGE_VIDS.boundaryPre && r.event === 'pageview').received), GATE_START - 1);
});

test('no_utm rows of a gate visitor join the source and the creative of the gate pageview', () => {
  const v = vid('join-1');
  const rows = [
    pageview(v, '2026-10-24T10:00:00.000Z', { utm_content: 'sat24' }),
    pageview(v, '2026-10-25T10:00:00.000Z', { tags: NO_UTM }),
    tap(v, 'reserve', '2026-10-25T10:00:02.000Z', { tags: NO_UTM }),
    tap(v, 'plan_monthly', '2026-10-25T10:00:05.000Z', { tags: NO_UTM }),
    leave(v, 25, '2026-10-25T10:00:25.000Z', { tags: NO_UTM, video: 'blocked' })
  ];
  const { total } = run(mod, rows);
  const tt = total.sources.tiktok;
  assert.equal(tt.uniques, 1);
  assert.equal(tt.reserve_taps, 1);
  assert.equal(tt.plan_taps, 1);
  assert.equal(tt.plan_monthly_taps, 1);
  assert.equal(tt.plan_rate, 1);
  assert.deepEqual(tt.leave, { n: 1, avg_seconds: 25 });
  assert.deepEqual(tt.video, { playing: 0, blocked: 1, both: 0 });
  assert.equal(tt.content.sat24.plan_taps, 1);
  assert.equal(tt.content.sat24.plan_monthly_taps, 1);
  assert.deepEqual(tt.content.sat24.leave, { n: 1, avg_seconds: 25 });
  assert.equal(tt.pageviews, 1, 'the untagged pageview row stays in no_utm');
  assert.equal(tt.tap_events, 0, 'the tap rows stay in no_utm');
  const no = total.excluded.no_utm;
  assert.equal(no.uniques, 0);
  assert.equal(no.plan_taps, 0);
  assert.equal(no.pageviews, 1);
  assert.equal(no.tap_events, 2);
  assert.deepEqual(no.leave, { n: 0, avg_seconds: 0 });
});

test('with gate pageviews on two creatives the untagged rows join the first creative alphabetically', () => {
  const rows = EDGE_ROWS.filter((r) => r.vid === EDGE_VIDS.joinsCreative);
  const { total } = run(mod, rows);
  const tt = total.sources.tiktok;
  assert.equal(tt.uniques, 1);
  assert.equal(tt.plan_taps, 1);
  assert.equal(tt.content.fri30.plan_taps, 1, 'fri30 < mon26');
  assert.equal(tt.content.fri30.reserve_taps, 1);
  assert.equal(tt.content.mon26.plan_taps, 0);
  assert.equal(tt.content.mon26.uniques, 1, 'the vid stays in every creative it viewed');
  assert.equal(tt.content.fri30.uniques, 1);
});

test('a no_utm visitor with no gate pageview stays in excluded.no_utm', () => {
  const v = vid('homeless');
  const rows = [
    pageview(v, '2026-10-25T10:00:00.000Z', { tags: NO_UTM }),
    tap(v, 'reserve', '2026-10-25T10:00:02.000Z', { tags: NO_UTM }),
    tap(v, 'plan_yearly', '2026-10-25T10:00:05.000Z', { tags: NO_UTM })
  ];
  const { total } = run(mod, rows);
  assert.deepEqual(Object.keys(total.sources), []);
  assert.equal(total.excluded.no_utm.uniques, 1);
  assert.equal(total.excluded.no_utm.plan_taps, 1);
  assert.equal(total.blended.uniques, 0);
});

test('a vid with pageviews in two gate sources stays in both and is blended once', () => {
  const rows = EDGE_ROWS.filter((r) => r.vid === EDGE_VIDS.twoSources);
  const { total } = run(mod, rows);
  assert.equal(total.sources.tiktok.uniques, 1);
  assert.equal(total.sources.typed.uniques, 1);
  assert.equal(total.sources.typed.reserve_taps, 1);
  assert.equal(total.sources.tiktok.reserve_taps, 0, 'the tap was stored under typed');
  assert.equal(total.blended.uniques, 1);
  assert.equal(total.blended.reserve_taps, 1);
  assert.equal(total.blended.pageviews, 2);
});

test('the leave map moves with the max: the larger seconds wins whichever bucket held it', () => {
  const a = vid('leave-a');
  const b = vid('leave-b');
  const rows = [
    pageview(a, '2026-10-22T18:00:00.000Z', { tags: SMOKE }),
    leave(a, 30, '2026-10-22T18:00:30.000Z', { tags: SMOKE }),
    pageview(a, '2026-10-24T09:00:00.000Z', { utm_content: 'sat24' }),
    leave(a, 10, '2026-10-24T09:00:10.000Z', { utm_content: 'sat24' }),
    pageview(b, '2026-10-22T19:00:00.000Z', { tags: SMOKE }),
    leave(b, 5, '2026-10-22T19:00:05.000Z', { tags: SMOKE }),
    pageview(b, '2026-10-24T10:00:00.000Z', { utm_content: 'sat24' }),
    leave(b, 40, '2026-10-24T10:00:40.000Z', { utm_content: 'sat24' })
  ];
  const { total } = run(mod, rows);
  assert.deepEqual(total.excluded.smoke.leave, { n: 2, avg_seconds: 35 });
  assert.deepEqual(total.sources.tiktok.leave, { n: 0, avg_seconds: 0 });
  assert.deepEqual(total.sources.tiktok.content.sat24.leave, { n: 0, avg_seconds: 0 });
});

test('the video lists move with the visitor; the video row counts stay', () => {
  const v = vid('video-move');
  const rows = [
    pageview(v, '2026-10-24T09:00:00.000Z', { utm_content: 'sat24' }),
    video(v, 'playing', '2026-10-24T09:00:01.000Z', { utm_content: 'sat24' }),
    leave(v, 20, '2026-10-24T09:00:20.000Z', { utm_content: 'sat24' }),
    pageview(v, '2026-10-26T18:00:00.000Z', { tags: SMOKE }),
    leave(v, 8, '2026-10-26T18:00:08.000Z', { tags: SMOKE, video: 'blocked' })
  ];
  const { total } = run(mod, rows);
  assert.deepEqual(total.excluded.smoke.video, { playing: 1, blocked: 0, both: 1 });
  assert.deepEqual(total.excluded.smoke.video_events, { playing: 0, blocked: 1 });
  assert.deepEqual(total.sources.tiktok.video, { playing: 0, blocked: 0, both: 0 });
  assert.deepEqual(total.sources.tiktok.video_events, { playing: 1, blocked: 0 });
  assert.deepEqual(total.sources.tiktok.content.sat24.video, { playing: 0, blocked: 0, both: 0 });
});

test('smoke beats prestart: a pre-start visitor with a smoke pageview is smoke', () => {
  const v = vid('smoke-pre');
  const rows = [
    pageview(v, '2026-10-22T20:00:00.000Z', { utm_content: 'fri23' }),
    pageview(v, '2026-10-22T21:00:00.000Z', { tags: SMOKE }),
    tap(v, 'reserve', '2026-10-24T09:00:02.000Z', { utm_content: 'fri23' })
  ];
  const { total, prestart } = run(mod, rows);
  assert.deepEqual(prestart, [v], 'the pre list still names it');
  assert.equal(total.excluded.smoke.uniques, 1);
  assert.equal(total.excluded.smoke.reserve_taps, 1);
  assert.equal(total.excluded.prestart.uniques, 0);
  assert.equal(total.sources.tiktok.uniques, 0);
});

test('a smoke pageview after the paid visit still pulls the visitor (the hand-written edge row set)', () => {
  const rows = EDGE_ROWS.filter((r) => r.vid === EDGE_VIDS.smokeAndGate);
  const { total } = run(mod, rows);
  assert.equal(total.excluded.smoke.uniques, 1);
  assert.equal(total.excluded.smoke.plan_taps, 1);
  assert.deepEqual(total.excluded.smoke.leave, { n: 1, avg_seconds: 44 });
  assert.equal(total.sources.tiktok.uniques, 0);
  assert.equal(total.sources.tiktok.content.sun25.uniques, 0);
});

test('gate buckets keep each other\'s vids: typed never pulls from tiktok', () => {
  const v = vid('two-gate');
  const rows = [
    pageview(v, '2026-10-24T10:00:00.000Z', { tags: TIKTOK, utm_content: 'sat24' }),
    tap(v, 'reserve', '2026-10-24T10:00:02.000Z', { tags: TIKTOK, utm_content: 'sat24' }),
    pageview(v, '2026-10-25T10:00:00.000Z', { tags: TYPED }),
    tap(v, 'plan_yearly', '2026-10-25T10:00:05.000Z', { tags: TYPED })
  ];
  const { total } = run(mod, rows);
  assert.equal(total.sources.tiktok.reserve_taps, 1);
  assert.equal(total.sources.tiktok.plan_taps, 0);
  assert.equal(total.sources.typed.plan_taps, 1);
  assert.equal(total.sources.typed.reserve_taps, 0);
  assert.equal(total.blended.plan_taps, 1);
  assert.equal(total.blended.reserve_taps, 1);
  assert.equal(total.blended.uniques, 1);
});
