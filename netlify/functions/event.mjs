// One function, two routes (via netlify.toml rewrites):
//   POST /api/event            stores one raw row per event in Netlify Blobs (store "events", key day/hour/id-event)
//   GET  /admin?key=ADMIN_KEY  counts per day: uniques (by vid) per utm_source and blended, reserve taps, plan taps
//                              (plan_rate = plan taps / uniques is the measured number), emails, the video's final
//                              state per visitor, time on page
//
// Rows are never deduped on write. Closed hours are summarised once (counts and vid lists only, no
// addresses) and cached in the "summaries" store; the email table always reads the raw rows, so
// deleting a row in "events" is the only deletion needed.
// Rows with utm_campaign=smoke, rows without utm_source and visitors with a gate pageview received before
// GATE_START are stored but kept out of the gate counts.
//
// createHandler({ getStore, env, now }) builds the handler with its dependencies injected (the tests pass a
// memory store, an env object and a frozen clock); the default export is the live one. The pure summary
// functions and the allowlists are named exports for the unit tests.

import { getStore as blobStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Gate 0 starts 2026-10-24 12:00 AM CDT (Sat), the earliest possible day 1. A visitor with a gate pageview
// received (server time) before it is excluded for good. It is also part of the per-hour summary cache's
// version (see hourSummary).
export const GATE_START = Date.parse('2026-10-24T05:00:00.000Z');
export const EVENTS = new Set(['pageview', 'tap', 'email', 'video', 'seen', 'leave']);
export const BUTTONS = new Set(['reserve', 'play', 'plan_yearly', 'plan_monthly']);
// How a plan tap happened: the card was pressed, or "Hold my spot" was pressed with the preselected plan.
export const VIAS = new Set(['card', 'hold']);
// The plan chosen when the email was typed in.
export const PLANS = new Set(['yearly', 'monthly']);
const DEVICES = new Set(['ios', 'android', 'other']);
const INAPPS = new Set(['tiktok', 'instagram', 'facebook', 'none']);
const VIDEO_STATES = new Set(['playing', 'blocked']);
const VID_RE = /^[a-z0-9]{24}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 8192;
// The pageview's user agent is stored whole up to this length (app.js slices to the same number): the real
// in-app strings run to about 280 (TikTok iOS) and 360 (TikTok Android) characters with BytedanceWebview
// near the end, and BOT_UA's token can sit past 150 (Google's documented Googlebot-smartphone string), so
// a shorter cap would defeat the bot rule and the raw-ua check.
const UA_MAX = 400;
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
// Version of the per-hour summary cache: every change to what a summary counts bumps it.
export const SUMMARY_VERSION = 7;
// A pageview is a bot's on positive evidence only: wd true (navigator.webdriver), scr 0x0 or 2000x2000, a
// user agent that starts with "Instagram " plus a digit (Meta's link checkers carry the Instagram app's
// network label; every real in-app browser starts "Mozilla/5.0"), see APP_LABEL_UA, or a user agent
// matching BOT_UA ("Bulid/" is TikTok's link checker).
export const BOT_UA = /facebookexternalhit|Facebot|meta-external|Bytespider|TikTokSpider|Googlebot|AdsBot|HeadlessChrome|PhantomJS|Lighthouse|Bulid\//i;
export const APP_LABEL_UA = /^Instagram \d/;
const HOUR_GRACE_MS = 2 * 60 * 1000;
const READ_CONCURRENCY = 32;
const HOUR_CONCURRENCY = 4;
const ADMIN_BUDGET_MS = 8000;
const SITE_ORIGINS = ['https://tryparakeet.netlify.app'];

// Per-bucket counts. VID_SETS are unique-visitor lists (one entry per vid; they move with the visitor when
// the flags are resolved at read); COUNTERS count rows and stay where the rows were stored. Every button
// has a set and a counter (a unit test checks BUTTONS against both lists).
export const VID_SETS = ['pv', 'tap', 'reserve', 'play', 'plan_yearly', 'plan_monthly', 'email', 'seen', 'video_playing', 'video_blocked'];
export const COUNTERS = ['n_pv', 'n_tap', 'n_tap_reserve', 'n_tap_play', 'n_tap_plan_yearly', 'n_tap_plan_monthly', 'n_email', 'n_video_playing', 'n_video_blocked'];

export function createHandler({ getStore = blobStore, env = process.env, now = Date.now } = {}) {
  async function handler(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    const isAdmin = req.method === 'GET' || path.endsWith('/admin');
    try {
      if (isAdmin) return await admin(req, url);
      if (req.method === 'POST') return await event(req);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: noStore() });
      return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
    } catch (err) {
      console.error(err);
      return json({ error: 'internal error' }, 500);
    }
  }

  /* ---------------- POST /api/event ---------------- */

  async function event(req) {
    const origin = req.headers.get('origin');
    if (origin && !allowedOrigin(origin)) return json({ error: 'forbidden' }, 403);

    let text;
    try { text = await req.text(); } catch { return json({ error: 'bad body' }, 400); }
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'bad json' }, 400);

    const name = str(data.event, 16);
    if (!EVENTS.has(name)) return json({ error: 'bad event' }, 400);
    const vid = str(data.vid, 64);
    if (!VID_RE.test(vid)) return json({ error: 'bad vid' }, 400);

    const at = new Date(now());
    const received = at.toISOString();
    const row = {
      event: name,
      vid,
      ts: validTs(data.ts) || received,
      received,
      utm_source: clean(data.utm_source, 100),
      utm_medium: clean(data.utm_medium, 100),
      utm_campaign: clean(data.utm_campaign, 100),
      utm_content: clean(data.utm_content, 100),
      device: DEVICES.has(data.device) ? data.device : 'other',
      inapp: INAPPS.has(data.inapp) ? data.inapp : 'none',
      ref: refOrigin(data.ref)
    };
    row.flag = flagOf(row);

    if (name === 'pageview') {
      row.ua = clean(data.ua, UA_MAX);
      row.wd = data.wd === true;
      row.scr = clean(data.scr, 12);
    } else if (name === 'email') {
      const email = clean(data.email, 254);
      if (!looksLikeEmail(email)) return json({ error: 'bad email' }, 400);
      row.email = email;
      if (absent(data.plan)) row.plan = '';
      else if (!PLANS.has(data.plan)) return json({ error: 'bad plan' }, 400);
      else row.plan = data.plan;
    } else if (name === 'video') {
      if (!VIDEO_STATES.has(data.video)) return json({ error: 'bad video state' }, 400);
      row.video = data.video;
    } else if (name === 'leave') {
      const s = Number(data.seconds);
      row.seconds = Number.isFinite(s) ? Math.min(Math.max(Math.round(s), 0), 7 * 24 * 3600) : 0;
      // the video's final state rides on the leave beacon ("video_final" is the brief's name for it);
      // anything but a known state is dropped, the seconds still count
      const state = VIDEO_STATES.has(data.video) ? data.video : data.video_final;
      if (VIDEO_STATES.has(state)) row.video = state;
    } else if (name === 'tap') {
      if (!BUTTONS.has(data.button)) return json({ error: 'bad button' }, 400);
      row.button = data.button;
      if (data.button.startsWith('plan_')) {
        if (absent(data.via)) row.via = '';
        else if (!VIAS.has(data.via)) return json({ error: 'bad via' }, 400);
        else row.via = data.via;
      }
    }

    const day = received.slice(0, 10);
    const hour = received.slice(11, 13);
    const key = `${day}/${hour}/${at.getTime()}-${randomBytes(4).toString('hex')}-${name}`;
    const store = getStore({ name: 'events', consistency: 'strong' });
    await store.setJSON(key, row);

    return new Response(null, {
      status: 204,
      headers: {
        ...noStore(),
        'Set-Cookie': `pk_v=${vid}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax; Secure`
      }
    });
  }

  function allowedOrigin(origin) {
    const allowed = new Set(SITE_ORIGINS);
    for (const v of [env.URL, env.DEPLOY_PRIME_URL, env.DEPLOY_URL]) if (v) allowed.add(v.replace(/\/$/, ''));
    if (allowed.has(origin)) return true;
    try {
      const h = new URL(origin).hostname;
      return h === 'localhost' || h === '127.0.0.1';
    } catch { return false; }
  }

  /* ---------------- GET /admin ---------------- */

  async function admin(req, url) {
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405, { Allow: 'GET' });
    const expected = env.ADMIN_KEY;
    if (!expected) return json({ error: 'ADMIN_KEY is not set in the Netlify environment' }, 503);
    if (!safeEqual(url.searchParams.get('key') || '', expected)) return json({ error: 'unauthorized' }, 401);

    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
    const table = url.searchParams.get('table') || 'summary';
    const only = dayParam(url.searchParams.get('day'));
    const from = only || dayParam(url.searchParams.get('from'));
    const to = only || dayParam(url.searchParams.get('to'));
    const deadline = now() + ADMIN_BUDGET_MS;

    const events = getStore({ name: 'events', consistency: 'strong' });
    const summaries = getStore({ name: 'summaries', consistency: 'strong' });

    const allDays = (await listDirs(events, '')).filter((d) => DAY_RE.test(d)).sort();
    const days = allDays.filter((d) => (!from || d >= from) && (!to || d <= to));

    if (table === 'raw') {
      if (!only) return json({ error: 'table=raw needs day=YYYY-MM-DD' }, 400);
      const keys = await listKeys(events, `${only}/`);
      const read = await readRows(events, keys, deadline);
      read.rows.sort(byReceived);
      const partial = read.failed > 0 || read.skipped > 0;
      if (format === 'csv') return csv(read.rows, RAW_COLUMNS, `parakeet-raw-${only}.csv`, partial);
      return json({ day: only, partial, failed: read.failed, skipped: read.skipped, rows: read.rows }, 200, noStore());
    }

    if (table === 'emails') {
      const got = await eventRows(events, days, 'email', deadline);
      const list = got.rows.map((r) => pick(r, EMAIL_COLUMNS));
      const partial = got.failed > 0 || got.skipped > 0;
      if (format === 'csv') return csv(list, EMAIL_COLUMNS, 'parakeet-emails.csv', partial);
      return json({ generated: new Date(now()).toISOString(), partial, emails: list }, 200, noStore());
    }

    const perDay = [];
    const pending = [];
    let failed = 0;
    const summarize = (day, hours) => mapLimit(hours, HOUR_CONCURRENCY, async (hour) => {
      if (now() > deadline) { pending.push(`${day}/${hour}`); return null; }
      try {
        return await hourSummary(events, summaries, day, hour);
      } catch (err) {
        console.error('hour failed', day, hour, err);
        const s = newSummary(day, hour);
        s.failed = 1;
        return s;
      }
    });
    for (const day of days) {
      const hours = (await listDirs(events, `${day}/`)).sort();
      const merged = newSummary(day, '');
      for (const h of await summarize(day, hours)) {
        if (!h) continue;
        failed += h.failed || 0;
        mergeSummary(merged, h);
      }
      perDay.push(merged);
    }
    // Pre-start visitors are excluded for good, so their ids come from every hour before GATE_START,
    // including the hours of days outside the requested range.
    const prestart = new Set();
    for (const d of perDay) for (const v of d.pre) prestart.add(v);
    for (const day of allDays) {
      if (days.includes(day) || Date.parse(`${day}T00:00:00Z`) >= GATE_START) continue;
      const hours = (await listDirs(events, `${day}/`)).filter((h) => Date.parse(`${day}T${h}:00:00Z`) < GATE_START).sort();
      for (const h of await summarize(day, hours)) {
        if (!h) continue;
        failed += h.failed || 0;
        for (const v of h.pre || []) prestart.add(v);
      }
    }
    const total = newSummary('', '');
    for (const d of perDay) mergeSummary(total, d);

    const emails = await eventRows(events, days, 'email', deadline);
    const partial = pending.length > 0 || failed > 0 || emails.failed + emails.skipped > 0;

    const out = {
      version: SUMMARY_VERSION,
      gate_start: new Date(GATE_START).toISOString(),
      generated: new Date(now()).toISOString(),
      from: days[0] || null,
      to: days[days.length - 1] || null,
      partial,
      pending,
      days: perDay.map((d) => finalizeDay(d, prestart)),
      total: finalizeDay(total, prestart),
      emails: emails.rows.map((r) => pick(r, EMAIL_COLUMNS))
    };

    if (format === 'csv') return csv(summaryRows(out), SUMMARY_COLUMNS, 'parakeet-summary.csv', partial);
    return json(out, 200, noStore());
  }

  async function hourSummary(events, summaries, day, hour) {
    const cacheKey = `${day}/${hour}`;
    const hourStart = Date.parse(`${day}T${hour}:00:00Z`);
    const closed = Number.isFinite(hourStart) && now() > hourStart + 3600 * 1000 + HOUR_GRACE_MS;
    if (closed) {
      const cached = await summaries.get(cacheKey, { type: 'json' }).catch(() => null);
      if (cached && cached.v === SUMMARY_VERSION && cached.gs === GATE_START) return cached; // a new GATE_START rebuilds the caches
    }
    const keys = await listKeys(events, `${day}/${hour}/`);
    const read = await readRows(events, keys, Infinity);
    const s = newSummary(day, hour);
    for (const row of read.rows) addRow(s, row);
    s.failed = read.failed;
    if (closed && read.failed === 0) await summaries.setJSON(cacheKey, s).catch(() => {});
    return s;
  }

  // Rows of one event type across days, read straight from the events store (the key names the event).
  async function eventRows(events, days, want, deadline) {
    const keys = [];
    for (const day of days) {
      for (const k of await listKeys(events, `${day}/`)) {
        const ev = keyEvent(k);
        if (ev === want || ev === null) keys.push(k);
      }
    }
    const read = await readRows(events, keys, deadline);
    read.rows = read.rows.filter((r) => r.event === want);
    read.rows.sort(byReceived);
    return read;
  }

  // Reads rows with bounded concurrency, one retry per key, and a deadline; reports what it could not read.
  async function readRows(store, keys, deadline) {
    const out = { rows: [], failed: 0, skipped: 0 };
    await mapLimit(keys, READ_CONCURRENCY, async (key) => {
      if (now() > deadline) { out.skipped += 1; return; }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const row = await store.get(key, { type: 'json' });
          if (row && typeof row === 'object') out.rows.push(row);
          return;
        } catch (err) {
          if (attempt === 1) { console.error('read failed', key, err); out.failed += 1; }
        }
      }
    });
    return out;
  }

  return handler;
}

