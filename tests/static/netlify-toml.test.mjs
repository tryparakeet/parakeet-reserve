// netlify.toml, by regex over the file: the publish and functions dirs, Node 22, esbuild, the two forced
// function rewrites, /privacy and /terms, the /go rule exactly, a CSP whose every directive is 'self' or
// 'none' with connect-src 'self', a Referrer-Policy that is not no-referrer, nosniff, DENY and HSTS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');

// [[redirects]] and [[headers]] blocks as { key: value } maps, in file order.
function blocks(name) {
  const out = [];
  let current = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line === `[[${name}]]`) { current = {}; out.push(current); continue; }
    if (/^\[\[/.test(line)) { current = null; continue; }
    if (/^\[/.test(line)) continue; // [headers.values] and the like: keys keep flowing into the block
    if (!current) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
    current[m[1]] = v;
  }
  return out;
}

const redirects = blocks('redirects');
const headers = blocks('headers');

test('build: publish public, functions netlify/functions, Node 22, esbuild, devDependencies skipped', () => {
  assert.match(toml, /^\s*publish\s*=\s*"public"\s*$/m);
  assert.match(toml, /^\s*functions\s*=\s*"netlify\/functions"\s*$/m);
  assert.match(toml, /^\s*NODE_VERSION\s*=\s*"22"\s*$/m);
  assert.match(toml, /^\s*node_bundler\s*=\s*"esbuild"\s*$/m);
  assert.match(toml, /^\s*NPM_FLAGS\s*=\s*"--omit=dev"\s*$/m);
});

test('the two function rewrites are forced and come first', () => {
  const api = redirects.find((r) => r.from === '/api/*');
  const admin = redirects.find((r) => r.from === '/admin');
  assert.ok(api, '/api/* rule');
  assert.ok(admin, '/admin rule');
  for (const r of [api, admin]) {
    assert.equal(r.to, '/.netlify/functions/event');
    assert.equal(r.status, '200');
    assert.equal(r.force, 'true');
  }
  assert.equal(redirects.indexOf(api), 0, '/api/* is the first rule');
  assert.equal(redirects.indexOf(admin), 1, '/admin is the second rule');
  assert.equal(redirects.filter((r) => r.to === '/.netlify/functions/event').length, 2, 'only the two');
  assert.equal(redirects.filter((r) => /functions\//.test(r.to || '') && !/\/event$/.test(r.to)).length, 0, 'no other function');
});

test('/privacy and /terms rewrite to the html files with status 200', () => {
  const privacy = redirects.find((r) => r.from === '/privacy');
  const terms = redirects.find((r) => r.from === '/terms');
  assert.deepEqual({ to: privacy.to, status: privacy.status }, { to: '/privacy.html', status: '200' });
  assert.deepEqual({ to: terms.to, status: terms.status }, { to: '/terms.html', status: '200' });
  assert.notEqual(privacy.force, 'true');
  assert.notEqual(terms.force, 'true');
});

test('the /go rule exactly: 302, forced, to the typed tags', () => {
  const go = redirects.filter((r) => r.from === '/go');
  assert.equal(go.length, 1, 'one /go rule');
  assert.deepEqual(go[0], {
    from: '/go',
    to: '/?utm_source=typed&utm_medium=organic&utm_campaign=gate0&utm_content=endcard',
    status: '302',
    force: 'true'
  });
  // and literally, as four lines in this order
  assert.match(toml, /\[\[redirects\]\]\s*\n\s*from = "\/go"\s*\n\s*to = "\/\?utm_source=typed&utm_medium=organic&utm_campaign=gate0&utm_content=endcard"\s*\n\s*status = 302\s*\n\s*force = true\s*(\n|$)/);
  assert.ok(redirects.indexOf(go[0]) > 1, 'after the function rules');
});

test('the CSP on /*: every directive is self or none, connect-src is self, nothing third-party', () => {
  const all = headers.find((h) => h.for === '/*');
  assert.ok(all, 'a /* header block');
  const csp = all['Content-Security-Policy'];
  assert.ok(csp, 'Content-Security-Policy present');
  const directives = csp.split(';').map((d) => d.trim()).filter(Boolean);
  assert.ok(directives.length >= 8, `enough directives: ${directives.length}`);
  const names = new Set();
  for (const d of directives) {
    const [name, ...tokens] = d.split(/\s+/);
    names.add(name);
    assert.ok(tokens.length >= 1, `${name} has a value`);
    for (const t of tokens) assert.ok(t === "'self'" || t === "'none'", `${name}: token ${t} is 'self' or 'none'`);
  }
  for (const n of ['default-src', 'script-src', 'style-src', 'img-src', 'media-src', 'connect-src', 'font-src', 'form-action', 'base-uri', 'frame-ancestors', 'object-src']) assert.ok(names.has(n), `${n} present`);
  assert.match(csp, /(^|;)\s*connect-src 'self'\s*(;|$)/);
  assert.match(csp, /(^|;)\s*script-src 'self'\s*(;|$)/);
  assert.match(csp, /(^|;)\s*frame-ancestors 'none'\s*(;|$)/);
  assert.match(csp, /(^|;)\s*object-src 'none'\s*(;|$)/);
  assert.doesNotMatch(csp, /https?:|unsafe|data:|blob:|\*/);
});

test('the other security headers: Referrer-Policy not no-referrer, nosniff, DENY, HSTS', () => {
  const all = headers.find((h) => h.for === '/*');
  const referrer = all['Referrer-Policy'];
  assert.ok(referrer, 'Referrer-Policy present');
  assert.notEqual(referrer, 'no-referrer', 'no-referrer would send Origin: null on beacons and 403 every event');
  assert.equal(all['X-Content-Type-Options'], 'nosniff');
  assert.equal(all['X-Frame-Options'], 'DENY');
  assert.match(all['Strict-Transport-Security'] || '', /max-age=\d+/);
  assert.ok(all['Permissions-Policy'], 'Permissions-Policy present');
});

test('cache rules for /assets/*, /media/*, /favicon.ico and /favicon.svg', () => {
  for (const path of ['/assets/*', '/media/*']) {
    const h = headers.find((x) => x.for === path);
    assert.ok(h, `${path} block`);
    assert.equal(h['Cache-Control'], 'public, max-age=31536000, immutable');
  }
  for (const path of ['/favicon.ico', '/favicon.svg']) {
    const h = headers.find((x) => x.for === path);
    assert.ok(h, `${path} block`);
    assert.match(h['Cache-Control'], /max-age=\d+/);
  }
});
