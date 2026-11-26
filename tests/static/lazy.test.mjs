// The pictures' loading, by their place on the page (SITE-04 §6.5): the story's and the price's stills (and
// their bezels) carry loading="lazy"; the first screen's (the logo's icon, the three stills that change with
// the answer line, and the bezel) carry no loading attribute, so they load at once. The attribute is what is
// tested: Chromium's lazy-load margin fetches a phone's lazy stills anyway, so a browser's requests can't
// tell the two apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const index = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');

// The markup from one marker to the next, each found once and in this order.
function part(start, end) {
  const a = index.indexOf(start);
  assert.ok(a >= 0, `${start} is on the page`);
  assert.equal(index.indexOf(start, a + 1), -1, `${start} is on the page once`);
  const b = index.indexOf(end, a + start.length);
  assert.ok(b > a, `${end} follows ${start}`);
  return index.slice(a, b);
}

const imgs = (html) => html.match(/<img\b[^>]*>/gi) || [];
const attr = (img, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(img);
  return m ? m[1] : null;
};
const screen = (img) => {
  const m = /\/media\/screen-([a-z]+)-/.exec(attr(img, 'src') || '');
  return m ? m[1] : 'bezel';
};

const PLACES = {
  header: part('<header class="top">', '</header>'),
  first: part('<div class="first-tile">', '<div class="first-stores">'),
  story: part('<section class="story">', '</section>'),
  price: part('<div class="tile-yours"', '<div class="stores"')
};

test('every picture on the page is in one of four places: the header, the first screen\'s phone, the story\'s, the price\'s', () => {
  const placed = Object.values(PLACES).reduce((n, html) => n + imgs(html).length, 0);
  assert.equal(placed, imgs(index).length, 'no picture outside the four places');
  assert.deepEqual(imgs(PLACES.header).map((i) => /class="logo-icon"/.test(i)), [true], 'the header: the logo\'s icon');
  assert.deepEqual(imgs(PLACES.first).map(screen), ['week', 'list', 'total', 'bezel'], 'the first screen: the three stills and the bezel');
  assert.deepEqual(imgs(PLACES.story).map(screen), ['nights', 'budget', 'week', 'list', 'bezel'], 'the story: its four stills and the bezel');
  assert.deepEqual(imgs(PLACES.price).map(screen), ['yours', 'bezel'], 'the price: its still and the bezel');
});

test('the story\'s and the price\'s stills and bezels carry loading="lazy"', () => {
  for (const where of ['story', 'price']) {
    for (const img of imgs(PLACES[where])) {
      assert.equal(attr(img, 'loading'), 'lazy', `${where}, ${screen(img)}: loading="lazy"`);
      assert.equal(attr(img, 'fetchpriority'), null, `${where}, ${screen(img)}: no fetch priority`);
    }
  }
});

test('the first screen\'s pictures (the icon, the three stills, the bezel) carry no loading attribute, so they load at once; the bezel first', () => {
  for (const where of ['header', 'first']) {
    for (const img of imgs(PLACES[where])) {
      assert.equal(attr(img, 'loading'), null, `${where}, ${screen(img)}: no loading attribute`);
    }
  }
  const bezel = imgs(PLACES.first).find((i) => /class="bezel"/.test(i));
  assert.equal(attr(bezel, 'fetchpriority'), 'high', 'the first screen\'s bezel is fetched first');
});
