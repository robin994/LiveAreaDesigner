import { centeredOffsets, normalizeLayout } from "./geometry.mjs";

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&apos;"
  })[char]);
}

/**
 * PS Vita's gate image belongs to a fixed layout-specific position.
 * A separately positioned image goes into a fixed LiveArea frame.
 * Frame coordinates are relative to that frame, NOT to the entire card;
 * whole-card centered positions in this editor are design estimates.
 */
export function generateTemplate(layoutInput) {
  const layout = normalizeLayout(layoutInput);
  const { x, y } = centeredOffsets(layout);
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<livearea style="${layout.templateStyle}" format-ver="01.00" content-rev="1">`,
    "  <livearea-background>",
    "    <image>bg0.png</image>",
    "  </livearea-background>",
    "  <gate>",
    "    <startup-image>startup.png</startup-image>",
    "  </gate>",
    `  <frame id="frame${layout.frameId}" multi="o" autoflip="${layout.autoFlip ? 1 : 0}" rev="1">`,
    '    <liveitem default="on">'
  ];
  if (layout.frameLang) xml.push(`      <lang>${layout.frameLang}</lang>`);
  if (layout.ageLimit > 0) xml.push(`      <age-limit>${layout.ageLimit}</age-limit>`);
  if (layout.vitaOnly) xml.push("      <model>vita</model>");
  xml.push(
    `      <image align="center" valign="center" origin="frame" width="${layout.w}" height="${layout.h}" x="${x}" y="${y}">button.png</image>`
  );
  if (layout.frameTarget.trim()) xml.push(`      <target>${escapeXml(layout.frameTarget.trim())}</target>`);
  if (layout.frameText.trim()) {
    xml.push(
      '      <text align="center" valign="bottom">',
      `        <str size="22" color="#ffffff" bold="on">${escapeXml(layout.frameText)}</str>`,
      "      </text>"
    );
  }
  xml.push("    </liveitem>", "  </frame>", "</livearea>", "");
  return xml.join("\n");
}
