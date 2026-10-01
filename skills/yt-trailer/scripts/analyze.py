#!/usr/bin/env python3
"""Find trailer-worthy moments in a fetched video.

Usage: analyze.py WORKDIR
Reads WORKDIR/source/{video.mp4, info.json, captions.vtt?}; writes WORKDIR/candidates.json.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from collections import deque
from pathlib import Path

SCENE_THRESHOLD = 0.4
MAX_SCENES = 300
MAX_PEAKS = 20
PEAK_MIN_GAP = 3.0
SIZE_BUDGET = 30_000
TS = r"(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})"
CUE_RE = re.compile(rf"{TS}\s+-->\s+{TS}")


def run_ffmpeg(args: list[str]) -> str:
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        lines = proc.stderr.strip().splitlines()
        raise RuntimeError(lines[-1] if lines else "ffmpeg failed")
    return proc.stderr


def thin(values: list, limit: int) -> list:
    if len(values) <= limit:
        return values
    step = len(values) / limit
    return [values[int(i * step)] for i in range(limit)]


def detect_scenes(video: Path) -> list[float]:
    log = run_ffmpeg(["-i", str(video), "-an", "-vf",
                      f"scale=320:-2,select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-f", "null", "-"])
    return thin([round(float(t), 2) for t in re.findall(r"pts_time:([0-9.]+)", log)], MAX_SCENES)


def has_audio(video: Path) -> bool:
    proc = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                           "stream=index", "-of", "csv=p=0", str(video)], capture_output=True, text=True)
    return bool(proc.stdout.strip())


def pick_peaks(per_second: dict[int, float]) -> list[dict]:
    chosen: list[tuple[int, float]] = []
    for sec, lufs in sorted(per_second.items(), key=lambda kv: kv[1], reverse=True):
        if all(abs(sec - other) >= PEAK_MIN_GAP for other, _ in chosen):
            chosen.append((sec, lufs))
        if len(chosen) == MAX_PEAKS:
            break
    return [{"t": float(sec), "lufs": round(lufs, 1)} for sec, lufs in sorted(chosen)]


def detect_peaks(video: Path) -> list[dict]:
    if not has_audio(video):
        return []
    log = run_ffmpeg(["-i", str(video), "-vn", "-af", "ebur128", "-f", "null", "-"])
    per_second: dict[int, float] = {}
    for t, m in re.findall(r"t:\s*([0-9.]+)\s+TARGET:.*?M:\s*(-?[0-9.]+)", log):
        sec = int(float(t))
        per_second[sec] = max(per_second.get(sec, -200.0), float(m))
    return pick_peaks(per_second)


def to_seconds(h, m, s, ms) -> float:
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_vtt(text: str) -> list[dict]:
    out: list[dict] = []
    recent: deque[str] = deque(maxlen=3)
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        rows = block.strip().split("\n")
        for i, row in enumerate(rows):
            match = CUE_RE.search(row)
            if match:
                groups = match.groups()
                start, end = to_seconds(*groups[:4]), to_seconds(*groups[4:])
                body = rows[i + 1:]
                break
        else:
            continue
        if end - start < 0.05:
            continue
        for raw in body:
            clean = html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()
            if not clean or clean in recent:
                continue
            out.append({"start": round(start, 2), "end": round(end, 2), "text": clean})
            recent.append(clean)
    return out


def encoded_size(doc: dict) -> int:
    return len(json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def chunk_transcript(lines: list[dict], max_chunks: int) -> list[dict]:
    span = lines[-1]["end"] - lines[0]["start"]
    window = max(span / max_chunks, 1.0)
    chunks: list[dict] = []
    for line in lines:
        if chunks and line["start"] - chunks[-1]["start"] < window:
            chunks[-1]["end"] = line["end"]
            chunks[-1]["text"] += " " + line["text"]
        else:
            chunks.append(dict(line))
    return chunks


def fit_budget(doc: dict, budget: int = SIZE_BUDGET) -> dict:
    if encoded_size(doc) <= budget:
        return doc
    if doc["transcript"]:
        chunks = chunk_transcript(doc["transcript"], max_chunks=150)
        per = max(40, int(budget * 0.6) // len(chunks))
        doc["transcript"] = [
            {**c, "text": c["text"] if len(c["text"]) <= per else c["text"][: per - 1] + "…"}
            for c in chunks
        ]
        doc["transcriptCompacted"] = True
    while encoded_size(doc) > budget and len(doc["scenes"]) > 20:
        doc["scenes"] = doc["scenes"][::2]
    return doc


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: analyze.py WORKDIR", file=sys.stderr)
        return 2
    workdir = Path(argv[0])
    source = workdir / "source"
    video = source / "video.mp4"
    info = json.loads((source / "info.json").read_text())
    captions = source / "captions.vtt"
    try:
        doc = {
            "title": info.get("title", ""),
            "duration": info.get("duration", 0),
            "hasCaptions": captions.is_file(),
            "chapters": info.get("chapters") or [],
            "scenes": detect_scenes(video),
            "peaks": detect_peaks(video),
            "transcript": parse_vtt(captions.read_text(errors="replace")) if captions.is_file() else [],
            "transcriptCompacted": False,
        }
    except RuntimeError as exc:
        print(f"ERROR: video analysis failed: {exc}", file=sys.stderr)
        return 2
    doc = fit_budget(doc)
    (workdir / "candidates.json").write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    print(str(workdir / "candidates.json"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
