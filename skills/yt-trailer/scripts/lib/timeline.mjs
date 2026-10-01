export const round = (n) => Math.round(n * 1000) / 1000;

export function clipRate(scene) {
  const fx = scene.fx || [];
  if (fx.includes("slowmo")) return 0.5;
  if (fx.includes("speed-ramp")) return 1.5;
  return 1;
}

export function sceneDuration(scene) {
  if (scene.type === "clip") return (scene.out - scene.in) / clipRate(scene);
  return scene.dur;
}

export function layout(scenes) {
  let t = 0;
  return scenes.map((scene) => {
    const dur = sceneDuration(scene);
    const timed = { ...scene, start: round(t), dur: round(dur) };
    t += dur;
    return timed;
  });
}
