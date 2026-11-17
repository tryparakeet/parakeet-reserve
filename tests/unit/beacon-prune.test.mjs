// prune() (run daily by netlify/functions/beacon-prune.mjs): the rows and the hour and day summaries of every day more
// than 2 years old are deleted, the daily counters after 2 days, nothing newer; a run stops at its budget and the next
// one finishes; a delete that fails stops that store's run and is logged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prune, keptFrom } from '../../netlify/functions/beacon.mjs';
import * as scheduled from '../../netlify/functions/beacon-prune.mjs';
import { createBeaconTest, sendOk, readJson, batch, note, installId } from '../helpers/beacon.mjs';
import { clock, MINUTE } from '../helpers/http.mjs';

const quiet = { log() {}, error() {} };

async function sendAt(t, iso, label) {
  t.clock.set(Date.parse(iso) + 5 * MINUTE);
  await sendOk(t.handler, batch(installId(label), [note('open', { first: true }, iso), note('week_built', { week: iso.slice(0, 10), kind: 'first', nights: 5, total: 10, budget: null, chain: 'aldi', zip3: '752', dinners: [] }, iso)]));
}

const days = (blobs, store) => [...new Set(Object.keys(blobs.dump(store)).map((k) => k.slice(0, 10)))].sort();

test('keptFrom is the same date 2 years before, in UTC; Feb 29 goes to Mar 1', () => {
  assert.equal(keptFrom(Date.parse('2028-11-20T00:00:30Z')), '2026-11-20');
  assert.equal(keptFrom(Date.parse('2028-11-20T23:59:59Z')), '2026-11-20');
  assert.equal(keptFrom(Date.parse('2028-02-29T12:00:00Z')), '2026-03-01');
});

test('the rows and summaries of days more than 2 years old go; the counters of days before yesterday go; nothing newer', async () => {
  const t = createBeaconTest({ env: { LAUNCH_AT: '2026-01-01T00:00:00Z' } });
  await sendAt(t, '2026-11-19T12:00:00.000Z', 'old');
  await sendAt(t, '2026-11-20T00:00:00.000Z', 'edge');
  await sendAt(t, '2026-11-21T08:00:00.000Z', 'newer');
  t.clock.set('2026-11-23T00:00:00.000Z');
  await readJson(t.handler); // keeps the summaries
  for (const d of ['2028-11-18', '2028-11-19', '2028-11-20']) await sendAt(t, `${d}T00:00:00.000Z`, `late-${d}`);
  assert.deepEqual(days(t.blobs, 'app-summaries'), ['2026-11-19', '2026-11-20', '2026-11-21']);
  assert.deepEqual(days(t.blobs, 'app-caps'), ['2026-11-19', '2026-11-20', '2026-11-21', '2028-11-18', '2028-11-19', '2028-11-20']);

  const c = clock('2028-11-20T00:00:30.000Z');
  const out = await prune({ getStore: t.blobs.getStore, now: c.now, logger: quiet });
  assert.equal(out.kept_from, '2026-11-20');
  assert.equal(out.done, true);
  assert.deepEqual(out.deleted, { summaries: 2, caps: 4, rows: 2 }, 'the old day\'s hour and day, four days of counters, the old day\'s two rows');
  assert.deepEqual(days(t.blobs, 'app-events'), ['2026-11-20', '2026-11-21', '2028-11-18', '2028-11-19', '2028-11-20']);
  assert.deepEqual(days(t.blobs, 'app-summaries'), ['2026-11-20', '2026-11-21']);
  assert.deepEqual(days(t.blobs, 'app-caps'), ['2028-11-19', '2028-11-20']);
  const left = JSON.stringify([t.blobs.dump('app-events'), t.blobs.dump('app-summaries'), t.blobs.dump('app-caps')]);
  assert.ok(!left.includes(installId('old')), 'the old install id is gone from every store');

  // the same day run again deletes nothing more
  const again = await prune({ getStore: t.blobs.getStore, now: c.now, logger: quiet });
  assert.deepEqual(again.deleted, { summaries: 0, caps: 0, rows: 0 });
  assert.equal(again.done, true);
});

test('a run stops at its budget and says so; the next run goes on and finishes', async () => {
  const t = createBeaconTest({ t0: '2026-11-19T12:00:00.000Z' });
  const ticks = Array.from({ length: 60 }, (_, i) => note('list_tick', { week: '2026-11-19' }, new Date(Date.parse('2026-11-19T11:00:00Z') + i * 1000).toISOString()));
  await sendOk(t.handler, batch(installId('many'), ticks));
  assert.equal(t.blobs.rows('app-events').length, 60);
  let now = Date.parse('2028-11-21T00:00:00Z');
  const first = await prune({ getStore: t.blobs.getStore, now: () => (now += 100), budgetMs: 2000, logger: quiet });
  assert.equal(first.done, false);
  assert.ok(first.deleted.rows > 0 && first.deleted.rows < 60, `deleted ${first.deleted.rows} of 60`);
  assert.equal(t.blobs.rows('app-events').length, 60 - first.deleted.rows);
  const second = await prune({ getStore: t.blobs.getStore, now: () => (now += 1), logger: quiet });
  assert.equal(second.done, true);
  assert.equal(first.deleted.rows + second.deleted.rows, 60);
  assert.equal(t.blobs.rows('app-events').length, 0);
});

test('a delete that fails stops that store\'s run, is logged, and the next run tries again', async () => {
  const t = createBeaconTest({ t0: '2026-11-19T12:00:00.000Z' });
  await sendOk(t.handler, batch(installId('one'), [note('open', { first: true }, '2026-11-19T11:00:00.000Z')]));
  t.clock.set('2026-11-20T12:00:00.000Z');
  await sendOk(t.handler, batch(installId('two'), [note('open', { first: true }, '2026-11-20T11:00:00.000Z')]));
  const broken = (opts) => {
    const store = t.blobs.getStore(opts);
    if (opts.name !== 'app-events') return store;
    return { ...store, delete: async () => { throw new Error('blobs down'); } };
  };
  const errors = [];
  const c = clock('2028-11-22T00:00:00.000Z');
  const out = await prune({ getStore: broken, now: c.now, logger: { log() {}, error: (...a) => errors.push(a.join(' ')) } });
  assert.equal(out.done, false);
  assert.equal(out.deleted.rows, 0);
  assert.equal(errors.length, 1, 'one line for the day it stopped on');
  assert.match(errors[0], /^prune app-events 2026-11-19 /);
  assert.equal(t.blobs.rows('app-events').length, 2, 'the next day was not tried');
  const fixed = await prune({ getStore: t.blobs.getStore, now: c.now, logger: quiet });
  assert.equal(fixed.done, true);
  assert.equal(fixed.deleted.rows, 2);
});

test('beacon-prune.mjs runs prune() every day on Netlify\'s scheduler', () => {
  assert.deepEqual(scheduled.config, { schedule: '@daily' });
  assert.equal(typeof scheduled.default, 'function');
});
