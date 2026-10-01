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
11. When you split text into word or letter spans, put them inside one block element (for example `<span class="xx-line" style="display:block">`) and group letters into `inline-block` word spans with `white-space: nowrap`. Never make the spans direct children of a grid or flex container: each span becomes its own row and the text runs off the canvas.

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
