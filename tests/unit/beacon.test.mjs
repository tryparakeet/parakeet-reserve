// POST /beacon through beacon.mjs's createHandler(): the key, the batch's limits, the note-by-note check against
// parakeet-app's docs/BEACON.md §3 (a bad note is dropped, never the batch), the at window, the stored row, the daily
// cap, and that no stored row holds an IP address or a user agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY, MAX_NOTES, DAILY_CAP, NOTES } from '../../netlify/functions/beacon.mjs';
import { createMemoryBlobs } from '../helpers/memory-blobs.mjs';
import { createBeaconTest, send, sendOk, readApp, batch, note, installId, BEACON_KEY, T0 } from '../helpers/beacon.mjs';
import { DAY, HOUR } from '../helpers/http.mjs';

const I = installId('receiver');
const AT = '2026-10-25T11:59:00.000Z'; // a minute before T0, when the batches arrive
const ROW_KEYS = ['at', 'build', 'install', 'name', 'props', 'received', 'version'];

// One good note of each kind in BEACON.md §3.
const GOOD = {
  open: { first: true },
  onboarding_page: { page: 'onboarding/(questions)/zip' },
  onboarding_done: { chain: 'walmart', zip3: '752', people: 2, nights: 5, diet: 'anything', budget: 100 },
  week_built: { week: '2026-10-25', kind: 'first', nights: 5, total: 58.12, budget: 100, chain: 'walmart', zip3: '752', dinners: ['bean_chili', 'chicken_tacos', 'salmon_rice', 'veggie_wraps', 'quesadillas'] },
  recipe_opened: { dinner: 'bean_chili', week: '2026-10-25' },
  swap: { week: '2026-10-25', night: 'tue', from: 'bean_chili', to: 'chicken_tacos' },
  thumb: { dinner: 'bean_chili', mark: 'up' },
  hide: { dinner: 'salmon_rice', on: true },
  cooked: { dinner: 'bean_chili', week: '2026-10-25', night: 'mon', on: true },
  list_opened: { week: '2026-10-25' },
  list_tick: { week: '2026-10-25' },
  price_typed: { item: 'black_beans', chain: 'walmart' },
  paywall_seen: { from: 'home' },
  plans_seen: { from: 'settings/index' },
  trial_started: { plan: 'yearly', offer: 'free_week' },
  subscribed: { plan: 'monthly' },
  restored: { found: false },
  notifications: { allowed: true }
};

async function stored(body, opts) {
  const t = createBeaconTest(opts);
  const res = await send(t.handler, body);
  assert.equal(res.status, 204, await res.text());
  return { ...t, rows: t.blobs.rows('app-events') };
}

async function turnedAway(body, status, error, sendOpts = {}, testOpts = {}) {
  const t = createBeaconTest(testOpts);
  const res = await send(t.handler, body, sendOpts);
  const text = await res.text();
  assert.equal(res.status, status, `${JSON.stringify(body)?.slice(0, 120)} -> ${text}`);
  assert.equal(JSON.parse(text).error, error);
  assert.equal(t.blobs.rows('app-events').length, 0, 'nothing stored');
  assert.equal(t.blobs.rows('app-caps').length, 0, 'no count kept');
}

test('the test set covers every note of BEACON.md §3', () => {
  assert.deepEqual(Object.keys(GOOD).sort(), Object.keys(NOTES).sort());
});

test('a good batch: 204, no body, no-store; one row per note with the install, build, version, name, at, props and the time it arrived', async () => {
  const events = Object.entries(GOOD).map(([name, props]) => note(name, props, AT));
  const t = createBeaconTest();
  const res = await send(t.handler, batch(I, events, { version: '1.2.0' }));
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('set-cookie'), null, 'no cookie');
  const rows = t.blobs.rows('app-events');
  assert.equal(rows.length, events.length);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
    assert.equal(row.install, I);
    assert.equal(row.build, 'release');
    assert.equal(row.version, '1.2.0');
    assert.equal(row.at, AT);
    assert.equal(row.received, T0);
    assert.deepEqual(row.props, GOOD[row.name], `${row.name} keeps its props as sent`);
  }
  assert.deepEqual(rows.map((r) => r.name).sort(), Object.keys(GOOD).sort());
  assert.deepEqual(t.blobs.dump('app-caps'), { [`2026-10-25/${I}`]: { n: events.length } });
  assert.deepEqual(t.logs, [], 'nothing dropped, nothing logged');
});

