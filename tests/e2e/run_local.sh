#!/usr/bin/env bash
# Offline end-to-end run: generate a 70 s video, then build, check, render and verify two trailers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SKILL="$ROOT/skills/yt-trailer"
HF="hyperframes@0.8.104"
OUT="$(mktemp -d)"
SRC="$OUT/e2e-fixture.mp4"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=s=1280x720:d=70:r=30" \
  -f lavfi -i "sine=frequency=330:duration=70" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac "$SRC"

bash "$SKILL/scripts/doctor.sh"
WORK="$(python3 "$SKILL/scripts/fetch.py" --file "$SRC" --out-root "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workdir"])')"
python3 "$SKILL/scripts/analyze.py" "$WORK"
python3 "$SKILL/scripts/palette.py" "$WORK"

for style in highlight cinematic; do
  echo "=== $style"
  cp "$ROOT/tests/e2e/edl.$style.json" "$WORK/edl.json"
  mkdir -p "$WORK/custom"
  cp "$ROOT/tests/fixtures/hero.html" "$WORK/custom/hero.html"
  rm -f "$WORK/beats.json"
  node "$SKILL/scripts/build.mjs" "$WORK"
  if grep -q '"music": {' "$WORK/edl.json"; then
    (cd "$WORK/project" && npx --yes "$HF" beats --json)
    cp "$(find "$WORK/project/beats" -name '*.json' | head -1)" "$WORK/beats.json"
    node "$SKILL/scripts/build.mjs" "$WORK" --beats "$WORK/beats.json"
  fi
  (cd "$WORK/project" && npx --yes "$HF" check)
  (cd "$WORK/project" && npx --yes "$HF" render --quality draft --output ../trailer.mp4)
  python3 "$SKILL/scripts/verify.py" "$WORK"
  cp "$WORK/trailer.mp4" "$OUT/trailer-$style.mp4"
done
echo "E2E OK: $OUT/trailer-highlight.mp4 $OUT/trailer-cinematic.mp4"
