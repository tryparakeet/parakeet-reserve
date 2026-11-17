// Request builders and fixtures for driving beacon.mjs's createHandler() directly (no server): POST /beacon with the
// key header, GET /admin/app with the admin key, install ids, batches and notes.

import { createHash } from 'node:crypto';
import { createHandler } from '../../netlify/functions/beacon.mjs';
import { createMemoryBlobs } from './memory-blobs.mjs';
import { clock, ORIGIN, ADMIN_KEY, T0 } from './http.mjs';

export { ADMIN_KEY, T0 };
export const BEACON_KEY = 'testbeaconkey0123456789abcdefghi';

// A lowercase UUID made from a label, the same every run: the shape of expo-crypto's randomUUID().
export function installId(label) {
  const h = createHash('sha256').update(label).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function note(name, props, at) {
  return { name, at, props };
}

export function batch(install, events, { build = 'release', version = '1.0.0' } = {}) {
  return { install, build, version, events };
}

// A handler wired to a memory store, an env with both keys, a frozen clock and a logger that keeps its lines.
// `env` adds to or replaces the keys (an undefined value removes one).
export function createBeaconTest({ t0 = T0, env = {}, blobs = createMemoryBlobs() } = {}) {
  const c = clock(t0);
  const logs = [];
  const logger = {
    log: (...args) => logs.push(['log', args.map(String).join(' ')]),
    error: (...args) => logs.push(['error', args.map(String).join(' ')])
  };
  const fullEnv = { BEACON_KEY, ADMIN_KEY, ...env };
  for (const k of Object.keys(fullEnv)) if (fullEnv[k] === undefined) delete fullEnv[k];
  const handler = createHandler({ getStore: blobs.getStore, env: fullEnv, now: c.now, logger });
  return { handler, blobs, clock: c, logs, env: fullEnv };
}

// POST /beacon. `key: null` sends no x-beacon-key header; `raw` sends the body text as given.
export function send(handler, body, { key = BEACON_KEY, headers = {}, raw, method = 'POST', path = '/beacon' } = {}) {
  const h = new Headers({ 'content-type': 'application/json', ...headers });
  if (key !== null && key !== undefined) h.set('x-beacon-key', key);
  const init = { method, headers: h };
  if (method !== 'GET' && method !== 'HEAD') init.body = raw !== undefined ? raw : JSON.stringify(body);
  return handler(new Request(ORIGIN + path, init));
}

// GET /admin/app?key=... ; `key: null` sends no key.
export function readApp(handler, { key = ADMIN_KEY, path = '/admin/app', method = 'GET' } = {}) {
  const url = new URL(ORIGIN + path);
  if (key !== null && key !== undefined) url.searchParams.set('key', key);
  return handler(new Request(url, { method }));
}

// The read as parsed JSON; throws with the body when the status is not 200.
export async function readJson(handler, opts) {
  const res = await readApp(handler, opts);
  const text = await res.text();
  if (res.status !== 200) throw new Error(`read ${res.status}: ${text}`);
  return JSON.parse(text);
}

// Sends one batch and asserts the 204.
export async function sendOk(handler, body) {
  const res = await send(handler, body);
  if (res.status !== 204) throw new Error(`send ${res.status}: ${await res.text()}`);
  return res;
}
