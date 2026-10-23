// The repo as a whole: package.json (one dependency, one pinned devDependency, the scripts), the identity
// scrub over everything that ships, event.mjs's constants and exports, the cookie name agreeing across the
// function, the client and the privacy page, .gitignore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import * as mod from '../../netlify/functions/event.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (f) => relative(ROOT, f);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const eventSrc = readFileSync(join(ROOT, 'netlify', 'functions', 'event.mjs'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
const privacySrc = readFileSync(join(ROOT, 'public', 'privacy.html'), 'utf8');

test('package.json: name, one dependency, playwright pinned exactly, the scripts, engines', () => {
  assert.equal(pkg.name, 'parakeet-reserve');
  assert.equal(pkg.private, true);
  assert.deepEqual(Object.keys(pkg.dependencies || {}), ['@netlify/blobs']);
  assert.match(pkg.dependencies['@netlify/blobs'], /^\^?11\./);
  assert.deepEqual(Object.keys(pkg.devDependencies || {}), ['playwright']);
  assert.match(pkg.devDependencies.playwright, /^\d+\.\d+\.\d+$/, 'playwright is pinned to an exact version');
  assert.equal(pkg.devDependencies.playwright, '1.56.1');
  for (const s of ['test', 'test:e2e', 'check', 'serve']) assert.ok(pkg.scripts && pkg.scripts[s], `script ${s}`);
  assert.match(pkg.scripts.test, /node --test/);
  assert.match(pkg.scripts.test, /tests\/unit/);
  assert.match(pkg.scripts.test, /tests\/static/);
  assert.doesNotMatch(pkg.scripts.test, /e2e/, 'npm test never starts a browser');
  assert.equal(pkg.scripts['test:e2e'], 'playwright test');
  assert.equal(pkg.scripts.serve, 'node scripts/serve.mjs');
  assert.ok(pkg.engines && pkg.engines.node, 'engines.node');
  assert.ok(!pkg.scripts.postinstall && !pkg.scripts.prepare, 'no install hooks');
});

test('identity scrub: nothing of Restline ships', () => {
  const targets = [...walk(join(ROOT, 'public')), ...walk(join(ROOT, 'netlify')), join(ROOT, 'netlify.toml'), join(ROOT, 'package.json')];
  const banned = ['restline', 'Restline', 'RESTLINE', 'rl_v', 'hello@', 'E0252B', 'e0252b', 'inter.woff2', '"Inter"', 'Inter Fallback', 'restline-summary.csv', 'restline-raw-', 'restline-emails.csv'];
  for (const f of targets) {
    const src = readFileSync(f).toString('latin1'); // binaries too: media and icons carry metadata
    for (const b of banned) assert.ok(!src.includes(b), `${rel(f)} contains ${JSON.stringify(b)}`);
  }
  for (const f of [join(ROOT, 'playwright.config.mjs'), join(ROOT, 'scripts', 'serve.mjs'), join(ROOT, '.gitignore')]) {
    if (!existsSync(f)) continue;
    const src = readFileSync(f, 'utf8');
    for (const b of ['rl_v', 'hello@', 'E0252B']) assert.ok(!src.includes(b), `${rel(f)} contains ${JSON.stringify(b)}`);
  }
});

