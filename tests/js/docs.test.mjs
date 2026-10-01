import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateEdl } from "../../skills/yt-trailer/scripts/lib/edl.mjs";
import { ctx, SKILL_DIR } from "./fixtures.mjs";

test("edl-guide example is a valid plan", () => {
  const guide = readFileSync(join(SKILL_DIR, "references", "edl-guide.md"), "utf8");
  const block = guide.split("<!-- example-edl -->")[1].split("```json")[1].split("```")[0];
  const edl = JSON.parse(block);
  const c = ctx({ sourceDuration: 1800 });
  mkdirSync(join(c.workDir, "custom"));
  writeFileSync(join(c.workDir, "custom", "hero.html"), "<template></template>");
  assert.deepEqual(validateEdl(edl, c), []);
});

test("SKILL.md frontmatter", () => {
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: yt-trailer\ndescription: .+\n---\n/);
  assert.ok(skill.includes("hyperframes@0.8.104"));
});
