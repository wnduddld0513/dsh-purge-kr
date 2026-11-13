import fs from "node:fs";
const cur = fs.readFileSync("lib/core.js", "utf8").split(/\r?\n/);
const up = fs.readFileSync("up197_core.js", "utf8").split(/\r?\n/);
const cjk = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFE6\uFF5E\u2018\u2019\u201C\u201D]/;
let strict = 0, strictDiffs = [], cjkOnly = 0;
for (let i = 0; i < cur.length; i++) {
  const a = cur[i], b = up[i] ?? "";
  if (a === b) continue;
  if (!cjk.test(a) && !cjk.test(b)) { strict++; strictDiffs.push({ n: i + 1, a, b }); continue; }
  cjkOnly++;
}
console.log("lines identical:", cur.length - strict - cjkOnly, "/", cur.length);
console.log("CJK-bearing lines that differ (translation):", cjkOnly);
console.log("non-CJK lines that differ (code/token risk):", strict);
for (const d of strictDiffs) { console.log("L" + d.n); console.log("  CUR: " + d.a); console.log("  UPP: " + d.b); }
