/**
 * Image-dependent PNG8 palette, with a bounded histogram and serpentine
 * error diffusion. Pure JS, offline and dependency-free (also runs in Node).
 *
 * Unlike the old 7x8x4 RGB cube this exactly preserves artwork with <=256
 * colors and distributes the full 256-color budget across the colors present.
 */
const BINS = 32768;
const MAX_COLORS = 256;
const channelKey = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
const score = (a, b, c, r, g, bl) =>
  3 * (a - r) ** 2 + 4 * (b - g) ** 2 + 2 * (c - bl) ** 2;

function stats(items) {
  let total = 0;
  let rSum = 0, gSum = 0, bSum = 0;
  for (const item of items) {
    total += item.count;
    rSum += item.r * item.count;
    gSum += item.g * item.count;
    bSum += item.b * item.count;
  }
  const r = rSum / total, g = gSum / total, b = bSum / total;
  const deviations = [0, 0, 0];
  for (const item of items) {
    deviations[0] += (item.r - r) ** 2 * item.count;
    deviations[1] += (item.g - g) ** 2 * item.count;
    deviations[2] += (item.b - b) ** 2 * item.count;
  }
  const weighted = [deviations[0] * 3, deviations[1] * 4, deviations[2] * 2];
  let axis = 0;
  if (weighted[1] > weighted[axis]) axis = 1;
  if (weighted[2] > weighted[axis]) axis = 2;
  return { items, total, r, g, b, axis,
    priority: items.length > 1 ? weighted[axis] / Math.sqrt(total) : -1 };
}

function choosePalette(bins, wanted) {
  const boxes = [stats(bins)];
  while (boxes.length < wanted) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++)
      if (boxes[i].priority > 0 && (best < 0 || boxes[i].priority > boxes[best].priority))
        best = i;
    if (best < 0) break;
    const box = boxes[best];
    const channel = ["r", "g", "b"][box.axis];
    const items = box.items.sort((a, b) => a[channel] - b[channel]);
    let running = 0, split = 0;
    while (split < items.length - 1 && running < box.total / 2)
      running += items[split++].count;
    if (!split) split = 1;
    boxes.splice(best, 1, stats(items.slice(0, split)), stats(items.slice(split)));
  }
  const palette = boxes.map(box => ({
    r: clampByte(box.r), g: clampByte(box.g), b: clampByte(box.b)
  }));
  // Two Lloyd steps are cheap on the small (at most 32k) histogram, and
  // improve palette quality without increasing the output color count.
  for (let iteration = 0; iteration < 2; iteration++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const bin of bins) {
      const k = nearest(bin.r, bin.g, bin.b, palette);
      const acc = sums[k];
      acc[0] += bin.r * bin.count;
      acc[1] += bin.g * bin.count;
      acc[2] += bin.b * bin.count;
      acc[3] += bin.count;
    }
    for (let k = 0; k < palette.length; k++) {
      if (!sums[k][3]) continue;
      palette[k] = {
        r: clampByte(sums[k][0] / sums[k][3]),
        g: clampByte(sums[k][1] / sums[k][3]),
        b: clampByte(sums[k][2] / sums[k][3])
      };
    }
  }
  return palette;
}

function nearest(r, g, b, palette) {
  let best = 0, bestDistance = Infinity;
  for (let j = 0; j < palette.length; j++) {
    const color = palette[j];
    const dist = score(r, g, b, color.r, color.g, color.b);
    if (dist < bestDistance) { bestDistance = dist; best = j; }
  }
  return best;
}

