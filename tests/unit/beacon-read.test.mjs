// GET /admin/app through beacon.mjs's createHandler(): the key, LAUNCH_AT, the empty read, each of parakeet-app's
// docs/BEACON.md §5 numbers on small sets of rows, test installs kept apart for good, dev rows only counted, the hour
// and day summaries (kept once, never read again, summed again on a new version), partial reads, and the 2-year edge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_VERSION, numbers, newSummary, addRow, mergeSummary, finalizeRead } from '../../netlify/functions/beacon.mjs';
import { createBeaconTest, send, sendOk, readApp, readJson, batch, note, installId, ADMIN_KEY } from '../helpers/beacon.mjs';
import { MINUTE, HOUR, DAY } from '../helpers/http.mjs';

const LAUNCH_AT = '2026-11-02T00:00:00-06:00'; // Mon Nov 2, 06:00 UTC
const NOW = '2026-11-20T12:30:00.000Z';

const EMPTY_GROUP = {
  installs: 0,
  rows: 0,
  by_name: {},
  social_proof: {
    weeks_planned: 0, dinners_cooked: 0, shelf_prices_checked: 0, groceries_planned_dollars: 0, people_who_built_a_week: 0,
    states: { count: 0, by_state: {}, unmatched: 0 }, likes: {}
  },
  funnel: {},
  goals: {
    price_typed_within_14_days: { reached: 0, of: 0, rate: 0 },
    dinner_cooked_within_7_days: { reached: 0, of: 0, rate: 0 },
    paywall: { seen: 0, free_week_started: 0, subscribed: 0 },
    weeks_built_by_week: [1, 2, 3, 4, 5, 6, 7, 8].map((week) => ({ week, of: 0, built: 0, weeks: 0 })),
    installs_by_chain: { walmart: 0, kroger: 0, target: 0, aldi: 0 },
    dinners: {}
  }
};

// One batch whose notes all carry `iso` as their at, arriving 5 minutes later.
async function sendAt(t, iso, install, notes, opts) {
  t.clock.set(Date.parse(iso) + 5 * MINUTE);
  await sendOk(t.handler, batch(install, notes.map(([name, props]) => note(name, props, iso)), opts));
}

function week(w, kind, total, { chain = 'walmart', zip3 = '752', budget = 100 } = {}) {
  return ['week_built', { week: w, kind, nights: 5, total, budget, chain, zip3, dinners: ['bean_chili', 'chicken_tacos', 'salmon_rice', 'veggie_wraps', 'quesadillas'] }];
}

function setup({ chain = 'walmart', zip3 = '752' } = {}) {
  return ['onboarding_done', { chain, zip3, people: 2, nights: 5, diet: 'anything', budget: 100 }];
}

const openFirst = ['open', { first: true }];

test('the read needs ADMIN_KEY (503 without, 401 wrong or missing), answers GET only, and LAUNCH_AT must be a date', async () => {
  const none = createBeaconTest({ env: { ADMIN_KEY: undefined } });
  const r503 = await readApp(none.handler);
  assert.equal(r503.status, 503);
  assert.match((await r503.json()).error, /ADMIN_KEY is not set/);
  const t = createBeaconTest();
  assert.equal((await readApp(t.handler, { key: 'wrong' })).status, 401);
  assert.equal((await readApp(t.handler, { key: ADMIN_KEY + 'x' })).status, 401);
  assert.equal((await readApp(t.handler, { key: null })).status, 401);
  const post = await readApp(t.handler, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  const bad = createBeaconTest({ env: { LAUNCH_AT: 'launch day' } });
  const r = await readApp(bad.handler);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /^LAUNCH_AT is not a date/);
  for (const v of ['', '  ']) {
    const blank = createBeaconTest({ env: { LAUNCH_AT: v } });
    assert.equal((await readJson(blank.handler)).launch_at, null, `LAUNCH_AT ${JSON.stringify(v)} reads as empty`);
  }
});

test('the empty read, as Umyt sees it after the merge: every number zero, nothing partial, no-store', async () => {
  const t = createBeaconTest();
  const res = await readApp(t.handler);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  const out = await res.json();
  assert.deepEqual(Object.keys(out), ['version', 'generated', 'launch_at', 'partial', 'pending', 'launch', 'before_launch', 'dev']);
  assert.equal(out.version, SUMMARY_VERSION);
  assert.equal(out.launch_at, null);
  assert.equal(out.partial, false);
  assert.deepEqual(out.pending, []);
  assert.deepEqual(out.launch, EMPTY_GROUP);
  assert.deepEqual(out.before_launch, EMPTY_GROUP);
  assert.deepEqual(out.dev, { rows: 0, installs: 0, by_name: {} });
  const set = createBeaconTest({ env: { LAUNCH_AT } });
  assert.equal((await readJson(set.handler)).launch_at, '2026-11-02T06:00:00.000Z');
});

