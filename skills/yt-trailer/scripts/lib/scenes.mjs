import { esc } from "./html.mjs";

const TOKEN = /__([A-Z]+)__/g;
const ESCAPED = new Set(["TEXT", "SUB"]);

export function fillScene(template, vars) {
  const out = template.replace(TOKEN, (match, key) => {
    if (!(key in vars)) return match;
    return ESCAPED.has(key) ? esc(vars[key]) : String(vars[key]);
  });
  const left = out.match(TOKEN);
  if (left) throw new Error(`unfilled scene tokens: ${[...new Set(left)].join(", ")}`);
  return out;
}
