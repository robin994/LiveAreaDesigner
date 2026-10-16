/**
 * Generate the browser/Vita layout tables from the same vetted RCO-derived
 * numeric data. No proprietary firmware files are copied into the project.
 *
 * node tools/generate-template-slots.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const source = JSON.parse(await readFile(resolve(root, "data/livearea-layouts.json"), "utf8"));
const styles = Object.keys(source.layouts);
const intro = "Auto-generated from data/livearea-layouts.json. Do not edit by hand.";

const js = [
  `// ${intro}`,
  "// Source: PS Vita RCOF layout_hint positions/sizes; all values are card-centered.",
  `export const RCO_LAYOUTS = Object.freeze(${JSON.stringify(source.layouts, null, 2)});`,
  `export const RCO_STYLE_NAMES = Object.freeze(${JSON.stringify(styles)});`,
  "export function getRcoLayout(style) {",
  "  return RCO_LAYOUTS[style] || RCO_LAYOUTS.a1;",
  "}",
  "export function frameCount(style) {",
  "  return getRcoLayout(style).frames.length;",
  "}",
  ""
].join("\n");
await writeFile(resolve(root, "docs/template-slots.mjs"), js, "utf8");

const header = `/* ${intro} */
#ifndef LAD_TEMPLATE_SLOTS_H
#define LAD_TEMPLATE_SLOTS_H

typedef struct {
    int center_x;  /* X is positive right from the card center. */
    int center_y;  /* Y is positive UP from the card center. */
    int width;
    int height;
} LadTemplateSlot;

typedef struct {
    const char *style;
    int has_gate;
    int gate_center_x;
    int gate_center_y;
    const LadTemplateSlot *frames;
    int frame_count;
} LadTemplateLayout;

const LadTemplateLayout *lad_template_layout(int style_index);
int lad_template_frame_count(int style_index);
const LadTemplateSlot *lad_template_frame(int style_index, int frame_id);
void lad_template_frame_offsets(int style_index, int frame_id,
                                int card_center_x, int card_center_y,
                                int *offset_x, int *offset_y);

#endif
`;
await writeFile(resolve(root, "src/template_slots.h"), header, "utf8");

const c = [
  `/* ${intro} */`,
  '#include "template_slots.h"',
  "",
  ...styles.flatMap((style, i) => {
    const frames = source.layouts[style].frames;
    const rows = frames.map(row => `    { ${row.join(", ")} }`);
    return [
      `static const LadTemplateSlot frames_${i}[] = {`,
      rows.join(",\n"),
      "};",
      ""
    ];
  }),
  "static const LadTemplateLayout layouts[] = {",
  ...styles.map((style, i) => {
    const layout = source.layouts[style];
    const gate = layout.gate ?? [0, 0];
    return `    { "${style}", ${layout.gate ? 1 : 0}, ${gate[0]}, ${gate[1]}, frames_${i}, ${layout.frames.length} },`;
  }),
  "};",
  "",
  "const LadTemplateLayout *lad_template_layout(int style_index) {",
  "    const int count = (int)(sizeof(layouts) / sizeof(layouts[0]));",
  "    if (style_index < 0 || style_index >= count) style_index = 0;",
  "    return &layouts[style_index];",
  "}",
  "",
  "int lad_template_frame_count(int style_index) {",
  "    return lad_template_layout(style_index)->frame_count;",
  "}",
  "",
  "const LadTemplateSlot *lad_template_frame(int style_index, int frame_id) {",
  "    const LadTemplateLayout *layout = lad_template_layout(style_index);",
  "    if (frame_id < 1 || frame_id > layout->frame_count) return 0;",
  "    return &layout->frames[frame_id - 1];",
  "}",
  "",
  "void lad_template_frame_offsets(int style_index, int frame_id,",
  "                                int card_center_x, int card_center_y,",
  "                                int *offset_x, int *offset_y) {",
  "    const LadTemplateSlot *frame = lad_template_frame(style_index, frame_id);",
  "    /* XML x/y are relative to the frame center, not the card center. */",
  "    *offset_x = card_center_x - (frame ? frame->center_x : 0);",
  "    *offset_y = card_center_y + (frame ? frame->center_y : 0);",
  "}",
  ""
].join("\n");
await writeFile(resolve(root, "src/template_slots.c"), c, "utf8");
console.log(`Generated browser and native tables for ${styles.length} LiveArea layouts`);
