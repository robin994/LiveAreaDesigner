/**
 * Local-only PS Vita VPK (ZIP32) importer / LiveArea patcher.
 *
 * Passes through compressed bytes of untouched entries (including eboot.bin),
 * without ever decompressing the game executable or rewriting the source file.
 * No network requests or third-party library are needed.
 *
 * Unsupported: encrypted archives, multi-volume ZIPs, ZIP64, >512 MiB inputs.
 * Unsupported ZIP methods can still be *preserved* but cannot be imported.
 */
const encoding = new TextEncoder();
const decoding = new TextDecoder("utf-8", { fatal: true });
const MAX_VPK_SIZE = 512 * 1024 * 1024;
const MAX_ENTRIES = 30000;
const SIG_END = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function check(condition, explanation) {
  if (!condition) throw new Error(explanation);
}
const u16 = (data, pos) => data.getUint16(pos, true);
const u32 = (data, pos) => data.getUint32(pos, true);
const p16 = (value) => Uint8Array.of(value & 255, (value >>> 8) & 255);
const p32 = (value) => Uint8Array.of(value & 255, (value >>> 8) & 255,
  (value >>> 16) & 255, (value >>> 24) & 255);
function bytes(parts) {
  return new Blob(parts, { type: "application/octet-stream" });
}
function getName(nameBytes, flags) {
  // Most Vita archives use ASCII paths. Reject undecodable names rather than
  // silently mangling them or replacing the wrong asset.
  try { return decoding.decode(nameBytes); }
  catch { throw new Error("ZIP contains filenames that are not valid UTF-8."); }
}
function validatePath(name) {
  check(name.length > 0 && !name.includes("\0") &&
    !name.startsWith("/") && !name.includes("\\") &&
    !name.includes(":") && !name.split("/").some(x => x === "." || x === "..") &&
    !name.startsWith("./") && !name.includes("//"),
  `Unsafe ZIP entry path: ${name.slice(0, 120)}`);
}
function crc32(data) {
  let value = 0xffffffff;
  for (const b of data) {
    value ^= b;
    for (let k = 0; k < 8; k++)
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/** Parse ZIP32 central directory, validating boundaries without expanding data. */
export async function readZipArchive(input, { maxBytes = MAX_VPK_SIZE } = {}) {
  const blob = input instanceof Blob ? input : new Blob([input]);
  check(blob.size >= 22 && blob.size <= maxBytes,
    `VPK must be between 22 bytes and ${Math.floor(maxBytes / 1024 / 1024)} MiB.`);
  const data = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (u32(view, i) === SIG_END && i + 22 + u16(view, i + 20) === data.length) {
      end = i;
      break;
    }
  }
  check(end >= 0, "The selected file is not a supported ZIP/VPK archive.");
  const disk = u16(view, end + 4), centralDisk = u16(view, end + 6);
  const count = u16(view, end + 10);
  const centralCount = u16(view, end + 8);
  const length = u32(view, end + 12), offset = u32(view, end + 16);
  check(disk === 0 && centralDisk === 0 && count === centralCount,
    "Split or multi-volume VPK archives are not supported.");
  check(count <= MAX_ENTRIES && count < 65535 && offset !== 0xffffffff &&
    length !== 0xffffffff, "This VPK requires unsupported ZIP64 support or has too many files.");
  check(offset + length <= end, "Invalid ZIP central directory bounds.");
  const comment = data.slice(end + 22);
  const entries = [];
  const names = new Set();
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    check(cursor + 46 <= offset + length && u32(view, cursor) === SIG_CENTRAL,
      "Corrupt VPK central directory.");
    const versionMadeBy = u16(view, cursor + 4);
    const versionNeeded = u16(view, cursor + 6);
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const time = u16(view, cursor + 12), date = u16(view, cursor + 14);
    const crc = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const fnLen = u16(view, cursor + 28);
    const exLen = u16(view, cursor + 30);
    const commentLen = u16(view, cursor + 32);
    const diskStart = u16(view, cursor + 34);
    const internalAttributes = u16(view, cursor + 36);
    const externalAttributes = u32(view, cursor + 38);
    const localOffset = u32(view, cursor + 42);
    const endEntry = cursor + 46 + fnLen + exLen + commentLen;
    check(endEntry <= offset + length, "Corrupt VPK file metadata.");
    check(!(flags & (1 | 0x40)), "Encrypted VPK archives cannot be modified.");
    check(diskStart === 0 && compressedSize !== 0xffffffff &&
      uncompressedSize !== 0xffffffff && localOffset !== 0xffffffff,
      "ZIP64 file metadata is not supported.");
    const filename = data.slice(cursor + 46, cursor + 46 + fnLen);
    const name = getName(filename, flags);
    validatePath(name);
    check(!names.has(name), `Duplicate VPK path: ${name}`);
    names.add(name);
    check(localOffset + 30 <= offset && u32(view, localOffset) === SIG_LOCAL,
      `Invalid local header: ${name}`);
    const localFnLen = u16(view, localOffset + 26);
    const localExLen = u16(view, localOffset + 28);
    const rawStart = localOffset + 30 + localFnLen + localExLen;
    check(rawStart + compressedSize <= offset, `Corrupt compressed file: ${name}`);
    const localFilename = data.slice(localOffset + 30, localOffset + 30 + localFnLen);
    check(localFilename.length === filename.length &&
      localFilename.every((n, j) => n === filename[j]),
      `Conflicting local/central ZIP paths: ${name}`);
    entries.push({
      name, filename, versionMadeBy, versionNeeded, flags: flags & ~8,
      method, time, date, crc, compressedSize, uncompressedSize,
      internalAttributes, externalAttributes,
      localExtra: data.slice(localOffset + 30 + localFnLen, rawStart),
      centralExtra: data.slice(cursor + 46 + fnLen, cursor + 46 + fnLen + exLen),
      comment: data.slice(cursor + 46 + fnLen + exLen, endEntry),
      packed: blob.slice(rawStart, rawStart + compressedSize)
    });
    cursor = endEntry;
  }
  check(cursor === offset + length, "Unexpected data in the ZIP central directory.");
  return { filename: input.name || "imported.vpk", size: blob.size,
    comment, entries, byName: new Map(entries.map(entry => [entry.name, entry])) };
}

