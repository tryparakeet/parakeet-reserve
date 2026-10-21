// public/: what ships. No vh units (svh only), no external URL, nothing inline, no Netlify Forms; the
// page's ids, the four data-tap values equal to BUTTONS, the one script and the one stylesheet, the
// viewport flags, the video element, the exact copy; the legal pages' promises; robots.txt; app.js's
// endpoint, cookie name and transport.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, relative } from 'node:path';
import { BUTTONS } from '../../netlify/functions/event.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'public');
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.txt', '.svg', '.json', '.webmanifest', '.xml']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(PUBLIC);
const textFiles = files.filter((f) => TEXT_EXT.has(extname(f).toLowerCase()));
const read = (name) => readFileSync(join(PUBLIC, name), 'utf8');
const rel = (f) => relative(ROOT, f);

const index = read('index.html');
const privacy = read('privacy.html');
const terms = read('terms.html');
const css = read('styles.css');
const app = read('app.js');

// Text as a visitor reads it: tags removed, entities decoded, whitespace collapsed.
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function count(re, s) {
  return (s.match(re) || []).length;
}

test('the public dir has the expected text files', () => {
  for (const name of ['index.html', 'styles.css', 'app.js', 'privacy.html', 'terms.html', 'robots.txt', 'favicon.svg']) {
    assert.ok(files.some((f) => f === join(PUBLIC, name)), `public/${name} exists`);
  }
});

test('no vh, dvh or lvh unit anywhere in public/ (svh only)', () => {
  for (const f of textFiles) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\d(vh|dvh|lvh)\b/, `${rel(f)} uses a vh unit`);
  }
});

