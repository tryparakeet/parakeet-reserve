// The site's routes as the harness reproduces the toml: /go (302 with the exact Location, and the landing
// counted under sources.typed.content.endcard), /privacy, /terms, /support, /robots.txt, the CSP header on
// /, /privacy and /support, traversal rejected, 404.

import { readFileSync } from 'node:fs';
import { test, expect, TYPED_LOCATION, waitForRows } from './fixtures.mjs';
import { parseHeaderRules, TOML_PATH } from '../helpers/harness.mjs';

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

test('/privacy, /terms and /support serve their pages; /robots.txt keeps the crawlers off /admin and /api/', async ({ request }) => {
  const privacy = await request.get('/privacy');
  expect(privacy.status()).toBe(200);
  expect(privacy.headers()['content-type']).toContain('text/html');
  const privacyText = await privacy.text();
  expect(privacyText).toContain('<title>Privacy');
  expect(privacyText).toContain('pk_v');
  expect(privacyText).toContain('support.parakeet@gmail.com');

  const terms = await request.get('/terms');
  expect(terms.status()).toBe(200);
  expect(terms.headers()['content-type']).toContain('text/html');
  const termsText = await terms.text();
  expect(termsText).toContain('<title>Terms');
  expect(termsText).toContain('Nothing is charged');

  const support = await request.get('/support');
  expect(support.status()).toBe(200);
  expect(support.headers()['content-type']).toContain('text/html');
  const supportText = await support.text();
  expect(supportText).toContain('<title>Support');
  expect(supportText).toContain('support.parakeet@gmail.com');
  expect(supportText).toContain('How do I cancel?');

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect((await robots.text()).trim().split(/\r?\n/)).toEqual(['User-agent: *', 'Disallow: /admin', 'Disallow: /api/']);
});

test('the CSP header is on /, /privacy and /support, is the toml\'s, and connect-src is self', async ({ request }) => {
  expect(CSP).toBeTruthy();
  for (const path of ['/', '/privacy', '/support']) {
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