/** Inflate an archive entry only when the editor actually needs its content. */
export async function readArchiveEntry(archive, filename, maxSize = 12 * 1024 * 1024) {
  const entry = typeof filename === "string" ? archive.byName.get(filename) : filename;
  check(entry, `VPK is missing ${filename}.`);
  check(entry.uncompressedSize <= maxSize, `VPK asset is larger than ${maxSize} bytes: ${entry.name}`);
  let data;
  if (entry.method === 0) {
    check(entry.compressedSize === entry.uncompressedSize, `Invalid stored file: ${entry.name}`);
    data = new Uint8Array(await entry.packed.arrayBuffer());
  } else if (entry.method === 8) {
    check(typeof DecompressionStream !== "undefined",
      "Your browser cannot unpack ZIP-deflated VPK assets.");
    const stream = entry.packed.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    data = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    throw new Error(`Compression method ${entry.method} cannot be previewed: ${entry.name}`);
  }
  check(data.length === entry.uncompressedSize && crc32(data) === entry.crc,
    `Checksum mismatch in VPK: ${entry.name}`);
  return data;
}
export async function readVpk(input) {
  const archive = await readZipArchive(input);
  check(archive.byName.has("eboot.bin") &&
    archive.byName.has("sce_sys/param.sfo"),
  "This ZIP is not a complete PS Vita VPK (missing eboot.bin or param.sfo).");
  return archive;
}

