import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fillScene } from "../../skills/yt-trailer/scripts/lib/scenes.mjs";
import { ROOT, SKILL_DIR } from "./fixtures.mjs";
import { TITLE_SCENES, STYLES, OVERLAYS } from "../../skills/yt-trailer/scripts/lib/edl.mjs";

test("fillScene replaces tokens and escapes text", () => {
  const out = fillScene('<h1 class="__ID__">__TEXT__</h1><p>__SUB__</p><i style="color:__FG__">__DUR__</i>', {
    ID: "s1", TEXT: `Tom's "BIG" <day> & 🎬`, SUB: "", FG: "#ffffff", DUR: 2.5,
  });
  assert.equal(out, '<h1 class="s1">Tom&#39;s &quot;BIG&quot; &lt;day&gt; &amp; 🎬</h1><p></p><i style="color:#ffffff">2.5</i>');
});

test("fillScene leaves window.__timelines alone and rejects unknown tokens", () => {
  assert.equal(fillScene('window.__timelines["__ID__"]', { ID: "x" }), 'window.__timelines["x"]');
  assert.throws(() => fillScene("__NOPE__", {}), /unfilled scene tokens: __NOPE__/);
});

function listScenes(dir = join(SKILL_DIR, "scenes")) {
  let out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(listScenes(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

export function assertSceneContract(source, name) {
  const inner = source.split("<template>")[1]?.split("</template>")[0];
  assert.ok(inner, `${name}: missing <template>`);
  const outside = source.replace(/<template>[\s\S]*<\/template>/, "");
  assert.doesNotMatch(outside, /<style|<script|<link/, `${name}: style/script/link outside <template>`);
  assert.match(inner, /<div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__">/, `${name}: root element`);
  assert.match(inner, /#root\s*\{/, `${name}: root styled by #root`);
  assert.match(inner, /window\.__timelines\["__ID__"\] = tl;/, `${name}: timeline registration`);
  assert.match(inner, /const q = \(sel\) => document\.querySelectorAll\('\[data-composition-id="__ID__"\] ' \+ sel\);/, `${name}: scoped selector helper`);
  assert.match(inner, /const D = __DUR__;/, `${name}: uses __DUR__`);
  assert.doesNotMatch(inner, /Math\.random|Date\.|setTimeout|requestAnimationFrame|fetch\(|<video|<audio/, `${name}: nondeterministic or media API`);
  assert.doesNotMatch(inner, /translate\(-50%/, `${name}: translate(-50%) centering`);
  const tokens = new Set(inner.match(/__[A-Z]+__/g));
  const allowed = new Set(["__ID__", "__W__", "__H__", "__DUR__", "__TEXT__", "__SUB__", "__BG__", "__ACCENT__", "__FG__", "__HITS__"]);
  for (const t of tokens) assert.ok(allowed.has(t), `${name}: unknown token ${t}`);
}

test("every library scene follows the contract", () => {
  for (const file of listScenes()) assertSceneContract(readFileSync(file, "utf8"), relative(SKILL_DIR, file));
});

test("hero fixture follows the contract", () => {
  assertSceneContract(readFileSync(join(ROOT, "tests/fixtures/hero.html"), "utf8"), "fixture/hero");
});

test("every scene the plan can reference exists", () => {
  const needed = [...TITLE_SCENES, ...STYLES.map((s) => `${s}/end-card`), ...OVERLAYS.map((o) => `overlays/${o}`)];
  for (const name of needed) assert.ok(existsSync(join(SKILL_DIR, "scenes", `${name}.html`)), `missing scene ${name}`);
});
