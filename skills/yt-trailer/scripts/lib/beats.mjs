import { clipRate, sceneDuration, round } from "./timeline.mjs";

export function parseBeats(data) {
  const out = [];
  const visit = (value, key) => {
    if (typeof value === "number" && ["beats", "t", "time"].includes(key)) out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => visit(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  visit(data, "beats");
  return [...new Set(out.filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b);
}

export function snapToBeats(edl, beats, sourceDuration, tol = 0.15) {
  if (!beats.length) return edl;
  const scenes = edl.scenes.map((s) => ({ ...s }));
  let t = 0;
  for (let i = 0; i < scenes.length - 1; i++) {
    const s = scenes[i];
    const end = t + sceneDuration(s);
    const nearest = beats.reduce((best, b) => (Math.abs(b - end) < Math.abs(best - end) ? b : best), beats[0]);
    const delta = nearest - end;
    if (Math.abs(delta) <= tol && Math.abs(delta) > 0.001) {
      if (s.type === "clip") {
        const out = round(s.out + delta * clipRate(s));
        if (out <= sourceDuration && out - s.in >= 0.3) s.out = out;
      } else if (s.dur + delta >= 1) {
        s.dur = round(s.dur + delta);
      }
    }
    t += sceneDuration(s);
  }
  scenes.at(-1).dur = round(edl.duration - t);
  return { ...edl, scenes };
}
