import { CARD } from "./geometry.mjs";

export const GATE_WIDTH = 280;
export const GATE_HEIGHT = 158;

/**
 * Schematic gate placement. The public LiveArea documentation confirms only
 * centered alignment for a1 and right alignment for psmobile. Absolute slot
 * coordinates and frame positions are system-defined and NOT verified here.
 */
export function previewGate(layout) {
  const isRight = layout.templateStyle === "psmobile";
  return {
    x: CARD.x + (isRight ? CARD.width - GATE_WIDTH - 24 : Math.floor((CARD.width - GATE_WIDTH) / 2)),
    y: CARD.y + Math.floor((CARD.height - GATE_HEIGHT) / 2),
    w: GATE_WIDTH,
    h: GATE_HEIGHT,
    alignment: isRight ? "right" : layout.templateStyle === "a1" ? "center" : "unverified",
    estimated: true
  };
}

export function previewSummary(layout) {
  const gate = previewGate(layout);
  return {
    style: layout.templateStyle,
    frame: `frame${layout.frameId}`,
    gateDescription: gate.alignment === "unverified" ? "gate location unverified" :
      `${gate.alignment}-aligned gate`,
    note: "Illustrative LiveArea preview. System frame slots and gate offsets must be verified on a PS Vita."
  };
}
