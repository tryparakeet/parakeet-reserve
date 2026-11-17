// The funnel beacon's receiver and its read: one function, two routes (via netlify.toml rewrites). The contract is
// parakeet-app's docs/BEACON.md; the brief is its docs/SITE-01-BEACON.md.
//   POST /beacon                  the app's notes. The x-beacon-key header must be BEACON_KEY (401); a batch over 64 KB
//                                 or 200 notes, an install that isn't a lowercase UUID or a build that isn't release or
//                                 dev is turned away (400). Each note is checked against BEACON.md §3: a note with an
//                                 unknown name or prop, a missing prop or a value §3 doesn't allow is dropped, never the
//                                 batch, and so is one whose at is more than 90 days back or 1 day ahead. At most 2,000
//                                 notes per install per UTC day are kept. A kept note is one raw row in the Blobs store
//                                 "app-events", key day/hour/<ms>-<16 hex>-<name> of the time it arrived. Then 204.
//   GET  /admin/app?key=ADMIN_KEY BEACON.md §5's numbers from the release rows. An install first seen before LAUNCH_AT
//                                 is a test install and stays under before_launch for good, rows after LAUNCH_AT
//                                 included, as Gate 0 kept its prestart visitors (Umyt, Nov 17); while LAUNCH_AT is
//                                 empty, every install is there. Dev rows are only counted.
//
// A row holds the install, the build, the version, the note's name, at and props, and the time it arrived: never an IP
// address or a user agent. The daily cap's counters are in "app-caps" (key day/install).
//
// Closed hours are summed once into "app-summaries" (key day/hour), and a closed day's hours are folded into one
// summary (key day/day), the way event.mjs keeps closed hours, so a read reads raw rows only for the hours still open.
// A summary keeps facts per install id, so it goes with the rows once 2 years old: prune() deletes both, and the daily
// counters after 2 days, every day from beacon-prune.mjs. A read leaves out any day older than that.
//
// createHandler({ getStore, env, now, logger }) builds the handler with its dependencies injected (the tests pass a
// memory store, an env object, a frozen clock and a quiet logger); the default export is the live one. The allowlists,
// checkNote(), the summary functions, stateOfZip3() and prune() are named exports for the tests and beacon-prune.mjs.

