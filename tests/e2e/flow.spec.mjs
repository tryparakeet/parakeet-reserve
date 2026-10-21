// The whole visit through the browser, asserted from the store: pageview with the tags and the evidence,
// reserve, seen once, the plan cards (press and keyboard), Hold my spot, the email step, Done, the three
// ways to close, the leave beacon, and the summary the admin would read for it. Then Hold my spot without
// a card press (via: hold, and the via column of the raw CSV), the leave max across hides, and the double
// tap on "Reserve 2 free weeks": the second tap lands inside the sheet and is dropped (no plan row).
//
// Every in-sheet click that follows an open awaits sheetSettled(): presses inside the sheet during its
// first 500 ms are dropped on purpose (see fixtures.mjs).

import { test, expect, TAGGED, TAGGED_QS, waitForRows, rowsOf, settle, hide, show, sheetSettled, ADMIN_KEY } from './fixtures.mjs';

test('tagged visit: reserve, seen, plan cards, Hold my spot, email, Done, close paths, leave, summary', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.goto(TAGGED_QS);

  // pageview
  const [pv] = await waitForRows(blobs, { event: 'pageview' });
  expect(pv.flag).toBe('gate');
  expect(pv.utm_source).toBe(TAGGED.utm_source);
  expect(pv.utm_medium).toBe(TAGGED.utm_medium);
  expect(pv.utm_campaign).toBe(TAGGED.utm_campaign);
  expect(pv.utm_content).toBe(TAGGED.utm_content);
  expect(pv.scr).toBe('375x667');
  expect(pv.wd).toBe(false);
  expect(pv.ua).toContain('iPhone');
  expect(pv.device).toBe('ios');
  expect(pv.inapp).toBe('none');
  expect(pv.vid).toMatch(/^[a-z0-9]{24}$/);
  expect(pv.received).toBe('2026-10-25T12:00:00.000Z');
  const vid = pv.vid;

  // reserve -> tap row, sheet open, seen once
  const reserve = page.locator('[data-tap="reserve"]');
  await reserve.click();
  const [tapReserve] = await waitForRows(blobs, { event: 'tap', button: 'reserve' });
  expect(tapReserve.vid).toBe(vid);
  expect(tapReserve.via).toBeUndefined();
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('#step-1')).toBeVisible();
  await expect(page.locator('#sheet-title-1')).toHaveText('Parakeet launches in January. Which plan should your 2 free weeks start on?');
  const [seen] = await waitForRows(blobs, { event: 'seen' });
  expect(seen.vid).toBe(vid);
  await sheetSettled(page);

  // reopen sends no second seen
  await page.locator('.sheet-x').click();
  await expect(page.locator('#sheet')).toBeHidden();
  await reserve.click();
  await waitForRows(blobs, { event: 'tap', button: 'reserve' }, { count: 2 });
  await expect(page.locator('#sheet')).toBeVisible();
  await sheetSettled(page);
  expect((await settle(blobs, { event: 'seen' })).length).toBe(1);

  // Monthly card -> tap plan_monthly via card, aria flips
  const yearly = page.locator('[data-tap="plan_yearly"]');
  const monthly = page.locator('[data-tap="plan_monthly"]');
  await expect(yearly).toHaveAttribute('aria-checked', 'true');
  await expect(monthly).toHaveAttribute('aria-checked', 'false');
  await monthly.click();
  const [tapMonthly] = await waitForRows(blobs, { event: 'tap', button: 'plan_monthly' });
  expect(tapMonthly.via).toBe('card');
  expect(tapMonthly.vid).toBe(vid);
  await expect(monthly).toHaveAttribute('aria-checked', 'true');
  await expect(yearly).toHaveAttribute('aria-checked', 'false');
  await expect(monthly).toHaveAttribute('tabindex', '0');
  await expect(yearly).toHaveAttribute('tabindex', '-1');

  // ArrowUp from Monthly -> the Yearly card is clicked: tap plan_yearly via card
  await monthly.focus();
  await page.keyboard.press('ArrowUp');
  const [tapYearly] = await waitForRows(blobs, { event: 'tap', button: 'plan_yearly' });
  expect(tapYearly.via).toBe('card');
  await expect(yearly).toHaveAttribute('aria-checked', 'true');
  await expect(monthly).toHaveAttribute('aria-checked', 'false');
  await expect(yearly).toBeFocused();

  // Hold my spot -> step 2, email focused, no new row (a plan tap was already sent this load)
  const before = blobs.rows('events').length;
  await page.locator('#hold').click();
  await expect(page.locator('#step-2')).toBeVisible();
  await expect(page.locator('#step-1')).toBeHidden();
  await expect(page.locator('#email')).toBeFocused();
  await expect(page.locator('#sheet-panel')).toHaveAttribute('aria-labelledby', 'sheet-title-2');
  expect((await settle(blobs)).length).toBe(before);

  // bad email -> aria-invalid, no row
  await page.locator('#email').fill('nope');
  await page.locator('#email-form button[type="submit"]').click();
  await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
  expect((await settle(blobs, { event: 'email' })).length).toBe(0);
  await expect(page.locator('#step-2')).toBeVisible();

  // a good one -> email row with the plan, step 3
  await page.locator('#email').fill('test@example.com');
  await page.locator('#email-form button[type="submit"]').click();
  const [emailRow] = await waitForRows(blobs, { event: 'email' });
  expect(emailRow.email).toBe('test@example.com');
  expect(emailRow.plan).toBe('yearly');
  expect(emailRow.vid).toBe(vid);
  expect(emailRow.flag).toBe('gate');
  await expect(page.locator('#step-3')).toBeVisible();
  await expect(page.getByRole('heading', { name: "You're on the list." })).toBeVisible();
  await expect(page.getByText("Your 2 free weeks are reserved. We'll email you once, when Parakeet is live.")).toBeVisible();

  // Done closes; focus returns to the reserve button
  await page.locator('#step-3 [data-close]').click();
  await expect(page.locator('#sheet')).toBeHidden();
  await expect(reserve).toBeFocused();

  // Escape closes
  await reserve.click();
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('#step-1'), 'reopen starts at step 1').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden();

  // the backdrop closes (once the sheet has settled; earlier presses are dropped, see the last cases)
  await reserve.click();
  await sheetSettled(page);
  await page.locator('.sheet-backdrop').click({ position: { x: 12, y: 12 } });
  await expect(page.locator('#sheet')).toBeHidden();

  // hide -> leave row
  await hide(page);
  const [leave] = await waitForRows(blobs, { event: 'leave' });
  expect(leave.vid).toBe(vid);
  expect(typeof leave.seconds).toBe('number');
  expect(leave.seconds).toBeGreaterThanOrEqual(0);
  expect(leave.flag).toBe('gate');

  // the summary the admin reads for this visit
  const out = await harness.admin();
  expect(out.version).toBe(7);
  expect(out.partial).toBe(false);
  expect(out.pending).toEqual([]);
  const tt = out.total.sources.tiktok;
  expect(tt.uniques).toBe(1);
  expect(tt.reserve_taps).toBe(1);
  expect(tt.plan_taps).toBe(1);
  expect(tt.plan_yearly_taps).toBe(1);
  expect(tt.plan_monthly_taps).toBe(1);
  expect(tt.plan_rate).toBe(1);
  expect(tt.emails).toBe(1);
  expect(tt.seen).toBe(1);
  expect(tt.pageviews).toBe(1);
  expect(tt.tap_events_reserve, 'the sheet was opened four times').toBe(4);
  expect(tt.leave.n).toBe(1);
  expect(tt.content.fri23.uniques).toBe(1);
  expect(tt.content.fri23.plan_rate).toBe(1);
  expect(out.total.blended.uniques).toBe(1);
  expect(out.total.blended.plan_rate).toBe(1);
  for (const k of ['smoke', 'no_utm', 'bot', 'prestart']) expect(out.total.excluded[k].uniques, `excluded.${k}`).toBe(0);
  expect(out.days.length).toBe(1);
  expect(out.days[0].day).toBe('2026-10-25');
  expect(out.emails.length).toBe(1);
  expect(out.emails[0].email).toBe('test@example.com');
  expect(out.emails[0].plan).toBe('yearly');
});

