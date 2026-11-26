#!/usr/bin/env bash
# The site's pictures (SITE-04), written to public/media/: the logo's icon and the phone's six screens.
#
# Usage
#   scripts/make-site-images.sh icon <icon.png> [ver]      the app's icon -> icon-<ver>-<px>.webp (ver: v1)
#   scripts/make-site-images.sh placeholders               six placeholder screens -> screen-<name>-placeholder-<w>.webp
#   scripts/make-site-images.sh stills <folder> <ver>      build 2's screens -> screen-<name>-<ver>-<w>.webp
#
# /media/* is served immutable for a year (netlify.toml), so a changed picture gets a new name: every mode
# stops rather than overwrite a file that is there (FORCE=1 remakes one that has never shipped).
#
# The icon (SITE-04 §6.1): parakeet-app's assets/icon.png (1024 x 1024, the bird's head on sky), made small
# for the logo at 28, 30 and 34 px, each at 1x, 2x and 3x: icon-v1-28/56/84, -30/60/90 and -34/68/102.webp,
# named by their pixel size, so one srcset with w descriptors serves all three logo sizes:
#   <img src="/media/icon-v1-30.webp" srcset="/media/icon-v1-28.webp 28w, /media/icon-v1-30.webp 30w, ...,
#        /media/icon-v1-102.webp 102w" sizes="(min-width: 900px) 34px, (min-width: 390px) 30px, 28px"
#        width="30" height="30" alt="">
# (or, for one fixed size, x descriptors: icon-v1-30.webp 1x, icon-v1-60.webp 2x, icon-v1-90.webp 3x).
# Each is the area average of the big icon (no ringing, so every pixel stays between its two colours), its
# colours snapped to 32 steps between the icon's two colours (both kept exactly: the sky is #4FA8E8), then
# lossless WebP: 0.2-0.6 KB each, about half a lossless PNG. An icon with more than two colours skips the
# snapping. The corners stay square in the file; the page rounds them with CSS (border-radius: 22.37%).
#
# The screens (SITE-04 §6.7): the nights question, the budget question, the week, the list, the total card
# and a list row priced "yours", named nights, budget, week, list, total and yours. Each is made 420 and 640
# wide, about twice the screen box it fills (the box is 90.69% of the phone's width; the phones are 151-256
# wide on a phone and up to 343 on a computer or an iPad), at 393 x 852's aspect: 420 x 911 and 640 x 1387.
# Lossy WebP at quality Q (80), method 6, with no alpha: ImageMagick resizes (Lanczos), ffmpeg's libwebp encodes.
#   <img src="/media/screen-week-v1-420.webp" srcset="/media/screen-week-v1-420.webp 420w,
#        /media/screen-week-v1-640.webp 640w" sizes="..." width="420" height="911" alt="">
#
#   placeholders: until build 2's screens come, a plain cream (#FBF6EC) screen with the screen's name in ink
#     and "Placeholder" under it, in Inter at generation time only (ffmpeg drawtext; no font ships). They are
#     drawn as 1179 x 2556 PNGs (393 x 852 at 3x) and then go through the stills mode below, so making them
#     tests that mode. Their names carry "placeholder" instead of a version: they never ship (the PR waits
#     for build 2), and the static test that no placeholder is referenced matches /media/screen-*-placeholder-*.
#
#   stills: build 2's real screens. Claude Code on Umyt's Mac commits them to parakeet-app's
#     docs/screens/site/ as PNGs at 393 x 852 points; ask for the simulator's own 1179 x 2556 pixels (the
#     640 still needs more than 393 px). Name them nights.png, budget.png, week.png, list.png, total.png and
#     yours.png in one folder (copy or rename them first if build 2 named them otherwise), then:
#       scripts/make-site-images.sh stills ../parakeet-app/docs/screens/site v1
#     which writes screen-<name>-v1-420.webp and -640.webp for all six. A later set takes v2, and so on.
#     A PNG with a colour profile other than sRGB (the simulator may tag Display P3) is converted to sRGB
#     first, with SRGB_ICC (macOS's own sRGB profile by default). Then change the names in the pages, add the
#     set to CREDITS.md and run npm test (tests/static/images.test.mjs checks the sizes and the metadata).
#
# Every file is written with no metadata: no EXIF, XMP or ICC profile, nothing but the image chunk, so no
# third-party URL lands in public/ (tests/static/public.test.mjs scans the bytes of every binary for one).
#
# Needs ImageMagick (magick, or convert for 6.x) with WebP, ffmpeg with libwebp for the screens, and for
# placeholders ffmpeg's drawtext with two Inter OTFs: FONT (SemiBold, the name) and FONT_REGULAR (Regular,
# the "Placeholder" line). Temporary files go in a folder under TMPDIR, removed on exit.
set -euo pipefail

