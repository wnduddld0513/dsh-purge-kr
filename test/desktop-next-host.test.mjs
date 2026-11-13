// NEXT 호스트 패밀리(서드파티 데스크톱 셸 dsh-desktop-next)의 독립 회귀 테스트.
//
// 네 가지 검수 요구 중 자동화할 수 있는 부분을 다룬다:
//   - 신원: 패키지 증거만 인정한다; 단독 exe / 다른 Electron 앱은 모두 거부한다
//   - 인스턴스 선택: 명시적 선택자가 우선이다; 잘못 가리키면 오류를 내고 다른 설치로 되돌아가지 않는다
//   - 교체: 언팩 우회 / 잔여물 정리 / 커밋과 롤백 / 커밋 실패 시 recover.json 남김
//   - 복구: 패치 쓰기 실패를 성공으로 위장하지 않고, 원문과 백업 모두 롤백 가능하게 유지한다
//
// 실행: node --test test/desktop-next-host.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { desktopIdentity } from "../lib/desktop-identity.js";
import { isDesktopExecutable, repairOfficialCliAfterUnpack } from "../lib/desktop.js";
import { diagnosticHost, resolveInstance } from "../lib/instance.js";
import { cliRepairBlocksApply } from "../lib/apply-gate.js";
import {
  NEXT_FAMILY,
  isNextPackage,
  nextCliRepairVerdict,
  nextIdentity,
  nextAiBaseCandidates,
} from "../lib/next-host.js";
import * as core from "../lib/core.js";
import {
  extractAsarToSide,
  overlayAsarUnpacked,
  commitExtractedDir,
  renameAsarAside,
  newestPreservedDir,
} from "../lib/extract-asar.js";

// realpath 정규화: macOS 의 os.tmpdir() 는 /var/folders/... 를 주지만 구현 계층
// (statSync / readdir 이 돌려주는 경로)은 /private/var/folders/... 이다. 정규화하지 않으면
// "기대 경로 vs 실제 경로" 단언이 mac 에서 거짓 실패하며, 구현과는 무관하다.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-next-")));
const norm = (p) => String(p).split(path.sep).join("/");
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

