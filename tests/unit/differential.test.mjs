// The differential: the shared fixture through the frozen summary version 6 (tests/previous/summary-v6.mjs,
// the copied instrument before any count change) and the live version 7. Everything v6 counted must be
// unchanged; the v6 -> v7 mapping is explicit; the one intended divergence (the video state carried by
// leave rows, which v6 never saw) is documented by the second case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v7 from '../../netlify/functions/event.mjs';
import * as v6 from '../previous/summary-v6.mjs';
import { run } from '../helpers/rows.mjs';
import { ALL_ROWS } from '../fixtures/rows.mjs';

// v6 field -> v7 field, equal for every bucket
const SAME = ['uniques', 'taps', 'emails', 'pageviews', 'tap_events', 'email_events', 'seen', 'leave', 'device', 'inapp'];
// v6-only fields: Restline's events, always 0 on Parakeet rows
const GONE = ['answers', 'answer_events', 'tap_events_card', 'tap_events_bar'];

function compareBucket(b6, b7, path, { videoEvents }) {
  for (const k of SAME) assert.deepEqual(b7[k], b6[k], `${path}.${k}`);
  const tapRate = b7.uniques ? Number((b7.taps / b7.uniques).toFixed(4)) : 0;
  assert.equal(b6.tap_rate, tapRate, `${path}.tap_rate recomputed from v7`);
  for (const k of GONE) assert.equal(b6[k], 0, `${path}.${k}`);
  if (videoEvents) assert.deepEqual(b7.video_events, b6.video, `${path}: v6 video row counts = v7 video_events`);
  // v7-only fields exist and are consistent with what v6 counted
  assert.ok(b7.reserve_taps <= b7.taps, `${path}.reserve_taps`);
  assert.ok(b7.plan_taps <= b7.taps, `${path}.plan_taps`);
  assert.ok(b7.play_taps <= b7.taps, `${path}.play_taps`);
  assert.equal(b7.tap_events, b7.tap_events_reserve + b7.tap_events_play + b7.tap_events_plan_yearly + b7.tap_events_plan_monthly, `${path}: the button counters add up`);
}

function compareDay(d6, d7, path, opts) {
  assert.equal(d7.day, d6.day, `${path}.day`);
  assert.equal(d7.rows, d6.rows, `${path}.rows`);
  assert.deepEqual(Object.keys(d7.sources), Object.keys(d6.sources), `${path}.sources`);
  for (const s of Object.keys(d6.sources)) {
    compareBucket(d6.sources[s], d7.sources[s], `${path}.sources.${s}`, opts);
    assert.deepEqual(Object.keys(d7.sources[s].content), Object.keys(d6.sources[s].content), `${path}.sources.${s}.content`);
    for (const c of Object.keys(d6.sources[s].content)) compareBucket(d6.sources[s].content[c], d7.sources[s].content[c], `${path}.sources.${s}.content.${c}`, opts);
  }
  compareBucket(d6.blended, d7.blended, `${path}.blended`, opts);
  assert.deepEqual(Object.keys(d7.excluded), Object.keys(d6.excluded), `${path}.excluded`);
  for (const x of Object.keys(d6.excluded)) compareBucket(d6.excluded[x], d7.excluded[x], `${path}.excluded.${x}`, opts);
}

function compare(out6, out7, opts) {
  assert.equal(out7.days.length, out6.days.length);
  for (let i = 0; i < out6.days.length; i++) compareDay(out6.days[i], out7.days[i], `days[${i}]`, opts);
  compareDay(out6.total, out7.total, 'total', opts);
  assert.deepEqual(out7.prestart, out6.prestart, 'pre');
}

const withoutLeaveVideo = ALL_ROWS.map((r) => {
  if (r.event !== 'leave' || r.video === undefined) return r;
  const { video, ...rest } = r;
  return rest;
});

