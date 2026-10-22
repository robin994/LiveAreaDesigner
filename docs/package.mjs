import { CARD, PALETTE } from "./geometry.mjs?v=1.32";
import { generateTemplate } from "./template.mjs?v=1.32";
import { allFrameLayouts, frameKey } from "./frame-model.mjs?v=1.32";
import { hasStartupGate } from "./template-preview.mjs?v=1.32";
import { quantizeRgba } from "./quantizer.mjs?v=1.32";

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
 * Fidelity-first indexed PNG8: adaptive (image-specific) 256-color palette.
 * PNG compression stays lossless after the palette conversion.
 */
export async function encodeIndexedPng(width, height, rgba, allowTransparency = false,
                                      { optimize = true, colors = 256, dither = 0.15,
                                        fullPalette = false, paletteCache = null } = {}) {
  const { indices, palette, transparency } =
    quantizeRgba(width, height, rgba, allowTransparency,
      { colors, dither, paletteCache });
  const storedPalette = fullPalette && palette.length < 256 * 3 ?
    new Uint8Array(256 * 3) : palette;
  if (storedPalette !== palette) storedPalette.set(palette);
  const raw = new Uint8Array((width + 1) * height);
  // PNG filter selection reduces the size of the zlib stream for typical
  // graphic/UI images; leave the legacy filter-0 variant as a fallback.
  function paeth(a, b, c) {
    const p = a + b - c;
    const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  }
  for (let y = 0; y < height; y++) {
    const dest = y * (width + 1);
    const pos = y * width;
    if (!optimize) {
      raw[dest] = 0;
      raw.set(indices.subarray(pos, pos + width), dest + 1);
      continue;
    }
    let best = Infinity, filter = 0, result = null;
    for (let type = 0; type <= 4; type++) {
      const filtered = new Uint8Array(width);
      let score = 0;
      for (let x = 0; x < width; x++) {
        const current = indices[pos + x];
        const left = x > 0 ? indices[pos + x - 1] : 0;
        const above = y > 0 ? indices[pos - width + x] : 0;
        const upperLeft = y > 0 && x > 0 ? indices[pos - width + x - 1] : 0;
        const prediction = type === 0 ? 0 :
          type === 1 ? left : type === 2 ? above :
            type === 3 ? (left + above) >>> 1 : paeth(left, above, upperLeft);
        const delta = (current - prediction + 256) & 255;
        filtered[x] = delta;
        score += delta < 128 ? delta : 256 - delta;
      }
      if (score < best) { best = score; filter = type; result = filtered; }
    }
    raw[dest] = filter;
    raw.set(result, dest + 1);
  }
  if (typeof CompressionStream !== "function")
    throw new Error("This browser cannot create Vita-compatible indexed PNGs.");
  const compress = async input => {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  let compressed = await compress(raw);
  if (optimize) {
    // PNG's adaptive filters are not always superior (e.g. flat-color
    // images). Compare both lossless encodings instead of increasing size.
    const unfiltered = new Uint8Array((width + 1) * height);
    for (let y = 0; y < height; y++)
      unfiltered.set(indices.subarray(y * width, (y + 1) * width),
        y * (width + 1) + 1);
    const direct = await compress(unfiltered);
    if (direct.length < compressed.length) compressed = direct;
  }
  const ihdr = concat([u32be(width), u32be(height), Uint8Array.of(8, 3, 0, 0, 0)]);
  return concat([
    SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", storedPalette),
    ...(transparency ? [chunk("tRNS", transparency)] : []),
    chunk("IDAT", compressed), chunk("IEND", new Uint8Array())
  ]);
}

/** Frame1 uses lossless RGB/RGBA PNG, never a reduced-color palette. */
export async function encodeTruecolorPng(width, height, rgba, transparency = false) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width <= 0 || height <= 0 || rgba?.length !== width * height * 4)
    throw new Error("Invalid frame1 RGBA image dimensions.");
  if (typeof CompressionStream !== "function")
    throw new Error("This browser cannot encode PNG images.");
  const channels = transparency ? 4 : 3;
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const src = y * width * 4;
    if (transparency) pixels.set(rgba.subarray(src, src + width * 4), row);
    else for (let x = 0; x < width; x++)
      pixels.set(rgba.subarray(src + 4 * x, src + 4 * x + 3), row + 3 * x);
  }
  const raw = new Uint8Array((stride + 1) * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    let bestScore = Infinity, bestType = 0, bestRow = null;
    for (let type = 0; type < 5; type++) {
      const filtered = new Uint8Array(stride);
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const pos = y * stride + x;
        const left = x < channels ? 0 : pixels[pos - channels];
        const above = y === 0 ? 0 : pixels[pos - stride];
        const upperLeft = y === 0 || x < channels ? 0 :
          pixels[pos - stride - channels];
        const prediction = type === 0 ? 0 : type === 1 ? left :
          type === 2 ? above : type === 3 ? (left + above) >>> 1 :
            paeth(left, above, upperLeft);
        const delta = (pixels[pos] - prediction + 256) & 255;
        filtered[x] = delta;
        score += delta < 128 ? delta : 256 - delta;
      }
      if (score < bestScore) { bestScore = score; bestType = type; bestRow = filtered; }
    }
    const row = y * (stride + 1);
    raw[row] = bestType;
    raw.set(bestRow, row + 1);
  }
  // DEFLATE is a required, lossless part of the PNG format; it cannot change
  // any pixel and is unrelated to PNG8's destructive palette quantization.
  const compress = async data => new Uint8Array(await new Response(
    new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"))
  ).arrayBuffer());
  let data = await compress(raw);
  const unfiltered = new Uint8Array(raw.length);
  for (let y = 0; y < height; y++)
    unfiltered.set(pixels.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1);
  const simpler = await compress(unfiltered);
  if (simpler.length < data.length) data = simpler;
  const header = concat([u32be(width), u32be(height),
    Uint8Array.of(8, transparency ? 6 : 2, 0, 0, 0)]);
  return concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", data),
    chunk("IEND", new Uint8Array())]);
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

