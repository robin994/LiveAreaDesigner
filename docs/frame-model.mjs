import { CARD, DEFAULT_LAYOUT, MIN_BUTTON_SIZE, normalizeLayout, clamp } from "./geometry.mjs?v=1.24";
import { getRcoLayout } from "./template-slots.mjs?v=1.24";

export function frameKey(style, frameId) {
  return `${style}:${frameId}`;
}

export function frameBounds(style, frameId) {
  const slot = getRcoLayout(style).frames[frameId - 1];
  if (!slot) return null;
  const [cx, cy, width, height] = slot;
  const w = width > 0 ? width : 120;
  const h = height > 0 ? height : 80;
  return { x: Math.round(CARD.width / 2 + cx - w / 2),
    y: Math.round(CARD.height / 2 - cy - h / 2), w, h,
    dynamic: width <= 0 || height <= 0 };
}

export function makeFrameLayout(style, frameId, base = DEFAULT_LAYOUT) {
  const bounds = frameBounds(style, frameId);
  if (!bounds) return null;
  const w = Math.max(MIN_BUTTON_SIZE, Math.min(bounds.w, DEFAULT_LAYOUT.w));
  const h = Math.max(MIN_BUTTON_SIZE, Math.min(bounds.h, DEFAULT_LAYOUT.h));
  return normalizeLayout({ ...DEFAULT_LAYOUT, cardColor: base.cardColor,
    templateStyle: style, frameId,
    x: bounds.x + Math.round((bounds.w - w) / 2),
    y: bounds.y + Math.round((bounds.h - h) / 2), w, h,
    frameTarget: "", frameText: "", frameLang: "", autoFlip: false, ageLimit: 0,
    vitaOnly: false });
}

/**
 * Resolve an independent liveitem for every native frame in a selected style.
 * Legacy 1.22 projects have only the active layout and are migrated lazily.
 */
export function frameLayoutFor(style, frameId, active, frames = {}) {
  const key = frameKey(style, frameId);
  const source = active?.templateStyle === style && active?.frameId === frameId
    ? active : frames[key];
  return normalizeLayout(source
    ? { ...source, templateStyle: style, frameId, cardColor: active?.cardColor ?? source.cardColor }
    : makeFrameLayout(style, frameId, active ?? DEFAULT_LAYOUT));
}

export function allFrameLayouts(active, frames = {}) {
  const style = active.templateStyle;
  return getRcoLayout(style).frames.map((_, i) => frameLayoutFor(style, i + 1, active, frames));
}

/** Interactive dragging/resizing of the selected liveitem, inside its fixed slot. */
export function clampLiveitemToFrame(layout) {
  const bounds = frameBounds(layout.templateStyle, layout.frameId);
  if (!bounds || bounds.dynamic) return normalizeLayout(layout);
  let w = clamp(layout.w, MIN_BUTTON_SIZE, Math.max(MIN_BUTTON_SIZE, bounds.w));
  let h = clamp(layout.h, MIN_BUTTON_SIZE, Math.max(MIN_BUTTON_SIZE, bounds.h));
  if (layout.lockAspect) {
    const ratio = layout.aspectRatio || w / h;
    if (w / h > ratio) w = Math.max(MIN_BUTTON_SIZE, Math.round(h * ratio));
    else h = Math.max(MIN_BUTTON_SIZE, Math.round(w / ratio));
    if (w > bounds.w) { w = bounds.w; h = Math.round(w / ratio); }
    if (h > bounds.h) { h = bounds.h; w = Math.round(h * ratio); }
  }
  return normalizeLayout({ ...layout, w, h,
    x: clamp(layout.x, bounds.x, bounds.x + bounds.w - w),
    y: clamp(layout.y, bounds.y, bounds.y + bounds.h - h) });
}
