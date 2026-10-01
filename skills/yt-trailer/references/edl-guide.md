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
