import { test } from "node:test";
import assert from "node:assert/strict";
import { fillScene } from "../../skills/yt-trailer/scripts/lib/scenes.mjs";

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
