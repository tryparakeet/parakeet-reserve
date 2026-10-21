// Icons for the reserve page: public/favicon.svg, public/assets/favicon-32.png,
// public/assets/apple-touch-icon.png and public/favicon.ico.
//
// GATE 0 PLACEHOLDER: a sky-blue rounded square with a near-black "P". This is
// not the Parakeet identity; the bird mark replaces it after the test. The "P"
// is a path, not text, so the icon never depends on a font.
//
// Usage: node scripts/make-icons.mjs
//   - writes favicon.svg (rounded corners, used by browsers that take SVG)
//   - renders it with Playwright's Chromium at 32 px (rounded, transparent
//     corners) and at 180 px full-bleed (iOS masks the corners itself)
//   - favicon.ico from the 32 px PNG with ImageMagick (`convert`), 32 + 16
// Needs node_modules/playwright (devDependency) with its Chromium already
// present (PLAYWRIGHT_BROWSERS_PATH) and ImageMagick on PATH. Never run
// `playwright install` here.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ASSETS = join(PUBLIC, 'assets');

const BG = '#4FA8E8';
const INK = '#141414';
// "P" on a 64-unit grid: a 10-wide stem, a bowl of radius 12 with a counter of radius 4.
const P_PATH = 'M18 14h17a12 12 0 0 1 0 24h-7v12H18z M28 22v8h7a4 4 0 0 0 0-8z';

function svg({ rounded }) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">',
    `<rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="${BG}"/>`,
    `<path d="${P_PATH}" fill="${INK}" fill-rule="evenodd"/>`,
    '</svg>'
  ].join('\n') + '\n';
}

mkdirSync(ASSETS, { recursive: true });
writeFileSync(join(PUBLIC, 'favicon.svg'), svg({ rounded: true }));
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
  await render(svg({ rounded: true }), 32, join(ASSETS, 'favicon-32.png'));
  await render(svg({ rounded: false }), 180, join(ASSETS, 'apple-touch-icon.png'));
} finally {
  await browser.close();
}

execFileSync('convert', [join(ASSETS, 'favicon-32.png'), '-define', 'icon:auto-resize=32,16', join(PUBLIC, 'favicon.ico')], { stdio: 'inherit' });
console.log('wrote public/favicon.ico');