function write(file, text = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

/** NEXT 설치를 하나 만든다: resources/app/{package.json,lib/main.js} */
function makeNextInstall(root, { name = NEXT_FAMILY.id, main = "lib/main.js", withMain = true, withAiBase = false } = {}) {
  const resources = path.join(root, "resources");
  const app = path.join(resources, "app");
  write(path.join(app, "package.json"), JSON.stringify({ name, version: "2.0.19-next", main }));
  if (withMain) write(path.join(app, main), "// main");
  write(path.join(root, "DSH NEXT.exe"));
  if (withAiBase) {
    for (const pkg of ["dsh-agent-instructions", "dsh-agent-loop", "dsh-system-prompt"]) {
      write(path.join(app, "node_modules", "@deepseek-ai", pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.2.1-rc.2" }));
    }
    write(path.join(app, "node_modules", "@deepseek-ai", "dsh-agent-instructions", "lib", "index.js"), "// host");
  }
  return { root, resources, app, exe: path.join(root, "DSH NEXT.exe") };
}

/** 공식 bundled-host 레이아웃을 만든다: resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host */
function makeOfficialInstall(root) {
  const resources = path.join(root, "resources");
  const host = path.join(resources, "app", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host");
  write(path.join(host, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-desktop-host", version: "0.2.1-rc.2", main: "lib/cli.js" }));
  write(path.join(host, "lib", "cli.js"), "// cli");
  write(path.join(root, "DSH Desktop.exe"));
  return { root, resources, exe: path.join(root, "DSH Desktop.exe") };
}

test("NEXT 패밀리: 패키지 증거가 갖춰져야 인정하고, 이름이 다르거나 진입점이 없으면 거부한다", () => {
  const good = makeNextInstall(path.join(TMP, "good"));
  const wrongName = makeNextInstall(path.join(TMP, "wrong-name"), { name: "some-other-electron-app" });
  const noMain = makeNextInstall(path.join(TMP, "no-main"), { withMain: false });

  assert.equal(desktopIdentity(good.resources).kind, "next");
  assert.equal(desktopIdentity(wrongName.resources), null);
  assert.equal(desktopIdentity(noMain.resources), null);
  assert.equal(isNextPackage({ name: NEXT_FAMILY.id }), true);
  assert.equal(nextIdentity({ name: NEXT_FAMILY.id, version: "2.0.19-next" }).product, "DSH NEXT");
  assert.equal(nextIdentity({ name: "@deepseek-ai/dsh-desktop-host" }), null);
});

test("공식 bundled-host 신원은 NEXT 지원에 영향받지 않는다", () => {
  const official = makeOfficialInstall(path.join(TMP, "official"));
  const found = desktopIdentity(official.resources);
  assert.equal(found.kind, "bundled-host");
  assert.equal(found.package, "@deepseek-ai/dsh-desktop-host");
});

test("isDesktopExecutable: 패키지 증거만 인정하고 단독 exe / 다른 앱은 거부한다", () => {
  const next = makeNextInstall(path.join(TMP, "exe-next"));
  const bare = path.join(TMP, "exe-bare");
  write(path.join(bare, "DSH NEXT.exe"));
  fs.mkdirSync(path.join(bare, "resources"), { recursive: true });
  const other = makeNextInstall(path.join(TMP, "exe-other"), { name: "some-other-electron-app" });

  assert.equal(isDesktopExecutable(next.exe), true);
  assert.equal(isDesktopExecutable(path.join(bare, "DSH NEXT.exe")), false);
  assert.equal(isDesktopExecutable(other.exe), false);
});

test("resolveInstance: 명시적 선택자가 우선이고, 잘못 가리키면 오류를 내며 되돌아가지 않는다", () => {
  const next = makeNextInstall(path.join(TMP, "resolve"), { withAiBase: true });
  const aiBase = path.join(next.app, "node_modules", "@deepseek-ai");

  const byEnv = resolveInstance({ env: { DSH_BASE: aiBase }, resourcesPath: next.resources, electron: "44.7.0", argv: [] });
  assert.equal(byEnv.resolved, true);
  assert.equal(byEnv.source, "DSH_BASE");
  assert.equal(norm(byEnv.host), norm(aiBase));

  const decoy = makeNextInstall(path.join(TMP, "resolve-decoy"));
  const bad = resolveInstance({ env: { DSH_BASE: decoy.root }, resourcesPath: next.resources, electron: "44.7.0", argv: [] });
  assert.equal(bad.resolved, false);
  assert.equal(norm(bad.host), norm(decoy.root));
  assert.equal(bad.source, "DSH_BASE");
  assert.notEqual(norm(bad.host), norm(aiBase));
  assert.match(bad.reason, /유효한 플러그인 루트가 아닙/);

  assert.throws(
    () => resolveInstance({ env: { PURGE_DSH_CLI: path.join(TMP, "nope", "dsh") }, argv: [] }),
    /PURGE_DSH_CLI/,
  );

  const byEntry = resolveInstance({ env: {}, resourcesPath: next.resources, electron: "44.7.0", argv: [] });
  assert.equal(byEntry.source, "process-entry");
  assert.equal(norm(byEntry.host), norm(aiBase));
  assert.equal(byEntry.family, "next");
});

test("diagnosticHost: app.asar.unpacked 일부만 있을 때 기대 경로를 반환하고, 반쯤 만들어진 것을 호스트로 취급하지 않는다", () => {
  const next = makeNextInstall(path.join(TMP, "partial"));
  fs.mkdirSync(path.join(next.resources, "app.asar.unpacked", "node_modules", "@deepseek-ai", "dsh-agent-preset"), { recursive: true });
  const host = diagnosticHost({ resourcesPath: next.resources, electron: "44.7.0", env: {}, argv: [] });
  assert.equal(norm(host), norm(path.join(next.app, "node_modules", "@deepseek-ai")));
});

test("CLI 수리: NEXT 는 notApplicable 이고, 공식 설치의 실패는 여전히 실패다", () => {
  const next = makeNextInstall(path.join(TMP, "cli"));
  const verdict = repairOfficialCliAfterUnpack(next.exe);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.notApplicable, true);
  assert.equal(verdict.status, "not_applicable");

  const bareExe = path.join(TMP, "cli-bare", "DSH Desktop.exe");
  write(bareExe);
  const official = repairOfficialCliAfterUnpack(bareExe);
  assert.equal(official.ok, false);
  assert.notEqual(official.notApplicable, true);

  assert.equal(nextCliRepairVerdict({ shimExists: true }).status, "unsupported_family");
  assert.deepEqual(nextAiBaseCandidates(next.resources).length, 2);
});

test("교체 게이트: notApplicable / 실제 수리 완료 / 미봉인 상태만 통과시킨다", () => {
  const nextVerdict = { ok: false, notApplicable: true };
  assert.equal(cliRepairBlocksApply({ handoff: {}, sealed: true, cliRepair: nextVerdict }), false);
  assert.equal(cliRepairBlocksApply({ handoff: {}, sealed: true, cliRepair: { ok: true } }), false);
  assert.equal(cliRepairBlocksApply({ handoff: {}, sealed: true, cliRepair: { ok: false, reason: "not_official" } }), true);
  assert.equal(cliRepairBlocksApply({ handoff: {}, sealed: true, cliRepair: null }), true);
  assert.equal(cliRepairBlocksApply({ handoff: {}, sealed: false, cliRepair: null }), false);
});

/* ---------------- 교체 / 복구 ---------------- */
function buildAsar(target, entries, unpacked = {}) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const files = {};
  const blobs = [];
  let offset = 0;
  const insert = (rel, info) => {
    const parts = rel.split("/");
    let node = { files };
    for (let i = 0; i < parts.length - 1; i++) {
      node.files[parts[i]] ??= { files: {} };
      node = node.files[parts[i]];
    }
    node.files[parts.at(-1)] = info;
  };
  for (const [rel, text] of Object.entries(entries)) {
    const buf = Buffer.from(text, "utf8");
    insert(rel, { size: buf.length, offset });
    blobs.push(buf);
    offset += buf.length;
  }
  for (const [rel, buf] of Object.entries(unpacked)) insert(rel, { size: buf.length, unpacked: true });
  const json = Buffer.from(JSON.stringify({ files }), "utf8");
  const headerSize = json.length + 10;
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(4, 0);
  pre.writeUInt32LE(headerSize, 4);
  pre.writeUInt32LE(json.length + 6, 8);
  pre.writeUInt32LE(json.length, 12);
  fs.writeFileSync(target, Buffer.concat([pre, json, Buffer.alloc(8 + headerSize - 16 - json.length), ...blobs]));
  for (const [rel, buf] of Object.entries(unpacked)) write(path.join(target + ".unpacked", rel), buf);
}

test("교체: 언팩 우회 / 잔여물 정리 / overlay / 커밋 시 옛 디렉터리 보존", () => {
  const root = path.join(TMP, "swap");
  const asar = path.join(root, "app.asar");
  buildAsar(
    asar,
    { "package.json": JSON.stringify({ name: NEXT_FAMILY.id, main: "lib/main.js" }), "lib/main.js": "// m" },
    { "native/thing.node": Buffer.from("NATIVE") },
  );
  const dest = path.join(root, "resources", "app");
  write(path.join(dest, "package.json"), JSON.stringify({ version: "OLD" }));

  const side = extractAsarToSide(asar, dest);
  assert.ok(fs.existsSync(path.join(side.next, "lib/main.js")));
  assert.equal(fs.existsSync(path.join(side.next, "native/thing.node")), false);
  overlayAsarUnpacked(asar, side.next);
  assert.equal(fs.readFileSync(path.join(side.next, "native/thing.node"), "utf8"), "NATIVE");

  write(path.join(side.next, "stale.txt"), "junk");
  const side2 = extractAsarToSide(asar, dest);
  assert.equal(fs.existsSync(path.join(side2.next, "stale.txt")), false);

  const committed = commitExtractedDir(dest, side2.next);
  assert.ok(fs.existsSync(path.join(dest, "lib/main.js")));
  assert.match(fs.readFileSync(path.join(committed.prev, "package.json"), "utf8"), /OLD/);
});

test("교체: 커밋 실패 시 recover.json 을 남기고 옛 디렉터리를 잃지 않으며 새 디렉터리로 재시도할 수 있다", (t) => {
  const otherVolume = ["D:/", "E:/"].find((d) => fs.existsSync(d));
  if (!otherVolume) return t.skip("EXDEV 를 만들려면 두 번째 볼륨이 필요하다");
  const root = path.join(TMP, "commit-fail");
  const dest = path.join(root, "resources", "app");
  write(path.join(dest, "keep.txt"), "original");
  const nextDir = fs.mkdtempSync(path.join(otherVolume, "dsh-purge-next-"));
  write(path.join(nextDir, "package.json"), "{}");

  assert.throws(() => commitExtractedDir(dest, nextDir), /commitExtractedDir failed/);
  const recover = dest + ".dshpurge-recover.json";
  assert.ok(fs.existsSync(recover));
  const record = JSON.parse(fs.readFileSync(recover, "utf8"));
  assert.ok(record.error);
  assert.equal(fs.readFileSync(path.join(dest, "keep.txt"), "utf8"), "original");
  assert.ok(fs.existsSync(path.join(nextDir, "package.json")));
  rm(nextDir);
});

test("교체: 중단 후에도 .dshpurge-prev 에서 복원할 수 있다", () => {
  const app = path.join(TMP, "restore", "app");
  const prev = app + ".dshpurge-prev";
  write(path.join(prev, "package.json"), JSON.stringify({ version: "PREV" }));
  assert.equal(norm(newestPreservedDir(app)), norm(prev));
  core.restoreSealedExtract(app, prev);
  assert.match(fs.readFileSync(path.join(app, "package.json"), "utf8"), /PREV/);
});

test("교체: 아카이브 이름을 바꿔 app.asar.bak 을 보존한다", () => {
  const asar = path.join(TMP, "rename", "app.asar");
  write(asar, "ARCHIVE");
  const moved = renameAsarAside(asar);
  assert.equal(moved.renamed, true);
  assert.equal(fs.existsSync(asar), false);
  assert.equal(fs.readFileSync(moved.bak, "utf8"), "ARCHIVE");
});

/* ---------------- 패치 실패 복구 ---------------- */
test("패치: 쓰기 실패는 명시적으로 오류를 내고, 원문과 백업 모두 롤백할 수 있으며, 복구 후 재시도할 수 있다", async () => {
  const home = path.join(TMP, "home");
  write(path.join(home, "profiles", "desktop", "package.json"), JSON.stringify({ name: "dsh-profile-desktop" }));
  const savedHome = process.env.DSH_HOME;
  const savedBase = process.env.DSH_BASE;
  process.env.DSH_HOME = home;

  const aiBase = path.join(TMP, "patch-host", "node_modules", "@deepseek-ai");
  for (const pkg of ["dsh-agent-instructions", "dsh-agent-loop", "dsh-system-prompt"]) {
    write(path.join(aiBase, pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.2.1-rc.2" }));
  }
  const patch1 = core.ALL_PATCHES.find((p) => p.id === 1);
  const target = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
  const original = patch1.replacements[0].pattern + ";";
  write(target, original);
  process.env.DSH_BASE = aiBase;
  try {
    const applied = await core.applyPatchesAllHosts([patch1], {});
    assert.equal(applied.report[0].status, "applied");
    assert.ok(fs.existsSync(target + ".dshpurge.bak"));
    assert.equal(fs.readFileSync(target + ".dshpurge.bak", "utf8"), original);
    assert.notEqual(fs.readFileSync(target, "utf8"), original);

    const reverted = await core.revertAll(aiBase);
    assert.equal((reverted.errors || []).length, 0);
    assert.equal(fs.readFileSync(target, "utf8"), original);

    // 주입 쓰기 실패를 만든다: 대상 파일을 같은 이름의 디렉터리로 바꾼다.
    // chmod(0o444) 는 쓰지 않는다 — POSIX 에서 rename 은 디렉터리 권한만 보므로 파일 비트로는 교체를 막을 수 없고,
    // 그러면 주입이 실제로는 applied 를 반환해 픽스처가 무효가 되지, 단언이 느슨해서가 아니다.
    // revertAll 로 롤백하면 백업이 지워지므로, 먼저 한 번 다시 적용해 롤백 가능한 원문을 만들어 둔다.
    await core.applyPatchesAllHosts([patch1], {});
    assert.ok(fs.existsSync(target + ".dshpurge.bak"), "실패를 주입하기 전에 롤백 가능한 백업이 이미 있어야 한다");
    fs.rmSync(target);
    fs.mkdirSync(target);
    let failed = null;
    try {
      const run = await core.applyPatchesAllHosts([patch1], {});
      failed = run.report[0];
    } catch (error) {
      failed = { status: "throw:" + (error.code || error.message) };
    }
    assert.notEqual(failed.status, "applied");
    assert.equal(fs.statSync(target).isDirectory(), true, "쓰기 실패는 대상의 현재 상태를 바꾸지 않아야 한다");
    assert.equal(fs.readFileSync(target + ".dshpurge.bak", "utf8"), original, "백업은 롤백 가능한 원문이어야 한다");

    // 미적용 상태로 되돌린 뒤 재시도하면 실제로 써져야 한다(already 가 아니라)
    fs.rmdirSync(target);
    fs.writeFileSync(target, original);
    const retried = await core.applyPatchesAllHosts([patch1], {});
    assert.equal(retried.report[0].status, "applied");
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
    if (savedBase === undefined) delete process.env.DSH_BASE; else process.env.DSH_BASE = savedBase;
  }
});

test("유효한 DSH_BASE 에는 디렉터리를 다시 설정하라는 제안을 하지 않는다", () => {
  const base = path.join(TMP, "validated-base", "@deepseek-ai");
  fs.mkdirSync(path.join(base, "dsh-agent-instructions", "lib"), { recursive: true });
  const before = { DSH_BASE: process.env.DSH_BASE, DSH_SURFACE: process.env.DSH_SURFACE };
  try {
    process.env.DSH_BASE = base;
    process.env.DSH_SURFACE = "web";
    const message = core.missingAiBaseMessage();
    assert.match(message, /검증을 통과/);
    assert.match(message, /web/);
    assert.doesNotMatch(message, /set DSH_BASE/);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