import { getStore as blobStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import ZIP3_TABLE from './zip3-states.json' with { type: 'json' };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const EVENTS_STORE = 'app-events';
export const SUMMARIES_STORE = 'app-summaries';
export const CAPS_STORE = 'app-caps';

export const MAX_BODY = 64 * 1024; // bytes
export const MAX_NOTES = 200;
export const DAILY_CAP = 2000; // notes kept per install per UTC day
export const AT_BACK_MS = 90 * DAY;
export const AT_AHEAD_MS = DAY;
export const KEEP_YEARS = 2; // rows and summaries (BEACON.md §6)
export const CAP_KEEP_DAYS = 2; // the daily counters: today and yesterday
// Version of the hour and day summaries: every change to what a summary keeps bumps it, and the summaries kept are
// summed again from the rows.
export const SUMMARY_VERSION = 1;

const HOUR_GRACE_MS = 2 * MINUTE;
const READ_CONCURRENCY = 32;
const WRITE_CONCURRENCY = 16;
const HOUR_CONCURRENCY = 4;
const DAY_CONCURRENCY = 32; // a read loads every kept day summary: about 730 at 2 years
const READ_BUDGET_MS = 8000;
export const PRUNE_BUDGET_MS = 20000; // a scheduled function gets 30 seconds

// BEACON.md §3's values: parakeet-app's NIGHT_IDS, CHAIN_IDS and DIET_IDS (src/state/setupModel.ts) and PlanId
// (src/state/access.ts).
export const NIGHT_IDS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const CHAIN_IDS = Object.freeze(['walmart', 'kroger', 'target', 'aldi']);
export const DIET_IDS = Object.freeze(['anything', 'pescatarian', 'vegetarian', 'vegan']);
export const PLAN_IDS = Object.freeze(['yearly', 'monthly']);
export const OFFERS = Object.freeze(['free_week', 'code']);
export const KINDS = Object.freeze(['first', 'this', 'next', 'rebuild']);
export const MARKS = Object.freeze(['up', 'down', 'none']);
export const BUILDS = Object.freeze(['release', 'dev']);

// BEACON.md §3, note by note: each prop and the kind of value it takes (VALUES below). Every prop is required but
// open's first, which may be left out (read as false); a budget is null for the cheapest week, and a zip3 may be null.
export const NOTES = deepFreeze({
  open: { first: 'bool?' },
  onboarding_page: { page: 'route' },
  onboarding_done: { chain: 'chain', zip3: 'zip3', people: 'people', nights: 'nights', diet: 'diet', budget: 'budget' },
  week_built: { week: 'week', kind: 'kind', nights: 'nights', total: 'dollars', budget: 'budget', chain: 'chain', zip3: 'zip3', dinners: 'dinners' },
  recipe_opened: { dinner: 'id', week: 'week' },
  swap: { week: 'week', night: 'night', from: 'id', to: 'id' },
  thumb: { dinner: 'id', mark: 'mark' },
  hide: { dinner: 'id', on: 'bool' },
  cooked: { dinner: 'id', week: 'week', night: 'night', on: 'bool' },
  list_opened: { week: 'week' },
  list_tick: { week: 'week' },
  price_typed: { item: 'id', chain: 'chain' },
  paywall_seen: { from: 'route' },
  plans_seen: { from: 'route' },
  trial_started: { plan: 'plan', offer: 'offer' },
  subscribed: { plan: 'plan' },
  restored: { found: 'bool' },
  notifications: { allowed: 'bool' }
});

// A recipe or ingredient id (recipes.json, ingredients.json): lowercase letters, digits, _ and -, not starting with _.
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// A route's name: lowercase letters, digits and _ - / ( ) [ ] +, not starting with _.
const ROUTE_RE = /^[a-z0-9()[\]+\/-][a-z0-9_()[\]+\/-]{0,63}$/;
const ZIP3_RE = /^\d{3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_RE = /^\d{2}$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const INSTALL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

const oneOf = (list) => (v) => list.includes(v);
const isDollars = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000;
export const VALUES = Object.freeze({
  bool: (v) => typeof v === 'boolean',
  id: (v) => typeof v === 'string' && ID_RE.test(v),
  route: (v) => typeof v === 'string' && ROUTE_RE.test(v),
  week: (v) => isDay(v),
  night: oneOf(NIGHT_IDS),
  chain: oneOf(CHAIN_IDS),
  diet: oneOf(DIET_IDS),
  kind: oneOf(KINDS),
  mark: oneOf(MARKS),
  plan: oneOf(PLAN_IDS),
  offer: oneOf(OFFERS),
  zip3: (v) => v === null || (typeof v === 'string' && ZIP3_RE.test(v)),
  people: (v) => Number.isInteger(v) && v >= 1 && v <= 100,
  nights: (v) => Number.isInteger(v) && v >= 1 && v <= NIGHT_IDS.length,
  dollars: isDollars,
  budget: (v) => v === null || isDollars(v),
  dinners: (v) => Array.isArray(v) && v.length <= NIGHT_IDS.length && v.every((x) => typeof x === 'string' && ID_RE.test(x))
});

// The 50 states, for the states number. DC, the territories and military mail are listed by state but never counted
// as a state.
export const FIFTY_STATES = Object.freeze(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']);

// zip3-states.json's ranges, one prefix at a time.
const ZIP3_STATE = new Map();
for (const [first, last, state] of ZIP3_TABLE.ranges) {
  for (let p = Number(first); p <= Number(last); p++) ZIP3_STATE.set(String(p).padStart(3, '0'), state);
}

export function stateOfZip3(zip3) {
  return typeof zip3 === 'string' && ZIP3_STATE.has(zip3) ? ZIP3_STATE.get(zip3) : null;
}

export function createHandler({ getStore = blobStore, env = process.env, now = Date.now, logger = console } = {}) {
  async function handler(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    const isRead = req.method === 'GET' || path.endsWith('/admin/app');
    try {
      if (isRead) return await read(req, url);
      if (req.method === 'POST') return await receive(req);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: noStore() });
      return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
    } catch (err) {
      logger.error(err);
      return json({ error: 'internal error' }, 500);
    }
  }

  /* ---------------- POST /beacon ---------------- */

  async function receive(req) {
    const expected = env.BEACON_KEY;
    if (!expected) return json({ error: 'BEACON_KEY is not set in the Netlify environment' }, 503);
    if (!safeEqual(req.headers.get('x-beacon-key') || '', expected)) return json({ error: 'unauthorized' }, 401);

    if (Number(req.headers.get('content-length')) > MAX_BODY) return json({ error: 'too large' }, 400);
    let bytes;
    try { bytes = new Uint8Array(await req.arrayBuffer()); } catch { return json({ error: 'bad body' }, 400); }
    if (bytes.byteLength > MAX_BODY) return json({ error: 'too large' }, 400);
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'bad json' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'bad json' }, 400);
    if (typeof data.install !== 'string' || !INSTALL_RE.test(data.install)) return json({ error: 'bad install' }, 400);
    if (!BUILDS.includes(data.build)) return json({ error: 'bad build' }, 400);
    if (!Array.isArray(data.events)) return json({ error: 'bad events' }, 400);
    if (data.events.length > MAX_NOTES) return json({ error: 'too many notes' }, 400);

    const at = now();
    const received = new Date(at).toISOString();
    const day = received.slice(0, 10);
    const hour = received.slice(11, 13);
    const version = typeof data.version === 'string' && VERSION_RE.test(data.version) ? data.version : '';
    const kept = [];
    const dropped = {};
    for (const raw of data.events) {
      const checked = checkNote(raw, at);
      if (checked.note) kept.push(checked.note);
      else count(dropped, dropReason(checked));
    }

    let stored = 0;
    if (kept.length) {
      const caps = getStore({ name: CAPS_STORE, consistency: 'strong' });
      const capKey = `${day}/${data.install}`;
      const counted = await caps.get(capKey, { type: 'json' }).catch(() => null);
      const used = counted && Number.isInteger(counted.n) && counted.n > 0 ? counted.n : 0;
      const notes = kept.slice(0, Math.max(0, DAILY_CAP - used));
      if (notes.length) {
        const events = getStore({ name: EVENTS_STORE, consistency: 'strong' });
        const { error } = await mapLimit(notes, WRITE_CONCURRENCY, (note) => events.setJSON(
          `${day}/${hour}/${at}-${randomBytes(8).toString('hex')}-${note.name}`,
          { install: data.install, build: data.build, version, name: note.name, at: note.at, props: note.props, received }
        ));
        if (error) throw error; // 500: the app keeps the batch and sends it again; a note stored twice counts once
        await caps.setJSON(capKey, { n: used + notes.length });
        stored = notes.length;
      }
      if (kept.length > notes.length) dropped.cap = kept.length - notes.length;
    }
    // Netlify's function log shows why notes were dropped (reasons, names and props, never a value), so a note the
    // app and this file disagree on is seen.
    if (Object.keys(dropped).length) logger.log(`beacon: kept ${stored} of ${data.events.length} (${data.build}); dropped ${JSON.stringify(sorted(dropped))}`);
    return new Response(null, { status: 204, headers: noStore() });
  }

  /* ---------------- GET /admin/app ---------------- */

  async function read(req, url) {
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405, { Allow: 'GET' });
    const expected = env.ADMIN_KEY;
    if (!expected) return json({ error: 'ADMIN_KEY is not set in the Netlify environment' }, 503);
    if (!safeEqual(url.searchParams.get('key') || '', expected)) return json({ error: 'unauthorized' }, 401);
    const launch = launchAt(env.LAUNCH_AT);
    if (launch.error) return json({ error: launch.error }, 503);

    const deadline = now() + READ_BUDGET_MS;
    const events = getStore({ name: EVENTS_STORE, consistency: 'strong' });
    const summaries = getStore({ name: SUMMARIES_STORE, consistency: 'strong' });
    const from = keptFrom(now());
    const days = (await listDirs(events, '')).filter((d) => DAY_RE.test(d) && d >= from).sort();
    const pending = [];
    const total = newSummary();
    for (const s of await daySummaries(events, summaries, days, deadline, pending)) mergeSummary(total, s);

    return json({
      version: SUMMARY_VERSION,
      generated: new Date(now()).toISOString(),
      launch_at: launch.at === null ? null : new Date(launch.at).toISOString(),
      partial: pending.length > 0 || total.failed > 0,
      pending: pending.sort(),
      ...finalizeRead(total, { launchAt: launch.at, now: now() })
    }, 200, noStore());
  }

  // Each day's summary: a closed day's own when it was kept, else its hours, summed (and kept once the day is closed
  // and every hour was read).
  async function daySummaries(events, summaries, days, deadline, pending) {
    const out = [];
    const closedDays = days.filter((d) => isClosed(`${d}T00:00:00Z`, DAY));
    const { out: kept } = await mapLimit(closedDays, DAY_CONCURRENCY, (d) => summaries.get(`${d}/day`, { type: 'json' }).catch(() => null));
    const done = new Set();
    closedDays.forEach((d, i) => {
      if (kept[i] && kept[i].v === SUMMARY_VERSION) { out.push(kept[i]); done.add(d); }
    });
    for (const day of days) {
      if (done.has(day)) continue;
      if (now() > deadline) { pending.push(day); continue; }
      out.push(await daySummary(events, summaries, day, deadline, pending));
    }
    return out;
  }

  async function daySummary(events, summaries, day, deadline, pending) {
    const hours = (await listDirs(events, `${day}/`)).filter((h) => HOUR_RE.test(h)).sort();
    const merged = newSummary(day, '');
    let whole = true;
    const { out: parts } = await mapLimit(hours, HOUR_CONCURRENCY, async (hour) => {
      if (now() > deadline) { pending.push(`${day}/${hour}`); whole = false; return null; }
      try {
        const s = await hourSummary(events, summaries, day, hour, deadline);
        if (s.skipped) { pending.push(`${day}/${hour}`); whole = false; }
        return s;
      } catch (err) {
        logger.error('hour failed', day, hour, err);
        const s = newSummary(day, hour);
        s.failed = 1;
        return s;
      }
    });
    for (const s of parts) if (s) mergeSummary(merged, s);
    if (whole && merged.failed === 0 && isClosed(`${day}T00:00:00Z`, DAY)) await summaries.setJSON(`${day}/day`, merged).catch(() => {});
    return merged;
  }

  async function hourSummary(events, summaries, day, hour, deadline) {
    const key = `${day}/${hour}`;
    const closed = isClosed(`${day}T${hour}:00:00Z`, HOUR);
    if (closed) {
      const kept = await summaries.get(key, { type: 'json' }).catch(() => null);
      if (kept && kept.v === SUMMARY_VERSION) return kept;
    }
    const keys = await listKeys(events, `${key}/`);
    const got = await readRows(events, keys, deadline);
    const s = newSummary(day, hour);
    for (const row of got.rows) addRow(s, row);
    s.failed = got.failed;
    if (got.skipped) s.skipped = got.skipped;
    if (closed && got.failed === 0 && got.skipped === 0) await summaries.setJSON(key, s).catch(() => {});
    return s;
  }

  // Reads rows with bounded concurrency, one retry per key, and the read's deadline; reports what it could not read.
  async function readRows(store, keys, deadline) {
    const got = { rows: [], failed: 0, skipped: 0 };
    await mapLimit(keys, READ_CONCURRENCY, async (key) => {
      if (now() > deadline) { got.skipped += 1; return; }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const row = await store.get(key, { type: 'json' });
          if (row && typeof row === 'object') got.rows.push(row);
          return;
        } catch (err) {
          if (attempt === 1) { logger.error('read failed', key, err); got.failed += 1; }
        }
      }
    });
    return got;
  }

  // An hour or a day is closed a little after it ends: a request that started inside it may still be writing.
  function isClosed(startIso, length) {
    const start = Date.parse(startIso);
    return Number.isFinite(start) && now() > start + length + HOUR_GRACE_MS;
  }

  return handler;
}