/** Encode an already-resized RGBA image inside the common Vita asset caps. */
export async function encodeVitaPng(filename, w, h, rgba, transparency = false,
                                    { optimize = true, warnings = [] } = {}) {
  const base = filename.split("/").at(-1);
  // Stock Vita firmware includes indexed 840x500 bg0.png assets as large
  // as 369,340 bytes. The previous 128 KiB bound was a needless quality
  // regression, not a limit observed in SceShell.
  const maxBytes = ({ "bg0.png": 384 * 1024, "startup.png": 64 * 1024,
    "icon0.png": 128 * 1024, "pic0.png": 256 * 1024 })[base] ?? Infinity;
  // Prefer smooth full-palette gradients. Only reduce dithering and then
  // palette size when a restricted asset actually needs it.
  const variants = [{ colors: 256, dither: 0.50 },
    { colors: 256, dither: 0.35 }, { colors: 256, dither: 0.15 },
    { colors: 256, dither: 0.05 },
    { colors: 256, dither: 0 },
    { colors: 192, dither: 0 }, { colors: 128, dither: 0 },
    { colors: 96, dither: 0 }, { colors: 64, dither: 0 },
    { colors: 32, dither: 0 }];
  let png = null, chosen = variants[0];
  const paletteCache = new Map();
  for (const candidate of variants) {
    const encoded = await encodeIndexedPng(w, h, rgba, transparency,
      { ...candidate, optimize, fullPalette: base === "pic0.png", paletteCache });
    png = encoded;
    chosen = candidate;
    if (encoded.length <= maxBytes) break;
  }
  if (png.length > maxBytes) {
    throw new Error(`${base} is ${Math.ceil(png.length / 1024)} KiB after PNG8 compression, over the ${maxBytes / 1024} KiB Vita limit. Reduce image complexity before exporting.`);
  }
  if (chosen !== variants[0]) {
    warnings.push(`${base}: optimized PNG8 at ${chosen.colors} colors with ${chosen.dither.toFixed(2)} dithering to respect the Vita file-size limit.`);
  }
  return png;
}

async function preserveOpaqueIndexedPng(source, width, height, maxBytes) {
  if (!source?.blob || !source?.image ||
      source.image.naturalWidth !== width || source.image.naturalHeight !== height ||
      !/\.png$/i.test(source.name || "")) return null;
  const bytes = new Uint8Array(await source.blob.arrayBuffer());
  if (bytes.length > maxBytes || bytes.length < 65 ||
      !SIGNATURE.every((part, i) => part === bytes[i])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 ||
      view.getUint32(16) !== width || view.getUint32(20) !== height ||
      bytes[24] !== 8 || bytes[25] !== 3 || bytes[28] !== 0) return null;
  let position = 8, palette = false, imageData = false, end = false;
  while (position + 12 <= bytes.length) {
    const size = view.getUint32(position);
    if (size > bytes.length - position - 12) return null;
    const type = view.getUint32(position + 4);
    if (type === 0x74524e53) return null; // tRNS: background must be opaque.
    if (type === 0x504c5445) palette = size > 0 && size <= 768 && size % 3 === 0;
    if (type === 0x49444154) imageData = true;
    position += size + 12;
    if (type === 0x49454e44) { end = true; break; }
  }
  // Browser image decoding has already validated that the source is a PNG.
  // Reuse its indexed pixels and original palette without a second quantizer.
  return palette && imageData && end && position === bytes.length ? bytes : null;
}