export default createHandler();

export function flagOf(row) {
  if (row.utm_campaign.toLowerCase() === 'smoke') return 'smoke';
  if (!row.utm_source) return 'no_utm';
  return 'gate';
}

function keyEvent(key) {
  const m = /-([a-z]+)$/.exec(key);
  return m && EVENTS.has(m[1]) ? m[1] : null;
}

/* ---------------- summaries ---------------- */

export function newSummary(day, hour) {
  return { v: SUMMARY_VERSION, gs: GATE_START, day, hour, rows: 0, failed: 0, pre: [], buckets: Object.create(null) };
}

// buckets are keyed by flag|source; leave maps vid -> largest seconds seen (one beacon per hide, cumulative).
// A gate bucket also splits its rows by creative under content["c:" + utm_content] ("c:none" when empty),
// each entry having the same shape as the bucket's own counts. pre lists the vids with a gate pageview
// received before GATE_START.

function newCounts() {
  const c = {};
  for (const set of VID_SETS) c[set] = [];
  for (const n of COUNTERS) c[n] = 0;
  c.leave = {};
  c.device = { ios: 0, android: 0, other: 0 };
  c.inapp = { tiktok: 0, instagram: 0, facebook: 0, none: 0 };
  return c;
}

export function newBucket() {
  return { ...newCounts(), bots: [], content: {} };
}

