// The visitor-id cookie end to end: the function's Set-Cookie on the first POST (90 days, Secure, stored
// by Chromium from http://localhost), the browser's cookie equal to the row's vid, a second untagged
// navigation keeping it, and the untagged rows joining the tagged visitor at read.

import { test, expect, TAGGED_QS, waitForRows } from './fixtures.mjs';

test('pk_v is set by the function for 90 days, kept by the browser, and the untagged visit joins the tagged visitor', async ({ page, context, harness }) => {
  const { blobs } = harness;
  const firstPost = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/event');
  await page.goto(TAGGED_QS);
  const res = await firstPost;
  expect(res.status()).toBe(204);
  const headers = await res.allHeaders();
  const setCookie = headers['set-cookie'] || '';
  const m = /^pk_v=([a-z0-9]{24}); Max-Age=7776000; Path=\/; SameSite=Lax; Secure$/.exec(setCookie.trim());
  expect(m, `set-cookie: ${setCookie}`).not.toBeNull();
  expect(setCookie).toContain('Max-Age=7776000');

  const [pv] = await waitForRows(blobs, { event: 'pageview' });
  expect(pv.vid).toBe(m[1]);

  const cookies = await context.cookies(harness.url);
  const pk = cookies.find((c) => c.name === 'pk_v');
  expect(pk, 'the browser stored pk_v').toBeTruthy();
  expect(pk.value).toHaveLength(24);
  expect(pk.value).toBe(pv.vid);
  expect(pk.secure).toBe(true);
  expect(pk.sameSite).toBe('Lax');
  expect(pk.path).toBe('/');
  // a 90-day cookie: Chromium reports expires in seconds since the epoch
  const days = (pk.expires - Date.now() / 1000) / 86400;
  expect(days).toBeGreaterThan(88);
  expect(days).toBeLessThanOrEqual(90.5);

  // a second, untagged navigation keeps the id
  await page.goto('/');
  const pvs = await waitForRows(blobs, { event: 'pageview' }, { count: 2 });
  expect(pvs.map((r) => r.vid)).toEqual([pv.vid, pv.vid]);
  const untagged = pvs.find((r) => r.utm_source === '');
  expect(untagged, 'the second pageview has no tags').toBeTruthy();
  expect(untagged.flag).toBe('no_utm');
  const again = (await context.cookies(harness.url)).find((c) => c.name === 'pk_v');
  expect(again.value).toBe(pv.vid);

  // at read, the untagged rows belong to the tagged visitor
  const out = await harness.admin();
  expect(out.total.sources.tiktok.uniques).toBe(1);
  expect(out.total.sources.tiktok.pageviews).toBe(1);
  expect(out.total.excluded.no_utm.uniques).toBe(0);
  expect(out.total.excluded.no_utm.pageviews).toBe(1);
  expect(out.total.blended.uniques).toBe(1);
});
