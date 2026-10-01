import json
import os
import sys

import pytest
from conftest import run_script

import fetch

FAKE_YTDLP = """#!{python}
import json, os, shutil, sys
args = sys.argv[1:]
log = os.environ.get("FAKE_YTDLP_LOG")
if log:
    with open(log, "a") as f:
        f.write(json.dumps(args) + "\\n")
mode = os.environ.get("FAKE_YTDLP_MODE", "ok")
if mode == "private":
    sys.stderr.write("ERROR: [youtube] abc123: Private video. Sign in if you've been granted access\\n")
    sys.exit(1)
if "--dump-single-json" in args:
    print(json.dumps({{
        "id": "abc123", "title": "Test Video", "channel": "Chan",
        "duration": float(os.environ.get("FAKE_DURATION", "18")),
        "subtitles": {{}}, "automatic_captions": {{"en": [{{}}], "en-orig": [{{}}]}},
        "chapters": [{{"start_time": 0, "end_time": 9, "title": "Intro"}}],
    }}))
    sys.exit(0)
out = args[args.index("-o") + 1]
shutil.copyfile(os.environ["FAKE_SOURCE_MP4"], out.replace("%(ext)s", "mp4"))
if "--write-auto-subs" in args or "--write-subs" in args:
    with open(out.replace("%(ext)s", "en-orig.vtt"), "w") as f:
        f.write("WEBVTT\\n\\n00:00:01.000 --> 00:00:02.000\\nhello\\n")
"""


@pytest.fixture
def fake_env(tmp_path, sample_mp4):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    exe = bin_dir / "yt-dlp"
    exe.write_text(FAKE_YTDLP.format(python=sys.executable))
    exe.chmod(0o755)
    env = dict(os.environ)
    env.update({
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_SOURCE_MP4": str(sample_mp4),
        "FAKE_YTDLP_LOG": str(tmp_path / "calls.log"),
    })
    return env


def calls(env):
    with open(env["FAKE_YTDLP_LOG"]) as f:
        return [json.loads(line) for line in f]


def test_url_download_creates_workdir(fake_env, tmp_path):
    proc = run_script("fetch.py", "--url", "https://youtu.be/abc123?t=42", "--out-root", tmp_path, env=fake_env)
    assert proc.returncode == 0, proc.stderr
    result = json.loads(proc.stdout)
    work = tmp_path / "trailer-abc123"
    assert result == {"workdir": str(work), "videoId": "abc123"}
    assert (work / "source" / "video.mp4").exists()
    assert (work / "source" / "captions.vtt").read_text().startswith("WEBVTT")
    info = json.loads((work / "source" / "info.json").read_text())
    assert info["title"] == "Test Video"
    assert info["chapters"] == [{"start": 0.0, "end": 9.0, "title": "Intro"}]
    assert info["hasAudio"] is True
    assert info["source"] == "youtube"


def test_url_passed_verbatim_with_no_playlist(fake_env, tmp_path):
    url = "https://www.youtube.com/watch?v=abc123&list=PL1&t=42"
    run_script("fetch.py", "--url", url, "--out-root", tmp_path, env=fake_env)
    for args in calls(fake_env):
        assert args[-1] == url
        assert "--no-playlist" in args
    download = calls(fake_env)[1]
    assert "--write-auto-subs" in download
    assert download[download.index("--sub-langs") + 1] == "en-orig"


def test_cookies_flag_is_forwarded(fake_env, tmp_path):
    run_script("fetch.py", "--url", "https://youtu.be/abc123", "--out-root", tmp_path,
               "--cookies-from-browser", "firefox", env=fake_env)
    for args in calls(fake_env):
        assert args[args.index("--cookies-from-browser") + 1] == "firefox"


def test_private_video_message(fake_env, tmp_path):
    fake_env["FAKE_YTDLP_MODE"] = "private"
    proc = run_script("fetch.py", "--url", "https://youtu.be/abc123", "--out-root", tmp_path, env=fake_env)
    assert proc.returncode == 2
    assert proc.stderr.startswith("ERROR: This video is private")


def test_too_long_video_refused(fake_env, tmp_path):
    fake_env["FAKE_DURATION"] = "9000"
    proc = run_script("fetch.py", "--url", "https://youtu.be/abc123", "--out-root", tmp_path, env=fake_env)
    assert proc.returncode == 2
    assert "limit is 2 hours" in proc.stderr


def test_too_short_video_refused(fake_env, tmp_path):
    fake_env["FAKE_DURATION"] = "9"
    proc = run_script("fetch.py", "--url", "https://youtu.be/abc123", "--out-root", tmp_path, env=fake_env)
    assert proc.returncode == 2
    assert "at least 15 seconds" in proc.stderr


def test_local_file_import(sample_mp4, tmp_path):
    proc = run_script("fetch.py", "--file", sample_mp4, "--out-root", tmp_path)
    assert proc.returncode == 0, proc.stderr
    work = tmp_path / "trailer-local-sample"
    info = json.loads((work / "source" / "info.json").read_text())
    assert info["id"] == "local-sample"
    assert info["source"] == "file"
    assert abs(info["duration"] - 18.0) < 0.2
    assert (work / "source" / "video.mp4").stat().st_size > 0


def test_local_file_missing(tmp_path):
    proc = run_script("fetch.py", "--file", tmp_path / "nope.mp4", "--out-root", tmp_path)
    assert proc.returncode == 2
    assert "File not found" in proc.stderr


def test_silent_file_has_no_audio(silent_mp4, tmp_path):
    proc = run_script("fetch.py", "--file", silent_mp4, "--out-root", tmp_path)
    info = json.loads((tmp_path / "trailer-local-silent" / "source" / "info.json").read_text())
    assert proc.returncode == 0
    assert info["hasAudio"] is False


@pytest.mark.parametrize("info,expected", [
    ({"subtitles": {"en-US": []}, "automatic_captions": {"en": []}}, ("manual", "en-US")),
    ({"automatic_captions": {"en": [], "en-orig": []}}, ("auto", "en-orig")),
    ({"language": "es", "automatic_captions": {"es": [], "fr": []}}, ("auto", "es")),
    ({"language": "pt-BR", "subtitles": {"pt-BR": []}}, ("manual", "pt-BR")),
    ({"subtitles": {"live_chat": []}}, None),
    ({}, None),
])
def test_pick_captions(info, expected):
    assert fetch.pick_captions(info) == expected


@pytest.mark.parametrize("stderr,needle", [
    ("ERROR: Sign in to confirm your age.", "age-restricted"),
    ("ERROR: Video not available in your country", "region"),
    ("ERROR: Sign in to confirm you're not a bot", "blocked the download"),
    ("ERROR: Video unavailable", "unavailable"),
    ("ERROR: something odd happened", "yt-dlp -U"),
])
def test_classify_error(stderr, needle):
    assert needle in fetch.classify_error(stderr)