test('the key is day/hour/<ms>-<16 hex>-<name> of the time the batch arrived; at is kept as UTC ISO 8601', async () => {
  const t = createBeaconTest({ t0: '2026-10-24T23:59:59.500Z' });
  await sendOk(t.handler, batch(I, [note('open', { first: true }, '2026-10-24T18:59:00-05:00')]));
  t.clock.advance(HOUR);
  await sendOk(t.handler, batch(I, [note('list_opened', { week: '2026-10-24' }, '2026-10-25T00:30:00Z')]));
  const dump = t.blobs.dump('app-events');
  const keys = Object.keys(dump);
  const ms = Date.parse('2026-10-24T23:59:59.500Z');
  assert.match(keys[0], new RegExp(`^2026-10-24/23/${ms}-[0-9a-f]{16}-open$`));
  assert.match(keys[1], new RegExp(`^2026-10-25/00/${ms + HOUR}-[0-9a-f]{16}-list_opened$`));
  assert.equal(dump[keys[0]].at, '2026-10-24T23:59:00.000Z', 'an offset is kept as the same instant in UTC');
  assert.equal(dump[keys[1]].at, '2026-10-25T00:30:00.000Z');
});

test('401 for a wrong or missing x-beacon-key, 503 while BEACON_KEY is not set; nothing stored', async () => {
  const body = batch(I, [note('open', { first: true }, AT)]);
  await turnedAway(body, 401, 'unauthorized', { key: 'wrong' });
  await turnedAway(body, 401, 'unauthorized', { key: BEACON_KEY.slice(0, -1) });
  await turnedAway(body, 401, 'unauthorized', { key: BEACON_KEY + 'x' });
  await turnedAway(body, 401, 'unauthorized', { key: null });
  await turnedAway(body, 401, 'unauthorized', { key: null, headers: { authorization: `Bearer ${BEACON_KEY}` } });
  await turnedAway(body, 503, 'BEACON_KEY is not set in the Netlify environment', {}, { env: { BEACON_KEY: undefined } });
  await turnedAway(body, 503, 'BEACON_KEY is not set in the Netlify environment', {}, { env: { BEACON_KEY: '' } });
});

test('400 for a body over 64 KB, by bytes; a body of exactly 64 KB is read', async () => {
  const body = batch(I, [note('open', { first: true }, AT)]);
  const text = JSON.stringify(body);
  const exact = text + ' '.repeat(MAX_BODY - Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(exact), MAX_BODY);
  const t = createBeaconTest();
  assert.equal((await send(t.handler, null, { raw: exact })).status, 204);
  assert.equal(t.blobs.rows('app-events').length, 1);
  await turnedAway(null, 400, 'too large', { raw: exact + ' ' });
  // 2-byte characters: under 64 K characters, over 64 KB
  const wide = JSON.stringify(batch(I, [note('open', { first: true }, AT)], { version: '1.0.0' })).slice(0, -1) + `,"pad":"${'é'.repeat(MAX_BODY / 2)}"}`;
  assert.ok(wide.length < MAX_BODY + 100 && Buffer.byteLength(wide) > MAX_BODY);
  await turnedAway(null, 400, 'too large', { raw: wide });
});

test('400 for more than 200 notes; 200 are read', async () => {
  const events = (n) => Array.from({ length: n }, (_, i) => note('list_tick', { week: '2026-10-25' }, new Date(Date.parse(AT) - i * 1000).toISOString()));
  const t = createBeaconTest();
  await sendOk(t.handler, batch(I, events(MAX_NOTES)));
  assert.equal(t.blobs.rows('app-events').length, MAX_NOTES);
  await turnedAway(batch(I, events(MAX_NOTES + 1)), 400, 'too many notes');
});

