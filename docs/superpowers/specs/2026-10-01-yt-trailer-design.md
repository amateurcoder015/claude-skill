# yt-trailer — Design Spec

**Date:** 2026-10-01
**Status:** Approved design, pending implementation plan

## 1. Goal

A shareable Claude Code skill that turns a YouTube URL (or a local video file) into a short, highly animated trailer for that video. Anyone can install it and run it locally on their own machine.

### Success criteria

- `/yt-trailer <url>` produces `trailer-<videoId>/trailer.mp4` with no manual steps beyond installing dependencies.
- The trailer style matches the content of the video (auto-detected), and the user can override it.
- Animation quality is high enough that people want to share the output: beat-synced cuts, kinetic type, per-video palette, one custom hero scene per trailer.
- A missing dependency or blocked download ends with a clear, actionable message, never a stack trace.

### Non-goals (v1)

- No hosted website or server. Each user runs the skill locally.
- No source videos longer than 2 hours.
- No machine-learning installs (no local Whisper, no vision models). Analysis uses ffmpeg and captions only.

## 2. Distribution and requirements

- Lives in the GitHub repo `amateurcoder015/claude-skill`, packaged as a Claude Code plugin. Users install it with `/plugin install` or copy the skill folder into `~/.claude/skills/`.
- Runtime requirements on the user's machine:
  - Claude Code
  - Node.js 22 or newer (required by HyperFrames)
  - ffmpeg
  - yt-dlp
  - Python 3.10 or newer
  - The HyperFrames skills (`hyperframes`, `hyperframes-core`, `hyperframes-animation`, `hyperframes-cli`, `hyperframes-registry`)
- README includes a copyright and Terms of Service notice: use only on videos you own, Creative Commons videos, or videos you have permission to use. Downloading from YouTube may violate YouTube's Terms of Service.

## 3. Invocation

```
/yt-trailer <url | --file path.mp4> [--style cinematic|highlight|hype] [--vertical] [--length 30|45|60] [--music file.mp3] [--no-music] [--cookies-from-browser <browser>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--style` | auto | Override the auto-detected style |
| `--vertical` | off | Render 1080×1920 instead of 1920×1080 |
| `--length` | 45 | Trailer length in seconds |
| `--music` | none | Use this audio file as the music track |
| `--no-music` | off | Never add a music track; original audio only |
| `--file` | none | Use a local video instead of a URL |
| `--cookies-from-browser` | none | Passed to yt-dlp for age-restricted or blocked videos |

## 4. Architecture

```
yt-trailer/
├── .claude-plugin/plugin.json
├── skills/yt-trailer/
│   ├── SKILL.md                # workflow Claude follows
│   ├── scripts/
│   │   ├── doctor.sh           # dependency check, prints install commands
│   │   ├── fetch.py            # yt-dlp download: 720p mp4 + captions + info.json
│   │   ├── analyze.py          # scene cuts + audio peaks + transcript → candidates.json
│   │   ├── palette.py          # dominant colors from sampled frames
│   │   └── build.mjs           # edl.json + scene library → HyperFrames project
│   ├── schema/edl.schema.json
│   ├── scenes/
│   │   ├── cinematic/          # tested HyperFrames sub-compositions
│   │   ├── hype/
│   │   ├── highlight/
│   │   └── shared/             # clip player, end card, music bed
│   └── assets/music/           # CC0 tracks + manifest.json (style, mood, bpm)
├── tests/
├── docs/
└── README.md
```

### Pipeline

1. **doctor.sh** checks every requirement. If one is missing, it prints the exact install command for the user's OS and stops.
2. **fetch.py** downloads into `./trailer-<videoId>/source/`:
   - `video.mp4` (720p or best available up to 720p)
   - `captions.vtt` (uploaded captions preferred, auto-generated captions as fallback, absent if neither exists)
   - `info.json` (title, channel, description, duration, chapters)

   With `--file`, it copies the local file and generates a minimal `info.json` from the file name and ffprobe.
