import { test } from "node:test";
import assert from "node:assert/strict";
import { composeIndex, speechWindows, musicLane } from "../../skills/yt-trailer/scripts/lib/compose.mjs";
import { layout } from "../../skills/yt-trailer/scripts/lib/timeline.mjs";
import { validEdl } from "./fixtures.mjs";

test("root, canvas and timeline registration", () => {
  const { html } = composeIndex(validEdl());
  assert.match(html, /data-composition-id="main"[^>]*data-width="1920"[^>]*data-height="1080"[^>]*data-duration="30"/);
  assert.match(html, /window\.__timelines\["main"\] = tl;/);
  assert.match(html, /gsap@3\.14\.2/);
});

test("vertical format uses 1080x1920", () => {
  const { html } = composeIndex({ ...validEdl(), format: "9:16" });
  assert.match(html, /data-width="1080"[^>]*data-height="1920"/);
});

test("clips become trimmed muted video plus audio", () => {
  const { html } = composeIndex(validEdl());
  assert.match(html, /<video id="s1-v" class="clip" src="assets\/video.mp4" data-start="2" data-duration="3" data-media-start="5"[^>]*muted playsinline>/);
  assert.match(html, /<audio id="s1-a" src="assets\/video.mp4" data-start="2" data-duration="3" data-media-start="5"/);
  assert.doesNotMatch(html, /id="s6-a"/); // audio: "mute"
});

test("no audio elements when the source has no audio", () => {
  const { html } = composeIndex(validEdl(), { hasAudio: false });
  assert.doesNotMatch(html, /<audio/);
});

test("slowmo and speed-ramp", () => {
  const edl = validEdl();
  edl.scenes[3] = { type: "clip", in: 25, out: 26.5, fx: ["slowmo"] };
  edl.scenes[5] = { type: "clip", in: 45, out: 49.5, fx: ["speed-ramp"] };
  const { html } = composeIndex(edl);
  assert.match(html, /id="s3-v"[^>]*data-duration="3"[^>]*data-playback-rate="0.5"/);
  assert.match(html, /id="s5-v"[^>]*data-automation='\{"version":1,"lanes":\[\{"target":"rate","points":\[\{"t":0,"v":1\},\{"t":3,"v":2\}\]\}\]\}'/);
});

test("caption text is escaped", () => {
  const { html } = composeIndex(validEdl());
  assert.ok(html.includes("Tom&#39;s &quot;big&quot; &lt;idea&gt; &amp; more"));
  assert.ok(!html.includes("<idea>"));
});

test("motion fx emit timeline tweens", () => {
  const edl = validEdl();
  edl.scenes[2].fx = ["flash-punch"];
  const { html } = composeIndex(edl);
  assert.match(html, /<div id="s2-flash" class="clip flash" data-start="5"/);
  assert.match(html, /tl\.fromTo\("#s2-frame", \{ scale: 1\.18 \}/);
  assert.match(html, /tl\.fromTo\("#s4-frame", \{ scale: 1\.25, filter: "blur\(14px\)" \}/);
});

test("sub-compositions for titles, end-card and overlays", () => {
  const edl = { ...validEdl(), overlays: ["letterbox", "glitch-rgb"] };
  const { html, subcomps } = composeIndex(edl);
  assert.deepEqual(subcomps.map((s) => [s.id, s.scene]), [
    ["s0", "highlight/chapter-bumper"],
    ["s7", "highlight/quote-card"],
    ["s9", "highlight/end-card"],
    ["ov-letterbox", "overlays/letterbox"],
    ["ov-glitch-rgb", "overlays/glitch-rgb"],
  ]);
  assert.equal(subcomps[2].vars.TEXT, 'Sample & "Quotes"');
  assert.equal(subcomps[2].vars.DUR, 4);
  assert.deepEqual(JSON.parse(subcomps[4].vars.HITS), [2, 5, 8, 11, 14, 17, 20, 23, 26]);
  assert.match(html, /<div id="s0" class="layer" data-composition-id="s0" data-composition-src="compositions\/s0.html" data-start="0" data-duration="2"/);
  assert.match(html, /id="ov-letterbox"[^>]*data-start="0" data-duration="30"/);
});

test("montage panels", () => {
  const edl = validEdl();
  edl.scenes[7] = { type: "montage", panels: [{ in: 70 }, { in: 80 }, { in: 90 }], dur: 3 };
  const { html } = composeIndex(edl);
  assert.match(html, /<div class="montage" id="s7" style="grid-template-columns:repeat\(3,1fr\)">/);
  assert.match(html, /id="s7-v2"[^>]*data-media-start="90"[^>]*data-track-index="22"/);
});

test("speech windows map transcript into trailer time", () => {
  const timed = layout(validEdl().scenes);
  const transcript = [
    { start: 5.5, end: 7.0, text: "a" },   // inside clip s1 (in 5, starts at 2)
    { start: 56, end: 57, text: "muted" }, // inside the muted clip s6
  ];
  assert.deepEqual(speechWindows(timed, transcript), [[2.5, 4]]);
  assert.deepEqual(speechWindows(timed, transcript, false), []);
});

test("music lane ducks under speech and stays increasing", () => {
  const lane = musicLane([[2.5, 4]], 30, 0.8, true);
  const pts = lane.lanes[0].points;
  assert.deepEqual(pts[0], { t: 0, v: 0 });
  assert.ok(pts.some((p) => p.v === 0.24));
  assert.deepEqual(pts.at(-1), { t: 30, v: 0 });
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].t > pts[i - 1].t);
  const flat = musicLane([[2.5, 4]], 30, 0.8, false).lanes[0].points;
  assert.ok(!flat.some((p) => p.v === 0.24));
});

test("music bed element", () => {
  const edl = { ...validEdl(), music: { track: "assets/music/highlight-1.mp3", duck: true } };
  const { html } = composeIndex(edl, { musicSrc: "assets/music.mp3" });
  assert.match(html, /<audio id="music-bed" data-timeline-role="music" src="assets\/music.mp3" data-start="0" data-duration="30"/);
});

test("last scene is stretched to the exact total", () => {
  const edl = validEdl();
  edl.scenes.at(-1).dur = 3.7; // sum 29.7, within tolerance
  const { subcomps, html } = composeIndex(edl);
  assert.equal(subcomps.find((s) => s.id === "s9").vars.DUR, 4);
  assert.match(html, /id="s9"[^>]*data-start="26" data-duration="4"/);
});

test("back-to-back clip audio alternates tracks so cuts never overlap", () => {
  const { html } = composeIndex(validEdl());
  const tracks = [...html.matchAll(/<audio id="s\d+-a"[^>]*data-track-index="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(tracks.slice(0, 4), ["10", "12", "10", "12"]);
});

test("lower-third captions sit above full-length overlays", () => {
  const { html } = composeIndex({ ...validEdl(), overlays: ["letterbox", "grain-lightleak", "glitch-rgb"] });
  const capZ = Number(html.match(/\.lower-third \{[^}]*z-index: (\d+)/)[1]);
  const overlayZ = Math.max(...[...html.matchAll(/id="ov-[^"]+"[^>]*style="z-index:(\d+)"/g)].map((m) => Number(m[1])));
  assert.ok(capZ > overlayZ, `caption z ${capZ} must exceed overlay z ${overlayZ}`);
});
