import { frameCount } from "./template-slots.mjs?v=1.29";

export const SCREEN = Object.freeze({ width: 960, height: 544 });
export const CARD = Object.freeze({ x: 60, y: 44, width: 840, height: 500 });
export const MIN_BUTTON_SIZE = 24;
// The first 44 card pixels are occupied by native update/manual action controls.
export const RESERVED_TOP = 44;
export const DEFAULT_FRAME1_TARGET = "psla:eboot";
export const TEMPLATE_STYLES = Object.freeze([
  "a1", "a2", "a3", "a4", "a5", "ad0", "ad1", "ad2", "ad3", "ad4",
  "browser", "content_manager", "kids", "music", "nsx1", "ps1emu",
  "psmobile", "pspemu", "vd"
]);

export const PALETTE = Object.freeze([
  { name: "Purple", hex: "#71009e" },
  { name: "Magenta", hex: "#e014d0" },
  { name: "Blue", hex: "#206abe" },
  { name: "Cyan", hex: "#1aaddd" },
  { name: "Green", hex: "#1e9e69" },
  { name: "Yellow", hex: "#f7cb3a" },
  { name: "Orange", hex: "#f58f37" },
  { name: "Red", hex: "#d53c5a" },
  { name: "White", hex: "#e6e4f0" },
  { name: "Slate", hex: "#384155" }
]);

export const DEFAULT_LAYOUT = Object.freeze({
  x: 276,
  y: 112,
  w: 286,
  h: 168,
  cardColor: 0,
  buttonColor: 1,
  lockAspect: false,
  aspectRatio: 286 / 168,
  transparentButton: false,
  templateStyle: "a1",
  frameId: 3,
  frameTarget: "https://example.com",
  frameText: "",
  frameLang: "",
  ageLimit: 0,
  vitaOnly: false,
  autoFlip: false
});

