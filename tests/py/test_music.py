import json
import subprocess
from collections import Counter

from conftest import ROOT

SKILL = ROOT / "skills" / "yt-trailer"


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout)


def test_manifest_tracks_are_valid():
    manifest = json.loads((SKILL / "assets" / "music" / "manifest.json").read_text())
    tracks = manifest["tracks"]
    assert Counter(t["style"] for t in tracks) == {"cinematic": 2, "hype": 2, "highlight": 2}
    for t in tracks:
        path = SKILL / t["file"]
        assert path.is_file(), t["file"]
        assert t["license"].startswith("CC0"), t["file"]
        assert t["source"].startswith("https://"), t["file"]
        assert duration(path) >= 62, t["file"]
        assert abs(duration(path) - t["duration"]) < 1, t["file"]
        assert path.stat().st_size < 4_000_000, t["file"]