export default createHandler();

/* ---------------- the notes ---------------- */

// One note against §3 and the time the batch arrived: { note } with only §3's props, or { drop, name, prop } with
// the reason it was dropped.
export function checkNote(raw, receivedMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { drop: 'shape' };
  const name = raw.name;
  if (typeof name !== 'string' || !Object.hasOwn(NOTES, name)) return { drop: 'name' };
  // Date.parse rolls a day that doesn't exist (Feb 30) into the next month, so the date is checked as a day first
  const t = typeof raw.at === 'string' && AT_RE.test(raw.at) && isDay(raw.at.slice(0, 10)) ? Date.parse(raw.at) : NaN;
  if (!Number.isFinite(t)) return { drop: 'at', name };
  if (t < receivedMs - AT_BACK_MS || t > receivedMs + AT_AHEAD_MS) return { drop: 'when', name };
  const given = raw.props === undefined || raw.props === null ? {} : raw.props;
  if (typeof given !== 'object' || Array.isArray(given)) return { drop: 'props', name };
  const spec = NOTES[name];
  for (const key of Object.keys(given)) if (!Object.hasOwn(spec, key)) return { drop: 'prop', name, prop: key };
  const props = {};
  for (const [key, kind] of Object.entries(spec)) {
    const optional = kind.endsWith('?');
    if (!Object.hasOwn(given, key)) {
      if (optional) continue;
      return { drop: 'missing', name, prop: key };
    }
    if (!VALUES[optional ? kind.slice(0, -1) : kind](given[key])) return { drop: 'value', name, prop: key };
    props[key] = Array.isArray(given[key]) ? [...given[key]] : given[key];
  }
  return { note: { name, at: new Date(t).toISOString(), props } };
}

