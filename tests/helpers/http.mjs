// Request builders and a frozen clock for driving createHandler() directly (no server).

import { createHandler } from '../../netlify/functions/event.mjs';
import { createMemoryBlobs } from './memory-blobs.mjs';

export const ORIGIN = 'https://tryparakeet.netlify.app';
export const ADMIN_KEY = 'test-admin-key-0123456789abcdef';
export const T0 = '2026-10-25T12:00:00.000Z';

// A clock that only moves when told to. now() is what the function receives; advance(ms) and set(when)
// move it; iso is the current instant as the function would write it into `received`.
export function clock(t0 = T0) {
  let t = typeof t0 === 'number' ? t0 : Date.parse(t0);
  if (!Number.isFinite(t)) throw new Error(`clock: bad start ${t0}`);
  return {
    now: () => t,
    advance(ms) { t += ms; return t; },
    set(when) { t = typeof when === 'number' ? when : Date.parse(when); return t; },
    get iso() { return new Date(t).toISOString(); }
  };
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// POST /api/event. `origin: null` sends no Origin header; `raw` sends the body text as given.
export function post(handler, body, { origin = ORIGIN, method = 'POST', path = '/api/event', headers = {}, raw } = {}) {
  const h = new Headers({ 'content-type': 'application/json', ...headers });
  if (origin !== null && origin !== undefined) h.set('origin', origin);
  const text = raw !== undefined ? raw : JSON.stringify(body);
  const init = { method, headers: h };
  if (method !== 'GET' && method !== 'HEAD') init.body = text;
  return handler(new Request(ORIGIN + path, init));
}

// GET /admin?key=...&... ; `key: null` sends no key.
export function adminGet(handler, params = {}, { method = 'GET', path = '/admin', key = ADMIN_KEY } = {}) {
  const url = new URL(ORIGIN + path);
  if (key !== null && key !== undefined) url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return handler(new Request(url, { method }));
}

// A handler wired to a memory store, an env object and a frozen clock.
export function createTestHandler({ t0 = T0, env = { ADMIN_KEY }, blobs = createMemoryBlobs(), now } = {}) {
  const c = clock(t0);
  const handler = createHandler({ getStore: blobs.getStore, env, now: now || c.now });
  return { handler, blobs, clock: c, env };
}