test('Hold my spot without a card press records the preselected plan with via: hold; the raw CSV has the via column', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.goto(TAGGED_QS);
  await waitForRows(blobs, { event: 'pageview' });
  await page.locator('[data-tap="reserve"]').click();
  await waitForRows(blobs, { event: 'tap', button: 'reserve' });
  await sheetSettled(page);
  await expect(page.locator('[data-tap="plan_yearly"]')).toHaveAttribute('aria-checked', 'true');
  expect(rowsOf(blobs, (r) => r.event === 'tap' && String(r.button).startsWith('plan_')).length, 'no plan row before Hold my spot').toBe(0);

  await page.locator('#hold').click();
  const [planTap] = await waitForRows(blobs, { event: 'tap', button: 'plan_yearly' });
  expect(planTap.via).toBe('hold');
  await expect(page.locator('#step-2')).toBeVisible();
  await expect(page.locator('#email')).toBeFocused();
  expect(rowsOf(blobs, (r) => r.event === 'tap' && String(r.button).startsWith('plan_')).length).toBe(1);

  // pressing Hold my spot again (back at step 1 after a reopen) sends no second plan row
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden();
  await page.locator('[data-tap="reserve"]').click();
  await expect(page.locator('#step-1')).toBeVisible();
  await sheetSettled(page);
  await page.locator('#hold').click();
  await expect(page.locator('#step-2')).toBeVisible();
  expect((await settle(blobs, (r) => r.event === 'tap' && String(r.button).startsWith('plan_'))).length).toBe(1);

  const res = await harness.adminResponse({ table: 'raw', day: '2026-10-25', format: 'csv' });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/csv');
  expect(res.headers.get('content-disposition')).toContain('parakeet-raw-2026-10-25.csv');
  const csv = await res.text();
  const lines = csv.split('\r\n');
  const header = lines[0].split(',');
  expect(header).toContain('via');
  expect(header).toContain('plan');
  const viaIdx = header.indexOf('via');
  const buttonIdx = header.indexOf('button');
  const eventIdx = header.indexOf('event');
  const planRows = lines.slice(1).filter(Boolean).map((l) => l.split(',')).filter((c) => c[eventIdx] === 'tap' && c[buttonIdx] === 'plan_yearly');
  expect(planRows.length).toBe(1);
  expect(planRows[0][viaIdx]).toBe('hold');

  const out = await harness.admin();
  expect(out.total.sources.tiktok.plan_taps).toBe(1);
  expect(out.total.sources.tiktok.plan_yearly_taps).toBe(1);
  expect(out.total.sources.tiktok.plan_rate).toBe(1);
});

