// Hero B has no clip (brief 2, step 6): no <video> on the page, so no video row and no video state on the
// leave beacon, and nothing sends a play tap. The play button name and the video event stay allowlisted in
// event.mjs (a stray row is still stored and counted, as before), but this page never emits them.

import { test, expect, TAGGED_QS, waitForRows, rowsOf, settle, hide, show } from './fixtures.mjs';

test('no clip: no video row, no play tap, and the leave beacons carry no video state', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.goto(TAGGED_QS);
  await waitForRows(blobs, { event: 'pageview' });
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('[data-tap="play"]')).toHaveCount(0);
  await page.locator('[data-tap="reserve"]').click();
  await waitForRows(blobs, { event: 'tap', button: 'reserve' });
  expect(await settle(blobs, { event: 'video' }, 800)).toEqual([]);

  await hide(page);
  await waitForRows(blobs, { event: 'leave' });
  await show(page);
  await hide(page);
  const leaves = await waitForRows(blobs, { event: 'leave' }, { count: 2 });
  expect(leaves.map((r) => r.video)).toEqual([undefined, undefined]);
  expect(rowsOf(blobs, (r) => typeof r.video === 'string')).toEqual([]);
  expect(rowsOf(blobs, { event: 'tap', button: 'play' })).toEqual([]);

  const out = await harness.admin();
  const tt = out.total.sources.tiktok;
  expect(tt.video).toEqual({ playing: 0, blocked: 0, both: 0 });
  expect(tt.video_events).toEqual({ playing: 0, blocked: 0 });
  expect(tt.play_taps).toBe(0);
  expect(tt.leave.n).toBe(1);
});