HERE="$PWD"                                     # paths given on the command line are read from here
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/.."
abs() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s' "$HERE/$1" ;; esac; }
OUT=public/media
Q="${Q:-80}"
FONT="${FONT:-/usr/share/fonts/opentype/inter/Inter-SemiBold.otf}"
FONT_REGULAR="${FONT_REGULAR:-/usr/share/fonts/opentype/inter/Inter-Regular.otf}"
SRGB_ICC="${SRGB_ICC:-/System/Library/ColorSync/Profiles/sRGB Profile.icc}"

SCREENS="nights budget week list total yours"
WIDTHS="420 640"
ICON_SIZES="28 56 84 30 60 90 34 68 102"

if command -v magick >/dev/null 2>&1; then IM=(magick); CMP=(magick compare); else IM=(convert); CMP=(compare); fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fresh() {  # fresh <path>: stop unless the file is new (or FORCE=1)
  if [ -e "$1" ] && [ "${FORCE:-0}" != 1 ]; then
    echo "$1 exists; /media is immutable, so use a new version (FORCE=1 remakes a file that never shipped)" >&2
    exit 1
  fi
}

report() { echo "wrote $1 ($("${IM[@]}" "$1" -format '%wx%h' info:), $(wc -c <"$1" | tr -d ' ') bytes)"; }

icon() {  # icon <icon.png> <ver>
  local src="$1" ver="$2" size colours pal full snapped err out px
  size="$("${IM[@]}" "$src" -format '%wx%h' info:)"
  [ "${size%x*}" = "${size#*x}" ] || { echo "$src is $size; the icon must be square" >&2; exit 1; }
  # the icon's two commonest colours: the ground and the bird
  colours=$("${IM[@]}" "$src" -format %c histogram:info:- | sort -t: -k1,1 -rn | head -2 \
            | grep -o '#[0-9A-Fa-f]\{6\}' | cut -c1-7 | tr '\n' ' ')
  set -- $colours
  pal="$TMP/palette.png"
  "${IM[@]}" -size 1x32 "gradient:$1-$2" -depth 8 "$pal"
  mkdir -p "$OUT"
  for px in $ICON_SIZES; do
    out="$OUT/icon-$ver-$px.webp"
    fresh "$out"
    full="$TMP/full-$px.png"; snapped="$TMP/snapped-$px.png"
    "${IM[@]}" "$src" -filter Box -resize "${px}x${px}" -depth 8 "PNG24:$full"
    "${IM[@]}" "$full" +dither -remap "$pal" -depth 8 "PNG24:$snapped"
    # the snapping moves a pixel by half a step at most; more means the icon has a third colour
    # (compare exits 1 when the two differ at all, which they do)
    err=$({ "${CMP[@]}" -metric PAE "$full" "$snapped" null: 2>&1 || true; } | sed -n 's/.*(\([0-9.e-]*\)).*/\1/p')
    if awk -v e="${err:-1}" 'BEGIN { exit !(e > 0.02) }'; then snapped="$full"; fi
    "${IM[@]}" "$snapped" -strip -define webp:lossless=true -define webp:method=6 "$out"
    report "$out"
  done
}

