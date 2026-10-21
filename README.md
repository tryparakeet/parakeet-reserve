# Parakeet reserve page

A one-screen "reserve" page for Gate 0, a seven-day paid-traffic test (Oct 23–29, 2026, read on Oct 30). The page is its own instrument: it gives each visitor an id, records pageviews, taps, the plan chosen, emails, the video's final state and the time on page into Netlify Blobs, and serves an admin summary whose one measured number is `plan_rate = plan_taps ÷ uniques` for the paid links. No third-party script, pixel or analytics; the CSP forbids them.

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
ACCEPTANCE.md                 the device checklist, the tag table, the Oct 30 read
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

The e2e needs a Playwright Chromium matching 1.56.1 at `PLAYWRIGHT_BROWSERS_PATH` (or the default cache). The Playwright runner, config `playwright.config.mjs`, writes the acceptance screenshots (the first screen and the three sheet steps at 375×553 and 375×667) to `test-results/screenshots/` (ignored by git; Playwright empties `test-results/` when a run starts).

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

`day=`, `from=`, `to=` limit the days reported (UTC); the Oct 30 read uses none of them. Check `partial: false` and `pending: []` first; if not, read again a minute later.

## The clip

`public/index.html` plays `/media/walkthrough-v1.mp4` with `/media/walkthrough-v1-poster.jpg`; both are generated placeholders (`scripts/make-placeholder-media.sh`: a wordmark and a sky-blue bar that glides left and right, so playback is told from the poster) so autoplay, the play control and the playing/blocked report can be checked on devices before the real walkthrough exists. The real clip goes in as **`public/media/walkthrough-v2.mp4`** with its poster made by the same script (`scripts/make-placeholder-media.sh encode <file> v2`), and the `src`/`poster` in `index.html` are bumped to `-v2`. `/media/*` is served immutable for a year, hence the version in the name. The e2e reads the clip path from `index.html`.

## Icons

`public/favicon.svg`, `favicon.ico` and `public/assets/*.png` are a **placeholder** for Gate 0: a sky-blue rounded square with a near-black "P", made by `scripts/make-icons.mjs`. Not the identity; the bird replaces it later.

## Node

Netlify builds the function on Node 22 (`NODE_VERSION = "22"` in `netlify.toml`). `package.json` says `engines.node >= 20`, but `@netlify/blobs` 11.1.4 declares `node >= 22.12`, so run the tests on Node 22.12 or later; Node 22.22 is what this was built and tested on.

## Known limits

- The visitor's user agent is stored on the pageview cut to 400 characters (`UA_MAX` in `event.mjs`, `ua.slice(0, 400)` in `app.js`; the two must agree), and the bot rule is applied to the stored string at read. The cap is set so the real in-app strings stay whole (TikTok iOS about 280 characters, TikTok Android about 360, with `BytedanceWebview` near the end) and Google's documented Googlebot-smartphone string (200 characters, `Googlebot` at position 153) is caught; the e2e case `exclusions.spec › user agent: googlebot` and the unit cases in `flags.test.mjs` guard it.
- The TikTok in-app regex (`BytedanceWebview|musical_ly|TikTok`) has not run on real traffic; the raw `ua` column is the check. A wrong `inapp` never moves `plan_rate`.
- `total` resolves visitors across every day read (bot > smoke > prestart > gate > no_utm); `days[]` resolves within each UTC day, so a device whose smoke visit was on an earlier day appears under that day's `sources.tiktok` while `total` keeps it in `excluded.smoke`. The Oct 30 read and every own-device check use `total`.
- A press inside the plan sheet during its first 500 ms is dropped and sends no row: the sheet's button and the cards slide in under the spot where "Reserve 2 free weeks" was pressed, so the second half of a double tap would otherwise count as a plan tap. `tests/e2e/flow.spec.mjs` asserts the drop; in-sheet clicks in the e2e await `sheetSettled()`.
- The media files are encoded without encoder metadata (`scripts/make-placeholder-media.sh`), so nothing under `public/` carries a third-party URL; a clip encoded elsewhere fails the static test `no http(s) URL inside the binary files`.
