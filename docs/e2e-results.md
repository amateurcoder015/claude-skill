# E2E results (2026-10-01)

## Offline pipeline (`npm run test:e2e`)

Generated 70 s test-pattern video, fixed edit plans, no network or Claude decisions.

| Plan | Format | Features exercised | `hyperframes check` | verify.py |
|---|---|---|---|---|
| `edl.highlight.json` | 30 s 16:9 | chapter-bumper, quote-card, caption, push-in, zoom-in, slowmo | passed | OK (30.00 s, 1920x1080) |
| `edl.cinematic.json` | 30 s 9:16 | custom hero, black-to-title, slow-push-title, montage, flash-punch, speed-ramp, zoom-in, cropX, music + beat snap + ducking, letterbox + grain + glitch overlays | passed | OK (30.00 s, 1080x1920) |

## Real YouTube run

| Video | URL | License | Expected style | Chosen style | Length/format | verify.py |
|---|---|---|---|---|---|---|
| Sprite Fright (Blender Studio short film) | https://www.youtube.com/watch?v=_cMxraX_5RE | CC BY 4.0 (Wikimedia Commons record) | cinematic | cinematic | 45 s 16:9 | see below |

Issues found on this run and fixed in the skill:
- `hyperframes check` flagged `duplicate_audio_track` at hard cuts between speech clips. Clip audio now alternates tracks 10 and 12.
- The first hero draft tweened `letterSpacing` (stutters in frame capture), wobbled letters into each other and had a red word under 3:1 contrast. All fixed in the hero; the scene contract already forbids layout tweens via `hyperframes check`.

Only one real YouTube video was run (the user asked for one sample). The talk, gaming and vertical runs from the plan are still to do.

## Trigger evals

`tests/evals/trigger-prompts.json` (16 queries) via skill-creator `run_eval`, 2 runs per query, on the global `claude` CLI's default model (the installed CLI 2.1.112 cannot run claude-opus-5-5).

| Description | Passed | Should-trigger hits | False triggers |
|---|---|---|---|
| Shipped description | 13/16 | 5/8 | 0/8 |
| Broader rewrite (rejected) | 11/16 | 3/8 | 0/8 |

Misses on the shipped description: the literal `/yt-trailer …` query (the harness registers the skill under a random suffixed name, so a slash command cannot match there), a conference-talk highlight reel, and a podcast teaser. With only 2 runs per query these rates are noisy.
