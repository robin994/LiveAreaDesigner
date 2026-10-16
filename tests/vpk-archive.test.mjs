import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { makeZip } from "../docs/package.mjs";
import {
  readZipArchive, readArchiveEntry, readVpk,
  writeZipArchive, patchVpk
} from "../docs/vpk.mjs";

const text = new TextEncoder();
const SHA = data => createHash("sha256").update(data).digest("hex");
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
async function sampleVpk() {
  const rawEboot = Uint8Array.from({ length: 14500 }, (_, i) => (i * 39) & 255);
  const packed = deflateRawSync(rawEboot);
  const original = await readZipArchive(makeZip([
    { name: "eboot.bin", data: rawEboot },
    { name: "sce_sys/param.sfo", data: "SFO-TEST-UNCHANGED" },
    { name: "sce_sys/livearea/contents/template.xml", data: "<livearea/>" },
    { name: "sce_sys/livearea/contents/bg0.png", data: "OLD-PNG" },
    { name: "game/data/save.bin", data: "NEVER TOUCH THIS DATA" }
  ]));
  const entries = original.entries.map(e => e.name === "eboot.bin" ? {
    ...e, method: 8, compressedSize: packed.length,
    uncompressedSize: rawEboot.length, crc: crc32(rawEboot),
    packed: new Blob([packed]), versionNeeded: 20
  } : e);
  return { originalBytes: rawEboot,
    blob: writeZipArchive(entries, text.encode("test original archive comment")) };
}

test("VPK reader inflates only requested assets and preserves untouched deflate streams", async () => {
  const { blob, originalBytes } = await sampleVpk();
  const archive = await readVpk(blob);
  assert.equal(archive.entries.length, 5);
  assert.equal(archive.byName.get("eboot.bin").method, 8);
  assert.equal(SHA(await readArchiveEntry(archive, "eboot.bin")),
    SHA(originalBytes));
  assert.equal(new TextDecoder().decode(await readArchiveEntry(archive,
    "sce_sys/livearea/contents/bg0.png")), "OLD-PNG");
});
test("patching VPK replaces only specified LiveArea assets and keeps original other files", async () => {
  const { blob, originalBytes } = await sampleVpk();
  const old = await readVpk(blob);
  const beforeCompressed = new Uint8Array(await old.byName.get("eboot.bin").packed.arrayBuffer());
  const replacement = makeZip([
    { name: "sce_sys/livearea/contents/template.xml", data: "<livearea multi='yes'/>" },
    { name: "sce_sys/livearea/contents/bg0.png", data: "NEW-IMAGE" },
    { name: "sce_sys/livearea/contents/frame1.png", data: "FRAME-1" }
  ]);
  const patched = await patchVpk(old, replacement);
  const after = await readVpk(patched);
  assert.equal(after.entries.length, 6);
  assert.equal(SHA(await readArchiveEntry(after, "eboot.bin")),
    SHA(originalBytes));
  assert.equal(SHA(new Uint8Array(await after.byName.get("eboot.bin").packed.arrayBuffer())),
    SHA(beforeCompressed));
  assert.equal(new TextDecoder().decode(await readArchiveEntry(after,
    "game/data/save.bin")), "NEVER TOUCH THIS DATA");
  assert.equal(new TextDecoder().decode(await readArchiveEntry(after,
    "sce_sys/livearea/contents/bg0.png")), "NEW-IMAGE");
  assert.equal(new TextDecoder().decode(await readArchiveEntry(after,
    "sce_sys/livearea/contents/frame1.png")), "FRAME-1");
  assert.equal(new TextDecoder().decode(after.comment), "test original archive comment");
});
test("original artwork can pass through unchanged without PNG recompression", async () => {
  const { blob } = await sampleVpk();
  const original = await readVpk(blob);
  const replacement = makeZip([
    { name: "sce_sys/livearea/contents/template.xml", data: "<livearea changed='text'/>" },
    { name: "sce_sys/livearea/contents/bg0.png", data: "new recompressed bytes" },
    { name: "sce_sys/livearea/contents/frame2.png", data: "temporary replacement" }
  ]);
  const patched = await readVpk(await patchVpk(original, replacement, {
    preserve: new Map([
      ["sce_sys/livearea/contents/bg0.png", "sce_sys/livearea/contents/bg0.png"],
      ["sce_sys/livearea/contents/frame2.png", "sce_sys/livearea/contents/bg0.png"]
    ])
  }));
  assert.equal(new TextDecoder().decode(await readArchiveEntry(
    patched, "sce_sys/livearea/contents/bg0.png")), "OLD-PNG");
  assert.equal(new TextDecoder().decode(await readArchiveEntry(
    patched, "sce_sys/livearea/contents/frame2.png")), "OLD-PNG");
  assert.equal(new TextDecoder().decode(await readArchiveEntry(
    patched, "sce_sys/livearea/contents/template.xml")), "<livearea changed='text'/>");
});
test("unsafe input archives and unsafe replacement paths are rejected", async () => {
  const { blob } = await sampleVpk();
  await assert.rejects(() => readVpk(makeZip([{ name: "just.txt", data: "x" }])),
    /complete PS Vita VPK/);
  assert.throws(() => makeZip([{ name: "../hack.png", data: "x" }]), /Unsafe ZIP/);
  await assert.rejects(() => readZipArchive(makeZip([
    { name: "a.txt", data: "one" }, { name: "a.txt", data: "two" }
  ])), /Duplicate VPK path/);
  const old = await readVpk(blob);
  await assert.rejects(() => patchVpk(old, makeZip([
    { name: "eboot.bin", data: "hijack" },
    { name: "sce_sys/livearea/contents/template.xml", data: "valid" }
  ])), /Unexpected replacement VPK path/);
  const broken = new Uint8Array(await blob.arrayBuffer());
  broken[broken.length - 22 - text.encode("test original archive comment").length] ^= 17;
  await assert.rejects(() => readVpk(broken), /supported ZIP\/VPK/);
});
test("inflate detects invalid CRC32 without touching other compressed entries", async () => {
  const { blob } = await sampleVpk();
  const archive = await readVpk(blob);
  const target = archive.byName.get("game/data/save.bin");
  const edited = writeZipArchive(archive.entries.map(entry => (
    entry === target ? { ...entry, crc: entry.crc ^ 0x01 } : entry
  )), archive.comment);
  const reopened = await readVpk(edited);
  await assert.rejects(() => readArchiveEntry(reopened, target.name),
    /Checksum mismatch/);
});
