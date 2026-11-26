// public/media's pictures (SITE-04, made by scripts/make-site-images.sh): every WebP a plain one, its image chunk
// alone (no EXIF, XMP or ICC profile, no URL); the logo's icon at 28, 30 and 34 px at 1x, 2x and 3x; the phone's six
// screens at 420 and 640 wide in 393 x 852's aspect, placeholders until build 2's screens come (§6.7); every picture
// logged in CREDITS.md; and the first screen's pictures on a phone under 300 KB (§6.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, extname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'public');
const MEDIA = join(PUBLIC, 'media');
const rel = (f) => relative(ROOT, f);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const media = readdirSync(MEDIA).filter((n) => statSync(join(MEDIA, n)).isFile());
const bytesOf = (name) => statSync(join(MEDIA, name)).size;

// A WebP file: "RIFF", its size, "WEBP", then chunks (a fourcc, a little-endian size, the data padded to even).
// The picture's size is in the image chunk: VP8L packs width-1 and height-1 in 14 bits each after its 0x2f;
// VP8 (lossy) has them in 14 bits after its start code 9d 01 2a; VP8X has the canvas's in 24 bits each.
function webp(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF', `${rel(file)}: RIFF`);
  assert.equal(buf.toString('latin1', 8, 12), 'WEBP', `${rel(file)}: WEBP`);
  assert.equal(buf.readUInt32LE(4) + 8, buf.length, `${rel(file)}: the RIFF size is the file's`);
  const chunks = [];
  for (let i = 12; i < buf.length;) {
    const id = buf.toString('latin1', i, i + 4);
    const n = buf.readUInt32LE(i + 4);
    chunks.push({ id, at: i + 8, n });
    i += 8 + n + (n & 1);
  }
  const ids = chunks.map((c) => c.id);
  const image = chunks.find((c) => c.id === 'VP8L' || c.id === 'VP8 ');
  let width = 0;
  let height = 0;
  if (image && image.id === 'VP8L') {
    assert.equal(buf[image.at], 0x2f, `${rel(file)}: the VP8L signature`);
    const bits = buf.readUInt32LE(image.at + 1);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (image) {
    assert.deepEqual([...buf.subarray(image.at + 3, image.at + 6)], [0x9d, 0x01, 0x2a], `${rel(file)}: the VP8 start code`);
    width = buf.readUInt16LE(image.at + 6) & 0x3fff;
    height = buf.readUInt16LE(image.at + 8) & 0x3fff;
  }
  return { ids, lossless: !!image && image.id === 'VP8L', width, height, bytes: buf.length, text: buf.toString('latin1') };
}

const SCREENS = ['nights', 'budget', 'week', 'list', 'total', 'yours'];
const SCREEN_WIDTHS = [420, 640];
const ICON_SIZES = [28, 56, 84, 30, 60, 90, 34, 68, 102];   // the logo at 28 (under 390 wide), 30 and 34 px, at 1x to 3x
const ICON_RE = /^icon-(v\d+)-(\d+)\.webp$/;
const SCREEN_RE = /^screen-([a-z]+)-(placeholder|v\d+)-(\d+)\.webp$/;

const icons = media.filter((n) => n.startsWith('icon-'));
const screens = media.filter((n) => n.startsWith('screen-'));
const versionsOf = (names, re, at) => [...new Set(names.map((n) => re.exec(n)).filter(Boolean).map((m) => m[at]))];

test('every WebP under public/ is a plain one: its image chunk alone (VP8 or VP8L, or VP8X with ALPH), no EXIF, XMP or ICC profile, no URL', () => {
  const files = walk(PUBLIC).filter((f) => extname(f).toLowerCase() === '.webp');
  assert.ok(files.length >= 1 + ICON_SIZES.length + SCREENS.length * SCREEN_WIDTHS.length, 'the bezel, the icons and the screens');
  for (const f of files) {
    const w = webp(f);
    const images = w.ids.filter((id) => id === 'VP8 ' || id === 'VP8L');
    assert.equal(images.length, 1, `${rel(f)}: one image chunk (${w.ids.join(', ')})`);
    for (const id of w.ids) assert.ok(['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(id), `${rel(f)}: no ${JSON.stringify(id)} chunk (metadata or animation)`);
    assert.ok(w.width > 0 && w.height > 0, `${rel(f)}: has a size`);
    assert.doesNotMatch(w.text, /https?:\/\//, `${rel(f)} carries an http(s) URL`);
  }
});

test('the logo: the app\'s icon at 28, 30 and 34 px at 1x, 2x and 3x, square, lossless, each under 1 KB, as full sets', () => {
  const versions = versionsOf(icons, ICON_RE, 1);
  assert.ok(versions.includes('v1'), 'icon-v1-*.webp');
  for (const name of icons) {
    const m = ICON_RE.exec(name);
    assert.ok(m, `${name}: named icon-v<n>-<px>.webp`);
    const px = Number(m[2]);
    assert.ok(ICON_SIZES.includes(px), `${name}: ${px} px is one of the logo's sizes`);
    const w = webp(join(MEDIA, name));
    assert.deepEqual([w.width, w.height], [px, px], `${name}: ${px} x ${px}`);
    assert.ok(w.lossless, `${name}: lossless (the sky stays #4FA8E8)`);
    assert.ok(w.bytes < 1024, `${name}: ${w.bytes} bytes, under 1 KB`);
  }
  for (const v of versions) {
    for (const px of ICON_SIZES) assert.ok(icons.includes(`icon-${v}-${px}.webp`), `icon-${v}-${px}.webp`);
  }
});

test('the phone\'s six screens: each at 420 and 640 wide in 393 x 852\'s aspect, as full sets; the placeholders are tiny', () => {
  const versions = versionsOf(screens, SCREEN_RE, 2);
  assert.ok(versions.length >= 1, 'a set of screens (the placeholders until build 2\'s come)');
  for (const name of screens) {
    const m = SCREEN_RE.exec(name);
    assert.ok(m, `${name}: named screen-<screen>-<placeholder or v<n>>-<width>.webp`);
    assert.ok(SCREENS.includes(m[1]), `${name}: ${m[1]} is one of the six screens`);
    const width = Number(m[3]);
    assert.ok(SCREEN_WIDTHS.includes(width), `${name}: ${width} is 420 or 640`);
    const w = webp(join(MEDIA, name));
    assert.equal(w.width, width, `${name}: ${width} wide`);
    assert.ok(Math.abs(w.height - (width * 852) / 393) <= 1, `${name}: ${w.height} tall, 393 x 852's aspect`);
    if (m[2] === 'placeholder') assert.ok(w.bytes < 10 * 1024, `${name}: ${w.bytes} bytes, a placeholder under 10 KB`);
  }
  for (const v of versions) {
    for (const s of SCREENS) {
      for (const width of SCREEN_WIDTHS) assert.ok(screens.includes(`screen-${s}-${v}-${width}.webp`), `screen-${s}-${v}-${width}.webp`);
    }
  }
});

test('the first screen\'s pictures on a phone stay under 300 KB, for every set of screens: the bezel, the 3x icon and the 640-wide week, list and total', () => {
  // An iPhone at 3x asks for 3 x the 203 px screen box, so it takes the 640 stills; the logo there is 30 px, so 90.
  const icon = Math.max(...versionsOf(icons, ICON_RE, 1).map((v) => bytesOf(`icon-${v}-90.webp`)));
  for (const v of versionsOf(screens, SCREEN_RE, 2)) {
    const stills = ['week', 'list', 'total'].map((s) => bytesOf(`screen-${s}-${v}-640.webp`));
    const total = bytesOf('iphone-bezel-v1.webp') + icon + stills.reduce((a, b) => a + b, 0);
    assert.ok(total < 300 * 1024, `the ${v} set: ${total} bytes with the bezel and the icon, under 300 KB`);
  }
});

test('every picture in public/media is logged in CREDITS.md, by its name or a pattern with *', () => {
  const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
  const patterns = [...new Set(credits.match(/[a-z0-9*-]+\.webp/g) || [])]
    .map((p) => new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '[a-z0-9-]*') + '$'));
  for (const name of media) {
    assert.ok(patterns.some((re) => re.test(name)), `${name} has a line in CREDITS.md`);
  }
});
