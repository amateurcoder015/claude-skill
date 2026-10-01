#!/usr/bin/env python3
"""Download a YouTube video, or import a local file, into a trailer workdir.

Usage:
  fetch.py --url URL [--out-root DIR] [--cookies-from-browser BROWSER]
  fetch.py --file PATH [--out-root DIR]

Prints {"workdir": ..., "videoId": ...} as JSON on success.
On a user-facing failure prints "ERROR: <message>" to stderr and exits 2.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

MAX_DURATION = 7200
MIN_DURATION = 15
FORMAT = "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b"
COOKIE_HINT = (
    "Retry with --cookies-from-browser <chrome|firefox|safari|edge>, "
    "or download the video yourself and use --file path.mp4."
)


class FetchError(Exception):
    pass


def classify_error(stderr: str) -> str:
    text = stderr.lower()
    if "private video" in text:
        return "This video is private. " + COOKIE_HINT
    if "confirm your age" in text or "age-restricted" in text:
        return "This video is age-restricted. " + COOKIE_HINT
    if "not available in your country" in text or "geo restrict" in text or "geo-restrict" in text:
        return "This video is blocked in your region. Use --file path.mp4 with a copy you have rights to."
    if "not a bot" in text or "http error 429" in text:
        return "YouTube blocked the download (bot check or rate limit). " + COOKIE_HINT
    if "video unavailable" in text:
        return "This video is unavailable (deleted, removed or the link is wrong)."
    if "unsupported url" in text:
        return "This URL is not a supported video URL."
    lines = [line for line in stderr.strip().splitlines() if line.strip()]
    last = lines[-1] if lines else "unknown error"
    return f"yt-dlp failed: {last}. Try updating it with: yt-dlp -U"


def pick_captions(info: dict) -> tuple[str, str] | None:
    """Return (mode, language key) of the best caption track, or None."""
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    lang = info.get("language") or ""
    base = lang.split("-")[0]

    def find(tracks: dict, prefixes: list[str]) -> str | None:
        for prefix in prefixes:
            for key in tracks:
                if key == prefix or key.startswith(prefix + "-"):
                    return key
        return None

    own = [p for p in (lang, base) if p]
    order = [
        ("manual", manual, ["en"]),
        ("auto", auto, ["en-orig", "en"]),
        ("manual", manual, own),
        ("auto", auto, [f"{base}-orig", *own] if base else []),
    ]
    for mode, tracks, prefixes in order:
        key = find(tracks, prefixes)
        if key:
            return mode, key
    return None


def normalize_info(raw: dict, source: str, url: str | None) -> dict:
    chapters = [
        {
            "start": round(float(c.get("start_time", 0)), 2),
            "end": round(float(c.get("end_time", 0)), 2),
            "title": c.get("title", ""),
        }
        for c in (raw.get("chapters") or [])
    ]
    return {
        "id": raw.get("id", ""),
        "title": raw.get("title", ""),
        "channel": raw.get("channel") or raw.get("uploader") or "",
        "description": (raw.get("description") or "")[:2000],
        "duration": float(raw.get("duration") or 0),
        "categories": raw.get("categories") or [],
        "tags": (raw.get("tags") or [])[:20],
        "chapters": chapters,
        "source": source,
        "url": url,
    }


def check_duration(seconds: float) -> None:
    if seconds <= 0:
        raise FetchError("Could not read the video duration.")
    if seconds < MIN_DURATION:
        raise FetchError(f"This video is {seconds:.0f} seconds long; it must be at least {MIN_DURATION} seconds.")
    if seconds > MAX_DURATION:
        raise FetchError(
            f"This video is {seconds / 3600:.1f} hours long; the limit is {MAX_DURATION // 3600} hours. "
            "Trim a copy and use --file path.mp4."
        )


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def ytdlp(args: list[str], cookies: str | None) -> str:
    cmd = ["yt-dlp", "--no-playlist", "--no-warnings"]
    if cookies:
        cmd += ["--cookies-from-browser", cookies]
    proc = run(cmd + args)
    if proc.returncode != 0:
        raise FetchError(classify_error(proc.stderr))
    return proc.stdout


def has_audio(video: Path) -> bool:
    proc = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                "-of", "csv=p=0", str(video)])
    return proc.returncode == 0 and bool(proc.stdout.strip())


def probe_duration(path: Path) -> float:
    proc = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=nw=1:nk=1", str(path)])
    try:
        return float(proc.stdout.strip())
    except ValueError:
        raise FetchError(f"Could not read {path.name} as a video file.") from None


def write_info(source: Path, info: dict) -> None:
    info["hasAudio"] = has_audio(source / "video.mp4")
    (source / "info.json").write_text(json.dumps(info, indent=2, ensure_ascii=False))


def fetch_url(url: str, out_root: Path, cookies: str | None) -> tuple[Path, str]:
    raw = json.loads(ytdlp(["--dump-single-json", "--skip-download", url], cookies))
    check_duration(float(raw.get("duration") or 0))
    vid = raw["id"]
    workdir = out_root / f"trailer-{vid}"
    source = workdir / "source"
    source.mkdir(parents=True, exist_ok=True)
    args = ["-f", FORMAT, "--merge-output-format", "mp4", "-o", str(source / "video.%(ext)s")]
    captions = pick_captions(raw)
    if captions:
        mode, key = captions
        args += ["--write-subs" if mode == "manual" else "--write-auto-subs",
                 "--sub-langs", key, "--sub-format", "vtt/best", "--convert-subs", "vtt"]
    ytdlp(args + [url], cookies)
    vtts = sorted(source.glob("video*.vtt"))
    if vtts:
        vtts[0].replace(source / "captions.vtt")
        for extra in vtts[1:]:
            extra.unlink()
    if not (source / "video.mp4").exists():
        raise FetchError("Download finished but video.mp4 is missing. Try updating yt-dlp with: yt-dlp -U")
    write_info(source, normalize_info(raw, "youtube", url))
    return workdir, vid


def slug(stem: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", stem).strip("-").lower()[:40] or "video"


def fetch_file(path: Path, out_root: Path) -> tuple[Path, str]:
    if not path.is_file():
        raise FetchError(f"File not found: {path}")
    duration = probe_duration(path)
    check_duration(duration)
    vid = "local-" + slug(path.stem)
    workdir = out_root / f"trailer-{vid}"
    source = workdir / "source"
    source.mkdir(parents=True, exist_ok=True)
    target = source / "video.mp4"
    if path.suffix.lower() == ".mp4":
        shutil.copyfile(path, target)
    else:
        proc = run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(path),
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", str(target)])
        if proc.returncode != 0:
            raise FetchError(f"Could not convert {path.name} to mp4: {proc.stderr.strip()[-200:]}")
    sidecar = path.with_suffix(".vtt")
    if sidecar.is_file():
        shutil.copyfile(sidecar, source / "captions.vtt")
    write_info(source, normalize_info({"id": vid, "title": path.stem, "duration": duration}, "file", None))
    return workdir, vid


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url")
    group.add_argument("--file", type=Path)
    parser.add_argument("--out-root", type=Path, default=Path.cwd())
    parser.add_argument("--cookies-from-browser")
    args = parser.parse_args(argv)
    out_root = args.out_root.resolve()
    try:
        if args.url:
            workdir, vid = fetch_url(args.url, out_root, args.cookies_from_browser)
        else:
            workdir, vid = fetch_file(args.file.expanduser().resolve(), out_root)
    except FetchError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"workdir": str(workdir), "videoId": vid}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
