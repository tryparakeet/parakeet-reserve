// GET /admin through createHandler(): auth, the empty summary, a scripted week read on Oct 31, the per-hour
// cache (version + GATE_START, open hour never cached, no re-reads), partial / pending, the CSV tables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../../netlify/functions/event.mjs';
import { createMemoryBlobs } from '../helpers/memory-blobs.mjs';
import { createTestHandler, post, adminGet, ADMIN_KEY, T0, HOUR, MINUTE } from '../helpers/http.mjs';
import { vid, ZERO_BUCKET } from '../helpers/rows.mjs';
import { BOT_UAS, REAL_UAS } from '../fixtures/user-agents.mjs';

const { SUMMARY_VERSION, GATE_START, SUMMARY_COLUMNS, RAW_COLUMNS, EMAIL_COLUMNS } = mod;
const GATE_START_ISO = '2026-10-24T05:00:00.000Z';
const READ_AT = '2026-10-31T12:00:00.000Z';

const TT = (content) => ({ utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'gate0', utm_content: content });
const TYPED = { utm_source: 'typed', utm_medium: 'organic', utm_campaign: 'gate0', utm_content: 'endcard' };
const SMOKE = { utm_source: 'own', utm_campaign: 'smoke' };

const P = vid('week-P'), A = vid('week-A'), B = vid('week-B'), C = vid('week-C'), D = vid('week-D');
const E = vid('week-E'), S = vid('week-S'), X = vid('week-X'), N = vid('week-N'), F = vid('week-F');

// The scripted week: every POST goes through the handler with the clock moving; 37 rows.
async function scriptedWeek({ blobs = createMemoryBlobs() } = {}) {
  const t = createTestHandler({ t0: '2026-10-23T20:00:00.000Z', blobs });
  const { handler, clock } = t;
  const send = async (body) => {
    const res = await post(handler, body);
    assert.equal(res.status, 204, await res.text());
  };
  const ios = { device: 'ios', inapp: 'none', ua: REAL_UAS.safari_ios, scr: '390x844' };
  // the client sends device / inapp / ref on every event; the evidence only on the pageview
  const ctxA = { device: 'ios', inapp: 'tiktok', ref: 'https://www.tiktok.com' };
  const inTikTok = { ...ctxA, ua: REAL_UAS.tiktok_ios, scr: '390x844' };
  const ctxB = { device: 'android', inapp: 'tiktok' };
  // Oct 23, before the start: P opens a paid link
  await send({ event: 'pageview', vid: P, ...TT('sat24'), ...ios });
  clock.set('2026-10-24T06:00:00.000Z');
  await send({ event: 'tap', vid: P, ...TT('sat24'), button: 'reserve' });
  await send({ event: 'pageview', vid: A, ...TT('sat24'), ...inTikTok });
  await send({ event: 'video', vid: A, ...TT('sat24'), ...ctxA, video: 'playing' });
  await send({ event: 'tap', vid: A, ...TT('sat24'), ...ctxA, button: 'reserve' });
  await send({ event: 'seen', vid: A, ...TT('sat24'), ...ctxA });
  await send({ event: 'tap', vid: A, ...TT('sat24'), ...ctxA, button: 'plan_yearly', via: 'card' });
  await send({ event: 'email', vid: A, ...TT('sat24'), ...ctxA, email: 'a@example.com', plan: 'yearly' });
  await send({ event: 'leave', vid: A, ...TT('sat24'), ...ctxA, seconds: 40 });
  await send({ event: 'pageview', vid: B, ...TT('sat24'), ...ctxB, ua: REAL_UAS.tiktok_android, scr: '412x915' });
  await send({ event: 'tap', vid: B, ...TT('sat24'), ...ctxB, button: 'reserve' });
  await send({ event: 'seen', vid: B, ...TT('sat24'), ...ctxB });
  await send({ event: 'tap', vid: B, ...TT('sat24'), ...ctxB, button: 'plan_monthly', via: 'hold' });
  await send({ event: 'leave', vid: B, ...TT('sat24'), ...ctxB, seconds: 25, video_final: 'blocked' });
  await send({ event: 'pageview', vid: C, ...TT('sat24'), ...ios });
  await send({ event: 'leave', vid: C, ...TT('sat24'), seconds: 5, video: 'blocked' });
  clock.set('2026-10-25T10:00:00.000Z');
  await send({ event: 'pageview', vid: D, ...TT('sun25'), ...ios });
  await send({ event: 'tap', vid: D, ...TT('sun25'), button: 'reserve' });
  await send({ event: 'tap', vid: D, ...TT('sun25'), button: 'play' });
  await send({ event: 'tap', vid: D, ...TT('sun25'), button: 'plan_yearly', via: 'card' });
  await send({ event: 'leave', vid: D, ...TT('sun25'), seconds: 20 });
  await send({ event: 'pageview', vid: E, ...TYPED, ...ios });
  await send({ event: 'tap', vid: E, ...TYPED, button: 'reserve' });
  await send({ event: 'tap', vid: E, ...TYPED, button: 'plan_yearly', via: 'hold' });
  await send({ event: 'email', vid: E, ...TYPED, email: 'e@example.com', plan: 'monthly' });
  await send({ event: 'pageview', vid: S, ...SMOKE, ...ios });
  await send({ event: 'tap', vid: S, ...SMOKE, button: 'reserve' });
  await send({ event: 'tap', vid: S, ...SMOKE, button: 'plan_yearly', via: 'card' });
  await send({ event: 'pageview', vid: X, ...TT('sun25'), device: 'other', ua: BOT_UAS.headless_chrome, scr: '800x600' });
  await send({ event: 'tap', vid: X, ...TT('sun25'), button: 'reserve' });
  await send({ event: 'tap', vid: X, ...TT('sun25'), button: 'plan_yearly', via: 'card' });
  await send({ event: 'pageview', vid: N, ...ios });
  await send({ event: 'tap', vid: N, button: 'reserve' });
  clock.set('2026-10-26T15:00:00.000Z');
  await send({ event: 'pageview', vid: A, ...inTikTok, ref: '' });
  await send({ event: 'tap', vid: A, button: 'plan_monthly', via: 'card' });
  clock.set('2026-10-30T23:30:00.000Z');
  await send({ event: 'pageview', vid: F, ...TT('fri30'), ...ios });
  await send({ event: 'tap', vid: F, ...TT('fri30'), button: 'reserve' });
  assert.equal(blobs.rows('events').length, 37);
  return t;
}