function contentKey(row) {
  return 'c:' + (row.utm_content || 'none');
}

function bucketKey(row) {
  const flag = row.flag || flagOf(row);
  const source = flag === 'no_utm' ? '' : String(row.utm_source || '');
  return `${flag}|${encodeSafe(source)}`;
}

function encodeSafe(s) {
  try { return encodeURIComponent(s); } catch { return encodeURIComponent(s.replace(/[\uD800-\uDFFF]/g, '�')); }
}

function splitBucketKey(key) {
  const i = key.indexOf('|');
  let source = key.slice(i + 1);
  try { source = decodeURIComponent(source); } catch { /* keep as is */ }
  return [key.slice(0, i), source];
}

export function addRow(s, row) {
  s.rows += 1;
  const key = bucketKey(row);
  const b = s.buckets[key] || (s.buckets[key] = newBucket());
  addCounts(b, row);
  if (row.event === 'pageview' && isBotPageview(row)) pushUnique(b.bots, row.vid);
  if ((row.flag || flagOf(row)) === 'gate') {
    const ck = contentKey(row);
    addCounts(b.content[ck] || (b.content[ck] = newCounts()), row);
    if (row.event === 'pageview' && Date.parse(row.received) < GATE_START) pushUnique(s.pre, row.vid);
  }
}

