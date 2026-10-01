import datetime
import os
import subprocess
import sys

import pytest
from conftest import SCRIPTS

DOCTOR = SCRIPTS / "doctor.sh"


def write_exe(path, body):
    path.write_text(body)
    path.chmod(0o755)


@pytest.fixture
def env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_exe(bin_dir / "node", '#!/bin/sh\ncase "$1" in\n  -p) echo "${FAKE_NODE_MAJOR:-22}" ;;\n  -v) echo "v${FAKE_NODE_MAJOR:-22}.1.0" ;;\nesac\n')
    write_exe(bin_dir / "ffmpeg", "#!/bin/sh\nexit 0\n")
    write_exe(bin_dir / "ffprobe", "#!/bin/sh\nexit 0\n")
    write_exe(bin_dir / "yt-dlp", '#!/bin/sh\necho "$FAKE_YTDLP_VERSION"\n')
    (bin_dir / "python3").symlink_to(sys.executable)
    skills = tmp_path / "skills" / "hyperframes-core"
    skills.mkdir(parents=True)
    (skills / "SKILL.md").write_text("x")
    return {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "YT_TRAILER_SKILL_ROOTS": str(tmp_path / "skills"),
        "FAKE_YTDLP_VERSION": datetime.date.today().strftime("%Y.%m.%d"),
        "_bin": str(bin_dir),
    }


def run(env):
    clean = {k: v for k, v in env.items() if not k.startswith("_")}
    return subprocess.run(["bash", str(DOCTOR)], capture_output=True, text=True, env=clean)


def test_all_present(env):
    proc = run(env)
    assert proc.returncode == 0, proc.stdout
    assert "All dependencies OK" in proc.stdout
    assert "WARNING" not in proc.stdout


def test_missing_ytdlp(env):
    os.remove(os.path.join(env["_bin"], "yt-dlp"))
    proc = run(env)
    assert proc.returncode == 1
    assert "MISSING: yt-dlp" in proc.stdout
    assert "install:" in proc.stdout


def test_old_node(env):
    env["FAKE_NODE_MAJOR"] = "20"
    proc = run(env)
    assert proc.returncode == 1
    assert "Node.js 22" in proc.stdout


def test_old_ytdlp_warns_but_passes(env):
    env["FAKE_YTDLP_VERSION"] = "2020.01.01"
    proc = run(env)
    assert proc.returncode == 0
    assert "WARNING" in proc.stdout
    assert "yt-dlp -U" in proc.stdout


def test_missing_hyperframes_skills(env, tmp_path):
    empty = tmp_path / "none"
    empty.mkdir()
    env["YT_TRAILER_SKILL_ROOTS"] = str(empty)
    proc = run(env)
    assert proc.returncode == 1
    assert "HyperFrames skills" in proc.stdout