test('hidden, visible, hidden: one leave per visitor in the summary with the larger seconds', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.goto(TAGGED_QS);
  await waitForRows(blobs, { event: 'pageview' });
  await page.waitForTimeout(1100);
  await hide(page);
  const [first] = await waitForRows(blobs, { event: 'leave' });
  await show(page);
  await page.waitForTimeout(1100);
  await hide(page);
  const leaves = await waitForRows(blobs, { event: 'leave' }, { count: 2 });
  expect(leaves.length).toBe(2);
  // the clock is frozen (same received on both), so the rows are told apart by their seconds
  const seconds = leaves.map((r) => r.seconds).sort((a, b) => a - b);
  expect(seconds[0]).toBe(first.seconds);
  expect(seconds[1], 'the second hide reports more time on the page').toBeGreaterThan(seconds[0]);
  const larger = seconds[1];
  const out = await harness.admin({}, { key: ADMIN_KEY });
  const tt = out.total.sources.tiktok;
  expect(tt.leave.n).toBe(1);
  expect(tt.leave.avg_seconds).toBe(larger);
  expect(tt.uniques).toBe(1);
});

// A double tap on "Reserve 2 free weeks": the sheet's button and the plan cards slide in under the same
// spot, so without the guard the second tap would press "Hold my spot" (or a card) and record a plan the
// visitor never chose. Three gaps, timed from the first tap: at ~60 ms the second tap meets a sliding
// card, at 250 and 400 ms the settled "Hold my spot". Touch taps at the CTA's centre, as on a phone.
const isPlanTap = (r) => r.event === 'tap' && String(r.button).startsWith('plan_');

