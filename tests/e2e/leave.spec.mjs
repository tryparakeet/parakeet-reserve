// The leave beacon on a REAL unload, with no page.route in place (Playwright's request interception drops a
// pending beacon when the frame navigates, so a spec that routes the clip cannot assert this): the footer
// Privacy link, and closing the page. Playwright's Chromium has no H.264, so the shipped clip never plays
// here and the leave carries video: blocked. hide()/show() in the other specs stay inside the page.

import { test, expect, TAGGED_QS, waitForRows, rowsOf } from './fixtures.mjs';

test('the footer Privacy link: one leave row lands before the navigation, with the seconds and the video state', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.goto(TAGGED_QS);
  const [pv] = await waitForRows(blobs, { event: 'pageview' });
  await page.waitForTimeout(1100);
  await page.locator('.foot-links a[href="/privacy"]').click();
  await page.waitForURL(/\/privacy$/);
  await expect(page.locator('h1')).toContainText('Privacy');
  const [leave] = await waitForRows(blobs, { event: 'leave' });
  expect(leave.vid).toBe(pv.vid);
  expect(leave.flag).toBe('gate');
  expect(leave.seconds).toBeGreaterThanOrEqual(1);
  expect(leave.video).toBe('blocked');
  await page.waitForTimeout(400);
  expect(rowsOf(blobs, { event: 'leave' }).length, 'one leave for the unload').toBe(1);
  expect(rowsOf(blobs, { event: 'pageview' }).length, 'the legal page sends nothing').toBe(1);
  const out = await harness.admin();
  expect(out.total.sources.tiktok.leave).toEqual({ n: 1, avg_seconds: leave.seconds });
  expect(out.total.sources.tiktok.video).toEqual({ playing: 0, blocked: 1, both: 0 });
});

test('closing the page sends the leave beacon', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.goto(TAGGED_QS);
  const [pv] = await waitForRows(blobs, { event: 'pageview' });
  await page.close();
  const [leave] = await waitForRows(blobs, { event: 'leave' });
  expect(leave.vid).toBe(pv.vid);
  expect(typeof leave.seconds).toBe('number');
  expect(leave.video).toBe('blocked');
  const out = await harness.admin();
  expect(out.total.sources.tiktok.leave.n).toBe(1);
  expect(out.total.sources.tiktok.uniques).toBe(1);
});
