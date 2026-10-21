#!/usr/bin/env bash
# VP9 WebM test clip for the Playwright e2e (tests/fixtures/clip-test.webm).
#
# Playwright's Chromium has no H.264 decoder, so the "video playing" case
# serves this WebM under the page's .mp4 URL (page.route, content-type
# video/webm) and the real clip is never needed in CI. 180x320 (9:16, like
# the page), 2.5 s, cream with a moving sky-blue bar; tiny on purpose.
#
# Usage: scripts/make-test-clip.sh      (needs ffmpeg with libvpx-vp9)
# Regenerate only if the fixture is lost; the file is committed.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=tests/fixtures/clip-test.webm
mkdir -p "$(dirname "$OUT")"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=0xFBF6EC:s=180x320:r=24:d=2.5" \
  -vf "drawbox=x='(iw-60)/2+40*sin(2*PI*t/2.5)':y=190:w=60:h=6:color=0x4FA8E8:t=fill" \
  -c:v libvpx-vp9 -b:v 0 -crf 40 -pix_fmt yuv420p -an \
  "$OUT"
echo "wrote $OUT ($(wc -c <"$OUT") bytes)"