test('a rebuilt week counts once in weeks planned, with its last total in groceries planned', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT } });
  const I = installId('rebuild');
  await sendAt(t, '2026-11-03T15:00:00.000Z', I, [openFirst, week('2026-11-03', 'first', 58.12)]);
  await sendAt(t, '2026-11-03T18:00:00.000Z', I, [week('2026-11-03', 'rebuild', 61.5)]);
  await sendAt(t, '2026-11-04T09:00:00.000Z', I, [week('2026-11-03', 'rebuild', 60.07)]);
  t.clock.set(NOW);
  const proof = (await readJson(t.handler)).launch.social_proof;
  assert.equal(proof.weeks_planned, 1);
  assert.equal(proof.groceries_planned_dollars, 60.07);
  assert.equal(proof.people_who_built_a_week, 1);
});

test('a thumb taken back is not a like; a cooked mark taken back is not a dinner cooked; marking again counts once', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT } });
  const I = installId('taken-back');
  const thumb = (dinner, mark) => ['thumb', { dinner, mark }];
  const cooked = (night, on) => ['cooked', { dinner: 'bean_chili', week: '2026-11-03', night, on }];
  await sendAt(t, '2026-11-03T15:00:00.000Z', I, [openFirst, thumb('bean_chili', 'up'), thumb('chicken_tacos', 'up'), cooked('mon', true), cooked('tue', true)]);
  await sendAt(t, '2026-11-03T16:00:00.000Z', I, [thumb('chicken_tacos', 'none'), cooked('tue', false)]);
  await sendAt(t, '2026-11-04T16:00:00.000Z', I, [cooked('mon', false)]);
  await sendAt(t, '2026-11-04T17:00:00.000Z', I, [cooked('mon', true)]);
  t.clock.set(NOW);
  const proof = (await readJson(t.handler)).launch.social_proof;
  assert.deepEqual(proof.likes, { bean_chili: 1 });
  assert.equal(proof.dinners_cooked, 1);
});

test('rows of an install first seen before LAUNCH_AT stay under before_launch for good; dev rows are only counted', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT } });
  const phone = installId('umyt-phone');
  const fresh = installId('first-day');
  const dev = installId('simulator');
  await sendAt(t, '2026-10-30T12:00:00.000Z', phone, [openFirst, setup(), week('2026-10-30', 'first', 50)]);
  await sendAt(t, '2026-11-05T12:00:00.000Z', phone, [week('2026-11-05', 'this', 55), ['cooked', { dinner: 'bean_chili', week: '2026-11-05', night: 'thu', on: true }]]);
  await sendAt(t, '2026-11-02T06:00:00.000Z', fresh, [openFirst, setup({ chain: 'aldi', zip3: '100' })]);
  await sendAt(t, '2026-11-05T13:00:00.000Z', dev, [openFirst, week('2026-11-05', 'first', 99)], { build: 'dev' });
  await sendAt(t, '2026-11-05T13:10:00.000Z', dev, [['list_opened', { week: '2026-11-05' }]], { build: 'dev' });
  t.clock.set(NOW);
  const out = await readJson(t.handler);
  assert.equal(out.before_launch.installs, 1);
  assert.equal(out.before_launch.social_proof.weeks_planned, 2, 'its week after launch stays with it');
  assert.equal(out.before_launch.social_proof.groceries_planned_dollars, 105);
  assert.equal(out.before_launch.social_proof.dinners_cooked, 1);
  assert.deepEqual(Object.keys(out.before_launch.funnel), ['2026-10-26']);
  assert.equal(out.launch.installs, 1, 'the install whose first row arrived at LAUNCH_AT, 5 minutes after it');
  assert.equal(out.launch.social_proof.weeks_planned, 0);
  assert.deepEqual(out.launch.goals.installs_by_chain, { walmart: 0, kroger: 0, target: 0, aldi: 1 });
  assert.deepEqual(out.dev, { rows: 3, installs: 1, by_name: { list_opened: 1, open: 1, week_built: 1 } });
  for (const group of [out.launch, out.before_launch]) assert.ok(!('dev' in group));
  assert.equal(out.launch.social_proof.groceries_planned_dollars + out.before_launch.social_proof.groceries_planned_dollars, 105, 'the dev week is in neither');

  // while LAUNCH_AT is empty, every release install is under before_launch
  const empty = createBeaconTest({ blobs: t.blobs, t0: NOW });
  const all = await readJson(empty.handler);
  assert.equal(all.launch.installs, 0);
  assert.equal(all.before_launch.installs, 2);
  assert.deepEqual(all.dev, out.dev);
});