test('400 for an install that is not a lowercase UUID, a build that is not release or dev, or a batch that is not one', async () => {
  const events = [note('open', { first: true }, AT)];
  await turnedAway(batch(I.toUpperCase(), events), 400, 'bad install');
  await turnedAway(batch(I.replace(/-/g, ''), events), 400, 'bad install');
  await turnedAway(batch(I + '0', events), 400, 'bad install');
  await turnedAway(batch('', events), 400, 'bad install');
  await turnedAway({ build: 'release', events }, 400, 'bad install');
  await turnedAway(batch(42, events), 400, 'bad install');
  await turnedAway(batch(I, events, { build: 'beta' }), 400, 'bad build');
  await turnedAway(batch(I, events, { build: 'Release' }), 400, 'bad build');
  await turnedAway({ install: I, events }, 400, 'bad build');
  await turnedAway({ install: I, build: 'dev' }, 400, 'bad events');
  await turnedAway({ install: I, build: 'dev', events: {} }, 400, 'bad events');
  await turnedAway(null, 400, 'bad json', { raw: 'not json' });
  await turnedAway(null, 400, 'bad json', { raw: '[]' });
  await turnedAway(null, 400, 'bad json', { raw: 'null' });
  await turnedAway(null, 400, 'bad json', { raw: '' });
});

test('a dev batch is stored as dev; an empty batch is read and stores nothing; a version that is not one is kept empty', async () => {
  const dev = await stored(batch(I, [note('open', { first: true }, AT)], { build: 'dev', version: '1.0.0 (build 7) <script>' }));
  assert.equal(dev.rows[0].build, 'dev');
  assert.equal(dev.rows[0].version, '');
  const empty = await stored(batch(I, []));
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.blobs.rows('app-caps').length, 0);
});

test('a note with an unknown name or prop, a missing prop or a value §3 does not allow is dropped; the rest of the batch is kept', async () => {
  const W = { ...GOOD.week_built };
  const bad = [
    note('opened', { first: true }, AT),
    note('Open', {}, AT),
    note('toString', {}, AT),
    note('swap', { ...GOOD.swap, text: 'chicken tacos' }, AT),
    note('price_typed', { ...GOOD.price_typed, price: 3.48 }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, zip: '75201' }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, zip3: '75201' }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, zip3: 752 }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, chain: 'safeway' }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, diet: 'keto' }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, people: 0 }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, people: 2.5 }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, budget: -1 }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, budget: '100' }, AT),
    note('week_built', { ...W, nights: 8 }, AT),
    note('week_built', { ...W, kind: 'again' }, AT),
    note('week_built', { ...W, total: null }, AT),
    note('week_built', { ...W, total: Number.MAX_VALUE }, AT),
    note('week_built', { ...W, week: '2026-02-30' }, AT),
    note('week_built', { ...W, week: '10/25/2026' }, AT),
    note('week_built', { ...W, dinners: 'bean_chili' }, AT),
    note('week_built', { ...W, dinners: [...W.dinners, 'a', 'b', 'c'] }, AT),
    note('week_built', { ...W, dinners: ['Chicken tacos'] }, AT),
    note('recipe_opened', { dinner: 'Chicken tacos', week: '2026-10-25' }, AT),
    note('recipe_opened', { dinner: '__proto__', week: '2026-10-25' }, AT),
    note('swap', { ...GOOD.swap, night: 'monday' }, AT),
    note('thumb', { dinner: 'bean_chili', mark: 'meh' }, AT),
    note('hide', { dinner: 'bean_chili', on: 'true' }, AT),
    note('cooked', { ...GOOD.cooked, on: 1 }, AT),
    note('price_typed', { item: 'my own item!', chain: 'walmart' }, AT),
    note('onboarding_page', { page: 'My notes' }, AT),
    note('paywall_seen', { from: 'https://example.com' }, AT),
    note('trial_started', { plan: 'weekly', offer: 'free_week' }, AT),
    note('trial_started', { plan: 'yearly', offer: 'trial' }, AT),
    note('subscribed', { plan: 'com.tryparakeet.parakeet.yearly' }, AT),
    note('restored', { found: 'yes' }, AT),
    note('notifications', { allowed: null }, AT),
    note('open', { first: 'true' }, AT),
    note('cooked', { dinner: 'bean_chili', week: '2026-10-25', night: 'mon' }, AT),
    note('week_built', (({ total, ...rest }) => rest)(W), AT),
    note('list_opened', {}, AT),
    note('list_tick', [], AT),
    note('list_tick', 'week', AT),
    'open',
    null,
    [note('open', {}, AT)]
  ];
  const good = [note('open', { first: true }, AT), note('list_opened', { week: '2026-10-25' }, AT), note('week_built', W, AT)];
  const t = createBeaconTest();
  await sendOk(t.handler, batch(I, [...bad.slice(0, 20), good[0], ...bad.slice(20), good[1], good[2]]));
  const rows = t.blobs.rows('app-events');
  assert.deepEqual(rows.map((r) => r.name).sort(), ['list_opened', 'open', 'week_built']);
  assert.deepEqual(t.blobs.dump('app-caps'), { [`2026-10-25/${I}`]: { n: 3 } });
  // the log names the reasons, the notes and the props, never a value
  assert.equal(t.logs.length, 1);
  const [kind, line] = t.logs[0];
  assert.equal(kind, 'log');
  assert.match(line, new RegExp(`^beacon: kept 3 of ${bad.length + good.length} \\(release\\); dropped `));
  const dropped = JSON.parse(line.slice(line.indexOf('{')));
  assert.equal(Object.values(dropped).reduce((a, b) => a + b, 0), bad.length);
  for (const k of ['name', 'shape', 'props:list_tick', 'prop:swap:text', 'prop:price_typed:price', 'prop:onboarding_done:zip', 'value:onboarding_done:zip3', 'value:week_built:week', 'value:recipe_opened:dinner', 'missing:cooked:on', 'missing:week_built:total', 'missing:list_opened:week', 'value:subscribed:plan']) {
    assert.ok(k in dropped, `logged ${k}: ${line}`);
  }
  for (const value of ['chicken tacos', '3.48', '75201', 'safeway', 'Chicken tacos', 'my own item', 'My notes', 'example.com', 'weekly', 'com.tryparakeet']) {
    assert.ok(!line.includes(value), `the log never holds a value: ${value}`);
  }
});

