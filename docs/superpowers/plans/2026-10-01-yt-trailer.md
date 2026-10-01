# yt-trailer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shareable Claude Code skill that turns a YouTube URL or local video into a 30–60 s animated trailer rendered with HyperFrames.

**Architecture:** Python scripts (stdlib only) download and analyze the video and write compact JSON. Claude reads that JSON, writes an edit plan (`edl.json`) and one custom hero scene. A Node script (built-ins only) validates the edit plan and turns it into a HyperFrames project from a library of tested scene files. The pinned HyperFrames CLI checks and renders it, and a Python script verifies the MP4.

**Tech Stack:** Python 3.10+ (stdlib), Node.js 22+ (built-ins, `node:test`), ffmpeg/ffprobe, yt-dlp, HyperFrames CLI `hyperframes@0.8.104` (GSAP 3.14.2 from CDN inside compositions), pytest (dev only).

**Spec:** `docs/superpowers/specs/2026-10-01-yt-trailer-design.md`

## Global Constraints

- Runtime: Node.js ≥ 22, Python ≥ 3.10, ffmpeg + ffprobe, yt-dlp, HyperFrames skills installed.
- HyperFrames CLI is always invoked as `npx --yes hyperframes@0.8.104 <command>`.
- No third-party runtime dependencies: Python stdlib only, Node built-ins only. pytest is the only dev dependency.
- Source video duration: minimum 15 s, maximum 7200 s.
- Trailer length: 30, 45 or 60 s. Canvas: 1920×1080 (`16:9`) or 1080×1920 (`9:16`).
- Edit plan: 6–15 shots (clip scenes plus montage panels); scene durations must sum to `duration` within ±0.5 s.
- Beat snapping tolerance: ±0.15 s.
- `candidates.json` is at most 30 000 bytes.
- Bundled music is CC0 only, at least 62 s long, two tracks per style.
- User-facing script errors: one line `ERROR: <message>` on stderr, exit code 2. Verification failures: exit code 1.
- Workdir layout: `trailer-<videoId>/{source/{video.mp4,info.json,captions.vtt?},candidates.json,palette.json,edl.json,custom/hero.html,beats.json?,project/,trailer.mp4}`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Spec refinements made in this plan

These are concrete decisions the spec left open. Task 18 updates the spec to match.

- `palette` in `edl.json` is an object `{bg, accent, fg}`, not an array.
- Clip treatments are clip `fx` values (`slowmo`, `speed-ramp`, `flash-punch`, `push-in`, `zoom-in`), not separate scene files. The lower third is the clip's `caption`. The split montage is a `montage` scene. Letterbox, grain/light-leak and glitch are `overlays`.
- Registry blocks are not wired through `edl.json`. Claude may use the registry while writing the hero scene, which must still be one self-contained file.
- Added: 15 s minimum source length, a non-English caption fallback, `hasAudio` in `info.json`, and a `--draft` flag.

## Review Focus

1. **URL variants** (`youtu.be/…`, `/shorts/…`, `&t=…`, `&list=…`): fetch must pass the URL to yt-dlp unchanged and always add `--no-playlist`. Test lives in Task 3.
2. **Titles and captions with special characters** (`"`, `'`, `&`, `<`, emoji): generated HTML and scene files must stay valid and show the text literally. Tests live in Tasks 8 and 9.
3. **Very short sources** (under 15 s): fetch refuses with a clear message. Sources of 15–60 s still analyze. Test lives in Task 3.
4. **Videos with no audio stream**: analyze returns no peaks without crashing, compose emits no clip `<audio>`, and verify does not demand audio. Tests live in Tasks 4, 8 and 16.
5. **Videos without English captions**: fetch falls back to captions in the video's own language. Test lives in Task 3.

---

## File Structure

```
yt-trailer/                               (repo root = github.com/amateurcoder015/claude-skill)
├── .claude-plugin/
│   ├── plugin.json                       plugin manifest
│   └── marketplace.json                  lets users `/plugin marketplace add` the repo
├── skills/yt-trailer/
│   ├── SKILL.md                          workflow Claude follows
│   ├── references/
│   │   ├── edl-guide.md                  how to choose style, clips, copy; full example
│   │   └── scene-contract.md             token contract for scene files and the hero scene
│   ├── schema/edl.schema.json            JSON Schema of edl.json (documentation for Claude)
│   ├── scripts/
│   │   ├── doctor.sh                     dependency check
│   │   ├── fetch.py                      download/import → source/
│   │   ├── analyze.py                    scenes, peaks, transcript → candidates.json
│   │   ├── palette.py                    frame colors → palette.json
│   │   ├── verify.py                     ffprobe checks on trailer.mp4
│   │   ├── build.mjs                     edl.json → project/ (CLI + build())
│   │   └── lib/
│   │       ├── html.mjs                  esc()
│   │       ├── timeline.mjs              clipRate, sceneDuration, layout, round
│   │       ├── edl.mjs                   constants + validateEdl()
│   │       ├── beats.mjs                 parseBeats(), snapToBeats()
│   │       ├── compose.mjs               composeIndex(), speechWindows(), musicLane()
│   │       ├── scenes.mjs                fillScene()
│   │       └── project.mjs               HF_VERSION, HF_CONFIG
│   ├── scenes/
│   │   ├── cinematic/{slow-push-title,black-to-title,end-card}.html
│   │   ├── hype/{kinetic-slam,end-card}.html
│   │   ├── highlight/{quote-card,chapter-bumper,end-card}.html
│   │   └── overlays/{letterbox,grain-lightleak,glitch-rgb}.html
│   └── assets/music/{cinematic,hype,highlight}-{1,2}.mp3 + manifest.json
├── tests/
│   ├── py/conftest.py, test_*.py         pytest
│   ├── js/*.test.mjs                     node:test
│   ├── scenes/check_scenes.mjs           renders each scene through `hyperframes check`
│   ├── fixtures/hero.html                sample hero scene obeying the contract
│   ├── e2e/{run_local.sh,edl.highlight.json,edl.cinematic.json}
│   └── evals/trigger-prompts.json
├── package.json, pytest.ini, .gitignore, LICENSE, README.md, LICENSES-MUSIC.md
└── docs/superpowers/{specs,plans}/
```

All commands below run from the repo root `/Users/TonyStark/Desktop/web/yt-trailer` unless stated.

---

### Task 1: Repo scaffold and test harness

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `pytest.ini`, `.gitignore`, `LICENSE`
- Create: `tests/py/conftest.py`, `tests/py/test_fixtures.py`

**Interfaces:**
- Produces (pytest fixtures/helpers in `tests/py/conftest.py`): `ROOT: Path`, `SCRIPTS: Path`, `make_sample(path, seconds_per_color=6, audio=True) -> Path`, fixtures `sample_mp4`, `silent_mp4`, `workdir` (a fetched-style workdir from `sample_mp4`), helper `run_script(name, *args, env=None, cwd=None) -> CompletedProcess`. `SCRIPTS` is on `sys.path`, so tests can `import fetch, analyze, palette, verify`.
- Sample video facts later tasks rely on: 18 s, 320×180, 25 fps, red 0–6 s, green 6–12 s, blue 12–18 s, 440 Hz tone that is loud only from 9 to 10 s.

- [ ] **Step 1: Create plugin manifests**

`.claude-plugin/plugin.json`:
```json
{
  "name": "yt-trailer",
  "version": "0.1.0",
  "description": "Turn a YouTube URL or video file into a short, animated trailer rendered with HyperFrames.",
  "author": { "name": "Bhavya Kothari" },
  "repository": "https://github.com/amateurcoder015/claude-skill",
  "license": "MIT",
  "keywords": ["video", "trailer", "youtube", "hyperframes"]
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "yt-trailer",
  "owner": { "name": "amateurcoder015" },
  "plugins": [
    {
      "name": "yt-trailer",
      "source": "./",
      "description": "Turn a YouTube URL or video file into a short, animated trailer rendered with HyperFrames."
    }
  ]
}
```

- [ ] **Step 2: Create tool config files**

`package.json`:
```json
{
  "name": "yt-trailer",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test tests/js/",
    "test:scenes": "node tests/scenes/check_scenes.mjs",
    "test:e2e": "bash tests/e2e/run_local.sh"
  }
}
```

`pytest.ini`:
```ini
[pytest]
testpaths = tests/py
addopts = -q
```

`.gitignore`:
```
__pycache__/
.pytest_cache/
node_modules/
trailer-*/
*.pyc
.DS_Store
```

`LICENSE`: the standard MIT license text with the line `Copyright (c) 2026 Bhavya Kothari`.

- [ ] **Step 3: Write the shared test helpers**

`tests/py/conftest.py`:
```python
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
```

- [ ] **Step 4: Write a smoke test for the fixture**

`tests/py/test_fixtures.py`:
```python
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
```

- [ ] **Step 5: Run the tests**

Run: `python3 -m pip install -q pytest && python3 -m pytest`
Expected: `2 passed`.

Run: `mkdir -p tests/js && npm test`
Expected: exit 0, with Node reporting 0 tests.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin package.json pytest.ini .gitignore LICENSE tests/py
git commit -m "chore: scaffold plugin and test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Dependency doctor

**Files:**
- Create: `skills/yt-trailer/scripts/doctor.sh`
- Test: `tests/py/test_doctor.py`

**Interfaces:**
- Produces: `bash doctor.sh` exits 0 when all requirements are met (it may print `WARNING:` lines) and 1 otherwise. Each missing item prints `MISSING: <item>` followed by `    install: <command>`. The env var `YT_TRAILER_SKILL_ROOTS` (colon-separated) overrides where it looks for HyperFrames skills.

- [ ] **Step 1: Write the failing tests**

`tests/py/test_doctor.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/py/test_doctor.py`
Expected: 5 failures, because bash cannot open `doctor.sh`.

- [ ] **Step 3: Write doctor.sh**

`skills/yt-trailer/scripts/doctor.sh`:
```bash
#!/usr/bin/env bash
# Check yt-trailer runtime dependencies.
# Exit 0 when every requirement is met (warnings allowed), 1 otherwise.
set -u

os="$(uname -s)"
missing=0

fail() { echo "MISSING: $1"; missing=1; }

hint() { # $1 macOS command, $2 Linux command, $3 Windows command
  case "$os" in
    Darwin) echo "    install: $1" ;;
    Linux) echo "    install: $2" ;;
    *) echo "    install: $3" ;;
  esac
}

# Node.js 22+
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$node_major" -ge 22 ] 2>/dev/null; then
    echo "ok: Node.js $(node -v)"
  else
    fail "Node.js 22 or newer (found $(node -v 2>/dev/null))"
    hint "brew install node" "see https://nodejs.org/en/download (distro packages are often too old)" "winget install OpenJS.NodeJS"
  fi
else
  fail "Node.js 22 or newer"
  hint "brew install node" "see https://nodejs.org/en/download (distro packages are often too old)" "winget install OpenJS.NodeJS"
fi

# ffmpeg + ffprobe
for tool in ffmpeg ffprobe; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "ok: $tool"
  else
    fail "$tool"
    hint "brew install ffmpeg" "sudo apt-get install -y ffmpeg" "winget install Gyan.FFmpeg"
  fi
done

# Python 3.10+
if command -v python3 >/dev/null 2>&1 && [ "$(python3 -c 'import sys; print(int(sys.version_info >= (3, 10)))')" = "1" ]; then
  echo "ok: python3"
else
  fail "Python 3.10 or newer"
  hint "brew install python" "sudo apt-get install -y python3" "winget install Python.Python.3.12"
fi

# yt-dlp (plus a staleness warning)
if command -v yt-dlp >/dev/null 2>&1; then
  ver="$(yt-dlp --version 2>/dev/null | head -1)"
  echo "ok: yt-dlp $ver"
  age_days="$(python3 - "$ver" <<'PY'
import datetime, sys
try:
    d = datetime.datetime.strptime(sys.argv[1].strip()[:10], "%Y.%m.%d").date()
    print((datetime.date.today() - d).days)
except ValueError:
    print(-1)
PY
)"
  if [ "$age_days" -gt 30 ] 2>/dev/null; then
    echo "WARNING: yt-dlp $ver is $age_days days old. YouTube changes often break old versions."
    echo "    update: yt-dlp -U   (or: brew upgrade yt-dlp / python3 -m pip install -U yt-dlp)"
  fi
else
  fail "yt-dlp"
  hint "brew install yt-dlp" "python3 -m pip install -U yt-dlp" "winget install yt-dlp.yt-dlp"
fi

# HyperFrames agent skills
roots="${YT_TRAILER_SKILL_ROOTS:-$HOME/.claude/skills:$HOME/.claude/plugins:$PWD/.claude/skills}"
found=0
IFS=':' read -r -a root_list <<< "$roots"
for root in "${root_list[@]}"; do
  if [ -d "$root" ] && [ -n "$(find "$root" -maxdepth 6 -path '*hyperframes-core/SKILL.md' -print 2>/dev/null | head -1)" ]; then
    found=1
    break
  fi
done
if [ "$found" = "1" ]; then
  echo "ok: HyperFrames skills"
else
  fail "HyperFrames skills (hyperframes, hyperframes-core, hyperframes-animation, hyperframes-cli, hyperframes-registry)"
  echo "    install: follow the agent-skills setup at https://hyperframes.heygen.com"
fi

if [ "$missing" = "1" ]; then
  echo "Install the missing items above, then run /yt-trailer again."
  exit 1
fi
echo "All dependencies OK"
exit 0
```

Run: `chmod +x skills/yt-trailer/scripts/doctor.sh`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/py/test_doctor.py`
Expected: `5 passed`.

Run on the real machine: `bash skills/yt-trailer/scripts/doctor.sh`
Expected: `MISSING: yt-dlp` (it is not installed here) and exit 1. Then run `brew install yt-dlp` and run doctor again. Expected: `All dependencies OK`.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scripts/doctor.sh tests/py/test_doctor.py
git commit -m "feat: add dependency doctor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: fetch.py (download or import)

**Files:**
- Create: `skills/yt-trailer/scripts/fetch.py`
- Test: `tests/py/test_fetch.py`

**Interfaces:**
- Consumes: `conftest.run_script`, `sample_mp4`.
- Produces:
  - CLI: `fetch.py (--url URL | --file PATH) [--out-root DIR] [--cookies-from-browser NAME]`. On success it prints `{"workdir": "<abs path>", "videoId": "<id>"}` and exits 0. On a user-facing error it prints `ERROR: <message>` and exits 2.
  - `source/info.json` keys: `id, title, channel, description, duration, categories, tags, chapters[{start,end,title}], source ("youtube"|"file"), url, hasAudio`.
  - Python functions: `classify_error(stderr) -> str`, `pick_captions(info) -> tuple[str, str] | None`, `normalize_info(raw, source, url) -> dict`, `check_duration(seconds) -> None` (raises `FetchError`), `class FetchError(Exception)`.
  - Constants: `MAX_DURATION = 7200`, `MIN_DURATION = 15`.
  - Local file ids are `local-<slug of file stem>`.

- [ ] **Step 1: Write the failing tests**

`tests/py/test_fetch.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/py/test_fetch.py`
Expected: collection error `ModuleNotFoundError: No module named 'fetch'`.

- [ ] **Step 3: Write fetch.py**

`skills/yt-trailer/scripts/fetch.py`:
```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/py/test_fetch.py`
Expected: all tests pass (21 including parametrized cases).

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scripts/fetch.py tests/py/test_fetch.py
git commit -m "feat: add fetch script for YouTube URLs and local files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: analyze.py (candidate moments)

**Files:**
- Create: `skills/yt-trailer/scripts/analyze.py`
- Test: `tests/py/test_analyze.py`

**Interfaces:**
- Consumes: workdir layout from Task 3; `workdir`, `silent_mp4` fixtures.
- Produces: `analyze.py WORKDIR` writes `WORKDIR/candidates.json`:
  ```json
  {"title": "...", "duration": 18.0, "hasCaptions": true, "chapters": [...],
   "scenes": [6.0, 12.0], "peaks": [{"t": 9.0, "lufs": -20.1}],
   "transcript": [{"start": 1.0, "end": 3.0, "text": "..."}],
   "transcriptCompacted": false}
  ```
- Python functions: `parse_vtt(text) -> list[dict]`, `pick_peaks(per_second: dict[int, float]) -> list[dict]`, `fit_budget(doc, budget=30000) -> dict`, `encoded_size(doc) -> int`.

- [ ] **Step 1: Write the failing tests**

`tests/py/test_analyze.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/py/test_analyze.py`
Expected: collection error `No module named 'analyze'`.

- [ ] **Step 3: Write analyze.py**

`skills/yt-trailer/scripts/analyze.py`:
```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/py/test_analyze.py`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scripts/analyze.py tests/py/test_analyze.py
git commit -m "feat: add analyze script for scene cuts, loud moments and transcript

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: palette.py

**Files:**
- Create: `skills/yt-trailer/scripts/palette.py`
- Test: `tests/py/test_palette.py`

**Interfaces:**
- Produces: `palette.py WORKDIR` writes `WORKDIR/palette.json` = `{"bg": "#rrggbb", "accent": "#rrggbb", "fg": "#rrggbb", "colors": ["#rrggbb", ...]}`. `bg` always has luminance ≤ 0.08 and `fg` always has luminance ≥ 0.75.
- Functions: `dominant_colors(pixels: bytes, k=5) -> list[tuple[int,int,int]]`, `assign_roles(colors) -> dict`, `luminance(c) -> float`, `saturation(c) -> float`.

- [ ] **Step 1: Write the failing tests**

`tests/py/test_palette.py`:
```python
import json

from conftest import run_script

import palette


def hex_to_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def test_dominant_colors_finds_distinct_colors():
    pixels = bytes([250, 10, 10] * 60 + [10, 10, 250] * 30 + [245, 12, 12] * 10)
    colors = palette.dominant_colors(pixels, k=5)
    assert len(colors) == 2
    assert colors[0][0] > 200 and colors[1][2] > 200