async function read(handler, params, opts) {
  const res = await adminGet(handler, params, opts);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return JSON.parse(text);
}

test('503 without ADMIN_KEY in the env; the env object is read live', async () => {
  const env = {};
  const { handler } = createTestHandler({ env });
  const res = await adminGet(handler, {}, { key: 'anything' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /ADMIN_KEY/);
  env.ADMIN_KEY = 'later';
  assert.equal((await adminGet(handler, {}, { key: 'later' })).status, 200);
});

test('401 for a wrong, empty or missing key', async () => {
  const { handler } = createTestHandler();
  for (const key of ['wrong', '', null, ADMIN_KEY + ' ']) {
    const res = await adminGet(handler, {}, { key });
    assert.equal(res.status, 401, String(key));
    assert.equal((await res.json()).error, 'unauthorized');
  }
});

test('the empty summary is exactly this JSON', async () => {
  const { handler } = createTestHandler();
  const res = await adminGet(handler);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const out = await res.json();
  const expected = {
    version: 7,
    gate_start: GATE_START_ISO,
    generated: T0,
    from: null,
    to: null,
    partial: false,
    pending: [],
    days: [],
    total: {
      day: 'all',
      rows: 0,
      sources: {},
      blended: ZERO_BUCKET,
      excluded: { smoke: ZERO_BUCKET, no_utm: ZERO_BUCKET, bot: ZERO_BUCKET, prestart: ZERO_BUCKET }
    },
    emails: []
  };
  assert.deepEqual(out, expected);
  assert.deepEqual(Object.keys(out), Object.keys(expected));
  assert.equal(SUMMARY_VERSION, 7);
  assert.equal(GATE_START, Date.parse(GATE_START_ISO));
  assert.equal(out.answers, undefined);
});

test('the scripted week read on Oct 31 with no day params', async () => {
  const { handler, clock } = await scriptedWeek();
  clock.set(READ_AT);
  const out = await read(handler);
  assert.equal(out.version, 7);
  assert.equal(out.gate_start, GATE_START_ISO);
  assert.equal(out.generated, READ_AT);
  assert.equal(out.partial, false);
  assert.deepEqual(out.pending, []);
  assert.equal(out.from, '2026-10-23');
  assert.equal(out.to, '2026-10-30');
  assert.deepEqual(out.days.map((d) => d.day), ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-30']);
  assert.equal(out.total.day, 'all');
  assert.equal(out.total.rows, 37);

  const tt = out.total.sources.tiktok;
  assert.equal(tt.uniques, 5, 'A B C D F; P is prestart, X a bot');
  assert.equal(tt.reserve_taps, 4);
  assert.equal(tt.reserve_rate, 0.8);
  assert.equal(tt.plan_taps, 3, 'A (card, plus the untagged monthly tap), B (hold), D');
  assert.equal(tt.plan_yearly_taps, 2);
  assert.equal(tt.plan_monthly_taps, 2);
  assert.equal(tt.plan_rate, 0.6);
  assert.equal(tt.play_taps, 1);
  assert.equal(tt.taps, 4);
  assert.equal(tt.emails, 1);
  assert.equal(tt.pageviews, 7, 'rows: P A B C D X F');
  assert.equal(tt.seen, 2);
  assert.deepEqual(tt.video, { playing: 1, blocked: 2, both: 0 });
  assert.deepEqual(tt.video_events, { playing: 1, blocked: 2 });
  assert.equal(tt.tap_events, 11);
  assert.equal(tt.tap_events_reserve, 6);
  assert.equal(tt.tap_events_play, 1);
  assert.equal(tt.tap_events_plan_yearly, 3);
  assert.equal(tt.tap_events_plan_monthly, 1);
  assert.equal(tt.email_events, 1);
  assert.deepEqual(tt.leave, { n: 4, avg_seconds: 23 }, '(40 + 25 + 5 + 20) / 4 = 22.5');
  assert.deepEqual(tt.device, { ios: 5, android: 1, other: 1 });
  assert.deepEqual(tt.inapp, { tiktok: 2, instagram: 0, facebook: 0, none: 5 });
  assert.deepEqual(Object.keys(tt.content), ['fri30', 'sat24', 'sun25']);

  const sat24 = tt.content.sat24;
  assert.equal(sat24.uniques, 3);
  assert.equal(sat24.reserve_taps, 2);
  assert.equal(sat24.plan_taps, 2);
  assert.equal(sat24.plan_yearly_taps, 1);
  assert.equal(sat24.plan_monthly_taps, 2);
  assert.equal(sat24.plan_rate, 0.6667);
  assert.equal(sat24.emails, 1);
  assert.equal(sat24.pageviews, 4);
  assert.equal(sat24.seen, 2);
  assert.deepEqual(sat24.video, { playing: 1, blocked: 2, both: 0 });
  assert.deepEqual(sat24.leave, { n: 3, avg_seconds: 23 });
  assert.equal(sat24.tap_events, 5);
  const sun = tt.content.sun25;
  assert.equal(sun.uniques, 1);
  assert.equal(sun.plan_taps, 1);
  assert.equal(sun.play_taps, 1);
  assert.equal(sun.pageviews, 2);
  assert.equal(sun.tap_events, 5);
  assert.deepEqual(sun.leave, { n: 1, avg_seconds: 20 });
  assert.equal(tt.content.fri30.uniques, 1);

  const typed = out.total.sources.typed;
  assert.equal(typed.uniques, 1);
  assert.equal(typed.reserve_taps, 1);
  assert.equal(typed.plan_taps, 1);
  assert.equal(typed.plan_yearly_taps, 1);
  assert.equal(typed.plan_rate, 1);
  assert.equal(typed.emails, 1);
  assert.deepEqual(Object.keys(typed.content), ['endcard']);
  assert.equal(typed.content.endcard.plan_taps, 1);

  const blended = out.total.blended;
  assert.equal(blended.uniques, 6);
  assert.equal(blended.reserve_taps, 5);
  assert.equal(blended.plan_taps, 4);
  assert.equal(blended.plan_rate, 0.6667);
  assert.equal(blended.emails, 2);
  assert.equal(blended.pageviews, 8);

  const ex = out.total.excluded;
  assert.equal(ex.smoke.uniques, 1);
  assert.equal(ex.smoke.plan_taps, 1);
  assert.equal(ex.smoke.plan_rate, 1);
  assert.equal(ex.no_utm.uniques, 1);
  assert.equal(ex.no_utm.reserve_taps, 1);
  assert.equal(ex.no_utm.plan_taps, 0, "A's untagged plan tap joined tiktok");
  assert.equal(ex.no_utm.pageviews, 2);
  assert.equal(ex.no_utm.tap_events, 2);
  assert.equal(ex.bot.uniques, 1);
  assert.equal(ex.bot.reserve_taps, 1);
  assert.equal(ex.bot.plan_taps, 1);
  assert.equal(ex.bot.pageviews, 0);
  assert.equal(ex.prestart.uniques, 1);
  assert.equal(ex.prestart.reserve_taps, 1);
  assert.equal(ex.prestart.pageviews, 0);

  // per day: Oct 23 holds only P's pageview, already excluded on its own day
  assert.equal(out.days[0].rows, 1);
  assert.equal(out.days[0].sources.tiktok.uniques, 0);
  assert.equal(out.days[0].sources.tiktok.pageviews, 1);
  assert.equal(out.days[0].excluded.prestart.uniques, 1);
  assert.equal(out.days[1].rows, 15);
  assert.equal(out.days[1].sources.tiktok.uniques, 3);
  assert.equal(out.days[1].sources.tiktok.plan_taps, 2);

  // the email table: EMAIL_COLUMNS only, with the plan, oldest first
  assert.equal(out.emails.length, 2);
  for (const e of out.emails) for (const k of Object.keys(e)) assert.ok(EMAIL_COLUMNS.includes(k), `email column ${k}`);
  assert.equal(out.emails[0].email, 'a@example.com');
  assert.equal(out.emails[0].plan, 'yearly');
  assert.equal(out.emails[0].vid, A);
  assert.equal(out.emails[0].flag, 'gate');
  assert.equal(out.emails[0].utm_content, 'sat24');
  assert.equal(out.emails[0].inapp, 'tiktok');
  assert.equal(out.emails[1].email, 'e@example.com');
  assert.equal(out.emails[1].plan, 'monthly');
  assert.equal(out.emails[1].utm_source, 'typed');
  assert.equal(out.emails[0].ts, undefined);
  assert.equal(out.emails[0].ref, undefined);
});

test('day, from and to limit the days; the pre-start exclusion still comes from every earlier day', async () => {
  const { handler, clock } = await scriptedWeek();
  clock.set(READ_AT);
  const one = await read(handler, { day: '2026-10-25' });
  assert.deepEqual(one.days.map((d) => d.day), ['2026-10-25']);
  assert.equal(one.from, '2026-10-25');
  assert.equal(one.to, '2026-10-25');
  assert.equal(one.total.rows, 17, 'D 5, E 4, S 3, X 3, N 2');
  assert.equal(one.total.sources.tiktok.uniques, 1);
  assert.equal(one.total.sources.typed.uniques, 1);
  assert.equal(one.total.excluded.bot.uniques, 1);
  assert.equal(one.total.excluded.smoke.uniques, 1);
  assert.equal(one.total.excluded.no_utm.uniques, 1);
  const range = await read(handler, { from: '2026-10-24', to: '2026-10-26' });
  assert.deepEqual(range.days.map((d) => d.day), ['2026-10-24', '2026-10-25', '2026-10-26']);
  assert.equal(range.total.excluded.prestart.uniques, 1, "P's Oct 23 pageview is outside the range but still excludes it");
  assert.equal(range.total.excluded.prestart.reserve_taps, 1);
  assert.equal(range.total.sources.tiktok.uniques, 4);
  const bad = await read(handler, { day: '20261025' });
  assert.equal(bad.days.length, 5, 'a malformed day param is ignored');
  const none = await read(handler, { from: '2026-11-01' });
  assert.deepEqual(none.days, []);
  assert.equal(none.from, null);
  assert.equal(none.total.rows, 0);
});

test('the closed hours are cached with v and gs; the open hour never is', async () => {
  const { handler, clock, blobs } = await scriptedWeek();
  clock.set('2026-10-30T23:45:00.000Z');
  const open = await read(handler);
  assert.equal(open.total.sources.tiktok.content.fri30.uniques, 1, 'the open hour is counted');
  const cached = blobs.dump('summaries');
  assert.deepEqual(Object.keys(cached), ['2026-10-23/20', '2026-10-24/06', '2026-10-25/10', '2026-10-26/15']);
  for (const [key, s] of Object.entries(cached)) {
    assert.equal(s.v, SUMMARY_VERSION, key);
    assert.equal(s.gs, GATE_START, key);
    assert.equal(s.day, key.slice(0, 10));
    assert.equal(s.hour, key.slice(11));
    assert.equal(s.failed, 0);
  }
  assert.equal(cached['2026-10-24/06'].rows, 15);
  assert.deepEqual(cached['2026-10-23/20'].pre, [P]);
  // 1 h + 2 min after the hour started it is still open; 1 ms later it is closed
  clock.set('2026-10-31T00:02:00.000Z');
  await read(handler);
  assert.equal(blobs.dump('summaries')['2026-10-30/23'], undefined);
  clock.advance(1);
  await read(handler);
  assert.equal(blobs.dump('summaries')['2026-10-30/23'].rows, 2);
});

test('a second read serves the cached hours: no row reads but the email keys, no listing of those hours', async () => {
  const { handler, clock, blobs } = await scriptedWeek();
  clock.set(READ_AT);
  const first = await read(handler);
  const hours = Object.keys(blobs.dump('summaries'));
  assert.equal(hours.length, 5);
  blobs.log.length = 0;
  const second = await read(handler);
  assert.deepEqual(second, first);
  const gets = blobs.log.filter((e) => e.store === 'events' && e.op === 'get');
  assert.ok(gets.length > 0, 'the email table still reads its rows');
  for (const g of gets) assert.ok(g.key.endsWith('-email'), `read of a non-email key ${g.key}`);
  const lists = blobs.log.filter((e) => e.store === 'events' && e.op === 'list' && !e.directories);
  for (const l of lists) assert.ok(!/^\d{4}-\d{2}-\d{2}\/\d{2}\/$/.test(l.prefix), `listed an hour prefix ${l.prefix}`);
  assert.equal(blobs.log.filter((e) => e.store === 'summaries' && e.op === 'setJSON').length, 0, 'nothing re-cached');
  assert.equal(blobs.log.filter((e) => e.store === 'summaries' && e.op === 'get').length, 5);
});

test('a cached hour is served as is; a v 6 or other-GATE_START entry is rebuilt', async () => {
  const { handler, clock, blobs } = await scriptedWeek();
  clock.set(READ_AT);
  await read(handler);
  const summaries = blobs.getStore({ name: 'summaries' });
  const key = '2026-10-24/06';
  const good = blobs.dump('summaries')[key];
  // same v and gs, tampered rows: served from the cache
  await summaries.setJSON(key, { ...good, rows: 999 });
  const served = await read(handler);
  assert.equal(served.days[1].rows, 999);
  // previous version: rebuilt and re-cached as v 7
  await summaries.setJSON(key, { ...good, v: 6, rows: 999 });
  const rebuilt = await read(handler);
  assert.equal(rebuilt.days[1].rows, 15);
  assert.equal(blobs.dump('summaries')[key].v, 7);
  assert.equal(blobs.dump('summaries')[key].rows, 15);
  // another GATE_START: rebuilt too
  await summaries.setJSON(key, { ...good, gs: GATE_START + 1, rows: 999 });
  const again = await read(handler);
  assert.equal(again.days[1].rows, 15);
  assert.equal(blobs.dump('summaries')[key].gs, GATE_START);
  // an unreadable cache entry is rebuilt, not fatal
  blobs.failing.add(`summaries:${key}`);
  const unreadable = await read(handler);
  assert.equal(unreadable.days[1].rows, 15);
  assert.equal(unreadable.partial, false);
});

test('past the 8 s budget the remaining hours are pending and the read is partial', async () => {
  const blobs = createMemoryBlobs();
  await scriptedWeek({ blobs });
  let calls = 0;
  const base = Date.parse(READ_AT);
  const jumping = () => (++calls > 1 ? base + 9000 : base);
  const { handler } = createTestHandler({ blobs, now: jumping });
  const out = await read(handler);
  assert.equal(out.partial, true);
  assert.ok(out.pending.length > 0);
  for (const p of out.pending) assert.match(p, /^\d{4}-\d{2}-\d{2}\/\d{2}$/);
  assert.equal(out.days.length, 5, 'every day is still listed');
  assert.equal(out.total.rows, 0, 'nothing was summarised');
  assert.deepEqual(Object.keys(blobs.dump('summaries')), [], 'nothing cached');
});

test('a failing row makes the read partial, keeps that hour out of the cache and is retried once', async () => {
  const blobs = createMemoryBlobs();
  const { handler, clock } = await scriptedWeek({ blobs });
  clock.set(READ_AT);
  const key = Object.entries(blobs.dump('events')).find(([k, row]) => k.startsWith('2026-10-25/10/') && row.event === 'pageview' && row.vid === D)[0];
  blobs.failing.add(key);
  const out = await read(handler);
  assert.equal(out.partial, true);
  assert.deepEqual(out.pending, []);
  assert.equal(out.days[2].rows, 16, 'one of the 17 Oct 25 rows is missing');
  assert.equal(out.days[2].sources.tiktok.pageviews, 1, "D's pageview is the missing row; X's is still there");
  assert.equal(out.days[2].sources.tiktok.uniques, 1, 'D still counts through its taps');
  assert.equal(blobs.dump('summaries')['2026-10-25/10'], undefined, 'the hour with a failed read is not cached');
  assert.equal(Object.keys(blobs.dump('summaries')).length, 4);
  blobs.failing.delete(key);
  blobs.failOnce.add(key);
  const retried = await read(handler);
  assert.equal(retried.partial, false);
  assert.equal(retried.days[2].rows, 17);
  assert.equal(retried.days[2].sources.tiktok.pageviews, 2);
  assert.equal(blobs.dump('summaries')['2026-10-25/10'].rows, 17);
  assert.equal(blobs.failOnce.size, 0, 'the one failure was consumed by the retry');
});

test('a failing email row makes the read partial', async () => {
  const blobs = createMemoryBlobs();
  const { handler, clock } = await scriptedWeek({ blobs });
  clock.set(READ_AT);
  await read(handler);
  const key = Object.keys(blobs.dump('events')).find((k) => k.endsWith('-email'));
  blobs.failing.add(key);
  const out = await read(handler);
  assert.equal(out.partial, true);
  assert.equal(out.emails.length, 1);
  const csv = await adminGet(handler, { format: 'csv' });
  assert.equal(csv.headers.get('x-partial'), 'true');
});

test('the summary CSV: SUMMARY_COLUMNS, CRLF, the filename, X-Partial', async () => {
  const { handler, clock } = await scriptedWeek();
  clock.set(READ_AT);
  const res = await adminGet(handler, { format: 'csv' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="parakeet-summary.csv"');
  assert.equal(res.headers.get('x-partial'), 'false');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.ok(text.endsWith('\r\n'));
  assert.equal(text.indexOf('\n'), text.indexOf('\r\n') + 1, 'every newline is CRLF');
  const lines = text.slice(0, -2).split('\r\n');
  assert.equal(lines[0], SUMMARY_COLUMNS.join(','));
  assert.equal(lines[1].slice(0, 25), '2026-10-23,gate,tiktok,,0');
  for (const line of lines) assert.equal(line.split(',').length, SUMMARY_COLUMNS.length);
  const total = lines.filter((l) => l.startsWith('all,gate,tiktok,,'));
  assert.equal(total.length, 1);
  const cells = total[0].split(',');
  const col = (name) => cells[SUMMARY_COLUMNS.indexOf(name)];
  assert.equal(col('uniques'), '5');
  assert.equal(col('plan_taps'), '3');
  assert.equal(col('plan_rate'), '0.6');
  assert.equal(col('video_blocked'), '2');
  assert.equal(col('video_events_blocked'), '2');
  assert.equal(col('leave_avg_seconds'), '23');
  assert.ok(lines.some((l) => l.startsWith('all,gate,tiktok,sat24,3')));
  assert.ok(lines.some((l) => l.startsWith('all,gate,blended,,6')));
  assert.ok(lines.some((l) => l.startsWith('all,excluded,prestart,,1')));
});

test('the raw table needs a day; CSV and JSON carry RAW_COLUMNS with via, plan and video; cells are escaped', async () => {
  const { handler, clock, blobs } = await scriptedWeek();
  clock.set('2026-10-27T09:00:00.000Z');
  const V = vid('raw-escape');
  await post(handler, { event: 'pageview', vid: V, utm_source: 'tiktok', utm_medium: '=cmd()', utm_campaign: 'gate0', utm_content: 'a,"b"' });
  const noDay = await adminGet(handler, { table: 'raw' });
  assert.equal(noDay.status, 400);
  assert.match((await noDay.json()).error, /day=/);
  const res = await adminGet(handler, { table: 'raw', day: '2026-10-27', format: 'csv' });
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="parakeet-raw-2026-10-27.csv"');
  const lines = (await res.text()).slice(0, -2).split('\r\n');
  assert.equal(lines[0], RAW_COLUMNS.join(','));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes(",'=cmd(),"), 'a formula-leading cell is prefixed');
  assert.ok(lines[1].includes(',"a,""b""",'), 'commas and quotes are quoted and doubled');
  const day23 = await adminGet(handler, { table: 'raw', day: '2026-10-24', format: 'csv' });
  const rows23 = (await day23.text()).slice(0, -2).split('\r\n');
  assert.equal(rows23.length, 16);
  const col = (line, name) => line.split(',')[RAW_COLUMNS.indexOf(name)];
  const hold = rows23.find((l) => col(l, 'button') === 'plan_monthly');
  assert.equal(col(hold, 'via'), 'hold');
  assert.equal(col(rows23.find((l) => col(l, 'button') === 'plan_yearly'), 'via'), 'card');
  assert.equal(col(rows23.find((l) => col(l, 'event') === 'email'), 'plan'), 'yearly');
  const leaves = rows23.filter((l) => col(l, 'event') === 'leave');
  assert.deepEqual(leaves.map((l) => col(l, 'video')).sort(), ['', 'blocked', 'blocked']);
  const json = await read(handler, { table: 'raw', day: '2026-10-24' });
  assert.equal(json.day, '2026-10-24');
  assert.equal(json.partial, false);
  assert.equal(json.rows.length, 15);
  assert.ok(json.rows.every((r, i) => i === 0 || r.received >= json.rows[i - 1].received), 'sorted by received');
  assert.equal(json.rows.find((r) => r.event === 'pageview' && r.vid === A).ua, REAL_UAS.tiktok_ios.slice(0, 400), 'the ua is in the raw rows (capped at 400)');
  assert.equal(blobs.rows('events').length, 38);
});

test('the emails table: EMAIL_COLUMNS with plan, as JSON and CSV', async () => {
  const { handler, clock } = await scriptedWeek();
  clock.set(READ_AT);
  const json = await read(handler, { table: 'emails' });
  assert.deepEqual(Object.keys(json), ['generated', 'partial', 'emails']);
  assert.equal(json.emails.length, 2);
  assert.deepEqual(json.emails.map((e) => e.plan), ['yearly', 'monthly']);
  const res = await adminGet(handler, { table: 'emails', format: 'csv' });
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="parakeet-emails.csv"');
  const lines = (await res.text()).slice(0, -2).split('\r\n');
  assert.equal(lines[0], EMAIL_COLUMNS.join(','));
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('2026-10-24T06:00:00.000Z,a@example.com,'));
  assert.ok(lines[1].endsWith(',yearly'));
  assert.ok(lines[2].endsWith(',monthly'));
  const answers = await read(handler, { table: 'answers' });
  assert.equal(answers.answers, undefined, 'no answers table any more');
  assert.equal(answers.version, 7, 'an unknown table is the summary');
});

test('the directory form with a trailing slash reads the same', async () => {
  const plain = await scriptedWeek({ blobs: createMemoryBlobs({ dirSlash: false }) });
  const slash = await scriptedWeek({ blobs: createMemoryBlobs({ dirSlash: true }) });
  plain.clock.set(READ_AT);
  slash.clock.set(READ_AT);
  const a = await read(plain.handler);
  const b = await read(slash.handler);
  assert.deepEqual(b, a);
  assert.deepEqual(Object.keys(slash.blobs.dump('summaries')), Object.keys(plain.blobs.dump('summaries')));
  const dirs = await slash.blobs.getStore({ name: 'events' }).list({ prefix: '', directories: true });
  assert.ok(dirs.directories.every((d) => d.endsWith('/')));
});

test('rows after a read land in the summary on the next read (the open hour is re-read every time)', async () => {
  const { handler, clock } = await scriptedWeek();
  clock.set('2026-10-30T23:40:00.000Z');
  const before = await read(handler);
  assert.equal(before.total.sources.tiktok.content.fri30.reserve_taps, 1);
  clock.advance(MINUTE);
  const res = await post(handler, { event: 'tap', vid: F, ...TT('fri30'), button: 'plan_yearly', via: 'hold' });
  assert.equal(res.status, 204);
  const after = await read(handler);
  assert.equal(after.total.sources.tiktok.content.fri30.plan_taps, 1);
  assert.equal(after.total.rows, 38);
  clock.advance(2 * HOUR);
  const closed = await read(handler);
  assert.equal(closed.total.rows, 38);
});
