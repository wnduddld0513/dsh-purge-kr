import { ALL_PATCHES } from "./lib/patches/index.mjs";
let bad = [];
let checked = 0;
for (const p of ALL_PATCHES) {
  const reps = (p.replacements || []).map((r) => String(r.replace ?? ""));
  const markers = Array.isArray(p.markers) ? p.markers : (p.markers ? [p.markers] : []);
  for (const m of markers) {
    checked++;
    if (!reps.some((r) => r.includes(m))) bad.push({ id: p.id, name: p.name, marker: m });
  }
}
console.log("patches:", ALL_PATCHES.length, "markers checked:", checked, "bad:", bad.length);
for (const b of bad) console.log("BAD", JSON.stringify(b));