// The log's word for a drop: the reason, the note's name and the prop, never a value; a name or a prop that is not a
// plain word shows as "?".
function dropReason(checked) {
  const word = (s) => (/^[A-Za-z0-9_]{1,40}$/.test(s) ? s : '?');
  return [checked.drop, checked.name, checked.prop].filter((s) => typeof s === 'string').map((s, i) => (i ? word(s) : s)).join(':');
}

/* ---------------- summaries ---------------- */

// The rows of an hour or a day, summed: the dev rows counted by name, and for each release install the facts §5 is
// read from. Each fact is an earliest time, a latest [time, value] or a set keyed by the note's time, so the same note
// summed twice (a batch the app sent again) changes nothing, and summaries merge in any order.
export function newSummary(day = '', hour = '') {
  return { v: SUMMARY_VERSION, day, hour, rows: 0, failed: 0, dev: { rows: 0, by_name: {}, installs: {} }, installs: {} };
}

export function newFacts() {
  return {
    seen: null, // the earliest time a row of the install arrived: before LAUNCH_AT, a test install
    first: null, // the earliest at of any note
    first_open: null, // the earliest open with first: true
    by_name: {}, // rows by note name
    pages: {}, // onboarding page -> its earliest at
    setup: null, // the earliest onboarding_done
    chain: null, // [at, chain], the latest of onboarding_done and week_built
    zip3: null, // [at, zip3], the latest of the two (a null zip3 leaves it)
    weeks: {}, // week -> [the first build's at, the last build's at, the last build's total]
    list: null, // the earliest list_opened
    cooked: {}, // "week night" -> [at, on], the last mark
    prices: {}, // "at item chain" -> 1: each price typed, once
    thumbs: {}, // dinner -> [at, mark], the last
    hides: {}, // dinner -> [at, on], the last
    swaps: {}, // "at week night from to" -> from: each swap, once
    paywall: null, // the earliest paywall_seen
    trial: null, // the earliest trial_started
    subscribed: null // the earliest subscribed
  };
}

