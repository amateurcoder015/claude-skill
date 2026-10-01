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

## Sample

[`examples/sprite-fright/`](examples/sprite-fright/) has a 45-second cinematic trailer the skill made from Blender Studio's CC BY 4.0 short film *Sprite Fright*, along with the edit plan and custom hero scene Claude wrote for it.

![Sprite Fright trailer poster](examples/sprite-fright/poster.jpg)

## Troubleshooting

- **"YouTube blocked the download"**: run `yt-dlp -U`, then retry with `--cookies-from-browser chrome` (or your browser).
- **Render is slow**: on machines without a usable GPU, HyperFrames captures frames in software at about 1–2 s per frame, so a 45 s delivery render can take 30 minutes or more. Use `--draft` while experimenting.
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
