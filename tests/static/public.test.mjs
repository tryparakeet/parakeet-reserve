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
  assert.match(index, /<meta name="description" content="What’s for dinner this week\?">/);
  assert.match(index, /<meta name="theme-color" content="#4FA8E8">/i);
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
  for (const id of ['price', 'sheet', 'sheet-panel', 'step-1', 'step-2', 'step-3', 'sheet-title-1', 'sheet-title-2', 'hold', 'email-form', 'email', 'pk-mark']) {
    assert.equal(count(new RegExp(`\\sid="${id}"`, 'g'), index), 1, `id="${id}" exactly once`);
  }
});

test('index.html data-tap: the BUTTONS of event.mjs but play, each once; play stays allowlisted and nothing emits it', () => {
  const taps = [...index.matchAll(/\sdata-tap="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(taps.length, 3, 'three data-tap attributes');
  assert.deepEqual([...taps].sort(), ['plan_monthly', 'plan_yearly', 'reserve']);
  assert.deepEqual([...BUTTONS].sort(), ['plan_monthly', 'plan_yearly', 'play', 'reserve'], 'play is still allowlisted');
  assert.doesNotMatch(app, /'play'/, 'app.js never sends play');
  assert.match(index, /<button[^>]*\sdata-tap="reserve"[^>]*>/);
  assert.match(index, /<button[^>]*\srole="radio"[^>]*\sdata-tap="plan_yearly"[^>]*\sdata-plan="yearly"[^>]*\saria-checked="true"/);
  assert.match(index, /<button[^>]*\srole="radio"[^>]*\sdata-tap="plan_monthly"[^>]*\sdata-plan="monthly"[^>]*\saria-checked="false"/);
  assert.match(index, /<button[^>]*\sid="hold"[^>]*>/);
  assert.doesNotMatch(index, /data-tap="[^"]*"[^>]*data-tap=/, 'no element carries two data-tap attributes');
});

test('index.html hero B: no clip; the bird inline (currentColor); every img sized and decoded async under /media; the price is the seen target', () => {
  assert.doesNotMatch(index, /<video\b/i, 'no video on hero B');
  assert.doesNotMatch(index, /walkthrough/, 'the walkthrough clip is gone from the page');
  assert.match(index, /<symbol id="pk-mark" viewBox="228 90 572 856"><g fill="currentColor">/);
  assert.equal(count(/<use href="#pk-mark"\/>/g, index), 2, 'the bird twice: the wordmark and the week header');
  const imgs = index.match(/<img\b[^>]*>/gi) || [];
  assert.equal(imgs.length, 3, 'two dish photos and the bezel');
  for (const img of imgs) {
    assert.match(img, /\ssrc="\/media\/[a-z0-9-]+\.webp"/, `${img}: a WebP under /media`);
    assert.match(img, /\swidth="\d+"/, `${img}: width`);
    assert.match(img, /\sheight="\d+"/, `${img}: height`);
    assert.match(img, /\sdecoding="async"/, `${img}: decoding async`);
    assert.match(img, /\salt=""/, `${img}: decorative (the phone carries the label)`);
  }
  assert.match(index, /<div class="phone" role="img" aria-label="[^"]*\$58\.12[^"]*\$100 budget[^"]*">/);
  assert.match(index, /<span class="plan-price" id="price">14 days free, then just \$29\.99\/year\.<\/span>/);
});

test('index.html answer line: the two passing answers are aria-hidden, the last is the readable text', () => {
  const lines = [...index.matchAll(/<p class="answer-line [^"]*"([^>]*)>([^<]*)<\/p>/g)];
  assert.deepEqual(lines.map((m) => m[2]), ['This week’s dinners, priced at your store.', 'Groceries add up. We’ll do the adding.', 'Know what dinner costs before you shop.']);
  assert.match(lines[0][1], /aria-hidden="true"/);
  assert.match(lines[1][1], /aria-hidden="true"/);
  assert.doesNotMatch(lines[2][1], /aria-hidden/);
});

test('index.html copy, verbatim', () => {
  const text = textOf(index);
  const strings = [
    'Parakeet',
    'What’s for dinner this week?',
    'This week’s dinners, priced at your store.',
    'Groceries add up. We’ll do the adding.',
    'Know what dinner costs before you shop.',
    'Reserve 2 free weeks',
    'We don’t charge anything today. Reserve the yearly plan now and you will have 2 free weeks at launch.',
    'Stores', 'Walmart', 'Kroger', 'Target', 'Aldi', 'More soon',
    'Prices',
    'We use the regular price for the whole pack you’d actually buy. Your total at the register may come out a little different.',
    'Recipes',
    'Real people will cook every recipe before we add it. Some will come from food creators, and some will be tested recipes from the USDA. None will be made by AI.',
    'Parakeet is an app in development. The plan prices are what you’d pay at launch.',
    'Contact: app.parakeet@gmail.com',
    'Privacy',
    'Terms',
    '© 2026 Parakeet.',
    'We plan to launch in January. Which plan do you want?',
    '2 free weeks 14 days free, then just $29.99/year.',
    'No free weeks $9.99/month, starts at launch.',
    'Nothing will be charged today. Billing is through Apple, and you can cancel anytime in Settings.',
    'Hold my spot',
    'Where should we send it?',
    'Send my invite',
    'Your 2 free weeks are reserved for . We’ll email you once, when Parakeet is live.',
    'Your spot is saved for . We’ll email you once, when Parakeet is live.',
    'One email when we launch. Your 2 free weeks are tied to this email.',
    'One email when we launch, nothing else.'
  ];
  for (const s of strings) assert.ok(text.includes(s), `index.html says: ${s}`);
  for (const gone of ['5 dinners that fit your budget.', 'Yearly', 'Monthly', 'FREE WEEKS', 'Totals are estimates', 'cooked by a real person first', "You're on the list.", 'Done']) {
    assert.ok(!text.includes(gone), `index.html no longer says: ${gone}`);
  }
  assert.match(index, /<h1>What’s for dinner this week\?<\/h1>/);
  assert.match(index, /<p class="wordmark"><svg class="bird" aria-hidden="true" focusable="false"><use href="#pk-mark"\/><\/svg>Parakeet<\/p>/);
  assert.match(index, /<h2 class="sheet-title" id="sheet-title-1">We plan to launch in January\.<br> Which plan do you want\?<\/h2>/);
  assert.match(index, /<span class="tag">2 free weeks<\/span>/);
  assert.match(index, /<span class="tag tag-none">No free weeks<\/span>/);
  assert.match(index, /<span class="tick" aria-hidden="true">/);
  assert.match(index, /<button[^>]*data-tap="reserve"[^>]*>Reserve 2 free weeks<\/button>/);
  assert.match(index, /<button[^>]*id="hold"[^>]*>Hold my spot<\/button>/);
  assert.match(index, /<button[^>]*type="submit"[^>]*>Send my invite<\/button>/);
  assert.match(index, /<input id="email"[^>]*\splaceholder="Your email address"/);
  assert.match(index, /<p class="done if-yearly">Your 2 free weeks are reserved for <b class="done-email"><\/b>\. We’ll email you once, when Parakeet is live\.<\/p>/);
  assert.match(index, /<p class="done if-monthly">Your spot is saved for <b class="done-email"><\/b>\. We’ll email you once, when Parakeet is live\.<\/p>/);
  assert.match(index, /<p class="sheet-small if-yearly">One email when we launch\. Your 2 free weeks are tied to this email\.<\/p>/);
  assert.match(index, /<p class="sheet-small if-monthly">One email when we launch, nothing else\.<\/p>/);
  assert.match(index, /<a href="mailto:app\.parakeet@gmail\.com">app\.parakeet@gmail\.com<\/a>/);
  assert.match(index, /<a href="\/privacy">Privacy<\/a>/);
  assert.match(index, /<a href="\/terms">Terms<\/a>/);
  assert.equal(count(/\sdata-reveal\b/g, index), 4, 'three rows and the footer fade in once');
  assert.equal(count(/\bRestline\b/g, index) + count(/\brestline\b/g, index), 0);
});

// The landing page's header on both legal pages (DESIGN.md §4): the sky browser bar, the symbol the bird
// needs, one bird in the band, the whole wordmark a link home, before the page's own heading.
function legalHeader(html, name) {
  assert.match(html, /<meta name="theme-color" content="#4FA8E8">/i, `${name}: theme-color is sky`);
  assert.match(html, /<symbol id="pk-mark"/, `${name}: carries the bird symbol`);
  assert.equal(count(/<use href="#pk-mark"\/>/g, html), 1, `${name}: the bird once, in the band`);
  assert.match(html, /<header class="sky legal-sky">\s*<a class="wordmark" href="\/"><svg class="bird"[^>]*><use href="#pk-mark"\/><\/svg>Parakeet<\/a>\s*<\/header>\s*<main class="legal-main">/, `${name}: the sky band with the linked wordmark sits above the page`);
}

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
  legalHeader(privacy, 'privacy');
});

test('terms.html: in development, launch prices, nothing charged, the address', () => {
  const text = textOf(terms);
  for (const s of ['in development', 'launch', 'Nothing is charged', '$29.99', '$9.99', 'app.parakeet@gmail.com', 'Apple']) {
    assert.ok(text.includes(s), `terms says: ${s}`);
  }
  assert.match(terms, /<link rel="stylesheet" href="\/styles\.css">/);
  legalHeader(terms, 'terms');
});

test('robots.txt keeps crawlers off /admin and /api/', () => {
  const lines = read('robots.txt').trim().split(/\r?\n/).map((l) => l.trim());
  assert.deepEqual(lines, ['User-agent: *', 'Disallow: /admin', 'Disallow: /api/']);
});

test('app.js: the endpoint, the cookie name, the transport, no http literal, no video state, the scroll fade', () => {
  assert.match(app, /ENDPOINT = '\/api\/event'/);
  assert.match(app, /COOKIE = 'pk_v'/);
  for (const s of ['sendBeacon', 'keepalive', 'visibilitychange', 'pagehide', 'pageshow', 'IntersectionObserver', 'visualViewport']) {
    assert.ok(app.includes(s), `app.js uses ${s}`);
  }
  assert.doesNotMatch(app, /http/, 'no http literal in app.js');
  assert.doesNotMatch(app, /'answer'/, 'the answer event is gone');
  assert.doesNotMatch(app, /'video'|'blocked'|'playing'/, 'hero B has no clip: no video row, no video state');
  assert.match(app, /via(: | = )'card'/, 'a card press is recorded as via card');
  assert.match(app, /via(: | = )'hold'/, 'Hold my spot records the preselected plan as via hold');
  assert.match(app, /send\('email', \{ email: v, plan: selectedPlan \}\)/, 'the email row carries the plan as before');
  assert.match(app, /\.style\.setProperty\('--vvh'/, 'the sheet height follows the visual viewport');
  assert.match(app, /classList\.add\('in'\)/, 'the scroll fade adds .in');
  assert.match(app, /setAttribute\('data-picked', plan\)/, 'the plan-dependent lines follow the plan');
});

test('styles.css: the DESIGN.md tokens exactly (§2), no other colour, no gradient or glow, svh, the system font stack', () => {
  const tokens = {
    '--sky': '#4FA8E8', '--ink': '#0E1B26', '--cream': '#FBF6EC', '--white': '#FFFFFF', '--sky-soft': '#E3F1FC',
    '--ink-70': 'rgba(14, 27, 38, 0.70)', '--ink-62': 'rgba(14, 27, 38, 0.62)', '--ink-48': 'rgba(14, 27, 38, 0.48)',
    '--ink-22': 'rgba(14, 27, 38, 0.22)', '--ink-10': 'rgba(14, 27, 38, 0.10)'
  };
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  assert.ok(root, ':root block');
  for (const [name, value] of Object.entries(tokens)) {
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(root[1]);
    assert.ok(m, `${name} is defined`);
    assert.equal(m[1].trim().toUpperCase(), value.toUpperCase(), `${name} is ${value}`);
  }
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const outsideRoot = cssNoComments.replace(/:root\s*\{[^}]*\}/, '');
  const colorDecl = (m) => !/^#(FBF6EC|0E1B26|4FA8E8|FFFFFF|E3F1FC)$/i.test(m);
  assert.deepEqual((cssNoComments.match(/#[0-9a-f]{3,8}\b/gi) || []).filter(colorDecl), [], 'no hex colour outside the four tokens and sky-soft');
  assert.deepEqual(outsideRoot.match(/#[0-9a-f]{3,8}\b/gi) || [], [], 'hex colours live in :root only');
  assert.deepEqual(outsideRoot.match(/rgba?\([^)]*\)/gi) || [], [], 'derived colours live in :root only');
  for (const old of ['--bg', '--bg-2', '--surface', '--sheet', '--fg', '--fg-2', '--fg-3', '--accent', '--accent-ink', '--hairline', '--hair-strong', '--shadow', '--focus']) {
    assert.doesNotMatch(cssNoComments, new RegExp(`${old}\\b(?!-)`), `the old token ${old} is gone`);
  }
  assert.doesNotMatch(cssNoComments, /gradient\(/, 'no gradient');
  assert.match(css, /html, body \{ background-color: var\(--cream\); \}/, 'the page is cream');
  assert.match(css, /\.btn\s*\{[^}]*background:\s*var\(--sky\)[^}]*color:\s*var\(--ink\)/, 'the button is ink on sky');
  assert.match(css, /100svh/);
  assert.match(css, /-apple-system/);
  assert.doesNotMatch(css, /Inter/);
  assert.match(css, /\.cta\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/, 'the Reserve sheet is pinned to the bottom');
  assert.match(css, /--sheet-pad-bottom:[^;]*env\(safe-area-inset-bottom/, 'with the bottom safe-area inset');
  assert.match(css, /\[data-reveal\]\.in\s*\{\s*animation:\s*rise 500ms/, 'the scroll fade: 500 ms, only once .in is added');
  assert.doesNotMatch(cssNoComments, /\[data-reveal\](?!\.in)[^{,]*\{[^}]*opacity:\s*0/, 'the rows are visible at rest');
  assert.match(css, /@keyframes rise\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(14px\)/);
  assert.match(css, /\.answer-3\s*\{\s*animation:\s*answer-3 400ms linear 5s both;/, 'the last answer fades in at 5 s and stays');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.answer-1, \.answer-2, \.answer-3\s*\{\s*animation:\s*none;/, 'reduced motion: the answers do not move');
  assert.doesNotMatch(cssNoComments, /box-shadow:\s*0\s+\d+px\s+\d+px/, 'flat: no drop shadow');
});