export function addRow(s, row) {
  if (!row || typeof row !== 'object' || typeof row.install !== 'string' || !INSTALL_RE.test(row.install)) return;
  if (!Object.hasOwn(NOTES, row.name) || typeof row.at !== 'string') return;
  s.rows += 1;
  if (row.build === 'dev') {
    s.dev.rows += 1;
    count(s.dev.by_name, row.name);
    s.dev.installs[row.install] = 1;
    return;
  }
  if (row.build !== 'release') return;
  if (!own(s.installs, row.install)) s.installs[row.install] = newFacts();
  addFact(s.installs[row.install], row);
}

function addFact(f, row) {
  const at = row.at;
  const p = row.props && typeof row.props === 'object' ? row.props : {};
  f.seen = earliest(f.seen, typeof row.received === 'string' ? row.received : at);
  f.first = earliest(f.first, at);
  count(f.by_name, row.name);
  switch (row.name) {
    case 'open':
      if (p.first === true) f.first_open = earliest(f.first_open, at);
      break;
    case 'onboarding_page':
      if (typeof p.page === 'string') f.pages[p.page] = earliest(own(f.pages, p.page), at);
      break;
    case 'onboarding_done':
      f.setup = earliest(f.setup, at);
      place(f, at, p);
      break;
    case 'week_built':
      if (typeof p.week === 'string') f.weeks[p.week] = mergeWeek(own(f.weeks, p.week), [at, at, dollars(p.total)]);
      place(f, at, p);
      break;
    case 'list_opened':
      f.list = earliest(f.list, at);
      break;
    case 'cooked':
      if (typeof p.week === 'string' && typeof p.night === 'string') {
        const k = `${p.week} ${p.night}`;
        f.cooked[k] = later(own(f.cooked, k), [at, p.on === true]);
      }
      break;
    case 'price_typed':
      f.prices[`${at} ${p.item} ${p.chain}`] = 1;
      break;
    case 'thumb':
      if (typeof p.dinner === 'string') f.thumbs[p.dinner] = later(own(f.thumbs, p.dinner), [at, p.mark]);
      break;
    case 'hide':
      if (typeof p.dinner === 'string') f.hides[p.dinner] = later(own(f.hides, p.dinner), [at, p.on === true]);
      break;
    case 'swap':
      if (typeof p.from === 'string') f.swaps[`${at} ${p.week} ${p.night} ${p.from} ${p.to}`] = p.from;
      break;
    case 'paywall_seen':
      f.paywall = earliest(f.paywall, at);
      break;
    case 'trial_started':
      f.trial = earliest(f.trial, at);
      break;
    case 'subscribed':
      f.subscribed = earliest(f.subscribed, at);
      break;
    default:
      break;
  }
}