test('open may leave first out; budget and zip3 may be null; nothing else is optional', async () => {
  const { rows } = await stored(batch(I, [
    note('open', {}, AT),
    note('open', null, AT),
    note('open', { first: false }, AT),
    note('onboarding_done', { ...GOOD.onboarding_done, budget: null, zip3: null }, AT),
    note('week_built', { ...GOOD.week_built, budget: null }, AT)
  ]));
  assert.equal(rows.length, 5);
  // one batch's rows share their time; the random part of the key orders them, so they are compared sorted
  assert.deepEqual(rows.filter((r) => r.name === 'open').map((r) => JSON.stringify(r.props)).sort(), ['{"first":false}', '{}', '{}']);
});

test('at: ISO 8601 within 90 days back and 1 day ahead of the batch, else the note is dropped', async () => {
  const t0 = Date.parse(T0);
  const iso = (ms) => new Date(ms).toISOString();
  const keep = [iso(t0 - 90 * DAY), iso(t0 + DAY), '2026-10-25T07:00:00-05:00', '2026-10-25T12:00Z', '2026-10-25T11:00:00.123456Z'];
  const drop = [iso(t0 - 90 * DAY - 1), iso(t0 + DAY + 1), 'Oct 25 2026', '2026-10-25', '2026-10-25 11:00:00Z', '2026-02-30T00:00:00Z', 1793102400000, null, undefined];
  const t = createBeaconTest();
  await sendOk(t.handler, batch(I, [...keep, ...drop].map((at) => note('list_tick', { week: '2026-10-25' }, at))));
  const ats = t.blobs.rows('app-events').map((r) => r.at).sort();
  assert.deepEqual(ats, [iso(t0 - 90 * DAY), '2026-10-25T11:00:00.123Z', '2026-10-25T12:00:00.000Z', '2026-10-25T12:00:00.000Z', iso(t0 + DAY)].sort());
  const dropped = JSON.parse(t.logs[0][1].replace(/^[^{]*/, ''));
  assert.deepEqual(dropped, { 'at:list_tick': 7, 'when:list_tick': 2 });
});

test('no stored row holds an IP address or a user agent, whatever the request carries', async () => {
  const IP = '203.0.113.77';
  const UA = 'Parakeet/1.0 CFNetwork/1568.100.1 Darwin/24.0.0';
  const t = createBeaconTest();
  const res = await send(t.handler, batch(I, Object.entries(GOOD).map(([name, props]) => note(name, props, AT))), {
    headers: {
      'user-agent': UA, 'x-forwarded-for': `${IP}, 10.0.0.1`, 'x-nf-client-connection-ip': IP, 'client-ip': IP,
      'x-real-ip': IP, 'x-nf-geo': 'eyJjaXR5IjoiRGFsbGFzIn0=', 'x-country': 'US', referer: 'https://example.com/'
    }
  });
  assert.equal(res.status, 204);
  for (const store of ['app-events', 'app-caps', 'app-summaries']) {
    const text = JSON.stringify(t.blobs.dump(store));
    for (const s of [IP, UA, 'CFNetwork', 'Dallas', 'eyJjaXR5', 'example.com']) assert.ok(!text.includes(s), `${store} holds ${s}`);
  }
  for (const row of t.blobs.rows('app-events')) assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
  // and after a read, the summaries hold none either
  t.clock.advance(2 * DAY);
  assert.equal((await readApp(t.handler)).status, 200);
  const summaries = JSON.stringify(t.blobs.dump('app-summaries'));
  assert.ok(summaries.length > 2, 'the read kept its summaries');
  for (const s of [IP, UA, 'CFNetwork']) assert.ok(!summaries.includes(s), `app-summaries holds ${s}`);
});

test('the daily cap: 2,000 notes per install per UTC day are kept, the rest dropped with a 204; other installs and the next day are not touched', async () => {
  const t = createBeaconTest({ t0: '2026-10-25T08:00:00.000Z' });
  const ticks = (n) => Array.from({ length: n }, () => note('list_tick', { week: '2026-10-25' }, '2026-10-25T07:00:00.000Z'));
  for (let i = 0; i < 9; i++) await sendOk(t.handler, batch(I, ticks(200)));
  await sendOk(t.handler, batch(I, ticks(150)));
  assert.equal(t.blobs.rows('app-events').length, 1950);
  await sendOk(t.handler, batch(I, [note('open', { first: false }, '2026-10-25T07:00:00.000Z'), ...ticks(99)]));
  const rows = t.blobs.rows('app-events');
  assert.equal(rows.length, DAILY_CAP, 'the first 50 of the batch were kept');
  assert.equal(rows.filter((r) => r.name === 'open').length, 1, 'in the batch\'s order');
  assert.match(t.logs.at(-1)[1], /^beacon: kept 50 of 100 \(release\); dropped \{"cap":50\}$/);
  await sendOk(t.handler, batch(I, ticks(10)));
  assert.equal(t.blobs.rows('app-events').length, DAILY_CAP);
  const other = installId('another');
  await sendOk(t.handler, batch(other, ticks(10)));
  assert.equal(t.blobs.rows('app-events').filter((r) => r.install === other).length, 10);
  t.clock.set('2026-10-26T00:00:00.000Z');
  await sendOk(t.handler, batch(I, ticks(10)));
  assert.equal(t.blobs.rows('app-events').filter((r) => r.install === I).length, DAILY_CAP + 10, 'a new UTC day, a new count');
  assert.deepEqual(t.blobs.dump('app-caps'), {
    [`2026-10-25/${I}`]: { n: DAILY_CAP },
    [`2026-10-25/${other}`]: { n: 10 },
    [`2026-10-26/${I}`]: { n: 10 }
  });
});

test('a write that fails is a 500 and the day\'s count is not raised, so the app sends the batch again', async () => {
  const blobs = createMemoryBlobs();
  const getStore = (opts) => {
    const store = blobs.getStore(opts);
    if (opts.name !== 'app-events') return store;
    return { ...store, setJSON: async () => { throw new Error('blobs down'); } };
  };
  const t = createBeaconTest({ blobs: { ...blobs, getStore } });
  const res = await send(t.handler, batch(I, [note('open', { first: true }, AT)]));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal error' });
  assert.equal(blobs.rows('app-caps').length, 0);
  assert.equal(t.logs[0][0], 'error');
});

test('methods: OPTIONS 204; PUT and DELETE 405 with Allow: POST; a GET is the read and needs the admin key', async () => {
  const t = createBeaconTest();
  assert.equal((await send(t.handler, null, { method: 'OPTIONS', raw: '' })).status, 204);
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const res = await send(t.handler, batch(I, []), { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST');
  }
  const get = await send(t.handler, null, { method: 'GET' });
  assert.equal(get.status, 401);
  assert.equal(t.blobs.rows('app-events').length, 0);
});
