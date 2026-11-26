// public/: what ships. No vh units (svh only), no external URL but Support's one link to Apple, nothing
// inline, no Netlify Forms; the page's ids, every data-tap value of BUTTONS but play, the one script and
// the one stylesheet, the viewport flags, the pictures, the exact copy; every page's footer; the legal
// pages' promises; Privacy's part about the app; Support's words; robots.txt; app.js's endpoint, cookie name
// and transport.

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
const support = read('support.html');
const css = read('styles.css');
const app = read('app.js');

// The one link off the site: Support sends refunds to Apple. A visitor follows it; the page loads nothing
// from it (the CSP allows only 'self'), so it is the one http(s) URL allowed in public/.
const APPLE_LINK = '<a href="https://reportaproblem.apple.com">reportaproblem.apple.com</a>';

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
  for (const name of ['index.html', 'styles.css', 'app.js', 'privacy.html', 'terms.html', 'support.html', 'robots.txt', 'favicon.svg']) {
    assert.ok(files.some((f) => f === join(PUBLIC, name)), `public/${name} exists`);
  }
});

test('no vh, dvh or lvh unit anywhere in public/ (svh only)', () => {
  for (const f of textFiles) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\d(vh|dvh|lvh)\b/, `${rel(f)} uses a vh unit`);
  }
});

