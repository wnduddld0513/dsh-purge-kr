// Plugin-owned tuning state. Deliberately NOT stored in the profile cordis config:
// switching a behaviour must never require editing a DSH file or a restart of the
// profile's YAML, and must survive `dsh plugin add`.
import fs from "node:fs";
import path from "node:path";
import { findDshHome } from "./core.js";
import { atomicFiles } from "./atomic-files.js";
import { acquireMaintenanceLock } from "./maintenance-lock.js";
import { logAudit } from "./audit.js";

export const TUNING_FILE = "tuning.json";

/** 기본값이 곧 "전부 켜짐"이다: 탈옥이 이 플러그인의 유일한 목적이므로 기본값에 게이트를 남기지 않는다. */
export const TUNING_DEFAULTS = Object.freeze({
  boost: true, // 꼬리 강화 섹션
  injectPosition: "head", // head | tail | both —— 시스템 프롬프트에서 주입되는 위치
  askNoBlock: true, // 호환 필드: 지금은 -1(무한 대기)만 300s 로 줄인다. 패치 #89 참고
  rewind: false, // 명시적으로 켤 때만 세션 입력창의 되돌리기 버튼을 표시한다
  refusalRetry: false, // 모델이 회피할 때 강화 문구를 한 번 덧붙여 재시도한다(llm/stream 훅)
  refusalDecompose: true, // 세 번째 재시도까지 거부하면 네 번째에는 최소 납품 가능한 구성 요소만 요청한다
  refusalSeed: true, // 두 번째 재시도까지 거부하면 세 번째에는 assistant 프리필(seed-prim)로 바꾼다
  permissionPatches: true, // 14 개 권한/승인 경계 패치(#6…#62) 전체 스위치, 기본 켜짐
  contextManagement: false, // #18 중복 호출 알림, #19 도구 결과 트리밍 전체 스위치, 기본 꺼짐
  extraPatches: [], // 개별 "기본 꺼짐" 패치의 명시 목록(새 사용자에게는 이제 필요 없고, 옛 설정과 CLI 를 위해 남긴다)
});

function tuningPath(dshHome) {
  const home = dshHome || findDshHome();
  if (!home) return "";
  return path.join(home, "dsh-purge", TUNING_FILE);
}

function tuningError(file, reason) {
  return Object.assign(new Error(`${file} 파일을 읽을 수 없습니다(${reason}). 파일을 확인하거나 백업에서 복구하십시오.`), { code: "TUNING_UNREADABLE" });
}

export function readTuning(dshHome) {
  const file = tuningPath(dshHome);
  if (!file) return { ...TUNING_DEFAULTS, extraPatches: [] };
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && !fs.lstatSync(file, { throwIfNoEntry: false })) return { ...TUNING_DEFAULTS, extraPatches: [] };
    throw tuningError(file, error.code);
  }
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw tuningError(file, "JSON 형식 오류");
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw tuningError(file, "JSON 객체가 필요합니다");
  const merged = { ...TUNING_DEFAULTS, ...saved };
  if (!["head", "tail", "both"].includes(merged.injectPosition)) {
    merged.injectPosition = TUNING_DEFAULTS.injectPosition;
  }
  merged.extraPatches = Array.isArray(merged.extraPatches)
    ? [...new Set(merged.extraPatches.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
    : [];
  // 권한 패치를 끄려면 명시적 false 로 써야 한다. 그 밖의 값은 모두 기본 켜짐으로 처리한다.
  merged.permissionPatches = merged.permissionPatches !== false;
  // 마이그레이션: 1.7.18 이전에는 "컨텍스트 관리 켜기"를 extraPatches 에 #18/#19 를 직접 나열해서만 할 수 있었다.
  // 이런 옛 설정을 읽으면 스위치를 참으로 접어 준다. 의미는 같고, 사용자가 다시 설정할 필요가 없다.
  merged.contextManagement = merged.contextManagement === true ||
    merged.extraPatches.includes(18) || merged.extraPatches.includes(19);
  return merged;
}

export function writeTuning(patch = {}, dshHome) {
  const file = tuningPath(dshHome);
  if (!file) throw new Error("DSH 데이터 디렉터리를 찾지 못해 tuning 을 저장할 수 없습니다");
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = acquireMaintenanceLock(dir);
  try {
    return saveTuning(file, patch, path.dirname(dir));
  } finally {
    const warning = lock.release();
    if (warning) console.warn("[dsh-purge] tuning lock:", warning);
  }
}

const writeSettings = atomicFiles(fs).atomicWriteSync;

function saveTuning(file, patch, dshHome) {
  const before = readTuning(dshHome);
  const next = { ...before, ...patch };
  // Existing users may link their settings to a shared location. Replace the
  // target atomically, keeping the link in the profile intact.
  const target = fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() ? fs.realpathSync(file) : file;
  writeSettings(target, JSON.stringify(next, null, 2), "utf8", { mode: 0o600, durable: true });
  const effective = readTuning(dshHome);
  // Record effective values, not invalid input that readTuning normalizes away.
  // Only known, non-secret settings belong in the public audit schema.
  for (const key of Object.keys(TUNING_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key) || before[key] === effective[key]) continue;
    const auditValue = (value) => key === "injectPosition"
      ? (["head", "tail", "both"].includes(value) ? value : "invalid")
      : key === "extraPatches"
        ? (Array.isArray(value) ? value.map(Number).join(",") : "invalid")
        : (typeof value === "boolean" ? value : "invalid");
    logAudit("tuning_setting", { key, from: auditValue(before[key]), to: auditValue(effective[key]) }, path.dirname(path.dirname(file)));
  }
  return effective;
}
