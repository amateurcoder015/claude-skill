import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SKILL_DIR = join(ROOT, "skills", "yt-trailer");

export function validEdl() {
  return {
    style: "highlight",
    styleReason: "Tutorial with a single speaker",
    format: "16:9",
    duration: 30,
    palette: { bg: "#0b0f1a", accent: "#e8c37a", fg: "#f4f1ea" },
    music: null,
    overlays: [],
    scenes: [
      { type: "title", scene: "highlight/chapter-bumper", text: "PART ONE", sub: "THE BASICS", dur: 2 },
      { type: "clip", in: 5, out: 8, audio: "original", caption: "Tom's \"big\" <idea> & more" },
      { type: "clip", in: 15, out: 18, fx: ["push-in"] },
      { type: "clip", in: 25, out: 28 },
      { type: "clip", in: 35, out: 38, fx: ["zoom-in"] },
      { type: "clip", in: 45, out: 48 },
      { type: "clip", in: 55, out: 58, audio: "mute" },
      { type: "title", scene: "highlight/quote-card", text: "Every frame tells a story", dur: 3 },
      { type: "clip", in: 65, out: 68 },
      { type: "end-card", title: "Sample & \"Quotes\"", sub: "Chan", dur: 4 },
    ],
  };
}

export function ctx(overrides = {}) {
  return { sourceDuration: 120, skillDir: SKILL_DIR, workDir: mkdtempSync(join(tmpdir(), "ytt-")), ...overrides };
}
