import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBeats, snapToBeats } from "../../skills/yt-trailer/scripts/lib/beats.mjs";

test("parseBeats accepts common shapes", () => {
  assert.deepEqual(parseBeats([2, 1, 1]), [1, 2]);
  assert.deepEqual(parseBeats({ bpm: 120, beats: [0.5, 1.0] }), [0.5, 1]);
  assert.deepEqual(parseBeats({ beats: [{ time: 1.5 }, { t: 0.5 }] }), [0.5, 1.5]);
  assert.deepEqual(parseBeats({ tempo: 90 }), []);
});

const edl = () => ({
  duration: 45,
  scenes: [
    { type: "title", dur: 2.05 },
    { type: "clip", in: 10, out: 12.9 },
    { type: "clip", in: 20, out: 21, fx: ["slowmo"] },
    { type: "end-card", dur: 38.05 },
  ],
});

test("snapToBeats moves cuts within tolerance and keeps total", () => {
  const out = snapToBeats(edl(), [2.0, 5.0, 7.1], 100);
  assert.equal(out.scenes[0].dur, 2.0);
  assert.equal(out.scenes[1].out, 13.0);
  assert.equal(out.scenes[2].out, 21.05); // slowmo: 0.1 s of timeline = 0.05 s of source
  const total = out.scenes[0].dur + (out.scenes[1].out - 10) + (out.scenes[2].out - 20) / 0.5 + out.scenes[3].dur;
  assert.ok(Math.abs(total - 45) < 0.001);
});

test("snapToBeats ignores far beats and empty input", () => {
  const original = edl();
  assert.deepEqual(snapToBeats(original, [], 100), original);
  const out = snapToBeats(original, [3.0], 100);
  assert.equal(out.scenes[0].dur, 2.05);
});

test("snapToBeats never extends a clip past the source", () => {
  const out = snapToBeats(edl(), [5.04], 12.95);
  assert.equal(out.scenes[1].out, 12.9);
});