async function preserveFrame1Png(source, width, height, transparency) {
  if (!source?.blob || !source?.image ||
      source.image.naturalWidth !== width || source.image.naturalHeight !== height ||
      !/\.png$/i.test(source.name || "")) return null;
  const bytes = new Uint8Array(await source.blob.arrayBuffer());
  if (bytes.length < 65 || !SIGNATURE.every((part, i) => part === bytes[i]))
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorType = bytes[25];
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 ||
      view.getUint32(16) !== width || view.getUint32(20) !== height ||
      bytes[24] !== 8 || ![0, 2, 3, 4, 6].includes(colorType) ||
      bytes[28] !== 0 || (!transparency && [4, 6].includes(colorType))) return null;
  let position = 8, palette = false, imageData = false, end = false;
  while (position + 12 <= bytes.length) {
    const size = view.getUint32(position);
    if (size > bytes.length - position - 12) return null;
    const type = view.getUint32(position + 4);
    if (type === 0x74524e53 && !transparency) return null;
    if (type === 0x504c5445) palette = size > 0 && size <= 768 && size % 3 === 0;
    if (type === 0x49444154) imageData = true;
    position += size + 12;
    if (type === 0x49454e44) { end = true; break; }
  }
  // The decoded browser image validates the PNG; skip an unnecessary encode
  // only when dimensions, bit depth and alpha semantics already match.
  return imageData && end && position === bytes.length &&
    (colorType !== 3 || palette) ? bytes : null;
}

async function addImage(entries, filename, w, h, color, image, transparency,
                        placeholder = false, optimization = true, warnings = [],
                        losslessFrame1 = false) {
  if (losslessFrame1) {
    const preserved = await preserveFrame1Png(image, w, h, transparency);
    const png = preserved || await encodeTruecolorPng(w, h,
      artwork(w, h, color, image, transparency, placeholder), transparency);
    if (png.length > 384 * 1024)
      warnings.push("frame1.png: lossless full-color image is large; confirm it renders on a real Vita.");
    entries.push({ name: filename, data: png });
    return;
  }
  const maxBytes = filename.endsWith("/bg0.png") ? 384 * 1024 : Infinity;
  if (!transparency && image && maxBytes !== Infinity) {
    const preserved = await preserveOpaqueIndexedPng(image, w, h, maxBytes);
    if (preserved) {
      entries.push({ name: filename, data: preserved });
      return;
    }
  }
  const png = await encodeVitaPng(filename, w, h,
    artwork(w, h, color, image, transparency, placeholder),
    transparency, { optimize: optimization, warnings });
  entries.push({ name: filename, data: png });
}

/**
 * Returns a complete Vita-oriented asset ZIP, not just template.xml.
 * Frame liveitem positions are frame-relative and should be tested with the
 * selected real Vita layout; the editor cannot change fixed gate/frame slots.
 */
export async function buildLiveAreaPackage(layout, images, frameLayouts = {},
                                           { optimizeImages = true, warnings = [] } = {}) {
  const root = "sce_sys/livearea/contents/";
  const entries = [{ name: root + "template.xml", data: generateTemplate(layout, frameLayouts) }];
  await addImage(entries, root + "bg0.png", CARD.width, CARD.height,
    PALETTE[layout.cardColor].hex, images.card, false, false, optimizeImages, warnings);
  if (hasStartupGate(layout)) {
    await addImage(entries, root + "startup.png", 280, 158,
      PALETTE[layout.buttonColor].hex, images.gate, true, !images.gate,
      optimizeImages, warnings);
  }
  for (const item of allFrameLayouts(layout, frameLayouts)) {
    const key = frameKey(item.templateStyle, item.frameId);
    await addImage(entries, root + `frame${item.frameId}.png`, item.w, item.h,
      PALETTE[item.buttonColor].hex,
      images.frames?.[key] ?? (item.frameId === layout.frameId ? images.button : null),
      item.transparentButton, false, optimizeImages, warnings, item.frameId === 1);
  }
  if (images.icon) await addImage(entries, "sce_sys/icon0.png", 128, 128, "#000000",
    images.icon, false, false, optimizeImages, warnings);
  if (images.boot) await addImage(entries, "sce_sys/pic0.png", 960, 544, "#000000",
    images.boot, false, false, optimizeImages, warnings);
  for (const [i, page] of (images.manual || []).entries()) {
    await addImage(entries, `sce_sys/manual/${String(i + 1).padStart(3, "0")}.png`,
      960, 544, "#000000", page, false, false, optimizeImages, warnings);
  }
  return makeZip(entries);
}
