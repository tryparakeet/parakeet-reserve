// The differential: the shared fixture through the frozen summary version 6 (tests/previous/summary-v6.mjs,
// the copied instrument before any count change) and the live version 8. Everything v6 counted must be
// unchanged; the v6 -> v8 mapping is explicit; the one intended divergence (the video state carried by
// leave rows, which v6 never saw) is documented by the second case. The shared fixture holds no Android
// rows (the function refused the android tap and plan until version 8), so the Android fields are 0 there.
// The third case adds the Android rows: they show only in v8's new fields, and the one v6 field they move
// is the email count, which v8 keeps to the reservations (SITE-04 §6.8) with the Android emails beside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v8 from '../../netlify/functions/event.mjs';
import * as v6 from '../previous/summary-v6.mjs';
import { run } from '../helpers/rows.mjs';
import { ALL_ROWS, ANDROID_ROWS } from '../fixtures/rows.mjs';

// v6 field -> v8 field, equal for every bucket
const SAME = ['uniques', 'taps', 'emails', 'pageviews', 'tap_events', 'email_events', 'seen', 'leave', 'device', 'inapp'];
// v6-only fields: Restline's events, always 0 on Parakeet rows
const GONE = ['answers', 'answer_events', 'tap_events_card', 'tap_events_bar'];
// v8's Android fields: 0 without Android rows
const ANDROID = ['android_taps', 'tap_events_android', 'android_emails', 'email_events_android'];
// v6 counted every email; v8's emails and email_events are the reservations, the Android ones apart
const EMAILS = ['emails', 'email_events'];

function compareBucket(b6, b8, path, { videoEvents, android = false }) {
  for (const k of SAME) if (!(android && EMAILS.includes(k))) assert.deepEqual(b8[k], b6[k], `${path}.${k}`);
  const tapRate = b8.uniques ? Number((b8.taps / b8.uniques).toFixed(4)) : 0;
  assert.equal(b6.tap_rate, tapRate, `${path}.tap_rate recomputed from v8`);
  for (const k of GONE) assert.equal(b6[k], 0, `${path}.${k}`);
  if (videoEvents) assert.deepEqual(b8.video_events, b6.video, `${path}: v6 video row counts = v8 video_events`);
  // v8-only fields exist and are consistent with what v6 counted
  assert.ok(b8.reserve_taps <= b8.taps, `${path}.reserve_taps`);
  assert.ok(b8.plan_taps <= b8.taps, `${path}.plan_taps`);
  assert.ok(b8.play_taps <= b8.taps, `${path}.play_taps`);
  assert.ok(b8.android_taps <= b8.taps, `${path}.android_taps`);
  assert.equal(b8.tap_events, b8.tap_events_reserve + b8.tap_events_android + b8.tap_events_play + b8.tap_events_plan_yearly + b8.tap_events_plan_monthly, `${path}: the button counters add up`);
  if (android) {
    // the explicit mapping: v6's email rows are v8's reservation rows plus its Android rows; the same for
    // visitors, as no visitor in the fixture leaves both kinds of address
    assert.equal(b8.email_events + b8.email_events_android, b6.email_events, `${path}: email rows`);
    assert.equal(b8.emails + b8.android_emails, b6.emails, `${path}: email visitors`);
  } else {
    for (const k of ANDROID) assert.equal(b8[k], 0, `${path}.${k}: no Android rows`);
  }
}

// Every bucket of a finalized day by its path: the sources, their creatives, blended and the exclusions.
function bucketsOf(d) {
  const out = new Map();
  for (const s of Object.keys(d.sources)) {
    out.set(`sources.${s}`, d.sources[s]);
    for (const c of Object.keys(d.sources[s].content)) out.set(`sources.${s}.content.${c}`, d.sources[s].content[c]);
  }
  out.set('blended', d.blended);
  for (const x of Object.keys(d.excluded)) out.set(`excluded.${x}`, d.excluded[x]);
  return out;
}

