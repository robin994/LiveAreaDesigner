import test from "node:test";
import assert from "node:assert/strict";
import {
  SCREEN, CARD, PALETTE, DEFAULT_LAYOUT, normalizeLayout,
  offsets, buttonOnScreen, toCanvasPoint, hitTest, dragLayout, stepLayout
} from "../docs/geometry.mjs";

test("native PS Vita geometry and preset colors match POC", () => {
  assert.deepEqual(SCREEN, { width: 960, height: 544 });
  assert.deepEqual(CARD, { x: 60, y: 44, width: 840, height: 480 });
  assert.deepEqual(DEFAULT_LAYOUT, {
    x: 276, y: 112, w: 286, h: 168, cardColor: 0, buttonColor: 1
  });
  assert.equal(PALETTE.length, 10);
  assert.equal(PALETTE[0].hex, "#71009e");
  assert.equal(PALETTE[1].hex, "#e014d0");
  assert.deepEqual(offsets(DEFAULT_LAYOUT), { left: 276, top: 112, right: 278, bottom: 200 });
});

test("movement stays inside the card", () => {
  const upperLeft = dragLayout(DEFAULT_LAYOUT, -2000, -2000, "move");
  assert.deepEqual([upperLeft.x, upperLeft.y], [0, 0]);
  const bottomRight = dragLayout(DEFAULT_LAYOUT, 5000, 5000, "move");
  assert.deepEqual([bottomRight.x, bottomRight.y], [554, 312]);
  assert.deepEqual([bottomRight.w, bottomRight.h], [286, 168]);
});

test("resizing is constrained by min size and card boundaries", () => {
  const minimum = dragLayout(DEFAULT_LAYOUT, -500, -500, "resize");
  assert.deepEqual([minimum.w, minimum.h], [24, 24]);
  const maximum = dragLayout(DEFAULT_LAYOUT, 3000, 3000, "resize");
  assert.deepEqual([maximum.w, maximum.h], [564, 368]);
  assert.deepEqual(offsets(maximum), { left: 276, top: 112, right: 0, bottom: 0 });
});

test("normalize layout handles invalid browser settings and fractions", () => {
  const normalized = normalizeLayout({
    x: Infinity, y: -44, w: 9999, h: 0, cardColor: -8, buttonColor: 300
  });
  assert.deepEqual(normalized, {
    x: 0, y: 0, w: 840, h: 24, cardColor: 0, buttonColor: 9
  });
  assert.deepEqual(normalizeLayout({x: 49.5, w: 199.6}).x, 50);
  assert.deepEqual(normalizeLayout({}), DEFAULT_LAYOUT);
});

test("pointer coordinates are mapped correctly from a CSS-scaled canvas", () => {
  const bounds = {left: 50, top: 30, width: 480, height: 272};
  assert.deepEqual(toCanvasPoint(288, 166, bounds), {x: 476, y: 272});
  assert.deepEqual(buttonOnScreen(DEFAULT_LAYOUT), {x: 336, y: 156, w: 286, h: 168});
});

test("hit testing finds button body and resize handle", () => {
  assert.equal(hitTest(DEFAULT_LAYOUT, {x: 370, y: 180}), "move");
  assert.equal(hitTest(DEFAULT_LAYOUT, {x: 621, y: 323}), "resize");
  assert.equal(hitTest(DEFAULT_LAYOUT, {x: 50, y: 50}), null);
});

test("keyboard fine and accelerated adjustments use selected mode", () => {
  const moved = stepLayout(DEFAULT_LAYOUT, -1, 1, "move", 10);
  assert.equal(moved.x, 266);
  assert.equal(moved.y, 122);
  const resized = stepLayout(DEFAULT_LAYOUT, 1, -1, "resize", 10);
  assert.equal(resized.w, 296);
  assert.equal(resized.h, 158);
  assert.equal(resized.x, 276);
});
