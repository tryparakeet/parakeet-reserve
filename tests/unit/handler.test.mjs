// POST /api/event through createHandler(): status codes, the cookie, the key, validation of every field,
// origins, methods, leave clamping and the video state on the leave beacon.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHandler, post, ORIGIN, T0, HOUR } from '../helpers/http.mjs';
import { vid } from '../helpers/rows.mjs';

const V = vid('handler');
const tagged = { vid: V, utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'gate0', utm_content: 'fri23' };

async function one(body, opts) {
  const { handler, blobs } = createTestHandler(opts);
  const res = await post(handler, body);
  assert.equal(res.status, 204, await res.text());
  const rows = blobs.rows('events');
  assert.equal(rows.length, 1);
  return rows[0];
}

async function rejected(body, status, error, opts) {
  const { handler, blobs } = createTestHandler();
  const res = await post(handler, body, opts);
  const text = await res.text();
  assert.equal(res.status, status, `${JSON.stringify(body)} -> ${text}`);
  assert.equal(JSON.parse(text).error, error);
  assert.equal(blobs.rows('events').length, 0, 'nothing stored');
  assert.equal(res.headers.get('set-cookie'), null, 'no cookie on a rejected row');
}

test('a valid event: 204, empty body, no-store, the 90-day cookie re-set from the row', async () => {
  const { handler, blobs } = createTestHandler();
  const res = await post(handler, { event: 'pageview', ...tagged });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('set-cookie'), `pk_v=${V}; Max-Age=7776000; Path=/; SameSite=Lax; Secure`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(blobs.rows('events').length, 1);
});

test('the key is day/hour/<ms>-<8 hex>-<event>, all from the injected clock', async () => {
  const { handler, blobs, clock } = createTestHandler({ t0: '2026-10-24T23:59:59.500Z' });
  await post(handler, { event: 'pageview', ...tagged });
  clock.advance(HOUR);
  await post(handler, { event: 'tap', ...tagged, button: 'reserve' });
  const keys = Object.keys(blobs.dump('events'));
  assert.equal(keys.length, 2);
  const ms = Date.parse('2026-10-24T23:59:59.500Z');
  assert.match(keys[0], new RegExp(`^2026-10-24/23/${ms}-[0-9a-f]{8}-pageview$`));
  assert.match(keys[1], new RegExp(`^2026-10-25/00/${ms + HOUR}-[0-9a-f]{8}-tap$`));
  const rows = blobs.rows('events');
  assert.equal(rows[0].received, '2026-10-24T23:59:59.500Z');
  assert.equal(rows[1].received, '2026-10-25T00:59:59.500Z');
  assert.equal(rows[1].ts, rows[1].received, 'ts defaults to received');
});

test('400: answer is gone, a tap needs a listed button, vid must be 24 [a-z0-9]', async () => {
  await rejected({ event: 'answer', vid: V, answer: 'hello' }, 400, 'bad event');
  await rejected({ event: 'pageviews', vid: V }, 400, 'bad event');
  await rejected({ event: 'pageview' + 'x'.repeat(20), vid: V }, 400, 'bad event');
  await rejected({ vid: V }, 400, 'bad event');
  await rejected({ event: 'tap', vid: V }, 400, 'bad button');
  await rejected({ event: 'tap', vid: V, button: '' }, 400, 'bad button');
  await rejected({ event: 'tap', vid: V, button: 'card' }, 400, 'bad button');
  await rejected({ event: 'tap', vid: V, button: 'bar' }, 400, 'bad button');
  await rejected({ event: 'tap', vid: V, button: 'Reserve' }, 400, 'bad button');
  await rejected({ event: 'tap', vid: V, button: 7 }, 400, 'bad button');
  await rejected({ event: 'pageview', vid: 'short' }, 400, 'bad vid');
  await rejected({ event: 'pageview', vid: V.toUpperCase() }, 400, 'bad vid');
  await rejected({ event: 'pageview', vid: V + 'a' }, 400, 'bad vid');
  await rejected({ event: 'pageview' }, 400, 'bad vid');
  await rejected({ event: 'pageview', vid: 42 }, 400, 'bad vid');
});

test('400: bad json, arrays and scalars', async () => {
  await rejected(null, 400, 'bad json', { raw: 'not json' });
  await rejected(null, 400, 'bad json', { raw: '[1, 2]' });
  await rejected(null, 400, 'bad json', { raw: 'null' });
  await rejected(null, 400, 'bad json', { raw: '"pageview"' });
  await rejected(null, 400, 'bad json', { raw: '' });
});

