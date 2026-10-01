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