test('event.mjs: GATE_START literal, SITE_ORIGINS of .netlify.app origins only, the CSV filenames', () => {
  assert.match(eventSrc, /export const GATE_START = Date\.parse\('2026-10-24T05:00:00\.000Z'\);/);
  assert.equal(mod.GATE_START, Date.parse('2026-10-24T05:00:00.000Z'));
  const origins = /const SITE_ORIGINS = \[([^\]]*)\];/.exec(eventSrc);
  assert.ok(origins, 'SITE_ORIGINS literal');
  const list = [...origins[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(list.length >= 1, 'at least one origin');
  for (const o of list) assert.match(o, /^https:\/\/[a-z0-9-]+\.netlify\.app$/, `${o} is a .netlify.app origin`);
  assert.ok(list.includes('https://tryparakeet.netlify.app'), 'the site origin');
  assert.ok(eventSrc.includes("'parakeet-summary.csv'"));
  assert.ok(eventSrc.includes('`parakeet-raw-${only}.csv`'));
  assert.ok(eventSrc.includes("'parakeet-emails.csv'"));
});

test('event.mjs: the exact allowlists and version', () => {
  assert.deepEqual([...mod.EVENTS].sort(), ['email', 'leave', 'pageview', 'seen', 'tap', 'video']);
  assert.deepEqual([...mod.BUTTONS].sort(), ['plan_monthly', 'plan_yearly', 'play', 'reserve']);
  assert.deepEqual([...mod.PLANS].sort(), ['monthly', 'yearly']);
  assert.equal(mod.SUMMARY_VERSION, 7);
  assert.doesNotMatch(eventSrc, /'answer'/, 'the answer event is gone');
  for (const b of mod.BUTTONS) {
    assert.ok(mod.VID_SETS.includes(b), `VID_SETS has ${b}`);
    assert.ok(mod.COUNTERS.includes('n_tap_' + b), `COUNTERS has n_tap_${b}`);
  }
});

test('event.mjs exports: createHandler, a default handler, the pure functions; never config or handler', () => {
  assert.match(eventSrc, /^export function createHandler\(/m);
  assert.match(eventSrc, /^export default createHandler\(\);/m);
  assert.doesNotMatch(eventSrc, /^export const config\b/m, 'no export const config');
  assert.doesNotMatch(eventSrc, /^export (const|function|async function) handler\b/m, 'no named handler export');
  assert.doesNotMatch(eventSrc, /^export \{[^}]*\bhandler\b/m, 'no named handler export');
  assert.equal(typeof mod.default, 'function');
  assert.equal(typeof mod.createHandler, 'function');
  for (const name of ['flagOf', 'isBotPageview', 'newSummary', 'newBucket', 'addRow', 'mergeSummary', 'resolveVisitors', 'finalizeDay', 'finalizeBucket', 'summaryRows']) {
    assert.equal(typeof mod[name], 'function', `export ${name}`);
  }
  for (const name of ['EVENTS', 'BUTTONS', 'PLANS', 'VID_SETS', 'GATE_START', 'SUMMARY_VERSION', 'BOT_UA', 'APP_LABEL_UA', 'RAW_COLUMNS', 'EMAIL_COLUMNS', 'SUMMARY_COLUMNS']) {
    assert.ok(name in mod, `export ${name}`);
  }
  assert.ok(!('config' in mod), 'no config export');
  assert.ok(!('handler' in mod), 'no handler export');
});

test('the cookie name agrees across event.mjs, app.js and privacy.html', () => {
  const fn = /'Set-Cookie': `([a-z_]+)=\$\{vid\}; Max-Age=\$\{COOKIE_MAX_AGE\}; Path=\/; SameSite=Lax; Secure`/.exec(eventSrc);
  assert.ok(fn, 'the function sets the cookie');
  const client = /var COOKIE = '([a-z_]+)';/.exec(appSrc);
  assert.ok(client, 'the client names its cookie');
  assert.equal(fn[1], 'pk_v');
  assert.equal(client[1], fn[1]);
  assert.ok(privacySrc.includes(fn[1]), 'privacy.html names the cookie');
  assert.match(eventSrc, /const COOKIE_MAX_AGE = 90 \* 24 \* 60 \* 60;/);
  assert.match(appSrc, /90 \* 24 \* 60 \* 60/);
});

test('.gitignore keeps node_modules, test output and env files out', () => {
  const lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  for (const entry of ['node_modules/', '.netlify/', 'test-results/', 'playwright-report/', '.env']) assert.ok(lines.includes(entry), `.gitignore has ${entry}`);
});

test('the differential baseline is present and frozen', () => {
  const base = readFileSync(join(ROOT, 'tests', 'previous', 'summary-v6.mjs'), 'utf8');
  assert.match(base, /summary version 6/i);
  assert.match(base, /do not edit/i);
  assert.match(base, /6251e27/);
  assert.doesNotMatch(base, /^import\s/m, 'the baseline imports nothing');
});
