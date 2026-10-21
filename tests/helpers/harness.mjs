// A local stand-in for the Netlify site: http://localhost:PORT serving public/ as static files and the
// one function behind the toml's rewrites, so the page, the client script and the function can be driven
// together by a browser (the Playwright e2e) or by curl (scripts/serve.mjs).
//
// startHarness({ port = 0, adminKey = ADMIN_KEY, now = T0, blobs = createMemoryBlobs(), publicDir })
//   -> { url, origin, port, server, blobs, clock, env, handler, admin(), adminResponse(), close() }
//
// What it reproduces, in the order Netlify applies it:
//   1. the path is decoded; anything containing ".." after decoding is rejected (404)
//   2. forced rules first, for any status and whether or not a static file exists:
//        /api/*  and  /admin   -> createHandler({ getStore, env, now }) through a buffered Request/Response
//                                 conversion (every Set-Cookie goes out separately via getSetCookie())
//        /go                   -> 302 with the exact Location of the toml rule (the request's own query is
//                                 dropped, as Netlify does when `to` carries one)
//   3. a static file under public/ (a directory serves its index.html), with a MIME map, Range support
//      and the toml's [[headers]] rules applied to static responses only (Netlify never applies them to
//      function responses or redirects)
//   4. the non-forced rewrites /privacy -> privacy.html and /terms -> terms.html (static headers apply)
//   5. 404
//
// `now` may be an ISO string / epoch ms (a frozen clock starts there), a function, or a clock object from
// tests/helpers/http.mjs ({ now, advance, set }); the returned `clock` is always the object form so a test
// can advance the function's time. `adminKey: null` starts the harness without ADMIN_KEY (the 503 case).
// Chromium stores the function's `Secure` cookie from http://localhost, so no TLS is needed here.

import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve, sep, extname } from 'node:path';
import { createHandler } from '../../netlify/functions/event.mjs';
import { createMemoryBlobs } from './memory-blobs.mjs';
import { clock as makeClock, ADMIN_KEY, T0 } from './http.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PUBLIC_DIR = join(ROOT, 'public');
export const TOML_PATH = join(ROOT, 'netlify.toml');

// The /go rule as written in netlify.toml (the toml test asserts the file; this is what the harness sends).
export const GO_LOCATION = '/?utm_source=typed&utm_medium=organic&utm_campaign=gate0&utm_content=endcard';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8'
};

// [[headers]] blocks of netlify.toml: [{ for: '/*', values: { Header: 'value' } }], in file order.
export function parseHeaderRules(toml) {
  const rules = [];
  let current = null;
  let inValues = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line === '[[headers]]') { current = { for: '', values: {} }; rules.push(current); inValues = false; continue; }
    if (/^\[\[/.test(line)) { current = null; inValues = false; continue; }
    if (line === '[headers.values]') { inValues = !!current; continue; }
    if (/^\[/.test(line)) { inValues = false; continue; }
    if (!current) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (!inValues && m[1] === 'for') current.for = value;
    else if (inValues) current.values[m[1]] = value;
  }
  return rules;
}

// Netlify's path patterns: `*` is a splat (anything, slashes included); otherwise an exact path.
function ruleMatches(pattern, pathname) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(pathname);
}

export function staticHeadersFor(rules, pathname) {
  const out = {};
  for (const rule of rules) if (ruleMatches(rule.for, pathname)) Object.assign(out, rule.values);
  return out;
}

function toClock(now) {
  if (now && typeof now === 'object' && typeof now.now === 'function') return now;
  if (typeof now === 'function') return { now, advance() { throw new Error('harness: this clock cannot be advanced'); }, set() { throw new Error('harness: this clock cannot be set'); } };
  return makeClock(now === undefined ? T0 : now);
}

