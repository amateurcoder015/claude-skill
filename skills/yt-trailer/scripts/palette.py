#!/usr/bin/env python3
"""Pick trailer colors from sampled video frames.

Usage: palette.py WORKDIR   (reads source/video.mp4 + source/info.json, writes palette.json)
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from collections import Counter
from pathlib import Path

DEFAULT_BG = (11, 11, 15)
DEFAULT_ACCENT = (232, 195, 122)
DEFAULT_FG = (245, 243, 238)


def sample_pixels(video: Path, duration: float, frames: int = 12) -> bytes:
    fps = frames / max(duration, 1.0)
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
         "-vf", f"fps={fps:.6f},scale=64:36", "-frames:v", str(frames),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="replace").strip()[-200:])
    return proc.stdout


def dist(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def dominant_colors(pixels: bytes, k: int = 5) -> list[tuple[int, int, int]]:
    counts: Counter = Counter()
    for i in range(0, len(pixels) - 2, 3):
        counts[(pixels[i] >> 4, pixels[i + 1] >> 4, pixels[i + 2] >> 4)] += 1
    chosen: list[tuple[int, int, int]] = []
    for (qr, qg, qb), _ in counts.most_common():
        color = (qr * 16 + 8, qg * 16 + 8, qb * 16 + 8)
        if all(dist(color, other) > 60 for other in chosen):
            chosen.append(color)
        if len(chosen) == k:
            break
    return chosen


def luminance(c) -> float:
    r, g, b = (v / 255 for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def saturation(c) -> float:
    hi, lo = max(c) / 255, min(c) / 255
    return 0.0 if hi == 0 else (hi - lo) / hi


def mix(c, other, t: float):
    return tuple(round(a + (b - a) * t) for a, b in zip(c, other))


def to_hex(c) -> str:
    return "#%02x%02x%02x" % tuple(c)


def assign_roles(colors: list) -> dict:
    if not colors:
        return {"bg": to_hex(DEFAULT_BG), "accent": to_hex(DEFAULT_ACCENT), "fg": to_hex(DEFAULT_FG), "colors": []}
    bg = min(colors, key=luminance)
    while luminance(bg) > 0.08:
        bg = mix(bg, (0, 0, 0), 0.5)
    mids = [c for c in colors if 0.15 <= luminance(c) <= 0.85] or colors
    accent = max(mids, key=saturation)
    if saturation(accent) < 0.25:
        accent = DEFAULT_ACCENT
    lightest = max(colors, key=luminance)
    fg = lightest if luminance(lightest) >= 0.75 else DEFAULT_FG
    return {"bg": to_hex(bg), "accent": to_hex(accent), "fg": to_hex(fg), "colors": [to_hex(c) for c in colors]}


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: palette.py WORKDIR", file=sys.stderr)
        return 2
    workdir = Path(argv[0])
    info = json.loads((workdir / "source" / "info.json").read_text())
    try:
        pixels = sample_pixels(workdir / "source" / "video.mp4", float(info.get("duration", 0)))
    except RuntimeError as exc:
        print(f"ERROR: could not sample frames: {exc}", file=sys.stderr)
        return 2
    roles = assign_roles(dominant_colors(pixels))
    (workdir / "palette.json").write_text(json.dumps(roles, indent=2))
    print(json.dumps(roles))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