// The store chain and the ZIP3 a note carries: the install's place, the latest wins.
function place(f, at, p) {
  if (CHAIN_IDS.includes(p.chain)) f.chain = later(f.chain, [at, p.chain]);
  if (typeof p.zip3 === 'string') f.zip3 = later(f.zip3, [at, p.zip3]);
}

function mergeFacts(a, b) {
  for (const k of ['seen', 'first', 'first_open', 'setup', 'list', 'paywall', 'trial', 'subscribed']) a[k] = earliest(a[k], b[k]);
  for (const k of ['chain', 'zip3']) a[k] = later(a[k], b[k]);
  for (const [name, n] of Object.entries(b.by_name || {})) count(a.by_name, name, n);
  for (const [page, at] of Object.entries(b.pages || {})) a.pages[page] = earliest(own(a.pages, page), at);
  for (const [week, w] of Object.entries(b.weeks || {})) a.weeks[week] = mergeWeek(own(a.weeks, week), w);
  for (const map of ['cooked', 'thumbs', 'hides']) for (const [k, x] of Object.entries(b[map] || {})) a[map][k] = later(own(a[map], k), x);
  for (const map of ['prices', 'swaps']) for (const [k, x] of Object.entries(b[map] || {})) a[map][k] = x;
  return a;
}

export function mergeSummary(target, s) {
  if (!s) return target;
  target.rows += s.rows || 0;
  target.failed += s.failed || 0;
  const dev = s.dev || {};
  target.dev.rows += dev.rows || 0;
  for (const [name, n] of Object.entries(dev.by_name || {})) count(target.dev.by_name, name, n);
  for (const id of Object.keys(dev.installs || {})) target.dev.installs[id] = 1;
  for (const [id, f] of Object.entries(s.installs || {})) {
    if (own(target.installs, id)) mergeFacts(target.installs[id], f);
    else target.installs[id] = mergeFacts(newFacts(), f);
  }
  return target;
}

/* ---------------- the read ---------------- */

// The read's JSON from the summed facts: launch and before_launch (BEACON.md §5, each the same shape) and dev.
export function finalizeRead(summary, { launchAt = null, now = Date.now() } = {}) {
  const launch = [];
  const before = [];
  for (const f of Object.values(summary.installs)) {
    const seen = typeof f.seen === 'string' ? Date.parse(f.seen) : NaN;
    if (launchAt !== null && Number.isFinite(seen) && seen >= launchAt) launch.push(f);
    else before.push(f);
  }
  return {
    launch: numbers(launch, now),
    before_launch: numbers(before, now),
    dev: { rows: summary.dev.rows, installs: Object.keys(summary.dev.installs).length, by_name: sorted(summary.dev.by_name) }
  };
}

