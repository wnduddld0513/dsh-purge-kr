// ZIP 해제는 Node 리더로만 수행한다: 외부 도구 분기는 제거되었고, 세 가지 보호를 우회할 수 없다.
//
// 배경: 과거에는 tar/unzip/python3/Expand-Archive 로 이어지는 폴백 체인이 있었지만, 그 경로는
// 이름과 심볼릭 링크 검사만 했고 maxEntries / verifyCrc / assertNoLinkedDescendants 는 없었다.
// 폴백이 한 번이라도 발동하면 이 세 계층이 조용히 무력화된다. 지금은 모든 호출이 같은 제한 리더를 거친다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractZipArchive, extractZipBuffer } from "../lib/zip-extract.js";
import * as zipModule from "../lib/zip-extract.js";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "", "utf8");
    const crc = entry.crcOverride ?? crc32(data);
    const mode = entry.mode ?? 0o100644;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const localBuf = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-zip-node-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("외부 압축 해제 도구 진입점과 쓰이지 않는 디렉터리 목록 export 를 제거했다", () => {
  // 이 심볼들이 다시 들어오면 외부 도구 폴백 체인이 되살아났거나(세 계층 보호 누락),
  // 아무도 호출하지 않는 export 를 추가했다는 뜻이다.
  for (const name of ["unzipTools", "listZipFile", "listZipEntries"]) {
    assert.equal(typeof zipModule[name], "undefined", `${name} 는 삭제되어 있어야 합니다`);
  }
  assert.equal(typeof zipModule.extractZipArchive, "function");
  assert.equal(typeof zipModule.extractZipBuffer, "function");
  assert.equal(typeof zipModule.safeArchiveName, "function");
});

test("extractZipArchive 는 항상 node 를 반환하고 extractZipBuffer 와 결과가 같다", (t) => {
  const dir = tmpdir(t);
  const zip = path.join(dir, "a.zip");
  fs.writeFileSync(zip, buildZip([
    { name: "pkg/SKILL.md", data: "---\nname: p\n---\n" },
    { name: "pkg/sub/a.txt", data: "a" },
  ]));
  const dest = path.join(dir, "out");
  assert.equal(extractZipArchive(zip, dest), "node");
  assert.ok(fs.existsSync(path.join(dest, "pkg", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(dest, "pkg", "sub", "a.txt")));
});

test("심볼릭 링크 항목은 archive 진입점에서 거부된다", (t) => {
  const dir = tmpdir(t);
  const zip = path.join(dir, "link.zip");
  fs.writeFileSync(zip, buildZip([
    { name: "pkg/esc", data: "../../outside", mode: 0o120777 },
    { name: "pkg/esc/x", data: "pwn" },
  ]));
  const dest = path.join(dir, "out");
  assert.throws(() => extractZipArchive(zip, dest), /링크 항목/);
  assert.equal(fs.existsSync(path.join(dest, "pkg", "esc")), false);
});

test("maxEntries 는 archive 진입점에서 적용된다", (t) => {
  const dir = tmpdir(t);
  const zip = path.join(dir, "many.zip");
  fs.writeFileSync(zip, buildZip(
    Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })),
  ));
  assert.throws(
    () => extractZipArchive(zip, path.join(dir, "out"), { maxEntries: 3 }),
    /항목이 너무 많습니다/,
  );
});

test("verifyCrc 는 archive 진입점에서 적용된다", (t) => {
  const dir = tmpdir(t);
  const zip = path.join(dir, "badcrc.zip");
  fs.writeFileSync(zip, buildZip([
    { name: "pkg/a.txt", data: "hello", crcOverride: 0xdeadbeef },
  ]));
  assert.throws(
    () => extractZipArchive(zip, path.join(dir, "out"), { verifyCrc: true }),
    /CRC 검증에 실패/,
  );
  // 끄면 검증하지 않으므로 선택 사항이지 늘 켜지는 검증이 아님을 보여준다
  assert.doesNotThrow(() => extractZipArchive(zip, path.join(dir, "out2"), { verifyCrc: false }));
});

test("maxBytes 는 archive 진입점에서 적용된다", (t) => {
  const dir = tmpdir(t);
  const zip = path.join(dir, "big.zip");
  fs.writeFileSync(zip, buildZip([{ name: "a.bin", data: Buffer.alloc(4096, 0x41) }]));
  assert.throws(
    () => extractZipArchive(zip, path.join(dir, "out"), { maxBytes: 1024 }),
    /크기 상한을 넘었습니다/,
  );
});

test("extractZipBuffer 도 archive 진입점과 마찬가지로 중복 경로를 거부한다", (t) => {
  const dir = tmpdir(t);
  const zip = path.join(dir, "dup.zip");
  const bytes = buildZip([
    { name: "pkg/a.txt", data: "1" },
    { name: "pkg/a.txt", data: "2" },
  ]);
  fs.writeFileSync(zip, bytes);
  assert.throws(() => extractZipArchive(zip, path.join(dir, "out")), /중복 경로/);
  assert.throws(() => extractZipBuffer(bytes, path.join(dir, "out2")), /중복 경로/);
});
