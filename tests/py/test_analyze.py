import json

from conftest import run_script

import analyze

ROLLUP_VTT = """WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
hello<00:00:01.500><c> there</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
hello there

00:00:03.010 --> 00:00:05.000 align:start position:0%
hello there
how are you

00:00:05.000 --> 00:00:07.000
how are you
I am &amp; fine
"""


def test_parse_vtt_removes_rollup_and_tags():
    assert analyze.parse_vtt(ROLLUP_VTT) == [
        {"start": 1.0, "end": 3.0, "text": "hello there"},
        {"start": 3.01, "end": 5.0, "text": "how are you"},
        {"start": 5.0, "end": 7.0, "text": "I am & fine"},
    ]


def test_parse_vtt_hour_timestamps():
    text = "WEBVTT\n\n01:02:03.500 --> 01:02:05.000\nlate line\n"
    assert analyze.parse_vtt(text) == [{"start": 3723.5, "end": 3725.0, "text": "late line"}]


def test_pick_peaks_spacing_and_order():
    per_second = {0: -40.0, 1: -10.0, 2: -11.0, 3: -30.0, 8: -12.0}
    times = [p["t"] for p in analyze.pick_peaks(per_second)]
    assert times == sorted(times)
    assert 1.0 in times and 8.0 in times
    assert 2.0 not in times  # within 3 s of the louder second 1


def test_fit_budget_limits_size():
    lines = [{"start": i * 2.0, "end": i * 2.0 + 2, "text": "x" * 60} for i in range(3000)]
    doc = {"title": "t", "duration": 6000.0, "hasCaptions": True, "chapters": [],
           "scenes": [float(i) for i in range(300)], "peaks": [], "transcript": lines,
           "transcriptCompacted": False}
    out = analyze.fit_budget(doc)
    assert analyze.encoded_size(out) <= 30000
    assert out["transcriptCompacted"] is True
    assert out["transcript"][0]["start"] == 0.0


def test_analyze_sample(workdir):
    (workdir / "source" / "captions.vtt").write_text(ROLLUP_VTT)
    proc = run_script("analyze.py", workdir)
    assert proc.returncode == 0, proc.stderr
    doc = json.loads((workdir / "candidates.json").read_text())
    assert doc["duration"] == 18.0
    assert doc["hasCaptions"] is True
    assert any(abs(t - 6.0) < 0.2 for t in doc["scenes"])
    assert any(abs(t - 12.0) < 0.2 for t in doc["scenes"])
    assert any(8.5 <= p["t"] <= 10.5 for p in doc["peaks"])
    assert doc["transcript"][0]["text"] == "hello there"


def test_analyze_silent_video_without_captions(workdir, silent_mp4):
    (workdir / "source" / "video.mp4").write_bytes(silent_mp4.read_bytes())
    proc = run_script("analyze.py", workdir)
    assert proc.returncode == 0, proc.stderr
    doc = json.loads((workdir / "candidates.json").read_text())
    assert doc["peaks"] == []
    assert doc["transcript"] == []
    assert doc["hasCaptions"] is False
