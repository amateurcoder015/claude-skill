import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { sceneDuration } from "./timeline.mjs";

export const STYLES = ["cinematic", "highlight", "hype"];
export const FORMATS = ["16:9", "9:16"];
export const DURATIONS = [30, 45, 60];
export const CLIP_FX = ["slowmo", "speed-ramp", "flash-punch", "push-in", "zoom-in"];
export const MOTION_FX = ["flash-punch", "push-in", "zoom-in"];
export const OVERLAYS = ["letterbox", "grain-lightleak", "glitch-rgb"];
export const TITLE_SCENES = [
  "cinematic/slow-push-title",
  "cinematic/black-to-title",
  "hype/kinetic-slam",
  "highlight/quote-card",
  "highlight/chapter-bumper",
];
export const DEFAULT_TITLE = {
  cinematic: "cinematic/slow-push-title",
  hype: "hype/kinetic-slam",
  highlight: "highlight/chapter-bumper",
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v) => typeof v === "number" && Number.isFinite(v);

export function resolveTrack(track, skillDir) {
  return isAbsolute(track) ? track : join(skillDir, track);
}

function requireText(value, at, max, err) {
  if (typeof value !== "string" || !value.trim()) err(`${at} must be non-empty text`);
  else if (value.length > max) err(`${at} must be at most ${max} characters`);
}

function requireDur(scene, at, err, min, max) {
  if (!num(scene.dur) || scene.dur < min || scene.dur > max) err(`${at}: dur must be a number from ${min} to ${max}`);
}

function validateScene(s, i, ctx, err) {
  const at = `scenes[${i}]`;
  switch (s?.type) {
    case "clip": {
      if (!num(s.in) || !num(s.out)) {
        err(`${at}: clip needs numeric in and out`);
        return;
      }
      if (s.in < 0 || s.out > ctx.sourceDuration) err(`${at}: in/out must be within 0..${ctx.sourceDuration}`);
      if (s.out - s.in < 0.3) err(`${at}: clip must be at least 0.3s long (out > in)`);
      const fx = s.fx || [];
      for (const f of fx) if (!CLIP_FX.includes(f)) err(`${at}: unknown fx "${f}"; use ${CLIP_FX.join(", ")}`);
      if (fx.includes("slowmo") && fx.includes("speed-ramp")) err(`${at}: slowmo and speed-ramp cannot be combined`);
      if (fx.filter((f) => MOTION_FX.includes(f)).length > 1) err(`${at}: use at most one of ${MOTION_FX.join(", ")}`);
      if (s.audio != null && !["original", "mute"].includes(s.audio)) err(`${at}: audio must be "original" or "mute"`);
      if (s.cropX != null && !(num(s.cropX) && s.cropX >= 0 && s.cropX <= 1)) err(`${at}: cropX must be between 0 and 1`);
      if (s.caption != null) requireText(s.caption, `${at}.caption`, 80, err);
      return;
    }
    case "montage": {
      if (!Array.isArray(s.panels) || s.panels.length < 2 || s.panels.length > 3) err(`${at}: montage needs 2-3 panels`);
      requireDur(s, at, err, 1, 6);
      (s.panels || []).forEach((p, j) => {
        if (!num(p?.in) || p.in < 0 || p.in + (s.dur || 0) > ctx.sourceDuration) {
          err(`${at}.panels[${j}]: in must be a number with in + dur within the video`);
        }
      });
      return;
    }
    case "title":
      if (!TITLE_SCENES.includes(s.scene)) err(`${at}: unknown title scene "${s.scene}"; use ${TITLE_SCENES.join(", ")}`);
      requireText(s.text, `${at}.text`, s.scene === "highlight/quote-card" ? 120 : 40, err);
      if (s.sub != null && typeof s.sub !== "string") err(`${at}.sub must be text`);
      requireDur(s, at, err, 1, 6);
      return;
    case "hero":
      requireDur(s, at, err, 2, 8);
      if (s.text != null) requireText(s.text, `${at}.text`, 40, err);
      if (!existsSync(join(ctx.workDir, "custom", "hero.html"))) err(`${at}: custom/hero.html is missing`);
      return;
    case "end-card":
      requireText(s.title, `${at}.title`, 80, err);
      requireDur(s, at, err, 2, 6);
      return;
    default:
      err(`${at}: unknown type "${s?.type}"; use clip, montage, title, hero or end-card`);
  }
}

export function validateEdl(edl, ctx) {
  if (!edl || typeof edl !== "object") return ["edl.json must be a JSON object"];
  const errors = [];
  const err = (m) => errors.push(m);
  if (!STYLES.includes(edl.style)) err(`style must be one of ${STYLES.join(", ")}`);
  if (!FORMATS.includes(edl.format)) err('format must be "16:9" or "9:16"');
  if (!DURATIONS.includes(edl.duration)) err(`duration must be one of ${DURATIONS.join(", ")}`);
  const palette = edl.palette || {};
  for (const key of ["bg", "accent", "fg"]) if (!HEX.test(palette[key] || "")) err(`palette.${key} must be a #rrggbb color`);
  if (edl.music != null) {
    if (typeof edl.music.track !== "string") err("music.track must be a file path");
    else if (!existsSync(resolveTrack(edl.music.track, ctx.skillDir))) err(`music.track not found: ${edl.music.track}`);
    if (edl.music.volume != null && !(num(edl.music.volume) && edl.music.volume > 0 && edl.music.volume <= 1)) {
      err("music.volume must be in (0, 1]");
    }
  }
  for (const o of edl.overlays || []) if (!OVERLAYS.includes(o)) err(`unknown overlay "${o}"; use ${OVERLAYS.join(", ")}`);
  const scenes = Array.isArray(edl.scenes) ? edl.scenes : [];
  if (!scenes.length) err("scenes must be a non-empty array");
  scenes.forEach((s, i) => validateScene(s, i, ctx, err));
  const endCards = scenes.filter((s) => s?.type === "end-card").length;
  if (endCards !== 1 || scenes.at(-1)?.type !== "end-card") err("exactly one end-card is required and it must be the last scene");
  if (scenes.filter((s) => s?.type === "hero").length > 1) err("at most one hero scene is allowed");
  const shots =
    scenes.filter((s) => s?.type === "clip").length +
    scenes.filter((s) => s?.type === "montage").reduce((n, s) => n + (s.panels?.length || 0), 0);
  if (shots < 6 || shots > 15) err(`use 6-15 shots (clips plus montage panels); found ${shots}`);
  if (errors.length === 0) {
    const total = scenes.reduce((n, s) => n + sceneDuration(s), 0);
    if (Math.abs(total - edl.duration) > 0.5) {
      err(`scene durations add up to ${total.toFixed(2)}s; they must equal duration ${edl.duration}s (±0.5s)`);
    }
  }
  return errors;
}
