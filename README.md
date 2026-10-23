# Parakeet reserve page

A one-screen "reserve" page for Gate 0, a seven-day paid-traffic test: day 1 is the day video 1 goes up with the paid link (target Mon Oct 26, 2026, or Sat Oct 24 / Sun Oct 25 if everything is ready sooner), the window is day 1 → day 7, and the read is the morning after day 7 (Mon Nov 2 on a Monday start, Sat Oct 31 on a Saturday, Sun Nov 1 on a Sunday), its file named for its day. `GATE_START` in `netlify/functions/event.mjs` is Sat Oct 24, 00:00 CDT (`2026-10-24T05:00:00.000Z`), the earliest possible day 1: every visit received before it resolves to `excluded.prestart` at read, and the per-hour summary cache rebuilds by itself when it changes. Raw days are UTC: CDT evening rows after 7 pm land on the next UTC day (after 6 pm once Dallas leaves CDT on Sun Nov 1 at 2 am). From Sat Oct 24, 00:00 CDT, every test visit opens the smoke link first in that same browser (see ACCEPTANCE.md).

The page is built against `DESIGN.md` (the design rulebook; image sources in `CREDITS.md`): hero B, the sky field with Apple's iPhone bezel, and C1 below the first screen. The page is its own instrument: it gives each visitor an id, records pageviews, taps, the plan chosen, emails and the time on page into Netlify Blobs, and serves an admin summary whose one measured number is `plan_rate = plan_taps ÷ uniques` for the paid links. No third-party script, pixel or analytics; the CSP forbids them.

## Provenance

The instrument (the function, the client script, the sheet mechanics, the visitor-resolution rules and the per-hour summary cache) was copied as files from Restline's reserve page and re-identified for Parakeet; every piece of that page's identity, media, copy and icons was replaced. `tests/previous/summary-v6.mjs` is the frozen summary code as copied, kept as the differential baseline; it is not live code.

## Layout

```
netlify/functions/event.mjs   the one function: POST /api/event, GET /admin
public/                       index.html, styles.css, app.js, privacy.html, terms.html, robots.txt, icons, media/
netlify.toml                  rewrites (/api/*, /admin → the function; /go → 302; /privacy, /terms), headers (CSP)
scripts/                      serve.mjs (local harness), make-placeholder-media.sh, make-test-clip.sh, make-icons.mjs
tests/unit                    the function and the summary (node --test, no browser)
tests/static                  netlify.toml, public/, repo checks (node --test)
tests/e2e                     Playwright against the harness (tests/helpers/harness.mjs)
DESIGN.md, CREDITS.md         the design rulebook and the image source log
ACCEPTANCE.md                 the device checklist, the tag table, the read
HOURS.md                      time spent
```

## Scripts

```sh
npm ci                  # installs @netlify/blobs and playwright 1.56.1 (no browser download: never run `playwright install` here)
npm test                # unit + static tests
npm run test:e2e        # Playwright e2e in Chromium (iPhone viewport) against the local harness
npm run check           # both
npm run serve           # the harness on http://localhost:8788 with an in-memory store (PORT, ADMIN_KEY env; Ctrl-C prints the rows)
```

The e2e needs a Playwright Chromium matching 1.56.1 at `PLAYWRIGHT_BROWSERS_PATH` (or the default cache). The Playwright runner, config `playwright.config.mjs`, writes the acceptance screenshots (at 375×667 and 393×852: the first screen, the page scrolled to the footer, the plan sheet, the email step and both done states) to `test-results/screenshots/` (ignored by git; Playwright empties `test-results/` when a run starts).

## Deploy

Netlify site `tryparakeet` → `https://tryparakeet.netlify.app`, production branch `main`, no custom domain. `netlify.toml` sets `publish = "public"`, the functions dir, esbuild, Node 22 and `NPM_FLAGS = "--omit=dev"` (Playwright is never installed on Netlify). If the site name is taken, pick another and change `SITE_ORIGINS` in `netlify/functions/event.mjs` (one line); branch and deploy-preview URLs are allowed through `URL` / `DEPLOY_PRIME_URL` / `DEPLOY_URL`.

