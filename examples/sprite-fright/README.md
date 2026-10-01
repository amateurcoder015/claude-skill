# Sample: Sprite Fright trailer

A 45-second cinematic trailer made by this skill from Blender Studio's short film *Sprite Fright*.

- **Source:** "Sprite Fright - Blender Open Movie" by Blender Studio, https://www.youtube.com/watch?v=_cMxraX_5RE
- **Source license:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see the [Wikimedia Commons record](https://commons.wikimedia.org/wiki/File:Sprite_Fright_-_Blender_Open_Movie-full_movie.webm)). Footage © Blender Foundation | studio.blender.org.
- **Changes:** clips were selected, trimmed, reordered and retimed (slow motion), and title cards, overlays and a music bed were added.
- **Music:** "Inevitable" by vitalezzz, CC0 (https://opengameart.org/content/inevitable).

This trailer is released under CC BY 4.0, like its source.

## Files

| File | What it is |
|---|---|
| `trailer.mp4` | The rendered trailer (1920×1080, 45 s) |
| `poster.jpg` | A frame from the hero title |
| `edl.json` | The edit plan Claude wrote: style, 13 shots, title cards, music |
| `hero.html` | The custom opening scene Claude wrote for this film |

## How it was made

```
/yt-trailer https://www.youtube.com/watch?v=_cMxraX_5RE
```

1. `fetch.py` downloaded the 10.5-minute film with its English captions.
2. `analyze.py` found the scene cuts, the loudest moments (clustered in the 281–508 s night attack) and 80 caption lines.
3. Claude chose the **cinematic** style (narrative short film). It picked shots that build from the sunny campsite to the night attack and avoided the ending.
4. Claude wrote the edit plan and a custom mushroom-themed hero scene.
5. `build.mjs` built the HyperFrames project. The beat detector found 151.9 BPM, and every cut was snapped to the nearest beat.
6. `hyperframes check` passed, then `hyperframes render` produced the MP4, and `verify.py` confirmed its length and format.
