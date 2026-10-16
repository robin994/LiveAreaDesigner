import { CARD, DEFAULT_LAYOUT, normalizeLayout } from "./geometry.mjs?v=1.24";
import { makeFrameLayout, frameKey } from "./frame-model.mjs?v=1.24";
import { RCO_LAYOUTS, getRcoLayout } from "./template-slots.mjs?v=1.24";
import { readArchiveEntry } from "./vpk.mjs?v=1.24";

const CONTENTS = "sce_sys/livearea/contents/";
const decode = new TextDecoder("utf-8", { fatal: true });
const IMAGE_FILE = /^[\w.-]+\.(png|jpe?g)$/i;

function assetPath(value) {
  const name = (value || "").trim();
  return IMAGE_FILE.test(name) && !name.startsWith(".") && !name.includes("..")
    ? CONTENTS + name : null;
}
function oneText(node, selector) {
  return node?.querySelector(selector)?.textContent?.trim() || "";
}
function coordinate(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * Read common Vita template.xml structures into editable individual frames.
 * External/doctypes and complex multi-liveitem templates are explicitly rejected
 * or reported as simplified; no text from the VPK is interpreted as HTML.
 */
export function parseVpkTemplate(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("External XML entities/DOCTYPE are unsupported.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("The VPK's template.xml is not valid XML.");
  const root = doc.documentElement;
  if (root?.localName !== "livearea")
    throw new Error("template.xml must contain a livearea root.");
  const style = root.getAttribute("style") || "a1";
  if (!Object.hasOwn(RCO_LAYOUTS, style)) {
    throw new Error(`Unsupported LiveArea style: ${style}`);
  }
  const slotLayout = getRcoLayout(style);
  if (!slotLayout) throw new Error("Unsupported template style.");
  const layouts = {};
  const paths = new Map();
  const notes = [];
  const langSource = root.querySelector("frame");
  const fallback = makeFrameLayout(style, 1, DEFAULT_LAYOUT);
  let selected = null;
  for (let i = 1; i <= slotLayout.frames.length; i++) {
    const id = i;
    const native = slotLayout.frames[i - 1];
    const sourceFrame = [...root.querySelectorAll("frame")].find(x => x.getAttribute("id") === `frame${id}`);
    const liveitems = sourceFrame ? [...sourceFrame.querySelectorAll("liveitem")] : [];
    if (liveitems.length > 1) notes.push(`frame${id} contains multiple liveitems; only the first is editable.`);
    const liveitem = liveitems[0];
    const img = liveitem?.querySelector("image");
    const prepared = makeFrameLayout(style, id, DEFAULT_LAYOUT);
    const width = coordinate(img?.getAttribute("width"), prepared.w);
    const height = coordinate(img?.getAttribute("height"), prepared.h);
    const x = coordinate(img?.getAttribute("x"), 0);
    const y = coordinate(img?.getAttribute("y"), 0);
    const [centerX, centerY] = native;
    const cardX = CARD.width / 2 + centerX + x - width / 2;
    const cardY = CARD.height / 2 - centerY + y - height / 2;
    const item = normalizeLayout({
      ...prepared,
      templateStyle: style, frameId: id,
      ...(img ? {
        x: Math.round(cardX), y: Math.round(cardY), w: width, h: height
      } : {}),
      frameTarget: oneText(liveitem, "target"),
      frameText: oneText(liveitem, "text str"),
      frameLang: oneText(liveitem, "lang"),
      ageLimit: coordinate(oneText(liveitem, "age-limit"), 0),
      vitaOnly: oneText(liveitem, "model") === "vita",
      autoFlip: sourceFrame?.getAttribute("autoflip") === "1"
    });
    layouts[frameKey(style, id)] = item;
    const path = assetPath(img?.textContent);
    if (path) paths.set(frameKey(style, id), path);
    if (liveitem && selected === null) selected = id;
  }
  if (!selected) selected = Math.min(3, slotLayout.frames.length);
  const bg = assetPath(oneText(root, "livearea-background image, background image"));
  const gate = assetPath(oneText(root, "gate startup-image"));
  if (bg) paths.set("card", bg);
  if (gate) paths.set("gate", gate);
  if (root.querySelectorAll("frame").length > slotLayout.frames.length)
    notes.push("Some frame ids are not supported by this firmware layout.");
  if (!langSource) notes.push("No editable frame definitions were found; default frames created.");
  return { layout: layouts[frameKey(style, selected)], frameLayouts: layouts,
    style, paths, notes };
}

export async function readVpkProject(archive) {
  const location = CONTENTS + "template.xml";
  const entry = archive.byName.get(location);
  if (!entry) throw new Error("This VPK has no LiveArea template.xml to edit.");
  const xml = decode.decode(await readArchiveEntry(archive, entry, 1024 * 1024));
  const parsed = parseVpkTemplate(xml);
  const assets = new Map();
  for (const [key, path] of parsed.paths) {
    if (!archive.byName.has(path)) {
      parsed.notes.push(`The original image ${path} is missing.`);
      continue;
    }
    try {
      const data = await readArchiveEntry(archive, path, 12 * 1024 * 1024);
      assets.set(key, new File([data], path.split("/").at(-1),
        { type: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png" }));
    } catch (error) {
      parsed.notes.push(`Unable to load ${path}: ${error.message}`);
    }
  }
  for (const [key, filename] of [["icon", "sce_sys/icon0.png"], ["boot", "sce_sys/pic0.png"]]) {
    if (!archive.byName.has(filename)) continue;
    try {
      const data = await readArchiveEntry(archive, filename, 12 * 1024 * 1024);
      assets.set(key, new File([data], filename.split("/").at(-1), { type: "image/png" }));
    } catch (error) {
      parsed.notes.push(`Unable to preview ${filename}: ${error.message}`);
    }
  }
  return { ...parsed, assets };
}