### ADMIN_KEY

The admin read needs the environment variable `ADMIN_KEY` in Netlify's site settings (Site configuration → Environment variables), e.g. `openssl rand -hex 24`. It is never in the repo. Without it `/admin` answers 503; with a wrong key 401.

Admin URL pattern:

```
https://tryparakeet.netlify.app/admin?key=KEY                                   summary JSON (all days; version, gate_start, partial, pending, days[], total, emails[])
https://tryparakeet.netlify.app/admin?key=KEY&format=csv                        summary as CSV
https://tryparakeet.netlify.app/admin?key=KEY&table=emails&format=csv           the email table
https://tryparakeet.netlify.app/admin?key=KEY&table=raw&day=2026-10-25&format=csv   every row of one UTC day
```

`day=`, `from=`, `to=` limit the days reported (UTC); the read uses none of them. Check `partial: false` and `pending: []` first; if not, read again a minute later.

## Images

Hero B has no clip. The first screen's images are under `public/media/` (served immutable for a year, so a changed image gets a new name): `iphone-bezel-v1.webp` is Apple's product bezel converted losslessly from the 672×1371 PNG (pixels untouched; never cropped, faded, shadowed or overlapped, DESIGN.md §7), and `dish-quesadillas-480.webp` / `dish-wraps-480.webp` are the cards' photos (sources in `CREDITS.md`). The bird is inline SVG (`currentColor`). The old placeholder walkthrough (`walkthrough-v1.mp4` and its poster, `scripts/make-placeholder-media.sh`) is no longer referenced by the page.

## Icons

`public/favicon.svg`, `favicon.ico` and `public/assets/*.png` are a **placeholder** for Gate 0: a sky-blue rounded square with a near-black "P", made by `scripts/make-icons.mjs`. Not the identity; the bird replaces it later.

## Node

Netlify builds the function on Node 22 (`NODE_VERSION = "22"` in `netlify.toml`). `package.json` says `engines.node >= 20`, but `@netlify/blobs` 11.1.4 declares `node >= 22.12`, so run the tests on Node 22.12 or later; Node 22.22 is what this was built and tested on.

## Known limits

- The visitor's user agent is stored on the pageview cut to 400 characters (`UA_MAX` in `event.mjs`, `ua.slice(0, 400)` in `app.js`; the two must agree), and the bot rule is applied to the stored string at read. The cap is set so the real in-app strings stay whole (TikTok iOS about 280 characters, TikTok Android about 360, with `BytedanceWebview` near the end) and Google's documented Googlebot-smartphone string (200 characters, `Googlebot` at position 153) is caught; the e2e case `exclusions.spec › user agent: googlebot` and the unit cases in `flags.test.mjs` guard it.
- The TikTok in-app regex (`BytedanceWebview|musical_ly|TikTok`) has not run on real traffic; the raw `ua` column is the check. A wrong `inapp` never moves `plan_rate`.
- `total` resolves visitors across every day read (bot > smoke > prestart > gate > no_utm); `days[]` resolves within each UTC day, so a device whose smoke visit was on an earlier day appears under that day's `sources.tiktok` while `total` keeps it in `excluded.smoke`. The read and every own-device check use `total`.
- A press inside the plan sheet during its first 500 ms is dropped and sends no row: the sheet's button and the cards slide in under the spot where "Reserve 2 free weeks" was pressed, so the second half of a double tap would otherwise count as a plan tap. `tests/e2e/flow.spec.mjs` asserts the drop; in-sheet clicks in the e2e await `sheetSettled()`.
- Nothing under `public/` carries a third-party URL, binaries included; an image or clip with encoder metadata naming a URL fails the static test `no http(s) URL inside the binary files`.