export async function startHarness({ port = 0, adminKey = ADMIN_KEY, now = T0, blobs = createMemoryBlobs(), publicDir = PUBLIC_DIR, quiet = true } = {}) {
  const clock = toClock(now);
  const env = { ...process.env };
  // the three Netlify origin variables never leak in from the shell: the function's allowed origins are
  // SITE_ORIGINS plus localhost here
  for (const k of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL']) delete env[k];
  if (adminKey === null || adminKey === undefined) delete env.ADMIN_KEY; else env.ADMIN_KEY = adminKey;
  const handler = createHandler({ getStore: blobs.getStore, env, now: clock.now });
  const headerRules = parseHeaderRules(await fs.readFile(TOML_PATH, 'utf8'));
  const publicRoot = resolve(publicDir);

  const server = createServer((req, res) => {
    serve(req, res).catch((err) => {
      if (!quiet) console.error('harness', err);
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('content-type', 'text/plain; charset=utf-8'); }
      res.end('harness error');
    });
  });

  async function serve(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return text(res, 400, 'Bad request'); }
    if (pathname.split('/').includes('..') || pathname.includes('\\')) return text(res, 404, 'Not found');
    if (!pathname.startsWith('/')) pathname = '/' + pathname;

    // 2. forced rules
    if (pathname.startsWith('/api/') || /^\/admin\/?$/.test(pathname)) return viaFunction(req, res);
    if (/^\/go\/?$/.test(pathname)) {
      res.statusCode = 302;
      res.setHeader('location', GO_LOCATION);
      res.setHeader('content-length', '0');
      return res.end();
    }

    // 3. static
    if (await sendStatic(req, res, pathname, pathname)) return;

    // 4. non-forced rewrites
    if (/^\/privacy\/?$/.test(pathname) && (await sendStatic(req, res, '/privacy.html', pathname))) return;
    if (/^\/terms\/?$/.test(pathname) && (await sendStatic(req, res, '/terms.html', pathname))) return;

    // 5.
    return text(res, 404, 'Not found', staticHeadersFor(headerRules, pathname));
  }

  function text(res, status, body, headers = {}) {
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('content-length', String(Buffer.byteLength(body)));
    res.end(body);
  }

  // Serves public/<filePath> if it is a file (a directory serves its index.html). Returns false when there
  // is nothing there. Headers come from the toml rules that match the request path, not the file path.
  async function sendStatic(req, res, filePath, requestPath) {
    let abs = normalize(join(publicRoot, filePath));
    if (abs !== publicRoot && !abs.startsWith(publicRoot + sep)) return false;
    let st;
    try { st = await fs.stat(abs); } catch { return false; }
    if (st.isDirectory()) {
      abs = join(abs, 'index.html');
      try { st = await fs.stat(abs); } catch { return false; }
      if (!st.isFile()) return false;
    } else if (!st.isFile()) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET, HEAD');
      return res.end(), true;
    }

    const headers = { 'cache-control': 'public, max-age=0, must-revalidate', ...lowerKeys(staticHeadersFor(headerRules, requestPath)) };
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader('content-type', MIME[extname(abs).toLowerCase()] || 'application/octet-stream');
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('last-modified', st.mtime.toUTCString());

    const size = st.size;
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.statusCode = 416;
      res.setHeader('content-range', `bytes */${size}`);
      res.setHeader('content-length', '0');
      return res.end(), true;
    }
    let start = 0;
    let end = size - 1;
    if (range) {
      ({ start, end } = range);
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
    } else {
      res.statusCode = 200;
    }
    const length = size === 0 ? 0 : end - start + 1;
    res.setHeader('content-length', String(length));
    if (req.method === 'HEAD' || length === 0) return res.end(), true;
    await new Promise((resolveStream, reject) => {
      const stream = createReadStream(abs, { start, end });
      stream.on('error', reject);
      res.on('close', resolveStream);
      stream.pipe(res).on('finish', resolveStream);
    });
    return true;
  }

  // Buffers the Node request into a fetch Request, runs the function, and writes its Response back.
  async function viaFunction(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const x of v) headers.append(k, x);
      else headers.set(k, v);
    }
    const init = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
    const request = new Request(`${origin()}${req.url}`, init);
    const response = await handler(request);
    res.statusCode = response.status;
    for (const [k, v] of response.headers) if (k.toLowerCase() !== 'set-cookie') res.setHeader(k, v);
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    const out = Buffer.from(await response.arrayBuffer());
    if (response.status !== 204 && response.status !== 304) res.setHeader('content-length', String(out.length));
    if (req.method === 'HEAD' || response.status === 204 || response.status === 304) return res.end();
    res.end(out);
  }

  let port_ = 0;
  const origin = () => `http://localhost:${port_}`;
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { port_ = server.address().port; resolveListen(); });
  });
  server.keepAliveTimeout = 1000;

  async function adminResponse(params = {}, { key = adminKey, path = '/admin', headers = {} } = {}) {
    const u = new URL(origin() + path);
    if (key !== null && key !== undefined) u.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return fetch(u, { headers });
  }

  // GET /admin?key=...&... as parsed JSON; throws with the body when the status is not 200.
  async function admin(params = {}, opts = {}) {
    const res = await adminResponse(params, opts);
    const textBody = await res.text();
    if (res.status !== 200) throw new Error(`admin ${res.status}: ${textBody}`);
    return JSON.parse(textBody);
  }

  function close() {
    return new Promise((resolveClose) => {
      server.closeAllConnections?.();
      server.close(() => resolveClose());
    });
  }

  return { url: origin(), origin: origin(), port: port_, server, blobs, clock, env, handler, admin, adminResponse, close };
}

function lowerKeys(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k.toLowerCase()] = v;
  return out;
}

// "bytes=a-b" | "bytes=a-" | "bytes=-n" -> { start, end } | null (no/ignored header) | 'unsatisfiable'
export function parseRange(header, size) {
  if (!header || typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (size === 0) return 'unsatisfiable';
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}