function addCounts(b, row) {
  switch (row.event) {
    case 'pageview':
      pushUnique(b.pv, row.vid); b.n_pv += 1;
      if (b.device[row.device] !== undefined) b.device[row.device] += 1;
      if (b.inapp[row.inapp] !== undefined) b.inapp[row.inapp] += 1;
      break;
    case 'tap':
      pushUnique(b.tap, row.vid); b.n_tap += 1;
      if (BUTTONS.has(row.button)) { pushUnique(b[row.button], row.vid); b['n_tap_' + row.button] += 1; }
      break;
    case 'email':
      pushUnique(b.email, row.vid); b.n_email += 1;
      break;
    case 'video':
      addVideo(b, row.vid, row.video);
      break;
    case 'seen':
      pushUnique(b.seen, row.vid);
      break;
    case 'leave': {
      const sec = Number(row.seconds) || 0;
      if (row.vid && !(b.leave[row.vid] >= sec)) b.leave[row.vid] = sec;
      addVideo(b, row.vid, row.video); // the final state carried by the leave beacon, when present
      break;
    }
    default:
      break;
  }
}

// One video state per row: the vid joins the state's visitor list, the state's row counter grows.
function addVideo(b, vid, state) {
  if (!VIDEO_STATES.has(state)) return;
  pushUnique(b['video_' + state], vid);
  b['n_video_' + state] += 1;
}