function compareDay(d6, d8, path, opts) {
  assert.equal(d8.day, d6.day, `${path}.day`);
  assert.equal(d8.rows, d6.rows, `${path}.rows`);
  assert.deepEqual(Object.keys(d8.sources), Object.keys(d6.sources), `${path}.sources`);
  for (const s of Object.keys(d6.sources)) {
    compareBucket(d6.sources[s], d8.sources[s], `${path}.sources.${s}`, opts);
    assert.deepEqual(Object.keys(d8.sources[s].content), Object.keys(d6.sources[s].content), `${path}.sources.${s}.content`);
    for (const c of Object.keys(d6.sources[s].content)) compareBucket(d6.sources[s].content[c], d8.sources[s].content[c], `${path}.sources.${s}.content.${c}`, opts);
  }
  compareBucket(d6.blended, d8.blended, `${path}.blended`, opts);
  assert.deepEqual(Object.keys(d8.excluded), Object.keys(d6.excluded), `${path}.excluded`);
  for (const x of Object.keys(d6.excluded)) compareBucket(d6.excluded[x], d8.excluded[x], `${path}.excluded.${x}`, opts);
}

function compare(out6, out8, opts) {
  assert.equal(out8.days.length, out6.days.length);
  for (let i = 0; i < out6.days.length; i++) compareDay(out6.days[i], out8.days[i], `days[${i}]`, opts);
  compareDay(out6.total, out8.total, 'total', opts);
  assert.deepEqual(out8.prestart, out6.prestart, 'pre');
}

const withoutLeaveVideo = ALL_ROWS.map((r) => {
  if (r.event !== 'leave' || r.video === undefined) return r;
  const { video, ...rest } = r;
  return rest;
});

test('the baseline is what it says it is', () => {
  assert.equal(v6.SUMMARY_VERSION, 6);
  assert.equal(v8.SUMMARY_VERSION, 8);
  assert.equal(v6.GATE_START, v8.GATE_START);
  assert.equal(String(v6.BOT_UA), String(v8.BOT_UA));
  assert.equal(String(v6.APP_LABEL_UA), String(v8.APP_LABEL_UA));
  assert.ok(ALL_ROWS.length >= 400, `fixture has ${ALL_ROWS.length} rows`);
  assert.ok(ALL_ROWS.some((r) => r.event === 'leave' && r.video !== undefined), 'the fixture carries leave-video rows');
  assert.ok(ALL_ROWS.some((r) => r.event === 'video'), 'the fixture carries standalone video rows');
  assert.ok(ALL_ROWS.every((r) => v8.EVENTS.has(r.event)), 'only live events');
  assert.ok(!ALL_ROWS.some((r) => r.button === 'android'), 'no Android tap: the function refused one until version 8');
  assert.ok(!ALL_ROWS.some((r) => r.plan === 'android'), 'no Android email: the function refused one until version 8');
});

test('without leave-carried video states v8 equals v6 on everything v6 counted, by the explicit mapping', () => {
  const out6 = run(v6, withoutLeaveVideo);
  const out8 = run(v8, withoutLeaveVideo);
  assert.ok(out8.days.length >= 8);
  assert.ok(out8.prestart.length >= 3, 'pre-start visitors are in the fixture');
  compare(out6, out8, { videoEvents: true });
  // and under day params
  const d6 = run(v6, withoutLeaveVideo, { from: '2026-10-24', to: '2026-10-26' });
  const d8 = run(v8, withoutLeaveVideo, { from: '2026-10-24', to: '2026-10-26' });
  assert.equal(d8.days.length, 3);
  compare(d6, d8, { videoEvents: true });
});

test('the one intended divergence: a leave row with a video state is a video event in v8 and nothing in v6', () => {
  const out6 = run(v6, ALL_ROWS);
  const out8 = run(v8, ALL_ROWS);
  compare(out6, out8, { videoEvents: false });
  // per stored flag: the row counters never move at read, so the delta is the leave-video rows by flag
  const count = (flag, state) => ALL_ROWS.filter((r) => r.event === 'leave' && r.video === state && r.flag === flag).length;
  const delta = (b6, b8) => ({ playing: b8.video_events.playing - b6.video.playing, blocked: b8.video_events.blocked - b6.video.blocked });
  assert.deepEqual(delta(out6.total.blended, out8.total.blended), { playing: count('gate', 'playing'), blocked: count('gate', 'blocked') });
  assert.deepEqual(delta(out6.total.excluded.smoke, out8.total.excluded.smoke), { playing: count('smoke', 'playing'), blocked: count('smoke', 'blocked') });
  assert.deepEqual(delta(out6.total.excluded.no_utm, out8.total.excluded.no_utm), { playing: count('no_utm', 'playing'), blocked: count('no_utm', 'blocked') });
  assert.ok(count('gate', 'blocked') > 0, 'the divergence is exercised');
  for (const x of ['bot', 'prestart']) {
    assert.deepEqual(out8.total.excluded[x].video_events, { playing: 0, blocked: 0 }, `${x}: counters stay where the rows were stored`);
    assert.deepEqual(out6.total.excluded[x].video, { playing: 0, blocked: 0 });
  }
  // per source the same holds (every tiktok/typed row is a gate row)
  for (const s of Object.keys(out6.total.sources)) {
    const rows = ALL_ROWS.filter((r) => r.flag === 'gate' && r.utm_source === s && r.event === 'leave');
    assert.deepEqual(delta(out6.total.sources[s], out8.total.sources[s]), {
      playing: rows.filter((r) => r.video === 'playing').length,
      blocked: rows.filter((r) => r.video === 'blocked').length
    }, s);
  }
  // the per-visitor video reading exists only in v8 and never exceeds the row reading
  const b8 = out8.total.blended;
  assert.ok(b8.video.playing + b8.video.blocked + b8.video.both <= b8.video_events.playing + b8.video_events.blocked);
  assert.ok(b8.video.both > 0, 'the fixture has a visitor with a playing load and a blocked load');
});