for (const gap of [60, 250, 400]) {
  test(`double tap on Reserve 2 free weeks, ${gap} ms apart: the second tap is dropped, no plan row, step 1 stays`, async ({ page, harness }) => {
    const { blobs } = harness;
    await page.setViewportSize({ width: 375, height: 553 });
    await page.goto(TAGGED_QS);
    const [pv] = await waitForRows(blobs, { event: 'pageview' });
    const box = await page.locator('.cta .btn').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    const t0 = Date.now();
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(Math.max(0, gap - 40));
    const under = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const sheet = document.getElementById('sheet');
      return { inSheet: !!(el && sheet.contains(el)), what: el ? (el.id || String(el.className)) : '' };
    }, [x, y]);
    expect(under.inSheet, `the second tap lands inside the sheet (on ${under.what})`).toBe(true);
    await page.waitForTimeout(Math.max(0, gap - (Date.now() - t0)));
    await page.touchscreen.tap(x, y);

    await expect(page.locator('#sheet')).toBeVisible();
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('#step-2')).toBeHidden();
    await waitForRows(blobs, { event: 'tap', button: 'reserve' });
    expect(await settle(blobs, isPlanTap, 600), 'no plan row from the dropped tap').toEqual([]);
    expect(rowsOf(blobs, { event: 'tap', button: 'reserve' }).length, 'one reserve row').toBe(1);
    await expect(page.locator('[data-tap="plan_yearly"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-tap="plan_monthly"]')).toHaveAttribute('aria-checked', 'false');

    // once settled, a press on Hold my spot is the visitor's own and counts as before
    await sheetSettled(page);
    await page.locator('#hold').click();
    const [planTap] = await waitForRows(blobs, { event: 'tap', button: 'plan_yearly' });
    expect(planTap.via).toBe('hold');
    expect(planTap.vid).toBe(pv.vid);
    await expect(page.locator('#step-2')).toBeVisible();
    expect(rowsOf(blobs, isPlanTap).length).toBe(1);
    const out = await harness.admin();
    expect(out.total.sources.tiktok.plan_taps).toBe(1);
    expect(out.total.sources.tiktok.plan_rate).toBe(1);
  });
}

test('a backdrop press in the first frames after opening is dropped too: the sheet stays open and consistent', async ({ page, harness }) => {
  const { blobs } = harness;
  await page.goto(TAGGED_QS);
  await waitForRows(blobs, { event: 'pageview' });
  // the second click of a dblclick hits the backdrop (the panel is still off-screen); before the guard it
  // closed the sheet while the pending open frame re-added the class: #sheet.open[hidden]
  await page.locator('.cta .btn').dblclick();
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    return { open: s.classList.contains('open'), hidden: s.hidden, settled: s.classList.contains('settled') };
  });
  expect(state).toEqual({ open: true, hidden: false, settled: true });
  await expect(page.locator('#hold')).toBeVisible();
  await expect(page.locator('#sheet-panel')).toBeFocused();
  expect(rowsOf(blobs, { event: 'tap', button: 'reserve' }).length).toBe(1);
  expect(rowsOf(blobs, isPlanTap)).toEqual([]);

  // settled: the backdrop closes it, and it reopens cleanly
  await sheetSettled(page);
  await page.locator('.sheet-backdrop').click({ position: { x: 12, y: 12 } });
  await expect(page.locator('#sheet')).toBeHidden();
  await page.locator('.cta .btn').click();
  await sheetSettled(page);
  await expect(page.locator('#step-1')).toBeVisible();
});
