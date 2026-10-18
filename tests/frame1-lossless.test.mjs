import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodeTruecolorPng } from "../docs/package.mjs";

function decodeTruecolor(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let at = 8, compressed = [];
  let width, height, channels;
  while (at < bytes.length) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + size);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      assert.equal(bytes[at + 16], 8);
      channels = bytes[at + 17] === 6 ? 4 : 3;
      assert.equal(bytes[at + 17], channels === 4 ? 6 : 2);
      assert.equal(bytes[at + 20], 0); // non-interlaced
    }
    if (type === "IDAT") compressed.push(data);
    if (type === "PLTE") assert.fail("frame1 must not have a palette");
    at += size + 12;
    if (type === "IEND") break;
  }
  assert.equal(at, bytes.length);
  const raw = inflateSync(Buffer.concat(compressed));
  const pixels = new Uint8Array(width * height * channels);
  const stride = width * channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter >= 0 && filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x < channels ? 0 : pixels[index - channels];
      const up = y === 0 ? 0 : pixels[index - stride];
      const upperLeft = y === 0 || x < channels ? 0 :
        pixels[index - stride - channels];
      const paeth = (a, b, c) => {
        const p = a + b - c;
        const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
        return da <= db && da <= dc ? a : db <= dc ? b : c;
      };
      const predictor = filter === 0 ? 0 : filter === 1 ? left :
        filter === 2 ? up : filter === 3 ? (left + up) >>> 1 :
          paeth(left, up, upperLeft);
      pixels[index] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}

test("frame1 RGB PNG preserves more than 256 colors without quantization", async () => {
  const width = 73, height = 49;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    rgba[p] = (3 * x + 7 * y) & 255;
    rgba[p + 1] = (11 * x + y) & 255;
    rgba[p + 2] = (x + 13 * y) & 255;
    rgba[p + 3] = 255;
  }
  const png = decodeTruecolor(await encodeTruecolorPng(width, height, rgba));
  assert.equal(png.channels, 3);
  const expected = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++)
    expected.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  assert.deepEqual(png.pixels, expected);
  assert.ok(new Set(Array.from({ length: width * height },
    (_, i) => expected.subarray(i * 3, i * 3 + 3).join(","))).size > 256);
});

test("frame1 RGBA PNG preserves all 256 alpha levels including partial transparency", async () => {
  const width = 30, height = 27;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i * 47) & 255;
    rgba[i * 4 + 1] = (i * 17) & 255;
    rgba[i * 4 + 2] = (i * 3) & 255;
    rgba[i * 4 + 3] = i & 255;
  }
  const png = decodeTruecolor(await encodeTruecolorPng(width, height, rgba, true));
  assert.equal(png.channels, 4);
  assert.deepEqual(png.pixels, rgba);
});

test("lossless frame1 PNG encoder rejects mismatched image dimensions", async () => {
  await assert.rejects(encodeTruecolorPng(12, 15, new Uint8Array(10)),
    /Invalid frame1 RGBA image dimensions/);
});
