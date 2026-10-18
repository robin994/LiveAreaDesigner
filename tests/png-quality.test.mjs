import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { quantizeRgba } from "../docs/quantizer.mjs";
import { encodeIndexedPng, encodeVitaPng } from "../docs/package.mjs";

function readIndexedPng(png) {
  assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = new Map();
  let cursor = 8;
  while (cursor < png.length) {
    const length = view.getUint32(cursor);
    const tag = String.fromCharCode(...png.slice(cursor + 4, cursor + 8));
    const data = png.subarray(cursor + 8, cursor + 8 + length);
    chunks.set(tag, data);
    cursor += length + 12;
  }
  const ihdr = chunks.get("IHDR");
  const width = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength).getUint32(0);
  const height = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength).getUint32(4);
  assert.equal(ihdr[8], 8, "8-bit indexed pixels required on Vita");
  assert.equal(ihdr[9], 3, "PNG must be palette-indexed, not truecolor");
  assert.equal(ihdr[12], 0, "No Adam7 interlacing");
  const palette = chunks.get("PLTE");
  assert.ok(palette.length >= 3 && palette.length <= 768 && palette.length % 3 === 0);
  const raw = inflateSync(chunks.get("IDAT"));
  const indices = new Uint8Array(width * height);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const type = raw[at++];
    for (let x = 0; x < width; x++) {
      const delta = raw[at++];
      const p = y * width + x;
      const left = x ? indices[p - 1] : 0;
      const up = y ? indices[p - width] : 0;
      const upperLeft = x && y ? indices[p - width - 1] : 0;
      let prediction = 0;
      if (type === 1) prediction = left;
      else if (type === 2) prediction = up;
      else if (type === 3) prediction = (left + up) >>> 1;
      else if (type === 4) {
        const paeth = left + up - upperLeft;
        const a = Math.abs(paeth - left), b = Math.abs(paeth - up);
        const c = Math.abs(paeth - upperLeft);
        prediction = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      } else assert.equal(type, 0);
      indices[p] = (delta + prediction) & 255;
    }
  }
  assert.equal(at, raw.length);
  return { width, height, palette, indices, alpha: chunks.get("tRNS") };
}

test("indexed encoder preserves up to 256 original colors without quantization errors", async () => {
  const colors = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    colors[i * 4] = i;
    colors[i * 4 + 1] = (i * 113) & 255;
    colors[i * 4 + 2] = (i * 79) & 255;
    colors[i * 4 + 3] = 255;
  }
  const png = await encodeIndexedPng(16, 16, colors);
  const decoded = readIndexedPng(png);
  assert.equal(decoded.palette.length / 3, 256);
  for (let i = 0; i < 256; i++) {
    const p = decoded.indices[i] * 3;
    assert.deepEqual(Array.from(decoded.palette.slice(p, p + 3)),
      Array.from(colors.slice(i * 4, i * 4 + 3)));
  }
});

test("startup alpha stays transparent and opaque source pixels retain their color", async () => {
  const rgba = Uint8Array.of(
    99, 188, 52, 255,
    44, 120, 230, 0,
    70, 130, 190, 255,
    40, 80, 110, 255
  );
  const decoded = readIndexedPng(await encodeIndexedPng(2, 2, rgba, true));
  assert.equal(decoded.alpha[0], 0);
  assert.equal(decoded.indices[1], 0);
  assert.equal(decoded.indices[0] > 0, true);
  assert.equal(decoded.palette[decoded.indices[0] * 3], 99);
});

