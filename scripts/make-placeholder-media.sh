#!/usr/bin/env bash
# Walkthrough clip + poster for the reserve page (public/media/).
#
# Gate 0 ships a GENERATED placeholder: 720x1280, 8 s, cream background,
# the "Parakeet" wordmark in the upper third (the page's play control sits
# over the centre of the clip) and a sky-blue bar below the centre that
# glides left and right once per loop, so playback visibly differs from the
# poster. It exists so autoplay, the play control and the playing/blocked
# report can be checked on real devices before the real walkthrough arrives.
#
# Usage
#   scripts/make-placeholder-media.sh                      placeholder -> walkthrough-v1.mp4 + walkthrough-v1-poster.jpg
#   scripts/make-placeholder-media.sh encode <clip> <ver>  re-encode a real clip -> walkthrough-<ver>.mp4 + poster
#   scripts/make-placeholder-media.sh poster <clip.mp4>    poster only (frame 0) next to an existing clip
#
# Swapping in the real walkthrough (Umyt's file) as v2:
#   1. scripts/make-placeholder-media.sh encode ~/Downloads/walkthrough.mov v2
#      (scales/pads to 720x1280, H.264 main profile, yuv420p, crf 28, faststart, no audio;
#       the poster is frame 0 of the encoded file, so it always matches the clip)
#   2. in public/index.html change the <video> src to /media/walkthrough-v2.mp4
#      and poster to /media/walkthrough-v2-poster.jpg
#   3. commit both media files and index.html; redeploy.
#   /media/* is served immutable for a year (netlify.toml), which is why the
#   name carries a version instead of overwriting v1. The e2e reads the clip
#   path from index.html, so no test changes.
#
# Encoding settings are the same for every mode: libx264 main profile,
# yuv420p (plays inside every in-app browser), crf 28, +faststart (metadata
# first so autoplay starts before the whole file is down), no audio track
# (muted autoplay never needs one and some in-app browsers refuse autoplay
# with an audio track present), and no encoder metadata: +bitexact drops the
# muxer's encoder tag and the filter_units bitstream filter drops x264's SEI
# (its version string carries a URL), so nothing under public/ holds a
# third-party URL; the static test scans the media files for one.
#
# Needs ffmpeg with libx264 and drawtext. The wordmark is drawn with an Inter
# OTF at generation time only; nothing from the font ships with the page.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=public/media
FONT="${FONT:-/usr/share/fonts/opentype/inter/Inter-SemiBold.otf}"

ENC=(-c:v libx264 -profile:v main -pix_fmt yuv420p -crf 28 -movflags +faststart -an
     -flags +bitexact -fflags +bitexact -bsf:v filter_units=remove_types=6)

poster() {  # poster <clip.mp4>: frame 0 as JPEG next to the clip
  local clip="$1"
  local out="${clip%.mp4}-poster.jpg"
  ffmpeg -y -hide_banner -loglevel error -i "$clip" -frames:v 1 -q:v 4 "$out"
  echo "wrote $out ($(wc -c <"$out") bytes)"
}

case "${1:-placeholder}" in
  placeholder)
    mkdir -p "$OUT"
    clip="$OUT/walkthrough-v1.mp4"
    # 8 s, 30 fps. The bar is a second lavfi input laid over the frame with the
    # overlay filter, whose x expression carries the time (t): it glides
    # left-right once per loop, 150 px each way. (drawbox has no time in its
    # expressions: there `t` is the box thickness.) The wordmark and the label
    # sit in the upper third, clear of the play control the page centres on the
    # clip; the bar at y=900 stays below it.
    ffmpeg -y -hide_banner -loglevel error \
      -f lavfi -i "color=c=0xFBF6EC:s=720x1280:r=30:d=8" \
      -f lavfi -i "color=c=0x4FA8E8:s=220x14:r=30:d=8" \
      -filter_complex "[0]drawtext=fontfile=${FONT}:text='Parakeet':fontcolor=0x141414:fontsize=104:x=(w-text_w)/2:y=300,\
drawtext=fontfile=${FONT}:text='walkthrough placeholder':fontcolor=0x6B6B6B:fontsize=30:x=(w-text_w)/2:y=430[bg];\
[bg][1]overlay=x='(W-w)/2+150*sin(2*PI*t/8)':y=900:shortest=1" \
      "${ENC[@]}" "$clip"
    echo "wrote $clip ($(wc -c <"$clip") bytes)"
    poster "$clip"
    ;;
  encode)
    [ $# -eq 3 ] || { echo "usage: $0 encode <clip> <version, e.g. v2>" >&2; exit 2; }
    mkdir -p "$OUT"
    clip="$OUT/walkthrough-$3.mp4"
    # fit inside 720x1280 keeping the ratio, pad to 9:16 with cream, even dimensions
    ffmpeg -y -hide_banner -loglevel error -i "$2" \
      -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0xFBF6EC,fps=30" \
      "${ENC[@]}" "$clip"
    echo "wrote $clip ($(wc -c <"$clip") bytes)"
    poster "$clip"
    ;;
  poster)
    [ $# -eq 2 ] || { echo "usage: $0 poster <clip.mp4>" >&2; exit 2; }
    poster "$2"
    ;;
  *)
    sed -n '2,20p' "$0" >&2
    exit 2
    ;;
esac
