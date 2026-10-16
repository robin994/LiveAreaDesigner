import test from "node:test";
import assert from "node:assert/strict";
import {
  SCREEN, CARD, RESERVED_TOP, PALETTE, DEFAULT_LAYOUT, normalizeLayout,
  offsets, centeredOffsets, buttonOnScreen, toCanvasPoint, hitTest, dragLayout, stepLayout
} from "../docs/geometry.mjs";
import { generateTemplate } from "../docs/template.mjs";
import { makeZip } from "../docs/package.mjs";
import { previewGate, previewSummary } from "../docs/template-preview.mjs";

test("native PS Vita card and image sizes match the archived LiveArea guide", () => {
  assert.deepEqual(SCREEN, { width: 960, height: 544 });
  assert.deepEqual(CARD, { x: 60, y: 44, width: 840, height: 500 });
  assert.equal(RESERVED_TOP, 44);
  assert.equal(PALETTE.length, 10);
  assert.deepEqual(offsets(DEFAULT_LAYOUT), { left: 276, top: 112, right: 278, bottom: 220 });
  assert.deepEqual(centeredOffsets(DEFAULT_LAYOUT), { x: -1, y: -54 });
});

test("movement respects the system-reserved strip and card bounds", () => {
  const topLeft = dragLayout(DEFAULT_LAYOUT, -3000, -3000, "move");
  assert.deepEqual([topLeft.x, topLeft.y], [0, RESERVED_TOP]);
  const bottomRight = dragLayout(DEFAULT_LAYOUT, 5000, 5000, "move");
  assert.deepEqual([bottomRight.x, bottomRight.y], [554, 332]);
  assert.deepEqual([bottomRight.w, bottomRight.h], [286, 168]);
});

test("resize obeys min size and card boundaries", () => {
  const minimum = dragLayout(DEFAULT_LAYOUT, -500, -500, "resize");
  assert.deepEqual([minimum.w, minimum.h], [24, 24]);
  const maximum = dragLayout(DEFAULT_LAYOUT, 3000, 3000, "resize");
  assert.deepEqual([maximum.w, maximum.h], [564, 388]);
  assert.deepEqual(offsets(maximum), { left: 276, top: 112, right: 0, bottom: 0 });
});

test("fixed aspect resize preserves image ratio and fits inside card", () => {
  const locked = normalizeLayout({ ...DEFAULT_LAYOUT, lockAspect: true, aspectRatio: 2 });
  const next = dragLayout(locked, 150, 0, "resize");
  assert.equal(next.h, Math.round(next.w / 2));
  const limited = dragLayout(locked, 3000, 3000, "resize");
  assert.ok(limited.w <= CARD.width - locked.x);
  assert.ok(limited.h <= CARD.height - locked.y);
  assert.ok(Math.abs(limited.w / limited.h - 2) < .015);
});

test("normalization retains extra settings and clamps invalid values", () => {
  const input = normalizeLayout({
    x: Infinity, y: -44, w: 9999, h: 0, cardColor: -8, buttonColor: 300,
    frameId: 80, templateStyle: "invalid", aspectRatio: 0, ageLimit: 500
  });
  assert.deepEqual([input.x, input.y, input.w, input.h], [0, 44, 840, 24]);
  assert.equal(input.buttonColor, 9);
  assert.equal(input.frameId, 3);
  assert.equal(input.templateStyle, "a1");
  assert.equal(input.ageLimit, 18);
  assert.deepEqual(normalizeLayout({}), DEFAULT_LAYOUT);
});

test("pointer coordinates are scaled to the native canvas", () => {
  const bounds = {left: 50, top: 30, width: 480, height: 272};
  assert.deepEqual(toCanvasPoint(288, 166, bounds), {x: 476, y: 272});
  assert.deepEqual(buttonOnScreen(DEFAULT_LAYOUT), {x: 336, y: 156, w: 286, h: 168});
  assert.equal(hitTest(DEFAULT_LAYOUT, {x: 370, y: 180}), "move");
  assert.equal(hitTest(DEFAULT_LAYOUT, {x: 621, y: 323}), "resize");
  assert.equal(hitTest(DEFAULT_LAYOUT, {x: 50, y: 50}), null);
});

test("keyboard geometry uses selected mode and 10 pixel step", () => {
  const moved = stepLayout(DEFAULT_LAYOUT, -1, 1, "move", 10);
  assert.deepEqual([moved.x, moved.y], [266, 122]);
  const resized = stepLayout(DEFAULT_LAYOUT, 1, -1, "resize", 10);
  assert.deepEqual([resized.w, resized.h], [296, 158]);
});

test("template XML contains standard gate, frame, signed center offsets and escaped fields", () => {
  const xml = generateTemplate({
    ...DEFAULT_LAYOUT, frameTarget: "https://example.org?a=1&b=<x>",
    frameText: 'A <B> & "C"', frameLang: "en", vitaOnly: true, ageLimit: 3
  });
  assert.match(xml, /<livearea style="a1" format-ver="01.00" content-rev="1">/);
  assert.match(xml, /<image>bg0.png<\/image>/);
  assert.match(xml, /<startup-image>startup.png<\/startup-image>/);
  assert.match(xml, /<frame id="frame3" multi="o" autoflip="0" rev="1">/);
  assert.match(xml, /origin="frame" width="286" height="168" x="-1" y="-54"/);
  assert.match(xml, /https:\/\/example.org\?a=1&amp;b=&lt;x&gt;/);
  assert.match(xml, /<str size="22" color="#ffffff" bold="on">A &lt;B&gt; &amp; &quot;C&quot;<\/str>/);
  assert.match(xml, /<model>vita<\/model>/);
  assert.match(xml, /<lang>en<\/lang>/);
});

test("ZIP builder produces correct local and central directory signatures", async () => {
  const archive = makeZip([{name:"sce_sys/livearea/contents/template.xml",data:"<livearea/>"}]);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50,0x4b,3,4]);
  assert.deepEqual(Array.from(bytes.slice(-22,-18)), [0x50,0x4b,5,6]);
  assert.ok(bytes.length > 100);
  assert.throws(() => makeZip([{name:"../unsafe.xml",data:"a"}]), /Unsafe ZIP/);
});

test("template preview shows documented gate alignment without claiming exact slot coordinates", () => {
  const center = previewGate({ ...DEFAULT_LAYOUT, templateStyle: "a1" });
  assert.deepEqual(center, {
    x: 340, y: 215, w: 280, h: 158, alignment: "center", estimated: true
  });
  const right = previewGate({ ...DEFAULT_LAYOUT, templateStyle: "psmobile" });
  assert.deepEqual(right, {
    x: 596, y: 215, w: 280, h: 158, alignment: "right", estimated: true
  });
  const unknown = previewSummary({ ...DEFAULT_LAYOUT, templateStyle: "a3", frameId: 2 });
  assert.equal(unknown.frame, "frame2");
  assert.equal(unknown.gateDescription, "gate location unverified");
  assert.match(unknown.note, /Illustrative LiveArea preview/);
});
