# Acceptance: Parakeet reserve page, Gate 0

Everything on this page happens before Gate 0 starts, or on the first morning. Work through it in order; fill the device cells by hand. Rows marked **verified in e2e** are checked by the Playwright suite against the local harness (`npm run test:e2e`) and still need the device cell.

## Facts

| | |
|---|---|
| Site | `https://tryparakeet.netlify.app` (Netlify site `tryparakeet`, production branch `main`, no custom domain) |
| Admin | `https://tryparakeet.netlify.app/admin?key=KEY` — `KEY` is the `ADMIN_KEY` environment variable in Netlify's site settings; it is never written in this repo, in a chat, or in a screenshot |
| GATE_START | `2026-10-23T05:00:00.000Z` = **Thu Oct 23, 00:00 CDT**. A visitor whose first tagged pageview was received before it is `excluded.prestart` for good |
| Window | Oct 23–29 CDT, read on Oct 30 |
| Raw days are UTC | `days[]` and `table=raw&day=` are UTC days. Oct 29 CDT evening (after 7 pm) lands in `2026-10-30`; the read with no day params covers everything |
| The number | `total.sources.tiktok.plan_rate` = `plan_taps ÷ uniques` for the paid links |

## Tags

Seven paid links, one per day. `utm_content` is the day the creative goes up; it is what `sources.tiktok.content.<day>` splits on.

| Day | Link |
|---|---|
| Fri Oct 23 | `https://tryparakeet.netlify.app/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=fri23` |
| Sat Oct 24 | `https://tryparakeet.netlify.app/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=sat24` |
| Sun Oct 25 | `https://tryparakeet.netlify.app/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=sun25` |
| Mon Oct 26 | `https://tryparakeet.netlify.app/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=mon26` |
| Tue Oct 27 | `https://tryparakeet.netlify.app/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=tue27` |
| Wed Oct 28 | `https://tryparakeet.netlify.app/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=wed28` |
| Thu Oct 29 | `https://tryparakeet.netlify.app/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=thu29` |

| Purpose | Link |
|---|---|
| Typed (end card, said out loud) | `https://tryparakeet.netlify.app/go` → 302 to `/?utm_source=typed&utm_medium=organic&utm_campaign=gate0&utm_content=endcard` |
| Smoke (our own devices) | `https://tryparakeet.netlify.app/?utm_source=own&utm_campaign=smoke` — **once per device AND per app browser** (TikTok's browser, Instagram's browser and Safari each keep their own cookie jar) |

## Laptop checks (curl)

Run after the first deploy with `ADMIN_KEY` set. Every line names what to see.

```sh
S=https://tryparakeet.netlify.app

# the CSP on a static page: connect-src 'self', nothing third-party
curl -sI "$S/" | grep -i content-security-policy
curl -sI "$S/privacy" | grep -i content-security-policy

# /go: 302 with the exact Location, the request's own query dropped, trailing slash too
curl -sI "$S/go"      | grep -iE '^(HTTP|location)'
curl -sI "$S/go?x=1"  | grep -iE '^(HTTP|location)'
curl -sI "$S/go/"     | grep -iE '^(HTTP|location)'
#   expect: HTTP/2 302  and  location: /?utm_source=typed&utm_medium=organic&utm_campaign=gate0&utm_content=endcard

# admin: 401 with a wrong key
curl -s -o /dev/null -w '%{http_code}\n' "$S/admin?key=wrong"          # 401
# 503 before ADMIN_KEY is set, then 200 (the empty summary: version 7, gate_start, days [])
curl -s -o /dev/null -w '%{http_code}\n' "$S/admin?key=$KEY"           # 503 on the first deploy, 200 after the env var + redeploy
curl -s "$S/admin?key=$KEY" | head -20

# the function refuses a foreign origin
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$S/api/event" -H 'origin: https://evil.example' \
  -H 'content-type: application/json' -d '{"event":"pageview","vid":"abcdefghijklmnopqrstuvwx"}'   # 403

# the deleted event is a 400
curl -s -w '\n%{http_code}\n' -X POST "$S/api/event" -H 'content-type: application/json' \
  -d '{"event":"answer","vid":"abcdefghijklmnopqrstuvwx","answer":"x"}'                          # {"error":"bad event"} 400

# the cookie is re-set for 90 days (this row is a smoke row, so it never counts)
curl -si -X POST "$S/api/event" -H 'content-type: application/json' \
  -d '{"event":"pageview","vid":"abcdefghijklmnopqrstuvwx","utm_source":"own","utm_campaign":"smoke"}' | grep -i set-cookie
#   expect: set-cookie: pk_v=abcdefghijklmnopqrstuvwx; Max-Age=7776000; Path=/; SameSite=Lax; Secure
```

The first smoke row shows under `days[]` of the summary within a minute; that also confirms the live Blobs directory listing format.

## Device matrix

Open the **smoke link first** in each browser (see the timing rule), then the checks below in that same browser. The viewport cannot be measured from inside the apps: note the device model and whether the browser's toolbars were showing; the pageview's `scr` column in the raw CSV gives the screen size.

