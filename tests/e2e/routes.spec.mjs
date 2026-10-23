// The site's routes as the harness reproduces the toml: /go (302 with the exact Location, and the landing
// counted under sources.typed.content.endcard), /privacy, /terms, /robots.txt, the CSP header on / and
// /privacy, traversal rejected, 404; plus the screenshots for the acceptance record.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, TAGGED_QS, TYPED_LOCATION, waitForRows, sheetSettled, RESULTS_DIR } from './fixtures.mjs';
import { parseHeaderRules, TOML_PATH } from '../helpers/harness.mjs';
import { readFileSync } from 'node:fs';

const CSP = parseHeaderRules(readFileSync(TOML_PATH, 'utf8')).find((r) => r.for === '/*').values['Content-Security-Policy'];

test('/go is a 302 to the typed tags, exactly, with and without a query or a trailing slash', async ({ request }) => {
  for (const path of ['/go', '/go?x=1', '/go/']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(302);
    expect(res.headers().location, path).toBe(TYPED_LOCATION);
  }
});

test('page.goto(/go) lands with the typed tags and is counted under sources.typed.content.endcard', async ({ page, harness }) => {
  await page.goto('/go');
  expect(new URL(page.url()).search).toBe(TYPED_LOCATION.slice(1));
  const [pv] = await waitForRows(harness.blobs, { event: 'pageview' });
  expect(pv.utm_source).toBe('typed');
  expect(pv.utm_medium).toBe('organic');
  expect(pv.utm_campaign).toBe('gate0');
  expect(pv.utm_content).toBe('endcard');
  expect(pv.flag).toBe('gate');
  const out = await harness.admin();
  expect(out.total.sources.typed.uniques).toBe(1);
  expect(out.total.sources.typed.content.endcard.uniques).toBe(1);
  expect(out.total.sources.tiktok).toBeUndefined();
  expect(out.total.blended.uniques).toBe(1);
});

test('/privacy and /terms serve the legal pages; /robots.txt keeps the crawlers off /admin and /api/', async ({ request }) => {
  const privacy = await request.get('/privacy');
  expect(privacy.status()).toBe(200);
  expect(privacy.headers()['content-type']).toContain('text/html');
  const privacyText = await privacy.text();
  expect(privacyText).toContain('<title>Privacy');
  expect(privacyText).toContain('pk_v');
  expect(privacyText).toContain('app.parakeet@gmail.com');

  const terms = await request.get('/terms');
  expect(terms.status()).toBe(200);
  expect(terms.headers()['content-type']).toContain('text/html');
  const termsText = await terms.text();
  expect(termsText).toContain('<title>Terms');
  expect(termsText).toContain('Nothing is charged');

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect((await robots.text()).trim().split(/\r?\n/)).toEqual(['User-agent: *', 'Disallow: /admin', 'Disallow: /api/']);
});

test('the CSP header is on / and /privacy, is the toml\'s, and connect-src is self', async ({ request }) => {
  expect(CSP).toBeTruthy();
  for (const path of ['/', '/privacy']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const h = res.headers();
    expect(h['content-security-policy'], path).toBe(CSP);
    expect(h['content-security-policy']).toContain("connect-src 'self'");
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['strict-transport-security'], path).toContain('max-age=');
  }
  // never on the function or the redirect
  const fn = await request.get('/admin?key=x');
  expect(fn.headers()['content-security-policy']).toBeUndefined();
  const go = await request.get('/go', { maxRedirects: 0 });
  expect(go.headers()['content-security-policy']).toBeUndefined();
});

test('traversal is rejected after decoding, unknown paths are 404, static assets carry the immutable cache rule', async ({ request }) => {
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/media/..%2f..%2fpackage.json', '/assets/../../netlify.toml']) {
    const res = await request.get(path);
    expect([400, 404], path).toContain(res.status());
    expect(await res.text(), path).not.toContain('parakeet-reserve');
  }
  expect((await request.get('/nope')).status()).toBe(404);
  expect((await request.get('/api')).status()).toBe(404);
  const asset = await request.get('/favicon.svg');
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('image/svg+xml');
  expect(asset.headers()['cache-control']).toContain('max-age=604800');
  const media = await request.head('/media/iphone-bezel-v1.webp');
  expect(media.status()).toBe(200);
  expect(media.headers()['content-type']).toBe('image/webp');
  expect(media.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

// The acceptance record (brief 2, step 10): at 375x667 and 393x852, the first screen (after the answer
// line's one pass), the page scrolled to the footer, the plan sheet, the email step, and both done states,
// written to test-results/screenshots/ on every run (Playwright empties test-results/ when a run starts,
// so the set is always the current page).
async function settleMotion(page) {
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  await page.waitForTimeout(100);
}

for (const vp of [{ width: 375, height: 667 }, { width: 393, height: 852 }]) {
  for (const plan of ['yearly', 'monthly']) {
    test(`screenshots at ${vp.width}x${vp.height}, ${plan}: the first screen, the footer, the plan sheet, the email step, done`, async ({ page }) => {
      const size = `${vp.width}x${vp.height}`;
      const dir = join(RESULTS_DIR, 'screenshots');
      mkdirSync(dir, { recursive: true });
      const shot = (name) => page.screenshot({ path: join(dir, `${size}-${name}.png`), fullPage: false });
      await page.setViewportSize(vp);
      await page.goto(TAGGED_QS);
      await expect(page.locator('h1')).toBeVisible();
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      await settleMotion(page);
      if (plan === 'yearly') {
        await shot('1-first-screen');
        for (let y = 100; y <= 1400; y += 100) await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(700);   // past the 500 ms scroll fade
        await shot('2-footer');
        await page.evaluate(() => window.scrollTo(0, 0));
      }

      await page.locator('[data-tap="reserve"]').click();
      await sheetSettled(page);
      if (plan === 'monthly') await page.locator('[data-tap="plan_monthly"]').click();
      if (plan === 'yearly') await shot('3-plan-sheet');

      await page.locator('#hold').click();
      await expect(page.locator('#step-2')).toBeVisible();
      await expect(page.locator('#email')).toBeFocused();
      await page.waitForTimeout(200);
      if (plan === 'yearly') await shot('4-email-step');

      await page.locator('#email').fill('you@example.com');
      await page.locator('#email-form button[type="submit"]').click();
      await expect(page.locator('#step-3')).toBeVisible();
      await page.waitForTimeout(200);
      await shot(`5-done-${plan}`);
    });
  }
}
