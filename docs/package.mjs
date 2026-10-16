import { CARD, PALETTE } from "./geometry.mjs?v=1.22";
import { generateTemplate } from "./template.mjs?v=1.22";

const encoder = new TextEncoder();
const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function u32be(value) {
  return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255,
    (value >>> 8) & 255, value & 255);
}
function u32le(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255,
    (value >>> 16) & 255, (value >>> 24) & 255);
}
function u16le(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255);
}
function concat(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = encoder.encode(type);
  return concat([u32be(bytes.length), name, bytes, u32be(crc32(concat([name, bytes])))]);
}

/**
 * Indexed 8-bit PNG with a fixed 224-color RGB palette plus a transparent entry.
 * PNGs built by browsers are usually 32-bit; indexed PNGs are more Vita-friendly.
 * Alpha values under 128 become fully transparent; others become opaque.
 */
export async function encodeIndexedPng(width, height, rgba, allowTransparency = false) {
  const raw = new Uint8Array((width + 1) * height);
  const palette = new Uint8Array(225 * 3);
  // Index 0 is transparent. Indices 1..224 represent a 7x8x4 RGB palette.
  for (let red = 0; red < 7; red++) {
    for (let green = 0; green < 8; green++) {
      for (let blue = 0; blue < 4; blue++) {
        const idx = 1 + (red * 8 + green) * 4 + blue;
        palette[idx * 3] = Math.round(red * 255 / 6);
        palette[idx * 3 + 1] = Math.round(green * 255 / 7);
        palette[idx * 3 + 2] = Math.round(blue * 255 / 3);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (allowTransparency && rgba[i + 3] < 128) {
        raw[row + 1 + x] = 0;
        continue;
      }
      const red = Math.round(rgba[i] * 6 / 255);
      const green = Math.round(rgba[i + 1] * 7 / 255);
      const blue = Math.round(rgba[i + 2] * 3 / 255);
      raw[row + 1 + x] = 1 + (red * 8 + green) * 4 + blue;
    }
  }
  if (typeof CompressionStream !== "function")
    throw new Error("This browser cannot create Vita-compatible indexed PNGs.");
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const ihdr = concat([u32be(width), u32be(height), Uint8Array.of(8, 3, 0, 0, 0)]);
  return concat([
    SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", palette),
    ...(allowTransparency ? [chunk("tRNS", Uint8Array.of(0))] : []),
    chunk("IDAT", compressed), chunk("IEND", new Uint8Array())
  ]);
}

/** ZIP store entries without compression (the images themselves are deflated). */
export function makeZip(entries) {
  const locals = [], central = [];
  let position = 0;
  for (const { name, data } of entries) {
    if (name.includes("..") || name.startsWith("/") || name.includes("\\"))
      throw new Error("Unsafe ZIP entry path");
    const filename = encoder.encode(name);
    const content = data instanceof Uint8Array ? data : encoder.encode(data);
    const checksum = crc32(content);
    const flags = u16le(0x0800); // UTF-8 names.
    const header = concat([
      u32le(0x04034b50), u16le(20), flags,
      u16le(0), u16le(0), u16le(0), u32le(checksum),
      u32le(content.length), u32le(content.length), u16le(filename.length), u16le(0),
      filename
    ]);
    locals.push(header, content);
    central.push(concat([
      u32le(0x02014b50), u16le(20), u16le(20), flags,
      u16le(0), u16le(0), u16le(0), u32le(checksum),
      u32le(content.length), u32le(content.length),
      u16le(filename.length), u16le(0), u16le(0), u16le(0),
      u16le(0), u32le(0), u32le(position), filename
    ]));
    position += header.length + content.length;
  }
  if (entries.length > 65535 || position > 0xffffffff) throw new Error("ZIP is too large");
  const cdir = concat(central);
  const footer = concat([
    u32le(0x06054b50), u16le(0), u16le(0),
    u16le(entries.length), u16le(entries.length),
    u32le(cdir.length), u32le(position), u16le(0)
  ]);
  return new Blob([...locals, cdir, footer], { type: "application/zip" });
}

function artwork(width, height, background, source, transparent = false, placeholder = false) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!transparent) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  if (source?.image) context.drawImage(source.image, 0, 0, width, height);
  else if (placeholder) {
    context.font = `bold ${Math.min(30, height / 5)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.fillText("START", width / 2, height / 2);
  }
  return context.getImageData(0, 0, width, height).data;
}

async function addImage(entries, filename, w, h, color, image, transparency, placeholder = false) {
  const png = await encodeIndexedPng(w, h, artwork(w, h, color, image, transparency, placeholder), transparency);
  entries.push({ name: filename, data: png });
}

/**
 * Returns a complete Vita-oriented asset ZIP, not just template.xml.
 * Frame liveitem positions are frame-relative and should be tested with the
 * selected real Vita layout; the editor cannot change fixed gate/frame slots.
 */
export async function buildLiveAreaPackage(layout, images) {
  const root = "sce_sys/livearea/contents/";
  const entries = [{ name: root + "template.xml", data: generateTemplate(layout) }];
  await addImage(entries, root + "bg0.png", CARD.width, CARD.height,
    PALETTE[layout.cardColor].hex, images.card, false);
  await addImage(entries, root + "startup.png", 280, 158,
    PALETTE[layout.buttonColor].hex, images.gate, true, !images.gate);
  await addImage(entries, root + "button.png", layout.w, layout.h,
    PALETTE[layout.buttonColor].hex, images.button, layout.transparentButton);
  if (images.icon) await addImage(entries, "sce_sys/icon0.png", 128, 128, "#000000", images.icon, false);
  if (images.boot) await addImage(entries, "sce_sys/pic0.png", 960, 544, "#000000", images.boot, false);
  for (const [i, page] of (images.manual || []).entries()) {
    await addImage(entries, `sce_sys/manual/${String(i + 1).padStart(3, "0")}.png`,
      960, 544, "#000000", page, false);
  }
  return makeZip(entries);
}