export function isBotPageview(row) {
  const ua = row.ua || '';
  return row.wd === true || row.scr === '0x0' || row.scr === '2000x2000' || APP_LABEL_UA.test(ua) || BOT_UA.test(ua);
}

function mergeCounts(a, b) {
  for (const set of VID_SETS) for (const v of b[set] || []) pushUnique(a[set], v);
  for (const n of COUNTERS) a[n] += b[n] || 0;
  for (const vid of Object.keys(b.leave || {})) if (!(a.leave[vid] >= b.leave[vid])) a.leave[vid] = b.leave[vid];
  for (const k of Object.keys(a.device)) a.device[k] += (b.device && b.device[k]) || 0;
  for (const k of Object.keys(a.inapp)) a.inapp[k] += (b.inapp && b.inapp[k]) || 0;
}

function mergeBucket(a, b) {
  mergeCounts(a, b);
  for (const v of b.bots || []) pushUnique(a.bots, v);
  for (const ck of Object.keys(b.content || {})) mergeCounts(a.content[ck] || (a.content[ck] = newCounts()), b.content[ck]);
}

export function mergeSummary(target, s) {
  if (!s) return;
  target.rows += s.rows || 0;
  target.failed += s.failed || 0;
  for (const v of s.pre || []) pushUnique(target.pre, v);
  for (const key of Object.keys(s.buckets || {})) {
    if (!target.buckets[key]) target.buckets[key] = newBucket();
    mergeBucket(target.buckets[key], s.buckets[key]);
  }
}

