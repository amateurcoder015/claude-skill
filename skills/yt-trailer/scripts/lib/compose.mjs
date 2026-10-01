import { esc } from "./html.mjs";
import { layout, clipRate, round } from "./timeline.mjs";

export const DIMS = { "16:9": [1920, 1080], "9:16": [1080, 1920] };
const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap";

export function speechWindows(timed, transcript, hasAudio = true) {
  if (!hasAudio) return [];
  const windows = [];
  for (const s of timed) {
    if (s.type !== "clip" || s.audio === "mute") continue;
    const rate = clipRate(s);
    for (const line of transcript) {
      const a = Math.max(line.start, s.in);
      const b = Math.min(line.end, s.out);
      if (b <= a) continue;
      windows.push([round(s.start + (a - s.in) / rate), round(s.start + (b - s.in) / rate)]);
    }
  }
  windows.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const w of windows) {
    const last = merged.at(-1);
    if (last && w[0] <= last[1] + 0.3) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged;
}

export function musicLane(windows, total, volume, duck) {
  const low = round(volume * 0.3);
  const fade = 0.15;
  const pts = [{ t: 0, v: 0 }, { t: 0.5, v: volume }];
  if (duck) {
    for (const [a, b] of windows) {
      const s = Math.max(0.5, a - fade);
      const e = Math.min(total - 1.5, b + fade);
      if (e - s < 2 * fade) continue;
      pts.push({ t: round(s), v: volume }, { t: round(s + fade), v: low }, { t: round(e - fade), v: low }, { t: round(e), v: volume });
    }
  }
  pts.push({ t: round(total - 1.5), v: volume }, { t: round(total), v: 0 });
  const out = [];
  for (const p of pts) if (!out.length || p.t > out.at(-1).t) out.push(p);
  return { version: 1, lanes: [{ target: "volume", points: out }] };
}

function hostDiv(id, start, dur, W, H, track) {
  return `<div id="${id}" class="layer" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${start}" data-duration="${dur}" data-track-index="${track}" data-width="${W}" data-height="${H}" style="z-index:${track}"></div>`;
}

function clipParts(s, id, hasAudio) {
  const fx = s.fx || [];
  const timing = `data-start="${s.start}" data-duration="${s.dur}" data-media-start="${s.in}"`;
  let speed = "";
  if (fx.includes("speed-ramp")) {
    const lane = { version: 1, lanes: [{ target: "rate", points: [{ t: 0, v: 1 }, { t: s.dur, v: 2 }] }] };
    speed = ` data-automation='${JSON.stringify(lane)}'`;
  } else if (clipRate(s) !== 1) {
    speed = ` data-playback-rate="${clipRate(s)}"`;
  }
  const pos = s.cropX != null ? ` style="object-position:${round(s.cropX * 100)}% 50%"` : "";
  const html = [
    `<div class="frame" id="${id}-frame"><video id="${id}-v" class="clip" src="assets/video.mp4" ${timing} data-track-index="0"${speed}${pos} muted playsinline></video></div>`,
  ];
  if (hasAudio && s.audio !== "mute") {
    html.push(`<audio id="${id}-a" src="assets/video.mp4" ${timing} data-track-index="10" data-volume="1"${speed}></audio>`);
  }
  const frame = `#${id}-frame`;
  const js = [];
  if (fx.includes("flash-punch")) {
    html.push(`<div id="${id}-flash" class="clip flash" data-start="${s.start}" data-duration="0.3" data-track-index="4"></div>`);
    js.push(`tl.fromTo("#${id}-flash", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power2.out" }, ${s.start});`);
    js.push(`tl.fromTo("${frame}", { scale: 1.18 }, { scale: 1, duration: 0.35, ease: "expo.out" }, ${s.start});`);
  } else if (fx.includes("zoom-in")) {
    js.push(`tl.fromTo("${frame}", { scale: 1.25, filter: "blur(14px)" }, { scale: 1.02, filter: "blur(0px)", duration: ${round(Math.min(0.6, s.dur))}, ease: "power3.out" }, ${s.start});`);
  } else if (fx.includes("push-in")) {
    js.push(`tl.fromTo("${frame}", { scale: 1 }, { scale: 1.15, duration: ${s.dur}, ease: "power1.inOut" }, ${s.start});`);
  } else {
    js.push(`tl.fromTo("${frame}", { scale: 1 }, { scale: 1.04, duration: ${s.dur}, ease: "none" }, ${s.start});`);
  }
  if (s.caption) {
    html.push(`<div id="${id}-cap" class="clip lower-third" data-start="${s.start}" data-duration="${s.dur}" data-track-index="3"><span class="lt-bar"></span><span class="lt-text">${esc(s.caption)}</span></div>`);
    js.push(`tl.fromTo("#${id}-cap .lt-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "power3.out" }, ${round(s.start + 0.1)});`);
    js.push(`tl.fromTo("#${id}-cap .lt-text", { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, ${round(s.start + 0.2)});`);
  }
  return { html, js };
}