test('no external URL in public/ but the one link to Apple on Support: no http(s)://, no protocol-relative URL, no @import, url(https) or data: in CSS', () => {
  for (const f of textFiles) {
    let src = readFileSync(f, 'utf8');
    if (extname(f) === '.svg' || extname(f) === '.html') src = src.replace(/\sxmlns(:[a-z]+)?="[^"]*"/g, '');
    if (f === join(PUBLIC, 'support.html')) src = src.replace(APPLE_LINK, '');   // the first one only
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
  assert.match(index, /<meta name="theme-color" content="#FBF6EC">/i, 'the browser bar is cream (DESIGN.md §4)');
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

test('index.html data-tap: every BUTTON of event.mjs but play is on the page, and nothing else; play stays allowlisted and nothing emits it', () => {
  const taps = [...index.matchAll(/\sdata-tap="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(taps)].sort(), ['android', 'plan_monthly', 'plan_yearly', 'reserve'], 'the page carries every BUTTON but play');
  for (const t of taps) assert.ok([...BUTTONS].includes(t), `${t} is one of BUTTONS`);
  assert.equal(taps.filter((t) => t.startsWith('plan_')).length, 2, 'each plan once, in the sheet');
  assert.deepEqual([...BUTTONS].sort(), ['android', 'plan_monthly', 'plan_yearly', 'play', 'reserve'], 'play is still allowlisted');
  assert.doesNotMatch(app, /'play'/, 'app.js never sends play');
  assert.match(index, /<button[^>]*\sdata-tap="reserve"[^>]*>/);
  assert.match(index, /<button[^>]*\sdata-tap="android"[^>]*>/);
  assert.match(index, /<button[^>]*\srole="radio"[^>]*\sdata-tap="plan_yearly"[^>]*\sdata-plan="yearly"[^>]*\saria-checked="true"/);
  assert.match(index, /<button[^>]*\srole="radio"[^>]*\sdata-tap="plan_monthly"[^>]*\sdata-plan="monthly"[^>]*\saria-checked="false"/);
  assert.match(index, /<button[^>]*\sid="hold"[^>]*>/);
  assert.doesNotMatch(index, /data-tap="[^"]*"[^>]*data-tap=/, 'no element carries two data-tap attributes');
});

test('index.html pictures: no clip; the bird and the wordmark inline (currentColor); every img sized and decoded async under /media; the phones\' screens; the price is the seen target', () => {
  assert.doesNotMatch(index, /<video\b/i, 'no video');
  assert.doesNotMatch(index, /walkthrough/, 'the walkthrough clip is gone from the page');
  assert.doesNotMatch(index, /dish-|class="(app|week|dinners?)"/, 'the drawn week and its dish photos are gone');
  assert.match(index, /<symbol id="pk-mark" viewBox="228 90 572 856"><g fill="currentColor">/);
  assert.match(index, /<symbol id="pk-word" viewBox="68 -726 4140 737"><path fill="currentColor" d="M188 -257V-379H340Q/, 'the outlined wordmark (Outfit Bold), its fill currentColor');
  assert.equal(count(/\sid="pk-word"/g, index), 1);
  assert.equal(count(/<use href="#pk-mark"\/>/g, index), 1, 'the bird once: the footer\'s whole white bird');
  assert.equal(count(/<use href="#pk-word"\/>/g, index), 2, 'the wordmark twice: the header and the footer');
  assert.match(index, /<header class="top">\s*<img class="logo-icon" [^>]*>\s*<svg class="logo-word" role="img" aria-label="Parakeet" focusable="false"><use href="#pk-word"\/><\/svg>\s*<button class="top-btn for-reserve" type="button" data-tap="reserve">Reserve 2 free weeks<\/button>\s*<button class="top-btn for-android" type="button" data-tap="android">Email me when it’s on Android<\/button>\s*<\/header>/, 'the header: the icon beside the wordmark, named Parakeet, then the computer\'s small Reserve (Android\'s button on Android)');
  assert.match(index, /<div class="giant" aria-hidden="true">\s*<svg class="giant-bird" focusable="false"><use href="#pk-mark"\/><\/svg>\s*<svg class="giant-word" focusable="false"><use href="#pk-word"\/><\/svg>\s*<\/div>/, 'the footer: the bird beside the giant wordmark, aria-hidden');
  const imgs = index.match(/<img\b[^>]*>/gi) || [];
  assert.equal(imgs.length, 12, 'the icon, three bezels, and the phones\' eight screens');
  for (const img of imgs) {
    assert.match(img, /\ssrc="\/media\/[a-z0-9-]+\.webp"/, `${img}: a WebP under /media`);
    assert.match(img, /\swidth="\d+"/, `${img}: width`);
    assert.match(img, /\sheight="\d+"/, `${img}: height`);
    assert.match(img, /\sdecoding="async"/, `${img}: decoding async`);
    assert.match(img, /\salt=""/, `${img}: decorative (the phone carries the label)`);
  }
  assert.match(imgs[0], /^<img class="logo-icon" src="\/media\/icon-v1-30\.webp" srcset="[^"]*\/media\/icon-v1-90\.webp 90w[^"]*" sizes="[^"]+" width="30" height="30"/, 'the icon: one srcset for its three sizes at 1x to 3x');
  const screens = imgs.filter((i) => /class="shot/.test(i));
  const name = (i) => /\/media\/screen-([a-z]+)-/.exec(i)[1];
  assert.deepEqual(screens.map(name), ['week', 'list', 'total', 'nights', 'budget', 'week', 'list', 'yours'], 'the first screen\'s three, the story\'s four, the price\'s one');
  for (const i of screens) {
    const set = /\ssrcset="([^"]+)"/.exec(i);
    assert.ok(set && /-420\.webp 420w, \/media\/[a-z0-9-]+-640\.webp 640w$/.test(set[1]), `${i}: srcset at 420 and 640 wide`);
    assert.match(i, /\ssizes="[^"]+"/, `${i}: sizes`);
    assert.match(i, /\swidth="420" height="911"/, `${i}: its size`);
  }
  screens.slice(0, 3).forEach((i, n) => {
    assert.match(i, new RegExp(`class="shot answer-${n + 1}"`), `${i}: changes with the answer line`);
    assert.doesNotMatch(i, /loading=/, `${i}: the first screen's screens load at once`);
  });
  for (const i of screens.slice(3)) assert.match(i, /\sloading="lazy"/, `${i}: the story's and the price's screens load lazily`);
  assert.equal(count(/<div class="phone" role="img" aria-label="Parakeet on an iPhone\.">/g, index), 2, 'the first screen\'s phone and the story\'s');
  assert.equal(count(/<div class="phone" role="img" aria-label="Parakeet on an iPhone: a price you typed\.">/g, index), 1);
  assert.match(index, /<span class="plan-price" id="price">14 days free, then just \$29\.99\/year\.<\/span>/);
});

test('index.html answer line: the two passing answers are aria-hidden, the last is the readable text', () => {
  const lines = [...index.matchAll(/<p class="answer-line [^"]*"([^>]*)>([^<]*)<\/p>/g)];
  assert.deepEqual(lines.map((m) => m[2]), ['This week’s dinners, priced at your store.', 'Groceries add up. We’ll do the adding.', 'Know what dinner costs before you shop.']);
  assert.match(lines[0][1], /aria-hidden="true"/);
  assert.match(lines[1][1], /aria-hidden="true"/);
  assert.doesNotMatch(lines[2][1], /aria-hidden/);
});

// Every page's footer: the address, then Privacy, Terms and Support under one label. The old address is gone.
function pageFooter(html, name) {
  assert.match(html, /<p class="foot-contact">Contact: <a href="mailto:support\.parakeet@gmail\.com">support\.parakeet@gmail\.com<\/a><\/p>/, `${name}: the contact line`);
  assert.match(html, /<nav class="foot-links" aria-label="Support and legal"><a href="\/privacy">Privacy<\/a><a href="\/terms">Terms<\/a><a href="\/support">Support<\/a><\/nav>/, `${name}: Privacy, Terms, then Support, labelled "Support and legal"`);
  assert.ok(!html.includes('app.parakeet@'), `${name}: the old address is gone`);
}

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
    'Parakeet is iPhone only for now. We plan to bring it to Android.',
    'Email me when it’s on Android',
    'Planning dinners for the whole week?',
    'You pick your store and your budget, and it plans your week’s dinners so they share ingredients, with one grocery list and the total added up before you shop.',
    'Pick how many days.', 'Set your budget.', 'We plan the dinners.', 'You get the grocery list.',
    'When you type what you really paid, it remembers that price for that store.',
    'Stores Walmart Kroger Target Aldi H-E-B Sprouts Whole Foods Trader Joe’s Meijer Wegmans Hy-Vee Publix',
    'Prices',
    'We use the regular price for the whole pack you’d actually buy. Your total at the register may come out a little different.',
    'Recipes',
    'The recipes come from food groups and home cooks who said yes to sharing them. Each one will show who made it and link to the original. None will be made by AI.',
    'Parakeet is an app in development. The plan prices are what you’d pay at launch.',
    'Contact: support.parakeet@gmail.com',
    'Privacy',
    'Terms',
    'Support',
    '© 2026 Parakeet.',
    'Parakeet is coming soon. Which plan do you want?',
    '2 free weeks 14 days free, then just $29.99/year.',
    'No free weeks $9.99/month, starts at launch.',
    'Nothing will be charged today. Billing is through Apple, and you can cancel anytime in Settings.',
    'Hold my spot',
    'Where should we send it?',
    'Send my invite',
    'Your 2 free weeks are reserved for . We’ll email you once, when Parakeet is live.',
    'Your spot is saved for . We’ll email you once, when Parakeet is live.',
    'One email when we launch. Your 2 free weeks are tied to this email.',
    'One email when we launch, nothing else.',
    'We’ll email when Parakeet is on Android.',
    'We’ll email you when it’s on Android, and maybe once before, to ask if you’d like to try it early. Nothing else.'
  ];
  for (const s of strings) assert.ok(text.includes(s), `index.html says: ${s}`);
  for (const gone of ['5 dinners that fit your budget.', 'Yearly', 'Monthly', 'FREE WEEKS', 'Totals are estimates', 'cooked by a real person first', 'Some will come from food creators, and some will be tested recipes from the USDA.', "You're on the list.", 'Done', 'More soon', 'Real people will cook every recipe', 'Cheese quesadillas', 'Chicken wraps', '$58.12']) {
    assert.ok(!text.includes(gone), `index.html no longer says: ${gone}`);
  }
  assert.match(index, /<h1>What’s for dinner this week\?<\/h1>/);
  assert.match(index, /<h2>Planning dinners for the whole week\?<\/h2>/);
  assert.match(index, /<ul class="chips">(<li class="chip">[^<]+<\/li>){12}<\/ul>/, 'the twelve stores as chips, nothing else in the list');
  assert.equal(count(/<h2 class="label">Stores<\/h2>\s*<ul class="chips">(<li class="chip">[^<]+<\/li>){12}<\/ul>/g, index), 2, 'the stores twice: on a computer\'s first screen and, on a phone, further down');
  assert.match(index, /<div class="first-stores">\s*<h2 class="label">Stores<\/h2>/, 'the computer\'s stores tile');
  assert.match(index, /<p class="android-line for-android">[^<]*<\/p>\s*<button class="btn first-btn for-reserve" type="button" data-tap="reserve">Reserve 2 free weeks<\/button>\s*<button class="btn first-btn for-android" type="button" data-tap="android">Email me when it’s on Android<\/button>\s*<p class="first-note for-reserve">We don’t charge anything today\. Reserve the yearly plan now and you will have 2 free weeks at launch\.<\/p>\s*<\/div>/, 'the computer\'s white tile: its Reserve (Android\'s button on Android) and the reserve line');
  assert.equal(count(/<p class="story-line">/g, index), 4, 'the story\'s four lines');
  assert.match(index, /<p class="android-line for-android">Parakeet is iPhone only for now\. We plan to bring it to Android\.<\/p>/, 'Android\'s line, under the answer line');
  assert.match(index, /<button class="btn-final for-android" type="button" data-tap="android">Email me when it’s on Android<\/button>/, 'Android\'s button, in the bar');
  assert.match(index, /<h2 class="sheet-title" id="sheet-title-1">Parakeet is coming soon\.<br> Which plan do you want\?<\/h2>/);
  assert.match(index, /<span class="tag">2 free weeks<\/span>/);
  assert.match(index, /<span class="tag tag-none">No free weeks<\/span>/);
  assert.match(index, /<span class="tick" aria-hidden="true">/);
  assert.match(index, /<button[^>]*data-tap="reserve"[^>]*>Reserve 2 free weeks<\/button>/);
  assert.match(index, /<button[^>]*id="hold"[^>]*>Hold my spot<\/button>/);
  assert.match(index, /<button class="btn" type="submit"><span class="if-reserve">Send my invite<\/span><span class="if-android">Send<\/span><\/button>/, 'one submit button: Send my invite, or Android\'s Send');
  assert.match(index, /<input id="email"[^>]*\splaceholder="Your email address"/);
  assert.match(index, /<p class="done if-yearly">Your 2 free weeks are reserved for <b class="done-email"><\/b>\. We’ll email you once, when Parakeet is live\.<\/p>/);
  assert.match(index, /<p class="done if-monthly">Your spot is saved for <b class="done-email"><\/b>\. We’ll email you once, when Parakeet is live\.<\/p>/);
  assert.match(index, /<p class="sheet-small if-yearly">One email when we launch\. Your 2 free weeks are tied to this email\.<\/p>/);
  assert.match(index, /<p class="sheet-small if-monthly">One email when we launch, nothing else\.<\/p>/);
  assert.match(index, /<p class="done if-android">We’ll email <b class="done-email"><\/b> when Parakeet is on Android\.<\/p>/, 'Android\'s done line');
  assert.match(index, /<p class="sheet-small if-android">We’ll email you when it’s on Android, and maybe once before, to ask if you’d like to try it early\. Nothing else\.<\/p>/, 'Android\'s small line');
  assert.match(index, /<a href="mailto:support\.parakeet@gmail\.com">support\.parakeet@gmail\.com<\/a>/);
  assert.match(index, /<a href="\/privacy">Privacy<\/a>/);
  assert.match(index, /<a href="\/terms">Terms<\/a>/);
  assert.match(index, /<a href="\/support">Support<\/a>/);
  pageFooter(index, 'index');
  assert.equal(count(/\sdata-reveal\b/g, index), 6, 'the headline, the story\'s tile, the price, the stores, Prices and Recipes, and the footer rise in once');
  assert.equal(count(/\sdata-reveal="rise"/g, index), 2, 'the two tiles with a phone only rise');
  assert.equal(count(/\bRestline\b/g, index) + count(/\brestline\b/g, index), 0);
});

// The landing page's header on Privacy, Terms and Support (DESIGN.md §4): the sky browser bar, the symbol the
// bird needs, one bird in the band, the whole wordmark a link home, before the page's own heading.
function legalHeader(html, name) {
  assert.match(html, /<meta name="theme-color" content="#4FA8E8">/i, `${name}: theme-color is sky`);
  assert.match(html, /<symbol id="pk-mark"/, `${name}: carries the bird symbol`);
  assert.equal(count(/<use href="#pk-mark"\/>/g, html), 1, `${name}: the bird once, in the band`);
  assert.match(html, /<header class="sky legal-sky">\s*<a class="wordmark" href="\/"><svg class="bird"[^>]*><use href="#pk-mark"\/><\/svg>Parakeet<\/a>\s*<\/header>\s*<main class="legal-main">/, `${name}: the sky band with the linked wordmark sits above the page`);
}

test('privacy.html: the cookie, the retention, the one email, never shared or sold, deletion, the address, the row contents', () => {
  const text = textOf(privacy);
  assert.ok(text.includes('pk_v'), 'names the cookie pk_v');
  for (const s of ['90 days', 'launch plus 90 days', 'one email', 'never shared', 'sold', 'deleted', 'support.parakeet@gmail.com']) {
    assert.ok(text.toLowerCase().includes(s.toLowerCase()), `privacy says: ${s}`);
  }
  for (const s of ['tapped', 'seconds on the page', 'device type', 'TikTok', 'Instagram', 'Facebook', 'video', 'email']) {
    assert.ok(text.includes(s), `privacy lists the row contents: ${s}`);
  }
  assert.match(text, /in development/);
  assert.match(text, /Nothing is charged/);
  assert.match(privacy, /<a href="mailto:support\.parakeet@gmail\.com">/);
  assert.match(privacy, /<link rel="stylesheet" href="\/styles\.css">/);
  legalHeader(privacy, 'privacy');
  pageFooter(privacy, 'privacy');
});

// The privacy page's part about the app (SITE-01 §4, Umyt's words, Nov 17), in the page's style: a bold lead-in, the
// page's ’ for each apostrophe, after the page's own parts and before Deletion.
const IN_THE_APP = 'In the app. The app counts what people do in it, so we can see what works and fix what doesn’t: setup’s pages, a week built, the list opened, a price typed, a dinner marked cooked, a thumb, a swap, the paywall and the free week. Each count carries a random id the app makes when it’s installed. Some also carry the store chain, the first three digits of the ZIP code, the household’s size, the diet, the budget, the week’s estimated total and which dinners were picked. It never sends a name, an email, your exact location or full ZIP code, the phone’s identifiers, your notes, your own list items or the prices you type. Your notes, your lists and the prices you type stay on your phone. The counts are stored on Netlify, in the United States, and kept 2 years, then deleted.';

test('privacy.html: the part about the app, word for word, after Where. and before Deletion.', () => {
  const main = /<main class="legal-main">([\s\S]*?)<\/main>/.exec(privacy);
  assert.ok(main, 'the main');
  const paras = [...main[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  const leads = paras.map((p) => (/^<b>([^<]+)<\/b>/.exec(p) || [])[1] || null);
  assert.deepEqual(leads, ['What this page collects.', 'Why.', 'What is not collected.', 'How long.', 'Where.', 'In the app.', 'Deletion.', null]);
  const app = paras[5];
  assert.equal(textOf(app), IN_THE_APP);
  assert.doesNotMatch(app.replace(/^<b>In the app\.<\/b>/, ''), /</, 'no other tag inside');
  assert.doesNotMatch(app, /'/, 'no straight apostrophe: the page uses ’');
  assert.equal(count(/In the app\./g, privacy), 1);
});

test('terms.html: in development, launch prices, nothing charged, the address', () => {
  const text = textOf(terms);
  for (const s of ['in development', 'launch', 'Nothing is charged', '$29.99', '$9.99', 'support.parakeet@gmail.com', 'Apple']) {
    assert.ok(text.includes(s), `terms says: ${s}`);
  }
  assert.match(terms, /<link rel="stylesheet" href="\/styles\.css">/);
  legalHeader(terms, 'terms');
  pageFooter(terms, 'terms');
});

test('support.html: word for word (the address, five questions and their answers), the one link to Apple, the questions at 20/700', () => {
  const main = /<main class="legal-main">([\s\S]*?)<\/main>/.exec(support);
  assert.ok(main, 'the main');
  // inline tags (the two links) drop out without a space, so each line reads as written
  const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const blocks = /<(h1|h2|p)>([\s\S]*?)<\/\1>/g;
  assert.deepEqual([...main[1].matchAll(blocks)].map((m) => [m[1], plain(m[2])]), [
    ['h1', 'Support'],
    ['p', 'Write to us at support.parakeet@gmail.com with a question, a problem or an idea. We read every email.'],
    ['h2', 'How do I cancel?'],
    ['p', 'On your iPhone, open Settings, tap your name, then Subscriptions. Tap Parakeet and cancel it there. If you don’t want to pay after your free week, cancel at least a day before it ends.'],
    ['h2', 'Can I get a refund?'],
    ['p', 'Apple handles every payment, so refunds come from Apple. You can ask for one at reportaproblem.apple.com.'],
    ['h2', 'How do I get my plan back on a new iPhone?'],
    ['p', 'Use the same Apple Account, open Parakeet and tap Restore purchases on the screen with the plans.'],
    ['h2', 'Why is my total different at the register?'],
    ['p', 'Every price is an estimate of the regular shelf price, never a sale price, and prices don’t include tax. When you type what you paid, Parakeet remembers it for that item at that store.'],
    ['h2', 'Do I need an account?'],
    ['p', 'No. There’s no account and no sign-in. Your weeks, your lists and the prices you type stay on your iPhone.']
  ]);
  assert.equal(main[1].replace(blocks, '').trim(), '', 'nothing else in the main');
  assert.match(main[1], /<p>Write to us at <a href="mailto:support\.parakeet@gmail\.com">support\.parakeet@gmail\.com<\/a> with /);
  assert.equal(support.split(APPLE_LINK).length, 2, 'the one link to Apple, as written');
  assert.match(support, /<title>Support — Parakeet<\/title>/);
  assert.match(support, /<link rel="stylesheet" href="\/styles\.css">/);
  assert.match(css, /\.legal-main h2 \{[^}]*font-size: 20px;[^}]*font-weight: 700;[^}]*color: var\(--ink\);/, 'the questions are the H2 of DESIGN.md §3: 20/700, ink');
  assert.match(css, /\.legal-main h2 \+ p \{ margin-top: 6px; \}/, 'each answer sits close under its question');
  legalHeader(support, 'support');
  pageFooter(support, 'support');
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
  assert.match(app, /var android = device === 'android';\s*if \(android\) root\.classList\.add\('android'\);/, 'an Android phone gets its words (html.android), set first');
  assert.match(app, /else if \(button === 'android'\) openSheet\(true\);/, 'Android\'s button opens the sheet on its email step');
  assert.match(app, /selectedPlan = 'android';\s*sheetRoot\.setAttribute\('data-picked', 'android'\);\s*showStep\(2\);/, 'with the plan android and Android\'s lines');
  assert.match(css, /#sheet:not\(\[data-picked="android"\]\) \.if-android,\s*#sheet\[data-picked="android"\] \.if-reserve \{ display: none; \}/, 'each .if- line shows only for its own');
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
  assert.match(css, /\.cta\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/, 'the bottom bar is pinned to the bottom');
  const unpinned = /@media ([^{]*)\{[^@]*?\.cta \{ position: relative;/.exec(cssNoComments);
  assert.ok(unpinned, 'the bar sits in the page only under a media query');
  for (const q of unpinned[1].split(',')) assert.match(q, /max-height: \d+(\.\d+)?px/, `${q.trim()}: only in a window too short for the words, a 200 px phone and the bar`);
  assert.match(css, /--sheet-pad-bottom:[^;]*env\(safe-area-inset-bottom/, 'with the bottom safe-area inset');
  assert.match(css, /\[data-reveal\]\.in\s*\{\s*animation:\s*rise 500ms var\(--curve\) both;/, 'the rise: 500 ms on the standard curve, only once .in is added');
  assert.doesNotMatch(cssNoComments, /\[data-reveal\](?!\.in|\.wait)[^{,]*\{[^}]*opacity:\s*0/, 'the parts are visible at rest');
  assert.match(cssNoComments, /\[data-reveal\]\.wait\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(14px\);\s*\}/, 'the waiting state is the script\'s .wait');
  assert.doesNotMatch(index, /class="[^"]*\bwait\b/, 'the markup never waits: only app.js adds .wait');
  assert.match(app, /classList\.add\('wait'\)/, 'app.js adds the waiting state');
  assert.match(app, /getBoundingClientRect\(\)\.top > windowH/, 'only to a part whose top is below the window at load');
  assert.match(app, /threshold: 0\.12/, 'it rises once 12% of it shows, as the boards do it');
  assert.match(app, /rootMargin: '100000px 0px ' \+ \(wide && wide\.matches \? '-50%' : '-34%'\) \+ ' 0px'/, 'the story\'s focus line: 66% of the window on a phone, its middle on a computer');
  assert.equal(count(/new IntersectionObserver\(/g, app), 3, 'one observer each: seen, the rise, the story');
  assert.doesNotMatch(app, /win(dow)?\.addEventListener\('scroll'/, 'no scroll listener on the page');
  assert.match(css, /\.story\.focus \.story-line\s*\{\s*opacity:\s*0\.62;\s*\}/, 'the lines out of focus are ink at 62%');
  assert.match(cssNoComments, /\.sheet \{[^}]*transform: translateY\(100%\);\s*transition: transform 320ms var\(--curve\);/, 'the phone\'s sheet rises, and slides down, in 320 ms');
  assert.match(cssNoComments, /\.sheet-backdrop \{[^}]*opacity: 0;\s*transition: opacity 200ms linear;/, 'the dim fades out in 200 ms');
  assert.match(cssNoComments, /\.sheet-root\.open \.sheet-backdrop \{\s*opacity: 1;/, 'and fades in as the sheet opens');
  assert.match(cssNoComments, /transform: translateY\(12px\);\s*opacity: 0;\s*transition: transform 240ms var\(--curve\), opacity 240ms var\(--curve\);/, 'the computer\'s dialog rises 12 px as it fades in, and drops as it fades out, in 240 ms');
  assert.match(cssNoComments, /@keyframes step-in \{\s*from \{ opacity: 0; transform: translateY\(4px\); \}/, 'the next step and the done line rise 4 px as they fade in');
  assert.match(cssNoComments, /\.step\.step-in \{ animation: step-in 200ms var\(--curve\) both; \}/, 'in 200 ms');
  assert.match(app, /showStep\(2, true\)/, 'Hold my spot moves on to the email step');
  assert.match(app, /showStep\(3, true\)/, 'a good address moves on to the done line');
  assert.match(cssNoComments, /\.plan::before \{[^}]*background: var\(--sky-soft\);\s*box-shadow: inset 0 0 0 1\.5px var\(--sky\);\s*opacity: 0;\s*transition: opacity 150ms linear;/, 'a row\'s ring and fill change in 150 ms');
  assert.match(cssNoComments, /@keyframes tick-pop \{\s*0% \{ transform: scale\(0\.8\);[^}]*\}\s*60% \{ transform: scale\(1\.12\);[^}]*\}\s*100% \{ transform: none; \}/, 'a tick pops from 80% to 112% and back');
  assert.match(cssNoComments, /\.tick\.pop \{ animation: tick-pop 260ms both; \}/, 'in 260 ms');
  assert.match(app, /if \(on && !was && !reduced\) popTick\(/, 'only as it turns on');
  assert.match(css, /@keyframes rise\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(14px\)/);
  for (const n of [1, 2, 3]) {
    assert.match(css, new RegExp(`\\.answer-${n}\\s*\\{\\s*animation:\\s*answer-${n} 5\\.8s ease-in-out 0\\.3s both;`), `answer ${n}: the one 5.8 s pass from 0.3 s, as the boards run it`);
  }
  assert.match(css, /@keyframes answer-3\s*\{\s*0%, 93\.1%\s*\{\s*opacity:\s*0;\s*\}\s*100%\s*\{\s*opacity:\s*1;\s*\}/, 'the last answer fades in at the end and stays');
  assert.match(css, /\.first-words\s*\{\s*animation:\s*first-in 600ms var\(--curve\) both;/, 'at load the words rise 16 px and fade in');
  assert.match(css, /\.first-tile\s*\{\s*animation:\s*first-rise 600ms var\(--curve\) 100ms both;/, 'the phone\'s tile rises 100 ms later');
  assert.match(css, /@keyframes first-rise\s*\{\s*from\s*\{\s*transform:\s*translateY\(16px\);\s*\}\s*to\s*\{\s*transform:\s*none;\s*\}\s*\}/, 'the phone\'s tile only rises: the bezel never fades');
  assert.match(css, /--curve:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\);/, 'the standard curve');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.answer-1, \.answer-2, \.answer-3\s*\{\s*animation:\s*none;/, 'reduced motion: the answers do not move');
  assert.doesNotMatch(cssNoComments, /box-shadow:\s*0\s+\d+px\s+\d+px/, 'flat: no drop shadow');
});