// The scripted launch: five installs after LAUNCH_AT (A..E), each note at its time, read on Fri Nov 20.
async function launchScenario(t) {
  const A = installId('A'), B = installId('B'), C = installId('C'), D = installId('D'), E = installId('E');
  const page = (p) => ['onboarding_page', { page: p }];
  // A: the whole way, cohort Mon Nov 2
  await sendAt(t, '2026-11-02T15:00:00.000Z', A, [openFirst, page('welcome'), page('zip'), page('store'), page('budget'), setup(), week('2026-11-02', 'first', 58.12), ['list_opened', { week: '2026-11-02' }]]);
  await sendAt(t, '2026-11-02T15:20:00.000Z', A, [['price_typed', { item: 'black_beans', chain: 'walmart' }]]);
  await sendAt(t, '2026-11-02T15:30:00.000Z', A, [['thumb', { dinner: 'bean_chili', mark: 'up' }], ['thumb', { dinner: 'chicken_tacos', mark: 'up' }]]);
  await sendAt(t, '2026-11-03T01:00:00.000Z', A, [week('2026-11-02', 'rebuild', 61.5)]);
  await sendAt(t, '2026-11-03T01:10:00.000Z', A, [['cooked', { dinner: 'bean_chili', week: '2026-11-02', night: 'mon', on: true }], ['cooked', { dinner: 'chicken_tacos', week: '2026-11-02', night: 'tue', on: true }]]);
  await sendAt(t, '2026-11-03T01:30:00.000Z', A, [['cooked', { dinner: 'chicken_tacos', week: '2026-11-02', night: 'tue', on: false }], ['thumb', { dinner: 'chicken_tacos', mark: 'none' }]]);
  await sendAt(t, '2026-11-03T01:50:00.000Z', A, [['swap', { week: '2026-11-02', night: 'wed', from: 'salmon_rice', to: 'veggie_wraps' }], ['hide', { dinner: 'salmon_rice', on: true }]]);
  await sendAt(t, '2026-11-03T02:00:00.000Z', A, [['paywall_seen', { from: 'home' }], ['plans_seen', { from: 'paywall' }], ['trial_started', { plan: 'yearly', offer: 'free_week' }]]);
  const second = [week('2026-11-10', 'next', 70), ['price_typed', { item: 'rice', chain: 'walmart' }]];
  await sendAt(t, '2026-11-10T16:00:00.000Z', A, second);
  // the same batch again, after a timeout the app didn't see the end of, arriving the next day
  t.clock.set('2026-11-11T09:00:00.000Z');
  await sendOk(t.handler, batch(A, second.map(([name, props]) => note(name, props, '2026-11-10T16:00:00.000Z'))));
  // B: two pages, then gone; cohort Mon Nov 2
  await sendAt(t, '2026-11-04T20:00:00.000Z', B, [openFirst, page('welcome'), page('zip')]);
  // C: cohort Mon Nov 9; moves from Kroger in New York to Aldi in Illinois
  await sendAt(t, '2026-11-09T12:00:00.000Z', C, [openFirst, setup({ chain: 'kroger', zip3: '100' }), week('2026-11-09', 'first', 80.25, { chain: 'kroger', zip3: '100' })]);
  await sendAt(t, '2026-11-09T12:30:00.000Z', C, [['thumb', { dinner: 'bean_chili', mark: 'down' }], ['hide', { dinner: 'salmon_rice', on: true }], ['swap', { week: '2026-11-09', night: 'mon', from: 'bean_chili', to: 'quesadillas' }]]);
  await sendAt(t, '2026-11-09T12:40:00.000Z', C, [['hide', { dinner: 'salmon_rice', on: false }]]);
  await sendAt(t, '2026-11-12T08:00:00.000Z', C, [week('2026-11-16', 'next', 40, { chain: 'aldi', zip3: '606' }), ['subscribed', { plan: 'monthly' }]]);
  // D: no open with first: true reached us; its earliest note counts as its first open (Tue Nov 10, cohort Nov 9)
  await sendAt(t, '2026-11-10T09:00:00.000Z', D, [['open', {}], week('2026-11-10', 'first', 30, { chain: 'target', zip3: '200' }), ['cooked', { dinner: 'quesadillas', week: '2026-11-10', night: 'tue', on: true }]]);
  // E: a ZIP3 no state has; cohort Mon Nov 16; and a row in the hour still open at the read
  await sendAt(t, '2026-11-16T10:00:00.000Z', E, [openFirst, setup({ chain: 'kroger', zip3: '000' })]);
  await sendAt(t, '2026-11-20T12:20:00.000Z', E, [['open', { first: false }]]);
  t.clock.set(NOW);
  return { A, B, C, D, E };
}