export function quantizeRgba(width, height, rgba, allowTransparency = false,
                             { colors = MAX_COLORS, dither = 0.45 } = {}) {
  if (!(Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 && rgba?.length === width * height * 4))
    throw new Error("Invalid RGBA image dimensions.");
  if (!Number.isInteger(colors) || colors < 2 || colors > MAX_COLORS)
    throw new Error("PNG8 palette must contain 2 to 256 colors.");

  const reserve = allowTransparency ? 1 : 0;
  const maxOpaque = colors - reserve;
  const exact = new Map();
  const counts = new Uint32Array(BINS);
  const redSums = new Uint32Array(BINS);
  const greenSums = new Uint32Array(BINS);
  const blueSums = new Uint32Array(BINS);
  let overflow = false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (allowTransparency && rgba[i + 3] < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = (r << 16) | (g << 8) | b;
    if (!overflow && !exact.has(key)) {
      if (exact.size < maxOpaque) exact.set(key, exact.size + reserve);
      else { exact.clear(); overflow = true; }
    }
    const bin = channelKey(r, g, b);
    counts[bin]++;
    redSums[bin] += r;
    greenSums[bin] += g;
    blueSums[bin] += b;
  }

  const indices = new Uint8Array(width * height);
  const colorsOut = [];
  if (reserve) colorsOut.push({ r: 0, g: 0, b: 0 });
  if (!overflow) {
    for (const key of exact.keys())
      colorsOut.push({ r: (key >>> 16) & 255, g: (key >>> 8) & 255, b: key & 255 });
    for (let i = 0; i < indices.length; i++) {
      const p = i * 4;
      if (reserve && rgba[p + 3] < 128) continue;
      indices[i] = exact.get((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
    }
  } else {
    const bins = [];
    for (let i = 0; i < BINS; i++)
      if (counts[i]) bins.push({
        count: counts[i], r: redSums[i] / counts[i],
        g: greenSums[i] / counts[i], b: blueSums[i] / counts[i]
      });
    const palette = choosePalette(bins, maxOpaque);
    colorsOut.push(...palette);
    const cache = new Int16Array(BINS).fill(-1);
    const lookup = (r, g, b) => {
      const key = channelKey(r, g, b);
      let index = cache[key];
      if (index === -1) {
        index = nearest(r, g, b, palette);
        cache[key] = index;
      }
      return index + reserve;
    };
    const diffusion = Math.max(0, Math.min(1, dither));
    if (!diffusion) {
      for (let i = 0; i < indices.length; i++) {
        const p = i * 4;
        if (reserve && rgba[p + 3] < 128) continue;
        indices[i] = lookup(rgba[p], rgba[p + 1], rgba[p + 2]);
      }
    } else {
      let current = new Float32Array((width + 2) * 3);
      let next = new Float32Array((width + 2) * 3);
      const add = (row, i, r, g, b, weight) => {
        if (i < 0 || i >= width) return;
        const pos = (i + 1) * 3;
        row[pos] += r * weight;
        row[pos + 1] += g * weight;
        row[pos + 2] += b * weight;
      };
      for (let y = 0; y < height; y++) {
        const forward = y % 2 === 0;
        for (let j = 0; j < width; j++) {
          const x = forward ? j : width - 1 - j;
          const p = (y * width + x) * 4;
          if (reserve && rgba[p + 3] < 128) continue;
          const at = (x + 1) * 3;
          const r = clampByte(rgba[p] + Math.max(-32, Math.min(32, current[at])));
          const g = clampByte(rgba[p + 1] + Math.max(-32, Math.min(32, current[at + 1])));
          const b = clampByte(rgba[p + 2] + Math.max(-32, Math.min(32, current[at + 2])));
          const idx = lookup(r, g, b);
          indices[y * width + x] = idx;
          const color = colorsOut[idx];
          const er = (r - color.r) * diffusion;
          const eg = (g - color.g) * diffusion;
          const eb = (b - color.b) * diffusion;
          const dir = forward ? 1 : -1;
          add(current, x + dir, er, eg, eb, 7 / 16);
          add(next, x - dir, er, eg, eb, 3 / 16);
          add(next, x, er, eg, eb, 5 / 16);
          add(next, x + dir, er, eg, eb, 1 / 16);
        }
        [current, next] = [next, current];
        next.fill(0);
      }
    }
  }
  if (!colorsOut.length) colorsOut.push({ r: 0, g: 0, b: 0 });
  const paletteBytes = new Uint8Array(colorsOut.length * 3);
  for (let i = 0; i < colorsOut.length; i++) {
    paletteBytes[i * 3] = colorsOut[i].r;
    paletteBytes[i * 3 + 1] = colorsOut[i].g;
    paletteBytes[i * 3 + 2] = colorsOut[i].b;
  }
  return { indices, palette: paletteBytes,
    transparency: reserve ? Uint8Array.of(0) : null };
}
