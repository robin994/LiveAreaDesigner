import { normalizeLayout } from "./geometry.mjs?v=1.25";
import { frameRelativeOffsets } from "./template-preview.mjs?v=1.25";
import { allFrameLayouts } from "./frame-model.mjs?v=1.25";

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&apos;"
  })[char]);
}

/**
 * PS Vita's gate image belongs to a fixed layout-specific position.
 * A separately positioned image goes into a fixed LiveArea frame.
 * Frame coordinates are relative to the selected frame's center, NOT the
 * entire card. The centers and dimensions are sourced from the PS Vita
 * firmware's RCOF layout hints.
 */
export function generateTemplate(layoutInput, frameLayouts = {}) {
  const layout = normalizeLayout(layoutInput);
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<livearea style="${layout.templateStyle}" format-ver="01.00" content-rev="1">`,
    "  <livearea-background>",
    "    <image>bg0.png</image>",
    "  </livearea-background>",
    "  <gate>",
    "    <startup-image>startup.png</startup-image>",
    "  </gate>"
  ];
  for (const item of allFrameLayouts(layout, frameLayouts)) {
    const { x, y } = frameRelativeOffsets(item);
    xml.push(
      `  <frame id="frame${item.frameId}" multi="o" autoflip="${item.autoFlip ? 1 : 0}" rev="1">`,
      '    <liveitem default="on">'
    );
    if (item.frameLang) xml.push(`      <lang>${item.frameLang}</lang>`);
    if (item.ageLimit > 0) xml.push(`      <age-limit>${item.ageLimit}</age-limit>`);
    if (item.vitaOnly) xml.push("      <model>vita</model>");
    xml.push(
      `      <image align="center" valign="center" origin="frame" width="${item.w}" height="${item.h}" x="${x}" y="${y}">frame${item.frameId}.png</image>`
    );
    if (item.frameTarget.trim()) xml.push(`      <target>${escapeXml(item.frameTarget.trim())}</target>`);
    if (item.frameText.trim()) {
    xml.push(
      '      <text align="center" valign="bottom">',
      `        <str size="22" color="#ffffff" bold="on">${escapeXml(item.frameText)}</str>`,
      "      </text>"
    );
    }
    xml.push("    </liveitem>", "  </frame>");
  }
  xml.push("</livearea>", "");
  return xml.join("\n");
}
