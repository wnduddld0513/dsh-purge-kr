// 데스크톱판 호스트 기동(out/main/host.js)에서도 loadDefineTool() 이 @deepseek-ai/dsh-tools 를 찾아야 한다.
// 회귀 배경: 1.7.14 의 후보 경로는 CLI 기동(argv[1] = node_modules/@deepseek-ai/dsh 안의 bin)만 덮었다.
// DSH Desktop 0.2.2 의 Electron 호스트는 ELECTRON_RUN_AS_NODE 로 <app>/out/main/host.js 를 띄우므로,
// considerBin 의 후보가 모두 빗나가고 → 모듈 로드가 오류를 던지고 → 프리셋 행이 redteam-tools never started
// → "레드팀 모드" 전체가 모드 드롭다운에서 걸러졌다(무제한 모드처럼 이 플러그인 행이 없는 프리셋은 영향 없음).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const toolsModule = path.join(repoRoot, "lib", "redteam", "tools.js");


/** DSH Desktop 언팩 레이아웃을 그대로 재현한다: <app>/out/main/host.js + <app>/node_modules/@deepseek-ai/{dsh,dsh-tools}. */
function buildDesktopHostTree(root, withPackages) {
  const app = path.join(root, "app");
  fs.mkdirSync(path.join(app, "out", "main"), { recursive: true });
  fs.writeFileSync(path.join(app, "out", "main", "host.js"), "// fixture desktop host entry\n");
  if (withPackages) {
    const scope = path.join(app, "node_modules", "@deepseek-ai");
    fs.mkdirSync(path.join(scope, "dsh"), { recursive: true });
    fs.writeFileSync(
      path.join(scope, "dsh", "package.json"),
      JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.0.0-fixture" }),
    );
    fs.mkdirSync(path.join(scope, "dsh-tools"), { recursive: true });
    fs.writeFileSync(
      path.join(scope, "dsh-tools", "package.json"),
      JSON.stringify({ name: "@deepseek-ai/dsh-tools", version: "0.0.0-fixture", main: "index.js" }),
    );
    fs.writeFileSync(
      path.join(scope, "dsh-tools", "index.js"),
      "export function defineTool(definition, fn) { return fn }\nexport default { defineTool }\n",
    );
  }
  return path.join(app, "out", "main", "host.js");
}

/** 다른 후보 입력을 고정해서 결과가 argv 로만 결정되게 한다. */
function isolateCandidateInputs(envBackup) {
  envBackup.PURGE_DSH_CLI = process.env.PURGE_DSH_CLI;
  envBackup.DSH_HOME = process.env.DSH_HOME;
  delete process.env.PURGE_DSH_CLI;
  delete process.env.DSH_HOME;
}

function restoreCandidateInputs(envBackup) {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("desktop host entry (out/main/host.js) resolves dsh-tools from the app tree", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-redteam-host-"));
  const envBackup = {};
  const argvBackup = [process.argv[0], process.argv[1], process.argv[2]];
  try {
    isolateCandidateInputs(envBackup);
    const hostEntry = buildDesktopHostTree(root, true);
    process.argv[1] = hostEntry;
    process.argv[2] = undefined;
    const mod = await import(`${pathToFileURL(toolsModule).href}?case=desktop-host`);
    assert.equal(mod.name, "dsh-purge-redteam-tools");
    assert.ok(Array.isArray(mod.inject) && mod.inject.includes("tools"));
  } finally {
    process.argv[1] = argvBackup[1];
    process.argv[2] = argvBackup[2];
    restoreCandidateInputs(envBackup);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("without the app tree the module still fails with the diagnostic error", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-redteam-bare-"));
  const envBackup = {};
  const argvBackup = [process.argv[0], process.argv[1], process.argv[2]];
  try {
    isolateCandidateInputs(envBackup);
    const hostEntry = buildDesktopHostTree(root, false);
    process.argv[1] = hostEntry;
    process.argv[2] = undefined;
    await assert.rejects(
      () => import(`${pathToFileURL(toolsModule).href}?case=bare-host`),
      /cannot resolve @deepseek-ai\/dsh-tools from host/,
    );
  } finally {
    process.argv[1] = argvBackup[1];
    process.argv[2] = argvBackup[2];
    restoreCandidateInputs(envBackup);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a desktop host never imports framework code from ancestors, argv[2], or escaping links", async t => {
  const { execFileSync } = await import("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-desktop-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decoy = buildDesktopHostTree(root, true);
  const ancestor = path.resolve(path.dirname(decoy), "../..");
  const entry = buildDesktopHostTree(path.join(ancestor, "target"), true);
  const app = path.resolve(path.dirname(entry), "../..");
  const local = path.join(app, "node_modules/@deepseek-ai/dsh-tools");
  const external = path.join(ancestor, "node_modules/@deepseek-ai/dsh-tools");
  const sentinel = path.join(root, "external-code-executed");
  fs.writeFileSync(path.join(external, "index.js"), `require("node:fs").writeFileSync(${JSON.stringify(sentinel)},"yes"); exports.defineTool = () => {};`);
  fs.rmSync(local, { recursive: true });
  function denied() {
    const code = `process.argv[1]=${JSON.stringify(entry)};process.argv[2]=${JSON.stringify(ancestor)};await import(${JSON.stringify(pathToFileURL(toolsModule).href)});`;
    assert.throws(() => execFileSync(process.execPath, ["--input-type=module","-e",code], { cwd: ancestor, stdio:"pipe" }), /cannot resolve @deepseek-ai\/dsh-tools from host/);
    assert.equal(fs.existsSync(sentinel), false);
  }
  denied();
  fs.symlinkSync(external, local, process.platform === "win32" ? "junction" : "dir");
  denied();
  fs.unlinkSync(local);
  fs.mkdirSync(local);
  fs.writeFileSync(path.join(local, "package.json"), JSON.stringify({ main: path.join(external,"index.js") }));
  denied();
});
