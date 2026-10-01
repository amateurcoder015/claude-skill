import json
import subprocess


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def test_sample_video_shape(sample_mp4):
    data = probe(sample_mp4)
    assert abs(float(data["format"]["duration"]) - 18.0) < 0.2
    kinds = sorted(s["codec_type"] for s in data["streams"])
    assert kinds == ["audio", "video"]


def test_silent_video_has_no_audio(silent_mp4):
    kinds = [s["codec_type"] for s in probe(silent_mp4)["streams"]]
    assert kinds == ["video"]