test('every number of BEACON.md §5 on the scripted launch', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT } });
  await launchScenario(t);
  const out = await readJson(t.handler);
  assert.equal(out.partial, false);
  assert.deepEqual(out.before_launch, EMPTY_GROUP);
  const g = out.launch;
  assert.equal(g.installs, 5);
  assert.deepEqual(g.social_proof, {
    weeks_planned: 5, // A 2 (its rebuilt week once), C 2, D 1
    dinners_cooked: 2, // A's Monday (its Tuesday was taken back), D's Tuesday
    shelf_prices_checked: 2, // A's two, the batch sent twice counted once
    groceries_planned_dollars: 281.75, // A 61.50 (the rebuild) + 70, C 80.25 + 40, D 30
    people_who_built_a_week: 3,
    states: { count: 2, by_state: { DC: 1, IL: 1, TX: 1 }, unmatched: 1 }, // C's latest ZIP3 is Illinois'; DC is listed, not a state
    likes: { bean_chili: 1 } // A's tacos thumb was taken back
  });
  assert.deepEqual(g.funnel, {
    '2026-11-02': { opened: 2, setup_done: 1, week_built: 1, list_opened: 1, dinner_cooked: 1, second_week_built: 1, onboarding_pages: { budget: 1, store: 1, welcome: 2, zip: 2 } },
    '2026-11-09': { opened: 2, setup_done: 1, week_built: 2, list_opened: 0, dinner_cooked: 1, second_week_built: 1, onboarding_pages: {} },
    '2026-11-16': { opened: 1, setup_done: 1, week_built: 0, list_opened: 0, dinner_cooked: 0, second_week_built: 0, onboarding_pages: {} }
  });
  assert.deepEqual(g.goals.price_typed_within_14_days, { reached: 1, of: 2, rate: 0.5 }, 'A and B are 14 days in; A typed a price');
  assert.deepEqual(g.goals.dinner_cooked_within_7_days, { reached: 2, of: 4, rate: 0.5 }, 'A, B, C and D are 7 days in; A and D cooked');
  assert.deepEqual(g.goals.paywall, { seen: 1, free_week_started: 1, subscribed: 1 });
  assert.deepEqual(g.goals.weeks_built_by_week.slice(0, 3), [
    { week: 1, of: 4, built: 3, weeks: 4 }, // A 1, C 2, D 1; E's first week isn't over
    { week: 2, of: 2, built: 1, weeks: 1 }, // A's next week; C and D aren't 14 days in
    { week: 3, of: 0, built: 0, weeks: 0 }
  ]);
  assert.deepEqual(g.goals.weeks_built_by_week.slice(3).map((w) => [w.week, w.of]), [[4, 0], [5, 0], [6, 0], [7, 0], [8, 0]]);
  assert.deepEqual(g.goals.installs_by_chain, { walmart: 1, kroger: 1, target: 1, aldi: 1 }, 'each install\'s latest chain; B has none');
  assert.deepEqual(g.goals.dinners, {
    bean_chili: { swapped_away: 1, hidden: 0, thumbs_down: 1 },
    salmon_rice: { swapped_away: 1, hidden: 1, thumbs_down: 0 } // C showed it again
  });
  assert.equal(g.by_name.price_typed, 3, 'rows by name count the rows, the batch sent twice included');
  assert.equal(g.rows, Object.values(g.by_name).reduce((a, b) => a + b, 0));
});

