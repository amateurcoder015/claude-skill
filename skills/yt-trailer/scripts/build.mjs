#!/usr/bin/env node
// Build a HyperFrames project from WORKDIR/edl.json.
// Usage: node build.mjs <workdir> [--beats FILE] [--no-hero]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, linkSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEdl, DEFAULT_TITLE, resolveTrack } from "./lib/edl.mjs";
import { composeIndex, DIMS } from "./lib/compose.mjs";
import { parseBeats, snapToBeats } from "./lib/beats.mjs";
import { fillScene } from "./lib/scenes.mjs";
import { HF_CONFIG } from "./lib/project.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function replaceHero(edl, title) {
  return {
    ...edl,
    scenes: edl.scenes.map((s) =>
      s.type === "hero" ? { type: "title", scene: DEFAULT_TITLE[edl.style], text: s.text || title.slice(0, 40), sub: s.sub, dur: s.dur } : s,
    ),
  };
}

function linkOrCopy(src, dest) {
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

export function build(workDir, { beatsFile = null, noHero = false, scenesDir = join(SKILL_DIR, "scenes") } = {}) {
  const read = (p) => JSON.parse(readFileSync(join(workDir, p), "utf8"));
  const info = read("source/info.json");
  const candidates = existsSync(join(workDir, "candidates.json")) ? read("candidates.json") : { transcript: [] };
  let edl = read("edl.json");
  if (noHero) edl = replaceHero(edl, String(info.title || "").toUpperCase());
  const ctx = { sourceDuration: info.duration, skillDir: SKILL_DIR, workDir };
  const errors = validateEdl(edl, ctx);
  if (errors.length) return { ok: false, errors };
  if (beatsFile) {
    const snapped = snapToBeats(edl, parseBeats(JSON.parse(readFileSync(beatsFile, "utf8"))), info.duration);
    if (validateEdl(snapped, ctx).length === 0) edl = snapped;
    else console.error("warning: beat snapping produced an invalid plan; using unsnapped cuts");
  }

  const project = join(workDir, "project");
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, "assets"), { recursive: true });
  mkdirSync(join(project, "compositions"), { recursive: true });
  linkOrCopy(join(workDir, "source", "video.mp4"), join(project, "assets", "video.mp4"));
  let musicSrc = null;
  if (edl.music) {
    const track = resolveTrack(edl.music.track, SKILL_DIR);
    musicSrc = `assets/music${extname(track)}`;
    copyFileSync(track, join(project, musicSrc));
  }

  const { html, subcomps } = composeIndex(edl, {
    transcript: candidates.transcript || [],
    musicSrc,
    hasAudio: info.hasAudio !== false,
  });
  const [W, H] = DIMS[edl.format];
  for (const sc of subcomps) {
    const file = sc.scene === "hero" ? join(workDir, "custom", "hero.html") : join(scenesDir, `${sc.scene}.html`);
    const filled = fillScene(readFileSync(file, "utf8"), {
      ID: sc.id, W, H, BG: edl.palette.bg, ACCENT: edl.palette.accent, FG: edl.palette.fg, HITS: "[]", ...sc.vars,
    });
    writeFileSync(join(project, "compositions", `${sc.id}.html`), filled);
  }
  writeFileSync(join(project, "index.html"), html);
  writeFileSync(join(project, "hyperframes.json"), JSON.stringify(HF_CONFIG, null, 2));
  writeFileSync(join(project, "meta.json"), JSON.stringify({ id: `trailer-${info.id}`, name: info.title, createdAt: new Date().toISOString() }, null, 2));
  writeFileSync(join(project, "edl.resolved.json"), JSON.stringify(edl, null, 2));
  return { ok: true, project, edl };
}

function main(argv) {
  const workDir = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--beats");
  if (!workDir) {
    console.error("usage: node build.mjs <workdir> [--beats FILE] [--no-hero]");
    return 2;
  }
  const beatsIdx = argv.indexOf("--beats");
  let result;
  try {
    result = build(resolve(workDir), {
      beatsFile: beatsIdx >= 0 ? resolve(argv[beatsIdx + 1]) : null,
      noHero: argv.includes("--no-hero"),
    });
  } catch (exc) {
    console.log(`BUILD FAILED: ${exc.message}`);
    return 2;
  }
  if (!result.ok) {
    console.log(["EDL INVALID:", ...result.errors.map((e) => `  - ${e}`)].join("\n"));
    return 2;
  }
  console.log(result.project);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
