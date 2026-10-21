// The flag at write: flagOf (smoke in any case > no_utm > gate) and what the handler stores on a row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagOf } from '../../netlify/functions/event.mjs';
import { createTestHandler, post, T0 } from '../helpers/http.mjs';
import { vid } from '../helpers/rows.mjs';
import { REAL_UAS } from '../fixtures/user-agents.mjs';

test('flagOf: smoke wins in any case, then no_utm, then gate', () => {
  assert.equal(flagOf({ utm_source: 'own', utm_campaign: 'smoke' }), 'smoke');
  assert.equal(flagOf({ utm_source: 'tiktok', utm_campaign: 'SMOKE' }), 'smoke');
  assert.equal(flagOf({ utm_source: '', utm_campaign: 'Smoke' }), 'smoke', 'smoke even without a source');
  assert.equal(flagOf({ utm_source: '', utm_campaign: '' }), 'no_utm');
  assert.equal(flagOf({ utm_source: '', utm_campaign: 'gate0' }), 'no_utm');
  assert.equal(flagOf({ utm_source: 'tiktok', utm_campaign: 'gate0' }), 'gate');
  assert.equal(flagOf({ utm_source: 'typed', utm_campaign: '' }), 'gate', 'any source without smoke is gate');
  assert.equal(flagOf({ utm_source: 'tiktok', utm_campaign: 'smokey' }), 'gate');
});

const V = vid('flags');
const base = { vid: V, utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'gate0', utm_content: 'fri23' };

async function stored(body, opts) {
  const { handler, blobs, clock } = createTestHandler(opts);
  const res = await post(handler, body);
  assert.equal(res.status, 204, await res.text());
  const rows = blobs.rows('events');
  assert.equal(rows.length, 1);
  return { row: rows[0], clock };
}

test('a tagged pageview is stored with flag gate and every field cleaned', async () => {
  const { row } = await stored({
    event: 'pageview', ...base,
    ts: '2026-10-25T11:59:58Z',
    device: 'ios', inapp: 'tiktok',
    ref: 'https://www.tiktok.com/@parakeet/video/123?lang=en',
    ua: REAL_UAS.tiktok_ios, wd: false, scr: '390x844'
  });
  assert.equal(row.flag, 'gate');
  assert.equal(row.event, 'pageview');
  assert.equal(row.vid, V);
  assert.equal(row.received, T0, 'received is the injected clock');
  assert.equal(row.ts, '2026-10-25T11:59:58.000Z', 'ts normalised to ISO');
  assert.equal(row.utm_source, 'tiktok');
  assert.equal(row.utm_medium, 'paid');
  assert.equal(row.utm_campaign, 'gate0');
  assert.equal(row.utm_content, 'fri23');
  assert.equal(row.device, 'ios');
  assert.equal(row.inapp, 'tiktok');
  assert.equal(row.ref, 'https://www.tiktok.com', 'only the origin of the referrer');
  assert.equal(row.ua, REAL_UAS.tiktok_ios.slice(0, 400), 'the ua is capped at 400 (the client slices to 400 too)');
  assert.ok(row.ua.includes('musical_ly') && row.ua.includes('BytedanceWebview'), 'the in-app tokens survive the cap');
  assert.equal(row.wd, false);
  assert.equal(row.scr, '390x844');
  assert.equal(row.button, undefined);
  assert.equal(row.email, undefined);
  assert.equal(row.video, undefined);
});

test('utm_campaign=smoke in any case is flagged smoke at write', async () => {
  const { row } = await stored({ event: 'pageview', vid: V, utm_source: 'own', utm_campaign: 'Smoke' });
  assert.equal(row.flag, 'smoke');
  assert.equal(row.utm_campaign, 'Smoke', 'the value is stored as typed');
});

test('a row without utm_source is flagged no_utm; a smoke campaign without a source is still smoke', async () => {
  const a = await stored({ event: 'tap', vid: V, button: 'reserve' });
  assert.equal(a.row.flag, 'no_utm');
  assert.equal(a.row.utm_source, '');
  const b = await stored({ event: 'pageview', vid: V, utm_campaign: 'smoke' });
  assert.equal(b.row.flag, 'smoke');
});

test('the flag is decided from the row itself, not from a flag sent by the client', async () => {
  const { row } = await stored({ event: 'pageview', ...base, flag: 'smoke' });
  assert.equal(row.flag, 'gate');
});

test('utm values are trimmed, control characters become spaces, lengths are capped at 100', async () => {
  const long = 'x'.repeat(150);
  const { row } = await stored({ event: 'pageview', vid: V, utm_source: '  tik\u0000tok\n ', utm_medium: long, utm_campaign: 'gate0', utm_content: 42 });
  assert.equal(row.utm_source, 'tik tok');
  assert.equal(row.utm_medium.length, 100);
  assert.equal(row.utm_content, '', 'a non-string is empty');
  assert.equal(row.flag, 'gate');
});

test('device and inapp fall back to other / none; ref keeps only a valid origin', async () => {
  const { row } = await stored({ event: 'pageview', ...base, device: 'desktop', inapp: 'snapchat', ref: 'not a url' });
  assert.equal(row.device, 'other');
  assert.equal(row.inapp, 'none');
  assert.equal(row.ref, '');
  const b = await stored({ event: 'pageview', ...base, device: 'android', inapp: 'facebook', ref: 'null' });
  assert.equal(b.row.device, 'android');
  assert.equal(b.row.inapp, 'facebook');
  assert.equal(b.row.ref, '');
  const c = await stored({ event: 'pageview', ...base, ref: 'https://tryparakeet.netlify.app/?utm_source=x' });
  assert.equal(c.row.ref, 'https://tryparakeet.netlify.app');
  const d = await stored({ event: 'pageview', ...base });
  assert.equal(d.row.device, 'other', 'missing device');
  assert.equal(d.row.inapp, 'none', 'missing inapp');
  assert.equal(d.row.ref, '', 'missing ref');
});

test('an unparseable or missing ts becomes received', async () => {
  const a = await stored({ event: 'pageview', ...base, ts: 'yesterday' });
  assert.equal(a.row.ts, T0);
  const b = await stored({ event: 'pageview', ...base });
  assert.equal(b.row.ts, T0);
  const c = await stored({ event: 'pageview', ...base, ts: '2026-10-25T11:00:00.000Z'.padEnd(60, '0') });
  assert.equal(c.row.ts, T0, 'over 40 characters is ignored');
});

test('pageview evidence: ua capped at 400, scr at 12, wd only when exactly true', async () => {
  const { row } = await stored({ event: 'pageview', ...base, ua: 'U'.repeat(500), scr: '1234567890123456', wd: 'true' });
  assert.equal(row.ua.length, 400);
  assert.equal(row.scr, '123456789012');
  assert.equal(row.wd, false);
  const b = await stored({ event: 'pageview', ...base, wd: true });
  assert.equal(b.row.wd, true);
  const c = await stored({ event: 'tap', ...base, button: 'reserve', ua: 'x', wd: true, scr: '0x0' });
  assert.equal(c.row.ua, undefined, 'evidence is stored on pageviews only');
  assert.equal(c.row.wd, undefined);
  assert.equal(c.row.scr, undefined);
});