function montageParts(s, id, vertical) {
  const n = s.panels.length;
  const grid = vertical ? `grid-template-rows:repeat(${n},1fr)` : `grid-template-columns:repeat(${n},1fr)`;
  const axis = vertical ? "xPercent" : "yPercent";
  const panels = s.panels
    .map((p, j) => `<div class="panel" id="${id}-p${j}"><video id="${id}-v${j}" class="clip" src="assets/video.mp4" data-start="${s.start}" data-duration="${s.dur}" data-media-start="${p.in}" data-track-index="${20 + j}" muted playsinline></video></div>`)
    .join("");
  const js = s.panels.map(
    (_, j) => `tl.fromTo("#${id}-p${j}", { ${axis}: ${j % 2 ? 110 : -110}, opacity: 0 }, { ${axis}: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, ${round(s.start + j * 0.12)});`,
  );
  return { html: [`<div class="montage" id="${id}" style="${grid}">${panels}</div>`], js };
}

export function composeIndex(edl, { transcript = [], musicSrc = null, hasAudio = true } = {}) {
  const [W, H] = DIMS[edl.format];
  const total = edl.duration;
  const timed = layout(edl.scenes);
  const last = timed.at(-1);
  last.dur = round(total - last.start);
  const body = [];
  const js = [];
  const subcomps = [];
  timed.forEach((s, i) => {
    const id = `s${i}`;
    if (s.type === "clip" || s.type === "montage") {
      const parts = s.type === "clip" ? clipParts(s, id, hasAudio) : montageParts(s, id, edl.format === "9:16");
      body.push(...parts.html);
      js.push(...parts.js);
      return;
    }
    const scene = s.type === "title" ? s.scene : s.type === "end-card" ? `${edl.style}/end-card` : "hero";
    subcomps.push({ id, scene, vars: { TEXT: s.text ?? s.title ?? "", SUB: s.sub ?? "", DUR: s.dur } });
    body.push(hostDiv(id, s.start, s.dur, W, H, 2));
  });
  const cuts = timed.slice(1).map((s) => s.start);
  (edl.overlays || []).forEach((name, k) => {
    const id = `ov-${name}`;
    subcomps.push({ id, scene: `overlays/${name}`, vars: { TEXT: "", SUB: "", DUR: total, HITS: JSON.stringify(cuts) } });
    body.push(hostDiv(id, 0, total, W, H, 5 + k));
  });
  if (edl.music && musicSrc) {
    const lane = musicLane(speechWindows(timed, transcript, hasAudio), total, edl.music.volume ?? 0.8, edl.music.duck !== false);
    body.push(`<audio id="music-bed" data-timeline-role="music" src="${musicSrc}" data-start="0" data-duration="${total}" data-track-index="11" data-volume="1" data-automation='${JSON.stringify(lane)}'></audio>`);
  }
  const { bg, accent, fg } = edl.palette;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="${GSAP}"></script>
    <link rel="stylesheet" href="${FONTS}" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${bg}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${bg}; font-family: Inter, system-ui, sans-serif; }
      .frame { position: absolute; inset: 0; overflow: hidden; z-index: 1; }
      .frame video, .panel video { display: block; width: 100%; height: 100%; object-fit: cover; }
      .montage { position: absolute; inset: 0; display: grid; gap: 12px; padding: 12px; z-index: 1; }
      .panel { position: relative; overflow: hidden; border-radius: 8px; }
      .layer { position: absolute; inset: 0; }
      .flash { position: absolute; inset: 0; background: #fff; z-index: 4; }
      .lower-third { position: absolute; left: 6%; bottom: 9%; max-width: 80%; display: flex; align-items: stretch; gap: 18px; z-index: 3; }
      .lt-bar { width: 10px; background: ${accent}; transform-origin: 50% 100%; }
      .lt-text { font: 600 44px/1.25 Inter, system-ui, sans-serif; color: ${fg}; background: rgba(0, 0, 0, 0.5); padding: 12px 22px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">
      ${body.join("\n      ")}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${js.join("\n      ")}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  return { html, subcomps };
}
