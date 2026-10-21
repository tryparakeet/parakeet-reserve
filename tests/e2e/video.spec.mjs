// The video's final state. Blocked: the clip URL answers 404, so nothing ever plays; no video row on its
// own, one leave row carrying video: blocked on the first hide and none on the second; the visible play
// button's press is its own tap row and precedes any video state. Playing: the clip URL serves the VP9
// test clip (Playwright's Chromium has no H.264), so exactly one video: playing row is sent, the box gets
// .is-playing, the overlay is hidden and the leave carries no blocked state.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, TAGGED_QS, clipPaths, waitForRows, rowsOf, settle, hide, show, ROOT } from './fixtures.mjs';

const { clip: CLIP } = clipPaths();
const TEST_CLIP = readFileSync(join(ROOT, 'tests', 'fixtures', 'clip-test.webm'));

const isClip = (url) => url.pathname === CLIP;
const withVideo = (r) => typeof r.video === 'string';

test('blocked: no video row by itself, one leave with video: blocked, no second blocked, the play tap precedes any state', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.route(isClip, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'no clip' }));
  await page.goto(TAGGED_QS);
  await waitForRows(blobs, { event: 'pageview' });
  await page.waitForTimeout(1500);
  expect(rowsOf(blobs, { event: 'video' }), 'no video row after 1.5 s').toEqual([]);
  expect(rowsOf(blobs, withVideo), 'no row with a video state yet').toEqual([]);
  await expect(page.locator('#clip-box')).not.toHaveClass(/is-playing/);
  await expect(page.locator('.play')).toBeVisible();

  // the visible play button: its press is a tap, and still no video state
  await page.locator('.play').click();
  const [tapPlay] = await waitForRows(blobs, { event: 'tap', button: 'play' });
  expect(tapPlay.via).toBeUndefined();
  expect((await settle(blobs, withVideo, 600)).length).toBe(0);

  await hide(page);
  const leaves = await waitForRows(blobs, { event: 'leave' });
  expect(leaves.length).toBe(1);
  expect(leaves[0].video).toBe('blocked');
  expect(rowsOf(blobs, { event: 'video' })).toEqual([]);
  // the clock is frozen (every row has the same received), so arrival order is read from the store's
  // write log: the tap row was written before any row carrying a video state
  const dump = blobs.dump('events');
  const writes = blobs.log.filter((l) => l.store === 'events' && l.op === 'setJSON').map((l) => dump[l.key]);
  const tapAt = writes.findIndex((r) => r && r.event === 'tap' && r.button === 'play');
  const stateAt = writes.findIndex((r) => r && withVideo(r));
  expect(tapAt).toBeGreaterThanOrEqual(0);
  expect(stateAt).toBeGreaterThan(tapAt);

  // a second hide: a plain leave, no second blocked
  await show(page);
  await hide(page);
  const two = await waitForRows(blobs, { event: 'leave' }, { count: 2 });
  expect(two.length).toBe(2);
  expect(two.filter((r) => r.video === 'blocked').length).toBe(1);
  expect(two.filter((r) => r.video === undefined).length).toBe(1);

  const out = await harness.admin();
  const tt = out.total.sources.tiktok;
  expect(tt.video).toEqual({ playing: 0, blocked: 1, both: 0 });
  expect(tt.video_events).toEqual({ playing: 0, blocked: 1 });
  expect(tt.play_taps).toBe(1);
  expect(tt.leave.n).toBe(1);
});

test('playing: exactly one video: playing row, .is-playing set, the overlay hidden, no blocked at leave', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.route(isClip, (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: TEST_CLIP }));
  await page.goto(TAGGED_QS);
  await waitForRows(blobs, { event: 'pageview' });
  const [playing] = await waitForRows(blobs, { event: 'video', video: 'playing' }, { timeout: 8000 });
  expect(playing.flag).toBe('gate');
  await expect(page.locator('#clip-box')).toHaveClass(/is-playing/);
  await expect(page.locator('.play'), 'the overlay is not clickable while the clip plays').toBeHidden();
  const state = await page.evaluate(() => {
    const v = document.getElementById('clip');
    return { paused: v.paused, muted: v.muted, time: v.currentTime, ended: v.ended };
  });
  expect(state.paused).toBe(false);
  expect(state.muted).toBe(true);
  expect(state.time).toBeGreaterThan(0);
  expect((await settle(blobs, { event: 'video' }, 800)).length, 'exactly one playing row').toBe(1);

  await hide(page);
  const [leave] = await waitForRows(blobs, { event: 'leave' });
  expect(leave.video).toBeUndefined();
  expect(rowsOf(blobs, { event: 'video' }).length).toBe(1);

  const out = await harness.admin();
  const tt = out.total.sources.tiktok;
  expect(tt.video).toEqual({ playing: 1, blocked: 0, both: 0 });
  expect(tt.video_events).toEqual({ playing: 1, blocked: 0 });
  expect(tt.play_taps).toBe(0);
});