// §5's numbers for a group of installs. The funnel and the goals count from each install's first open: its open with
// first: true, or its earliest note when that one never came. A goal over N days counts only the installs whose N
// days are over; a week of weeks_built_by_week counts only the installs that have lived through it.
export function numbers(installs, nowMs) {
  const byName = {};
  let rows = 0;
  let weeksPlanned = 0;
  let dinnersCooked = 0;
  let pricesTyped = 0;
  let cents = 0;
  let builders = 0;
  const byState = {};
  let unmatched = 0;
  const likes = {};
  const dinners = {};
  const chains = Object.fromEntries(CHAIN_IDS.map((c) => [c, 0]));
  const funnel = {};
  const price14 = { reached: 0, of: 0 };
  const cooked7 = { reached: 0, of: 0 };
  const paywall = { seen: 0, free_week_started: 0, subscribed: 0 };
  const byWeek = Array.from({ length: 8 }, (_, i) => ({ week: i + 1, of: 0, built: 0, weeks: 0 }));
  const dinner = (id) => own(dinners, id) || (dinners[id] = { swapped_away: 0, hidden: 0, thumbs_down: 0 });

  for (const f of installs) {
    for (const [name, n] of Object.entries(f.by_name)) { count(byName, name, n); rows += n; }
    const weeks = Object.values(f.weeks);
    weeksPlanned += weeks.length;
    if (weeks.length) builders += 1;
    for (const w of weeks) cents += Math.round(w[2] * 100);
    const cookedOn = Object.values(f.cooked).filter((c) => c[1] === true);
    dinnersCooked += cookedOn.length;
    const priceAts = Object.keys(f.prices).map((k) => k.split(' ')[0]);
    pricesTyped += priceAts.length;
    if (f.zip3) {
      const state = stateOfZip3(f.zip3[1]);
      if (state) count(byState, state);
      else unmatched += 1;
    }
    if (f.chain && Object.hasOwn(chains, f.chain[1])) chains[f.chain[1]] += 1;
    for (const [id, [, mark]] of Object.entries(f.thumbs)) {
      if (mark === 'up') count(likes, id);
      else if (mark === 'down') dinner(id).thumbs_down += 1;
    }
    for (const [id, [, on]] of Object.entries(f.hides)) if (on) dinner(id).hidden += 1;
    for (const from of Object.values(f.swaps)) dinner(from).swapped_away += 1;
    if (f.paywall) paywall.seen += 1;
    if (f.trial) paywall.free_week_started += 1;
    if (f.subscribed) paywall.subscribed += 1;

    const open = Date.parse(f.first_open || f.first);
    if (!Number.isFinite(open)) continue;
    const cohort = mondayOf(open);
    const c = own(funnel, cohort) || (funnel[cohort] = { opened: 0, setup_done: 0, week_built: 0, list_opened: 0, dinner_cooked: 0, second_week_built: 0, onboarding_pages: {} });
    c.opened += 1;
    if (f.setup) c.setup_done += 1;
    if (weeks.length >= 1) c.week_built += 1;
    if (f.list) c.list_opened += 1;
    if (cookedOn.length) c.dinner_cooked += 1;
    if (weeks.length >= 2) c.second_week_built += 1;
    for (const page of Object.keys(f.pages)) count(c.onboarding_pages, page);

    if (nowMs - open >= 14 * DAY) {
      price14.of += 1;
      if (priceAts.some((at) => Date.parse(at) - open <= 14 * DAY)) price14.reached += 1;
    }
    if (nowMs - open >= 7 * DAY) {
      cooked7.of += 1;
      if (cookedOn.some(([at]) => Date.parse(at) - open <= 7 * DAY)) cooked7.reached += 1;
    }
    for (const b of byWeek) {
      const start = open + (b.week - 1) * 7 * DAY;
      const end = start + 7 * DAY;
      if (nowMs < end) continue;
      b.of += 1;
      const firstBuilt = weeks.filter((w) => { const t = Date.parse(w[0]); return t >= start && t < end; }).length;
      if (firstBuilt) { b.built += 1; b.weeks += firstBuilt; }
    }
  }

  const cohorts = {};
  for (const k of Object.keys(funnel).sort()) cohorts[k] = { ...funnel[k], onboarding_pages: sorted(funnel[k].onboarding_pages) };
  return {
    installs: installs.length,
    rows,
    by_name: sorted(byName),
    social_proof: {
      weeks_planned: weeksPlanned,
      dinners_cooked: dinnersCooked,
      shelf_prices_checked: pricesTyped,
      groceries_planned_dollars: cents / 100,
      people_who_built_a_week: builders,
      states: { count: FIFTY_STATES.filter((s) => own(byState, s)).length, by_state: sorted(byState), unmatched },
      likes: sorted(likes)
    },
    funnel: cohorts,
    goals: {
      price_typed_within_14_days: { ...price14, rate: rate(price14.reached, price14.of) },
      dinner_cooked_within_7_days: { ...cooked7, rate: rate(cooked7.reached, cooked7.of) },
      paywall,
      weeks_built_by_week: byWeek,
      installs_by_chain: chains,
      dinners: sorted(dinners)
    }
  };
}

