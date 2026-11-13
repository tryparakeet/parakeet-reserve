// Icons for the reserve page: public/favicon.svg, public/assets/favicon-32.png,
// public/assets/apple-touch-icon.png and public/favicon.ico.
//
// The app icon (DESIGN.md §7): the head close up, white on sky. The drawing is
// scripts/parakeet-icon.svg, a byte-for-byte copy of parakeet-app's
// docs/brand/parakeet-icon.svg (Umyt, Nov 12), used exactly as it is: never
// redrawn, retraced or simplified. When the app icon changes, copy the new file
// over it and run this again.
//
// Usage: node scripts/make-icons.mjs
//   - writes favicon.svg (rounded corners, used by browsers that take SVG): the
//     icon file with its drawing wrapped in a clip of its own square, corners of
//     radius 14/64 of the side; nothing inside the drawing changes
//   - renders with Playwright's Chromium at 32 px (rounded, transparent
//     corners) and at 180 px full-bleed, the file as it is (iOS masks the
//     corners itself)
//   - favicon.ico from the 32 px PNG with ImageMagick (`convert`), 32 + 16
// Needs node_modules/playwright (devDependency) with its Chromium already
// present (PLAYWRIGHT_BROWSERS_PATH) and ImageMagick on PATH. Never run
// `playwright install` here.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ASSETS = join(PUBLIC, 'assets');

const ICON = readFileSync(join(ROOT, 'scripts', 'parakeet-icon.svg'), 'utf8');

// The icon with round corners: the root element and its title as they are, then a clip the size of
// the viewBox, and the drawing (the sky square, the bird) inside a group that uses it.
function rounded(svg) {
  const m = /^(<svg\b[^>]*>)(\s*<title>[^<]*<\/title>)?([\s\S]*?)(\s*<\/svg>\s*)$/.exec(svg);
  if (!m) throw new Error('parakeet-icon.svg: expected one <svg> root');
  const [x, y, w, h] = /\sviewBox="([^"]+)"/.exec(m[1])[1].trim().split(/[\s,]+/).map(Number);
  const r = +(w * 14 / 64).toFixed(2);
  return m[1] + (m[2] || '') +
    `\n  <clipPath id="corner"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>` +
    '\n  <g clip-path="url(#corner)">' + m[3].replace(/\n/g, '\n  ') + '\n  </g>' + m[4];
}

mkdirSync(ASSETS, { recursive: true });
writeFileSync(join(PUBLIC, 'favicon.svg'), rounded(ICON));
console.log('wrote public/favicon.svg');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(markup, size, out) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${markup}</body></html>`
    );
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote ' + out.slice(ROOT.length + 1));
  }
  await render(rounded(ICON), 32, join(ASSETS, 'favicon-32.png'));
  await render(ICON, 180, join(ASSETS, 'apple-touch-icon.png'));
} finally {
  await browser.close();
}

execFileSync('convert', [join(ASSETS, 'favicon-32.png'), '-define', 'icon:auto-resize=32,16', join(PUBLIC, 'favicon.ico')], { stdio: 'inherit' });
console.log('wrote public/favicon.ico');
