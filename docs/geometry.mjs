export const SCREEN = Object.freeze({ width: 960, height: 544 });
export const CARD = Object.freeze({ x: 60, y: 44, width: 840, height: 480 });
export const MIN_BUTTON_SIZE = 24;

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
  buttonColor: 1
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
  const h = clamp(numberOr(input.h, DEFAULT_LAYOUT.h), MIN_BUTTON_SIZE, CARD.height);
  return {
    x: clamp(numberOr(input.x, DEFAULT_LAYOUT.x), 0, CARD.width - w),
    y: clamp(numberOr(input.y, DEFAULT_LAYOUT.y), 0, CARD.height - h),
    w,
    h,
    cardColor: clamp(numberOr(input.cardColor, DEFAULT_LAYOUT.cardColor), 0, PALETTE.length - 1),
    buttonColor: clamp(numberOr(input.buttonColor, DEFAULT_LAYOUT.buttonColor), 0, PALETTE.length - 1)
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