stills() {  # stills <folder> <ver>
  local dir="$1" ver="$2" name src missing="" size w h ow icc out
  for name in $SCREENS; do [ -f "$dir/$name.png" ] || missing="$missing $name.png"; done
  [ -z "$missing" ] || { echo "$dir lacks:$missing (one PNG per screen: $SCREENS)" >&2; exit 1; }
  mkdir -p "$OUT"
  for name in $SCREENS; do
    src="$dir/$name.png"
    size="$("${IM[@]}" "$src" -format '%w %h' info:)"; w="${size% *}"; h="${size#* }"
    # 393 x 852 to within 1%; narrower than 640 means the 640 still is blown up
    awk -v w="$w" -v h="$h" 'BEGIN { r = (w * 852) / (h * 393); exit !(r < 0.99 || r > 1.01) }' \
      && echo "warning: $src is ${w}x${h}, not 393 x 852's aspect; the page crops it to fit" >&2
    [ "$w" -ge 640 ] || echo "warning: $src is $w wide; the 640 still is enlarged (ask for 1179 x 2556)" >&2
    icc="$("${IM[@]}" "$src" -format '%[icc:description]' info: 2>/dev/null || true)"
    local to_srgb=()
    if [ -n "$icc" ] && ! printf '%s' "$icc" | grep -qi 'srgb'; then
      [ -f "$SRGB_ICC" ] || { echo "$src is tagged '$icc'; set SRGB_ICC to an sRGB .icc file to convert it" >&2; exit 1; }
      to_srgb=(-profile "$SRGB_ICC")
      echo "$src: converting '$icc' to sRGB" >&2
    fi
    for ow in $WIDTHS; do
      out="$OUT/screen-$name-$ver-$ow.webp"
      fresh "$out"
      # ImageMagick turns it to sRGB, drops any alpha and resizes; ffmpeg's libwebp encodes, since
      # ImageMagick 6.9 ignores -quality for lossy WebP. RGB in (bgra): libwebp makes its own YUV.
      "${IM[@]}" "$src" ${to_srgb[@]+"${to_srgb[@]}"} -background '#FBF6EC' -alpha remove -alpha off \
        -filter Lanczos -resize "${ow}x" -strip -depth 8 "PNG24:$TMP/$name-$ow.png"
      ffmpeg -y -hide_banner -loglevel error -i "$TMP/$name-$ow.png" -pix_fmt bgra \
        -c:v libwebp -quality "$Q" -compression_level 6 -map_metadata -1 -flags +bitexact -fflags +bitexact "$out"
      report "$out"
    done
  done
}

label() {  # label <screen>: its name on the placeholder, one line per |
  case "$1" in
    nights) echo 'The nights question' ;;
    budget) echo 'The budget question' ;;
    week)   echo 'The week' ;;
    list)   echo 'The list' ;;
    total)  echo 'The total card' ;;
    yours)  echo 'A list row|priced “yours”' ;;
  esac
}

placeholders() {
  local dir="$TMP/placeholders" name text n i base vf
  mkdir -p "$dir"
  printf '%s' 'Placeholder' >"$dir/note.txt"
  for name in $SCREENS; do
    # 1179 x 2556 (393 x 852 at 3x), cream; the name 96 px in ink, lines 120 apart, around 45% of the
    # height; "Placeholder" 60 px in ink at 62% under it. Each line is its own drawtext, centred; its
    # baseline sits at y (y - ascent is the top drawtext wants). Text comes from files: no escaping.
    text="$(label "$name")"
    n=$(printf '%s' "$text" | awk -F'|' '{ print NF }')
    base=$((1150 - (n - 1) * 60))
    vf=""
    for i in $(seq 1 "$n"); do
      printf '%s' "$text" | cut -d'|' -f"$i" | tr -d '\n' >"$dir/$name-$i.txt"
      vf="$vf,drawtext=fontfile='$FONT':textfile='$dir/$name-$i.txt':fontcolor=0x0E1B26:fontsize=96:x=(w-text_w)/2:y=$((base + (i - 1) * 120))-ascent"
    done
    vf="$vf,drawtext=fontfile='$FONT_REGULAR':textfile='$dir/note.txt':fontcolor=0x0E1B26@0.62:fontsize=60:x=(w-text_w)/2:y=$((base + n * 120))-ascent"
    ffmpeg -y -hide_banner -loglevel error -f lavfi -i "color=c=0xFBF6EC:s=1179x2556:d=1,format=rgb24" \
      -vf "${vf#,}" -frames:v 1 -pix_fmt rgb24 -map_metadata -1 -flags +bitexact -fflags +bitexact "$dir/$name.png"
  done
  stills "$dir" placeholder
}

case "${1:-}" in
  icon)
    [ $# -ge 2 ] && [ $# -le 3 ] || { echo "usage: $0 icon <icon.png> [version, e.g. v1]" >&2; exit 2; }
    icon "$(abs "$2")" "${3:-v1}"
    ;;
  placeholders)
    [ $# -eq 1 ] || { echo "usage: $0 placeholders" >&2; exit 2; }
    placeholders
    ;;
  stills)
    [ $# -eq 3 ] || { echo "usage: $0 stills <folder of nights.png ... yours.png> <version, e.g. v1>" >&2; exit 2; }
    case "$3" in v[0-9]*) ;; *) echo "the version is v1, v2, ...; placeholders have their own mode" >&2; exit 2 ;; esac
    stills "$(abs "$2")" "$3"
    ;;
  *)
    sed -n '2,8p' "$SELF" >&2
    exit 2
    ;;
esac
