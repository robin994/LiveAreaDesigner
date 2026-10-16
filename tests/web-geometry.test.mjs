import test from "node:test";
import assert from "node:assert/strict";
import {
  SCREEN, CARD, RESERVED_TOP, PALETTE, DEFAULT_LAYOUT, normalizeLayout,
  offsets, centeredOffsets, buttonOnScreen, toCanvasPoint, hitTest, dragLayout, stepLayout
} from "../docs/geometry.mjs";
import { generateTemplate } from "../docs/template.mjs";
import { makeZip } from "../docs/package.mjs";
import {
  previewGate, previewFrames, previewSummary, frameRelativeOffsets,
  imageFitsSelectedFrame, fitImageToSelectedFrame
} from "../docs/template-preview.mjs";
import { getRcoLayout, frameCount } from "../docs/template-slots.mjs";

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

test("template XML uses frame-relative offsets and escapes content", () => {
  const xml = generateTemplate({
    ...DEFAULT_LAYOUT, frameTarget: "https://example.org?a=1&b=<x>",
    frameText: 'A <B> & "C"', frameLang: "en", vitaOnly: true, ageLimit: 3
  });
  assert.match(xml, /<livearea style="a1" format-ver="01.00" content-rev="1">/);
  assert.match(xml, /<image>bg0.png<\/image>/);
  assert.match(xml, /<startup-image>startup.png<\/startup-image>/);
  assert.match(xml, /<frame id="frame3" multi="o" autoflip="0" rev="1">/);
  assert.match(xml, /origin="frame" width="286" height="168" x="-1" y="-225"/);
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

test("RCOF firmware gate positions are distinct and mapped with Y positive upward", () => {
  const center = previewGate({ ...DEFAULT_LAYOUT, templateStyle: "a1" });
  assert.deepEqual(center, {
    x: 340, y: 183, w: 280, h: 158, centerX: 480, centerY: 262,
    rcoX: 0, rcoY: 32, alignment: "center", estimated: false
  });
  const right = previewGate({ ...DEFAULT_LAYOUT, templateStyle: "psmobile" });
  assert.deepEqual(right, {
    x: 580, y: 199, w: 280, h: 158, centerX: 720, centerY: 278,
    rcoX: 240, rcoY: 16, alignment: "right", estimated: false
  });
  assert.equal(previewGate({ ...DEFAULT_LAYOUT, templateStyle: "ad0" }), null);
  const summary = previewSummary({ ...DEFAULT_LAYOUT, templateStyle: "a3", frameId: 2 });
  assert.equal(summary.frame, "frame2");
  assert.equal(summary.frameCount, 5);
  assert.equal(summary.frameSize, "260 × 200 px");
  assert.equal(summary.gateDescription, "center-aligned gate");
  assert.match(summary.note, /Native frame\/gate geometry extracted/);
});

test("RCO frame geometry varies across a1-a5, with the correct fixed slot count", () => {
  const expected = {
    a1: [[-290, 34, 260, 260], [290, 34, 260, 260], [0, -171, 840, 150]],
    a2: [[-290, -46, 260, 400], [290, -46, 260, 400], [0, -146, 320, 200]],
    a3: [[-290, 64, 260, 200], [290, 64, 260, 200], [-290, -141, 260, 210],
      [0, -141, 320, 210], [290, -141, 260, 210]],
    a4: [[-290, 64, 260, 200], [290, 64, 260, 200], [0, -71, 840, 70],
      [0, -141, 840, 70], [0, -211, 840, 70]],
    a5: [[-180, 128, 480, 68], [-180, 60, 480, 68], [-180, -8, 480, 68],
      [-180, -76, 480, 68], [-180, -144, 480, 68], [-180, -212, 480, 68],
      [240, -141, 360, 210]]
  };
  for (const [style, values] of Object.entries(expected)) {
    const model = getRcoLayout(style);
    assert.deepEqual(model.frames, values, style);
    assert.equal(frameCount(style), values.length);
    const rectangles = previewFrames({ ...DEFAULT_LAYOUT, templateStyle: style });
    assert.deepEqual([rectangles[0].centerX, rectangles[0].centerY],
      [480 + values[0][0], 294 - values[0][1]]);
    assert.equal(rectangles.length, values.length);
  }
});

test("frame-relative XML transforms, style-specific frame bounds, and Fit frame", () => {
  const a1 = { ...DEFAULT_LAYOUT, templateStyle: "a1", frameId: 3 };
  assert.deepEqual(frameRelativeOffsets(a1), { x: -1, y: -225 });
  assert.deepEqual(frameRelativeOffsets({ ...a1, frameId: 1 }), { x: 289, y: -20 });
  const a4 = { ...a1, templateStyle: "a4", frameId: 5 };
  assert.deepEqual(frameRelativeOffsets(a4), { x: -1, y: -265 });
  assert.equal(imageFitsSelectedFrame(a4), false);
  const resized = fitImageToSelectedFrame(a4);
  assert.equal(resized.frameId, 5);
  assert.equal(resized.h, 70);
  assert.ok(imageFitsSelectedFrame(resized));
  const xml = generateTemplate(resized);
  assert.match(xml, /style="a4"/);
  assert.match(xml, /id="frame5"/);
  assert.match(xml, /origin="frame" width="286" height="70" x="0" y="0"/);
  const a5 = normalizeLayout({ ...DEFAULT_LAYOUT, templateStyle: "a5", frameId: 99 });
  assert.equal(a5.frameId, 7);
  const ad0 = normalizeLayout({ ...DEFAULT_LAYOUT, templateStyle: "ad0", frameId: 99 });
  assert.equal(ad0.frameId, 1);
});
