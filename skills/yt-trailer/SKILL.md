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