test("adaptive 256-color quantizer improves three-channel gradients over fixed 7x8x4", () => {
  const width = 320, height = 240;
  const rgba = new Uint8Array(width * height * 4);
  let legacyError = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = Math.round(x * 255 / (width - 1));
      const g = Math.round((x + y) * 255 / (width + height - 2));
      const b = Math.round(y * 255 / (height - 1));
      rgba.set([r, g, b, 255], i);
      const old = [Math.round(r * 6 / 255) * 255 / 6,
        Math.round(g * 7 / 255) * 255 / 7,
        Math.round(b * 3 / 255) * 255 / 3];
      legacyError += 3 * (r - old[0]) ** 2 +
        4 * (g - old[1]) ** 2 + 2 * (b - old[2]) ** 2;
    }
  }
  const result = quantizeRgba(width, height, rgba);
  let adaptiveError = 0;
  for (let i = 0; i < result.indices.length; i++) {
    const q = result.indices[i] * 3, p = i * 4;
    adaptiveError += 3 * (rgba[p] - result.palette[q]) ** 2 +
      4 * (rgba[p + 1] - result.palette[q + 1]) ** 2 +
      2 * (rgba[p + 2] - result.palette[q + 2]) ** 2;
  }
  assert.equal(result.palette.length, 768);
  assert.ok(adaptiveError < .09 * legacyError,
    `Adaptive error ${(adaptiveError / legacyError).toFixed(3)} of old palette`);
});

test("reusing an image-specific palette changes only processing time, not colors", () => {
  const width = 160, height = 90;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = (x * 3 + y * 17) & 255;
      rgba[at + 1] = (x * 5 + y * 7) & 255;
      rgba[at + 2] = (x * 11 + y * 13) & 255;
      rgba[at + 3] = 255;
    }
  }
  const paletteCache = new Map();
  const options = { colors: 256, dither: 0.1, paletteCache };
  const first = quantizeRgba(width, height, rgba, false, options);
  const second = quantizeRgba(width, height, rgba, false, options);
  const withoutCache = quantizeRgba(width, height, rgba, false,
    { colors: 256, dither: 0.1 });
  assert.equal(paletteCache.size, 1);
  assert.deepEqual(second.palette, first.palette);
  assert.deepEqual(second.indices, first.indices);
  assert.deepEqual(second.indices, withoutCache.indices);
});

test("PNG8 compression settings affect byte size, not color quality", async () => {
  const width = 200, height = 160, rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < rgba.length; p += 4)
    rgba.set([35, 65, 135, 255], p);
  const optimized = readIndexedPng(await encodeIndexedPng(width, height, rgba, false, { optimize: true }));
  const basic = readIndexedPng(await encodeIndexedPng(width, height, rgba, false, { optimize: false }));
  assert.deepEqual(optimized.indices, basic.indices);
  assert.deepEqual(optimized.palette, basic.palette);
});

test("bg0 over 128 KiB retains all 256 original colors inside the firmware-observed size envelope", async () => {
  const width = 840, height = 500;
  const rgba = new Uint8Array(width * height * 4);
  let random = 0x7b57a341;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (y < 260) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
      }
      const index = y < 260 ? random >>> 24 : (x + y) & 255;
      rgba[i] = index;
      rgba[i + 1] = (index * 73) & 255;
      rgba[i + 2] = (index * 39) & 255;
      rgba[i + 3] = 255;
    }
  }
  const warnings = [];
  const result = await encodeVitaPng("sce_sys/livearea/contents/bg0.png", width, height,
    rgba, false, { warnings });
  assert.ok(result.length > 128 * 1024,
    "The test must exercise a legal bg0 larger than the old artificial limit");
  assert.ok(result.length <= 384 * 1024);
  const decoded = readIndexedPng(result);
  assert.equal(decoded.palette.length / 3, 256);
  for (let i = 0; i < width * height; i++) {
    const input = i * 4, output = decoded.indices[i] * 3;
    for (let channel = 0; channel < 3; channel++)
      assert.equal(decoded.palette[output + channel], rgba[input + channel]);
  }
  assert.deepEqual(warnings, [], "Do not discard color precision to meet 128 KiB");
});

test("pic0.png retains 256 palette slots for stricter Vita shell expectations", async () => {
  const width = 20, height = 20;
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < rgba.length; p += 4)
    rgba.set([30, 70, 110, 255], p);
  const png = await encodeVitaPng("sce_sys/pic0.png", width, height, rgba);
  const decoded = readIndexedPng(png);
  assert.equal(decoded.palette.length, 768);
  assert.deepEqual([...decoded.palette.slice(0, 3)], [30, 70, 110]);
});
