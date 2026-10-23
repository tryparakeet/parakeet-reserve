// The function's status codes and the CSV tables over HTTP through the harness (the request fixture):
// 401, 503, 400, 413, 403, 405, 204; the summary, emails and raw CSV headers, filenames, CRLF, X-Partial.

import { test, expect, ADMIN_KEY, TAGGED } from './fixtures.mjs';
import { SUMMARY_COLUMNS, EMAIL_COLUMNS, RAW_COLUMNS } from '../../netlify/functions/event.mjs';

const VID = 'e2eadminvisitor0123456789'.slice(0, 24);

test('401 for a wrong key, an empty key and no key', async ({ request }) => {
  for (const q of ['?key=wrong', '?key=', '']) {
    const res = await request.get('/admin' + q);
    expect(res.status(), `/admin${q}`).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');
    expect(res.headers()['cache-control']).toBe('no-store');
  }
});

test.describe('without ADMIN_KEY', () => {
  test.use({ harnessOptions: { adminKey: null } });
  test('503 with the message naming the Netlify environment', async ({ request }) => {
    const res = await request.get(`/admin?key=${ADMIN_KEY}`);
    expect(res.status()).toBe(503);
    expect((await res.json()).error).toContain('ADMIN_KEY');
  });
});

test('the empty summary: version 7, gate_start, partial false, pending [], no days', async ({ request }) => {
  const res = await request.get(`/admin?key=${ADMIN_KEY}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/json');
  expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
  const out = await res.json();
  expect(out.version).toBe(7);
  expect(out.gate_start).toBe('2026-10-24T05:00:00.000Z');
  expect(out.generated).toBe('2026-10-25T12:00:00.000Z');
  expect(out.partial).toBe(false);
  expect(out.pending).toEqual([]);
  expect(out.days).toEqual([]);
  expect(out.from).toBeNull();
  expect(out.to).toBeNull();
  expect(out.total.sources).toEqual({});
  expect(out.total.blended.uniques).toBe(0);
  expect(out.total.blended.plan_rate).toBe(0);
  expect(out.emails).toEqual([]);
});

test('400: table=raw without a day, a bad event, a missing button, a bad vid, bad json', async ({ request }) => {
  let res = await request.get(`/admin?key=${ADMIN_KEY}&table=raw`);
  expect(res.status()).toBe(400);
  res = await request.post('/api/event', { data: { event: 'answer', vid: VID, answer: 'x' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('bad event');
  res = await request.post('/api/event', { data: { event: 'tap', vid: VID } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('bad button');
  res = await request.post('/api/event', { data: { event: 'pageview', vid: 'short' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('bad vid');
  res = await request.post('/api/event', { headers: { 'content-type': 'application/json' }, data: '{not json' });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('bad json');
});

test('413 over 8192 characters', async ({ request }) => {
  const body = JSON.stringify({ event: 'pageview', vid: VID, ua: 'x'.repeat(9000) });
  const res = await request.post('/api/event', { headers: { 'content-type': 'application/json' }, data: body });
  expect(res.status()).toBe(413);
});

test('403 for a foreign Origin, 204 for the site origin and for no Origin', async ({ request, harness }) => {
  let res = await request.post('/api/event', { headers: { origin: 'https://evil.example' }, data: { event: 'pageview', vid: VID, ...TAGGED } });
  expect(res.status()).toBe(403);
  expect(harness.blobs.rows('events').length).toBe(0);
  res = await request.post('/api/event', { headers: { origin: harness.url }, data: { event: 'pageview', vid: VID, ...TAGGED } });
  expect(res.status()).toBe(204);
  expect(res.headers()['set-cookie']).toContain(`pk_v=${VID}; Max-Age=7776000`);
  res = await request.post('/api/event', { data: { event: 'tap', vid: VID, button: 'reserve', ...TAGGED } });
  expect(res.status()).toBe(204);
  expect(harness.blobs.rows('events').length).toBe(2);
});

test('405 for PUT and DELETE on /api/event, 204 for OPTIONS', async ({ request }) => {
  let res = await request.put('/api/event', { data: {} });
  expect(res.status()).toBe(405);
  expect(res.headers().allow).toBe('POST');
  res = await request.delete('/api/event');
  expect(res.status()).toBe(405);
  res = await request.fetch('/api/event', { method: 'OPTIONS' });
  expect(res.status()).toBe(204);
});

test('the three CSV tables: headers, filenames, CRLF, X-Partial', async ({ request, harness }) => {
  const send = async (body) => {
    const res = await request.post('/api/event', { data: { vid: VID, ...TAGGED, ...body } });
    expect(res.status()).toBe(204);
  };
  await send({ event: 'pageview', ua: 'Mozilla/5.0 (iPhone) e2e', scr: '375x667', device: 'ios' });
  await send({ event: 'tap', button: 'reserve' });
  await send({ event: 'tap', button: 'plan_yearly', via: 'hold' });
  await send({ event: 'email', email: 'csv@example.com', plan: 'yearly' });
  await send({ event: 'leave', seconds: 12, video: 'blocked' });

  const summary = await request.get(`/admin?key=${ADMIN_KEY}&format=csv`);
  expect(summary.status()).toBe(200);
  expect(summary.headers()['content-type']).toBe('text/csv; charset=utf-8');
  expect(summary.headers()['content-disposition']).toBe('attachment; filename="parakeet-summary.csv"');
  expect(summary.headers()['x-partial']).toBe('false');
  expect(summary.headers()['cache-control']).toBe('no-store');
  const summaryText = await summary.text();
  expect(summaryText.endsWith('\r\n')).toBe(true);
  const summaryLines = summaryText.split('\r\n');
  expect(summaryLines[0]).toBe(SUMMARY_COLUMNS.join(','));
  expect(summaryLines.length).toBeGreaterThan(2);
  const tiktokRow = summaryLines.find((l) => l.startsWith('2026-10-25,gate,tiktok,,'));
  expect(tiktokRow).toBeTruthy();
  const cells = tiktokRow.split(',');
  expect(cells[SUMMARY_COLUMNS.indexOf('uniques')]).toBe('1');
  expect(cells[SUMMARY_COLUMNS.indexOf('plan_rate')]).toBe('1');
  expect(cells[SUMMARY_COLUMNS.indexOf('video_blocked')]).toBe('1');

  const emails = await request.get(`/admin?key=${ADMIN_KEY}&table=emails&format=csv`);
  expect(emails.status()).toBe(200);
  expect(emails.headers()['content-disposition']).toBe('attachment; filename="parakeet-emails.csv"');
  expect(emails.headers()['x-partial']).toBe('false');
  const emailLines = (await emails.text()).split('\r\n');
  expect(emailLines[0]).toBe(EMAIL_COLUMNS.join(','));
  expect(emailLines[1]).toContain('csv@example.com');
  expect(emailLines[1].split(',')[EMAIL_COLUMNS.indexOf('plan')]).toBe('yearly');

  const raw = await request.get(`/admin?key=${ADMIN_KEY}&table=raw&day=2026-10-25&format=csv`);
  expect(raw.status()).toBe(200);
  expect(raw.headers()['content-disposition']).toBe('attachment; filename="parakeet-raw-2026-10-25.csv"');
  expect(raw.headers()['x-partial']).toBe('false');
  const rawLines = (await raw.text()).split('\r\n');
  expect(rawLines[0]).toBe(RAW_COLUMNS.join(','));
  expect(rawLines.filter(Boolean).length).toBe(1 + harness.blobs.rows('events').length);
  const viaIdx = RAW_COLUMNS.indexOf('via');
  const holdRow = rawLines.slice(1).map((l) => l.split(',')).find((c) => c[RAW_COLUMNS.indexOf('button')] === 'plan_yearly');
  expect(holdRow[viaIdx]).toBe('hold');

  const json = await request.get(`/admin?key=${ADMIN_KEY}&table=raw&day=2026-10-25`);
  expect(json.status()).toBe(200);
  const rawJson = await json.json();
  expect(rawJson.day).toBe('2026-10-25');
  expect(rawJson.partial).toBe(false);
  expect(rawJson.rows.length).toBe(5);
  // the clock is frozen, so every row has the same received; the order within it is the key's random part
  expect(rawJson.rows.map((r) => r.event).sort()).toEqual(['email', 'leave', 'pageview', 'tap', 'tap']);
});
