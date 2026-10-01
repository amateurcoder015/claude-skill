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
/yt-trailer <url | --file path.mp4> [--style cinematic|highlight|hype] [--vertical] [--length 30|45|60] [--music file.mp3] [--no-music] [--cookies-from-browser <browser>] [--draft]
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
| `--draft` | off | Render with `--quality draft` for fast previews |

## 4. Architecture

```
yt-trailer/                               (repo root)
├── .claude-plugin/{plugin.json,marketplace.json}
├── skills/yt-trailer/
│   ├── SKILL.md                          workflow Claude follows
│   ├── references/{edl-guide.md,scene-contract.md}
│   ├── schema/edl.schema.json
│   ├── scripts/
│   │   ├── doctor.sh, fetch.py, analyze.py, palette.py, verify.py
│   │   ├── build.mjs                     edl.json → project/
│   │   └── lib/{html,timeline,edl,beats,compose,scenes,project}.mjs
│   ├── scenes/
│   │   ├── cinematic/{slow-push-title,black-to-title,end-card}.html
│   │   ├── hype/{kinetic-slam,end-card}.html
│   │   ├── highlight/{quote-card,chapter-bumper,end-card}.html
│   │   └── overlays/{letterbox,grain-lightleak,glitch-rgb}.html
│   └── assets/music/                     six CC0 tracks + manifest.json
├── tests/{py,js,scenes,e2e,evals,fixtures}
├── docs/
└── README.md, LICENSE, LICENSES-MUSIC.md
```

### Pipeline

1. **doctor.sh** checks every requirement. If one is missing, it prints the exact install command for the user's OS and stops.
2. **fetch.py** downloads into `./trailer-<videoId>/source/`:
   - `video.mp4` (720p or best available up to 720p)
   - `captions.vtt` (uploaded captions preferred, auto-generated captions as fallback, absent if neither exists)
   - `info.json` (title, channel, description, duration, chapters, `hasAudio`)

   Captions: English uploaded captions first, then English auto-captions, then captions in the video's own language. Sources shorter than 15 s or longer than 2 hours are refused.

   With `--file`, it copies the local file (converting non-MP4 files) and generates a minimal `info.json` from the file name and ffprobe. A sidecar `.vtt` next to the file is used as captions.
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
7. If music is used, `npx hyperframes beats` runs on the built project, the beat file is copied to `WORK/beats.json`, and `build.mjs --beats WORK/beats.json` rebuilds with each cut snapped to the nearest beat (within ±150 ms). The end-card absorbs the drift.
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
- Claude adds a bundled CC0 track (six tracks from OpenGameArt, two per style, normalized to -16 LUFS) when the style needs it: usually `cinematic` and `hype`, rarely `highlight`. The track is chosen from `assets/music/manifest.json` by style and mood.
- `--music file.mp3` replaces the bundled choice. `--no-music` forces original audio only.
- When a music track plays under a clip that has speech, the music is ducked (lowered) during the speech.

## 7. Visual and animation system

### Layer 1: scene library

Tested HyperFrames sub-compositions, chosen and filled by Claude, never edited per trailer. Scene files use tokens (`__ID__`, `__TEXT__`, `__BG__`, …) that `build.mjs` fills; the contract is in `references/scene-contract.md`.

| Kind | Items |
|---|---|
| Title scenes | `cinematic/slow-push-title`, `cinematic/black-to-title`, `hype/kinetic-slam`, `highlight/quote-card`, `highlight/chapter-bumper` |
| End-cards | one per style: `<style>/end-card` |
| Overlays (full length) | `letterbox`, `grain-lightleak`, `glitch-rgb` (flashes on every cut) |
| Clip fx | `slowmo`, `speed-ramp`, `flash-punch`, `push-in`, `zoom-in` (at most one of the last three per clip) |
| Clip extras | `caption` (animated lower third), `cropX` (vertical framing) |
| Montage | `montage` scene: 2–3 clips side by side (stacked in 9:16) |

Every scene uses the trailer palette (`bg`, `accent`, `fg`) taken from the source video's frames.

### Layer 2: registry effects

Registry blocks are not wired through `edl.json`. Claude may search the HyperFrames registry for ideas while writing the hero scene, but the hero must stay one self-contained file.

### Layer 3: custom hero scene

For each trailer, Claude writes one fully custom animated scene (usually the opening or the title reveal), using the `hyperframes-animation` skill. It goes in `WORK/custom/hero.html` and follows the scene contract.

- It must pass `npx hyperframes check`.
- If it fails twice, `edl.json` swaps it for the style's default title scene, and the run continues.

### Vertical format

With `--vertical`, each clip is cropped to 9:16. The crop is centered by default. Claude may set a per-clip `cropX` (0–1) when the subject is off-center, judged from snapshot frames.

## 8. Edit plan (`edl.json`)

The full format is `skills/yt-trailer/schema/edl.schema.json`. Example (from `references/edl-guide.md`):

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

Validation rules (enforced by `build.mjs`):

- `style` is one of `cinematic`, `highlight`, `hype`; `format` is `16:9` or `9:16`; `duration` is 30, 45 or 60.
- `palette` is an object `{bg, accent, fg}` of `#rrggbb` colors.
- Every clip has `0 <= in`, `out <= source duration` and is at least 0.3 s long.
- Clip duration on the timeline is `(out - in) / rate` (rate 0.5 for `slowmo`, 1.5 for `speed-ramp`, else 1). Every other scene uses `dur`. The sum equals `duration` within ±0.5 s.
- 6–15 shots (clips plus montage panels); at most one of `flash-punch`, `push-in`, `zoom-in` per clip; never `slowmo` with `speed-ramp`.
- Title text at most 40 characters (120 for `highlight/quote-card`).
- Every referenced scene and music file exists; a `hero` scene needs `WORK/custom/hero.html`.
- Exactly one `end-card` scene, and it is last.

Validation failure prints every error. Claude fixes `edl.json` and runs the build again.

## 9. Error handling

| Failure | Behavior |
|---|---|
| Missing dependency | `doctor.sh` prints the install command for the OS and stops |
| Private, age-restricted, region-blocked or bot-blocked video | Message names the cause and suggests `--cookies-from-browser <browser>` or `--file local.mp4` |
| Video longer than 2 hours or shorter than 15 s | Refuse with a clear message (`--file` with a trimmed copy for long videos) |
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