test('closed hours are summed once and kept, then folded into their closed day; the open hour is read each time', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT } });
  await launchScenario(t);
  const first = await readJson(t.handler);
  const kept = Object.keys(t.blobs.dump('app-summaries'));
  const days = [...new Set(Object.keys(t.blobs.dump('app-events')).map((k) => k.slice(0, 10)))].sort();
  assert.ok(days.includes('2026-11-20'));
  for (const d of days.filter((x) => x < '2026-11-20')) assert.ok(kept.includes(`${d}/day`), `${d} kept as a day`);
  assert.ok(!kept.includes('2026-11-20/day'), 'today is not closed');
  assert.ok(!kept.some((k) => k.startsWith('2026-11-20/12')), 'the open hour is not kept');
  for (const s of Object.values(t.blobs.dump('app-summaries'))) assert.equal(s.v, SUMMARY_VERSION);

  // the second read: no row of a closed day is read again, and the numbers are the same
  t.blobs.log.length = 0;
  const second = await readJson(t.handler);
  const rowGets = t.blobs.log.filter((l) => l.store === 'app-events' && l.op === 'get').map((l) => l.key);
  assert.ok(rowGets.length > 0 && rowGets.every((k) => k.startsWith('2026-11-20/12/')), `rows read: ${rowGets.join(' ')}`);
  assert.deepEqual({ ...second, generated: null }, { ...first, generated: null });

  // a day kept by an older version of the summary is summed again from its rows
  const old = t.blobs.dump('app-summaries')['2026-11-03/day'];
  await t.blobs.getStore({ name: 'app-summaries' }).setJSON('2026-11-03/day', { ...old, v: SUMMARY_VERSION - 1 });
  await t.blobs.getStore({ name: 'app-summaries' }).setJSON('2026-11-03/01', { ...old, v: SUMMARY_VERSION - 1 });
  t.blobs.log.length = 0;
  const third = await readJson(t.handler);
  assert.ok(t.blobs.log.some((l) => l.store === 'app-events' && l.op === 'get' && l.key.startsWith('2026-11-03/01/')), 'the old hour is read again');
  assert.deepEqual({ ...third, generated: null }, { ...first, generated: null });
  assert.equal(t.blobs.dump('app-summaries')['2026-11-03/day'].v, SUMMARY_VERSION);
});

test('a row that cannot be read makes the read partial and nothing of its day is kept; the next read finishes', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT } });
  await launchScenario(t);
  const key = Object.keys(t.blobs.dump('app-events')).find((k) => k.startsWith('2026-11-04/'));
  t.blobs.failing.add(key);
  const out = await readJson(t.handler);
  assert.equal(out.partial, true);
  const kept = Object.keys(t.blobs.dump('app-summaries'));
  assert.ok(!kept.includes('2026-11-04/day'));
  assert.ok(!kept.includes(key.slice(0, 13)), 'nor its hour');
  assert.ok(kept.includes('2026-11-02/day'), 'other days are kept');
  t.blobs.failing.delete(key);
  const again = await readJson(t.handler);
  assert.equal(again.partial, false);
  assert.ok(Object.keys(t.blobs.dump('app-summaries')).includes('2026-11-04/day'));
  assert.equal(again.launch.installs, 5);
});

test('a read out of time says partial and lists what it left; what it left is not kept; the next read finishes', async () => {
  const fast = createBeaconTest({ env: { LAUNCH_AT } });
  await launchScenario(fast);
  // a clock that runs a quarter second with every look at it: the read's 8 seconds go after a few days
  let t = Date.parse(NOW);
  const { createHandler } = await import('../../netlify/functions/beacon.mjs');
  const slow = createHandler({ getStore: fast.blobs.getStore, env: fast.env, now: () => (t += 250), logger: { log() {}, error() {} } });
  const res = await readApp(slow);
  const out = await res.json();
  assert.equal(out.partial, true);
  assert.ok(out.pending.length > 0);
  for (const p of out.pending) {
    assert.match(p, /^\d{4}-\d{2}-\d{2}(\/\d{2})?$/);
    assert.ok(!Object.keys(fast.blobs.dump('app-summaries')).includes(`${p.slice(0, 10)}/day`), `${p}: its day is not kept`);
  }
  const done = await readJson(fast.handler);
  assert.equal(done.partial, false);
  assert.deepEqual(done.pending, []);
  assert.equal(done.launch.installs, 5);
});

test('a read leaves out any day more than 2 years old, deleted or not yet', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT: '2024-01-01T00:00:00Z' } });
  const I = installId('old'), J = installId('kept');
  await sendAt(t, '2024-11-19T12:00:00.000Z', I, [openFirst, week('2024-11-19', 'first', 10)]);
  await sendAt(t, '2024-11-20T00:10:00.000Z', J, [openFirst, week('2024-11-20', 'first', 20)]);
  t.clock.set('2026-11-20T12:00:00.000Z');
  const out = await readJson(t.handler);
  assert.equal(out.launch.installs, 1);
  assert.equal(out.launch.social_proof.groceries_planned_dollars, 20);
});

