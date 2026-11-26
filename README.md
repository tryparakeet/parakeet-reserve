# Parakeet reserve page

A one-screen "reserve" page for Gate 0, a seven-day paid-traffic test: day 1 is the day video 1 goes up with the paid link (target Mon Oct 26, 2026, or Sat Oct 24 / Sun Oct 25 if everything is ready sooner), the window is day 1 → day 7, and the read is the morning after day 7 (Mon Nov 2 on a Monday start, Sat Oct 31 on a Saturday, Sun Nov 1 on a Sunday), its file named for its day. `GATE_START` in `netlify/functions/event.mjs` is Sat Oct 24, 00:00 CDT (`2026-10-24T05:00:00.000Z`), the earliest possible day 1: every visit received before it resolves to `excluded.prestart` at read, and the per-hour summary cache rebuilds by itself when it changes. Raw days are UTC: CDT evening rows after 7 pm land on the next UTC day (after 6 pm once Dallas leaves CDT on Sun Nov 1 at 2 am). From Sat Oct 24, 00:00 CDT, every test visit opens the smoke link first in that same browser (see ACCEPTANCE.md).

The page is built against `DESIGN.md` (the design rulebook; image sources in `CREDITS.md`): the website's new look (parakeet-app's `docs/SITE-04-THE-NEW-SITE.md`), a first screen of tiles with Apple's iPhone bezel, and the tiles below it. The page is its own instrument: it gives each visitor an id, records pageviews, taps, the plan chosen, emails and the time on page into Netlify Blobs, and serves an admin summary whose one measured number is `plan_rate = plan_taps ÷ uniques` for the paid links. No third-party script, pixel or analytics; the CSP forbids them.

## Provenance

The instrument (the function, the client script, the sheet mechanics, the visitor-resolution rules and the per-hour summary cache) was copied as files from Restline's reserve page and re-identified for Parakeet; every piece of that page's identity, media, copy and icons was replaced. `tests/previous/summary-v6.mjs` is the frozen summary code as copied, kept as the differential baseline; it is not live code.

## Layout

```
netlify/functions/event.mjs         Gate 0's function: POST /api/event, GET /admin
netlify/functions/beacon.mjs        the app's beacon: POST /beacon, GET /admin/app (SITE-01; see "The app's beacon" below)
netlify/functions/beacon-prune.mjs  deletes the beacon's rows and summaries once 2 years old, daily (scheduled, no route)
netlify/functions/zip3-states.json  the ZIP3-to-state table the beacon's read uses, from USPS's prefix ranges
public/                             index.html, styles.css, app.js, privacy.html, terms.html, support.html, robots.txt, icons, media/
netlify.toml                        rewrites (/beacon, /admin/app → beacon; /api/*, /admin → event; /go → 302; /privacy, /terms, /support), headers (CSP)
scripts/                            serve.mjs (local harness), make-site-images.sh, make-placeholder-media.sh, make-test-clip.sh, make-icons.mjs
tests/unit                          the functions and their summaries (node --test, no browser)
tests/static                        netlify.toml, public/, repo checks (node --test)
tests/e2e                           Playwright against the harness (tests/helpers/harness.mjs)
DESIGN.md, CREDITS.md               the design rulebook and the image source log
ACCEPTANCE.md                       the device checklist, the tag table, the read
HOURS.md                            time spent
```

## Scripts

```sh
npm ci                  # installs @netlify/blobs and playwright 1.56.1 (no browser download: never run `playwright install` here)
npm test                # unit + static tests
npm run test:e2e        # Playwright e2e in Chromium (iPhone viewport) against the local harness
npm run check           # both
npm run serve           # the harness on http://localhost:8788 with an in-memory store (PORT, ADMIN_KEY, BEACON_KEY env; Ctrl-C prints the rows)
```

The e2e needs a Playwright Chromium matching 1.56.1 at `PLAYWRIGHT_BROWSERS_PATH` (or the default cache). The Playwright runner's config is `playwright.config.mjs`. SITE-04 §6.6's shots come from `tests/e2e/shots.spec.mjs`, which a later commit adds; it writes them to `test-results/screenshots/` (ignored by git; Playwright empties `test-results/` when a run starts).

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