def test_assign_roles_contrast_rules():
    roles = palette.assign_roles([(200, 200, 200), (40, 120, 220), (90, 90, 90)])
    assert palette.luminance(hex_to_rgb(roles["bg"])) <= 0.08
    assert palette.luminance(hex_to_rgb(roles["fg"])) >= 0.75
    assert roles["accent"] == "#2878dc"


def test_assign_roles_grey_video_gets_default_accent():
    roles = palette.assign_roles([(30, 30, 30), (128, 128, 128)])
    assert roles["accent"] == "#e8c37a"


def test_assign_roles_empty():
    assert palette.assign_roles([]) == {"bg": "#0b0b0f", "accent": "#e8c37a", "fg": "#f5f3ee", "colors": []}


def test_palette_sample(workdir):
    proc = run_script("palette.py", workdir)
    assert proc.returncode == 0, proc.stderr
    roles = json.loads((workdir / "palette.json").read_text())
    assert roles["accent"] in ("#f80808", "#08f808")
    assert palette.luminance(hex_to_rgb(roles["bg"])) <= 0.08
    assert palette.luminance(hex_to_rgb(roles["fg"])) >= 0.75
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/py/test_palette.py`
Expected: `No module named 'palette'`.

- [ ] **Step 3: Write palette.py**

`skills/yt-trailer/scripts/palette.py`:
```python
#!/usr/bin/env python3
"""Pick trailer colors from sampled video frames.

Usage: palette.py WORKDIR   (reads source/video.mp4 + source/info.json, writes palette.json)
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from collections import Counter
from pathlib import Path

DEFAULT_BG = (11, 11, 15)
DEFAULT_ACCENT = (232, 195, 122)
DEFAULT_FG = (245, 243, 238)


def sample_pixels(video: Path, duration: float, frames: int = 12) -> bytes:
    fps = frames / max(duration, 1.0)
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
         "-vf", f"fps={fps:.6f},scale=64:36", "-frames:v", str(frames),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="replace").strip()[-200:])
    return proc.stdout


def dist(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def dominant_colors(pixels: bytes, k: int = 5) -> list[tuple[int, int, int]]:
    counts: Counter = Counter()
    for i in range(0, len(pixels) - 2, 3):
        counts[(pixels[i] >> 4, pixels[i + 1] >> 4, pixels[i + 2] >> 4)] += 1
    chosen: list[tuple[int, int, int]] = []
    for (qr, qg, qb), _ in counts.most_common():
        color = (qr * 16 + 8, qg * 16 + 8, qb * 16 + 8)
        if all(dist(color, other) > 60 for other in chosen):
            chosen.append(color)
        if len(chosen) == k:
            break
    return chosen


def luminance(c) -> float:
    r, g, b = (v / 255 for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def saturation(c) -> float:
    hi, lo = max(c) / 255, min(c) / 255
    return 0.0 if hi == 0 else (hi - lo) / hi


def mix(c, other, t: float):
    return tuple(round(a + (b - a) * t) for a, b in zip(c, other))


def to_hex(c) -> str:
    return "#%02x%02x%02x" % tuple(c)


def assign_roles(colors: list) -> dict:
    if not colors:
        return {"bg": to_hex(DEFAULT_BG), "accent": to_hex(DEFAULT_ACCENT), "fg": to_hex(DEFAULT_FG), "colors": []}
    bg = min(colors, key=luminance)
    while luminance(bg) > 0.08:
        bg = mix(bg, (0, 0, 0), 0.5)
    mids = [c for c in colors if 0.15 <= luminance(c) <= 0.85] or colors
    accent = max(mids, key=saturation)
    if saturation(accent) < 0.25:
        accent = DEFAULT_ACCENT
    lightest = max(colors, key=luminance)
    fg = lightest if luminance(lightest) >= 0.75 else DEFAULT_FG
    return {"bg": to_hex(bg), "accent": to_hex(accent), "fg": to_hex(fg), "colors": [to_hex(c) for c in colors]}


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: palette.py WORKDIR", file=sys.stderr)
        return 2
    workdir = Path(argv[0])
    info = json.loads((workdir / "source" / "info.json").read_text())
    try:
        pixels = sample_pixels(workdir / "source" / "video.mp4", float(info.get("duration", 0)))
    except RuntimeError as exc:
        print(f"ERROR: could not sample frames: {exc}", file=sys.stderr)
        return 2
    roles = assign_roles(dominant_colors(pixels))
    (workdir / "palette.json").write_text(json.dumps(roles, indent=2))
    print(json.dumps(roles))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/py/test_palette.py`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scripts/palette.py tests/py/test_palette.py
git commit -m "feat: add palette extraction from video frames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Edit-plan model and validation

**Files:**
- Create: `skills/yt-trailer/scripts/lib/html.mjs`, `skills/yt-trailer/scripts/lib/timeline.mjs`, `skills/yt-trailer/scripts/lib/edl.mjs`, `skills/yt-trailer/schema/edl.schema.json`
- Test: `tests/js/fixtures.mjs`, `tests/js/edl.test.mjs`

**Interfaces:**
- Produces:
  - `html.mjs`: `esc(value) -> string` (escapes `& < > " '`).
  - `timeline.mjs`: `round(n)` (3 decimals), `clipRate(scene) -> 0.5 | 1.5 | 1`, `sceneDuration(scene) -> number`, `layout(scenes) -> Array<scene & {start, dur}>`.
  - `edl.mjs`: constants `STYLES, FORMATS, DURATIONS, CLIP_FX, MOTION_FX, OVERLAYS, TITLE_SCENES, DEFAULT_TITLE`; `resolveTrack(track, skillDir) -> string`; `validateEdl(edl, {sourceDuration, skillDir, workDir}) -> string[]` (empty means valid).
  - `tests/js/fixtures.mjs`: `validEdl() -> object` (30 s highlight plan for a 120 s source), `CTX` builder `ctx(overrides)`.

Clip duration rule: `(out - in) / rate`, where rate is 0.5 for `slowmo`, 1.5 for `speed-ramp` (a 1→2 ramp), else 1. Every other scene uses `dur`.

- [ ] **Step 1: Write the fixtures and failing tests**

`tests/js/fixtures.mjs`:
```js
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SKILL_DIR = join(ROOT, "skills", "yt-trailer");

export function validEdl() {
  return {
    style: "highlight",
    styleReason: "Tutorial with a single speaker",
    format: "16:9",
    duration: 30,
    palette: { bg: "#0b0f1a", accent: "#e8c37a", fg: "#f4f1ea" },
    music: null,
    overlays: [],
    scenes: [
      { type: "title", scene: "highlight/chapter-bumper", text: "PART ONE", sub: "THE BASICS", dur: 2 },
      { type: "clip", in: 5, out: 8, audio: "original", caption: "Tom's \"big\" <idea> & more" },
      { type: "clip", in: 15, out: 18, fx: ["push-in"] },
      { type: "clip", in: 25, out: 28 },
      { type: "clip", in: 35, out: 38, fx: ["zoom-in"] },
      { type: "clip", in: 45, out: 48 },
      { type: "clip", in: 55, out: 58, audio: "mute" },
      { type: "title", scene: "highlight/quote-card", text: "Every frame tells a story", dur: 3 },
      { type: "clip", in: 65, out: 68 },
      { type: "end-card", title: "Sample & \"Quotes\"", sub: "Chan", dur: 4 },
    ],
  };
}

export function ctx(overrides = {}) {
  return { sourceDuration: 120, skillDir: SKILL_DIR, workDir: mkdtempSync(join(tmpdir(), "ytt-")), ...overrides };
}
```

`tests/js/edl.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateEdl, STYLES, FORMATS, CLIP_FX, OVERLAYS, TITLE_SCENES } from "../../skills/yt-trailer/scripts/lib/edl.mjs";
import { sceneDuration, layout } from "../../skills/yt-trailer/scripts/lib/timeline.mjs";
import { esc } from "../../skills/yt-trailer/scripts/lib/html.mjs";
import { validEdl, ctx, SKILL_DIR } from "./fixtures.mjs";

const has = (errors, needle) => errors.some((e) => e.includes(needle));

test("valid plan passes", () => {
  assert.deepEqual(validateEdl(validEdl(), ctx()), []);
});

test("style, format and duration are checked", () => {
  const edl = { ...validEdl(), style: "epic", format: "4:3", duration: 40 };
  const errors = validateEdl(edl, ctx());
  assert.ok(has(errors, "style"));
  assert.ok(has(errors, "format"));
  assert.ok(has(errors, "duration"));
});

test("clip outside the source is rejected", () => {
  const edl = validEdl();
  edl.scenes[1] = { type: "clip", in: 118, out: 121 };
  assert.ok(has(validateEdl(edl, ctx()), "within 0..120"));
});

test("durations must add up", () => {
  const edl = validEdl();
  edl.scenes.at(-1).dur = 6;
  assert.ok(has(validateEdl(edl, ctx()), "add up to 32.00s"));
});

test("end-card must be last and unique", () => {
  const edl = validEdl();
  edl.scenes.unshift(edl.scenes.pop());
  assert.ok(has(validateEdl(edl, ctx()), "end-card"));
});

test("shot count limits", () => {
  const edl = validEdl();
  edl.scenes = edl.scenes.filter((s, i) => !(s.type === "clip" && i > 4));
  assert.ok(has(validateEdl(edl, ctx()), "6-15"));
});

test("title scene, text length and fx combinations", () => {
  const edl = validEdl();
  edl.scenes[0] = { type: "title", scene: "highlight/nope", text: "X".repeat(41), dur: 2 };
  edl.scenes[2] = { type: "clip", in: 15, out: 18, fx: ["slowmo", "speed-ramp"] };
  edl.scenes[3] = { type: "clip", in: 25, out: 28, fx: ["push-in", "zoom-in"] };
  const errors = validateEdl(edl, ctx());
  assert.ok(has(errors, "unknown title scene"));
  assert.ok(has(errors, "at most 40"));
  assert.ok(has(errors, "slowmo and speed-ramp"));
  assert.ok(has(errors, "at most one of"));
});

test("quote-card allows longer text", () => {
  const edl = validEdl();
  edl.scenes[7].text = "Y".repeat(100);
  assert.deepEqual(validateEdl(edl, ctx()), []);
});

test("hero needs custom/hero.html", () => {
  const edl = validEdl();
  edl.scenes[0] = { type: "hero", dur: 2 };
  const c = ctx();
  assert.ok(has(validateEdl(edl, c), "custom/hero.html"));
  mkdirSync(join(c.workDir, "custom"));
  writeFileSync(join(c.workDir, "custom", "hero.html"), "<template></template>");
  assert.deepEqual(validateEdl(edl, c), []);
});

test("music track must exist", () => {
  const edl = { ...validEdl(), music: { track: "assets/music/missing.mp3", duck: true } };
  assert.ok(has(validateEdl(edl, ctx()), "music.track not found"));
});

test("montage panels count as shots and must fit the source", () => {
  const edl = validEdl();
  edl.scenes[7] = { type: "montage", panels: [{ in: 10 }, { in: 119 }], dur: 3 };
  assert.ok(has(validateEdl(edl, ctx()), "panels[1]"));
});

test("sceneDuration applies playback rate", () => {
  assert.equal(sceneDuration({ type: "clip", in: 10, out: 12, fx: ["slowmo"] }), 4);
  assert.equal(sceneDuration({ type: "clip", in: 10, out: 13, fx: ["speed-ramp"] }), 2);
  assert.equal(sceneDuration({ type: "title", dur: 2.5 }), 2.5);
});

test("layout assigns start times", () => {
  const timed = layout(validEdl().scenes);
  assert.deepEqual(timed.slice(0, 3).map((s) => [s.start, s.dur]), [[0, 2], [2, 3], [5, 3]]);
});

test("esc escapes html", () => {
  assert.equal(esc(`<a href="x">Tom's & co</a>`), "&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; co&lt;/a&gt;");
});

test("schema enums match validator constants", () => {
  const schema = JSON.parse(readFileSync(join(SKILL_DIR, "schema", "edl.schema.json"), "utf8"));
  assert.deepEqual(schema.properties.style.enum, STYLES);
  assert.deepEqual(schema.properties.format.enum, FORMATS);
  assert.deepEqual(schema.properties.overlays.items.enum, OVERLAYS);
  assert.deepEqual(schema.$defs.clip.properties.fx.items.enum, CLIP_FX);
  assert.deepEqual(schema.$defs.title.properties.scene.enum, TITLE_SCENES);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/edl.mjs`.

- [ ] **Step 3: Write html.mjs and timeline.mjs**

`skills/yt-trailer/scripts/lib/html.mjs`:
```js
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

`skills/yt-trailer/scripts/lib/timeline.mjs`:
```js
export const round = (n) => Math.round(n * 1000) / 1000;

export function clipRate(scene) {
  const fx = scene.fx || [];
  if (fx.includes("slowmo")) return 0.5;
  if (fx.includes("speed-ramp")) return 1.5;
  return 1;
}

export function sceneDuration(scene) {
  if (scene.type === "clip") return (scene.out - scene.in) / clipRate(scene);
  return scene.dur;
}

export function layout(scenes) {
  let t = 0;
  return scenes.map((scene) => {
    const dur = sceneDuration(scene);
    const timed = { ...scene, start: round(t), dur: round(dur) };
    t += dur;
    return timed;
  });
}
```

- [ ] **Step 4: Write edl.mjs**

`skills/yt-trailer/scripts/lib/edl.mjs`:
```js
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { sceneDuration } from "./timeline.mjs";

export const STYLES = ["cinematic", "highlight", "hype"];
export const FORMATS = ["16:9", "9:16"];
export const DURATIONS = [30, 45, 60];
export const CLIP_FX = ["slowmo", "speed-ramp", "flash-punch", "push-in", "zoom-in"];
export const MOTION_FX = ["flash-punch", "push-in", "zoom-in"];
export const OVERLAYS = ["letterbox", "grain-lightleak", "glitch-rgb"];
export const TITLE_SCENES = [
  "cinematic/slow-push-title",
  "cinematic/black-to-title",
  "hype/kinetic-slam",
  "highlight/quote-card",
  "highlight/chapter-bumper",
];
export const DEFAULT_TITLE = {
  cinematic: "cinematic/slow-push-title",
  hype: "hype/kinetic-slam",
  highlight: "highlight/chapter-bumper",
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v) => typeof v === "number" && Number.isFinite(v);

export function resolveTrack(track, skillDir) {
  return isAbsolute(track) ? track : join(skillDir, track);
}

function requireText(value, at, max, err) {
  if (typeof value !== "string" || !value.trim()) err(`${at} must be non-empty text`);
  else if (value.length > max) err(`${at} must be at most ${max} characters`);
}

function requireDur(scene, at, err, min, max) {
  if (!num(scene.dur) || scene.dur < min || scene.dur > max) err(`${at}: dur must be a number from ${min} to ${max}`);
}

function validateScene(s, i, ctx, err) {
  const at = `scenes[${i}]`;
  switch (s?.type) {
    case "clip": {
      if (!num(s.in) || !num(s.out)) {
        err(`${at}: clip needs numeric in and out`);
        return;
      }
      if (s.in < 0 || s.out > ctx.sourceDuration) err(`${at}: in/out must be within 0..${ctx.sourceDuration}`);
      if (s.out - s.in < 0.3) err(`${at}: clip must be at least 0.3s long (out > in)`);
      const fx = s.fx || [];
      for (const f of fx) if (!CLIP_FX.includes(f)) err(`${at}: unknown fx "${f}"; use ${CLIP_FX.join(", ")}`);
      if (fx.includes("slowmo") && fx.includes("speed-ramp")) err(`${at}: slowmo and speed-ramp cannot be combined`);
      if (fx.filter((f) => MOTION_FX.includes(f)).length > 1) err(`${at}: use at most one of ${MOTION_FX.join(", ")}`);
      if (s.audio != null && !["original", "mute"].includes(s.audio)) err(`${at}: audio must be "original" or "mute"`);
      if (s.cropX != null && !(num(s.cropX) && s.cropX >= 0 && s.cropX <= 1)) err(`${at}: cropX must be between 0 and 1`);
      if (s.caption != null) requireText(s.caption, `${at}.caption`, 80, err);
      return;
    }
    case "montage": {
      if (!Array.isArray(s.panels) || s.panels.length < 2 || s.panels.length > 3) err(`${at}: montage needs 2-3 panels`);
      requireDur(s, at, err, 1, 6);
      (s.panels || []).forEach((p, j) => {
        if (!num(p?.in) || p.in < 0 || p.in + (s.dur || 0) > ctx.sourceDuration) {
          err(`${at}.panels[${j}]: in must be a number with in + dur within the video`);
        }
      });
      return;
    }
    case "title":
      if (!TITLE_SCENES.includes(s.scene)) err(`${at}: unknown title scene "${s.scene}"; use ${TITLE_SCENES.join(", ")}`);
      requireText(s.text, `${at}.text`, s.scene === "highlight/quote-card" ? 120 : 40, err);
      if (s.sub != null && typeof s.sub !== "string") err(`${at}.sub must be text`);
      requireDur(s, at, err, 1, 6);
      return;
    case "hero":
      requireDur(s, at, err, 2, 8);
      if (s.text != null) requireText(s.text, `${at}.text`, 40, err);
      if (!existsSync(join(ctx.workDir, "custom", "hero.html"))) err(`${at}: custom/hero.html is missing`);
      return;
    case "end-card":
      requireText(s.title, `${at}.title`, 80, err);
      requireDur(s, at, err, 2, 6);
      return;
    default:
      err(`${at}: unknown type "${s?.type}"; use clip, montage, title, hero or end-card`);
  }
}

export function validateEdl(edl, ctx) {
  if (!edl || typeof edl !== "object") return ["edl.json must be a JSON object"];
  const errors = [];
  const err = (m) => errors.push(m);
  if (!STYLES.includes(edl.style)) err(`style must be one of ${STYLES.join(", ")}`);
  if (!FORMATS.includes(edl.format)) err('format must be "16:9" or "9:16"');
  if (!DURATIONS.includes(edl.duration)) err(`duration must be one of ${DURATIONS.join(", ")}`);
  const palette = edl.palette || {};
  for (const key of ["bg", "accent", "fg"]) if (!HEX.test(palette[key] || "")) err(`palette.${key} must be a #rrggbb color`);
  if (edl.music != null) {
    if (typeof edl.music.track !== "string") err("music.track must be a file path");
    else if (!existsSync(resolveTrack(edl.music.track, ctx.skillDir))) err(`music.track not found: ${edl.music.track}`);
    if (edl.music.volume != null && !(num(edl.music.volume) && edl.music.volume > 0 && edl.music.volume <= 1)) {
      err("music.volume must be in (0, 1]");
    }
  }
  for (const o of edl.overlays || []) if (!OVERLAYS.includes(o)) err(`unknown overlay "${o}"; use ${OVERLAYS.join(", ")}`);
  const scenes = Array.isArray(edl.scenes) ? edl.scenes : [];
  if (!scenes.length) err("scenes must be a non-empty array");
  scenes.forEach((s, i) => validateScene(s, i, ctx, err));
  const endCards = scenes.filter((s) => s?.type === "end-card").length;
  if (endCards !== 1 || scenes.at(-1)?.type !== "end-card") err("exactly one end-card is required and it must be the last scene");
  if (scenes.filter((s) => s?.type === "hero").length > 1) err("at most one hero scene is allowed");
  const shots =
    scenes.filter((s) => s?.type === "clip").length +
    scenes.filter((s) => s?.type === "montage").reduce((n, s) => n + (s.panels?.length || 0), 0);
  if (shots < 6 || shots > 15) err(`use 6-15 shots (clips plus montage panels); found ${shots}`);
  if (errors.length === 0) {
    const total = scenes.reduce((n, s) => n + sceneDuration(s), 0);
    if (Math.abs(total - edl.duration) > 0.5) {
      err(`scene durations add up to ${total.toFixed(2)}s; they must equal duration ${edl.duration}s (±0.5s)`);
    }
  }
  return errors;
}
```

- [ ] **Step 5: Write the JSON Schema**

`skills/yt-trailer/schema/edl.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "yt-trailer edit plan (edl.json)",
  "description": "Written by Claude, validated by scripts/build.mjs. Clip duration = (out - in) / rate, where rate is 0.5 for slowmo, 1.5 for speed-ramp, else 1. Every other scene uses dur. All scene durations must sum to duration (±0.5 s).",
  "type": "object",
  "required": ["style", "format", "duration", "palette", "scenes"],
  "properties": {
    "style": { "enum": ["cinematic", "highlight", "hype"] },
    "styleReason": { "type": "string" },
    "format": { "enum": ["16:9", "9:16"] },
    "duration": { "enum": [30, 45, 60] },
    "palette": {
      "type": "object",
      "required": ["bg", "accent", "fg"],
      "properties": {
        "bg": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
        "accent": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
        "fg": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" }
      }
    },
    "music": {
      "oneOf": [
        { "type": "null" },
        {
          "type": "object",
          "required": ["track"],
          "properties": {
            "track": { "type": "string", "description": "Relative to the skill dir (bundled) or absolute (user file)" },
            "duck": { "type": "boolean", "default": true },
            "volume": { "type": "number", "exclusiveMinimum": 0, "maximum": 1, "default": 0.8 }
          }
        }
      ]
    },
    "overlays": { "type": "array", "items": { "enum": ["letterbox", "grain-lightleak", "glitch-rgb"] } },
    "scenes": {
      "type": "array",
      "minItems": 2,
      "items": {
        "oneOf": [
          { "$ref": "#/$defs/clip" },
          { "$ref": "#/$defs/montage" },
          { "$ref": "#/$defs/title" },
          { "$ref": "#/$defs/hero" },
          { "$ref": "#/$defs/endCard" }
        ]
      }
    }
  },
  "$defs": {
    "clip": {
      "type": "object",
      "required": ["type", "in", "out"],
      "properties": {
        "type": { "const": "clip" },
        "in": { "type": "number", "minimum": 0 },
        "out": { "type": "number" },
        "audio": { "enum": ["original", "mute"], "default": "original" },
        "fx": { "type": "array", "items": { "enum": ["slowmo", "speed-ramp", "flash-punch", "push-in", "zoom-in"] } },
        "cropX": { "type": "number", "minimum": 0, "maximum": 1 },
        "caption": { "type": "string", "maxLength": 80 }
      }
    },
    "montage": {
      "type": "object",
      "required": ["type", "panels", "dur"],
      "properties": {
        "type": { "const": "montage" },
        "panels": { "type": "array", "minItems": 2, "maxItems": 3, "items": { "type": "object", "required": ["in"], "properties": { "in": { "type": "number", "minimum": 0 } } } },
        "dur": { "type": "number", "minimum": 1, "maximum": 6 }
      }
    },
    "title": {
      "type": "object",
      "required": ["type", "scene", "text", "dur"],
      "properties": {
        "type": { "const": "title" },
        "scene": { "enum": ["cinematic/slow-push-title", "cinematic/black-to-title", "hype/kinetic-slam", "highlight/quote-card", "highlight/chapter-bumper"] },
        "text": { "type": "string", "description": "Max 40 characters; 120 for highlight/quote-card" },
        "sub": { "type": "string" },
        "dur": { "type": "number", "minimum": 1, "maximum": 6 }
      }
    },
    "hero": {
      "type": "object",
      "required": ["type", "dur"],
      "properties": {
        "type": { "const": "hero" },
        "text": { "type": "string", "maxLength": 40 },
        "sub": { "type": "string" },
        "dur": { "type": "number", "minimum": 2, "maximum": 8 }
      }
    },
    "endCard": {
      "type": "object",
      "required": ["type", "title", "dur"],
      "properties": {
        "type": { "const": "end-card" },
        "title": { "type": "string", "maxLength": 80 },
        "sub": { "type": "string" },
        "dur": { "type": "number", "minimum": 2, "maximum": 6 }
      }
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: all 15 tests in `edl.test.mjs` pass.

- [ ] **Step 7: Commit**

```bash
git add skills/yt-trailer/scripts/lib skills/yt-trailer/schema tests/js
git commit -m "feat: add edit plan model, schema and validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Beat parsing and snapping

**Files:**
- Create: `skills/yt-trailer/scripts/lib/beats.mjs`
- Test: `tests/js/beats.test.mjs`

**Interfaces:**
- Consumes: `clipRate`, `sceneDuration`, `round` from `timeline.mjs`.
- Produces: `parseBeats(json) -> number[]` (sorted unique seconds), `snapToBeats(edl, beats, sourceDuration, tol = 0.15) -> edl` (new object). Each cut moves to the nearest beat within `tol` by changing the earlier scene's `out` (clips) or `dur` (others). The end-card `dur` absorbs the drift, so the total stays equal to `edl.duration`.

- [ ] **Step 1: Write the failing tests**

`tests/js/beats.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBeats, snapToBeats } from "../../skills/yt-trailer/scripts/lib/beats.mjs";

test("parseBeats accepts common shapes", () => {
  assert.deepEqual(parseBeats([2, 1, 1]), [1, 2]);
  assert.deepEqual(parseBeats({ bpm: 120, beats: [0.5, 1.0] }), [0.5, 1]);
  assert.deepEqual(parseBeats({ beats: [{ time: 1.5 }, { t: 0.5 }] }), [0.5, 1.5]);
  assert.deepEqual(parseBeats({ tempo: 90 }), []);
});

const edl = () => ({
  duration: 45,
  scenes: [
    { type: "title", dur: 2.05 },
    { type: "clip", in: 10, out: 12.9 },
    { type: "clip", in: 20, out: 21, fx: ["slowmo"] },
    { type: "end-card", dur: 38.05 },
  ],
});

test("snapToBeats moves cuts within tolerance and keeps total", () => {
  const out = snapToBeats(edl(), [2.0, 5.0, 7.1], 100);
  assert.equal(out.scenes[0].dur, 2.0);
  assert.equal(out.scenes[1].out, 13.0);
  assert.equal(out.scenes[2].out, 21.05); // slowmo: 0.1 s of timeline = 0.05 s of source
  const total = out.scenes[0].dur + (out.scenes[1].out - 10) + (out.scenes[2].out - 20) / 0.5 + out.scenes[3].dur;
  assert.ok(Math.abs(total - 45) < 0.001);
});

test("snapToBeats ignores far beats and empty input", () => {
  const original = edl();
  assert.deepEqual(snapToBeats(original, [], 100), original);
  const out = snapToBeats(original, [3.0], 100);
  assert.equal(out.scenes[0].dur, 2.05);
});

test("snapToBeats never extends a clip past the source", () => {
  const out = snapToBeats(edl(), [5.04], 12.95);
  assert.equal(out.scenes[1].out, 12.9);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/beats.mjs`.

- [ ] **Step 3: Write beats.mjs**

`skills/yt-trailer/scripts/lib/beats.mjs`:
```js
import { clipRate, sceneDuration, round } from "./timeline.mjs";

export function parseBeats(data) {
  const out = [];
  const visit = (value, key) => {
    if (typeof value === "number" && ["beats", "t", "time"].includes(key)) out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => visit(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  visit(data, "beats");
  return [...new Set(out.filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b);
}

export function snapToBeats(edl, beats, sourceDuration, tol = 0.15) {
  if (!beats.length) return edl;
  const scenes = edl.scenes.map((s) => ({ ...s }));
  let t = 0;
  for (let i = 0; i < scenes.length - 1; i++) {
    const s = scenes[i];
    const end = t + sceneDuration(s);
    const nearest = beats.reduce((best, b) => (Math.abs(b - end) < Math.abs(best - end) ? b : best), beats[0]);
    const delta = nearest - end;
    if (Math.abs(delta) <= tol && Math.abs(delta) > 0.001) {
      if (s.type === "clip") {
        const out = round(s.out + delta * clipRate(s));
        if (out <= sourceDuration && out - s.in >= 0.3) s.out = out;
      } else if (s.dur + delta >= 1) {
        s.dur = round(s.dur + delta);
      }
    }
    t += sceneDuration(s);
  }
  scenes.at(-1).dur = round(edl.duration - t);
  return { ...edl, scenes };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all beats tests pass, and the earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scripts/lib/beats.mjs tests/js/beats.test.mjs
git commit -m "feat: add beat parsing and cut snapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Compose the main HyperFrames composition

**Files:**
- Create: `skills/yt-trailer/scripts/lib/compose.mjs`
- Test: `tests/js/compose.test.mjs`

**Interfaces:**
- Consumes: `esc` (html.mjs), `layout, clipRate, round` (timeline.mjs), `validEdl()` fixture.
- Produces:
  - `DIMS = {"16:9": [1920,1080], "9:16": [1080,1920]}`
  - `speechWindows(timed, transcript, hasAudio = true) -> Array<[start, end]>` in trailer time, merged when the gap is ≤ 0.3 s.
  - `musicLane(windows, total, volume, duck) -> {version:1, lanes:[{target:"volume", points:[{t,v}]}]}`. It fades in over 0–0.5 s, drops to `volume*0.3` during speech, fades out over the last 1.5 s, and its `t` values strictly increase.
  - `composeIndex(edl, {transcript = [], musicSrc = null, hasAudio = true}) -> {html, subcomps}`. `subcomps` is `Array<{id, scene, vars:{TEXT, SUB, DUR, HITS?}}>`, where `scene` is `"<style>/<name>"`, `"overlays/<name>"` or `"hero"`. Scene `i` gets id `s<i>`, and overlays get id `ov-<name>`. Sub-composition hosts point at `compositions/<id>.html`.
  - Element ids in `index.html`: `s<i>-frame`, `s<i>-v`, `s<i>-a`, `s<i>-cap`, `s<i>-flash`, `s<i>-p<j>`, `s<i>-v<j>`, `music-bed`.

- [ ] **Step 1: Write the failing tests**

`tests/js/compose.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeIndex, speechWindows, musicLane } from "../../skills/yt-trailer/scripts/lib/compose.mjs";
import { layout } from "../../skills/yt-trailer/scripts/lib/timeline.mjs";
import { validEdl } from "./fixtures.mjs";

test("root, canvas and timeline registration", () => {
  const { html } = composeIndex(validEdl());
  assert.match(html, /data-composition-id="main"[^>]*data-width="1920"[^>]*data-height="1080"[^>]*data-duration="30"/);
  assert.match(html, /window\.__timelines\["main"\] = tl;/);
  assert.match(html, /gsap@3\.14\.2/);
});

test("vertical format uses 1080x1920", () => {
  const { html } = composeIndex({ ...validEdl(), format: "9:16" });
  assert.match(html, /data-width="1080"[^>]*data-height="1920"/);
});

test("clips become trimmed muted video plus audio", () => {
  const { html } = composeIndex(validEdl());
  assert.match(html, /<video id="s1-v" class="clip" src="assets\/video.mp4" data-start="2" data-duration="3" data-media-start="5"[^>]*muted playsinline>/);
  assert.match(html, /<audio id="s1-a" src="assets\/video.mp4" data-start="2" data-duration="3" data-media-start="5"/);
  assert.doesNotMatch(html, /id="s6-a"/); // audio: "mute"
});

test("no audio elements when the source has no audio", () => {
  const { html } = composeIndex(validEdl(), { hasAudio: false });
  assert.doesNotMatch(html, /<audio/);
});

test("slowmo and speed-ramp", () => {
  const edl = validEdl();
  edl.scenes[3] = { type: "clip", in: 25, out: 26.5, fx: ["slowmo"] };
  edl.scenes[5] = { type: "clip", in: 45, out: 49.5, fx: ["speed-ramp"] };
  const { html } = composeIndex(edl);
  assert.match(html, /id="s3-v"[^>]*data-duration="3"[^>]*data-playback-rate="0.5"/);
  assert.match(html, /id="s5-v"[^>]*data-automation='\{"version":1,"lanes":\[\{"target":"rate","points":\[\{"t":0,"v":1\},\{"t":3,"v":2\}\]\}\]\}'/);
});

test("caption text is escaped", () => {
  const { html } = composeIndex(validEdl());
  assert.ok(html.includes("Tom&#39;s &quot;big&quot; &lt;idea&gt; &amp; more"));
  assert.ok(!html.includes("<idea>"));
});

test("motion fx emit timeline tweens", () => {
  const edl = validEdl();
  edl.scenes[2].fx = ["flash-punch"];
  const { html } = composeIndex(edl);
  assert.match(html, /<div id="s2-flash" class="clip flash" data-start="5"/);
  assert.match(html, /tl\.fromTo\("#s2-frame", \{ scale: 1\.18 \}/);
  assert.match(html, /tl\.fromTo\("#s4-frame", \{ scale: 1\.25, filter: "blur\(14px\)" \}/);
});

test("sub-compositions for titles, end-card and overlays", () => {
  const edl = { ...validEdl(), overlays: ["letterbox", "glitch-rgb"] };
  const { html, subcomps } = composeIndex(edl);
  assert.deepEqual(subcomps.map((s) => [s.id, s.scene]), [
    ["s0", "highlight/chapter-bumper"],
    ["s7", "highlight/quote-card"],
    ["s9", "highlight/end-card"],
    ["ov-letterbox", "overlays/letterbox"],
    ["ov-glitch-rgb", "overlays/glitch-rgb"],
  ]);
  assert.equal(subcomps[2].vars.TEXT, 'Sample & "Quotes"');
  assert.equal(subcomps[2].vars.DUR, 4);
  assert.deepEqual(JSON.parse(subcomps[4].vars.HITS), [2, 5, 8, 11, 14, 17, 20, 23, 26]);
  assert.match(html, /<div id="s0" class="layer" data-composition-id="s0" data-composition-src="compositions\/s0.html" data-start="0" data-duration="2"/);
  assert.match(html, /id="ov-letterbox"[^>]*data-start="0" data-duration="30"/);
});

test("montage panels", () => {
  const edl = validEdl();
  edl.scenes[7] = { type: "montage", panels: [{ in: 70 }, { in: 80 }, { in: 90 }], dur: 3 };
  const { html } = composeIndex(edl);
  assert.match(html, /<div class="montage" id="s7" style="grid-template-columns:repeat\(3,1fr\)">/);
  assert.match(html, /id="s7-v2"[^>]*data-media-start="90"[^>]*data-track-index="22"/);
});

test("speech windows map transcript into trailer time", () => {
  const timed = layout(validEdl().scenes);
  const transcript = [
    { start: 5.5, end: 7.0, text: "a" },   // inside clip s1 (in 5, starts at 2)
    { start: 56, end: 57, text: "muted" }, // inside the muted clip s6
  ];
  assert.deepEqual(speechWindows(timed, transcript), [[2.5, 4]]);
  assert.deepEqual(speechWindows(timed, transcript, false), []);
});

test("music lane ducks under speech and stays increasing", () => {
  const lane = musicLane([[2.5, 4]], 30, 0.8, true);
  const pts = lane.lanes[0].points;
  assert.deepEqual(pts[0], { t: 0, v: 0 });
  assert.ok(pts.some((p) => p.v === 0.24));
  assert.deepEqual(pts.at(-1), { t: 30, v: 0 });
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].t > pts[i - 1].t);
  const flat = musicLane([[2.5, 4]], 30, 0.8, false).lanes[0].points;
  assert.ok(!flat.some((p) => p.v === 0.24));
});

test("music bed element", () => {
  const edl = { ...validEdl(), music: { track: "assets/music/highlight-1.mp3", duck: true } };
  const { html } = composeIndex(edl, { musicSrc: "assets/music.mp3" });
  assert.match(html, /<audio id="music-bed" data-timeline-role="music" src="assets\/music.mp3" data-start="0" data-duration="30"/);
});

test("last scene is stretched to the exact total", () => {
  const edl = validEdl();
  edl.scenes.at(-1).dur = 3.7; // sum 29.7, within tolerance
  const { subcomps, html } = composeIndex(edl);
  assert.equal(subcomps.find((s) => s.id === "s9").vars.DUR, 4);
  assert.match(html, /id="s9"[^>]*data-start="26" data-duration="4"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/compose.mjs`.

- [ ] **Step 3: Write compose.mjs**

`skills/yt-trailer/scripts/lib/compose.mjs`:
```js
import { esc } from "./html.mjs";
import { layout, clipRate, round } from "./timeline.mjs";

export const DIMS = { "16:9": [1920, 1080], "9:16": [1080, 1920] };
const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap";

export function speechWindows(timed, transcript, hasAudio = true) {
  if (!hasAudio) return [];
  const windows = [];
  for (const s of timed) {
    if (s.type !== "clip" || s.audio === "mute") continue;
    const rate = clipRate(s);
    for (const line of transcript) {
      const a = Math.max(line.start, s.in);
      const b = Math.min(line.end, s.out);
      if (b <= a) continue;
      windows.push([round(s.start + (a - s.in) / rate), round(s.start + (b - s.in) / rate)]);
    }
  }
  windows.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const w of windows) {
    const last = merged.at(-1);
    if (last && w[0] <= last[1] + 0.3) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged;
}

export function musicLane(windows, total, volume, duck) {
  const low = round(volume * 0.3);
  const fade = 0.15;
  const pts = [{ t: 0, v: 0 }, { t: 0.5, v: volume }];
  if (duck) {
    for (const [a, b] of windows) {
      const s = Math.max(0.5, a - fade);
      const e = Math.min(total - 1.5, b + fade);
      if (e - s < 2 * fade) continue;
      pts.push({ t: round(s), v: volume }, { t: round(s + fade), v: low }, { t: round(e - fade), v: low }, { t: round(e), v: volume });
    }
  }
  pts.push({ t: round(total - 1.5), v: volume }, { t: round(total), v: 0 });
  const out = [];
  for (const p of pts) if (!out.length || p.t > out.at(-1).t) out.push(p);
  return { version: 1, lanes: [{ target: "volume", points: out }] };
}

function hostDiv(id, start, dur, W, H, track) {
  return `<div id="${id}" class="layer" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${start}" data-duration="${dur}" data-track-index="${track}" data-width="${W}" data-height="${H}" style="z-index:${track}"></div>`;
}

function clipParts(s, id, hasAudio) {
  const fx = s.fx || [];
  const timing = `data-start="${s.start}" data-duration="${s.dur}" data-media-start="${s.in}"`;
  let speed = "";
  if (fx.includes("speed-ramp")) {
    const lane = { version: 1, lanes: [{ target: "rate", points: [{ t: 0, v: 1 }, { t: s.dur, v: 2 }] }] };
    speed = ` data-automation='${JSON.stringify(lane)}'`;
  } else if (clipRate(s) !== 1) {
    speed = ` data-playback-rate="${clipRate(s)}"`;
  }
  const pos = s.cropX != null ? ` style="object-position:${round(s.cropX * 100)}% 50%"` : "";
  const html = [
    `<div class="frame" id="${id}-frame"><video id="${id}-v" class="clip" src="assets/video.mp4" ${timing} data-track-index="0"${speed}${pos} muted playsinline></video></div>`,
  ];
  if (hasAudio && s.audio !== "mute") {
    html.push(`<audio id="${id}-a" src="assets/video.mp4" ${timing} data-track-index="10" data-volume="1"${speed}></audio>`);
  }
  const frame = `#${id}-frame`;
  const js = [];
  if (fx.includes("flash-punch")) {
    html.push(`<div id="${id}-flash" class="clip flash" data-start="${s.start}" data-duration="0.3" data-track-index="4"></div>`);
    js.push(`tl.fromTo("#${id}-flash", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power2.out" }, ${s.start});`);
    js.push(`tl.fromTo("${frame}", { scale: 1.18 }, { scale: 1, duration: 0.35, ease: "expo.out" }, ${s.start});`);
  } else if (fx.includes("zoom-in")) {
    js.push(`tl.fromTo("${frame}", { scale: 1.25, filter: "blur(14px)" }, { scale: 1.02, filter: "blur(0px)", duration: ${round(Math.min(0.6, s.dur))}, ease: "power3.out" }, ${s.start});`);
  } else if (fx.includes("push-in")) {
    js.push(`tl.fromTo("${frame}", { scale: 1 }, { scale: 1.15, duration: ${s.dur}, ease: "power1.inOut" }, ${s.start});`);
  } else {
    js.push(`tl.fromTo("${frame}", { scale: 1 }, { scale: 1.04, duration: ${s.dur}, ease: "none" }, ${s.start});`);
  }
  if (s.caption) {
    html.push(`<div id="${id}-cap" class="clip lower-third" data-start="${s.start}" data-duration="${s.dur}" data-track-index="3"><span class="lt-bar"></span><span class="lt-text">${esc(s.caption)}</span></div>`);
    js.push(`tl.fromTo("#${id}-cap .lt-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "power3.out" }, ${round(s.start + 0.1)});`);
    js.push(`tl.fromTo("#${id}-cap .lt-text", { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, ${round(s.start + 0.2)});`);
  }
  return { html, js };
}

function montageParts(s, id, vertical) {
  const n = s.panels.length;
  const grid = vertical ? `grid-template-rows:repeat(${n},1fr)` : `grid-template-columns:repeat(${n},1fr)`;
  const axis = vertical ? "xPercent" : "yPercent";
  const panels = s.panels
    .map((p, j) => `<div class="panel" id="${id}-p${j}"><video id="${id}-v${j}" class="clip" src="assets/video.mp4" data-start="${s.start}" data-duration="${s.dur}" data-media-start="${p.in}" data-track-index="${20 + j}" muted playsinline></video></div>`)
    .join("");
  const js = s.panels.map(
    (_, j) => `tl.fromTo("#${id}-p${j}", { ${axis}: ${j % 2 ? 110 : -110}, opacity: 0 }, { ${axis}: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, ${round(s.start + j * 0.12)});`,
  );
  return { html: [`<div class="montage" id="${id}" style="${grid}">${panels}</div>`], js };
}

export function composeIndex(edl, { transcript = [], musicSrc = null, hasAudio = true } = {}) {
  const [W, H] = DIMS[edl.format];
  const total = edl.duration;
  const timed = layout(edl.scenes);
  const last = timed.at(-1);
  last.dur = round(total - last.start);
  const body = [];
  const js = [];
  const subcomps = [];
  timed.forEach((s, i) => {
    const id = `s${i}`;
    if (s.type === "clip" || s.type === "montage") {
      const parts = s.type === "clip" ? clipParts(s, id, hasAudio) : montageParts(s, id, edl.format === "9:16");
      body.push(...parts.html);
      js.push(...parts.js);
      return;
    }
    const scene = s.type === "title" ? s.scene : s.type === "end-card" ? `${edl.style}/end-card` : "hero";
    subcomps.push({ id, scene, vars: { TEXT: s.text ?? s.title ?? "", SUB: s.sub ?? "", DUR: s.dur } });
    body.push(hostDiv(id, s.start, s.dur, W, H, 2));
  });
  const cuts = timed.slice(1).map((s) => s.start);
  (edl.overlays || []).forEach((name, k) => {
    const id = `ov-${name}`;
    subcomps.push({ id, scene: `overlays/${name}`, vars: { TEXT: "", SUB: "", DUR: total, HITS: JSON.stringify(cuts) } });
    body.push(hostDiv(id, 0, total, W, H, 5 + k));
  });
  if (edl.music && musicSrc) {
    const lane = musicLane(speechWindows(timed, transcript, hasAudio), total, edl.music.volume ?? 0.8, edl.music.duck !== false);
    body.push(`<audio id="music-bed" data-timeline-role="music" src="${musicSrc}" data-start="0" data-duration="${total}" data-track-index="11" data-volume="1" data-automation='${JSON.stringify(lane)}'></audio>`);
  }
  const { bg, accent, fg } = edl.palette;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="${GSAP}"></script>
    <link rel="stylesheet" href="${FONTS}" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${bg}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${bg}; font-family: Inter, system-ui, sans-serif; }
      .frame { position: absolute; inset: 0; overflow: hidden; z-index: 1; }
      .frame video, .panel video { display: block; width: 100%; height: 100%; object-fit: cover; }
      .montage { position: absolute; inset: 0; display: grid; gap: 12px; padding: 12px; z-index: 1; }
      .panel { position: relative; overflow: hidden; border-radius: 8px; }
      .layer { position: absolute; inset: 0; }
      .flash { position: absolute; inset: 0; background: #fff; z-index: 4; }
      .lower-third { position: absolute; left: 6%; bottom: 9%; max-width: 80%; display: flex; align-items: stretch; gap: 18px; z-index: 3; }
      .lt-bar { width: 10px; background: ${accent}; transform-origin: 50% 100%; }
      .lt-text { font: 600 44px/1.25 Inter, system-ui, sans-serif; color: ${fg}; background: rgba(0, 0, 0, 0.5); padding: 12px 22px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">
      ${body.join("\n      ")}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${js.join("\n      ")}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  return { html, subcomps };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all compose tests pass, and the earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scripts/lib/compose.mjs tests/js/compose.test.mjs
git commit -m "feat: compose HyperFrames index from edit plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Scene filling and build.mjs

**Files:**
- Create: `skills/yt-trailer/scripts/lib/scenes.mjs`, `skills/yt-trailer/scripts/lib/project.mjs`, `skills/yt-trailer/scripts/build.mjs`
- Test: `tests/js/scenes.test.mjs` (fillScene part), `tests/js/build.test.mjs`
- Temporary: `tests/js/stub-scenes/` used only by `build.test.mjs` (real scenes arrive in Tasks 11–14)

**Interfaces:**
- Consumes: `validateEdl, DEFAULT_TITLE, resolveTrack` (edl.mjs), `composeIndex, DIMS` (compose.mjs), `parseBeats, snapToBeats` (beats.mjs), `esc` (html.mjs).
- Produces:
  - `scenes.mjs`: `fillScene(template, vars) -> string`. It replaces `__KEY__` tokens, HTML-escapes `TEXT` and `SUB`, inserts the others raw, and throws `unfilled scene tokens: __X__` if any `__[A-Z]+__` token remains.
  - `project.mjs`: `HF_VERSION = "0.8.104"`, `HF_CONFIG` (object written as `hyperframes.json`).
  - `build.mjs`: `build(workDir, {beatsFile, noHero, scenesDir}) -> {ok: true, project, edl} | {ok: false, errors}` and `replaceHero(edl, title) -> edl`.
  - CLI: `node build.mjs <workdir> [--beats FILE] [--no-hero]`. It prints the project path and exits 0, or prints `EDL INVALID:` followed by `  - <error>` lines and exits 2.
  - The project contains `index.html`, `compositions/<id>.html`, `assets/video.mp4`, `assets/music.<ext>` (if any), `hyperframes.json`, `meta.json`, and `edl.resolved.json` (the plan after beat snapping).
  - Scene tokens: `__ID__ __W__ __H__ __DUR__ __TEXT__ __SUB__ __BG__ __ACCENT__ __FG__ __HITS__`.

- [ ] **Step 1: Write the failing tests**

`tests/js/scenes.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillScene } from "../../skills/yt-trailer/scripts/lib/scenes.mjs";

test("fillScene replaces tokens and escapes text", () => {
  const out = fillScene('<h1 class="__ID__">__TEXT__</h1><p>__SUB__</p><i style="color:__FG__">__DUR__</i>', {
    ID: "s1", TEXT: `Tom's "BIG" <day> & 🎬`, SUB: "", FG: "#ffffff", DUR: 2.5,
  });
  assert.equal(out, '<h1 class="s1">Tom&#39;s &quot;BIG&quot; &lt;day&gt; &amp; 🎬</h1><p></p><i style="color:#ffffff">2.5</i>');
});

test("fillScene leaves window.__timelines alone and rejects unknown tokens", () => {
  assert.equal(fillScene('window.__timelines["__ID__"]', { ID: "x" }), 'window.__timelines["x"]');
  assert.throws(() => fillScene("__NOPE__", {}), /unfilled scene tokens: __NOPE__/);
});
```

`tests/js/build.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "../../skills/yt-trailer/scripts/build.mjs";
import { validEdl, ctx, ROOT } from "./fixtures.mjs";

const STUBS = join(ROOT, "tests", "js", "stub-scenes");

function makeWork(edl, info = {}) {
  const { workDir } = ctx();
  mkdirSync(join(workDir, "source"));
  writeFileSync(join(workDir, "source", "video.mp4"), "fake");
  writeFileSync(join(workDir, "source", "info.json"), JSON.stringify({ id: "t1", title: `Tom's "Big" Day`, duration: 120, hasAudio: true, ...info }));
  writeFileSync(join(workDir, "candidates.json"), JSON.stringify({ transcript: [] }));
  writeFileSync(join(workDir, "edl.json"), JSON.stringify(edl));
  return workDir;
}

test("build writes a complete project", () => {
  const work = makeWork(validEdl());
  const result = build(work, { scenesDir: STUBS });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const project = join(work, "project");
  for (const f of ["index.html", "hyperframes.json", "meta.json", "edl.resolved.json", "assets/video.mp4"]) {
    assert.ok(existsSync(join(project, f)), f);
  }
  assert.deepEqual(readdirSync(join(project, "compositions")).sort(), ["s0.html", "s7.html", "s9.html"]);
  const endCard = readFileSync(join(project, "compositions", "s9.html"), "utf8");
  assert.ok(endCard.includes("Sample &amp; &quot;Quotes&quot;"));
  assert.ok(endCard.includes('data-composition-id="s9"'));
  assert.ok(!/__[A-Z]+__/.test(endCard));
});

test("invalid plan returns errors and writes nothing", () => {
  const work = makeWork({ ...validEdl(), style: "epic" });
  const result = build(work, { scenesDir: STUBS });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("style")));
  assert.ok(!existsSync(join(work, "project")));
});

test("--no-hero swaps the hero for the default title", () => {
  const edl = { ...validEdl(), style: "cinematic" };
  edl.scenes[0] = { type: "hero", dur: 2 };
  const work = makeWork(edl);
  assert.equal(build(work, { scenesDir: STUBS }).ok, false); // hero file missing
  const result = build(work, { scenesDir: STUBS, noHero: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.edl.scenes[0].scene, "cinematic/slow-push-title");
  assert.equal(result.edl.scenes[0].text, `TOM'S "BIG" DAY`);
});

test("beats file snaps cuts", () => {
  const work = makeWork(validEdl());
  writeFileSync(join(work, "beats.json"), JSON.stringify({ beats: [2.1, 4.95] }));
  const result = build(work, { scenesDir: STUBS, beatsFile: join(work, "beats.json") });
  assert.equal(result.ok, true);
  assert.equal(result.edl.scenes[0].dur, 2.1);
});

test("CLI exits 2 with readable errors", () => {
  const work = makeWork({ ...validEdl(), duration: 31 });
  const proc = spawnSync(process.execPath, [join(ROOT, "skills/yt-trailer/scripts/build.mjs"), work], { encoding: "utf8" });
  assert.equal(proc.status, 2);
  assert.match(proc.stdout, /EDL INVALID:\n  - duration must be one of 30, 45, 60/);
});
```

Create stub scenes. Each stub is the same minimal template, so it exercises token filling without depending on Tasks 11–14. Run:
```bash
mkdir -p tests/js/stub-scenes/{cinematic,hype,highlight,overlays}
STUB='<template><div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__" style="background:__BG__;color:__FG__;border-color:__ACCENT__"><h1>__TEXT__</h1><p>__SUB__</p></div><script>const D = __DUR__; window.__timelines["__ID__"] = gsap.timeline({ paused: true });</script></template>'
for f in cinematic/slow-push-title cinematic/black-to-title cinematic/end-card hype/kinetic-slam hype/end-card highlight/quote-card highlight/chapter-bumper highlight/end-card overlays/letterbox overlays/grain-lightleak overlays/glitch-rgb; do
  printf '%s\n' "$STUB" > "tests/js/stub-scenes/$f.html"
done
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/scenes.mjs` and `build.mjs`.

- [ ] **Step 3: Write scenes.mjs and project.mjs**

`skills/yt-trailer/scripts/lib/scenes.mjs`:
```js
import { esc } from "./html.mjs";

const TOKEN = /__([A-Z]+)__/g;
const ESCAPED = new Set(["TEXT", "SUB"]);

export function fillScene(template, vars) {
  const out = template.replace(TOKEN, (match, key) => {
    if (!(key in vars)) return match;
    return ESCAPED.has(key) ? esc(vars[key]) : String(vars[key]);
  });
  const left = out.match(TOKEN);
  if (left) throw new Error(`unfilled scene tokens: ${[...new Set(left)].join(", ")}`);
  return out;
}
```

`skills/yt-trailer/scripts/lib/project.mjs`:
```js
export const HF_VERSION = "0.8.104";

export const HF_CONFIG = {
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  media: { autoProxy: true },
};
```

- [ ] **Step 4: Write build.mjs**

`skills/yt-trailer/scripts/build.mjs`:
```js
#!/usr/bin/env node
// Build a HyperFrames project from WORKDIR/edl.json.
// Usage: node build.mjs <workdir> [--beats FILE] [--no-hero]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, linkSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEdl, DEFAULT_TITLE, resolveTrack } from "./lib/edl.mjs";
import { composeIndex, DIMS } from "./lib/compose.mjs";
import { parseBeats, snapToBeats } from "./lib/beats.mjs";
import { fillScene } from "./lib/scenes.mjs";
import { HF_CONFIG } from "./lib/project.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function replaceHero(edl, title) {
  return {
    ...edl,
    scenes: edl.scenes.map((s) =>
      s.type === "hero" ? { type: "title", scene: DEFAULT_TITLE[edl.style], text: s.text || title.slice(0, 40), sub: s.sub, dur: s.dur } : s,
    ),
  };
}

function linkOrCopy(src, dest) {
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

export function build(workDir, { beatsFile = null, noHero = false, scenesDir = join(SKILL_DIR, "scenes") } = {}) {
  const read = (p) => JSON.parse(readFileSync(join(workDir, p), "utf8"));
  const info = read("source/info.json");
  const candidates = existsSync(join(workDir, "candidates.json")) ? read("candidates.json") : { transcript: [] };
  let edl = read("edl.json");
  if (noHero) edl = replaceHero(edl, String(info.title || "").toUpperCase());
  const ctx = { sourceDuration: info.duration, skillDir: SKILL_DIR, workDir };
  const errors = validateEdl(edl, ctx);
  if (errors.length) return { ok: false, errors };
  if (beatsFile) {
    const snapped = snapToBeats(edl, parseBeats(JSON.parse(readFileSync(beatsFile, "utf8"))), info.duration);
    if (validateEdl(snapped, ctx).length === 0) edl = snapped;
    else console.error("warning: beat snapping produced an invalid plan; using unsnapped cuts");
  }

  const project = join(workDir, "project");
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, "assets"), { recursive: true });
  mkdirSync(join(project, "compositions"), { recursive: true });
  linkOrCopy(join(workDir, "source", "video.mp4"), join(project, "assets", "video.mp4"));
  let musicSrc = null;
  if (edl.music) {
    const track = resolveTrack(edl.music.track, SKILL_DIR);
    musicSrc = `assets/music${extname(track)}`;
    copyFileSync(track, join(project, musicSrc));
  }

  const { html, subcomps } = composeIndex(edl, {
    transcript: candidates.transcript || [],
    musicSrc,
    hasAudio: info.hasAudio !== false,
  });
  const [W, H] = DIMS[edl.format];
  for (const sc of subcomps) {
    const file = sc.scene === "hero" ? join(workDir, "custom", "hero.html") : join(scenesDir, `${sc.scene}.html`);
    const filled = fillScene(readFileSync(file, "utf8"), {
      ID: sc.id, W, H, BG: edl.palette.bg, ACCENT: edl.palette.accent, FG: edl.palette.fg, HITS: "[]", ...sc.vars,
    });
    writeFileSync(join(project, "compositions", `${sc.id}.html`), filled);
  }
  writeFileSync(join(project, "index.html"), html);
  writeFileSync(join(project, "hyperframes.json"), JSON.stringify(HF_CONFIG, null, 2));
  writeFileSync(join(project, "meta.json"), JSON.stringify({ id: `trailer-${info.id}`, name: info.title, createdAt: new Date().toISOString() }, null, 2));
  writeFileSync(join(project, "edl.resolved.json"), JSON.stringify(edl, null, 2));
  return { ok: true, project, edl };
}

function main(argv) {
  const workDir = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--beats");
  if (!workDir) {
    console.error("usage: node build.mjs <workdir> [--beats FILE] [--no-hero]");
    return 2;
  }
  const beatsIdx = argv.indexOf("--beats");
  let result;
  try {
    result = build(resolve(workDir), {
      beatsFile: beatsIdx >= 0 ? resolve(argv[beatsIdx + 1]) : null,
      noHero: argv.includes("--no-hero"),
    });
  } catch (exc) {
    console.log(`BUILD FAILED: ${exc.message}`);
    return 2;
  }
  if (!result.ok) {
    console.log(["EDL INVALID:", ...result.errors.map((e) => `  - ${e}`)].join("\n"));
    return 2;
  }
  console.log(result.project);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including 2 in `scenes.test.mjs` and 5 in `build.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add skills/yt-trailer/scripts tests/js
git commit -m "feat: build HyperFrames project from edit plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Scene contract, static checks and render harness

**Files:**
- Create: `skills/yt-trailer/references/scene-contract.md`, `tests/fixtures/hero.html`, `tests/scenes/check_scenes.mjs`
- Modify: `tests/js/scenes.test.mjs` (append the contract tests)

**Interfaces:**
- Consumes: `fillScene` (scenes.mjs), `HF_VERSION, HF_CONFIG` (project.mjs).
- Produces:
  - `assertSceneContract(source, name)`, inside `tests/js/scenes.test.mjs`. It is applied to every `.html` file under `skills/yt-trailer/scenes/` and to `tests/fixtures/hero.html`.
  - `node tests/scenes/check_scenes.mjs [name ...]`. Names are like `cinematic/slow-push-title`, or `fixture/hero`; no names means all. For each scene and each format (16:9 and 9:16), it builds a throwaway project with a moving background and the scene filled with sample text (`Tom's "BIG" day & night`). It then runs `npx --yes hyperframes@0.8.104 check` and exits non-zero if any check fails.

- [ ] **Step 1: Write the scene contract document**

`skills/yt-trailer/references/scene-contract.md`:
````markdown
# Scene file contract

Every library scene (`scenes/**.html`) and the custom hero scene (`<workdir>/custom/hero.html`) is a HyperFrames **sub-composition** with tokens. `build.mjs` copies the file into `project/compositions/<id>.html` and replaces the tokens.

## Tokens

| Token | Value | Notes |
|---|---|---|
| `__ID__` | composition id, e.g. `s0` | Use for `data-composition-id`, the `__timelines` key and the scoping selector |
| `__W__`, `__H__` | canvas pixels | 1920×1080 or 1080×1920 |
| `__DUR__` | scene length in seconds | A number; use it in JS (`const D = __DUR__;`) |
| `__TEXT__`, `__SUB__` | title text and subtitle | HTML-escaped. Use only in HTML content, never inside JS strings |
| `__BG__`, `__ACCENT__`, `__FG__` | `#rrggbb` palette | Use in CSS |
| `__HITS__` | JSON array of cut times in seconds | Overlays only |

Any other `__UPPERCASE__` token makes the build fail.

## Rules

1. Put **everything** inside `<template>`: `<link>` fonts, `<style>`, markup and `<script>`. The runtime ignores everything outside it.
2. Root element: `<div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">`. Style it with `#root { position: absolute; inset: 0; ... }`, never by class.
3. Prefix every class with a short scene prefix (`spt-`, `ks-`, `hero-`) so scenes never share class names.
4. Select elements only through the scoped helper:
   `const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);`
5. Build exactly one paused timeline inside an IIFE and register it with the literal key: `window.__timelines["__ID__"] = tl;`
6. Use `fromTo` for entrances. When several tweens animate the same property of the same element at different times, pass `immediateRender: false` to every one after the first.
7. Keep something moving for the scene's whole duration (a slow scale or drift), and fade out in the last 0.2–0.4 s.
8. Be deterministic: no `Math.random()`, `Date`, `setTimeout`, `requestAnimationFrame`, `fetch`, `<video>` or `<audio>`.
9. Size text with `vmin` units so it fits both 16:9 and 9:16. Center with flex, grid or `inset`, never with CSS `translate(-50%, -50%)`.
10. Fonts: load Google Fonts with `<link>` inside the template.

## Skeleton

```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: __BG__; }
        .xx-title { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: __FG__; font: 16vmin/1 "Bebas Neue", sans-serif; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <h1 class="xx-title">__TEXT__</h1>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".xx-title"), { scale: 0.9, opacity: 0 }, { scale: 1.05, opacity: 1, duration: D, ease: "power2.out" }, 0);
          tl.to(q(".xx-title"), { opacity: 0, duration: 0.3 }, D - 0.3);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```
````

- [ ] **Step 2: Write the sample hero fixture**

`tests/fixtures/hero.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: __BG__; }
        .hero-ring { position: absolute; left: 50%; top: 50%; width: 60vmin; height: 60vmin; margin: -30vmin 0 0 -30vmin; border-radius: 50%; border: 0.6vmin solid __ACCENT__; }
        .hero-title { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 0 8%; text-align: center; font-family: "Bebas Neue", sans-serif; font-size: 16vmin; line-height: 0.95; color: __FG__; }
        .hero-ch { display: inline-block; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="hero-ring"></div>
        <h1 class="hero-title">__TEXT__</h1>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const title = q(".hero-title")[0];
          const chars = [...title.textContent];
          title.textContent = "";
          chars.forEach((c) => {
            const span = document.createElement("span");
            span.className = "hero-ch";
            span.textContent = c === " " ? "\u00a0" : c;
            title.appendChild(span);
          });
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".hero-ring"), { scale: 0.2, opacity: 0 }, { scale: 1.6, opacity: 1, duration: D, ease: "power1.out" }, 0);
          tl.fromTo(q(".hero-ch"), { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.5, stagger: Math.min(0.06, (D * 0.4) / Math.max(chars.length, 1)), ease: "back.out(1.8)" }, 0.2);
          tl.to(q(".hero-title, .hero-ring"), { opacity: 0, duration: 0.3 }, D - 0.3);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 3: Append the static contract tests**

Append to `tests/js/scenes.test.mjs`:
```js
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, SKILL_DIR } from "./fixtures.mjs";

function listScenes(dir = join(SKILL_DIR, "scenes")) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(listScenes(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

export function assertSceneContract(source, name) {
  const inner = source.split("<template>")[1]?.split("</template>")[0];
  assert.ok(inner, `${name}: missing <template>`);
  const outside = source.replace(/<template>[\s\S]*<\/template>/, "");
  assert.doesNotMatch(outside, /<style|<script|<link/, `${name}: style/script/link outside <template>`);
  assert.match(inner, /<div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">/, `${name}: root element`);
  assert.match(inner, /#root\s*\{/, `${name}: root styled by #root`);
  assert.match(inner, /window\.__timelines\["__ID__"\] = tl;/, `${name}: timeline registration`);
  assert.match(inner, /const q = \(sel\) => document\.querySelectorAll\('\[data-composition-id="__ID__"\] ' \+ sel\);/, `${name}: scoped selector helper`);
  assert.match(inner, /const D = __DUR__;/, `${name}: uses __DUR__`);
  assert.doesNotMatch(inner, /Math\.random|Date\.|setTimeout|requestAnimationFrame|fetch\(|<video|<audio/, `${name}: nondeterministic or media API`);
  assert.doesNotMatch(inner, /translate\(-50%/, `${name}: translate(-50%) centering`);
  const tokens = new Set(inner.match(/__[A-Z]+__/g));
  const allowed = new Set(["__ID__", "__W__", "__H__", "__DUR__", "__TEXT__", "__SUB__", "__BG__", "__ACCENT__", "__FG__", "__HITS__"]);
  for (const t of tokens) assert.ok(allowed.has(t), `${name}: unknown token ${t}`);
}

test("every library scene follows the contract", () => {
  for (const file of listScenes()) assertSceneContract(readFileSync(file, "utf8"), relative(SKILL_DIR, file));
});

test("hero fixture follows the contract", () => {
  assertSceneContract(readFileSync(join(ROOT, "tests/fixtures/hero.html"), "utf8"), "fixture/hero");
});
```

Move the existing `import` lines so all imports sit at the top of the file.

- [ ] **Step 4: Write the render harness**

`tests/scenes/check_scenes.mjs`:
```js
#!/usr/bin/env node
// Render-check scene files with the pinned HyperFrames CLI.
// Usage: node tests/scenes/check_scenes.mjs [scene ...]   e.g. cinematic/slow-push-title fixture/hero
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fillScene } from "../../skills/yt-trailer/scripts/lib/scenes.mjs";
import { HF_VERSION, HF_CONFIG } from "../../skills/yt-trailer/scripts/lib/project.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCENES = join(ROOT, "skills/yt-trailer/scenes");
const SAMPLE = { TEXT: `Tom's "BIG" day & night`, SUB: "A FILM BY TEST", BG: "#0b0f1a", ACCENT: "#e8c37a", FG: "#f4f1ea", HITS: "[0.8,1.6,2.4,3.2]" };
const FORMATS = [[1920, 1080], [1080, 1920]];
const DUR = 4;

function all(dir = SCENES) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return all(p);
    return name.endsWith(".html") ? [relative(SCENES, p).replace(/\.html$/, "")] : [];
  });
}

function fileFor(name) {
  return name === "fixture/hero" ? join(ROOT, "tests/fixtures/hero.html") : join(SCENES, `${name}.html`);
}

function indexHtml(W, H) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #111; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .bed { position: absolute; inset: 0; background: linear-gradient(135deg, #334, #a63, #264); }
      .layer { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${DUR}">
      <div id="bed" class="bed clip" data-start="0" data-duration="${DUR}" data-track-index="0"></div>
      <div id="scene" class="layer" data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="${DUR}" data-track-index="1" data-width="${W}" data-height="${H}" style="z-index:2"></div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#bed", { scale: 1 }, { scale: 1.2, duration: ${DUR}, ease: "none" }, 0);
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : [...all(), "fixture/hero"];
const failures = [];
for (const name of names) {
  for (const [W, H] of FORMATS) {
    const dir = mkdtempSync(join(tmpdir(), "ytt-scene-"));
    mkdirSync(join(dir, "compositions"));
    const filled = fillScene(readFileSync(fileFor(name), "utf8"), { ...SAMPLE, ID: "scene", W, H, DUR });
    writeFileSync(join(dir, "compositions", "scene.html"), filled);
    writeFileSync(join(dir, "index.html"), indexHtml(W, H));
    writeFileSync(join(dir, "hyperframes.json"), JSON.stringify(HF_CONFIG, null, 2));
    console.log(`\n=== ${name} ${W}x${H} (${dir})`);
    const proc = spawnSync("npx", ["--yes", `hyperframes@${HF_VERSION}`, "check"], { cwd: dir, stdio: "inherit" });
    if (proc.status !== 0) failures.push(`${name} ${W}x${H}`);
  }
}
if (failures.length) {
  console.error(`\nFAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${names.length} scene(s) passed in both formats.`);
```

- [ ] **Step 5: Run the checks**

Run: `npm test`
Expected: `hero fixture follows the contract` passes. `every library scene follows the contract` passes vacuously (no scene files yet).

Run: `npm run test:scenes -- fixture/hero`
Expected: `All 1 scene(s) passed in both formats.` If `check` reports a finding, fix `tests/fixtures/hero.html` **and** update the contract document when the finding is a general rule (for example, a lint rule the contract didn't mention). Then re-run until it passes. This run proves that the contract itself renders.

- [ ] **Step 6: Commit**

```bash
git add skills/yt-trailer/references/scene-contract.md tests/fixtures tests/scenes tests/js/scenes.test.mjs
git commit -m "test: add scene contract, hero fixture and render harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Cinematic scenes

**Files:**
- Create: `skills/yt-trailer/scenes/cinematic/slow-push-title.html`, `skills/yt-trailer/scenes/cinematic/black-to-title.html`, `skills/yt-trailer/scenes/cinematic/end-card.html`

**Interfaces:**
- Consumes: the scene contract (Task 10).
- Produces: scene names `cinematic/slow-push-title`, `cinematic/black-to-title`, `cinematic/end-card`.

- [ ] **Step 1: Write slow-push-title**

`skills/yt-trailer/scenes/cinematic/slow-push-title.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 55%, color-mix(in srgb, __ACCENT__ 18%, __BG__) 0%, __BG__ 70%); }
        .spt-wrap { position: absolute; inset: 0; display: grid; place-items: center; }
        .spt-text { margin: 0; max-width: 82%; text-align: center; font-family: "Cinzel", serif; font-weight: 800; font-size: 11vmin; line-height: 1.08; letter-spacing: 0.12em; color: __FG__; text-shadow: 0 0 40px color-mix(in srgb, __ACCENT__ 45%, transparent); }
        .spt-line { position: absolute; top: 66%; left: 30%; width: 40%; height: 2px; background: __ACCENT__; transform-origin: 50% 50%; }
        .spt-sub { position: absolute; top: 70%; left: 0; right: 0; text-align: center; font-family: "Cinzel", serif; font-weight: 600; font-size: 3.4vmin; letter-spacing: 0.5em; color: __ACCENT__; }
        .spt-sub:empty { display: none; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="spt-wrap"><h1 class="spt-text">__TEXT__</h1></div>
        <div class="spt-line"></div>
        <div class="spt-sub">__SUB__</div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".spt-text"), { scale: 0.96 }, { scale: 1.08, duration: D, ease: "none" }, 0);
          tl.fromTo(q(".spt-text"), { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 1.0, ease: "power2.out" }, 0);
          tl.fromTo(q(".spt-line"), { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: "power3.inOut" }, 0.4);
          tl.fromTo(q(".spt-sub"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.8);
          tl.to(q(".spt-text, .spt-sub, .spt-line"), { opacity: 0, duration: 0.35, ease: "power1.in" }, D - 0.35);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 2: Write black-to-title**

`skills/yt-trailer/scenes/cinematic/black-to-title.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: #000; }
        .btt-text { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 0 8%; text-align: center; font-family: "Playfair Display", serif; font-weight: 700; font-size: 12vmin; line-height: 1.05; color: __FG__; }
        .btt-sub { position: absolute; left: 0; right: 0; bottom: 20%; text-align: center; font-family: "Playfair Display", serif; font-style: italic; font-size: 3.6vmin; letter-spacing: 0.08em; color: __ACCENT__; }
        .btt-sub:empty { display: none; }
        .btt-sweep { position: absolute; top: 0; bottom: 0; left: -30%; width: 30%; background: linear-gradient(90deg, transparent, color-mix(in srgb, __ACCENT__ 55%, transparent), transparent); mix-blend-mode: screen; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <h1 class="btt-text">__TEXT__</h1>
        <div class="btt-sub">__SUB__</div>
        <div class="btt-sweep"></div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const hold = Math.min(0.6, D * 0.25);
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".btt-text"), { opacity: 0 }, { opacity: 1, duration: 0.01 }, hold);
          tl.fromTo(q(".btt-text"), { scale: 1.12 }, { scale: 1, duration: 0.5, ease: "expo.out" }, hold);
          tl.fromTo(q(".btt-text"), { y: 0 }, { y: -14, duration: D - hold, ease: "none" }, hold);
          tl.fromTo(q(".btt-sweep"), { xPercent: 0 }, { xPercent: 450, duration: 0.9, ease: "power2.inOut" }, hold + 0.05);
          tl.fromTo(q(".btt-sub"), { opacity: 0 }, { opacity: 1, duration: 0.6 }, hold + 0.4);
          tl.to(q(".btt-text, .btt-sub"), { opacity: 0, duration: 0.25, immediateRender: false }, D - 0.25);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 3: Write the cinematic end-card**

`skills/yt-trailer/scenes/cinematic/end-card.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 45%, color-mix(in srgb, __ACCENT__ 22%, __BG__) 0%, __BG__ 72%); }
        .cec-stack { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3vmin; padding: 0 8%; text-align: center; }
        .cec-title { margin: 0; font-family: "Cinzel", serif; font-weight: 800; font-size: 8.5vmin; line-height: 1.1; letter-spacing: 0.08em; color: __FG__; }
        .cec-sub { font-family: "Cinzel", serif; font-weight: 600; font-size: 3vmin; letter-spacing: 0.4em; text-transform: uppercase; color: __ACCENT__; }
        .cec-sub:empty { display: none; }
        .cec-cta { margin-top: 2vmin; padding-top: 2vmin; border-top: 1px solid __ACCENT__; font-family: "Cinzel", serif; font-weight: 600; font-size: 2.6vmin; letter-spacing: 0.6em; color: __FG__; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="cec-stack">
          <h1 class="cec-title">__TEXT__</h1>
          <div class="cec-sub">__SUB__</div>
          <div class="cec-cta">WATCH THE FULL VIDEO</div>
        </div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".cec-stack"), { scale: 1 }, { scale: 1.05, duration: D, ease: "none" }, 0);
          tl.fromTo(q(".cec-title"), { opacity: 0, y: 30, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 1.1, ease: "power3.out" }, 0.1);
          tl.fromTo(q(".cec-sub"), { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0.7);
          tl.fromTo(q(".cec-cta"), { opacity: 0, y: 10 }, { opacity: 0.85, y: 0, duration: 0.8 }, 1.1);
          tl.to(q(".cec-stack"), { opacity: 0, duration: 0.8, ease: "power1.in" }, D - 0.8);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 4: Run the checks**

Run: `npm test`
Expected: `every library scene follows the contract` passes for all three files.

Run: `npm run test:scenes -- cinematic/slow-push-title cinematic/black-to-title cinematic/end-card`
Expected: `All 3 scene(s) passed in both formats.` For each failure, fix the scene file, keeping the visual intent, and re-run.

Visual review: run `npx --yes hyperframes@0.8.104 snapshot` in one harness dir printed by the run, at 0.5 s, 1.5 s and 3.5 s. Confirm the text is centered, fully visible in both formats, and the apostrophe and quotes show literally.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scenes/cinematic
git commit -m "feat: add cinematic scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Hype scenes

**Files:**
- Create: `skills/yt-trailer/scenes/hype/kinetic-slam.html`, `skills/yt-trailer/scenes/hype/end-card.html`

**Interfaces:**
- Produces: scene names `hype/kinetic-slam`, `hype/end-card`.

- [ ] **Step 1: Write kinetic-slam**

`skills/yt-trailer/scenes/hype/kinetic-slam.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: __BG__; }
        .ks-stripes { position: absolute; top: -20%; bottom: -20%; left: 0; width: 200%; background: repeating-linear-gradient(115deg, color-mix(in srgb, __ACCENT__ 22%, transparent) 0 40px, transparent 40px 120px); }
        .ks-shake { position: absolute; inset: 0; display: grid; place-items: center; }
        .ks-text { margin: 0; padding: 0 6%; text-align: center; font-family: "Bebas Neue", sans-serif; font-size: 17vmin; line-height: 0.92; text-transform: uppercase; color: __FG__; }
        .ks-w { display: inline-block; }
        .ks-w:nth-child(even) { color: __ACCENT__; }
        .ks-sub { position: absolute; left: 0; right: 0; bottom: 12%; text-align: center; font-family: "Bebas Neue", sans-serif; font-size: 5vmin; letter-spacing: 0.3em; color: __FG__; }
        .ks-sub:empty { display: none; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="ks-stripes"></div>
        <div class="ks-shake"><h1 class="ks-text">__TEXT__</h1></div>
        <div class="ks-sub">__SUB__</div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const el = q(".ks-text")[0];
          const words = el.textContent.trim().split(/\s+/);
          el.textContent = "";
          words.forEach((w, i) => {
            const span = document.createElement("span");
            span.className = "ks-w";
            span.textContent = w;
            el.appendChild(span);
            if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
          });
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".ks-stripes"), { xPercent: 0 }, { xPercent: -50, duration: D, ease: "none" }, 0);
          const step = Math.min(0.28, (D * 0.6) / Math.max(words.length, 1));
          q(".ks-w").forEach((w, i) => {
            tl.fromTo(w, { opacity: 0, scale: 2.6, rotation: i % 2 ? -6 : 6 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.22, ease: "back.out(2)" }, i * step);
            tl.to(q(".ks-shake"), { keyframes: [{ x: -14, duration: 0.04 }, { x: 10, duration: 0.04 }, { x: -6, duration: 0.04 }, { x: 0, duration: 0.04 }] }, i * step + 0.04);
          });
          tl.fromTo(q(".ks-sub"), { opacity: 0, y: 20 }, { opacity: 0.9, y: 0, duration: 0.3, ease: "power3.out" }, words.length * step);
          tl.fromTo(q(".ks-text"), { scale: 1 }, { scale: 1.06, duration: D, ease: "none" }, 0);
          tl.to(q(".ks-shake, .ks-sub"), { opacity: 0, duration: 0.2, ease: "power2.in" }, D - 0.2);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 2: Write the hype end-card**

`skills/yt-trailer/scenes/hype/end-card.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: __BG__; }
        .hec-stripes { position: absolute; top: -20%; bottom: -20%; left: 0; width: 200%; background: repeating-linear-gradient(115deg, color-mix(in srgb, __ACCENT__ 18%, transparent) 0 40px, transparent 40px 120px); }
        .hec-stack { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2.5vmin; padding: 0 6%; text-align: center; }
        .hec-title { margin: 0; font-family: "Bebas Neue", sans-serif; font-size: 13vmin; line-height: 0.92; color: __FG__; text-shadow: 6px 0 0 color-mix(in srgb, __ACCENT__ 70%, transparent), -6px 0 0 rgba(0, 200, 255, 0.5); }
        .hec-sub { font-family: "Bebas Neue", sans-serif; font-size: 4.4vmin; letter-spacing: 0.25em; color: __ACCENT__; }
        .hec-sub:empty { display: none; }
        .hec-cta { font-family: "Bebas Neue", sans-serif; font-size: 4vmin; letter-spacing: 0.2em; color: __BG__; background: __ACCENT__; padding: 1.2vmin 4vmin; border-radius: 999px; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="hec-stripes"></div>
        <div class="hec-stack">
          <h1 class="hec-title">__TEXT__</h1>
          <div class="hec-sub">__SUB__</div>
          <div class="hec-cta">WATCH NOW</div>
        </div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".hec-stripes"), { xPercent: 0 }, { xPercent: -50, duration: D, ease: "none" }, 0);
          tl.fromTo(q(".hec-title"), { opacity: 0, scale: 3 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, 0);
          tl.to(q(".hec-stack"), { keyframes: [{ x: -16, duration: 0.04 }, { x: 12, duration: 0.04 }, { x: -6, duration: 0.04 }, { x: 0, duration: 0.04 }] }, 0.08);
          tl.fromTo(q(".hec-sub"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, 0.35);
          tl.fromTo(q(".hec-cta"), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2.5)" }, 0.6);
          const pulses = Math.max(0, Math.floor((D - 1.4) / 0.4));
          tl.to(q(".hec-cta"), { scale: 1.08, duration: 0.4, yoyo: true, repeat: pulses, ease: "sine.inOut", immediateRender: false }, 1.0);
          tl.to(q(".hec-stack"), { opacity: 0, duration: 0.3, ease: "power2.in" }, D - 0.3);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 3: Run the checks**

Run: `npm test`
Expected: the contract test passes for the hype files.

Run: `npm run test:scenes -- hype/kinetic-slam hype/end-card`
Expected: `All 2 scene(s) passed in both formats.` Fix and re-run on failure. Do the same snapshot review as in Task 11, Step 4.

- [ ] **Step 4: Commit**

```bash
git add skills/yt-trailer/scenes/hype
git commit -m "feat: add hype scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Highlight scenes

**Files:**
- Create: `skills/yt-trailer/scenes/highlight/quote-card.html`, `skills/yt-trailer/scenes/highlight/chapter-bumper.html`, `skills/yt-trailer/scenes/highlight/end-card.html`

**Interfaces:**
- Produces: scene names `highlight/quote-card`, `highlight/chapter-bumper`, `highlight/end-card`.

- [ ] **Step 1: Write quote-card**

`skills/yt-trailer/scenes/highlight/quote-card.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=Inter:wght@600&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: __BG__; }
        .qc-glow { position: absolute; inset: -20%; background: radial-gradient(circle at 30% 40%, color-mix(in srgb, __ACCENT__ 25%, transparent) 0%, transparent 55%); }
        .qc-box { position: absolute; top: 0; bottom: 0; left: 10%; right: 10%; display: flex; flex-direction: column; justify-content: center; gap: 3vmin; }
        .qc-mark { height: 9vmin; font-family: "Playfair Display", serif; font-weight: 700; font-size: 22vmin; line-height: 0.6; color: __ACCENT__; }
        .qc-text { margin: 0; font-family: "Playfair Display", serif; font-style: italic; font-weight: 400; font-size: 6.6vmin; line-height: 1.25; color: __FG__; }
        .qc-w { display: inline-block; margin-right: 0.25em; }
        .qc-sub { font-family: "Inter", sans-serif; font-weight: 600; font-size: 2.8vmin; letter-spacing: 0.18em; text-transform: uppercase; color: __ACCENT__; }
        .qc-sub:empty { display: none; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="qc-glow"></div>
        <div class="qc-box">
          <div class="qc-mark">&ldquo;</div>
          <p class="qc-text">__TEXT__</p>
          <div class="qc-sub">__SUB__</div>
        </div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const el = q(".qc-text")[0];
          const words = el.textContent.trim().split(/\s+/);
          el.textContent = "";
          words.forEach((w) => {
            const span = document.createElement("span");
            span.className = "qc-w";
            span.textContent = w;
            el.appendChild(span);
          });
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".qc-glow"), { xPercent: -6, yPercent: 0 }, { xPercent: 6, yPercent: -4, duration: D, ease: "sine.inOut" }, 0);
          tl.fromTo(q(".qc-mark"), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, 0);
          const span = Math.min(1.6, D * 0.5);
          tl.fromTo(q(".qc-w"), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", stagger: span / Math.max(words.length, 1) }, 0.2);
          tl.fromTo(q(".qc-sub"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.3 + span);
          tl.fromTo(q(".qc-box"), { x: 0 }, { x: -12, duration: D, ease: "none" }, 0);
          tl.to(q(".qc-box"), { opacity: 0, duration: 0.3 }, D - 0.3);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 2: Write chapter-bumper**

`skills/yt-trailer/scenes/highlight/chapter-bumper.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@700;900&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: __BG__; }
        .cb-wipe { position: absolute; inset: 0; background: __ACCENT__; }
        .cb-box { position: absolute; top: 0; bottom: 0; left: 9%; right: 9%; display: flex; flex-direction: column; justify-content: center; gap: 2vmin; }
        .cb-sub { font-family: "Inter", sans-serif; font-weight: 700; font-size: 3vmin; letter-spacing: 0.3em; text-transform: uppercase; color: __ACCENT__; }
        .cb-sub:empty { display: none; }
        .cb-text { margin: 0; font-family: "Inter", sans-serif; font-weight: 900; font-size: 10vmin; line-height: 1; letter-spacing: -0.03em; color: __FG__; }
        .cb-rule { width: 22vmin; height: 0.6vmin; background: __ACCENT__; transform-origin: 0% 50%; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="cb-box">
          <div class="cb-sub">__SUB__</div>
          <h1 class="cb-text">__TEXT__</h1>
          <div class="cb-rule"></div>
        </div>
        <div class="cb-wipe"></div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const tl = gsap.timeline({ paused: true });
          tl.set(q(".cb-wipe"), { transformOrigin: "0% 50%" }, 0);
          tl.fromTo(q(".cb-wipe"), { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power3.in" }, 0);
          tl.set(q(".cb-wipe"), { transformOrigin: "100% 50%" }, 0.35);
          tl.to(q(".cb-wipe"), { scaleX: 0, duration: 0.4, ease: "power3.out" }, 0.35);
          tl.fromTo(q(".cb-sub"), { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, 0.45);
          tl.fromTo(q(".cb-text"), { opacity: 0, x: -50 }, { opacity: 1, x: 0, duration: 0.55, ease: "power3.out" }, 0.5);
          tl.fromTo(q(".cb-rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.inOut" }, 0.7);
          tl.fromTo(q(".cb-box"), { y: 0 }, { y: -16, duration: D, ease: "none" }, 0);
          tl.to(q(".cb-box"), { opacity: 0, duration: 0.3 }, D - 0.3);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 3: Write the highlight end-card**

`skills/yt-trailer/scenes/highlight/end-card.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;900&display=swap" />
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: __BG__; }
        .hlc-glow { position: absolute; inset: -20%; background: radial-gradient(circle at 70% 60%, color-mix(in srgb, __ACCENT__ 22%, transparent) 0%, transparent 55%); }
        .hlc-stack { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2.4vmin; padding: 0 9%; text-align: center; }
        .hlc-title { margin: 0; font-family: "Inter", sans-serif; font-weight: 900; font-size: 7.5vmin; line-height: 1.08; letter-spacing: -0.02em; color: __FG__; }
        .hlc-rule { width: 16vmin; height: 0.6vmin; background: __ACCENT__; }
        .hlc-sub { font-family: "Inter", sans-serif; font-weight: 700; font-size: 3vmin; letter-spacing: 0.12em; text-transform: uppercase; color: __ACCENT__; }
        .hlc-sub:empty { display: none; }
        .hlc-cta { margin-top: 1vmin; font-family: "Inter", sans-serif; font-weight: 500; font-size: 2.8vmin; color: __FG__; border: 2px solid __FG__; border-radius: 999px; padding: 1.2vmin 3.6vmin; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="hlc-glow"></div>
        <div class="hlc-stack">
          <h1 class="hlc-title">__TEXT__</h1>
          <div class="hlc-rule"></div>
          <div class="hlc-sub">__SUB__</div>
          <div class="hlc-cta">Watch the full video</div>
        </div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".hlc-glow"), { xPercent: 4 }, { xPercent: -6, duration: D, ease: "sine.inOut" }, 0);
          tl.fromTo(q(".hlc-title"), { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.1);
          tl.fromTo(q(".hlc-rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, 0.4);
          tl.fromTo(q(".hlc-sub"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.6);
          tl.fromTo(q(".hlc-cta"), { opacity: 0, y: 12 }, { opacity: 0.9, y: 0, duration: 0.5, ease: "power2.out" }, 0.8);
          tl.fromTo(q(".hlc-stack"), { scale: 1 }, { scale: 1.03, duration: D, ease: "none" }, 0);
          tl.to(q(".hlc-stack"), { opacity: 0, duration: 0.6 }, D - 0.6);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 4: Run the checks**

Run: `npm test`, then `npm run test:scenes -- highlight/quote-card highlight/chapter-bumper highlight/end-card`
Expected: the contract test passes, and the harness prints `All 3 scene(s) passed in both formats.` Do the snapshot review as in Task 11, Step 4.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/scenes/highlight
git commit -m "feat: add highlight scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Overlays and scene completeness

**Files:**
- Create: `skills/yt-trailer/scenes/overlays/letterbox.html`, `skills/yt-trailer/scenes/overlays/grain-lightleak.html`, `skills/yt-trailer/scenes/overlays/glitch-rgb.html`
- Modify: `tests/js/scenes.test.mjs` (add the completeness test), `tests/js/build.test.mjs` (add a real-scene build test)

**Interfaces:**
- Produces: scene names `overlays/letterbox`, `overlays/grain-lightleak`, `overlays/glitch-rgb`. Overlay roots are transparent so the footage shows through.

- [ ] **Step 1: Write the failing completeness test**

Append to `tests/js/scenes.test.mjs`:
```js
import { TITLE_SCENES, STYLES, OVERLAYS } from "../../skills/yt-trailer/scripts/lib/edl.mjs";
import { existsSync } from "node:fs";

test("every scene the plan can reference exists", () => {
  const needed = [...TITLE_SCENES, ...STYLES.map((s) => `${s}/end-card`), ...OVERLAYS.map((o) => `overlays/${o}`)];
  for (const name of needed) assert.ok(existsSync(join(SKILL_DIR, "scenes", `${name}.html`)), `missing scene ${name}`);
});
```
(Move the new imports to the top of the file.)

Append to `tests/js/build.test.mjs`:
```js
test("build with real scenes and all overlays leaves no tokens", () => {
  const work = makeWork({ ...validEdl(), overlays: ["letterbox", "grain-lightleak", "glitch-rgb"] });
  const result = build(work);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  for (const f of readdirSync(join(work, "project", "compositions"))) {
    const html = readFileSync(join(work, "project", "compositions", f), "utf8");
    assert.ok(!/__[A-Z]+__/.test(html), `${f} has unfilled tokens`);
  }
});
```

Run: `npm test`
Expected: FAIL with `missing scene overlays/letterbox` and an ENOENT error in the build test.

- [ ] **Step 2: Write letterbox**

`skills/yt-trailer/scenes/overlays/letterbox.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: transparent; pointer-events: none; }
        .lb-bar { position: absolute; left: 0; right: 0; height: 0; background: #000; }
        .lb-top { top: 0; }
        .lb-bottom { bottom: 0; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="lb-bar lb-top"></div>
        <div class="lb-bar lb-bottom"></div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const bar = __W__ > __H__ ? 12.8 : 6;
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".lb-bar"), { height: "0%" }, { height: bar + "%", duration: Math.min(1.2, D / 4), ease: "power3.inOut" }, 0);
          tl.to(q(".lb-bar"), { height: bar * 1.15 + "%", duration: 0.8, ease: "power2.inOut", immediateRender: false }, Math.max(0, D - 2.2));
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 3: Write grain-lightleak**

`skills/yt-trailer/scenes/overlays/grain-lightleak.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: transparent; pointer-events: none; }
        .gl-grain { position: absolute; inset: -50%; opacity: 0.14; mix-blend-mode: overlay; background-size: 256px 256px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
        .gl-leak { position: absolute; width: 70vmax; height: 70vmax; border-radius: 50%; filter: blur(60px); mix-blend-mode: screen; opacity: 0; }
        .gl-a { left: -30vmax; top: -20vmax; background: radial-gradient(circle, __ACCENT__ 0%, transparent 65%); }
        .gl-b { right: -30vmax; bottom: -25vmax; background: radial-gradient(circle, #ff7a3d 0%, transparent 65%); }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="gl-leak gl-a"></div>
        <div class="gl-leak gl-b"></div>
        <div class="gl-grain"></div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const tl = gsap.timeline({ paused: true });
          tl.fromTo(q(".gl-grain"), { x: 0, y: 0 }, { x: -128, y: -96, duration: D, ease: "steps(" + Math.max(1, Math.round(D * 12)) + ")" }, 0);
          const cycle = 6;
          const cycles = Math.max(1, Math.ceil(D / cycle));
          tl.fromTo(q(".gl-a"), { opacity: 0 }, { opacity: 0.35, duration: cycle / 2, ease: "sine.inOut", yoyo: true, repeat: cycles * 2 - 1 }, 0);
          tl.fromTo(q(".gl-b"), { opacity: 0 }, { opacity: 0.28, duration: cycle / 2, ease: "sine.inOut", yoyo: true, repeat: cycles * 2 - 1 }, cycle / 3);
          tl.fromTo(q(".gl-a"), { xPercent: 0 }, { xPercent: 40, duration: D, ease: "none" }, 0);
          tl.fromTo(q(".gl-b"), { xPercent: 0 }, { xPercent: -40, duration: D, ease: "none" }, 0);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 4: Write glitch-rgb**

`skills/yt-trailer/scenes/overlays/glitch-rgb.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: transparent; pointer-events: none; }
        .gr-strip { position: absolute; left: -5%; right: -5%; opacity: 0; mix-blend-mode: difference; }
        .gr-a { height: 6%; background: __ACCENT__; }
        .gr-b { height: 3%; background: #00e5ff; }
        .gr-c { height: 9%; background: __FG__; }
        .gr-tint { position: absolute; inset: 0; opacity: 0; background: linear-gradient(90deg, rgba(255, 0, 80, 0.5), rgba(0, 229, 255, 0.5)); mix-blend-mode: screen; }
      </style>
      <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">
        <div class="gr-strip gr-a"></div>
        <div class="gr-strip gr-b"></div>
        <div class="gr-strip gr-c"></div>
        <div class="gr-tint"></div>
      </div>
      <script>
        (() => {
          const q = (sel) => document.querySelectorAll('[data-composition-id="__ID__"] ' + sel);
          const D = __DUR__;
          const hits = __HITS__.filter((t) => t > 0.05 && t < D - 0.15);
          const strips = q(".gr-strip");
          const tl = gsap.timeline({ paused: true });
          tl.set(q(".gr-strip, .gr-tint"), { opacity: 0 }, 0);
          hits.forEach((t, i) => {
            strips.forEach((s, j) => {
              const top = ((i * 37 + j * 23) % 80) + 5;
              const shift = 20 + ((i * 13 + j * 7) % 40);
              tl.set(s, { top: top + "%", opacity: 0.85, x: (j % 2 ? -1 : 1) * shift }, t - 0.04);
              tl.set(s, { x: (j % 2 ? 1 : -1) * 18 }, t + 0.04);
              tl.set(s, { opacity: 0 }, t + 0.12);
            });
            tl.fromTo(q(".gr-tint"), { opacity: 0.35 }, { opacity: 0, duration: 0.14, ease: "none", immediateRender: false }, t - 0.02);
          });
          tl.to({}, { duration: D }, 0);
          window.__timelines["__ID__"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
```

- [ ] **Step 5: Run the checks**

Run: `npm test`
Expected: all tests pass, including the completeness test and the real-scene build test.

Run: `npm run test:scenes -- overlays/letterbox overlays/grain-lightleak overlays/glitch-rgb`
Expected: `All 3 scene(s) passed in both formats.` Snapshot at 0.8 s and 1.0 s for glitch-rgb to confirm the strips flash on the sample hits.

Run the full harness once: `npm run test:scenes`
Expected: `All 12 scene(s) passed in both formats.`

- [ ] **Step 6: Commit**

Keep `tests/js/stub-scenes/`; the other build tests still use them for speed.

```bash
git add skills/yt-trailer/scenes/overlays tests/js
git commit -m "feat: add letterbox, grain/light-leak and glitch overlays

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Bundled CC0 music

**Files:**
- Create: `skills/yt-trailer/assets/music/{cinematic-1,cinematic-2,hype-1,hype-2,highlight-1,highlight-2}.mp3`, `skills/yt-trailer/assets/music/manifest.json`, `LICENSES-MUSIC.md`
- Test: `tests/py/test_music.py`

**Interfaces:**
- Produces: `manifest.json` = `{"tracks": [{"file": "assets/music/cinematic-1.mp3", "style": "cinematic", "mood": "epic, rising", "title": "...", "artist": "...", "source": "<page URL>", "license": "CC0 1.0", "duration": 95.2}]}`. `file` is relative to the skill dir, exactly as `edl.music.track` expects.

- [ ] **Step 1: Write the failing test**

`tests/py/test_music.py`:
```python
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
```

Run: `python3 -m pytest tests/py/test_music.py`
Expected: FAIL with `FileNotFoundError` for `manifest.json`.

- [ ] **Step 2: Source the tracks**

Pick two tracks per style from **FreePD** (https://freepd.com). Every track there is released under CC0. Mood targets:
- cinematic: "Epic" / "Scoring" categories. Slow build, big swell, minimal drums at the start.
- hype: "Electronic" / "Upbeat". A clear steady beat (needed for beat snapping), 110–140 BPM.
- highlight: "Upbeat" / "World". Light, positive, unobtrusive under speech.

For each chosen track:
1. Open its FreePD page and confirm the page states the track is CC0 / public domain. If it doesn't, pick another.
2. Download the MP3 with `curl -L -o /tmp/raw.mp3 "<mp3 url>"`.
3. Normalize it and keep it under 4 MB: `ffmpeg -y -i /tmp/raw.mp3 -t 120 -af "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=117:d=3" -ac 2 -ar 44100 -b:a 192k skills/yt-trailer/assets/music/<style>-<n>.mp3`. If the track is shorter than 120 s, drop `-t 120` and set the fade start to `duration - 3`. Reject tracks shorter than 62 s.
4. Record its duration: `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 <file>`.

- [ ] **Step 3: Write manifest.json and LICENSES-MUSIC.md**

Fill `skills/yt-trailer/assets/music/manifest.json` with one entry per file. Use real values from Step 2 (title, artist, the FreePD page URL, `"license": "CC0 1.0"`, measured duration, and a mood phrase of 2–4 words).

`LICENSES-MUSIC.md`:
```markdown
# Bundled music

All tracks in `skills/yt-trailer/assets/music/` are dedicated to the public domain under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required. Credits are listed as a courtesy.

| File | Title | Artist | Source |
|---|---|---|---|
| cinematic-1.mp3 | <title> | <artist> | <FreePD page URL> |
| cinematic-2.mp3 | <title> | <artist> | <FreePD page URL> |
| hype-1.mp3 | <title> | <artist> | <FreePD page URL> |
| hype-2.mp3 | <title> | <artist> | <FreePD page URL> |
| highlight-1.mp3 | <title> | <artist> | <FreePD page URL> |
| highlight-2.mp3 | <title> | <artist> | <FreePD page URL> |
```
Replace every `<...>` cell with the real values recorded in Step 2. These are data to fill in, not open questions.

- [ ] **Step 4: Confirm beat detection works on a bundled track**

```bash
WORK=$(mktemp -d) && mkdir -p "$WORK/assets"
cp skills/yt-trailer/assets/music/hype-1.mp3 "$WORK/assets/music.mp3"
cat > "$WORK/index.html" <<'EOF'
<!doctype html><html><head><meta charset="UTF-8" /><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></head>
<body><div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="30">
<audio id="music-bed" data-timeline-role="music" src="assets/music.mp3" data-start="0" data-duration="30" data-track-index="11"></audio>
</div><script>const tl = gsap.timeline({ paused: true }); window.__timelines["main"] = tl;</script></body></html>
EOF
(cd "$WORK" && npx --yes hyperframes@0.8.104 beats --json)
find "$WORK/beats" -name '*.json' -exec node -e 'import("./skills/yt-trailer/scripts/lib/beats.mjs").then(m=>{const b=m.parseBeats(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")));console.log(b.length,"beats; first:",b.slice(0,4))})' {} \;
```
Expected: more than 20 beats, in seconds (first values below 2). If the JSON stores beats under a key that `parseBeats` ignores, or in milliseconds, extend `parseBeats` and add a test in `tests/js/beats.test.mjs` with the real file's shape copied into the test. Then re-run `npm test`.

- [ ] **Step 5: Run the test and commit**

Run: `python3 -m pytest tests/py/test_music.py`
Expected: `1 passed`.

```bash
git add skills/yt-trailer/assets/music LICENSES-MUSIC.md tests/py/test_music.py skills/yt-trailer/scripts/lib/beats.mjs tests/js/beats.test.mjs
git commit -m "feat: bundle CC0 music tracks with manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: verify.py

**Files:**
- Create: `skills/yt-trailer/scripts/verify.py`
- Test: `tests/py/test_verify.py`

**Interfaces:**
- Produces: `verify.py WORKDIR` checks `WORKDIR/trailer.mp4` against `edl.json` and `source/info.json`. It prints `OK: <path> (<dur>s, <W>x<H>)` and exits 0, or prints `FAIL: <reason>` lines and exits 1. Functions: `expects_audio(edl, info) -> bool`, `check(probe, edl, info) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

`tests/py/test_verify.py`:
```python
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
```

Run: `python3 -m pytest tests/py/test_verify.py`
Expected: `No module named 'verify'`.

- [ ] **Step 2: Write verify.py**

`skills/yt-trailer/scripts/verify.py`:
```python
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
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `python3 -m pytest tests/py/test_verify.py`
Expected: `5 passed`.

- [ ] **Step 4: Commit**

```bash
git add skills/yt-trailer/scripts/verify.py tests/py/test_verify.py
git commit -m "feat: add render verification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: SKILL.md and the edit-plan guide

**Files:**
- Create: `skills/yt-trailer/SKILL.md`, `skills/yt-trailer/references/edl-guide.md`
- Test: `tests/js/docs.test.mjs`

**Interfaces:**
- Consumes: every script CLI above, the scene names, `edl.schema.json`, `scene-contract.md`, and `manifest.json`.
- Produces: the skill entry point. `docs.test.mjs` checks the guide's full example `edl.json` against the validator, so the documentation can't drift.

- [ ] **Step 1: Write the failing doc test**

`tests/js/docs.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateEdl } from "../../skills/yt-trailer/scripts/lib/edl.mjs";
import { ctx, SKILL_DIR } from "./fixtures.mjs";

test("edl-guide example is a valid plan", () => {
  const guide = readFileSync(join(SKILL_DIR, "references", "edl-guide.md"), "utf8");
  const block = guide.split("<!-- example-edl -->")[1].split("```json")[1].split("```")[0];
  const edl = JSON.parse(block);
  const c = ctx({ sourceDuration: 1800 });
  mkdirSync(join(c.workDir, "custom"));
  writeFileSync(join(c.workDir, "custom", "hero.html"), "<template></template>");
  assert.deepEqual(validateEdl(edl, c), []);
});

test("SKILL.md frontmatter", () => {
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: yt-trailer\ndescription: .+\n---\n/);
  assert.ok(skill.includes("hyperframes@0.8.104"));
});
```

Run: `npm test`
Expected: FAIL with ENOENT for `edl-guide.md`.

- [ ] **Step 2: Write SKILL.md**

`skills/yt-trailer/SKILL.md`:
````markdown
---
name: yt-trailer
description: Turn a YouTube URL or a local video file into a short, highly animated trailer (cinematic, highlight or hype style) rendered with HyperFrames. Use when the user asks to make a trailer, teaser, promo, sizzle or highlight reel from a YouTube link or a video file, or types /yt-trailer.
---

# yt-trailer

Turn one video into a 30–60 second animated trailer. Scripts do the mechanical work. You make the creative decisions: style, clips, title copy and one custom hero scene.

`<skill-dir>` means the directory that contains this SKILL.md. Always run the HyperFrames CLI as `npx --yes hyperframes@0.8.104 <command>`.

## Arguments

`/yt-trailer <url | --file path> [--style cinematic|highlight|hype] [--vertical] [--length 30|45|60] [--music file] [--no-music] [--cookies-from-browser browser] [--draft]`

Defaults: style chosen by you, 16:9, 45 s, music chosen by you, delivery quality.

## Rights notice

Before the first download in a session, tell the user once: "Downloading from YouTube may violate YouTube's Terms of Service. Use this only on videos you own, Creative Commons videos, or videos you have permission to use." Then continue without waiting.

## Workflow

### 1. Check dependencies

Run `bash <skill-dir>/scripts/doctor.sh`. If it exits 1, show its output to the user and stop. On the first run in a session also run `npx --yes hyperframes@0.8.104 browser ensure`.

### 2. Fetch

Run `python3 <skill-dir>/scripts/fetch.py --url "<url>"` (add `--cookies-from-browser <browser>` if given), or `--file "<path>"`. It prints `{"workdir": ..., "videoId": ...}`. Call that directory WORK.
On exit 2, show the `ERROR:` line to the user word for word and stop.

### 3. Analyze

Run both:
- `python3 <skill-dir>/scripts/analyze.py WORK`
- `python3 <skill-dir>/scripts/palette.py WORK`

### 4. Plan the edit

Read `references/edl-guide.md`, then `WORK/source/info.json`, `WORK/candidates.json` and `WORK/palette.json`. Write `WORK/edl.json`. `schema/edl.schema.json` is the exact format.

### 5. Write the hero scene

Skip this step if the plan has no `hero` scene. Otherwise read `references/scene-contract.md` and load the `hyperframes-animation` skill for motion technique. Write `WORK/custom/hero.html`, one opening scene made for this specific video. You may search the HyperFrames registry (`npx --yes hyperframes@0.8.104 catalog --query "<effect>"`) for ideas, but the hero must be one self-contained file that follows the contract.

### 6. Build

Run `node <skill-dir>/scripts/build.mjs WORK`.
- If it prints `EDL INVALID:`, fix `edl.json` to address every listed error and build again. After 3 failed attempts, stop and show the errors to the user.
- If it prints `BUILD FAILED: unfilled scene tokens`, fix the hero file's tokens and build again.

### 7. Beat sync (only when the plan has music)

```bash
cd WORK/project && npx --yes hyperframes@0.8.104 beats --json
cp "$(find WORK/project/beats -name '*.json' | head -1)" WORK/beats.json
node <skill-dir>/scripts/build.mjs WORK --beats WORK/beats.json
```
If `beats` finds no beats, skip this step.

### 8. Check

Run `npx --yes hyperframes@0.8.104 check --snapshots` in `WORK/project`.
- If the findings point at the hero's composition file (`compositions/s<i>.html` for the hero scene), fix `WORK/custom/hero.html`, rebuild (step 6, plus `--beats` if used) and check again. If the second check still fails on the hero, rebuild with `--no-hero` and check again.
- For any other finding, change only `edl.json`, never the library scenes. Rebuild and check once more. If it still fails, stop and report the findings and the snapshot paths.

### 9. Render

Run `npx --yes hyperframes@0.8.104 render --quality delivery --output ../trailer.mp4` in `WORK/project`. With `--draft`, use `--quality draft`.

### 10. Verify and report

Run `python3 <skill-dir>/scripts/verify.py WORK`. If it fails, report the `FAIL:` lines.
On success, tell the user:
- the path to `WORK/trailer.mp4`
- the chosen style and `styleReason`
- the length and format
- the music track used, if any
- how to tweak it: edit `WORK/edl.json`, then repeat steps 6–10
````

- [ ] **Step 3: Write the edit-plan guide**

`skills/yt-trailer/references/edl-guide.md`:
````markdown
# Writing edl.json

## 1. Pick the style

If the user passed `--style`, use it. Otherwise choose from the title, description, categories, chapters and transcript:

| Style | Typical content |
|---|---|
| `highlight` | Talks, tutorials, podcasts, interviews, explainers, reviews |
| `hype` | Gaming, sports, action vlogs, music videos, travel montages |
| `cinematic` | Short films, documentaries, story-driven vlogs, trailers, nature |

If signals conflict, pick the style with the most evidence. Write one sentence of evidence in `styleReason`.

## 2. Fixed fields

- `format`: `"9:16"` if `--vertical`, else `"16:9"`.
- `duration`: from `--length`, default 45.
- `palette`: copy `bg`, `accent` and `fg` from `palette.json`.
- `music`:
  - `--no-music` → `null`.
  - `--music <file>` → `{"track": "<absolute path>", "duck": true}`.
  - Otherwise, for `cinematic` and `hype`, choose a track from `assets/music/manifest.json` with the matching style and the closest mood: `{"track": "assets/music/<file>", "duck": true}`.
  - For `highlight`, add music only when most clips have no speech. Otherwise use `null`.
- `overlays`:
  - cinematic: `["letterbox", "grain-lightleak"]`
  - hype: `["glitch-rgb"]`
  - highlight: `[]`
  
  Drop `letterbox` for `9:16` unless the footage is very wide.

## 3. Choose the shots (6–15)

Sources in `candidates.json`:
- `scenes`: cut points. Start clips about 0.2 s after a cut so they open cleanly.
- `peaks`: the loudest moments. These are strong candidates for hype and climaxes.
- `transcript`: lines with times. Set speech clips' `in` and `out` to line boundaries so no word is cut off.
- `chapters`: the structure of the video. Spread shots across chapters.

Rules:
- Skip the first and last 3% of the video (intros, outros, end screens).
- Spread shots across the whole video. Don't take more than 3 shots from any 10% slice.
- Clip lengths by style: hype 0.6–1.5 s, cinematic 1.5–3.5 s, highlight 2.5–5 s.
- Cinematic: never show the ending or the resolution.
- Highlight: give 2–4 speech clips a `caption` (at most 80 characters), using the strongest line from the transcript in that range, lightly trimmed.
- If `hasCaptions` is false, choose by `scenes` and `peaks` only, and take title text from the title and description.
- If the video has no audio (`hasAudio` false in `info.json`), use music for cinematic and hype; highlight still works silently.
- Vertical: set `cropX` (0–1) when the subject is clearly left or right of center. Look at `npx --yes hyperframes@0.8.104 snapshot` frames of the source when unsure. The default is centered.
- If the source is shorter than the trailer, use `slowmo`, longer title scenes and a `montage` to fill the time. Never repeat the same source range twice.

## 4. Clip fx

| fx | Effect | Duration effect |
|---|---|---|
| `slowmo` | Half speed | Timeline length = 2 × (out − in) |
| `speed-ramp` | Speeds from 1× to 2× | Timeline length = (out − in) / 1.5 |
| `flash-punch` | White flash plus a zoom punch at the cut | none |
| `push-in` | Slow 15% zoom across the clip | none |
| `zoom-in` | Fast zoom and blur into the clip | none |

Use at most one of `flash-punch`, `push-in` and `zoom-in` per clip. Never combine `slowmo` and `speed-ramp`. Clips without a motion fx get a gentle 4% drift automatically.

## 5. Structure by style

- **cinematic**: hero (3–4 s) → quiet clip → title → building clips with `push-in` → title → a `slowmo` beat → a fast run of 3–4 clips or a montage → final title → end-card (5–6 s). Title text is uppercase and short (2–4 words), using the "ONE MAN… ONE CHOICE…" rhythm.
- **hype**: hero (2–3 s) → a burst of 1 s clips with `flash-punch` or `speed-ramp` → `hype/kinetic-slam` titles of 1–3 punchy words every 4–6 clips → a montage → end-card (3–4 s).
- **highlight**: `highlight/chapter-bumper` (or hero) → speech clips with captions → a `highlight/quote-card` with the best line (up to 120 characters) → more clips → end-card (4–5 s).

## 6. Text rules

- `title.text`: at most 40 characters (120 for `highlight/quote-card`). `sub` is optional.
- Write titles from the video's real content. Never promise something the video doesn't contain.
- `end-card.title`: the video title, shortened to 80 characters at most. `end-card.sub`: the channel name.
- `hero.text`: optional and at most 40 characters. It is shown by the hero scene (usually the video title or a hook).

## 7. Duration math

Add up every scene's length: clips use `(out − in)` divided by their rate, and every other scene uses `dur`. The total must equal `duration` within ±0.5 s. Adjust the end-card `dur` (2–6 s) last to make it add up.

## 8. Full example (45 s, cinematic, 30-minute source)

<!-- example-edl -->
```json
{
  "style": "cinematic",
  "styleReason": "Short film with narrative voice-over, slow pacing and a dramatic score",
  "format": "16:9",
  "duration": 45,
  "palette": { "bg": "#0b0f1a", "accent": "#e8c37a", "fg": "#f4f1ea" },
  "music": { "track": "assets/music/cinematic-1.mp3", "duck": true },
  "overlays": ["letterbox", "grain-lightleak"],
  "scenes": [
    { "type": "hero", "text": "THE LAST LIGHTHOUSE", "dur": 4 },
    { "type": "clip", "in": 132.4, "out": 135.1, "audio": "original" },
    { "type": "title", "scene": "cinematic/slow-push-title", "text": "ONE MAN", "dur": 2.5 },
    { "type": "clip", "in": 610.0, "out": 613.0, "fx": ["push-in"] },
    { "type": "clip", "in": 300.0, "out": 301.5, "fx": ["slowmo"] },
    { "type": "title", "scene": "cinematic/black-to-title", "text": "ONE CHOICE", "dur": 2.5 },
    { "type": "clip", "in": 845.2, "out": 848.2 },
    { "type": "clip", "in": 1020.0, "out": 1023.0, "audio": "mute" },
    { "type": "montage", "panels": [{ "in": 400 }, { "in": 920 }, { "in": 1300 }], "dur": 3 },
    { "type": "clip", "in": 1500.0, "out": 1503.3, "fx": ["zoom-in"] },
    { "type": "title", "scene": "cinematic/slow-push-title", "text": "EVERYTHING CHANGES", "dur": 2.5 },
    { "type": "clip", "in": 1610.0, "out": 1613.5 },
    { "type": "clip", "in": 1702.0, "out": 1705.0 },
    { "type": "end-card", "title": "The Last Lighthouse", "sub": "Blue Hour Films", "dur": 6 }
  ]
}
```

Check: 4 + 2.7 + 2.5 + 3 + 3 + 2.5 + 3 + 3 + 3 + 3.3 + 2.5 + 3.5 + 3 + 6 = 45.0. Shots: 8 clips + 3 montage panels = 11.
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including both in `docs.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add skills/yt-trailer/SKILL.md skills/yt-trailer/references/edl-guide.md tests/js/docs.test.mjs
git commit -m "feat: add skill workflow and edit plan guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: End-to-end runs, trigger evals, README and spec sync

**Files:**
- Create: `tests/e2e/run_local.sh`, `tests/e2e/edl.highlight.json`, `tests/e2e/edl.cinematic.json`, `tests/evals/trigger-prompts.json`, `README.md`, `docs/e2e-results.md`
- Modify: `docs/superpowers/specs/2026-10-01-yt-trailer-design.md` (apply the "Spec refinements" listed at the top of this plan)

**Interfaces:**
- Consumes: every script, the scenes, the music and SKILL.md.
- Produces: `npm run test:e2e` renders and verifies two trailers from a generated 70 s test video, with no network access and no Claude decisions involved.

- [ ] **Step 1: Write the two fixed edit plans**

`tests/e2e/edl.highlight.json`:
```json
{
  "style": "highlight",
  "styleReason": "e2e fixture",
  "format": "16:9",
  "duration": 30,
  "palette": { "bg": "#0b0f1a", "accent": "#4fb3ff", "fg": "#f4f1ea" },
  "music": null,
  "overlays": [],
  "scenes": [
    { "type": "title", "scene": "highlight/chapter-bumper", "text": "THE TEST PATTERN", "sub": "PART ONE", "dur": 2.5 },
    { "type": "clip", "in": 2, "out": 5, "caption": "Colors in motion" },
    { "type": "clip", "in": 10, "out": 13, "fx": ["push-in"] },
    { "type": "clip", "in": 20, "out": 23 },
    { "type": "title", "scene": "highlight/quote-card", "text": "Every frame tells a story", "sub": "THE NARRATOR", "dur": 3 },
    { "type": "clip", "in": 30, "out": 33, "fx": ["zoom-in"] },
    { "type": "clip", "in": 40, "out": 43 },
    { "type": "clip", "in": 50, "out": 52, "fx": ["slowmo"] },
    { "type": "clip", "in": 60, "out": 62.5 },
    { "type": "end-card", "title": "Test Pattern", "sub": "yt-trailer e2e", "dur": 3 }
  ]
}
```

`tests/e2e/edl.cinematic.json`:
```json
{
  "style": "cinematic",
  "styleReason": "e2e fixture",
  "format": "9:16",
  "duration": 30,
  "palette": { "bg": "#0b0f1a", "accent": "#e8c37a", "fg": "#f4f1ea" },
  "music": { "track": "assets/music/cinematic-1.mp3", "duck": true },
  "overlays": ["letterbox", "grain-lightleak", "glitch-rgb"],
  "scenes": [
    { "type": "hero", "text": "PATTERNS", "dur": 3 },
    { "type": "clip", "in": 1, "out": 3.5 },
    { "type": "title", "scene": "cinematic/black-to-title", "text": "IN A WORLD", "dur": 2.5 },
    { "type": "clip", "in": 12, "out": 14.5, "fx": ["push-in"], "cropX": 0.3 },
    { "type": "clip", "in": 25, "out": 26.5, "fx": ["slowmo"] },
    { "type": "montage", "panels": [{ "in": 33 }, { "in": 44 }], "dur": 2.5 },
    { "type": "clip", "in": 48, "out": 50, "fx": ["flash-punch"] },
    { "type": "title", "scene": "cinematic/slow-push-title", "text": "OF PATTERNS", "dur": 2 },
    { "type": "clip", "in": 55, "out": 57.5, "fx": ["speed-ramp"] },
    { "type": "clip", "in": 60, "out": 62.5, "fx": ["zoom-in"] },
    { "type": "end-card", "title": "Test Pattern", "sub": "yt-trailer e2e", "dur": 5.83 }
  ]
}
```

- [ ] **Step 2: Write the e2e script**

`tests/e2e/run_local.sh`:
```bash
#!/usr/bin/env bash
# Offline end-to-end run: generate a 70 s video, then build, check, render and verify two trailers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SKILL="$ROOT/skills/yt-trailer"
HF="hyperframes@0.8.104"
OUT="$(mktemp -d)"
SRC="$OUT/e2e-fixture.mp4"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=s=1280x720:d=70:r=30" \
  -f lavfi -i "sine=frequency=330:duration=70" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac "$SRC"

bash "$SKILL/scripts/doctor.sh"
WORK="$(python3 "$SKILL/scripts/fetch.py" --file "$SRC" --out-root "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workdir"])')"
python3 "$SKILL/scripts/analyze.py" "$WORK"
python3 "$SKILL/scripts/palette.py" "$WORK"

for style in highlight cinematic; do
  echo "=== $style"
  cp "$ROOT/tests/e2e/edl.$style.json" "$WORK/edl.json"
  mkdir -p "$WORK/custom"
  cp "$ROOT/tests/fixtures/hero.html" "$WORK/custom/hero.html"
  rm -f "$WORK/beats.json"
  node "$SKILL/scripts/build.mjs" "$WORK"
  if grep -q '"music": {' "$WORK/edl.json"; then
    (cd "$WORK/project" && npx --yes "$HF" beats --json)
    cp "$(find "$WORK/project/beats" -name '*.json' | head -1)" "$WORK/beats.json"
    node "$SKILL/scripts/build.mjs" "$WORK" --beats "$WORK/beats.json"
  fi
  (cd "$WORK/project" && npx --yes "$HF" check)
  (cd "$WORK/project" && npx --yes "$HF" render --quality draft --output ../trailer.mp4)
  python3 "$SKILL/scripts/verify.py" "$WORK"
  cp "$WORK/trailer.mp4" "$OUT/trailer-$style.mp4"
done
echo "E2E OK: $OUT/trailer-highlight.mp4 $OUT/trailer-cinematic.mp4"
```

Run: `chmod +x tests/e2e/run_local.sh && npm run test:e2e`
Expected: the last line is `E2E OK: ...`. Open both MP4s and watch them. Check that:
- footage plays in every clip slot (no black panels)
- the titles animate
- the lower-third caption appears
- the music fades in and out (cinematic)
- the letterbox and grain are visible
- glitch flashes happen on the cuts

Fix any defect in the owning task's file and re-run.

- [ ] **Step 3: Run the skill on real YouTube videos**

Pick three Creative Commons videos. Use YouTube search with the filter *Features → Creative Commons* and choose:
- a talk or tutorial (5–20 min)
- a gaming or sports video (3–15 min)
- a short film (5–20 min, e.g. from the Blender Studio channel)

In a Claude Code session with this plugin installed locally (`/plugin marketplace add /Users/TonyStark/Desktop/web/yt-trailer`, then `/plugin install yt-trailer@yt-trailer`), run `/yt-trailer <url>` for each video. Then run once more with `--vertical --length 30` on the gaming video.

Record each run in `docs/e2e-results.md`:
```markdown
# E2E results (2026-10-01)

| Video | URL | Expected style | Chosen style | Length/format | verify.py | Notes |
|---|---|---|---|---|---|---|
| Talk | <url> | highlight | <chosen> | 45 s 16:9 | OK/FAIL | <issues seen> |
| Gaming | <url> | hype | <chosen> | 45 s 16:9 | OK/FAIL | |
| Gaming (vertical) | <url> | hype | <chosen> | 30 s 9:16 | OK/FAIL | |
| Short film | <url> | cinematic | <chosen> | 45 s 16:9 | OK/FAIL | |
```
Fill in every cell from the actual runs. Pass criteria: all four runs print `OK:` from verify.py, and the chosen style matches the expected style for all three videos. If a style choice is wrong, improve the style section of `references/edl-guide.md` and re-run that video.

- [ ] **Step 4: Trigger evals**

`tests/evals/trigger-prompts.json`:
```json
{
  "should_trigger": [
    "make a trailer for https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "turn this youtube video into a hype teaser: https://youtu.be/abc123",
    "/yt-trailer https://youtu.be/abc123 --vertical",
    "can you cut a 30 second promo from ~/Movies/vlog.mp4",
    "create a cinematic trailer from my video file talk.mov",
    "I need a highlight reel of this podcast episode https://www.youtube.com/watch?v=xyz"
  ],
  "should_not_trigger": [
    "download this youtube video as mp3",
    "summarize this youtube video for me",
    "write a movie trailer script about space pirates",
    "compress this mp4 to under 10MB",
    "add subtitles to my video",
    "what's the best video editing software for mac"
  ]
}
```
Run `/skill-creator` and use its description-evaluation workflow with these prompts. Pass criteria: every `should_trigger` prompt triggers and no `should_not_trigger` prompt triggers. If one misfires, adjust only the `description` line in SKILL.md and re-run. Then re-run `npm test`, because `docs.test.mjs` checks the frontmatter.

- [ ] **Step 5: Write README.md**

`README.md`:
````markdown
# yt-trailer

A Claude Code skill that turns a YouTube URL or a video file into a short, animated trailer. Claude watches the video's structure through its transcript, scene cuts and loud moments. It picks a style (cinematic, highlight or hype), chooses the best shots, writes title cards and designs a custom opening scene. [HyperFrames](https://hyperframes.heygen.com) renders the result to MP4.

> **Use it responsibly.** Downloading videos from YouTube may violate YouTube's Terms of Service. Only use this on videos you own, Creative Commons videos, or videos you have permission to use. For anything else, use `--file` with a copy you have rights to.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- Node.js 22 or newer
- Python 3.10 or newer
- ffmpeg
- yt-dlp
- The HyperFrames agent skills (see https://hyperframes.heygen.com)

The skill checks all of these on every run and prints install commands for anything missing.

## Install

```
/plugin marketplace add amateurcoder015/claude-skill
/plugin install yt-trailer@yt-trailer
```

Or copy `skills/yt-trailer` into `~/.claude/skills/`.

## Use

```
/yt-trailer https://www.youtube.com/watch?v=VIDEO_ID
/yt-trailer https://youtu.be/VIDEO_ID --style hype --vertical --length 30
/yt-trailer --file ~/Movies/my-film.mp4 --music ~/Music/score.mp3
```

| Flag | Default | Meaning |
|---|---|---|
| `--style cinematic\|highlight\|hype` | chosen from the video | Force a style |
| `--vertical` | off | 1080×1920 for Shorts, Reels and TikTok |
| `--length 30\|45\|60` | 45 | Trailer length in seconds |
| `--music file` | bundled track when the style needs it | Use your own music |
| `--no-music` | off | Original audio only |
| `--file path` | none | Use a local video instead of a URL |
| `--cookies-from-browser name` | none | For age-restricted or blocked videos |
| `--draft` | off | Faster, lower-quality render for previews |

Output goes to `./trailer-<videoId>/trailer.mp4`. To tweak a trailer, edit `trailer-<videoId>/edl.json` and ask Claude to rebuild and render.

## Troubleshooting

- **"YouTube blocked the download"**: run `yt-dlp -U`, then retry with `--cookies-from-browser chrome` (or your browser).
- **Render is slow**: delivery renders of 45–60 s can take several minutes. Use `--draft` while experimenting.
- **Missing Chrome for rendering**: run `npx --yes hyperframes@0.8.104 browser ensure`.

## Development

```bash
python3 -m pip install pytest
python3 -m pytest          # Python scripts
npm test                   # Node build pipeline
npm run test:scenes        # render-check every scene (slow)
npm run test:e2e           # offline end-to-end render (slow)
```

## License

Code: MIT (see `LICENSE`). Bundled music: CC0 (see `LICENSES-MUSIC.md`).
````

- [ ] **Step 6: Sync the spec**

Edit `docs/superpowers/specs/2026-10-01-yt-trailer-design.md` so it matches what was built:
- §3: add the `--draft` flag row.
- §4: replace the architecture tree with the File Structure tree from this plan. In the pipeline, add the 15 s minimum to fetch, the non-English caption fallback, `hasAudio`, and the beats rebuild step (`beats` → `WORK/beats.json` → `build.mjs --beats`).
- §7: replace the Layer 1 table with:
  - title scenes: `cinematic/slow-push-title`, `cinematic/black-to-title`, `hype/kinetic-slam`, `highlight/quote-card`, `highlight/chapter-bumper`
  - one end-card per style
  - overlays: `letterbox`, `grain-lightleak`, `glitch-rgb`
  - clip fx: `slowmo`, `speed-ramp`, `flash-punch`, `push-in`, `zoom-in`
  - clip `caption` (lower third) and the `montage` scene
  
  Change Layer 2 to say registry blocks may be used only inside the hero scene.
- §8: replace the example with the guide's example and the palette object, and add the rules: 6–15 shots, at most one motion fx, no slowmo with speed-ramp, quote-card text up to 120 characters.

- [ ] **Step 7: Run everything and commit**

Run: `python3 -m pytest && npm test`
Expected: every test passes.

```bash
git add tests/e2e tests/evals README.md docs
git commit -m "test: add end-to-end runs, trigger evals and README; sync spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