test('summaries merge in any order and the same rows twice change nothing', () => {
  const I = installId('merge');
  const row = (name, props, at, received = at) => ({ install: I, build: 'release', version: '1.0.0', name, at, props, received });
  const rows = [
    row('open', { first: true }, '2026-11-02T10:00:00.000Z'),
    row('week_built', { week: '2026-11-02', kind: 'first', nights: 5, total: 50, budget: null, chain: 'kroger', zip3: '303', dinners: [] }, '2026-11-02T10:01:00.000Z'),
    row('week_built', { week: '2026-11-02', kind: 'rebuild', nights: 5, total: 52.5, budget: null, chain: 'kroger', zip3: null, dinners: [] }, '2026-11-03T10:01:00.000Z'),
    row('thumb', { dinner: 'bean_chili', mark: 'up' }, '2026-11-02T11:00:00.000Z'),
    row('thumb', { dinner: 'bean_chili', mark: 'none' }, '2026-11-02T12:00:00.000Z'),
    row('price_typed', { item: 'rice', chain: 'kroger' }, '2026-11-02T13:00:00.000Z')
  ];
  const sum = (list) => { const s = newSummary(); for (const r of list) addRow(s, r); return s; };
  const forward = mergeSummary(mergeSummary(newSummary(), sum(rows.slice(0, 3))), sum(rows.slice(3)));
  const backward = mergeSummary(mergeSummary(newSummary(), sum(rows.slice(3))), sum(rows.slice(0, 3)));
  const twice = mergeSummary(mergeSummary(newSummary(), sum(rows)), JSON.parse(JSON.stringify(sum([...rows].reverse()))));
  const at = Date.parse('2026-11-20T00:00:00.000Z');
  const a = finalizeRead(forward, { launchAt: null, now: at });
  assert.deepEqual(finalizeRead(backward, { launchAt: null, now: at }), a);
  const b = finalizeRead(twice, { launchAt: null, now: at });
  assert.deepEqual(b.before_launch.social_proof, a.before_launch.social_proof);
  assert.deepEqual(a.before_launch.social_proof, {
    weeks_planned: 1, dinners_cooked: 0, shelf_prices_checked: 1, groceries_planned_dollars: 52.5, people_who_built_a_week: 1,
    states: { count: 1, by_state: { GA: 1 }, unmatched: 0 }, likes: {}
  }, 'a null zip3 keeps the one before it');
  assert.equal(b.before_launch.by_name.week_built, 4, 'rows by name do count the rows twice');
  // rows that aren't the beacon's are skipped
  const s = newSummary();
  for (const r of [null, 'x', { ...rows[0], install: 'nope' }, { ...rows[0], name: 'tap' }, { ...rows[0], build: 'beta' }]) addRow(s, r);
  assert.deepEqual(numbers(Object.values(s.installs), at), numbers([], at));
});

test('dinner ids that are words of JavaScript objects count like any other', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT } });
  const I = installId('words');
  await sendAt(t, '2026-11-03T15:00:00.000Z', I, [openFirst, ['thumb', { dinner: 'constructor', mark: 'up' }], ['hide', { dinner: 'tostring', on: true }], ['swap', { week: '2026-11-03', night: 'mon', from: 'hasownproperty', to: 'constructor' }]]);
  t.clock.set(NOW);
  const g = (await readJson(t.handler)).launch;
  assert.deepEqual(g.social_proof.likes, { constructor: 1 });
  assert.deepEqual(g.goals.dinners, { hasownproperty: { swapped_away: 1, hidden: 0, thumbs_down: 0 }, tostring: { swapped_away: 0, hidden: 1, thumbs_down: 0 } });
});

test('GET /beacon is the read too: the admin key, never the beacon key', async () => {
  const t = createBeaconTest();
  assert.equal((await send(t.handler, null, { method: 'GET' })).status, 401);
  assert.equal((await readApp(t.handler, { path: '/beacon' })).status, 200);
  assert.equal((await readApp(t.handler, { path: '/.netlify/functions/beacon' })).status, 200);
  assert.equal((await readApp(t.handler, { path: '/admin/app/' })).status, 200);
});
