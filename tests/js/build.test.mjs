import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "../../skills/yt-trailer/scripts/build.mjs";
import { validEdl, ctx, ROOT } from "./fixtures.mjs";

const STUBS = join(ROOT, "tests", "js", "stub-scenes");

function makeWork(edl, info = {}) {
  const { workDir } = ctx();
  mkdirSync(join(workDir, "source"));
  writeFileSync(join(workDir, "source", "video.mp4"), "fake");
  writeFileSync(join(workDir, "source", "info.json"), JSON.stringify({ id: "t1", title: `Tom's "Big" Day`, duration: 120, hasAudio: true, ...info }));
  writeFileSync(join(workDir, "candidates.json"), JSON.stringify({ transcript: [] }));
  writeFileSync(join(workDir, "edl.json"), JSON.stringify(edl));
  return workDir;
}

test("build writes a complete project", () => {
  const work = makeWork(validEdl());
  const result = build(work, { scenesDir: STUBS });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const project = join(work, "project");
  for (const f of ["index.html", "hyperframes.json", "meta.json", "edl.resolved.json", "assets/video.mp4"]) {
    assert.ok(existsSync(join(project, f)), f);
  }
  assert.deepEqual(readdirSync(join(project, "compositions")).sort(), ["s0.html", "s7.html", "s9.html"]);
  const endCard = readFileSync(join(project, "compositions", "s9.html"), "utf8");
  assert.ok(endCard.includes("Sample &amp; &quot;Quotes&quot;"));
  assert.ok(endCard.includes('data-composition-id="s9"'));
  assert.ok(!/__[A-Z]+__/.test(endCard));
});

test("invalid plan returns errors and writes nothing", () => {
  const work = makeWork({ ...validEdl(), style: "epic" });
  const result = build(work, { scenesDir: STUBS });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("style")));
  assert.ok(!existsSync(join(work, "project")));
});

test("--no-hero swaps the hero for the default title", () => {
  const edl = { ...validEdl(), style: "cinematic" };
  edl.scenes[0] = { type: "hero", dur: 2 };
  const work = makeWork(edl);
  assert.equal(build(work, { scenesDir: STUBS }).ok, false); // hero file missing
  const result = build(work, { scenesDir: STUBS, noHero: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.edl.scenes[0].scene, "cinematic/slow-push-title");
  assert.equal(result.edl.scenes[0].text, `TOM'S "BIG" DAY`);
});

test("beats file snaps cuts", () => {
  const work = makeWork(validEdl());
  writeFileSync(join(work, "beats.json"), JSON.stringify({ beats: [2.1, 4.95] }));
  const result = build(work, { scenesDir: STUBS, beatsFile: join(work, "beats.json") });
  assert.equal(result.ok, true);
  assert.equal(result.edl.scenes[0].dur, 2.1);
});

test("CLI exits 2 with readable errors", () => {
  const work = makeWork({ ...validEdl(), duration: 31 });
  const proc = spawnSync(process.execPath, [join(ROOT, "skills/yt-trailer/scripts/build.mjs"), work], { encoding: "utf8" });
  assert.equal(proc.status, 2);
  assert.match(proc.stdout, /EDL INVALID:\n  - duration must be one of 30, 45, 60/);
});

test("build with real scenes and all overlays leaves no tokens", () => {
  const work = makeWork({ ...validEdl(), overlays: ["letterbox", "grain-lightleak", "glitch-rgb"] });
  const result = build(work);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  for (const f of readdirSync(join(work, "project", "compositions"))) {
    const html = readFileSync(join(work, "project", "compositions", f), "utf8");
    assert.ok(!/__[A-Z]+__/.test(html), `${f} has unfilled tokens`);
  }
});
