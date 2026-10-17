import { CARD, centeredOffsets, buttonOnScreen, normalizeLayout, MIN_BUTTON_SIZE } from "./geometry.mjs?v=1.28";
import { getRcoLayout } from "./template-slots.mjs?v=1.28";

export const GATE_WIDTH = 280;
export const GATE_HEIGHT = 158;

/** PS Vita RCOF layout_hint coordinates are card-centered: positive Y points up. */
export function previewFrames(layout) {
  const centerX = CARD.x + CARD.width / 2;
  const centerY = CARD.y + CARD.height / 2;
  return getRcoLayout(layout.templateStyle).frames.map(([cx, cy, w, h], i) => ({
    id: i + 1,
    centerX: centerX + cx,
    centerY: centerY - cy,
    x: Math.round(centerX + cx - w / 2),
    y: Math.round(centerY - cy - h / 2),
    w, h,
    rcoX: cx,
    rcoY: cy,
    dynamic: w <= 0 || h <= 0
  }));
}

export function previewGate(layout) {
  const [cx, cy] = getRcoLayout(layout.templateStyle).gate || [];
  if (cx === undefined) return null;
  const centerX = CARD.x + CARD.width / 2 + cx;
  const centerY = CARD.y + CARD.height / 2 - cy;
  return {
    x: Math.round(centerX - GATE_WIDTH / 2),
    y: Math.round(centerY - GATE_HEIGHT / 2),
    w: GATE_WIDTH,
    h: GATE_HEIGHT,
    centerX, centerY,
    rcoX: cx, rcoY: cy,
    estimated: false, // Gate center from system RCO; shell chrome is still stylized.
    alignment: cx > 100 ? "right" : cx < -100 ? "left" : "center"
  };
}

export function selectedFrame(layout) {
  return previewFrames(layout)[layout.frameId - 1] || null;
}

/** XML with origin="frame" needs offsets from the frame's center, NOT card center. */
export function frameRelativeOffsets(layout) {
  const frame = selectedFrame(layout);
  const centered = centeredOffsets(layout);
  return {
    x: centered.x - (frame?.rcoX ?? 0),
    y: centered.y - (frame?.rcoY ?? 0)
  };
}

export function imageFitsSelectedFrame(layout) {
  const frame = selectedFrame(layout);
  if (!frame || frame.dynamic) return false;
  const image = buttonOnScreen(layout);
  return image.x >= frame.x && image.y >= frame.y &&
    image.x + image.w <= frame.x + frame.w &&
    image.y + image.h <= frame.y + frame.h;
}

/** User-invoked action. Never silently destroy saved geometry on a style change. */
export function fitImageToSelectedFrame(layout) {
  const frame = selectedFrame(layout);
  if (!frame || frame.dynamic) return normalizeLayout(layout);
  const maxW = Math.min(CARD.width, frame.w);
  const maxH = Math.min(CARD.height - 44, frame.h);
  let w = Math.min(layout.w, maxW);
  let h = Math.min(layout.h, maxH);
  if (layout.lockAspect) {
    const ratio = layout.aspectRatio;
    w = Math.min(w, Math.floor(h * ratio));
    h = Math.round(w / ratio);
    if (h > maxH) { h = maxH; w = Math.round(h * ratio); }
  }
  w = Math.max(MIN_BUTTON_SIZE, w);
  h = Math.max(MIN_BUTTON_SIZE, h);
  const x = Math.round(frame.x + (frame.w - w) / 2 - CARD.x);
  const y = Math.round(frame.y + (frame.h - h) / 2 - CARD.y);
  return normalizeLayout({ ...layout, x, y, w, h });
}

export function previewSummary(layout) {
  const gate = previewGate(layout);
  const frames = previewFrames(layout);
  const selected = selectedFrame(layout);
  return {
    style: layout.templateStyle,
    frame: `frame${layout.frameId}`,
    frameCount: frames.length,
    frameSize: selected ? `${selected.w} × ${selected.h} px` : "not available",
    gateDescription: gate ? `${gate.alignment}-aligned gate` : "no gate slot in RCO",
    note: "Native frame/gate geometry extracted from PS Vita RCO layout hints. System graphics are illustrative."
  };
}
