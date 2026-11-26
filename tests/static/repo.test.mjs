// The repo as a whole: package.json (one dependency, one pinned devDependency, the scripts), the identity
// scrub over everything that ships, event.mjs's constants and exports, the cookie name agreeing across the
// function, the client and the privacy page, .gitignore; the functions folder; beacon.mjs's exports, limits and
// allowlist against parakeet-app's docs/BEACON.md §3, and the request headers it may read; beacon-prune.mjs's schedule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import * as mod from '../../netlify/functions/event.mjs';
import * as beacon from '../../netlify/functions/beacon.mjs';
import * as beaconPrune from '../../netlify/functions/beacon-prune.mjs';

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
  assert.deepEqual([...mod.BUTTONS].sort(), ['android', 'plan_monthly', 'plan_yearly', 'play', 'reserve']);
  assert.deepEqual([...mod.PLANS].sort(), ['android', 'monthly', 'yearly']);
  assert.equal(mod.SUMMARY_VERSION, 8);
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

test('netlify/functions holds the three functions and the ZIP3 table, nothing else Netlify would deploy as one', () => {
  assert.deepEqual(readdirSync(join(ROOT, 'netlify', 'functions')).sort(), ['beacon-prune.mjs', 'beacon.mjs', 'event.mjs', 'zip3-states.json']);
});

const beaconSrc = readFileSync(join(ROOT, 'netlify', 'functions', 'beacon.mjs'), 'utf8');
const pruneSrc = readFileSync(join(ROOT, 'netlify', 'functions', 'beacon-prune.mjs'), 'utf8');