// The read contract. Per-visitor numbers come from the vid lists, per-row numbers from the counters.
// plan_rate is the measured number of Gate 0. video is per visitor and playing wins: a visitor whose clip
// played on any load counts as playing; blocked is the visitors with only blocked loads; both is the overlap.
// video_events counts the rows (about one per load) beside it.
export function finalizeBucket(b) {
  const uniques = new Set([...b.pv, ...b.tap, ...b.email]).size;
  const rate = (n) => (uniques ? Number((n / uniques).toFixed(4)) : 0);
  const planTaps = new Set([...b.plan_yearly, ...b.plan_monthly]).size;
  const playing = new Set(b.video_playing);
  const blockedOnly = b.video_blocked.filter((v) => !playing.has(v)).length;
  return {
    uniques,
    reserve_taps: b.reserve.length,
    reserve_rate: rate(b.reserve.length),
    plan_taps: planTaps,
    plan_yearly_taps: b.plan_yearly.length,
    plan_monthly_taps: b.plan_monthly.length,
    plan_rate: rate(planTaps),
    play_taps: b.play.length,
    taps: b.tap.length,
    emails: b.email.length,
    pageviews: b.n_pv,
    seen: b.seen.length,
    video: { playing: b.video_playing.length, blocked: blockedOnly, both: b.video_blocked.length - blockedOnly },
    video_events: { playing: b.n_video_playing, blocked: b.n_video_blocked },
    tap_events: b.n_tap,
    tap_events_reserve: b.n_tap_reserve,
    tap_events_play: b.n_tap_play,
    tap_events_plan_yearly: b.n_tap_plan_yearly,
    tap_events_plan_monthly: b.n_tap_plan_monthly,
    email_events: b.n_email,
    leave: leaveStats(b.leave),
    device: { ...b.device },
    inapp: { ...b.inapp }
  };
}

function finalizeSource(b) {
  const content = Object.create(null);
  for (const ck of Object.keys(b.content || {}).sort()) content[ck.slice(2)] = finalizeBucket(b.content[ck]);
  return { ...finalizeBucket(b), content };
}

function leaveStats(map) {
  const values = Object.values(map || {});
  const sum = values.reduce((t, v) => t + v, 0);
  return { n: values.length, avg_seconds: values.length ? Math.round(sum / values.length) : 0 };
}

// Flags are decided per visitor, not per row, in the order bot > smoke > prestart > gate > no_utm: first
// every vid whose pageview carried bot evidence goes to the bot bucket with all its rows; a vid with a
// smoke pageview is smoke; every other vid in `prestart` (a gate pageview received before GATE_START,
// on any day) leaves every gate and no_utm bucket and every creative for the prestart bucket, with all
// its rows, rows after the start included; then a smoke vid is pulled out of every other bucket, gate
// buckets included; a vid with a gate pageview keeps that source for its no_utm rows (gate buckets keep
// each other's vids); a no_utm vid with no home stays. Unique-vid lists and the per-vid leave map move;
// per-row event counts stay where the rows were stored.
export function resolveVisitors(original, prestart) {
  const buckets = Object.create(null);
  for (const key of Object.keys(original)) buckets[key] = JSON.parse(JSON.stringify(original[key]));
  const keys = Object.keys(buckets).sort();
  const flagOfKey = (key) => splitBucketKey(key)[0];

  const bot = newBucket();
  const botVids = new Set();
  for (const key of keys) for (const v of buckets[key].bots || []) botVids.add(v);
  if (botVids.size) for (const key of keys) moveVids(buckets[key], bot, botVids);

  const smokeVids = new Set();
  for (const key of keys) if (flagOfKey(key) === 'smoke') for (const v of buckets[key].pv) smokeVids.add(v);
  const pre = newBucket();
  const preVids = new Set();
  for (const v of prestart || []) if (!botVids.has(v) && !smokeVids.has(v)) preVids.add(v);
  if (preVids.size) {
    for (const key of keys) {
      const flag = flagOfKey(key);
      if (flag === 'gate' || flag === 'no_utm') moveVids(buckets[key], pre, preVids);
    }
  }

  const home = Object.create(null); // vid -> bucket key it belongs to; smoke pageviews first, then gate
  for (const key of keys) if (flagOfKey(key) === 'smoke') for (const v of buckets[key].pv) if (!home[v]) home[v] = key;
  for (const key of keys) if (flagOfKey(key) === 'gate') for (const v of buckets[key].pv) if (!home[v]) home[v] = key;
  const moves = (flag, target) => {
    if (!target) return false;
    const targetFlag = flagOfKey(target);
    if (targetFlag === 'smoke') return true;            // smoke pulls from every other bucket
    return targetFlag === 'gate' && flag === 'no_utm';  // gate pulls from no_utm only
  };
  for (const key of keys) {
    const flag = flagOfKey(key);
    const b = buckets[key];
    const byTarget = new Map();
    const consider = (v) => {
      const target = home[v];
      if (!target || target === key || !moves(flag, target)) return;
      if (!byTarget.has(target)) byTarget.set(target, new Set());
      byTarget.get(target).add(v);
    };
    for (const set of VID_SETS) for (const v of b[set] || []) consider(v);
    for (const v of Object.keys(b.leave || {})) consider(v);
    for (const [target, vids] of byTarget) {
      const t = buckets[target];
      // into a gate bucket (from no_utm): the untagged rows join the creative of the visitor's gate pageview;
      // with more than one, the first creative in alphabetical order
      const pick = flagOfKey(target) === 'gate' ? (v) => homeCreative(t, v) : null;
      moveVids(b, t, vids, pick);
    }
  }
  return { buckets, bot, prestart: pre };
}

