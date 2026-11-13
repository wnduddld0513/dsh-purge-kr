// refreshStaleBaksForUpgrade 의 업그레이드 판정: "[dsh-purge]" marker 만 보면
// "패치되었지만 marker 는 없는" 파일을 공식 신버전으로 오판해 .dshpurge.bak 을 패치 후 내용으로 덮어쓴다.
// 그러면 롤백이 no-op 이 되는데 상태 페이지는 계속 초록이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshStaleBaksForUpgrade, patchedTargetStillPatched } from "../lib/core.js";

// #94 SKILL_BADGE_DESCRIPTION_NEUTRAL 의 실제 앵커와 산출물:
const VENDOR = 'Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness.';
const PATCHED = 'Add a small attribution badge to documents, pull requests, merge requests, and other content.';

/** dsh-skill-badge 대상을 가진 호스트 트리를 하나 만든다. */
function fixture(pkg = "dsh-skill-badge") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-refresh-"));
  const file = path.join(root, pkg, "lib", "index.js");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, VENDOR);
  fs.writeFileSync(file + ".dshpurge.bak", VENDOR);
  return { root, file, bak: file + ".dshpurge.bak" };
}

test("파일이 아직 패치 형태면 bak 을 보존한다(공식 신버전으로 덮어쓰지 않는다)", () => {
  const { root, file, bak } = fixture();
  // 현재 상태: 파일에는 패치 산출물이 있고(marker 없음), bak 은 공식 원본 — 이것이 "이미 패치됨"의 정상 형태다.
  fs.writeFileSync(file, PATCHED);
  const before = fs.readFileSync(bak);
  const refreshed = refreshStaleBaksForUpgrade(root);
  assert.equal(refreshed.length, 0, "새로고침하면 안 된다");
  assert.deepEqual(fs.readFileSync(bak), before, "bak 은 공식 원문을 보존해야 한다");
  fs.rmSync(root, { recursive: true, force: true });
});

test("호스트가 공식 신버전으로 올라가면 bak 을 새 기준선으로 새로고침한다", () => {
  const { root, file, bak } = fixture();
  // 현재 상태: 파일은 공식 원본(앵커가 돌아옴)이고 bak 은 옛 기준선 — 이때가 bak 을 새로고침할 상황이다.
  fs.writeFileSync(bak, "old baseline");
  fs.writeFileSync(file, VENDOR);
  const refreshed = refreshStaleBaksForUpgrade(root);
  assert.equal(refreshed.length, 1, "새로고침해야 한다");
  assert.equal(fs.readFileSync(bak, "utf8"), VENDOR);
  fs.rmSync(root, { recursive: true, force: true });
});

test("[dsh-purge] marker 가 있는 파일은 bak 을 건드리지 않는다", () => {
  const { root, file, bak } = fixture();
  fs.writeFileSync(file, "patched // [dsh-purge] some marker");
  fs.writeFileSync(bak, VENDOR);
  const before = fs.readFileSync(bak);
  assert.equal(refreshStaleBaksForUpgrade(root).length, 0);
  assert.deepEqual(fs.readFileSync(bak), before);
  fs.rmSync(root, { recursive: true, force: true });
});

test("소속을 알 수 없는 파일은 보수적으로 처리한다: bak 을 덮어쓰지 않는다", () => {
  // 대상이 패치 표에 없다(신버전이 추가한 파일). 우리가 고친 것인지 판단할 수 없다.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-refresh-"));
  const file = path.join(root, "dsh-unknown-pkg", "lib", "index.js");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".dshpurge.bak", "vendor");
  fs.writeFileSync(file, "something else");
  assert.equal(refreshStaleBaksForUpgrade(root).length, 0, "보수적으로 새로고침하지 않는다");
  assert.equal(fs.readFileSync(file + ".dshpurge.bak", "utf8"), "vendor");
  fs.rmSync(root, { recursive: true, force: true });
});

test("patchedTargetStillPatched: 공식 원본은 미패치로 판정한다", () => {
  const { root, file } = fixture();
  assert.equal(patchedTargetStillPatched(file, Buffer.from(VENDOR), root), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("patchedTargetStillPatched: 패치 형태는 패치됨으로 판정한다", () => {
  const { root, file } = fixture();
  assert.equal(patchedTargetStillPatched(file, Buffer.from(PATCHED), root), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("patchedTargetStillPatched: 빈 내용은 변경된 것으로 본다(bak 보호)", () => {
  assert.equal(patchedTargetStillPatched("/nonexistent/file.js", Buffer.alloc(0)), true);
});

test("mixed vendor and replacement text cannot replace a clean rollback copy", (t) => {
  const { root, file, bak } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseline = [VENDOR, VENDOR].join("\n");
  fs.writeFileSync(bak, baseline);
  fs.writeFileSync(file, [VENDOR, PATCHED].join("\n"));
  assert.deepEqual(refreshStaleBaksForUpgrade(root), []);
  assert.equal(fs.readFileSync(bak, "utf8"), baseline);
});
