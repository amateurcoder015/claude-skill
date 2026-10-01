import json
import subprocess

from conftest import run_script

import verify


def probe(duration=30.0, w=1920, h=1080, audio=True):
    streams = [{"codec_type": "video", "width": w, "height": h}]
    if audio:
        streams.append({"codec_type": "audio"})
    return {"format": {"duration": str(duration)}, "streams": streams}


EDL = {"duration": 30, "format": "16:9", "music": None,
       "scenes": [{"type": "clip", "in": 0, "out": 3}, {"type": "end-card", "title": "x", "dur": 27}]}


def test_check_passes():
    assert verify.check(probe(), EDL, {"hasAudio": True}) == []


def test_check_duration_and_size():
    errors = verify.check(probe(duration=28.9, w=1280, h=720), EDL, {"hasAudio": True})
    assert any("duration is 28.90s" in e for e in errors)
    assert any("1280x720" in e for e in errors)


def test_audio_expectations():
    assert verify.check(probe(audio=False), EDL, {"hasAudio": True}) == ["no audio stream"]
    assert verify.check(probe(audio=False), EDL, {"hasAudio": False}) == []
    muted = {**EDL, "scenes": [{"type": "clip", "in": 0, "out": 3, "audio": "mute"}, EDL["scenes"][1]]}
    assert verify.expects_audio(muted, {"hasAudio": True}) is False
    assert verify.expects_audio({**muted, "music": {"track": "x"}}, {"hasAudio": False}) is True


def test_cli_on_real_file(tmp_path):
    work = tmp_path / "trailer-x"
    (work / "source").mkdir(parents=True)
    (work / "edl.json").write_text(json.dumps({**EDL, "duration": 30}))
    (work / "source" / "info.json").write_text(json.dumps({"hasAudio": False}))
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "color=c=black:s=1920x1080:d=30:r=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(work / "trailer.mp4")], check=True)
    proc = run_script("verify.py", work)
    assert proc.returncode == 0, proc.stdout
    assert proc.stdout.startswith("OK:")


def test_cli_missing_file(tmp_path):
    work = tmp_path / "trailer-y"
    (work / "source").mkdir(parents=True)
    (work / "edl.json").write_text(json.dumps(EDL))
    (work / "source" / "info.json").write_text("{}")
    proc = run_script("verify.py", work)
    assert proc.returncode == 1
    assert "FAIL: trailer.mp4 not found" in proc.stdout