test('400: bad email, bad plan, bad via, bad video state', async () => {
  await rejected({ event: 'email', vid: V, email: 'nope' }, 400, 'bad email');
  await rejected({ event: 'email', vid: V, email: 'a@b' }, 400, 'bad email');
  await rejected({ event: 'email', vid: V, email: 'a b@c.d' }, 400, 'bad email');
  await rejected({ event: 'email', vid: V }, 400, 'bad email');
  await rejected({ event: 'email', vid: V, email: 'a@b.co', plan: 'weekly' }, 400, 'bad plan');
  await rejected({ event: 'email', vid: V, email: 'a@b.co', plan: 'Yearly' }, 400, 'bad plan');
  await rejected({ event: 'email', vid: V, email: 'a@b.co', plan: 1 }, 400, 'bad plan');
  await rejected({ event: 'tap', vid: V, button: 'plan_yearly', via: 'keyboard' }, 400, 'bad via');
  await rejected({ event: 'tap', vid: V, button: 'plan_monthly', via: 'Card' }, 400, 'bad via');
  await rejected({ event: 'video', vid: V, video: 'paused' }, 400, 'bad video state');
  await rejected({ event: 'video', vid: V }, 400, 'bad video state');
});

test('via is stored on plan taps (card / hold), empty when absent, ignored on reserve and play', async () => {
  assert.equal((await one({ event: 'tap', ...tagged, button: 'plan_yearly', via: 'card' })).via, 'card');
  assert.equal((await one({ event: 'tap', ...tagged, button: 'plan_monthly', via: 'hold' })).via, 'hold');
  assert.equal((await one({ event: 'tap', ...tagged, button: 'plan_yearly' })).via, '');
  assert.equal((await one({ event: 'tap', ...tagged, button: 'plan_yearly', via: '' })).via, '');
  assert.equal((await one({ event: 'tap', ...tagged, button: 'plan_yearly', via: null })).via, '');
  const reserve = await one({ event: 'tap', ...tagged, button: 'reserve', via: 'card' });
  assert.equal(reserve.button, 'reserve');
  assert.equal(reserve.via, undefined);
  const play = await one({ event: 'tap', ...tagged, button: 'play', via: 'bogus' });
  assert.equal(play.button, 'play');
  assert.equal(play.via, undefined, 'a bad via on a non-plan button is ignored, not rejected');
});

test('the email row carries the plan: yearly / monthly, empty when absent', async () => {
  const a = await one({ event: 'email', ...tagged, email: 'Someone@Example.com', plan: 'yearly' });
  assert.equal(a.email, 'Someone@Example.com', 'stored as typed');
  assert.equal(a.plan, 'yearly');
  assert.equal(a.flag, 'gate');
  assert.equal((await one({ event: 'email', ...tagged, email: 'x@y.zz', plan: 'monthly' })).plan, 'monthly');
  assert.equal((await one({ event: 'email', ...tagged, email: 'x@y.zz' })).plan, '');
  assert.equal((await one({ event: 'email', ...tagged, email: 'x@y.zz', plan: '' })).plan, '');
  const trimmed = await one({ event: 'email', ...tagged, email: '  x@y.zz\n' });
  assert.equal(trimmed.email, 'x@y.zz');
});

test('a video row stores its state; seen stores nothing extra', async () => {
  const v = await one({ event: 'video', ...tagged, video: 'playing' });
  assert.equal(v.video, 'playing');
  assert.equal((await one({ event: 'video', ...tagged, video: 'blocked' })).video, 'blocked');
  const s = await one({ event: 'seen', ...tagged, button: 'reserve', email: 'a@b.co', video: 'playing', seconds: 5 });
  assert.deepEqual(Object.keys(s).sort(), ['device', 'event', 'flag', 'inapp', 'received', 'ref', 'ts', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'vid']);
});

test('leave: seconds clamped to [0, 7 days] and rounded; the video state rides along as video or video_final', async () => {
  assert.equal((await one({ event: 'leave', ...tagged, seconds: -5 })).seconds, 0);
  assert.equal((await one({ event: 'leave', ...tagged, seconds: 1e9 })).seconds, 7 * 24 * 3600);
  assert.equal((await one({ event: 'leave', ...tagged, seconds: 12.6 })).seconds, 13);
  assert.equal((await one({ event: 'leave', ...tagged, seconds: '42' })).seconds, 42);
  assert.equal((await one({ event: 'leave', ...tagged, seconds: 'abc' })).seconds, 0);
  assert.equal((await one({ event: 'leave', ...tagged })).seconds, 0);
  const a = await one({ event: 'leave', ...tagged, seconds: 9, video: 'blocked' });
  assert.equal(a.video, 'blocked');
  assert.equal(a.seconds, 9);
  const b = await one({ event: 'leave', ...tagged, seconds: 9, video_final: 'playing' });
  assert.equal(b.video, 'playing');
  assert.equal(b.video_final, undefined, 'stored under the one name');
  const c = await one({ event: 'leave', ...tagged, seconds: 9, video: 'nope' });
  assert.equal(c.video, undefined, 'an unknown state is dropped, the row still lands');
  assert.equal(c.seconds, 9);
  assert.equal((await one({ event: 'leave', ...tagged, seconds: 9, video_final: 'nope' })).video, undefined);
  assert.equal((await one({ event: 'leave', ...tagged, seconds: 9 })).video, undefined);
  assert.equal((await one({ event: 'leave', ...tagged, seconds: 9, video: 'blocked', video_final: 'playing' })).video, 'blocked', 'video wins over the alias');
  assert.equal((await one({ event: 'leave', ...tagged, seconds: 9, video: '', video_final: 'blocked' })).video, 'blocked', 'an empty video falls through to the alias');
});