/* ---------------- 2 years ---------------- */

// The first day kept at a given time: the same date 2 years before, in UTC. The rows and summaries of every earlier
// day are deleted by prune() and left out of every read.
export function keptFrom(nowMs) {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear() - KEEP_YEARS, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

// Deletes the rows and the hour and day summaries of every day before keptFrom(now), and the daily counters of every
// day before yesterday. It stops at its budget, and the next run goes on from there (beacon-prune.mjs, daily).
export async function prune({ getStore = blobStore, now = Date.now, budgetMs = PRUNE_BUDGET_MS, logger = console } = {}) {
  const deadline = now() + budgetMs;
  const today = new Date(now());
  const before = keptFrom(now());
  const capsBefore = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (CAP_KEEP_DAYS - 1))).toISOString().slice(0, 10);
  const out = { kept_from: before, deleted: { summaries: 0, caps: 0, rows: 0 }, done: true };
  const work = [[SUMMARIES_STORE, before, 'summaries'], [CAPS_STORE, capsBefore, 'caps'], [EVENTS_STORE, before, 'rows']];
  for (const [name, until, field] of work) {
    const store = getStore({ name, consistency: 'strong' });
    const days = (await listDirs(store, '')).filter((d) => DAY_RE.test(d) && d < until).sort();
    for (const day of days) {
      if (now() > deadline) { out.done = false; break; }
      const keys = await listKeys(store, `${day}/`);
      const { out: gone, error } = await mapLimit(keys, WRITE_CONCURRENCY, async (key) => {
        if (now() > deadline) return false;
        await store.delete(key);
        return true;
      });
      out.deleted[field] += gone.filter((g) => g === true).length;
      if (error) logger.error('prune', name, day, error);
      if (error || gone.some((g) => g !== true)) { out.done = false; break; }
    }
  }
  return out;
}

/* ---------------- helpers ---------------- */

function launchAt(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return { at: null };
  const t = /^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(s) : NaN;
  if (!Number.isFinite(t)) return { error: 'LAUNCH_AT is not a date (ISO 8601, such as 2027-01-12T00:00:00-06:00)' };
  return { at: t };
}

function isDay(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

// The Monday (UTC) of the week a time falls in: the funnel's cohorts.
function mondayOf(ms) {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
}

function own(o, k) { return Object.hasOwn(o, k) ? o[k] : null; }

function count(o, k, n = 1) { o[k] = (own(o, k) || 0) + n; }

function earliest(a, b) {
  if (a === null || a === undefined) return b === undefined ? null : b;
  if (b === null || b === undefined) return a;
  return b < a ? b : a;
}

// [at, value] pairs: the later at wins; on the same at, the larger as JSON, so the order of summing never matters.
function later(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  if (a[0] !== b[0]) return b[0] > a[0] ? b : a;
  return JSON.stringify(b) > JSON.stringify(a) ? b : a;
}

// A week's builds as [the first's at, the last's at, the last's total].
function mergeWeek(a, b) {
  if (!a) return b;
  if (!b) return a;
  const last = later([a[1], a[2]], [b[1], b[2]]);
  return [a[0] < b[0] ? a[0] : b[0], last[0], last[1]];
}

function dollars(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0; }

function rate(n, of) { return of ? Number((n / of).toFixed(4)) : 0; }

function sorted(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

async function listDirs(store, prefix) {
  const res = await store.list({ prefix, directories: true });
  return (res.directories || []).map((d) => d.slice(prefix.length).replace(/\/$/, '')).filter(Boolean);
}

async function listKeys(store, prefix) {
  const res = await store.list({ prefix });
  return (res.blobs || []).map((b) => b.key);
}

// Runs fn over items, at most `limit` at a time: { out, error } with the first error thrown, if any.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let error = null;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (err) { if (!error) error = err; out[i] = undefined; }
    }
  });
  await Promise.all(workers);
  return { out, error };
}

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function noStore() {
  return { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...noStore(), ...extra }
  });
}