function homeCreative(bucket, vid) {
  for (const ck of Object.keys(bucket.content || {}).sort()) if (bucket.content[ck].pv.includes(vid)) return ck;
  return 'c:none';
}

// Moves vids from one bucket to another: top-level lists and the leave map go to `to`; their entries in
// `from`'s creatives are dropped; when `pick` is given (a gate target) they also join to.content[pick(vid)].
function moveVids(from, to, vids, pick) {
  const sub = (v) => {
    const ck = pick(v);
    return to.content[ck] || (to.content[ck] = newCounts());
  };
  for (const set of [...VID_SETS, 'bots']) {
    const keep = [];
    for (const v of from[set] || []) {
      if (!vids.has(v)) { keep.push(v); continue; }
      pushUnique(to[set], v);
      if (pick && set !== 'bots') pushUnique(sub(v)[set], v);
    }
    from[set] = keep;
  }
  for (const v of Object.keys(from.leave || {})) {
    if (!vids.has(v)) continue;
    if (!(to.leave[v] >= from.leave[v])) to.leave[v] = from.leave[v];
    if (pick) { const c = sub(v); if (!(c.leave[v] >= from.leave[v])) c.leave[v] = from.leave[v]; }
    delete from.leave[v];
  }
  for (const ck of Object.keys(from.content || {})) {
    const c = from.content[ck];
    for (const set of VID_SETS) c[set] = (c[set] || []).filter((v) => !vids.has(v));
    for (const v of Object.keys(c.leave || {})) if (vids.has(v)) delete c.leave[v];
  }
}

export function finalizeDay(s, prestart) {
  const sources = Object.create(null);
  const blended = newBucket();
  const smoke = newBucket();
  const noUtm = newBucket();
  const { buckets, bot, prestart: pre } = resolveVisitors(s.buckets, prestart);
  for (const key of Object.keys(buckets)) {
    const b = buckets[key];
    const [flag, source] = splitBucketKey(key);
    if (flag === 'gate') {
      sources[source] = finalizeSource(b);
      mergeBucket(blended, b);
    } else if (flag === 'smoke') {
      mergeBucket(smoke, b);
    } else {
      mergeBucket(noUtm, b);
    }
  }
  return {
    day: s.day || 'all',
    rows: s.rows,
    sources,
    blended: finalizeBucket(blended),
    excluded: { smoke: finalizeBucket(smoke), no_utm: finalizeBucket(noUtm), bot: finalizeBucket(bot), prestart: finalizeBucket(pre) }
  };
}

/* ---------------- CSV ---------------- */

export const RAW_COLUMNS = ['received', 'event', 'vid', 'flag', 'ts', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'device', 'inapp', 'ref', 'button', 'via', 'email', 'plan', 'video', 'seconds', 'ua', 'wd', 'scr'];
export const EMAIL_COLUMNS = ['received', 'email', 'vid', 'flag', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'device', 'inapp', 'plan'];
export const SUMMARY_COLUMNS = ['day', 'scope', 'source', 'content', 'uniques', 'reserve_taps', 'reserve_rate', 'plan_taps', 'plan_yearly_taps', 'plan_monthly_taps', 'plan_rate', 'play_taps', 'taps', 'emails', 'pageviews', 'seen', 'video_playing', 'video_blocked', 'video_both', 'video_events_playing', 'video_events_blocked', 'tap_events', 'tap_events_reserve', 'tap_events_play', 'tap_events_plan_yearly', 'tap_events_plan_monthly', 'email_events', 'leave_n', 'leave_avg_seconds', 'ios', 'android', 'other', 'inapp_tiktok', 'inapp_instagram', 'inapp_facebook', 'inapp_none'];