Columns: **A** iPhone, TikTok's in-app browser · **B** iPhone, Safari · **C** Android, TikTok's in-app browser. Write the result, or a short note, in each cell. The Harness column names the spec that checks the row against the local harness; it refers to the e2e suite as committed with this file (`git log -1 --format=%h -- tests/e2e` prints that commit).

| # | Check | Harness | A | B | C |
|---|---|---|---|---|---|
| 1 | The smoke link opens; the first smoke visit shows in `/admin` under `total.excluded.smoke.uniques` and in `days[]` | verified in e2e (exclusions.spec) | | | |
| 2 | The whole first screen fits with **no scrolling**: wordmark, H1, line, clip, three facts, fixed button all visible at once (note the model and whether the toolbars were showing) | verified in e2e at 375×553, 375×617, 375×667, 393×659, 360×640 (first-screen.spec) | | | |
| 3 | Clip box visible, 9:16, the **play button tappable** (not hidden under the fixed button) | verified in e2e (first-screen.spec; clip ≤ 40 % of the viewport, ≥ 80 px) | | | |
| 4 | The clip autoplays muted; `video.playing 1` for the visitor in `/admin` (`excluded.smoke`) | verified in e2e with the VP9 test clip (video.spec) | | | |
| 5 | Tapping the play button when the clip is not playing sends `tap play` and starts it | verified in e2e (video.spec: the tap precedes any video state) | | | |
| 6 | The cookie survives a second visit: close the page, reopen the smoke link, `uniques` stays 1 in `excluded.smoke` | verified in e2e (cookie.spec) | | | |
| 7 | "Reserve 2 free weeks" opens the plan sheet at step 1; `reserve_taps 1`, `seen 1` | verified in e2e (flow.spec) | | | |
| 8 | Yearly is preselected; tapping Monthly flips the check; `plan_monthly_taps 1`, `via card` in the raw CSV | verified in e2e (flow.spec) | | | |
| 9 | "Hold my spot" with no card tapped records the preselected plan (`via hold`), opens the email step, the **keyboard opens** and the sheet's button stays above it | verified in e2e (flow.spec; keyboard proxy in first-screen.spec) | | | |
| 10 | A bad email shakes and shows the invalid border; a good one goes to "You're on the list."; `emails 1` with `plan` | verified in e2e (flow.spec) | | | |
| 11 | Done closes the sheet; the × and the backdrop close it; the page behind did not scroll | verified in e2e (flow.spec, first-screen.spec) | | | |
| 12 | Closing the in-app browser (the ×) sends the leave: `leave.n 1`, `avg_seconds` about the time on the page | verified in e2e (flow.spec: visibilitychange + pagehide) | | | |
| 13 | **Blocked video** (procedure below): poster + play button shown, `video.blocked 1` after leaving, `video.playing 0` | verified in e2e (video.spec: clip URL 404) | | | |
| 14 | The raw CSV row of the pageview carries the real `ua`, `device` (`ios`/`android`) and `inapp` (`tiktok` inside TikTok, `none` in Safari) | verified in e2e for `safari_ios`, `tiktok_ios`, `instagram_ios` user agents (exclusions.spec) | | | |
| 15 | `/privacy` and `/terms` open from the footer and link back | verified in e2e (routes.spec) | | | |
| 16 | The typed link `/go` lands on the page with the typed tags (`sources.typed.content.endcard`) — do this in a browser that already has the smoke cookie | verified in e2e (routes.spec) | | | |
| 17 | TikTok's Promote link check (the `Bulid/` user agent) and Meta's link check (`Instagram <digits>` + 2000×2000) land in `excluded.bot` | verified in e2e for every fixture user agent (Google's documented Googlebot string included: the stored `ua` is capped at 400 characters, see the README's Known limits), `navigator.webdriver` and the 2000×2000 screen (exclusions.spec) | | | |
| 18 | A **double tap** on "Reserve 2 free weeks" opens the sheet at step 1 and nothing else: no plan row, `plan_taps` stays 0 until a card or "Hold my spot" is pressed on purpose (presses inside the sheet in its first half second are dropped, because the sheet's button slides in under the same spot) | verified in e2e (flow.spec: touch taps 60, 250 and 400 ms apart, and a dblclick) | | | |

### Where to look

Summary: `GET /admin?key=KEY` (JSON). Per bucket: `total.sources.tiktok`, `total.sources.typed`, `total.blended`, `total.excluded.{smoke,no_utm,bot,prestart}`; each has `uniques, reserve_taps, plan_taps, plan_yearly_taps, plan_monthly_taps, plan_rate, play_taps, emails, pageviews, seen, video {playing, blocked, both}, video_events, leave {n, avg_seconds}, device, inapp`; `sources.<source>.content.<creative>` repeats the shape per creative. `days[]` has the same per UTC day. `emails[]` lists the addresses with the plan.

Rows: `GET /admin?key=KEY&table=raw&day=YYYY-MM-DD&format=csv` (one row per event; columns `received, event, vid, flag, ts, utm_*, device, inapp, ref, button, via, email, plan, video, seconds, ua, wd, scr`). Emails: `&table=emails&format=csv`. Summary as CSV: `&format=csv`.

Your own device's rows are under `excluded.smoke` (the whole visitor moves there at read), which is why every device check reads that bucket, never `sources.tiktok`.

Read **`total`** for every own-device check and for the number: exclusion is complete only there, where a visitor is resolved across every day read. `days[]` resolves within each UTC day, so a device whose smoke visit was on an earlier day shows under that day's `sources.tiktok` (and in the per-day lines of the summary CSV) while `total` keeps it in `excluded.smoke`.

### Blocked video, how to produce it

Primary: iPhone → Settings → Battery → **Low Power Mode on**. Safari and the in-app browsers then refuse autoplay: the poster and the play button stay, no `video playing` row; leave the page (close the browser tab or the in-app browser) → one `leave` row with `video blocked` → `video.blocked 1`. Then come back, tap the play button → `tap play` and `video playing`; the visitor ends in `video.both`.

Secondary: airplane mode after the page has loaded but before the clip has (open the link, switch airplane mode on within a second): the clip fails, the poster stays, the leave carries `blocked`.

### The timing rule

**Every test visit happens before GATE_START, or the smoke link is opened first in that same browser.** The function flags a visitor at write and resolves it at read in the order bot > smoke > prestart > gate > no_utm: a tagged test visit *after* the start from a device and browser that never opened the smoke link is gate traffic for good and moves `plan_rate`.

- Before the start (any time up to Oct 23 00:00 CDT): tagged visits are `excluded.prestart`; smoke visits are `excluded.smoke`. Either way they never count. Test freely, but open the smoke link anyway, so the cookie that outlives the start is a smoke cookie.
- The Promote-redirect check (does TikTok's link open the page with the tags?): use a **smoke-tagged** preview link before the start (`?utm_source=own&utm_campaign=smoke&utm_content=promote`), never a paid link.
- The live tagged check is the **first thing on the morning of Oct 23**, from a device that opened the smoke link before: open the day's paid link, confirm `total.excluded.smoke.pageviews` went up by one while `total.sources.tiktok` did not, and that the raw CSV row carries `utm_content fri23` (the row is stored with its tags and flag `gate`; the visitor is resolved smoke at read in `total`; that day's `days[]` entry shows it under `sources.tiktok`, see Where to look), then stop.

### The Oct 30 read

1. `curl -s "https://tryparakeet.netlify.app/admin?key=$KEY" > ~/gate0/gate0-2026-10-30.json` — **outside the repo**: the JSON carries the emails and the repo is public. No `day`/`from`/`to` params: the pre-start exclusion needs every day, and per-day uniques must never be summed.
2. Check `partial` is `false` and `pending` is `[]`. If not (the 8 s budget ran out on cold hours), call again a minute later; the closed hours are cached after the first read, so the second call is fast and complete.
3. The bar: `total.sources.tiktok.uniques` and `.plan_taps` → `.plan_rate`.
4. Beside it: `total.sources.typed` (the end card), `total.blended` (everything tagged, once per visitor), `total.excluded.{smoke,no_utm,bot,prestart}` (what was kept out, with its own counts), and `total.sources.tiktok.content.<day>` per creative.
5. A row missing within a minute of a visit is lag; re-read. A count that changed after a `SUMMARY_VERSION` bump is a rebuilt cache, not new traffic.

```sh
jq '{partial, pending, generated,
     tiktok:   (.total.sources.tiktok // {} | {uniques, plan_taps, plan_yearly_taps, plan_monthly_taps, plan_rate, reserve_taps, emails, pageviews, video}),
     creatives:(.total.sources.tiktok.content // {} | map_values({uniques, plan_taps, plan_rate})),
     typed:    (.total.sources.typed // {}  | {uniques, plan_taps, plan_rate}),
     blended:  (.total.blended | {uniques, plan_taps, plan_rate}),
     excluded: (.total.excluded | map_values({uniques, plan_taps}))}' ~/gate0/gate0-2026-10-30.json
```

Then `&table=emails&format=csv` → `parakeet-emails.csv`, saved next to the JSON, outside the repo.

### The clip swap

The placeholder is `public/media/walkthrough-v1.mp4` + `walkthrough-v1-poster.jpg`. When the real walkthrough arrives: `scripts/make-placeholder-media.sh encode <file> v2` writes `walkthrough-v2.mp4` and its poster (frame 0 of the encoded clip); change the `<video>` `src` and `poster` in `public/index.html` to the `-v2` names; commit and redeploy. `/media/*` is cached immutable for a year, which is why the name is versioned rather than overwritten. The e2e reads the clip path from `index.html`, so no test changes; run `npm run test:e2e` once after the swap and repeat matrix rows 3–5 and 13 on one phone.