test('no external URL in public/: no http(s)://, no protocol-relative URL, no @import, url(https) or data: in CSS', () => {
  for (const f of textFiles) {
    let src = readFileSync(f, 'utf8');
    if (extname(f) === '.svg' || extname(f) === '.html') src = src.replace(/\sxmlns(:[a-z]+)?="[^"]*"/g, '');
    assert.doesNotMatch(src, /https?:\/\//, `${rel(f)} has an http(s) URL`);
    assert.doesNotMatch(src, /(src|href|action|poster|content)=["']\/\//i, `${rel(f)} has a protocol-relative URL`);
    assert.doesNotMatch(src, /url\(\s*["']?\/\//i, `${rel(f)} has a protocol-relative url()`);
    assert.doesNotMatch(src, /["']\/\/[a-z0-9]/i, `${rel(f)} has a protocol-relative string`);
  }
  assert.doesNotMatch(css, /@import/, 'styles.css has no @import');
  assert.doesNotMatch(css, /url\(\s*["']?https?:/i, 'styles.css has no url(https…)');
  assert.doesNotMatch(css, /data:/, 'styles.css has no data: URL');
  assert.doesNotMatch(css, /@font-face/, 'styles.css has no font file');
});

test('no http(s) URL inside the binary files of public/ either: the media and the icons carry no encoder metadata', () => {
  // scripts/make-placeholder-media.sh strips the muxer tag and x264's SEI (its version string holds a URL);
  // a clip encoded elsewhere would fail here, which is the point
  const binaries = files.filter((f) => !TEXT_EXT.has(extname(f).toLowerCase()));
  assert.ok(binaries.length >= 3, 'the clip, the poster and the icons are there');
  for (const f of binaries) {
    const bytes = readFileSync(f).toString('latin1');
    assert.doesNotMatch(bytes, /https?:\/\//, `${rel(f)} carries an http(s) URL`);
  }
});

test('nothing inline and no Netlify Forms in any html', () => {
  for (const f of textFiles.filter((x) => extname(x) === '.html')) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\sstyle\s*=/i, `${rel(f)} has an inline style attribute`);
    assert.doesNotMatch(src, /<script(?![^>]*\ssrc=)[^>]*>/i, `${rel(f)} has an inline script`);
    assert.doesNotMatch(src, /\son[a-z]+\s*=/i, `${rel(f)} has an inline event handler`);
    assert.doesNotMatch(src, /<style\b/i, `${rel(f)} has a style element`);
    for (const form of src.match(/<form\b[^>]*>/gi) || []) {
      assert.doesNotMatch(form, /netlify|data-netlify|netlify-honeypot/i, `${rel(f)}: a form with Netlify attributes`);
    }
  }
});

test('index.html head: title, description, theme-color, viewport flags, one deferred /app.js, one /styles.css', () => {
  assert.match(index, /<title>Parakeet<\/title>/);
  assert.match(index, /<meta name="description" content="5 dinners that fit your budget\.">/);
  assert.match(index, /<meta name="theme-color" content="#FBF6EC">/i);
  assert.match(index, /<meta name="color-scheme" content="light">/);
  const viewport = /<meta name="viewport" content="([^"]+)">/.exec(index);
  assert.ok(viewport, 'viewport meta');
  for (const flag of ['width=device-width', 'initial-scale=1', 'viewport-fit=cover', 'interactive-widget=resizes-content']) {
    assert.ok(viewport[1].split(/\s*,\s*/).includes(flag), `viewport has ${flag}`);
  }
  const scripts = index.match(/<script\b[^>]*>/gi) || [];
  assert.equal(scripts.length, 1, 'one script element');
  assert.match(scripts[0], /\ssrc="\/app\.js"/);
  assert.match(scripts[0], /\sdefer\b/);
  assert.doesNotMatch(scripts[0], /\sasync\b|\stype="module"/);
  const sheets = index.match(/<link\b[^>]*rel="stylesheet"[^>]*>/gi) || [];
  assert.equal(sheets.length, 1, 'one stylesheet');
  assert.match(sheets[0], /\shref="\/styles\.css"/);
  assert.doesNotMatch(index, /rel="preload"/, 'no preload');
});

test('index.html ids: each required id exactly once', () => {
  for (const id of ['clip', 'clip-box', 'price', 'sheet', 'sheet-panel', 'step-1', 'step-2', 'step-3', 'sheet-title-1', 'hold', 'email-form', 'email']) {
    assert.equal(count(new RegExp(`\\sid="${id}"`, 'g'), index), 1, `id="${id}" exactly once`);
  }
});

test('index.html data-tap: exactly the four BUTTONS of event.mjs, each once', () => {
  const taps = [...index.matchAll(/\sdata-tap="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(taps.length, 4, 'four data-tap attributes');
  assert.deepEqual([...taps].sort(), [...BUTTONS].sort());
  assert.deepEqual([...BUTTONS].sort(), ['plan_monthly', 'plan_yearly', 'play', 'reserve']);
  assert.match(index, /<button[^>]*\sdata-tap="reserve"[^>]*>/);
  assert.match(index, /<button[^>]*\sdata-tap="play"[^>]*>/);
  assert.match(index, /<button[^>]*\srole="radio"[^>]*\sdata-tap="plan_yearly"[^>]*\sdata-plan="yearly"[^>]*\saria-checked="true"/);
  assert.match(index, /<button[^>]*\srole="radio"[^>]*\sdata-tap="plan_monthly"[^>]*\sdata-plan="monthly"[^>]*\saria-checked="false"/);
  assert.match(index, /<button[^>]*\sid="hold"[^>]*>/);
  assert.doesNotMatch(index, /data-tap="[^"]*"[^>]*data-tap=/, 'no element carries two data-tap attributes');
});

test('index.html video: muted, autoplay, playsinline, a versioned /media mp4 src and a /media poster; the price is the seen target', () => {
  const video = /<video\b[^>]*>/i.exec(index);
  assert.ok(video, 'a <video>');
  const tag = video[0];
  for (const attr of ['muted', 'autoplay', 'playsinline', 'loop']) assert.match(tag, new RegExp(`\\s${attr}(\\s|>)`), `video has ${attr}`);
  assert.match(tag, /\ssrc="\/media\/[A-Za-z0-9_-]+-v\d+\.mp4"/, 'src is a versioned /media mp4');
  assert.match(tag, /\sposter="\/media\/[^"]+"/, 'poster under /media/');
  assert.match(tag, /\sid="clip"/);
  assert.doesNotMatch(index, /<source\b/i, 'src attribute, not <source> (error fires on the element)');
  assert.match(index, /<span[^>]*\sid="price"[^>]*>7 days free, then \$29\.99 a year<\/span>/);
  assert.match(index, /<button[^>]*\sdata-tap="play"[^>]*\saria-label="[^"]+"/, 'the play button has a label');
});

test('index.html copy, verbatim', () => {
  const text = textOf(index);
  const strings = [
    'Parakeet',
    '5 dinners that fit your budget.',
    "Pick your store and your budget. Get the week's dinners and one grocery list, with the total added up before you shop.",
    'Totals are estimates from regular shelf prices at Walmart, Kroger, Target and Aldi.',
    'Every recipe was cooked by a real person first — a creator on camera or a tested public kitchen. No AI-made recipes.',
    'Nothing is charged today. Your free week waits for launch.',
    'Reserve my free week',
    'Parakeet launches in January. Which plan would you start with?',
    'Yearly',
    'FREE WEEK',
    '7 days free, then $29.99 a year',
    'Monthly',
    '$9.99 a month, starts at launch, no free week',
    'Nothing is charged today. At launch, billing is through Apple and you can cancel anytime in Settings.',
    'Hold my spot',
    'Where should we send your invite?',
    'Send my invite',
    'One email when we launch. Never shared.',
    "You're on the list.",
    "We'll email you once, when Parakeet is live.",
    'Done',
    "Parakeet is an app in development. Prices are what you'd pay at launch. Contact: app.parakeet@gmail.com",
    'Privacy',
    'Terms'
  ];
  for (const s of strings) assert.ok(text.includes(s), `index.html says: ${s}`);
  assert.match(index, /<h1>5 dinners that fit your budget\.<\/h1>/);
  assert.match(index, /<p class="wordmark">Parakeet<\/p>/);
  assert.match(index, /<button[^>]*data-tap="reserve"[^>]*>Reserve my free week<\/button>/);
  assert.match(index, /<button[^>]*id="hold"[^>]*>Hold my spot<\/button>/);
  assert.match(index, /<button[^>]*type="submit"[^>]*>Send my invite<\/button>/);
  assert.match(index, /<h2[^>]*>You're on the list\.<\/h2>/);
  assert.match(index, /<a href="mailto:app\.parakeet@gmail\.com">app\.parakeet@gmail\.com<\/a>/);
  assert.match(index, /<a href="\/privacy">Privacy<\/a>/);
  assert.match(index, /<a href="\/terms">Terms<\/a>/);
  assert.equal(count(/\bRestline\b/g, index) + count(/\brestline\b/g, index), 0);
});

test('privacy.html: the cookie, the retention, the one email, never shared or sold, deletion, the address, the row contents', () => {
  const text = textOf(privacy);
  assert.ok(text.includes('pk_v'), 'names the cookie pk_v');
  for (const s of ['90 days', 'launch plus 90 days', 'one email', 'never shared', 'sold', 'deleted', 'app.parakeet@gmail.com']) {
    assert.ok(text.toLowerCase().includes(s.toLowerCase()), `privacy says: ${s}`);
  }
  for (const s of ['tapped', 'seconds on the page', 'device type', 'TikTok', 'Instagram', 'Facebook', 'video', 'email']) {
    assert.ok(text.includes(s), `privacy lists the row contents: ${s}`);
  }
  assert.match(text, /in development/);
  assert.match(text, /Nothing is charged/);
  assert.match(privacy, /<a href="mailto:app\.parakeet@gmail\.com">/);
  assert.match(privacy, /<link rel="stylesheet" href="\/styles\.css">/);
});

test('terms.html: in development, launch prices, nothing charged, the address', () => {
  const text = textOf(terms);
  for (const s of ['in development', 'launch', 'Nothing is charged', '$29.99', '$9.99', 'app.parakeet@gmail.com', 'Apple']) {
    assert.ok(text.includes(s), `terms says: ${s}`);
  }
  assert.match(terms, /<link rel="stylesheet" href="\/styles\.css">/);
});

test('robots.txt keeps crawlers off /admin and /api/', () => {
  const lines = read('robots.txt').trim().split(/\r?\n/).map((l) => l.trim());
  assert.deepEqual(lines, ['User-agent: *', 'Disallow: /admin', 'Disallow: /api/']);
});

test('app.js: the endpoint, the cookie name, the transport, no http literal', () => {
  assert.match(app, /ENDPOINT = '\/api\/event'/);
  assert.match(app, /COOKIE = 'pk_v'/);
  for (const s of ['sendBeacon', 'keepalive', 'visibilitychange', 'pagehide', 'pageshow', 'IntersectionObserver', 'visualViewport']) {
    assert.ok(app.includes(s), `app.js uses ${s}`);
  }
  assert.doesNotMatch(app, /http/, 'no http literal in app.js');
  assert.doesNotMatch(app, /'answer'/, 'the answer event is gone');
  assert.match(app, /'video'/);
  assert.match(app, /'blocked'/);
  assert.match(app, /'playing'/);
  assert.match(app, /via(: | = )'card'/, 'a card press is recorded as via card');
  assert.match(app, /via(: | = )'hold'/, 'Hold my spot records the preselected plan as via hold');
  assert.match(app, /\.style\.setProperty\('--vvh'/, 'the sheet height follows the visual viewport');
});

test('styles.css: the colours, the accent only on the button and the badge, svh, the system font stack', () => {
  assert.match(css, /--bg:\s*#FBF6EC/i);
  assert.match(css, /--accent:\s*#4FA8E8/i);
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(count(/#4FA8E8/gi, cssNoComments), 1, 'the accent is defined once (as the token), used only through var(--accent)');
  assert.equal(count(/var\(--accent\)/g, cssNoComments), 2, 'var(--accent) is used exactly twice: the button and the badge');
  assert.match(css, /100svh/);
  assert.match(css, /max-height:\s*40svh/);
  assert.match(css, /-apple-system/);
  assert.doesNotMatch(css, /Inter/);
});
