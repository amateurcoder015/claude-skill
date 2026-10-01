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
  if [ -d "$root" ] && [ -n "$(find "$root" -maxdepth 9 -path '*hyperframes-core/SKILL.md' -print 2>/dev/null | head -1)" ]; then
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
