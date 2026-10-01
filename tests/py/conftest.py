import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skills" / "yt-trailer" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def make_sample(path: Path, seconds_per_color: int = 6, audio: bool = True) -> Path:
    """Write a test video: red, green, blue segments; tone loud only 9-10 s."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for color in ("red", "green", "blue"):
        cmd += ["-f", "lavfi", "-i", f"color=c={color}:s=320x180:d={seconds_per_color}:r=25"]
    total = seconds_per_color * 3
    video = "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]"
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={total}"]
        cmd += [
            "-filter_complex",
            video + ";[3:a]volume='if(between(t,9,10),1.0,0.02)':eval=frame[a]",
            "-map", "[v]", "-map", "[a]", "-c:a", "aac",
        ]
    else:
        cmd += ["-filter_complex", video, "-map", "[v]"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(cmd, check=True)
    return path


@pytest.fixture(scope="session")
def sample_mp4(tmp_path_factory):
    return make_sample(tmp_path_factory.mktemp("media") / "sample.mp4")


@pytest.fixture(scope="session")
def silent_mp4(tmp_path_factory):
    return make_sample(tmp_path_factory.mktemp("media") / "silent.mp4", audio=False)


@pytest.fixture
def workdir(tmp_path, sample_mp4):
    """A workdir shaped like fetch.py output, built from the sample video."""
    source = tmp_path / "trailer-test" / "source"
    source.mkdir(parents=True)
    shutil.copyfile(sample_mp4, source / "video.mp4")
    info = {
        "id": "test", "title": "Sample", "channel": "Chan", "description": "",
        "duration": 18.0, "categories": [], "tags": [], "chapters": [],
        "source": "file", "url": None, "hasAudio": True,
    }
    (source / "info.json").write_text(json.dumps(info))
    return source.parent


def run_script(name, *args, env=None, cwd=None):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / name), *map(str, args)],
        capture_output=True, text=True, env=env, cwd=cwd,
    )