/** Pack new central directory; original compressed payloads are copied untouched. */
export function writeZipArchive(entries, comment = new Uint8Array()) {
  const parts = [], central = [];
  let position = 0, directoryLength = 0;
  check(entries.length > 0 && entries.length < 65535, "Too many ZIP entries.");
  const names = new Set();
  for (const entry of entries) {
    validatePath(entry.name);
    check(!names.has(entry.name), `Duplicate output ZIP path: ${entry.name}`);
    names.add(entry.name);
    const filename = entry.filename || encoding.encode(entry.name);
    const localExtra = entry.localExtra || new Uint8Array();
    const centralExtra = entry.centralExtra || new Uint8Array();
    const fileComment = entry.comment || new Uint8Array();
    const header = bytes([
      p32(SIG_LOCAL), p16(entry.versionNeeded || 20), p16(entry.flags || 0),
      p16(entry.method), p16(entry.time || 0), p16(entry.date || 0),
      p32(entry.crc), p32(entry.compressedSize), p32(entry.uncompressedSize),
      p16(filename.length), p16(localExtra.length), filename, localExtra
    ]);
    check(position + header.size + entry.compressedSize < 0xffffffff,
      "Output VPK is too large for ZIP32.");
    const record = bytes([
      p32(SIG_CENTRAL), p16(entry.versionMadeBy || 20),
      p16(entry.versionNeeded || 20), p16(entry.flags || 0),
      p16(entry.method), p16(entry.time || 0), p16(entry.date || 0),
      p32(entry.crc), p32(entry.compressedSize), p32(entry.uncompressedSize),
      p16(filename.length), p16(centralExtra.length), p16(fileComment.length),
      p16(0), p16(entry.internalAttributes || 0),
      p32(entry.externalAttributes || 0), p32(position),
      filename, centralExtra, fileComment
    ]);
    parts.push(header, entry.packed);
    central.push(record);
    directoryLength += record.size;
    position += header.size + entry.compressedSize;
  }
  check(position + directoryLength < 0xffffffff, "VPK exceeds ZIP32 limits.");
  check(comment.length <= 65535, "ZIP comment is too long.");
  return new Blob([...parts, ...central,
    bytes([p32(SIG_END), p16(0), p16(0),
      p16(entries.length), p16(entries.length),
      p32(directoryLength), p32(position), p16(comment.length), comment])
  ], { type: "application/octet-stream" });
}

const LIVEAREA_ROOT = "sce_sys/livearea/contents/";
function permittedAsset(path) {
  return path.startsWith(LIVEAREA_ROOT) ||
    path === "sce_sys/icon0.png" || path === "sce_sys/pic0.png" ||
    /^sce_sys\/manual\/\d{3}\.png$/.test(path);
}

/**
 * Replace only explicitly generated LiveArea resources, retaining every other
 * original VPK file. Untouched entries keep their exact compressed bytes,
 * CRC, compression method and most original ZIP metadata.
 */
export async function patchVpk(original, liveAreaAssets, { preserve = new Map() } = {}) {
  const replacement = await readZipArchive(liveAreaAssets, { maxBytes: 256 * 1024 * 1024 });
  check(replacement.entries.length > 0, "No replacement LiveArea assets were generated.");
  for (const entry of replacement.entries)
    check(permittedAsset(entry.name), `Unexpected replacement VPK path: ${entry.name}`);
  check(replacement.byName.has(LIVEAREA_ROOT + "template.xml"),
    "Replacement template.xml is required.");
  const next = new Map(original.entries.map(entry => [entry.name, entry]));
  for (const item of replacement.entries) {
    // Avoid re-quantizing imported artwork when the user only changes the
    // frame's XML text/target/position. Preserve exact original PNG/JPG bytes
    // (including their compressed ZIP representation) where safe.
    const sourcePath = preserve.get(item.name);
    const untouched = sourcePath && original.byName.get(sourcePath);
    if (untouched) {
      const renamed = sourcePath === item.name ? untouched : {
        ...untouched, name: item.name, filename: encoding.encode(item.name),
        flags: (untouched.flags | 0x0800) & ~8,
        localExtra: new Uint8Array(), centralExtra: new Uint8Array(),
        comment: new Uint8Array()
      };
      next.set(item.name, renamed);
    } else {
      next.set(item.name, item);
    }
  }
  check(next.has("eboot.bin") && next.has("sce_sys/param.sfo"),
    "Output is missing required PS Vita executable metadata.");
  return writeZipArchive([...next.values()], original.comment);
}