test('the baseline is what it says it is', () => {
  assert.equal(v6.SUMMARY_VERSION, 6);
  assert.equal(v7.SUMMARY_VERSION, 7);
  assert.equal(v6.GATE_START, v7.GATE_START);
  assert.equal(String(v6.BOT_UA), String(v7.BOT_UA));
  assert.equal(String(v6.APP_LABEL_UA), String(v7.APP_LABEL_UA));
  assert.ok(ALL_ROWS.length >= 400, `fixture has ${ALL_ROWS.length} rows`);
  assert.ok(ALL_ROWS.some((r) => r.event === 'leave' && r.video !== undefined), 'the fixture carries leave-video rows');
  assert.ok(ALL_ROWS.some((r) => r.event === 'video'), 'the fixture carries standalone video rows');
  assert.ok(ALL_ROWS.every((r) => v7.EVENTS.has(r.event)), 'only live events');
});

test('without leave-carried video states v7 equals v6 on everything v6 counted, by the explicit mapping', () => {
  const out6 = run(v6, withoutLeaveVideo);
  const out7 = run(v7, withoutLeaveVideo);
  assert.ok(out7.days.length >= 8);
  assert.ok(out7.prestart.length >= 3, 'pre-start visitors are in the fixture');
  compare(out6, out7, { videoEvents: true });
  // and under day params
  const d6 = run(v6, withoutLeaveVideo, { from: '2026-10-24', to: '2026-10-26' });
  const d7 = run(v7, withoutLeaveVideo, { from: '2026-10-24', to: '2026-10-26' });
  assert.equal(d7.days.length, 3);
  compare(d6, d7, { videoEvents: true });
});

test('the one intended divergence: a leave row with a video state is a video event in v7 and nothing in v6', () => {
  const out6 = run(v6, ALL_ROWS);
  const out7 = run(v7, ALL_ROWS);
  compare(out6, out7, { videoEvents: false });
  // per stored flag: the row counters never move at read, so the delta is the leave-video rows by flag
  const count = (flag, state) => ALL_ROWS.filter((r) => r.event === 'leave' && r.video === state && r.flag === flag).length;
  const delta = (b6, b7) => ({ playing: b7.video_events.playing - b6.video.playing, blocked: b7.video_events.blocked - b6.video.blocked });
  assert.deepEqual(delta(out6.total.blended, out7.total.blended), { playing: count('gate', 'playing'), blocked: count('gate', 'blocked') });
  assert.deepEqual(delta(out6.total.excluded.smoke, out7.total.excluded.smoke), { playing: count('smoke', 'playing'), blocked: count('smoke', 'blocked') });
  assert.deepEqual(delta(out6.total.excluded.no_utm, out7.total.excluded.no_utm), { playing: count('no_utm', 'playing'), blocked: count('no_utm', 'blocked') });
  assert.ok(count('gate', 'blocked') > 0, 'the divergence is exercised');
  for (const x of ['bot', 'prestart']) {
    assert.deepEqual(out7.total.excluded[x].video_events, { playing: 0, blocked: 0 }, `${x}: counters stay where the rows were stored`);
    assert.deepEqual(out6.total.excluded[x].video, { playing: 0, blocked: 0 });
  }
  // per source the same holds (every tiktok/typed row is a gate row)
  for (const s of Object.keys(out6.total.sources)) {
    const rows = ALL_ROWS.filter((r) => r.flag === 'gate' && r.utm_source === s && r.event === 'leave');
    assert.deepEqual(delta(out6.total.sources[s], out7.total.sources[s]), {
      playing: rows.filter((r) => r.video === 'playing').length,
      blocked: rows.filter((r) => r.video === 'blocked').length
    }, s);
  }
  // the per-visitor video reading exists only in v7 and never exceeds the row reading
  const b7 = out7.total.blended;
  assert.ok(b7.video.playing + b7.video.blocked + b7.video.both <= b7.video_events.playing + b7.video_events.blocked);
  assert.ok(b7.video.both > 0, 'the fixture has a visitor with a playing load and a blocked load');
});