3. **analyze.py** writes `candidates.json`:
   - Scene-change timestamps (ffmpeg `select='gt(scene,0.4)'`)
   - Audio loudness peaks (ffmpeg `ebur128` momentary loudness, top N windows)
   - Transcript lines with timestamps, de-duplicated from auto-caption roll-up
   - Chapters from `info.json` if present

   Output stays compact (target under 30 KB) so Claude can read it cheaply.
4. **palette.py** samples about 12 frames and writes 3–5 dominant colors to `palette.json`.
5. **Claude plans the edit.** It reads `candidates.json`, `info.json` and `palette.json`, then writes `edl.json`:
   - Style: from `--style`, or auto-detected (rules in section 5)
   - 6–15 clips with in/out points, in trailer order
   - Title-card text
   - Music decision (rules in section 6)
   - One custom hero scene (section 7)
6. **build.mjs** validates `edl.json` against `edl.schema.json`, assembles a HyperFrames project in `./trailer-<videoId>/project/`, and copies the needed scenes and media.
7. If music is used, `npx hyperframes beats` runs on the track, and `build.mjs` snaps cut points and type hits to the nearest beat (within ±150 ms).
8. `npx hyperframes check --snapshots`, then `npx hyperframes render --quality delivery`. Output: `./trailer-<videoId>/trailer.mp4`.
9. ffprobe verifies duration (±0.5 s of target), resolution and the presence of an audio stream.

### Unit boundaries

| Unit | Input | Output | Depends on |
|---|---|---|---|
| doctor.sh | none | exit code + messages | shell |
| fetch.py | URL or file, flags | `source/` folder | yt-dlp, ffprobe |
| analyze.py | `source/` | `candidates.json` | ffmpeg |
| palette.py | `source/video.mp4` | `palette.json` | ffmpeg |
| build.mjs | `edl.json`, scenes, source | `project/` | Node 22, schema |
| SKILL.md | user request | orchestration + `edl.json` + hero scene | all of the above |

Every script runs on its own from the command line, so each can be tested separately.

## 5. Style auto-detection

Claude chooses the style from the title, description, category, chapters and transcript:

| Style | Typical content |
|---|---|
| `highlight` | Talks, tutorials, podcasts, interviews, explainers, reviews |
| `hype` | Gaming, sports, action vlogs, music videos, travel montages |
| `cinematic` | Short films, documentaries, story-driven vlogs, trailers, nature |

When the signals conflict, Claude picks the style with the most matching evidence and records its reason in `edl.json` (`styleReason`). `--style` always wins.

## 6. Music

- Original clip audio plays by default.
- Claude adds a bundled CC0 track when the style needs it: usually `cinematic` and `hype`, rarely `highlight`. The track is chosen from `assets/music/manifest.json` by style and mood.
- `--music file.mp3` replaces the bundled choice. `--no-music` forces original audio only.
- When a music track plays under a clip that has speech, the music is ducked (lowered) during the speech.

## 7. Visual and animation system

### Layer 1: scene library

Tested HyperFrames sub-compositions for each style. Claude chooses and fills them; it does not edit them.

| Style | Scenes |
|---|---|
| cinematic | `slow-push-title`, `letterbox`, `grain-lightleak` (overlay), `slowmo-hold`, `black-to-title`, `end-card` |
| hype | `kinetic-slam`, `flash-punch`, `glitch-rgb` (overlay), `split-montage`, `speed-ramp`, `end-card` |
| highlight | `lower-third`, `quote-card`, `zoom-transition`, `chapter-bumper`, `end-card` |
| shared | `clip` (video player with trim, crop, volume), `music-bed` |

Every scene reads the palette from CSS variables (`--c-bg`, `--c-accent`, `--c-text`), so each trailer matches its source video.

### Layer 2: registry effects

