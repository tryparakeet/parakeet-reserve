// Row builders in the exact shape the function stores (see event() in netlify/functions/event.mjs) and
// run(mod, rows): the admin's summary pipeline over a list of rows with the pure functions of `mod`
// (group by day and hour -> addRow -> mergeSummary -> finalizeDay -> JSON round-trip), for either the
// live module or the frozen tests/previous/summary-v6.mjs baseline.

import { DEFAULT_MOBILE_UA } from '../fixtures/user-agents.mjs';

export const TIKTOK = { utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'gate0' };
export const TYPED = { utm_source: 'typed', utm_medium: 'organic', utm_campaign: 'gate0', utm_content: 'endcard' };
export const SMOKE = { utm_source: 'own', utm_medium: '', utm_campaign: 'smoke', utm_content: '' };
export const NO_UTM = { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '' };

// A deterministic 24-character [a-z0-9] visitor id from any seed.
export function vid(seed) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let h = 2166136261 >>> 0;
  const s = String(seed);
  let out = '';
  for (let i = 0; out.length < 24; i++) {
    h ^= s.charCodeAt(i % s.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out += alphabet[h % alphabet.length];
  }
  return out;
}

function flagOf(row) {
  if (row.utm_campaign.toLowerCase() === 'smoke') return 'smoke';
  if (!row.utm_source) return 'no_utm';
  return 'gate';
}

export function iso(when) {
  return new Date(typeof when === 'number' ? when : Date.parse(when)).toISOString();
}

// The common part of every row. `tags` is one of TIKTOK/TYPED/SMOKE/NO_UTM (or any utm_* fields).
export function baseRow(event, { vid: v, received, ts, tags = TIKTOK, utm_content, device = 'ios', inapp = 'none', ref = '', flag } = {}) {
  if (!v) throw new Error('row needs a vid');
  if (!received) throw new Error('row needs received');
  const r = iso(received);
  const row = {
    event,
    vid: v,
    ts: ts ? iso(ts) : r,
    received: r,
    utm_source: tags.utm_source || '',
    utm_medium: tags.utm_medium || '',
    utm_campaign: tags.utm_campaign || '',
    utm_content: utm_content !== undefined ? utm_content : (tags.utm_content || ''),
    device,
    inapp,
    ref
  };
  row.flag = flag || flagOf(row);
  return row;
}

export function pageview(v, received, o = {}) {
  const row = baseRow('pageview', { vid: v, received, ...o });
  row.ua = o.ua !== undefined ? o.ua : DEFAULT_MOBILE_UA;
  row.wd = o.wd === true;
  row.scr = o.scr !== undefined ? o.scr : '390x844';
  return row;
}

export function tap(v, button, received, o = {}) {
  const row = baseRow('tap', { vid: v, received, ...o });
  row.button = button;
  if (String(button).startsWith('plan_')) row.via = o.via !== undefined ? o.via : 'card';
  return row;
}

export function email(v, received, o = {}) {
  const row = baseRow('email', { vid: v, received, ...o });
  row.email = o.email || `${v.slice(0, 8)}@example.com`;
  row.plan = o.plan !== undefined ? o.plan : 'yearly';
  return row;
}

export function video(v, state, received, o = {}) {
  const row = baseRow('video', { vid: v, received, ...o });
  row.video = state;
  return row;
}

export function seen(v, received, o = {}) {
  return baseRow('seen', { vid: v, received, ...o });
}

// leave(v, seconds, received, { video: 'blocked' }) carries the final video state when given.
export function leave(v, seconds, received, o = {}) {
  const row = baseRow('leave', { vid: v, received, ...o });
  row.seconds = seconds;
  if (o.video !== undefined) row.video = o.video;
  return row;
}

// What finalizeBucket returns for an empty bucket: the Oct 30 contract's field names, in order.
export const ZERO_BUCKET = {
  uniques: 0,
  reserve_taps: 0,
  reserve_rate: 0,
  plan_taps: 0,
  plan_yearly_taps: 0,
  plan_monthly_taps: 0,
  plan_rate: 0,
  play_taps: 0,
  taps: 0,
  emails: 0,
  pageviews: 0,
  seen: 0,
  video: { playing: 0, blocked: 0, both: 0 },
  video_events: { playing: 0, blocked: 0 },
  tap_events: 0,
  tap_events_reserve: 0,
  tap_events_play: 0,
  tap_events_plan_yearly: 0,
  tap_events_plan_monthly: 0,
  email_events: 0,
  leave: { n: 0, avg_seconds: 0 },
  device: { ios: 0, android: 0, other: 0 },
  inapp: { tiktok: 0, instagram: 0, facebook: 0, none: 0 }
};

// The admin's summary over `rows` with the pure functions of `mod`. Hour summaries are JSON round-tripped
// before merging (as the per-hour cache does); prestart ids come from every day, as the admin collects
// them, so `from`/`to` limit the days reported but not the pre-start exclusion.
export function run(mod, rows, { from = '', to = '' } = {}) {
  const byDay = new Map();
  for (const row of rows) {
    const day = row.received.slice(0, 10);
    const hour = row.received.slice(11, 13);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const hours = byDay.get(day);
    if (!hours.has(hour)) hours.set(hour, mod.newSummary(day, hour));
    mod.addRow(hours.get(hour), row);
  }
  const prestart = new Set();
  const perDay = [];
  for (const day of [...byDay.keys()].sort()) {
    const merged = mod.newSummary(day, '');
    const hours = byDay.get(day);
    for (const hour of [...hours.keys()].sort()) mod.mergeSummary(merged, JSON.parse(JSON.stringify(hours.get(hour))));
    for (const v of merged.pre) prestart.add(v);
    if ((!from || day >= from) && (!to || day <= to)) perDay.push(merged);
  }
  const total = mod.newSummary('', '');
  for (const d of perDay) mod.mergeSummary(total, d);
  return JSON.parse(JSON.stringify({
    days: perDay.map((d) => mod.finalizeDay(d, prestart)),
    total: mod.finalizeDay(total, prestart),
    prestart: [...prestart].sort()
  }));
}
