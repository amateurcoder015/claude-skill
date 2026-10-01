#!/usr/bin/env python3
"""Check a rendered trailer against its edit plan.

Usage: verify.py WORKDIR   (reads trailer.mp4, edl.json, source/info.json)
Prints "OK: ..." and exits 0, or prints "FAIL: ..." lines and exits 1.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

DIMS = {"16:9": (1920, 1080), "9:16": (1080, 1920)}


def expects_audio(edl: dict, info: dict) -> bool:
    if edl.get("music"):
        return True
    if info.get("hasAudio") is False:
        return False
    return any(s.get("type") == "clip" and s.get("audio", "original") != "mute" for s in edl["scenes"])


def check(probe: dict, edl: dict, info: dict) -> list[str]:
    errors = []
    duration = float(probe["format"]["duration"])
    if abs(duration - edl["duration"]) > 0.5:
        errors.append(f"duration is {duration:.2f}s; expected {edl['duration']}s ±0.5s")
    video = [s for s in probe["streams"] if s.get("codec_type") == "video"]
    audio = [s for s in probe["streams"] if s.get("codec_type") == "audio"]
    want = DIMS[edl["format"]]
    if not video:
        errors.append("no video stream")
    elif (video[0]["width"], video[0]["height"]) != want:
        errors.append(f"resolution is {video[0]['width']}x{video[0]['height']}; expected {want[0]}x{want[1]}")
    if expects_audio(edl, info) and not audio:
        errors.append("no audio stream")
    return errors


def ffprobe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: verify.py WORKDIR", file=sys.stderr)
        return 2
    work = Path(argv[0])
    trailer = work / "trailer.mp4"
    if not trailer.is_file() or trailer.stat().st_size == 0:
        print(f"FAIL: trailer.mp4 not found or empty in {work}")
        return 1
    edl = json.loads((work / "edl.json").read_text())
    info = json.loads((work / "source" / "info.json").read_text())
    probe = ffprobe(trailer)
    errors = check(probe, edl, info)
    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1
    w, h = DIMS[edl["format"]]
    print(f"OK: {trailer} ({float(probe['format']['duration']):.2f}s, {w}x{h})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
