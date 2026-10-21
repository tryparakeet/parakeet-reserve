// Summary version 6 of the copied instrument (Restline main 6251e27): the pure summary functions as
// they were on 2026-10-21, before the Parakeet count changes. Restline's event names (answer, card, bar)
// are retained here on purpose: this is the baseline of tests/unit/differential.test.mjs, not live code.
// Three edits only: exports added, no imports, GATE_START set to Gate 0's instant so both versions judge
// prestart on the same boundary. Do not edit.

export const SUMMARY_VERSION = 6;
export const GATE_START = Date.parse('2026-10-23T05:00:00.000Z');
export const EVENTS = new Set(['pageview', 'tap', 'email', 'answer', 'video', 'seen', 'leave']);
export const BUTTONS = new Set(['card', 'bar']);
export const BOT_UA = /facebookexternalhit|Facebot|meta-external|Bytespider|TikTokSpider|Googlebot|AdsBot|HeadlessChrome|PhantomJS|Lighthouse|Bulid\//i;
export const APP_LABEL_UA = /^Instagram \d/;

export function flagOf(row) {
  if (row.utm_campaign.toLowerCase() === 'smoke') return 'smoke';
  if (!row.utm_source) return 'no_utm';
  return 'gate';
}

/* ---------------- summaries ---------------- */

function newSummary(day, hour) {
  return { v: SUMMARY_VERSION, gs: GATE_START, day, hour, rows: 0, failed: 0, pre: [], buckets: Object.create(null) };
}

// buckets are keyed by flag|source; leave maps vid -> largest seconds seen (one beacon per hide, cumulative).
// A gate bucket also splits its rows by creative under content["c:" + utm_content] ("c:none" when empty),
// each entry having the same shape as the bucket's own counts. pre lists the vids with a gate pageview
// received before GATE_START.

function newCounts() {
  return {
    pv: [], tap: [], email: [], answer: [], seen: [],
    n_pv: 0, n_tap: 0, n_tap_card: 0, n_tap_bar: 0, n_email: 0, n_answer: 0,
    video_playing: 0, video_blocked: 0, leave: {},
    device: { ios: 0, android: 0, other: 0 },
    inapp: { tiktok: 0, instagram: 0, facebook: 0, none: 0 }
  };
}

function newBucket() {
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
  try { return encodeURIComponent(s); } catch { return encodeURIComponent(s.replace(/[\uD800-\uDFFF]/g, '\uFFFD')); }
}

function splitBucketKey(key) {
  const i = key.indexOf('|');
  let source = key.slice(i + 1);
  try { source = decodeURIComponent(source); } catch { /* keep as is */ }
  return [key.slice(0, i), source];
}

function addRow(s, row) {
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
      if (row.button === 'card') b.n_tap_card += 1; else if (row.button === 'bar') b.n_tap_bar += 1;
      break;
    case 'email':
      pushUnique(b.email, row.vid); b.n_email += 1;
      break;
    case 'answer':
      pushUnique(b.answer, row.vid); b.n_answer += 1;
      break;
    case 'video':
      if (row.video === 'playing') b.video_playing += 1; else b.video_blocked += 1;
      break;
    case 'seen':
      pushUnique(b.seen, row.vid);
      break;
    case 'leave': {
      const sec = Number(row.seconds) || 0;
      if (row.vid && !(b.leave[row.vid] >= sec)) b.leave[row.vid] = sec;
      break;
    }
    default:
      break;
  }
}

function isBotPageview(row) {
  const ua = row.ua || '';
  return row.wd === true || row.scr === '0x0' || row.scr === '2000x2000' || APP_LABEL_UA.test(ua) || BOT_UA.test(ua);
}

function mergeCounts(a, b) {
  for (const set of ['pv', 'tap', 'email', 'answer', 'seen']) for (const v of b[set] || []) pushUnique(a[set], v);
  for (const n of ['n_pv', 'n_tap', 'n_tap_card', 'n_tap_bar', 'n_email', 'n_answer', 'video_playing', 'video_blocked']) a[n] += b[n] || 0;
  for (const vid of Object.keys(b.leave || {})) if (!(a.leave[vid] >= b.leave[vid])) a.leave[vid] = b.leave[vid];
  for (const k of Object.keys(a.device)) a.device[k] += (b.device && b.device[k]) || 0;
  for (const k of Object.keys(a.inapp)) a.inapp[k] += (b.inapp && b.inapp[k]) || 0;
}

function mergeBucket(a, b) {
  mergeCounts(a, b);
  for (const v of b.bots || []) pushUnique(a.bots, v);
  for (const ck of Object.keys(b.content || {})) mergeCounts(a.content[ck] || (a.content[ck] = newCounts()), b.content[ck]);
}

function mergeSummary(target, s) {
  if (!s) return;
  target.rows += s.rows || 0;
  target.failed += s.failed || 0;
  for (const v of s.pre || []) pushUnique(target.pre, v);
  for (const key of Object.keys(s.buckets || {})) {
    if (!target.buckets[key]) target.buckets[key] = newBucket();
    mergeBucket(target.buckets[key], s.buckets[key]);
  }
}

function finalizeBucket(b) {
  const uniques = new Set([...b.pv, ...b.tap, ...b.email, ...b.answer]).size;
  return {
    uniques,
    taps: b.tap.length,
    emails: b.email.length,
    answers: b.answer.length,
    tap_rate: uniques ? Number((b.tap.length / uniques).toFixed(4)) : 0,
    pageviews: b.n_pv,
    tap_events: b.n_tap,
    tap_events_card: b.n_tap_card,
    tap_events_bar: b.n_tap_bar,
    email_events: b.n_email,
    answer_events: b.n_answer,
    seen: b.seen.length,
    video: { playing: b.video_playing, blocked: b.video_blocked },
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
function resolveVisitors(original, prestart) {
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
    for (const set of ['pv', 'tap', 'email', 'answer', 'seen']) for (const v of b[set]) consider(v);
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
  for (const set of ['pv', 'tap', 'email', 'answer', 'seen', 'bots']) {
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
    for (const set of ['pv', 'tap', 'email', 'answer', 'seen']) c[set] = c[set].filter((v) => !vids.has(v));
    for (const v of Object.keys(c.leave || {})) if (vids.has(v)) delete c.leave[v];
  }
}

function finalizeDay(s, prestart) {
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

export function pushUnique(arr, v) { if (v && !arr.includes(v)) arr.push(v); }

export { newSummary, newCounts, newBucket, contentKey, bucketKey, encodeSafe, splitBucketKey, addRow, addCounts, isBotPageview, mergeCounts, mergeBucket, mergeSummary, finalizeBucket, finalizeSource, leaveStats, resolveVisitors, homeCreative, moveVids, finalizeDay };
