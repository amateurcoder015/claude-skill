import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateEdl, STYLES, FORMATS, CLIP_FX, OVERLAYS, TITLE_SCENES } from "../../skills/yt-trailer/scripts/lib/edl.mjs";
import { sceneDuration, layout } from "../../skills/yt-trailer/scripts/lib/timeline.mjs";
import { esc } from "../../skills/yt-trailer/scripts/lib/html.mjs";
import { validEdl, ctx, SKILL_DIR } from "./fixtures.mjs";

const has = (errors, needle) => errors.some((e) => e.includes(needle));

test("valid plan passes", () => {
  assert.deepEqual(validateEdl(validEdl(), ctx()), []);
});

test("style, format and duration are checked", () => {
  const edl = { ...validEdl(), style: "epic", format: "4:3", duration: 40 };
  const errors = validateEdl(edl, ctx());
  assert.ok(has(errors, "style"));
  assert.ok(has(errors, "format"));
  assert.ok(has(errors, "duration"));
});

test("clip outside the source is rejected", () => {
  const edl = validEdl();
  edl.scenes[1] = { type: "clip", in: 118, out: 121 };
  assert.ok(has(validateEdl(edl, ctx()), "within 0..120"));
});

test("durations must add up", () => {
  const edl = validEdl();
  edl.scenes.at(-1).dur = 6;
  assert.ok(has(validateEdl(edl, ctx()), "add up to 32.00s"));
});

test("end-card must be last and unique", () => {
  const edl = validEdl();
  edl.scenes.unshift(edl.scenes.pop());
  assert.ok(has(validateEdl(edl, ctx()), "end-card"));
});

test("shot count limits", () => {
  const edl = validEdl();
  edl.scenes = edl.scenes.filter((s, i) => !(s.type === "clip" && i > 4));
  assert.ok(has(validateEdl(edl, ctx()), "6-15"));
});

test("title scene, text length and fx combinations", () => {
  const edl = validEdl();
  edl.scenes[0] = { type: "title", scene: "highlight/nope", text: "X".repeat(41), dur: 2 };
  edl.scenes[2] = { type: "clip", in: 15, out: 18, fx: ["slowmo", "speed-ramp"] };
  edl.scenes[3] = { type: "clip", in: 25, out: 28, fx: ["push-in", "zoom-in"] };
  const errors = validateEdl(edl, ctx());
  assert.ok(has(errors, "unknown title scene"));
  assert.ok(has(errors, "at most 40"));
  assert.ok(has(errors, "slowmo and speed-ramp"));
  assert.ok(has(errors, "at most one of"));
});

test("quote-card allows longer text", () => {
  const edl = validEdl();
  edl.scenes[7].text = "Y".repeat(100);
  assert.deepEqual(validateEdl(edl, ctx()), []);
});

test("hero needs custom/hero.html", () => {
  const edl = validEdl();
  edl.scenes[0] = { type: "hero", dur: 2 };
  const c = ctx();
  assert.ok(has(validateEdl(edl, c), "custom/hero.html"));
  mkdirSync(join(c.workDir, "custom"));
  writeFileSync(join(c.workDir, "custom", "hero.html"), "<template></template>");
  assert.deepEqual(validateEdl(edl, c), []);
});

test("music track must exist", () => {
  const edl = { ...validEdl(), music: { track: "assets/music/missing.mp3", duck: true } };
  assert.ok(has(validateEdl(edl, ctx()), "music.track not found"));
});

test("montage panels count as shots and must fit the source", () => {
  const edl = validEdl();
  edl.scenes[7] = { type: "montage", panels: [{ in: 10 }, { in: 119 }], dur: 3 };
  assert.ok(has(validateEdl(edl, ctx()), "panels[1]"));
});

test("sceneDuration applies playback rate", () => {
  assert.equal(sceneDuration({ type: "clip", in: 10, out: 12, fx: ["slowmo"] }), 4);
  assert.equal(sceneDuration({ type: "clip", in: 10, out: 13, fx: ["speed-ramp"] }), 2);
  assert.equal(sceneDuration({ type: "title", dur: 2.5 }), 2.5);
});

test("layout assigns start times", () => {
  const timed = layout(validEdl().scenes);
  assert.deepEqual(timed.slice(0, 3).map((s) => [s.start, s.dur]), [[0, 2], [2, 3], [5, 3]]);
});

test("esc escapes html", () => {
  assert.equal(esc(`<a href="x">Tom's & co</a>`), "&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; co&lt;/a&gt;");
});

test("schema enums match validator constants", () => {
  const schema = JSON.parse(readFileSync(join(SKILL_DIR, "schema", "edl.schema.json"), "utf8"));
  assert.deepEqual(schema.properties.style.enum, STYLES);
  assert.deepEqual(schema.properties.format.enum, FORMATS);
  assert.deepEqual(schema.properties.overlays.items.enum, OVERLAYS);
  assert.deepEqual(schema.$defs.clip.properties.fx.items.enum, CLIP_FX);
  assert.deepEqual(schema.$defs.title.properties.scene.enum, TITLE_SCENES);
});