Before hand-building an effect, the skill searches the HyperFrames registry (`npx hyperframes catalog --query ...`) and installs a matching block (glitch, grain, shimmer, CRT and similar). Installed blocks are referenced from `edl.json` via the `fx` field.

### Layer 3: custom hero scene

For each trailer, Claude writes one fully custom animated scene (usually the opening or the title reveal), using the `hyperframes-animation` skill. It goes in `project/custom/hero.html`.

- It must pass `npx hyperframes check`.
- If it fails twice, `edl.json` swaps it for the style's default title scene, and the run continues.

### Vertical format

With `--vertical`, each clip is cropped to 9:16. The crop is centered by default. Claude may set a per-clip `cropX` (0–1) when the subject is off-center, judged from snapshot frames.

## 8. Edit plan (`edl.json`)

```json
{
  "style": "cinematic",
  "styleReason": "Short film with narrative voice-over and slow pacing",
  "format": "16:9",
  "duration": 45,
  "palette": ["#0b0f1a", "#e8c37a", "#f4f1ea"],
  "music": { "track": "assets/music/cinematic-rise.mp3", "duck": true },
  "scenes": [
    { "type": "hero", "src": "custom/hero.html", "dur": 4 },
    { "type": "clip", "in": 132.4, "out": 135.1, "audio": "original" },
    { "type": "title", "scene": "cinematic/slow-push-title", "text": "ONE MAN", "dur": 2 },
    { "type": "clip", "in": 610.0, "out": 612.2, "fx": ["grain"], "cropX": 0.5 },
    { "type": "end-card", "title": "{video title}", "sub": "{channel}", "dur": 4 }
  ]
}
```

Validation rules (enforced by `build.mjs`):

- `style` is one of `cinematic`, `highlight`, `hype`.
- `format` is `16:9` or `9:16`.
- Every clip has `0 <= in < out <= source duration`.
- The sum of scene durations equals `duration` within ±0.5 s (clip duration = `out - in`).
- Every referenced scene, fx block and music file exists.
- Exactly one `end-card` scene, and it is last.

Validation failure prints every error. Claude fixes `edl.json` and runs the build again.

## 9. Error handling

| Failure | Behavior |
|---|---|
| Missing dependency | `doctor.sh` prints the install command for the OS and stops |
| Private, age-restricted, region-blocked or bot-blocked video | Message names the cause and suggests `--cookies-from-browser <browser>` or `--file local.mp4` |
| Video longer than 2 hours | Refuse with a message suggesting `--file` with a trimmed copy |
| No captions | Clips come from scene changes and audio peaks only; title text comes from title and description |
| `edl.json` invalid | All errors printed; Claude corrects and retries (max 3 attempts) |
| Hero scene fails check twice | Replace with the style's default title scene |
| Render fails | Run `check --snapshots`, attempt one fix, then report the error clearly with the log path |

## 10. Testing

- **Unit tests (pytest):** `analyze.py` and `palette.py` against short CC0 sample clips in `tests/fixtures/`.
- **Unit tests (node:test):** `build.mjs` validation, using valid and invalid `edl.json` fixtures.
- **Scene tests:** each library scene renders on its own with `npx hyperframes check` and fixture data.
- **End-to-end:** three reference videos (a talk, a gaming video, a short film), all Creative Commons. Each run must:
  - pick the expected style
  - produce an MP4 that passes the ffprobe checks
- **Skill trigger evals (skill-creator):** triggers on "make a trailer for <url>" and similar; does not trigger on unrelated video tasks.

## 11. Open risks

- **yt-dlp breakage:** YouTube changes often break yt-dlp. `doctor.sh` warns when yt-dlp is older than 30 days and prints the update command.
- **Render time:** delivery-quality renders of 45–60 s may take several minutes. `--quality draft` is available for previews.
- **Token cost:** the custom hero scene and edit planning use a meaningful number of tokens per run. `candidates.json` is kept small to limit this.
