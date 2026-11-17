// 1.7.18: 권한 패치와 컨텍스트 관리를 "개별 opt-in"에서 "그룹 스위치 두 개"로 바꿨다.
// 기본값: 권한 패치는 켜짐, 컨텍스트 관리는 꺼짐; 옛 tuning 에 손으로 적은 #18/#19 는 스위치를 참으로 마이그레이션한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ALL_PATCHES,
  patchEnabled,
  patchStatus,
} from "../lib/core.js";
import { TUNING_DEFAULTS, readTuning, writeTuning } from "../lib/tuning.js";
import { removeTreeNoFollowSync } from "../lib/remove-tree.js";

const patch = (id) => ALL_PATCHES.find((p) => p.id === id);

function home() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-gate-"));
  fs.mkdirSync(path.join(root, "dsh-purge"), { recursive: true });
  return { root, close: () => removeTreeNoFollowSync(root) };
}

test("기본값: 권한 패치는 켜짐, 컨텍스트 관리는 꺼짐", () => {
  assert.equal(TUNING_DEFAULTS.permissionPatches, true);
  assert.equal(TUNING_DEFAULTS.contextManagement, false);
  assert.equal(patchEnabled(patch(6), { extraPatches: [] }), true);
  assert.equal(patchEnabled(patch(62), { extraPatches: [] }), true);
  assert.equal(patchEnabled(patch(18), { contextManagement: false }), false);
  assert.equal(patchEnabled(patch(19), { contextManagement: false }), false);
});

test("두 스위치는 각자 독립적으로 동작하고 서로 영향을 주지 않는다", () => {
  const permOff = { permissionPatches: false, contextManagement: false };
  assert.equal(patchEnabled(patch(6), permOff), false);
  assert.equal(patchEnabled(patch(17), permOff), true, "권한 패치가 아닌 것은 영향받지 않는다");
  const permOnCtxOff = { permissionPatches: true, contextManagement: false };
  assert.equal(patchEnabled(patch(9), permOnCtxOff), true);
  assert.equal(patchEnabled(patch(18), permOnCtxOff), false);
  const both = { permissionPatches: true, contextManagement: true };
  assert.equal(patchEnabled(patch(18), both), true);
  assert.equal(patchEnabled(patch(19), both), true);
});

test("옛 규격(배열 목록)의 의미는 그대로라 CLI 와 옛 테스트를 계속 쓸 수 있다", () => {
  assert.equal(patchEnabled(patch(18), []), false);
  assert.equal(patchEnabled(patch(18), [18]), true);
  assert.equal(patchEnabled(patch(6), []), false, "배열 규격에서는 권한 패치도 여전히 미사용으로 본다");
  assert.equal(patchEnabled(patch(6), [6]), true);
});

test("readTuning 은 옛 extraPatches #18/#19 를 contextManagement=true 로 마이그레이션한다", () => {
  const h = home();
  try {
    fs.writeFileSync(
      path.join(h.root, "dsh-purge", "tuning.json"),
      JSON.stringify({ refusalRetry: true, extraPatches: [19] }),
    );
    const tuning = readTuning(h.root);
    assert.equal(tuning.contextManagement, true);
    assert.equal(tuning.permissionPatches, true, "빠진 필드는 기본값인 켜짐으로 본다");
    assert.deepEqual(tuning.extraPatches, [19], "목록 자체는 비우지 않으므로 CLI 가 여전히 읽을 수 있다");
  } finally {
    h.close();
  }
});

test("permissionPatches:false 를 기록한 뒤 다시 읽을 수 있고, 다른 필드를 오염시키지 않는다", () => {
  const h = home();
  try {
    writeTuning({ permissionPatches: false, contextManagement: true }, h.root);
    const tuning = readTuning(h.root);
    assert.equal(tuning.permissionPatches, false);
    assert.equal(tuning.contextManagement, true);
    assert.equal(tuning.boost, true);
    writeTuning({ permissionPatches: true }, h.root);
    const back = readTuning(h.root);
    assert.equal(back.permissionPatches, true);
    assert.equal(back.contextManagement, true, "넘기지 않은 필드는 원래 값을 유지한다");
  } finally {
    h.close();
  }
});

test("patchStatus 는 tuning 으로 판정한다: 권한 패치를 끄면 해당 패치가 실패가 아니라 disabled 로 보고된다", async () => {
  const h = home();
  try {
    const aiBase = path.join(h.root, "ai");
    fs.mkdirSync(aiBase, { recursive: true });
    const off = await patchStatus(aiBase, [patch(6), patch(60)], {
      dshHome: h.root,
      surface: "desktop",
      tuning: { permissionPatches: false, contextManagement: false },
    });
    assert.equal(off[6], "disabled");
    assert.equal(off[60], "disabled");

    const on = await patchStatus(aiBase, [patch(6)], {
      dshHome: h.root,
      surface: "desktop",
      tuning: { permissionPatches: true, contextManagement: false },
    });
    assert.notEqual(on[6], "disabled", "스위치를 켜면 더 이상 disabled 로 분류되지 않는다");
  } finally {
    h.close();
  }
});
