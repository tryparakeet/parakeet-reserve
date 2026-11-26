// A deterministic week of rows (Oct 22-30, seeded) in the shape the function stores, shared by the counts,
// resolution and differential tests: tiktok paid visitors across the seven creatives, typed /go visitors,
// own-device smoke visits, untagged visits, bots, multi-load visitors, leaves with and without the video's
// final state, standalone video rows, pre-start visitors. EDGE_ROWS are hand-written corner cases.
// ANDROID_ROWS (summary version 8) are kept apart from ALL_ROWS; see below.

import { BOT_UAS, REAL_UAS } from './user-agents.mjs';
import { vid, pageview, tap, email, video, seen, leave, TIKTOK, TYPED, SMOKE, NO_UTM } from '../helpers/rows.mjs';

export const CREATIVES = ['sat24', 'sun25', 'mon26', 'tue27', 'wed28', 'thu29', 'fri30'];
export const DAYS = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];

// mulberry32: a tiny seeded generator so the fixture is the same on every run
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REAL = Object.entries(REAL_UAS);
const BOTS = Object.entries(BOT_UAS);

export function makeFixture(seed = 7) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const chance = (p) => rand() < p;
  const rows = [];
  let n = 0;
  const next = (label) => vid(`${seed}-${label}-${n++}`);

  // a moment in `day` at hour h (UTC) plus `offset` seconds
  const at = (day, h, offset = 0) => Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00.000Z`) + offset * 1000;

  // one load of the page by visitor v at time t with the given tags; returns the time of the leave
  function load(v, t, tags, utm_content, ctx, { allowPlanTap = true } = {}) {
    rows.push(pageview(v, t, { tags, utm_content, ...ctx }));
    let s = 1 + Math.floor(rand() * 8);
    let played = false;
    if (chance(0.55)) { rows.push(video(v, 'playing', t + s * 1000, { tags, utm_content, ...ctx })); played = true; s += 1; }
    if (chance(0.5)) {
      rows.push(tap(v, 'reserve', t + s * 1000, { tags, utm_content, ...ctx })); s += 1;
      if (chance(0.9)) { rows.push(seen(v, t + s * 1000, { tags, utm_content, ...ctx })); s += 1; }
      if (allowPlanTap && chance(0.6)) {
        const r = rand();
        if (r < 0.45) rows.push(tap(v, 'plan_yearly', t + s * 1000, { tags, utm_content, via: 'card', ...ctx }));
        else if (r < 0.75) rows.push(tap(v, 'plan_monthly', t + s * 1000, { tags, utm_content, via: 'card', ...ctx }));
        else rows.push(tap(v, 'plan_yearly', t + s * 1000, { tags, utm_content, via: 'hold', ...ctx }));
        s += 2;
        if (chance(0.5)) { rows.push(email(v, t + s * 1000, { tags, utm_content, plan: r < 0.45 || r >= 0.75 ? 'yearly' : 'monthly', ...ctx })); s += 3; }
      }
    }
    if (!played && chance(0.3)) { rows.push(tap(v, 'play', t + s * 1000, { tags, utm_content, ...ctx })); s += 1; }
    const leaveAt = t + (s + 5 + Math.floor(rand() * 60)) * 1000;
    const seconds = Math.round((leaveAt - t) / 1000);
    if (played) rows.push(leave(v, seconds, leaveAt, { tags, utm_content, ...ctx }));
    else rows.push(leave(v, seconds, leaveAt, { tags, utm_content, video: 'blocked', ...ctx }));
    // a second hide of the same load (a longer time on page) now and then
    if (chance(0.2)) rows.push(leave(v, seconds + 30, leaveAt + 30 * 1000, { tags, utm_content, ...ctx }));
    return leaveAt;
  }

  function context() {
    const [name, ua] = pick(REAL);
    const device = name.endsWith('_android') || name === 'chrome_android' ? 'android' : 'ios';
    const inapp = name.startsWith('tiktok') ? 'tiktok' : name.startsWith('instagram') ? 'instagram' : name.startsWith('facebook') ? 'facebook' : 'none';
    return { ua, device, inapp, ref: inapp === 'tiktok' ? 'https://www.tiktok.com' : '' };
  }

  // paid visitors: each creative on its own day, a few spilling into later days
  for (let i = 0; i < CREATIVES.length; i++) {
    const day = DAYS[i];
    const creative = CREATIVES[i];
    const count = 7 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const v = next('tt');
      const ctx = context();
      const t = at(day, 6 + Math.floor(rand() * 17), Math.floor(rand() * 3600));
      const leftAt = load(v, t, TIKTOK, creative, ctx);
      if (chance(0.15)) {
        // a second load later: the same creative, a later day's creative, or an untagged return
        const r = rand();
        const later = leftAt + (1 + Math.floor(rand() * 40)) * 3600 * 1000;
        if (r < 0.4) load(v, later, TIKTOK, creative, ctx);
        else if (r < 0.7 && i + 1 < CREATIVES.length) load(v, later, TIKTOK, CREATIVES[i + 1], ctx);
        else load(v, later, NO_UTM, undefined, ctx);
      }
    }
  }

  // typed visitors (/go -> endcard), spread over the week
  for (let k = 0; k < 12; k++) {
    const v = next('typed');
    const ctx = context();
    load(v, at(pick(DAYS), 8 + Math.floor(rand() * 14), Math.floor(rand() * 3600)), TYPED, 'endcard', ctx);
  }

  // own devices: smoke visits, one of them also opening a paid link afterwards
  for (let k = 0; k < 3; k++) {
    const v = next('smoke');
    const ctx = context();
    const t = at('2026-10-22', 18 + k, 120);
    load(v, t, SMOKE, '', ctx);
    if (k === 0) load(v, at('2026-10-24', 9, 0), TIKTOK, 'sat24', ctx);
  }

  // untagged visitors with no gate pageview: they stay in no_utm
  for (let k = 0; k < 5; k++) {
    const v = next('nou');
    load(v, at(pick(DAYS), 10 + k, 300 * k), NO_UTM, undefined, context());
  }

  // pre-start visitors: a paid pageview before GATE_START, then rows after it
  for (let k = 0; k < 3; k++) {
    const v = next('pre');
    const ctx = context();
    load(v, at('2026-10-22', 20 + k, 60), TIKTOK, 'sat24', ctx);
    load(v, at('2026-10-24', 7 + k, 60), TIKTOK, 'sat24', ctx);
  }

  // bots: every evidence kind once, each with a tap so the whole row set must move
  const evidence = [
    ...BOTS.map(([name, ua]) => ({ name, ua })),
    { name: 'webdriver', ua: REAL_UAS.chrome_android, wd: true },
    { name: 'screen-0x0', ua: REAL_UAS.safari_ios, scr: '0x0' },
    { name: 'screen-2000', ua: REAL_UAS.safari_ios, scr: '2000x2000' }
  ];
  for (const e of evidence) {
    const v = next(`bot-${e.name}`);
    const t = at(pick(DAYS), 12, 7);
    rows.push(pageview(v, t, { tags: TIKTOK, utm_content: 'sat24', ua: e.ua, wd: e.wd, scr: e.scr, device: 'other' }));
    rows.push(tap(v, 'reserve', t + 1000, { tags: TIKTOK, utm_content: 'sat24', device: 'other' }));
    rows.push(tap(v, 'plan_yearly', t + 2000, { tags: TIKTOK, utm_content: 'sat24', device: 'other', via: 'card' }));
  }

  rows.sort((a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : 0));
  return rows;
}

export const FIXTURE_ROWS = makeFixture();

// Hand-written corner cases.
const E = (label) => vid(`edge-${label}`);
export const EDGE_VIDS = {
  boundaryGate: E('boundary-gate'),        // paid pageview received at GATE_START exactly
  boundaryPre: E('boundary-pre'),          // paid pageview received 1 ms before GATE_START
  twoSources: E('two-sources'),            // a paid pageview and a typed pageview
  joinsCreative: E('joins-creative'),      // paid pageviews on two creatives, then an untagged plan tap
  smokeAndGate: E('smoke-and-gate'),       // a smoke pageview and a paid pageview with taps
  bothVideo: E('both-video'),              // a playing row on one load, a blocked leave on another
  leaveOnly: E('leave-only')               // a leave row and nothing else: never a unique
};

export const EDGE_ROWS = [
  pageview(EDGE_VIDS.boundaryGate, '2026-10-24T05:00:00.000Z', { utm_content: 'sat24' }),
  tap(EDGE_VIDS.boundaryGate, 'reserve', '2026-10-24T05:00:03.000Z', { utm_content: 'sat24' }),
  pageview(EDGE_VIDS.boundaryPre, '2026-10-24T04:59:59.999Z', { utm_content: 'sat24' }),
  tap(EDGE_VIDS.boundaryPre, 'reserve', '2026-10-24T05:00:02.000Z', { utm_content: 'sat24' }),
  pageview(EDGE_VIDS.twoSources, '2026-10-24T10:00:00.000Z', { utm_content: 'sat24' }),
  pageview(EDGE_VIDS.twoSources, '2026-10-24T11:00:00.000Z', { tags: TYPED }),
  tap(EDGE_VIDS.twoSources, 'reserve', '2026-10-24T11:00:05.000Z', { tags: TYPED }),
  pageview(EDGE_VIDS.joinsCreative, '2026-10-26T10:00:00.000Z', { utm_content: 'mon26' }),
  pageview(EDGE_VIDS.joinsCreative, '2026-10-26T12:00:00.000Z', { utm_content: 'fri30' }),
  pageview(EDGE_VIDS.joinsCreative, '2026-10-27T12:00:00.000Z', { tags: NO_UTM }),
  tap(EDGE_VIDS.joinsCreative, 'reserve', '2026-10-27T12:00:04.000Z', { tags: NO_UTM }),
  tap(EDGE_VIDS.joinsCreative, 'plan_monthly', '2026-10-27T12:00:09.000Z', { tags: NO_UTM, via: 'card' }),
  pageview(EDGE_VIDS.smokeAndGate, '2026-10-22T19:00:00.000Z', { tags: SMOKE }),
  tap(EDGE_VIDS.smokeAndGate, 'reserve', '2026-10-22T19:00:02.000Z', { tags: SMOKE }),
  pageview(EDGE_VIDS.smokeAndGate, '2026-10-25T09:00:00.000Z', { utm_content: 'sun25' }),
  tap(EDGE_VIDS.smokeAndGate, 'reserve', '2026-10-25T09:00:02.000Z', { utm_content: 'sun25' }),
  tap(EDGE_VIDS.smokeAndGate, 'plan_yearly', '2026-10-25T09:00:06.000Z', { utm_content: 'sun25', via: 'hold' }),
  leave(EDGE_VIDS.smokeAndGate, 44, '2026-10-25T09:00:44.000Z', { utm_content: 'sun25' }),
  pageview(EDGE_VIDS.bothVideo, '2026-10-28T08:00:00.000Z', { utm_content: 'wed28' }),
  leave(EDGE_VIDS.bothVideo, 9, '2026-10-28T08:00:09.000Z', { utm_content: 'wed28', video: 'blocked' }),
  pageview(EDGE_VIDS.bothVideo, '2026-10-28T20:00:00.000Z', { utm_content: 'wed28' }),
  video(EDGE_VIDS.bothVideo, 'playing', '2026-10-28T20:00:02.000Z', { utm_content: 'wed28' }),
  leave(EDGE_VIDS.bothVideo, 31, '2026-10-28T20:00:31.000Z', { utm_content: 'wed28' }),
  leave(EDGE_VIDS.leaveOnly, 3, '2026-10-29T15:00:03.000Z', { utm_content: 'thu29', video: 'blocked' })
];

export const ALL_ROWS = [...FIXTURE_ROWS, ...EDGE_ROWS].sort((a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : 0));

// Android rows, new in summary version 8: until then the function refused the tap android and the plan
// android, so no earlier version stored one. They are kept out of ALL_ROWS, the differential's v6-era
// fixture, and added to it by the differential's Android case.
const AN = (label) => vid(`android-${label}`);
export const ANDROID_VIDS = {
  tiktok: AN('tiktok'),     // TikTok's browser: the button twice, the address, a leave
  chrome: AN('chrome'),     // Chrome from the typed link: the button, the address sent twice
  returns: AN('returns'),   // a paid pageview, then an untagged return with the button and the address
  noEmail: AN('no-email'),  // the button and no address
  smoke: AN('smoke')        // an own Android phone on the smoke link: the button and the address
};
const IN_TIKTOK = { device: 'android', inapp: 'tiktok', ref: 'https://www.tiktok.com' };
const IN_CHROME = { device: 'android', inapp: 'none' };
const ANDROID_TIKTOK_UA = REAL_UAS.tiktok_android;
const ANDROID_CHROME_UA = REAL_UAS.chrome_android;

export const ANDROID_ROWS = [
  pageview(ANDROID_VIDS.tiktok, '2026-10-27T09:00:00.000Z', { utm_content: 'tue27', ...IN_TIKTOK, ua: ANDROID_TIKTOK_UA, scr: '412x915' }),
  tap(ANDROID_VIDS.tiktok, 'android', '2026-10-27T09:00:04.000Z', { utm_content: 'tue27', ...IN_TIKTOK }),
  tap(ANDROID_VIDS.tiktok, 'android', '2026-10-27T09:00:09.000Z', { utm_content: 'tue27', ...IN_TIKTOK }),
  email(ANDROID_VIDS.tiktok, '2026-10-27T09:00:20.000Z', { utm_content: 'tue27', ...IN_TIKTOK, plan: 'android' }),
  leave(ANDROID_VIDS.tiktok, 31, '2026-10-27T09:00:31.000Z', { utm_content: 'tue27', ...IN_TIKTOK }),
  pageview(ANDROID_VIDS.chrome, '2026-10-28T14:00:00.000Z', { tags: TYPED, ...IN_CHROME, ua: ANDROID_CHROME_UA, scr: '360x800' }),
  tap(ANDROID_VIDS.chrome, 'android', '2026-10-28T14:00:03.000Z', { tags: TYPED, ...IN_CHROME }),
  email(ANDROID_VIDS.chrome, '2026-10-28T14:00:15.000Z', { tags: TYPED, ...IN_CHROME, plan: 'android' }),
  email(ANDROID_VIDS.chrome, '2026-10-28T14:00:40.000Z', { tags: TYPED, ...IN_CHROME, plan: 'android' }),
  pageview(ANDROID_VIDS.returns, '2026-10-28T08:00:00.000Z', { utm_content: 'wed28', ...IN_TIKTOK, ua: ANDROID_TIKTOK_UA, scr: '412x915' }),
  pageview(ANDROID_VIDS.returns, '2026-10-29T08:00:00.000Z', { tags: NO_UTM, ...IN_CHROME, ua: ANDROID_CHROME_UA, scr: '412x915' }),
  tap(ANDROID_VIDS.returns, 'android', '2026-10-29T08:00:05.000Z', { tags: NO_UTM, ...IN_CHROME }),
  email(ANDROID_VIDS.returns, '2026-10-29T08:00:20.000Z', { tags: NO_UTM, ...IN_CHROME, plan: 'android' }),
  pageview(ANDROID_VIDS.noEmail, '2026-10-29T12:00:00.000Z', { utm_content: 'thu29', ...IN_TIKTOK, ua: ANDROID_TIKTOK_UA, scr: '360x800' }),
  tap(ANDROID_VIDS.noEmail, 'android', '2026-10-29T12:00:02.000Z', { utm_content: 'thu29', ...IN_TIKTOK }),
  leave(ANDROID_VIDS.noEmail, 12, '2026-10-29T12:00:12.000Z', { utm_content: 'thu29', ...IN_TIKTOK }),
  pageview(ANDROID_VIDS.smoke, '2026-10-30T18:00:00.000Z', { tags: SMOKE, ...IN_CHROME, ua: ANDROID_CHROME_UA, scr: '412x915' }),
  tap(ANDROID_VIDS.smoke, 'android', '2026-10-30T18:00:03.000Z', { tags: SMOKE, ...IN_CHROME }),
  email(ANDROID_VIDS.smoke, '2026-10-30T18:00:10.000Z', { tags: SMOKE, ...IN_CHROME, plan: 'android' })
];