test('beacon.mjs exports: createHandler, a default handler, prune and the pure functions; never config or handler', () => {
  assert.match(beaconSrc, /^export function createHandler\(/m);
  assert.match(beaconSrc, /^export default createHandler\(\);/m);
  assert.doesNotMatch(beaconSrc, /^export const config\b/m, 'no export const config: a schedule would take its routes away');
  assert.doesNotMatch(beaconSrc, /^export (const|function|async function) handler\b/m, 'no named handler export');
  assert.equal(typeof beacon.default, 'function');
  for (const name of ['createHandler', 'checkNote', 'prune', 'keptFrom', 'stateOfZip3', 'newSummary', 'newFacts', 'addRow', 'mergeSummary', 'finalizeRead', 'numbers']) {
    assert.equal(typeof beacon[name], 'function', `export ${name}`);
  }
  for (const name of ['NOTES', 'VALUES', 'NIGHT_IDS', 'CHAIN_IDS', 'DIET_IDS', 'PLAN_IDS', 'OFFERS', 'KINDS', 'MARKS', 'BUILDS', 'FIFTY_STATES', 'SUMMARY_VERSION']) {
    assert.ok(name in beacon, `export ${name}`);
  }
  assert.ok(!('config' in beacon), 'no config export');
  assert.ok(!('handler' in beacon), 'no handler export');
});

test('beacon.mjs: SITE-01\'s limits, the 2 years of BEACON.md §6, and the three stores', () => {
  assert.equal(beacon.MAX_BODY, 64 * 1024);
  assert.equal(beacon.MAX_NOTES, 200);
  assert.equal(beacon.DAILY_CAP, 2000);
  assert.equal(beacon.AT_BACK_MS, 90 * 24 * 3600 * 1000);
  assert.equal(beacon.AT_AHEAD_MS, 24 * 3600 * 1000);
  assert.equal(beacon.KEEP_YEARS, 2);
  assert.equal(beacon.CAP_KEEP_DAYS, 2);
  assert.ok(beacon.PRUNE_BUDGET_MS < 30000, 'a scheduled function gets 30 seconds');
  assert.deepEqual([beacon.EVENTS_STORE, beacon.SUMMARIES_STORE, beacon.CAPS_STORE], ['app-events', 'app-summaries', 'app-caps']);
});

// parakeet-app's docs/BEACON.md §3 as of Nov 17 (e597b55): each note and its props. A change to the contract comes
// there first, with Umyt's yes, then here.
const BEACON_MD_3 = {
  open: ['first'],
  onboarding_page: ['page'],
  onboarding_done: ['chain', 'zip3', 'people', 'nights', 'diet', 'budget'],
  week_built: ['week', 'kind', 'nights', 'total', 'budget', 'chain', 'zip3', 'dinners'],
  recipe_opened: ['dinner', 'week'],
  swap: ['week', 'night', 'from', 'to'],
  thumb: ['dinner', 'mark'],
  hide: ['dinner', 'on'],
  cooked: ['dinner', 'week', 'night', 'on'],
  list_opened: ['week'],
  list_tick: ['week'],
  price_typed: ['item', 'chain'],
  paywall_seen: ['from'],
  plans_seen: ['from'],
  trial_started: ['plan', 'offer'],
  subscribed: ['plan'],
  restored: ['found'],
  notifications: ['allowed']
};

test('beacon.mjs: the notes and props are exactly BEACON.md §3\'s, with its values, and never a price', () => {
  assert.deepEqual(Object.keys(beacon.NOTES).sort(), Object.keys(BEACON_MD_3).sort());
  for (const [name, props] of Object.entries(BEACON_MD_3)) assert.deepEqual(Object.keys(beacon.NOTES[name]).sort(), [...props].sort(), name);
  assert.deepEqual([...beacon.NIGHT_IDS], ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  // the app's twelve chains, in its order (parakeet-app's ENGINE-14 §1; SITE-02)
  assert.deepEqual([...beacon.CHAIN_IDS], ['walmart', 'kroger', 'target', 'aldi', 'heb', 'sprouts', 'wholefoods', 'traderjoes', 'meijer', 'wegmans', 'hyvee', 'publix']);
  assert.deepEqual([...beacon.DIET_IDS], ['anything', 'pescatarian', 'vegetarian', 'vegan']);
  assert.deepEqual([...beacon.PLAN_IDS], ['yearly', 'monthly']);
  assert.deepEqual([...beacon.OFFERS], ['free_week', 'code']);
  assert.deepEqual([...beacon.KINDS], ['first', 'this', 'next', 'rebuild']);
  assert.deepEqual([...beacon.MARKS], ['up', 'down', 'none']);
  assert.deepEqual([...beacon.BUILDS], ['release', 'dev']);
  const neverSent = ['price', 'text', 'note', 'search', 'item_name', 'name', 'email', 'zip', 'ip', 'lat', 'lon', 'location', 'idfv', 'idfa', 'device'];
  for (const [name, props] of Object.entries(beacon.NOTES)) {
    assert.deepEqual(Object.keys(props).filter((p) => neverSent.includes(p)), [], `${name} carries nothing that never leaves the phone (BEACON.md §2)`);
    for (const kind of Object.values(props)) assert.ok(kind.replace(/\?$/, '') in beacon.VALUES, `${name}: ${kind} is a kind the check knows`);
  }
  assert.deepEqual(Object.entries(beacon.NOTES).flatMap(([n, p]) => Object.entries(p).filter(([, k]) => k.endsWith('?')).map(([k]) => `${n}.${k}`)), ['open.first'], 'open\'s first is the one prop that may be left out');
  assert.ok(Object.isFrozen(beacon.NOTES) && Object.values(beacon.NOTES).every((p) => Object.isFrozen(p)), 'the allowlist cannot be changed at run time');
});

test('beacon.mjs reads no request header but the key and the length, and nothing about the phone or the network', () => {
  const headers = [...beaconSrc.matchAll(/headers\.get\('([^']+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(headers, ['content-length', 'x-beacon-key']);
  assert.doesNotMatch(beaconSrc, /user-agent|x-forwarded-for|client-ip|x-nf-|x-real-ip|context\.(ip|geo)|\.ip\b/i);
  assert.doesNotMatch(beaconSrc, /headers\.(entries|forEach|keys|values)\b|\.\.\.req\.headers|Object\.fromEntries\(req\.headers/);
  assert.match(beaconSrc, /async function handler\(req\) \{/, 'the handler takes the request only, never Netlify\'s context');
});

test('beacon-prune.mjs: prune() from beacon.mjs on Netlify\'s daily schedule', () => {
  assert.match(pruneSrc, /^import \{ prune \} from '\.\/beacon\.mjs';$/m);
  assert.match(pruneSrc, /^export default async function run\(\) \{$/m);
  assert.match(pruneSrc, /^export const config = \{ schedule: '@daily' \};$/m);
  assert.deepEqual(beaconPrune.config, { schedule: '@daily' });
});

test('the differential baseline is present and frozen', () => {
  const base = readFileSync(join(ROOT, 'tests', 'previous', 'summary-v6.mjs'), 'utf8');
  assert.match(base, /summary version 6/i);
  assert.match(base, /do not edit/i);
  assert.match(base, /6251e27/);
  assert.doesNotMatch(base, /^import\s/m, 'the baseline imports nothing');
});