An Android phone gets one button, "Email me when it's on Android" (parakeet-app's `docs/SITE-03-ANDROID-LIST.md`), and the summary (version 8) counts it apart from the reserves. Its tap is `android_taps` (visitors) and `tap_events_android` (rows), beside the reserve taps and never in them or in the plan taps; like every button it is in `taps` and `tap_events`. Its email carries plan `android`: `emails` and `email_events` count the reservation emails only, and the Android ones sit beside them as `android_emails` and `email_events_android`. The summary CSV has the same columns; its bare `android` column is still the device (pageviews from Android phones). The email table (`table=emails`) and the summary's `emails[]` list every address with its plan, so the Android ones are the rows with plan `android`.

## The app's beacon

Built from parakeet-app's `docs/SITE-01-BEACON.md` against its contract, `docs/BEACON.md` (a change to the notes goes there first). The app sends `POST /beacon` with its notes; `GET /admin/app?key=ADMIN_KEY` is Umyt's read. The Gate 0 function and its rows are untouched.

Settings in Netlify (Site configuration → Environment variables), never in the repo:

- `BEACON_KEY`: the same 32 letters and digits as the app's `EXPO_PUBLIC_BEACON_KEY`. Without it `/beacon` answers 503 and the app keeps its notes for later; with a wrong `x-beacon-key` header, 401.
- `LAUNCH_AT`: empty until launch day, then that day's start in ISO 8601, e.g. `2027-01-12T00:00:00-06:00`. An install first seen before it is a test install, and it stays under `before_launch` for good, its later rows included. While it is empty every install is there. A value that isn't a date makes the read answer 503.
- `ADMIN_KEY`: the same as Gate 0's.

What `/beacon` keeps: each note that passes BEACON.md §3 becomes one row in the Blobs store `app-events` (the install, build, version, name, `at`, props and the time it arrived; never an IP address or a user agent). A note with an unknown name or prop, a missing prop or a value §3 doesn't allow is dropped, as is one whose `at` is more than 90 days back or 1 day ahead; the batch still answers 204, and the function's log says why, by reason, note and prop, never a value. A body over 64 KB or 200 notes, an install that isn't a lowercase UUID or a build that isn't `release` or `dev` is a 400. At most 2,000 notes per install per UTC day are kept (counters in `app-caps`, deleted after 2 days).

The read: `https://tryparakeet.netlify.app/admin/app?key=KEY` gives JSON with `launch`, `before_launch` and `dev` (dev rows are only counted: rows, installs, rows by name). `launch` and `before_launch` have the same parts:

- `installs`, `rows` and `by_name` (rows by note name; a batch the app sent twice counts twice here, and once everywhere else).
- `social_proof`: `weeks_planned` (each install's week once), `dinners_cooked` (each install, week and night whose last mark is cooked), `shelf_prices_checked`, `groceries_planned_dollars` (each week's last total, added up), `people_who_built_a_week`, `states` (`count` of the 50 states, `by_state` with DC, territories and military mail listed apart, `unmatched`), `likes` (installs whose last thumb on a dinner is up).
- `funnel`: by the Monday (UTC) of each install's first open: `opened`, `setup_done`, `week_built`, `list_opened`, `dinner_cooked`, `second_week_built`, and `onboarding_pages` (installs that reached each page).
- `goals`: `price_typed_within_14_days` and `dinner_cooked_within_7_days` as `reached` `of` the installs whose 14 or 7 days are over, with the `rate`; `paywall` (`seen`, `free_week_started`, `subscribed`); `weeks_built_by_week` for weeks 1 to 8 after the first open (`of` the installs that lived through that week, `built` how many built a week in it, `weeks` how many weeks); `installs_by_chain` (each install's latest); `dinners` (`swapped_away`, `hidden`, `thumbs_down`, per dinner; thumbs down are never shown in public).

Check `partial: false` and `pending: []` first; if not, read again a minute later. Each closed hour is summed once into `app-summaries`, and a closed day's hours are folded into one day summary, so a read reads raw rows only for the hours still open. A summary keeps facts per install id, so `beacon-prune.mjs` deletes the summaries with the rows once they are 2 years old, every day at midnight UTC, and the read leaves out any older day. The privacy page says so.

Known limits: an hour holding more notes than one read can fetch (about 8,000) never sums whole, so the read stays partial; each read loads every day summary kept, which is fine for the first months and would want a monthly rollup at tens of thousands of installs a day.

## Images

The page has no clip. Its images are under `public/media/` (served immutable for a year, so a changed image gets a new name; sources in `CREDITS.md`): `iphone-bezel-v1.webp` is Apple's product bezel converted losslessly from the 672×1371 PNG (pixels untouched; never cropped, faded, shadowed or overlapped, DESIGN.md §7), the phone in every picture. `icon-v1-<px>.webp` is the logo, the app's icon made small for 28, 30 and 34 px, each at 1x, 2x and 3x (28/56/84, 30/60/90, 34/68/102), in one `srcset`; the CSS rounds its corners at 22.37%. The phone's six screens, `screen-<name>-placeholder-420.webp` and `-640.webp` (nights, budget, week, list, total and yours: the nights question, the budget question, the week, the list, the total card and a price typed in), are placeholders, plain cream with the screen's name, until build 2's screens come (SITE-04 §6.7). `scripts/make-site-images.sh` makes the icon's sizes (`icon`), the placeholders (`placeholders`) and, from build 2's PNGs, the real stills (`stills`). The bird and the wordmark are inline SVG (`currentColor`). The old placeholder walkthrough (`walkthrough-v1.mp4` and its poster, `scripts/make-placeholder-media.sh`) is no longer referenced by the page.

## Icons

`public/favicon.svg`, `favicon.ico` and `public/assets/*.png` are the app icon (DESIGN.md §7: the head close up, white on sky), made by `scripts/make-icons.mjs` from `scripts/parakeet-icon.svg`, a byte-for-byte copy of parakeet-app's `docs/brand/parakeet-icon.svg` used as it is: rounded at 32 px and in `favicon.svg`, full bleed at 180 px. When the app icon changes, copy the new file over it, run the script and raise the `?v=` on the icon links in the four pages (`/assets/` is cached for a year).

## Node

Netlify builds the function on Node 22 (`NODE_VERSION = "22"` in `netlify.toml`). `package.json` says `engines.node >= 20`, but `@netlify/blobs` 11.1.4 declares `node >= 22.12`, so run the tests on Node 22.12 or later; Node 22.22 is what this was built and tested on.

## Known limits

- The visitor's user agent is stored on the pageview cut to 400 characters (`UA_MAX` in `event.mjs`, `ua.slice(0, 400)` in `app.js`; the two must agree), and the bot rule is applied to the stored string at read. The cap is set so the real in-app strings stay whole (TikTok iOS about 280 characters, TikTok Android about 360, with `BytedanceWebview` near the end) and Google's documented Googlebot-smartphone string (200 characters, `Googlebot` at position 153) is caught; the e2e case `exclusions.spec › user agent: googlebot` and the unit cases in `flags.test.mjs` guard it.
- The TikTok in-app regex (`BytedanceWebview|musical_ly|TikTok`) has not run on real traffic; the raw `ua` column is the check. A wrong `inapp` never moves `plan_rate`.
- `total` resolves visitors across every day read (bot > smoke > prestart > gate > no_utm); `days[]` resolves within each UTC day, so a device whose smoke visit was on an earlier day appears under that day's `sources.tiktok` while `total` keeps it in `excluded.smoke`. The read and every own-device check use `total`.
- A press inside the plan sheet during its first 500 ms is dropped and sends no row: the sheet's button and the cards slide in under the spot where "Reserve 2 free weeks" was pressed, so the second half of a double tap would otherwise count as a plan tap. `tests/e2e/flow.spec.mjs` asserts the drop; in-sheet clicks in the e2e await `sheetSettled()`.
- Nothing under `public/` carries a third-party URL, binaries included, except Support's one link to `https://reportaproblem.apple.com` (a link a visitor follows; the page loads nothing from it); an image or clip with encoder metadata naming a URL fails the static test `no http(s) URL inside the binary files`.