function numberOr(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeLayout(input = {}) {
  const w = clamp(numberOr(input.w, DEFAULT_LAYOUT.w), MIN_BUTTON_SIZE, CARD.width);
  const h = clamp(numberOr(input.h, DEFAULT_LAYOUT.h), MIN_BUTTON_SIZE, CARD.height - RESERVED_TOP);
  const rawRatio = Number(input.aspectRatio);
  const aspectRatio = Number.isFinite(rawRatio) && rawRatio > 0
    ? clamp(rawRatio, .05, 20) : DEFAULT_LAYOUT.aspectRatio;
  const templateStyle = TEMPLATE_STYLES.includes(input.templateStyle)
    ? input.templateStyle : DEFAULT_LAYOUT.templateStyle;
  const frameLang = ["", "en", "ja", "fr", "es", "de", "it", "pt", "ko", "ru"].includes(input.frameLang)
    ? input.frameLang : "";
  return {
    x: clamp(numberOr(input.x, DEFAULT_LAYOUT.x), 0, CARD.width - w),
    y: clamp(numberOr(input.y, DEFAULT_LAYOUT.y), RESERVED_TOP, CARD.height - h),
    w,
    h,
    cardColor: clamp(numberOr(input.cardColor, DEFAULT_LAYOUT.cardColor), 0, PALETTE.length - 1),
    buttonColor: clamp(numberOr(input.buttonColor, DEFAULT_LAYOUT.buttonColor), 0, PALETTE.length - 1),
    lockAspect: input.lockAspect === true,
    aspectRatio,
    transparentButton: input.transparentButton === true,
    templateStyle,
    frameId: clamp(numberOr(input.frameId, DEFAULT_LAYOUT.frameId), 1, frameCount(templateStyle)),
    frameTarget: typeof input.frameTarget === "string" ? input.frameTarget.slice(0, 240) : DEFAULT_LAYOUT.frameTarget,
    frameText: typeof input.frameText === "string" ? input.frameText.slice(0, 160) : "",
    frameLang,
    ageLimit: clamp(numberOr(input.ageLimit, 0), 0, 18),
    vitaOnly: input.vitaOnly === true,
    autoFlip: input.autoFlip === true
  };
}

export function offsets(layout) {
  return {
    left: layout.x,
    top: layout.y,
    right: CARD.width - layout.x - layout.w,
    bottom: CARD.height - layout.y - layout.h
  };
}

export function buttonOnScreen(layout) {
  return {
    x: CARD.x + layout.x,
    y: CARD.y + layout.y,
    w: layout.w,
    h: layout.h
  };
}

// Center-origin coordinates: X increases right, Y increases UP (as in
// the Vita RCO layout hints). Stored x/y remain top-left screen pixels,
// so layouts saved by earlier releases retain their visual positions.
export function centeredOffsets(layout) {
  return {
    x: layout.x + Math.ceil(layout.w / 2) - CARD.width / 2,
    y: CARD.height / 2 - layout.y - Math.ceil(layout.h / 2)
  };
}

/** Editor-only sign convention. Source geometry and Vita XML stay canonical. */
export function editorOffsets(layout, { invertX = false, invertY = false } = {}) {
  const { x, y } = centeredOffsets(layout);
  return { x: invertX ? -x : x, y: invertY ? -y : y };
}

/** Exact integer inverse, including odd image widths/heights. */
export function cardPositionFromCenteredOffsets(layout, x, y) {
  return {
    x: Math.round(x) + CARD.width / 2 - Math.ceil(layout.w / 2),
    y: CARD.height / 2 - Math.ceil(layout.h / 2) - Math.round(y)
  };
}

export function cardPositionFromEditorOffsets(layout, x, y, { invertX = false, invertY = false } = {}) {
  return cardPositionFromCenteredOffsets(layout, invertX ? -x : x, invertY ? -y : y);
}

export function toCanvasPoint(clientX, clientY, bounds) {
  return {
    x: (clientX - bounds.left) * SCREEN.width / bounds.width,
    y: (clientY - bounds.top) * SCREEN.height / bounds.height
  };
}

export function hitTest(layout, point) {
  const rect = buttonOnScreen(layout);
  const onHandle =
    Math.abs(point.x - (rect.x + rect.w)) <= 24 &&
    Math.abs(point.y - (rect.y + rect.h)) <= 24;
  if (onHandle) return "resize";
  if (point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h) return "move";
  return null;
}

export function dragLayout(initial, deltaX, deltaY, action) {
  const dx = Math.round(deltaX);
  const dy = Math.round(deltaY);
  if (action === "resize") {
    if (initial.lockAspect) {
      const ratio = initial.aspectRatio;
      const maxWidth = Math.min(CARD.width - initial.x, Math.floor((CARD.height - initial.y) * ratio));
      const maxHeight = Math.min(CARD.height - initial.y, Math.floor((CARD.width - initial.x) / ratio));
      let w = Math.max(MIN_BUTTON_SIZE, initial.w + dx);
      let h = Math.max(MIN_BUTTON_SIZE, initial.h + dy);
      if (Math.abs(dx / Math.max(1, initial.w)) >= Math.abs(dy / Math.max(1, initial.h))) h = Math.round(w / ratio);
      else w = Math.round(h * ratio);
      w = clamp(w, MIN_BUTTON_SIZE, Math.max(MIN_BUTTON_SIZE, maxWidth));
      h = clamp(Math.round(w / ratio), MIN_BUTTON_SIZE, Math.max(MIN_BUTTON_SIZE, maxHeight));
      w = clamp(Math.round(h * ratio), MIN_BUTTON_SIZE, Math.max(MIN_BUTTON_SIZE, maxWidth));
      return normalizeLayout({ ...initial, w, h });
    }
    return normalizeLayout({
      ...initial,
      w: clamp(initial.w + dx, MIN_BUTTON_SIZE, CARD.width - initial.x),
      h: clamp(initial.h + dy, MIN_BUTTON_SIZE, CARD.height - initial.y)
    });
  }
  return normalizeLayout({
    ...initial,
    x: initial.x + dx,
    y: initial.y + dy
  });
}

export function stepLayout(initial, dx, dy, mode, step = 1) {
  return dragLayout(initial, dx * step, dy * step, mode);
}