export function summaryRows(out) {
  const rows = [];
  const flat = (day, scope, source, content, f) => rows.push({
    day, scope, source, content,
    uniques: f.uniques, reserve_taps: f.reserve_taps, reserve_rate: f.reserve_rate,
    plan_taps: f.plan_taps, plan_yearly_taps: f.plan_yearly_taps, plan_monthly_taps: f.plan_monthly_taps, plan_rate: f.plan_rate,
    play_taps: f.play_taps, taps: f.taps, emails: f.emails, pageviews: f.pageviews, seen: f.seen,
    video_playing: f.video.playing, video_blocked: f.video.blocked, video_both: f.video.both,
    video_events_playing: f.video_events.playing, video_events_blocked: f.video_events.blocked,
    tap_events: f.tap_events, tap_events_reserve: f.tap_events_reserve, tap_events_play: f.tap_events_play,
    tap_events_plan_yearly: f.tap_events_plan_yearly, tap_events_plan_monthly: f.tap_events_plan_monthly,
    email_events: f.email_events,
    leave_n: f.leave.n, leave_avg_seconds: f.leave.avg_seconds,
    ios: f.device.ios, android: f.device.android, other: f.device.other,
    inapp_tiktok: f.inapp.tiktok, inapp_instagram: f.inapp.instagram, inapp_facebook: f.inapp.facebook, inapp_none: f.inapp.none
  });
  for (const d of [...out.days, out.total]) {
    for (const source of Object.keys(d.sources)) {
      flat(d.day, 'gate', source, '', d.sources[source]);
      for (const c of Object.keys(d.sources[source].content)) flat(d.day, 'gate', source, c, d.sources[source].content[c]);
    }
    flat(d.day, 'gate', 'blended', '', d.blended);
    flat(d.day, 'excluded', 'smoke', '', d.excluded.smoke);
    flat(d.day, 'excluded', 'no_utm', '', d.excluded.no_utm);
    flat(d.day, 'excluded', 'bot', '', d.excluded.bot);
    flat(d.day, 'excluded', 'prestart', '', d.excluded.prestart);
  }
  return rows;
}

function csv(rows, columns, filename, partial) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return new Response(lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      ...noStore(),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Partial': partial ? 'true' : 'false'
    }
  });
}

function cell(value) {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ---------------- helpers ---------------- */

async function listDirs(store, prefix) {
  const res = await store.list({ prefix, directories: true });
  return (res.directories || []).map((d) => d.slice(prefix.length).replace(/\/$/, '')).filter(Boolean);
}

async function listKeys(store, prefix) {
  const res = await store.list({ prefix });
  return (res.blobs || []).map((b) => b.key);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (err) { console.error(err); out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function byReceived(a, b) { return a.received < b.received ? -1 : a.received > b.received ? 1 : 0; }

function pushUnique(arr, v) { if (v && !arr.includes(v)) arr.push(v); }

function pick(row, columns) {
  const o = {};
  for (const c of columns) if (row[c] !== undefined) o[c] = row[c];
  return o;
}

function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

// An optional field that was not sent: undefined, null or the empty string.
function absent(v) { return v === undefined || v === null || v === ''; }

function clean(v, max) {
  if (typeof v !== 'string') return '';
  // control characters become spaces; lone surrogates (invalid UTF-16) become U+FFFD so the value is always encodable
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, (m, lead) => (lead || '') + '�')
    .trim().slice(0, max);
}

function refOrigin(v) {
  if (typeof v !== 'string' || !v) return '';
  try {
    const o = new URL(v).origin;
    return o === 'null' ? '' : o.slice(0, 200);
  } catch { return ''; }
}

function validTs(v) {
  if (typeof v !== 'string' || v.length > 40) return '';
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

function looksLikeEmail(v) {
  return typeof v === 'string' && v.length >= 3 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function dayParam(v) { return typeof v === 'string' && DAY_RE.test(v) ? v : ''; }

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
