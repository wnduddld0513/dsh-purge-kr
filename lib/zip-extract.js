import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { assertNoLinkedDescendants } from "./path-boundary.js";

export function safeArchiveName(name) {
  const rel = String(name || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!rel || rel === ".") return "";
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) throw new Error("zip 경로가 올바르지 않습니다");
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === ".." || /[\x00-\x1f:]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("zip 경로가 올바르지 않습니다");
  return parts.join("/");
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function isSymlinkMode(mode) {
  return (mode & S_IFMT) === S_IFLNK;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  const candidates = [];
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    if (eocdIsSelfConsistent(buf, i)) candidates.push(i);
  }
  if (!candidates.length) throw new Error("zip 가 아닙니다");
  if (candidates.length > 1) {

    throw new Error("zip 에 EOCD 후보가 여러 개 있어 압축 해제를 거부합니다");
  }
  return candidates[0];
}

function eocdIsSelfConsistent(buf, i) {
  const totalDisk = buf.readUInt16LE(i + 8);
  const total = buf.readUInt16LE(i + 10);
  const centralSize = buf.readUInt32LE(i + 12);
  const centralOffset = buf.readUInt32LE(i + 16);
  const commentLength = buf.readUInt16LE(i + 20);

  if (i + 22 + commentLength !== buf.length) return false;

  if (centralSize === 0xffffffff || centralOffset === 0xffffffff) return false;
  if (totalDisk !== total) return false;

  if (centralOffset + centralSize !== i) return false;
  if (total === 0) return centralSize === 0 && centralOffset === 0;

  let cursor = centralOffset;
  for (let n = 0; n < total; n += 1) {
    if (cursor + 46 > i || buf.readUInt32LE(cursor) !== 0x02014b50) return false;
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    cursor += 46 + nameLen + extraLen + commentLen;
    if (cursor > i) return false;
  }
  return cursor === i;
}

function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("zip 가 아닙니다");
  const eocd = findEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < total; n += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("zip 목록이 손상되었습니다");
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compSize = buf.readUInt32LE(cursor + 20);
    const uncompSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const externalAttrs = buf.readUInt32LE(cursor + 38);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString("utf8", cursor + 46, cursor + 46 + nameLen);

    entries.push({ name, crc: buf.readUInt32LE(cursor + 16), method, compSize, uncompSize, localOffset, mode: externalAttrs >>> 16 });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function localDataOffset(buf, localOffset) {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("zip 로컬 헤더가 손상되었습니다");
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  return localOffset + 30 + nameLen + extraLen;
}

export function extractZipBuffer(buf, dest, { maxBytes = 200 * 1024 * 1024, maxEntries = 65535, verifyCrc = false } = {}) {
  let totalBytes = 0;
  const seen = new Set();
  fs.mkdirSync(dest, { recursive: true });
  const root = path.resolve(dest);
  const entries = readZipEntries(buf);
  if (entries.length > maxEntries) throw new Error("압축 파일에 항목이 너무 많습니다");
  if (entries.some(entry => isSymlinkMode(entry.mode))) throw new Error("압축 파일에 링크 항목이 있습니다");
  for (const entry of entries) {
    const rel = safeArchiveName(entry.name);
    if (!rel) continue;
    if (seen.has(rel)) throw new Error("zip 에 중복 경로가 있습니다");
    seen.add(rel);
    const out = assertNoLinkedDescendants(root, path.resolve(root, rel), fs);
    if (entry.name.endsWith("/")) { fs.mkdirSync(out, { recursive: true }); continue; }
    if (entry.uncompSize > maxBytes - totalBytes) throw new Error("zip 압축 해제 결과가 크기 상한을 넘었습니다");
    if (entry.compSize === 0xffffffff || entry.localOffset === 0xffffffff) {
      throw new Error("zip64 는 지원하지 않습니다");
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(`지원하지 않는 zip 압축 방식 ${entry.method}`);
    }
    const start = localDataOffset(buf, entry.localOffset);
    const end = start + entry.compSize;
    if (end > buf.length) throw new Error("zip 데이터가 잘렸습니다");
    const compressed = buf.subarray(start, end);
    const body = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, maxBytes - totalBytes) });
    if (body.length !== entry.uncompSize) throw new Error("zip 파일 크기가 목록과 일치하지 않습니다");
    if (verifyCrc && zlib.crc32(body) !== entry.crc) throw new Error("zip 파일 CRC 검증에 실패했습니다");
    totalBytes += body.length;
    if (totalBytes > maxBytes) throw new Error("zip 압축 해제 결과가 크기 상한을 넘었습니다");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body, { flag: "wx" });
  }
}

/**
 * zip 아카이브의 압축을 푼다. 모든 플랫폼이 같은 제한형 Node 판독기를 쓴다.
 *
 * 여기서는 외부 압축 해제 도구(tar / unzip / python3 / Expand-Archive)로 **다시**
 * 되돌아가지 않는다. 그런 도구는 링크 항목을 실제 링크로 그대로 만들고, 저마다
 * 오류 복구 동작이 달라 `extractZipBuffer` 에서 하는 항목별 검증과 일치함을
 * 보장할 수 없다; 한 번 되돌아가면 `maxEntries`, `verifyCrc`,
 * `assertNoLinkedDescendants` 세 겹의 보호가 모두 조용히 무력화된다.
 *
 * @param zipPath - 아카이브 경로.
 * @param dest - 압축 해제 대상.
 * @param options - `extractZipBuffer` 로 그대로 전달한다(`maxBytes` / `maxEntries` / `verifyCrc`).
 * @returns 항상 `"node"` 를 반환하며, 호출하는 쪽이 계속 읽을 수 있도록 반환값 형태를 유지한다.
 */
export function extractZipArchive(zipPath, dest, options = {}) {
  fs.mkdirSync(dest, { recursive: true });
  extractZipBuffer(fs.readFileSync(zipPath), dest, options);
  return "node";
}