test('pageview evidence is trimmed: ua 400, scr 12, wd only when exactly true', async () => {
  const row = await one({ event: 'pageview', ...tagged, ua: 'A'.repeat(500), scr: '12345678901234', wd: 1 });
  assert.equal(row.ua.length, 400);
  assert.equal(row.scr.length, 12);
  assert.equal(row.wd, false);
});

test('413 over 8192 characters, 8192 exactly is accepted', async () => {
  const probe = JSON.stringify({ event: 'pageview', ...tagged, utm_medium: '' });
  const pad = 8192 - probe.length;
  const exact = JSON.stringify({ event: 'pageview', ...tagged, utm_medium: 'm'.repeat(pad) });
  assert.equal(exact.length, 8192);
  const { handler, blobs } = createTestHandler();
  const ok = await post(handler, null, { raw: exact });
  assert.equal(ok.status, 204);
  assert.equal(blobs.rows('events')[0].utm_medium.length, 100);
  await rejected(null, 413, 'too large', { raw: exact + ' ' });
});

test('403 for a foreign origin and for Origin: null; nothing stored', async () => {
  await rejected({ event: 'pageview', ...tagged }, 403, 'forbidden', { origin: 'https://evil.example' });
  await rejected({ event: 'pageview', ...tagged }, 403, 'forbidden', { origin: 'https://tryparakeet.netlify.app.evil.example' });
  await rejected({ event: 'pageview', ...tagged }, 403, 'forbidden', { origin: 'http://tryparakeet.netlify.app' });
  await rejected({ event: 'pageview', ...tagged }, 403, 'forbidden', { origin: 'null' });
});

test('allowed origins: the site, URL / DEPLOY_PRIME_URL / DEPLOY_URL from the injected env (trailing slash tolerated), localhost, no Origin', async () => {
  const env = { ADMIN_KEY: 'k' };
  const { handler, blobs } = createTestHandler({ env });
  const ok = async (origin) => {
    const res = await post(handler, { event: 'pageview', ...tagged }, { origin });
    assert.equal(res.status, 204, `${origin} should be allowed`);
  };
  const no = async (origin) => {
    const res = await post(handler, { event: 'pageview', ...tagged }, { origin });
    assert.equal(res.status, 403, `${origin} should be forbidden`);
  };
  await ok(ORIGIN);
  await ok('http://localhost:8888');
  await ok('http://localhost');
  await ok('http://127.0.0.1:3000');
  await ok(null);
  await no('https://renamed-site.netlify.app');
  await no('https://deploy-preview-3--tryparakeet.netlify.app');
  env.URL = 'https://renamed-site.netlify.app';
  env.DEPLOY_PRIME_URL = 'https://deploy-preview-3--tryparakeet.netlify.app/';
  env.DEPLOY_URL = 'https://0123abcd--tryparakeet.netlify.app';
  await ok('https://renamed-site.netlify.app');
  await ok('https://deploy-preview-3--tryparakeet.netlify.app');
  await ok('https://0123abcd--tryparakeet.netlify.app');
  assert.equal(blobs.rows('events').length, 8);
});

test('OPTIONS is 204; other methods are 405 with Allow: POST; a POST to /admin is 405 with Allow: GET', async () => {
  const { handler } = createTestHandler();
  const opt = await post(handler, null, { method: 'OPTIONS', raw: '' });
  assert.equal(opt.status, 204);
  assert.equal(await opt.text(), '');
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const res = await post(handler, { event: 'pageview', ...tagged }, { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST');
    assert.equal((await res.json()).error, 'method not allowed');
  }
  const head = await post(handler, null, { method: 'HEAD', raw: '' });
  assert.equal(head.status, 405);
  const adminPost = await post(handler, { event: 'pageview', ...tagged }, { path: '/admin' });
  assert.equal(adminPost.status, 405);
  assert.equal(adminPost.headers.get('allow'), 'GET');
  const trailing = await post(handler, { event: 'pageview', ...tagged }, { path: '/admin/' });
  assert.equal(trailing.status, 405, 'a trailing slash is stripped');
});

test('a GET to the event path is the admin route: 401 without the key', async () => {
  const { handler } = createTestHandler();
  const res = await post(handler, null, { method: 'GET', raw: '' });
  assert.equal(res.status, 401);
});

test('received and the key follow the clock exactly, including the default T0', async () => {
  const row = await one({ event: 'pageview', ...tagged });
  assert.equal(row.received, T0);
});