test('Android rows, new in v8: they show only in the new fields; the emails v6 counted are v8 reservations plus Android emails', () => {
  assert.ok(ANDROID_ROWS.every((r) => v8.EVENTS.has(r.event)), 'only live events');
  const isTap = (r) => r.event === 'tap' && r.button === 'android';
  const isEmail = (r) => r.event === 'email' && r.plan === 'android';
  assert.ok(ANDROID_ROWS.every((r) => r.event !== 'email' || isEmail(r)), 'every Android address carries plan android');
  assert.ok(!ANDROID_ROWS.some((r) => r.event === 'tap' && !isTap(r)), 'an Android phone sends no reserve and no plan tap');
  const rows = [...withoutLeaveVideo, ...ANDROID_ROWS];
  const out6 = run(v6, rows);
  const out8 = run(v8, rows);
  compare(out6, out8, { videoEvents: true, android: true });

  // the rows stay where they were stored: the counters by flag are the Android rows by flag
  const n = (flag, pred) => ANDROID_ROWS.filter((r) => r.flag === flag && pred(r)).length;
  const t = out8.total;
  assert.deepEqual([t.blended.tap_events_android, t.blended.email_events_android], [n('gate', isTap), n('gate', isEmail)]);
  assert.deepEqual([t.excluded.no_utm.tap_events_android, t.excluded.no_utm.email_events_android], [n('no_utm', isTap), n('no_utm', isEmail)]);
  assert.deepEqual([t.excluded.smoke.tap_events_android, t.excluded.smoke.email_events_android], [n('smoke', isTap), n('smoke', isEmail)]);
  for (const flag of ['gate', 'no_utm', 'smoke']) assert.ok(n(flag, isTap) > 0 && n(flag, isEmail) > 0, `${flag}: exercised`);
  // the visitors move: the untagged return joins its paid source, the smoke phone stays in smoke
  assert.deepEqual([t.blended.android_taps, t.blended.android_emails], [4, 3]);
  assert.deepEqual([t.excluded.no_utm.android_taps, t.excluded.no_utm.android_emails], [0, 0]);
  assert.deepEqual([t.excluded.smoke.android_taps, t.excluded.smoke.android_emails], [1, 1]);
  assert.equal(t.sources.tiktok.content.wed28.android_emails, 1, 'the return joined its creative');
  assert.ok(t.blended.android_emails > 0 && out6.total.blended.emails > t.blended.emails, 'the email split is exercised');

  // against v8 without them: nothing about the reserves, the plans, play or the reservation emails moves
  const RESERVES = ['reserve_taps', 'tap_events_reserve', 'plan_taps', 'plan_yearly_taps', 'plan_monthly_taps', 'tap_events_plan_yearly', 'tap_events_plan_monthly', 'play_taps', 'tap_events_play', 'emails', 'email_events'];
  const base = run(v8, withoutLeaveVideo);
  assert.equal(out8.days.length, base.days.length);
  const days = [...base.days.map((d, i) => [`days[${i}]`, d, out8.days[i]]), ['total', base.total, out8.total]];
  for (const [path, d0, d1] of days) {
    const after = bucketsOf(d1);
    for (const [key, b0] of bucketsOf(d0)) {
      assert.ok(after.has(key), `${path}.${key}`);
      for (const k of RESERVES) assert.equal(after.get(key)[k], b0[k], `${path}.${key}.${k}`);
    }
  }
});
