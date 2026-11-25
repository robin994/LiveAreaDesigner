import {
  SCREEN, CARD, RESERVED_TOP, PALETTE, DEFAULT_LAYOUT, centeredOffsets,
  editorOffsets, cardPositionFromEditorOffsets,
  normalizeLayout, offsets, buttonOnScreen, toCanvasPoint, hitTest,
  dragLayout, stepLayout
} from "./geometry.mjs?v=1.33";
import { generateTemplate } from "./template.mjs?v=1.33";
import { buildLiveAreaPackage } from "./package.mjs?v=1.33.2";
import {
  previewGate, previewFrames, previewSummary, frameRelativeOffsets, hasStartupGate,
  imageFitsSelectedFrame, fitImageToSelectedFrame, selectedFrame
} from "./template-preview.mjs?v=1.33";
import {
  frameKey, frameLayoutFor, allFrameLayouts, clampLiveitemToFrame
} from "./frame-model.mjs?v=1.33";
import { readVpk, patchVpk } from "./vpk.mjs?v=1.33";
import { readVpkProject } from "./vpk-import.mjs?v=1.33";
import { getRcoLayout } from "./template-slots.mjs?v=1.33";

import { createArtworkEditor } from "./artwork-editor.mjs?v=1.33.2";
import { frameInProject, hasArtworkEdits, normalizeArtwork, paintArtwork, solidColor, tintedSource } from "./artwork.mjs?v=1.33.2";
import { drawBubble, drawHomePreview, drawScreenBackdrop } from "./presentation.mjs?v=1.33";

const PREFS_KEY = "livearea-designer-web-v1";
const ASSETS_DB = "livearea-designer-assets";
const ASSETS_STORE = "images";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2048;

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const elements = {
  move: document.getElementById("mode-move"),
  resize: document.getElementById("mode-resize"),
  guides: document.getElementById("toggle-guides"),
  templatePreview: document.getElementById("toggle-template-preview"),
  templatePreviewState: document.getElementById("template-preview-state"),
  templateDetails: document.getElementById("template-preview-details"),
  templateSummary: document.getElementById("template-preview-summary"),
  export: document.getElementById("export-preview"),
  copy: document.getElementById("copy-coordinates"),
  reset: document.getElementById("reset-geometry"),
  toast: document.getElementById("toast"),
  storage: document.getElementById("storage-status"),
  storageLight: document.querySelector(".storage-light")
};

const fields = Object.fromEntries(
  ["x", "y", "w", "h"].map(key => [key, document.getElementById(`input-${key}`)])
);

const stored = restorePreferences();
const state = {
  layout: normalizeLayout(stored?.layout ?? DEFAULT_LAYOUT),
  frameLayouts: stored?.frameLayouts && typeof stored.frameLayouts === "object"
    ? stored.frameLayouts : {},
  frameImageKeys: Array.isArray(stored?.frameImageKeys) ? stored.frameImageKeys : [],
  mode: stored?.mode === "resize" ? "resize" : "move",
  guides: stored?.guides !== false,
  invertX: stored?.invertX === true,
  invertY: stored?.invertY === true,
  optimizeImages: stored?.optimizeImages !== false,
  templatePreview: stored?.templatePreview === true,
  images: { card: null, button: null, frames: {}, gate: null, icon: null, boot: null, manual: [] },
  artworkEdits: Object.fromEntries(Object.entries(stored?.artworkEdits ?? {})
    .map(([key, value]) => [key, normalizeArtwork(value)])),
  importedFrameKeys: Array.isArray(stored?.importedFrameKeys) ? stored.importedFrameKeys : null,
  drag: null,
  vpk: null
};
const initialFrameKey = frameKey(state.layout.templateStyle, state.layout.frameId);
state.frameLayouts[initialFrameKey] = { ...state.layout };
state.images.button = null;
let drawScheduled = false;
let toastTimeout = 0;
const presentationScreen = document.getElementById("presentation-screen");
const presentationCanvas = document.getElementById("presentation-canvas");
const bubbleThumb = document.getElementById("bubble-thumb");
let presentationView = "editor";
let artworkEditor;

const artworkLabels = {
  card: "Card background", gate: "Gate startup image",
  icon: "Bubble icon", boot: "Bootscreen"
};

function artworkAsset(target, key = artworkKey(target)) {
  const { layout, images, artworkEdits } = state;
  const frame = target === "button";
  const item = frame && frameLayoutFor(layout.templateStyle, layout.frameId, layout, state.frameLayouts);
  const [width, height] = frame ? [item.w, item.h] : {
    card: [CARD.width, CARD.height], gate: [280, 158], icon: [128, 128], boot: [960, 544]
  }[target];
  const background = frame ? PALETTE[item.buttonColor].hex :
    target === "card" ? PALETTE[layout.cardColor].hex : "#000000";
  return { key, target, width, height, background, edit: artworkEdits[key],
    title: frame ? `Frame${item.frameId} artwork` : artworkLabels[target],
    source: frame ? images.frames[key] : images[target],
    transparent: target === "gate" || (frame && item.transparentButton) };
}

function artworkKey(target) {
  return target === "button" ? frameKey(state.layout.templateStyle, state.layout.frameId) : target;
}

function projectFrames() {
  return allFrameLayouts(state.layout, state.frameLayouts).filter(item => {
    const key = frameKey(item.templateStyle, item.frameId);
    return frameInProject(item, state.images.frames[key], state.artworkEdits[key], state.importedFrameKeys);
  });
}

function restorePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    return saved && typeof saved === "object" ? saved : null;
  } catch {
    return null;
  }
}

function status(message, ok = true) {
  elements.storage.textContent = message;
  elements.storageLight.style.background = ok ? "#7ee7b6" : "#f7c16a";
}

function savePreferences() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      layout: state.layout, mode: state.mode, guides: state.guides,
      invertX: state.invertX, invertY: state.invertY,
      templatePreview: state.templatePreview, optimizeImages: state.optimizeImages,
      frameLayouts: state.frameLayouts,
      frameImageKeys: state.frameImageKeys,
      artworkEdits: state.artworkEdits,
      importedFrameKeys: state.importedFrameKeys
    }));
    status("Saved in this browser");
  } catch {
    status("Local storage unavailable", false);
  }
}

function notice(text) {
  elements.toast.textContent = text;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove("visible"), 3600);
}

function openAssetDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(ASSETS_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSETS_STORE))
        request.result.createObjectStore(ASSETS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Storage database busy"));
  });
}

async function assetOperation(method, key, value = undefined) {
  const db = await openAssetDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSETS_STORE, method === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore(ASSETS_STORE);
      const request = method === "get"
        ? store.get(key)
        : method === "put"
          ? store.put(value, key)
          : store.delete(key);
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      tx.onerror = () => reject(tx.error || new Error("Storage error"));
    });
  } finally {
    db.close();
  }
}

function imageDimensions(file, name) {
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight ||
          image.naturalWidth > MAX_IMAGE_EDGE ||
          image.naturalHeight > MAX_IMAGE_EDGE) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Maximum image dimensions: 2048 × 2048 pixels."));
        return;
      }
      resolve({ image, url: objectUrl, blob: file, name });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read the PNG or JPG image."));
    };
    image.src = objectUrl;
  });
}

async function validateFile(file) {
  if (!file || file.size <= 0 || file.size > MAX_IMAGE_BYTES)
    throw new Error("The file must be 12 MiB or smaller.");
  if (!/\.(png|jpe?g)$/i.test(file.name))
    throw new Error("Only PNG, JPG, and JPEG files are supported.");

  // Check signatures instead of trusting the extension or the MIME type alone.
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((part, i) => bytes[i] === part);
  const jpeg = bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg)
    throw new Error("The file does not contain a valid PNG or JPG image.");
}

function replaceImage(target, loaded, forKey = frameKey(state.layout.templateStyle, state.layout.frameId)) {
  const previous = target === "button" ? state.images.frames[forKey] : state.images[target];
  if (target === "button") {
    if (loaded) state.images.frames[forKey] = loaded;
    else delete state.images.frames[forKey];
    if (forKey === frameKey(state.layout.templateStyle, state.layout.frameId))
      state.images.button = loaded;
  } else state.images[target] = loaded;
  if (previous) URL.revokeObjectURL(previous.url);
  if (target !== "button" || forKey === frameKey(state.layout.templateStyle, state.layout.frameId))
    updateAssetUI(target);
  if (target === "button" && loaded?.image &&
      forKey === frameKey(state.layout.templateStyle, state.layout.frameId)) {
    const ratio = loaded.image.naturalWidth / loaded.image.naturalHeight;
    if (state.layout.lockAspect) {
      const next = { ...state.layout, aspectRatio: ratio };
      setLayout(dragLayout(next, 0, Math.round(next.w / ratio) - next.h, "resize"));
    } else {
      setLayout({ ...state.layout, aspectRatio: ratio });
    }
  }
  scheduleDraw();
}

async function chooseImage(target, file, key = artworkKey(target)) {
  if (!file) return;
  let loaded;
  const forKey = key;
  try {
    await validateFile(file);
    loaded = await imageDimensions(file, file.name);
    delete state.artworkEdits[key];
    replaceImage(target, loaded, forKey);
    savePreferences();
    if (artworkEditor.isEditing(key)) artworkEditor.open(artworkAsset(target, key));
    try {
      const storageKey = target === "button" ? `frame:${forKey}` : target;
      await assetOperation("put", storageKey, { blob: file, name: file.name });
      if (target === "button" && !state.frameImageKeys.includes(forKey)) {
        state.frameImageKeys.push(forKey);
        savePreferences();
      }
      status("Saved in this browser");
      notice(`${target === "button" ? `Frame ${forKey}` : target} image uploaded and saved locally.`);
    } catch {
      status("Image available for this session only", false);
      notice("Image loaded, but your browser could not save it for future visits.");
    }
  } catch (error) {
    if (loaded && state.images[target] !== loaded) URL.revokeObjectURL(loaded.url);
    notice(error.message || "Unable to load this image.");
    return error;
  }
}

async function clearImage(target) {
  const forKey = frameKey(state.layout.templateStyle, state.layout.frameId);
  delete state.artworkEdits[artworkKey(target)];
  replaceImage(target, null, forKey);
  savePreferences();
  try {
    await assetOperation("delete", target === "button" ? `frame:${forKey}` : target);
    if (target === "button") {
      state.frameImageKeys = state.frameImageKeys.filter(key => key !== forKey);
      savePreferences();
    }
    status("Saved in this browser");
    notice(`${target === "card" ? "Card" : "Button"} image removed.`);
  } catch {
    status("Local storage unavailable", false);
    notice("Image removed from the preview, but the saved copy could not be deleted.");
  }
}

async function restoreImages() {
  for (const target of ["card", "gate", "icon", "boot"]) {
    try {
      const saved = await assetOperation("get", target);
      if (!saved?.blob || !saved.name) continue;
      await validateFile(new File([saved.blob], saved.name, { type: saved.blob.type }));
      const loaded = await imageDimensions(saved.blob, saved.name);
      replaceImage(target, loaded);
    } catch (error) {
      console.warn(`Saved ${target} image is unavailable:`, error);
    }
  }
  // Migrate the old single button image without deleting existing user data.
  for (const forKey of new Set([initialFrameKey, ...state.frameImageKeys])) {
    try {
      let saved = await assetOperation("get", `frame:${forKey}`);
      if (!saved && forKey === initialFrameKey) {
        saved = await assetOperation("get", "button");
        if (saved) {
          await assetOperation("put", `frame:${forKey}`, saved);
          if (!state.frameImageKeys.includes(forKey)) state.frameImageKeys.push(forKey);
        }
      }
      if (!saved?.blob) continue;
      const file = new File([saved.blob], saved.name, { type: saved.blob.type });
      await validateFile(file);
      const loaded = await imageDimensions(saved.blob, saved.name);
      replaceImage("button", loaded, forKey);
    } catch (error) {
      console.warn(`Could not restore frame ${forKey} image`, error);
    }
  }
  state.images.button = state.images.frames[frameKey(state.layout.templateStyle, state.layout.frameId)] || null;
  updateAssetUI("button");
  savePreferences();
  try {
    const items = await assetOperation("get", "manual");
    if (Array.isArray(items) && items.length <= 10) {
      const pages = [];
      for (const item of items) {
        await validateFile(new File([item.blob], item.name, { type: item.blob.type }));
        pages.push(await imageDimensions(item.blob, item.name));
      }
      state.images.manual = pages;
      updateManualCount();
    }
  } catch (error) {
    console.warn("Unable to restore saved manual pages:", error);
  }
}

function updateManualCount() {
  const pages = state.images.manual;
  document.getElementById("manual-count").textContent =
    pages.length ? `${pages.length} pages: ${pages.map(page => page.name).join(", ")}` : "No pages selected";
  document.getElementById("manual-clear").disabled = pages.length === 0;
}

async function selectManual(files) {
  const inputs = Array.from(files || []);
  if (inputs.length === 0) return;
  if (inputs.length > 10) { notice("Select up to 10 manual pages."); return; }
  const pages = [];
  try {
    for (const file of inputs) {
      await validateFile(file);
      pages.push(await imageDimensions(file, file.name));
    }
    pages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const old = state.images.manual;
    state.images.manual = pages;
    old.forEach(page => URL.revokeObjectURL(page.url));
    updateManualCount();
    await assetOperation("put", "manual", pages.map(page => ({ name: page.name, blob: page.blob })));
    notice(`${pages.length} manual pages saved.`);
  } catch (error) {
    if (state.images.manual !== pages) pages.forEach(page => URL.revokeObjectURL(page.url));
    notice(error.message || "Unable to import manual pages.");
  }
}

async function clearManual() {
  for (const page of state.images.manual) URL.revokeObjectURL(page.url);
  state.images.manual = [];
  updateManualCount();
  try { await assetOperation("delete", "manual"); } catch { status("Local storage unavailable", false); }
  notice("Manual pages removed.");
}

function updateAssetUI(target) {
  const image = state.images[target];
  const edit = state.artworkEdits[artworkKey(target)];
  const thumb = document.getElementById(`${target}-thumb`);
  const filename = document.getElementById(`${target}-filename`);
  if (target === "button") {
    document.getElementById("frame-image-label").textContent =
      `Frame${state.layout.frameId} image`;
    document.getElementById("frame-image-key").textContent =
      `${state.layout.templateStyle.toUpperCase()} / FRAME${state.layout.frameId}`;
  }
  const color = PALETTE[state.layout[target === "card" ? "cardColor" : "buttonColor"]].hex;
  const tinted = tintedSource(image, edit);
  let tintPreview = thumb.querySelector("canvas");
  if (tinted && !tintPreview) {
    tintPreview = document.createElement("canvas");
    tintPreview.width = tintPreview.height = 41;
    tintPreview.setAttribute("aria-hidden", "true");
    thumb.append(tintPreview);
  }
  if (tintPreview) {
    tintPreview.hidden = !tinted;
    if (tinted) {
      const context = tintPreview.getContext("2d");
      const { width, height } = artworkAsset(target);
      context.clearRect(0, 0, 41, 41);
      paintArtwork(context, image, edit, 0, 0, 41, 41, width, height);
    }
  }
  thumb.style.backgroundColor = tinted ? "var(--surface)" : edit?.solid ? solidColor(edit) : color;
  thumb.style.backgroundImage = image && !tinted ? `url("${image.url}")` : "none";
  thumb.querySelector(".asset-thumb-icon").hidden = Boolean(image || edit?.solid);
  filename.textContent = edit?.solid ? `${tinted ? "Tint" : "Solid color"} · ${solidColor(edit).toUpperCase()}` :
    image ? image.name + (hasArtworkEdits(edit) ? " · edited" : "") : "No image selected";
  filename.title = filename.textContent;
  document.getElementById(`${target}-clear`).disabled = !image && !edit?.solid;
}

function buildPalette(target) {
  const palette = document.getElementById(`${target}-palette`);
  for (const [index, color] of PALETTE.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.backgroundColor = color.hex;
    button.title = `${color.name} (${color.hex})`;
    button.setAttribute("aria-label", `Select ${color.name} for the ${target === "card" ? "card" : "button"}`);
    button.dataset.index = String(index);
    button.addEventListener("click", () => {
      setLayout({ ...state.layout, [target === "card" ? "cardColor" : "buttonColor"]: index });
    });
    palette.append(button);
  }
}

function updateInterface() {
  const layout = state.layout;
  const margin = offsets(layout);
  const center = editorOffsets(layout, state);
  const measures = {
    x: center.x, y: center.y, w: layout.w, h: layout.h,
    right: margin.right, bottom: margin.bottom
  };
  for (const [key, value] of Object.entries(measures)) {
    document.getElementById(`measure-${key}`).textContent = String(value);
  }
  document.getElementById("offset-right").textContent = String(margin.right);
  document.getElementById("offset-bottom").textContent = String(margin.bottom);
  for (const [key, input] of Object.entries(fields)) {
    if (document.activeElement !== input)
      input.value = key === "x" || key === "y" ? center[key] : layout[key];
  }
  for (const axis of ["x", "y"]) {
    const edge = axis === "x" ? CARD.width - layout.w : CARD.height - layout.h;
    const start = editorOffsets({ ...layout, [axis]: axis === "x" ? 0 : RESERVED_TOP }, state)[axis];
    const end = editorOffsets({ ...layout, [axis]: edge }, state)[axis];
    fields[axis].min = String(Math.min(start, end));
    fields[axis].max = String(Math.max(start, end));
  }
  fields.w.max = String(CARD.width - layout.x);
  fields.h.max = String(CARD.height - layout.y);
  document.getElementById("invert-x").checked = state.invertX;
  document.getElementById("invert-y").checked = state.invertY;
  document.getElementById("axis-x-direction").textContent = state.invertX ?
    "RIGHT − / LEFT +" : "RIGHT + / LEFT −";
  document.getElementById("axis-y-direction").textContent = state.invertY ?
    "UP − / DOWN +" : "UP + / DOWN −";
  fields.y.title = state.invertY ?
    "Y is negative upward and positive downward" :
    "Y is positive upward and negative downward";
  document.getElementById("lock-aspect").checked = layout.lockAspect;
  document.getElementById("transparent-button").checked = layout.transparentButton;
  const frameSelector = document.getElementById("xml-frame");
  const frameCount = previewFrames(layout).length;
  if (frameSelector.options.length !== frameCount) {
    const options = [];
    for (let id = 1; id <= frameCount; id++) {
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = `frame${id}`;
      options.push(option);
    }
    frameSelector.replaceChildren(...options);
  }
  for (const [id, value] of Object.entries({
    "xml-style": layout.templateStyle,
    "xml-frame": String(layout.frameId),
    "xml-target": layout.frameTarget,
    "xml-text": layout.frameText,
    "xml-lang": layout.frameLang,
    "xml-age": String(layout.ageLimit),
    "xml-vita-only": layout.vitaOnly,
    "xml-autoflip": layout.autoFlip
  })) {
    const element = document.getElementById(id);
    if (document.activeElement === element) continue;
    if (element.type === "checkbox") element.checked = value;
    else element.value = value;
  }

  for (const target of ["card", "button"]) {
    const index = layout[target === "card" ? "cardColor" : "buttonColor"];
    document.getElementById(`${target}-color-name`).textContent = PALETTE[index].name;
    document.querySelectorAll(`#${target}-palette .swatch`).forEach(button => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.index) === index));
    });
    updateAssetUI(target);
  }
  for (const target of ["gate", "icon", "boot"]) updateAssetUI(target);
  const noNativeGate = getRcoLayout(layout.templateStyle).gate === null;
  const activeGate = hasStartupGate(layout);
  document.getElementById("gate-override-option").hidden = !noNativeGate;
  document.getElementById("gate-override").checked = layout.includeGate;
  document.getElementById("gate-drop").hidden = !activeGate;
  document.getElementById("gate-unavailable").hidden = activeGate;
  document.getElementById("gate-image-label").textContent = noNativeGate ?
    "Gate startup image (manual / unverified)" : "Gate startup image (fixed)";
  document.getElementById("frame1-lossless-note").hidden = layout.frameId !== 1;

  elements.move.classList.toggle("is-active", state.mode === "move");
  elements.resize.classList.toggle("is-active", state.mode === "resize");
  elements.move.setAttribute("aria-pressed", String(state.mode === "move"));
  elements.resize.setAttribute("aria-pressed", String(state.mode === "resize"));
  elements.guides.classList.toggle("is-active", state.guides);
  elements.guides.setAttribute("aria-pressed", String(state.guides));
  elements.templatePreview.setAttribute("aria-pressed", String(state.templatePreview));
  elements.templatePreviewState.textContent = state.templatePreview ? "ON" : "OFF";
  elements.templateDetails.hidden = !state.templatePreview;
  if (state.templatePreview) {
    const summary = previewSummary(layout);
    elements.templateSummary.textContent =
      `Style ${summary.style} · ${summary.frame} / ${summary.frameCount} · ${summary.frameSize} · ${summary.gateDescription}`;
    const relative = frameRelativeOffsets(layout);
    document.getElementById("template-frame-offsets").textContent =
      `Native XML frame offsets: X ${relative.x} px · Y ${relative.y} px`;
    const fits = imageFitsSelectedFrame(layout);
    const frame = selectedFrame(layout);
    const warning = document.getElementById("template-fit-warning");
    warning.classList.toggle("is-warning", !fits);
    warning.textContent = frame?.dynamic ?
      "This system frame has dynamic dimensions; automatic fitting is unavailable." :
      fits ?
        "Image fits inside the selected firmware frame. Click another frame to select it; drag to adjust the liveitem." :
        "Image is outside or larger than the selected frame and may be clipped on Vita. Drag/resize it, or use Fit image to selected frame.";
    document.getElementById("fit-template-frame").disabled = !frame || frame.dynamic;
  }
}

function scheduleDraw() {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => {
    drawScheduled = false;
    if (presentationView === "editor") drawScene(ctx, { guides: state.guides, hud: true });
    else renderPresentation();
    updateInterface();
    updateBubbleThumb();
  });
}

function setLayout(next, persist = true) {
  const wanted = normalizeLayout(next);
  const before = frameKey(state.layout.templateStyle, state.layout.frameId);
  const after = frameKey(wanted.templateStyle, wanted.frameId);
  state.frameLayouts[before] = { ...state.layout };
  if (before !== after) {
    // Switching frames selects its own independent geometry, palette and XML
    // fields; changing styles never overwrites a different frame's data.
    const restored = frameLayoutFor(wanted.templateStyle, wanted.frameId,
      null, state.frameLayouts);
    state.layout = normalizeLayout({
      ...restored, cardColor: wanted.cardColor,
      templateStyle: wanted.templateStyle, frameId: wanted.frameId,
      // A gate belongs to the LiveArea style, not to the selected frame.
      includeGate: wanted.templateStyle === state.layout.templateStyle ?
        state.layout.includeGate : restored.includeGate
    });
    state.images.button = state.images.frames[after] || null;
  } else {
    state.layout = wanted;
  }
  state.frameLayouts[after] = { ...state.layout };
  if (before !== after) updateInterface();
  if (persist) savePreferences();
  scheduleDraw();
}

function setMode(mode) {
  state.mode = mode;
  savePreferences();
  scheduleDraw();
}

function setTemplatePreview(enabled) {
  state.templatePreview = enabled;
  savePreferences();
  scheduleDraw();
}

function roundedBox(ctx2d, x, y, w, h, radius = 6) {
  ctx2d.beginPath();
  ctx2d.roundRect(x, y, w, h, radius);
}

function measurementLabel(ctx2d, text, x, y) {
  ctx2d.save();
  ctx2d.font = '600 13px "Space Grotesk", sans-serif';
  const width = ctx2d.measureText(text).width + 18;
  roundedBox(ctx2d, x - width / 2, y - 12, width, 23, 5);
  ctx2d.fillStyle = "#222137e0";
  ctx2d.fill();
  ctx2d.strokeStyle = "#ffdf888f";
  ctx2d.lineWidth = 1;
  ctx2d.stroke();
  ctx2d.fillStyle = "#ffeb9f";
  ctx2d.textAlign = "center";
  ctx2d.textBaseline = "middle";
  ctx2d.fillText(text, x, y);
  ctx2d.restore();
}

function renderGuides(ctx2d, rect, layout) {
  const margin = offsets(layout);
  const midX = rect.x + rect.w / 2;
  const midY = rect.y + rect.h / 2;
  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.strokeStyle = "#ffe79bcc";
  ctx2d.lineWidth = 1.6;
  ctx2d.setLineDash([5, 5]);
  ctx2d.moveTo(CARD.x, midY);
  ctx2d.lineTo(rect.x, midY);
  ctx2d.moveTo(rect.x + rect.w, midY);
  ctx2d.lineTo(CARD.x + CARD.width, midY);
  ctx2d.moveTo(midX, CARD.y);
  ctx2d.lineTo(midX, rect.y);
  ctx2d.moveTo(midX, rect.y + rect.h);
  ctx2d.lineTo(midX, CARD.y + CARD.height);
  ctx2d.stroke();
  ctx2d.restore();
  ctx2d.strokeStyle = "#a0e7f68c";
  ctx2d.setLineDash([6, 6]);
  ctx2d.beginPath();
  ctx2d.moveTo(CARD.x + CARD.width / 2, CARD.y + RESERVED_TOP);
  ctx2d.lineTo(CARD.x + CARD.width / 2, CARD.y + CARD.height);
  ctx2d.moveTo(CARD.x, CARD.y + CARD.height / 2);
  ctx2d.lineTo(CARD.x + CARD.width, CARD.y + CARD.height / 2);
  ctx2d.stroke();
  ctx2d.setLineDash([]);

  if (margin.left >= 65) measurementLabel(ctx2d, `${margin.left} px`, CARD.x + margin.left / 2, midY);
  if (margin.right >= 65) measurementLabel(ctx2d, `${margin.right} px`, rect.x + rect.w + margin.right / 2, midY);
  if (margin.top >= 50) measurementLabel(ctx2d, `${margin.top} px`, midX, CARD.y + margin.top / 2);
  if (margin.bottom >= 50) measurementLabel(ctx2d, `${margin.bottom} px`, midX, rect.y + rect.h + margin.bottom / 2);
}

function drawBackdrop(ctx2d) {
  const gradient = ctx2d.createLinearGradient(0, 0, SCREEN.width, SCREEN.height);
  gradient.addColorStop(0, "#07142a");
  gradient.addColorStop(.55, "#152449");
  gradient.addColorStop(1, "#1f1b4a");
  ctx2d.fillStyle = gradient;
  ctx2d.fillRect(0, 0, SCREEN.width, SCREEN.height);

  const shine = ctx2d.createRadialGradient(800, 70, 30, 720, 120, 530);
  shine.addColorStop(0, "#7983c031");
  shine.addColorStop(1, "#00000000");
  ctx2d.fillStyle = shine;
  ctx2d.fillRect(0, 0, SCREEN.width, SCREEN.height);

  ctx2d.strokeStyle = "#c7d6ff0c";
  ctx2d.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    ctx2d.beginPath();
    ctx2d.arc(980, 520, 170 + i * 64, Math.PI * .94, Math.PI * 1.8);
    ctx2d.stroke();
  }
}

function drawTemplateElements(ctx2d, layout) {
  const frames = previewFrames(layout);
  ctx2d.save();

  // The slot centers and sizes are decoded from the Vita's actual RCO files.
  // Only shell artwork remains schematic; RCO does not supply that texture.
  ctx2d.fillStyle = "#141e36ec";
  ctx2d.fillRect(CARD.x + 1, CARD.y + 1, CARD.width - 2, RESERVED_TOP - 1);
  ctx2d.font = '600 12px "Space Grotesk", sans-serif';
  ctx2d.textAlign = "left";
  ctx2d.textBaseline = "middle";
  ctx2d.fillStyle = "#e9e5fa";
  ctx2d.fillText("LIVEAREA / NATIVE RCO FRAME GEOMETRY", CARD.x + 17, CARD.y + RESERVED_TOP / 2);
  ctx2d.textAlign = "right";
  ctx2d.fillStyle = "#9cc4ec";
  ctx2d.fillText(`${layout.templateStyle.toUpperCase()}  •  ${frames.length} FRAME SLOTS`,
    CARD.x + CARD.width - 16, CARD.y + RESERVED_TOP / 2);

  // All slots remain visible, including slots without XML content.
  // The active slot is highlighted; clicking another slot selects it.
  for (const slot of frames) {
    const active = slot.id === layout.frameId;
    const visual = slot.dynamic ?
      { x: slot.centerX - 32, y: slot.centerY - 15, w: 64, h: 30 } : slot;
    if (visual.w <= 0 || visual.h <= 0) continue;
    ctx2d.fillStyle = active ? "#e66cce4a" : "#0c2449ad";
    roundedBox(ctx2d, visual.x, visual.y, visual.w, visual.h, 5);
    ctx2d.fill();
    ctx2d.strokeStyle = active ? "#ffd369" : "#a9cce1e0";
    ctx2d.lineWidth = active ? 3.5 : 1.5;
    ctx2d.setLineDash(active ? [] : [7, 4]);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
    const name = `FRAME${slot.id}`;
    ctx2d.font = `700 ${visual.h < 65 ? 10 : 15}px "Space Grotesk", sans-serif`;
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.fillStyle = active ? "#fff2bc" : "#d4eaff";
    ctx2d.fillText(name, slot.centerX, slot.centerY - (visual.h > 60 ? 9 : 0),
      Math.max(32, visual.w - 10));
    if (visual.h > 60) {
      ctx2d.font = '500 11px "Space Grotesk", sans-serif';
      ctx2d.fillText(slot.dynamic ? "DYNAMIC" : `${slot.w} × ${slot.h}`,
        slot.centerX, slot.centerY + 13, Math.max(30, visual.w - 12));
    }
  }

  ctx2d.restore();
}

function drawGate(ctx2d, layout, clean) {
  const gate = previewGate(layout);
  if (!gate) return;
  const { x, y, w, h, estimated } = gate;
  if (clean) {
    ctx2d.save();
    ctx2d.shadowColor = "#071322b8";
    ctx2d.shadowBlur = 14;
    ctx2d.shadowOffsetY = 5;
    ctx2d.fillStyle = "#cbd6e4";
    roundedBox(ctx2d, x - 4, y - 4, w + 8, h + 8, 13);
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.shadowOffsetY = 0;
    roundedBox(ctx2d, x, y, w, h, 9);
    ctx2d.clip();
    ctx2d.fillStyle = "#172335";
    ctx2d.fillRect(x, y, w, h);
    paintArtwork(ctx2d, state.images.gate, state.artworkEdits.gate, x, y, w, h, 280, 158);
    const button = ctx2d.createLinearGradient(0, y + h - 32, 0, y + h);
    button.addColorStop(0, "#65aee2");
    button.addColorStop(1, "#1862a5");
    ctx2d.fillStyle = button;
    roundedBox(ctx2d, x + (w - 130) / 2, y + h - 35, 130, 28, 13);
    ctx2d.fill();
    ctx2d.fillStyle = "white";
    ctx2d.font = "600 17px system-ui, sans-serif";
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.fillText("Start", x + w / 2, y + h - 21);
    ctx2d.restore();
  } else {
    ctx2d.save();
    ctx2d.textBaseline = "middle";
    ctx2d.fillStyle = "#13223ce8";
    roundedBox(ctx2d, gate.x - 5, gate.y - 5, gate.w + 10, gate.h + 38, 13);
    ctx2d.fill();
    ctx2d.strokeStyle = gate.estimated ? "#ffca7dd9" : "#fff6dbd9";
    ctx2d.lineWidth = 2;
    if (gate.estimated) ctx2d.setLineDash([7, 5]);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
    if (!paintArtwork(ctx2d, state.images.gate, state.artworkEdits.gate, x, y, w, h, 280, 158)) {
      const grad = ctx2d.createLinearGradient(gate.x, gate.y, gate.x, gate.y + gate.h);
      grad.addColorStop(0, "#595e87");
      grad.addColorStop(1, "#2c3452");
      ctx2d.fillStyle = grad;
      roundedBox(ctx2d, gate.x, gate.y, gate.w, gate.h, 8);
      ctx2d.fill();
      ctx2d.fillStyle = "#eeebff";
      ctx2d.font = '700 18px "Space Grotesk", sans-serif';
      ctx2d.textAlign = "center";
      ctx2d.fillText(gate.estimated ? "MANUAL GATE (PREVIEW ONLY)" : "STARTUP IMAGE",
        gate.x + gate.w / 2, gate.y + gate.h / 2, gate.w - 12);
    }
    roundedBox(ctx2d, gate.x + 54, gate.y + gate.h + 3, gate.w - 108, 24, 12);
    ctx2d.fillStyle = "#48a5ea";
    ctx2d.fill();
    ctx2d.fillStyle = "#fff";
    ctx2d.textAlign = "center";
    ctx2d.font = '700 12px "Space Grotesk", sans-serif';
    ctx2d.fillText("START", gate.x + gate.w / 2, gate.y + gate.h + 15);
    ctx2d.restore();
  }
  if (estimated) {
    ctx2d.save();
    ctx2d.fillStyle = "#ffe2a1";
    ctx2d.font = "600 12px system-ui, sans-serif";
    ctx2d.textAlign = "center";
    ctx2d.fillText("Manual gate · estimated position", x + w / 2, y - 11);
    ctx2d.restore();
  }
}

function drawLiveitemLabels(ctx2d, layout, rect) {
  ctx2d.save();
  ctx2d.textBaseline = "middle";
  ctx2d.font = '700 12px "Space Grotesk", sans-serif';
  const title = `FRAME${layout.frameId} / EDITABLE LIVEITEM`;
  const width = ctx2d.measureText(title).width + 18;
  const labelY = Math.max(CARD.y + RESERVED_TOP + 2, rect.y - 22);
  ctx2d.fillStyle = "#12213ce8";
  roundedBox(ctx2d, rect.x, labelY, width, 19, 4);
  ctx2d.fill();
  ctx2d.fillStyle = "#dcf5ff";
  ctx2d.textAlign = "left";
  ctx2d.fillText(title, rect.x + 9, labelY + 10);
  if (layout.frameText.trim()) {
    ctx2d.textAlign = "center";
    ctx2d.fillStyle = "#fff";
    ctx2d.font = '600 16px "Space Grotesk", sans-serif';
    ctx2d.fillText(layout.frameText.slice(0, 36),
      rect.x + rect.w / 2, Math.min(CARD.y + CARD.height - 15, rect.y + rect.h + 16),
      Math.max(30, rect.w));
  }
  if (layout.frameTarget.trim()) {
    ctx2d.font = '600 10px "Space Grotesk", sans-serif';
    ctx2d.fillStyle = "#b9e3fd";
    ctx2d.textAlign = "left";
    ctx2d.fillText("LINK / TARGET", rect.x + 6,
      Math.min(CARD.y + CARD.height - 10, rect.y + rect.h + 33));
  }
  ctx2d.restore();
}

/** Draw each liveitem only within its corresponding firmware frame slot. */
function drawFrameLiveitems(ctx2d, layout, { clean = false, guides = true } = {}) {
  const slots = previewFrames(layout);
  for (const slot of slots) {
    const item = frameLayoutFor(layout.templateStyle, slot.id, layout, state.frameLayouts);
    const key = frameKey(layout.templateStyle, slot.id);
    const image = state.images.frames[key];
    const edit = state.artworkEdits[key];
    if (clean && !frameInProject(item, image, edit, state.importedFrameKeys)) continue;
    const rect = buttonOnScreen(item);
    const isSelected = slot.id === layout.frameId;
    const clip = slot.dynamic ?
      { x: slot.centerX - 32, y: slot.centerY - 15, w: 64, h: 30 } : slot;
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(clip.x, clip.y, clip.w, clip.h);
    ctx2d.clip();
    if (!item.transparentButton && !tintedSource(image, edit)) {
      ctx2d.globalAlpha = image || edit?.solid || clean ? 1 : .52;
      ctx2d.fillStyle = PALETTE[item.buttonColor].hex;
      ctx2d.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx2d.globalAlpha = 1;
    }
    if (!paintArtwork(ctx2d, image, edit, rect.x, rect.y, rect.w, rect.h) && !clean) {
      ctx2d.fillStyle = "#e8e5f4";
      ctx2d.font = '700 12px "Space Grotesk", sans-serif';
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText(`FRAME${slot.id} · UPLOAD IMAGE`,
        slot.centerX, slot.centerY, Math.max(30, clip.w - 10));
    }
    if (item.frameText?.trim()) {
      ctx2d.textAlign = "center";
      ctx2d.font = '600 14px "Space Grotesk", sans-serif';
      ctx2d.fillStyle = "#ffffff";
      ctx2d.shadowColor = "#0a133d";
      ctx2d.shadowBlur = 4;
      ctx2d.fillText(item.frameText.slice(0, 48),
        rect.x + rect.w / 2, Math.min(rect.y + rect.h - 8, clip.y + clip.h - 10),
        Math.max(30, rect.w - 8));
    }
    ctx2d.restore();

    // The slot is immutable. Editing handles belong to the selected item's
    // content and never imply that Sony's system frame itself can be moved.
    if (isSelected && guides && !clean) {
      ctx2d.save();
      ctx2d.strokeStyle = imageFitsSelectedFrame(item) ? "#ffd477" : "#ff988a";
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(clip.x + 1, clip.y + 1, clip.w - 2, clip.h - 2);
      ctx2d.strokeStyle = "#e8faed";
      ctx2d.setLineDash([4, 4]);
      ctx2d.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx2d.setLineDash([]);
      const handleX = rect.x + rect.w - 10;
      const handleY = rect.y + rect.h - 10;
      ctx2d.fillStyle = "#f9d36c";
      roundedBox(ctx2d, handleX, handleY, 20, 20, 4);
      ctx2d.fill();
      ctx2d.strokeStyle = "#553b18";
      ctx2d.stroke();
      ctx2d.restore();
    }
  }
}

function drawScene(ctx2d, { guides = true, hud = true } = {}) {
  const layout = state.layout;
  const rect = buttonOnScreen(layout);
  ctx2d.clearRect(0, 0, SCREEN.width, SCREEN.height);
  drawBackdrop(ctx2d);

  ctx2d.fillStyle = PALETTE[layout.cardColor].hex;
  ctx2d.fillRect(CARD.x, CARD.y, CARD.width, CARD.height);

  if (!paintArtwork(ctx2d, state.images.card, state.artworkEdits.card, CARD.x, CARD.y, CARD.width, CARD.height)) {
    // Light reflects from the empty sample card, keeping its exact preset color.
    const sheen = ctx2d.createLinearGradient(CARD.x, CARD.y, CARD.x + CARD.width, CARD.y + CARD.height);
    sheen.addColorStop(0, "#ffffff1f");
    sheen.addColorStop(.55, "#ffffff04");
    sheen.addColorStop(1, "#0a071a24");
    ctx2d.fillStyle = sheen;
    ctx2d.fillRect(CARD.x, CARD.y, CARD.width, CARD.height);
    ctx2d.font = '700 19px "Space Grotesk", sans-serif';
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "alphabetic";
    ctx2d.fillStyle = "#ffffffc4";
    ctx2d.fillText("LIVEAREA CARD", CARD.x + 28, CARD.y + 38);
    ctx2d.fillStyle = "#ffffff69";
    ctx2d.font = '500 13px "Space Grotesk", sans-serif';
    ctx2d.fillText("840 × 500 PX  /  CANVAS", CARD.x + 28, CARD.y + 60);
  }
  ctx2d.strokeStyle = "#ffffffa6";
  ctx2d.lineWidth = 2;
  ctx2d.strokeRect(CARD.x + 1, CARD.y + 1, CARD.width - 2, CARD.height - 2);

  // System update/manual controls occupy the top 44px of the card.
  if (!state.templatePreview && guides) {
    ctx2d.fillStyle = "#11182ab7";
    ctx2d.fillRect(CARD.x + 2, CARD.y + 2, CARD.width - 4, RESERVED_TOP - 2);
    ctx2d.fillStyle = "#e8e6f6";
    ctx2d.font = '600 12px "Space Grotesk", sans-serif';
    ctx2d.textAlign = "right";
    ctx2d.fillText("SYSTEM CONTROLS  /  44 PX RESERVED", CARD.x + CARD.width - 18, CARD.y + 25);
    ctx2d.strokeStyle = "#ffbd64a0";
    ctx2d.setLineDash([5, 4]);
    ctx2d.beginPath();
    ctx2d.moveTo(CARD.x, CARD.y + RESERVED_TOP);
    ctx2d.lineTo(CARD.x + CARD.width, CARD.y + RESERVED_TOP);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
  }

  if (state.templatePreview) drawTemplateElements(ctx2d, layout);
  if (guides && !state.templatePreview) renderGuides(ctx2d, rect, layout);

  if (state.templatePreview) {
    drawFrameLiveitems(ctx2d, layout, { guides });
    drawGate(ctx2d, layout, false);
  } else {
  if (!layout.transparentButton && !tintedSource(state.images.button, state.artworkEdits[artworkKey("button")])) {
    ctx2d.fillStyle = PALETTE[layout.buttonColor].hex;
    ctx2d.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  if (!paintArtwork(ctx2d, state.images.button, state.artworkEdits[artworkKey("button")],
    rect.x, rect.y, rect.w, rect.h)) {
    if (!layout.transparentButton) {
      ctx2d.fillStyle = "#ffffff13";
      ctx2d.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx2d.fillStyle = "#fff5ff";
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "alphabetic";
    ctx2d.font = '700 21px "Space Grotesk", sans-serif';
    ctx2d.fillText("BUTTON", rect.x + 18, rect.y + 35);
    ctx2d.font = '500 12px "Space Grotesk", sans-serif';
    ctx2d.fillStyle = "#ffffffb0";
    ctx2d.fillText(`${layout.w} × ${layout.h} px`, rect.x + 18, rect.y + 57);
  }
  ctx2d.lineWidth = 2;
  ctx2d.strokeStyle = state.templatePreview && !imageFitsSelectedFrame(layout) ?
    "#ff9585" : "#ffffffed";
  ctx2d.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

  if (guides) {
    const size = 20;
    const hx = rect.x + rect.w - size / 2;
    const hy = rect.y + rect.h - size / 2;
    roundedBox(ctx2d, hx, hy, size, size, 4);
    ctx2d.fillStyle = "#f9d36c";
    ctx2d.fill();
    ctx2d.strokeStyle = "#553b18";
    ctx2d.lineWidth = 1;
    ctx2d.stroke();
    ctx2d.strokeStyle = "#5d4218";
    ctx2d.beginPath();
    ctx2d.moveTo(hx + 6, hy + 14);
    ctx2d.lineTo(hx + 14, hy + 6);
    ctx2d.stroke();
  }
  }

  if (hud) {
    ctx2d.fillStyle = "#0c1227db";
    ctx2d.fillRect(0, 0, SCREEN.width, 31);
    ctx2d.fillRect(0, SCREEN.height - 27, SCREEN.width, 27);
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "middle";
    ctx2d.font = '600 13px "Space Grotesk", sans-serif';
    ctx2d.fillStyle = "#f6eeff";
    const center = centeredOffsets(layout);
    ctx2d.fillText(`X:${center.x}  Y:${center.y}  W:${layout.w}  H:${layout.h}  R:${offsets(layout).right}  B:${offsets(layout).bottom}`, 16, 16);
    ctx2d.font = '600 12px "Space Grotesk", sans-serif';
    ctx2d.fillStyle = "#ffd988";
    ctx2d.fillText(state.templatePreview ? "TEMPLATE PREVIEW" :
      state.mode === "move" ? "MODE: MOVE" : "MODE: RESIZE", 16, SCREEN.height - 13);
    ctx2d.fillStyle = "#c9d7eb";
    ctx2d.fillText("DRAG: MOVE / CORNER: RESIZE   ·   SHIFT + ARROWS: 10 PX", 160, SCREEN.height - 13);
    ctx2d.textAlign = "right";
    ctx2d.fillText("960 × 544", SCREEN.width - 15, 16);
  }
}

const iconTile = document.createElement("canvas");
iconTile.width = iconTile.height = 128;

function currentIconTile() {
  const { source, edit, background } = artworkAsset("icon");
  if (!source && !edit?.solid) return null;
  const context = iconTile.getContext("2d");
  context.clearRect(0, 0, 128, 128);
  if (!tintedSource(source, edit)) {
    context.fillStyle = background;
    context.fillRect(0, 0, 128, 128);
  }
  paintArtwork(context, source, edit, 0, 0, 128, 128);
  return iconTile;
}
function updateBubbleThumb() {
  const icon = currentIconTile();
  const context = bubbleThumb.getContext("2d");
  context.clearRect(0, 0, 48, 48);
  drawBubble(context, icon, 0, 0, 48);
}
function renderPresentation() {
  const context = presentationCanvas.getContext("2d");
  if (presentationView === "bubble") {
    const icon = currentIconTile();
    const title = state.vpk?.filename.replace(/\.vpk$/i, "") || "Home Bubble";
    drawHomePreview(context, icon, title);
    document.getElementById("presentation-empty").hidden = Boolean(icon);
    document.getElementById("presentation-export").disabled = !icon;
    return;
  }
  document.getElementById("presentation-empty").hidden = true;
  document.getElementById("presentation-export").disabled = false;
  drawScreenBackdrop(context);
  context.save();
  const right = CARD.x + CARD.width, bottom = CARD.y + CARD.height;
  const corner = 25;
  const traceCard = () => {
    context.beginPath();
    context.moveTo(CARD.x, CARD.y);
    context.lineTo(right - corner, CARD.y);
    context.lineTo(right, CARD.y + corner);
    context.lineTo(right, bottom);
    context.lineTo(CARD.x, bottom);
    context.closePath();
  };
  traceCard();
  context.clip();
  context.fillStyle = PALETTE[state.layout.cardColor].hex;
  context.fillRect(CARD.x, CARD.y, CARD.width, CARD.height);
  paintArtwork(context, state.images.card, state.artworkEdits.card,
    CARD.x, CARD.y, CARD.width, CARD.height);
  drawFrameLiveitems(context, state.layout, { clean: true });
  drawGate(context, state.layout, true);
  context.strokeStyle = "#b2c8e27c";
  context.lineWidth = 1.5;
  traceCard();
  context.stroke();
  context.fillStyle = "#c9e5f584";
  context.beginPath();
  context.moveTo(right - corner, CARD.y);
  context.lineTo(right - corner + 2, CARD.y + corner - 2);
  context.lineTo(right, CARD.y + corner);
  context.closePath();
  context.fill();
  context.restore();
}
function showPresentation(view) {
  presentationView = view;
  const editing = view === "editor";
  const bubble = view === "bubble";
  document.getElementById("editor-screen").hidden = !editing;
  presentationScreen.hidden = editing;
  for (const button of ["editor", "livearea", "bubble"])
    document.getElementById(`show-${button}`).setAttribute("aria-pressed", String(view === button));
  document.getElementById("presentation-title").textContent = bubble ? "Home Bubble" : "LiveArea View";
  document.getElementById("presentation-edit-icon").hidden = !bubble;
  if (editing) drawScene(ctx, { guides: state.guides, hud: true });
  else renderPresentation();
}

function savePresentation() {
  renderPresentation();
  const name = presentationView === "bubble" ? "vita-home-bubble.png" : "vita-livearea.png";
  presentationCanvas.toBlob(blob => {
    if (blob) downloadBlob(blob, name);
  }, "image/png");
}

function downloadImage() {
  const output = document.createElement("canvas");
  output.width = SCREEN.width;
  output.height = SCREEN.height;
  const context = output.getContext("2d");
  drawScene(context, { guides: false, hud: false });
  output.toBlob(blob => {
    if (!blob) { notice("Unable to export the preview."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "livearea-preview.png";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    notice("PNG preview exported.");
  }, "image/png");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function downloadTemplate() {
  downloadBlob(new Blob([generateTemplate(state.layout, state.frameLayouts, projectFrames())], { type: "application/xml;charset=utf-8" }), "template.xml");
  notice("template.xml downloaded. Export the ZIP for its referenced assets.");
}

function exportProject(warnings) {
  const { layout, images, frameLayouts, artworkEdits, importedFrameKeys, optimizeImages } = state;
  return buildLiveAreaPackage(layout, { ...images, frames: { ...images.frames } },
    { ...frameLayouts }, { optimizeImages, warnings, artworkEdits: { ...artworkEdits }, importedFrameKeys });
}

async function downloadPackage() {
  const buttons = [elements.package, document.getElementById("download-package-side")];
  for (const button of buttons) button.disabled = true;
  try {
    const warnings = [];
    const pack = await exportProject(warnings);
    downloadBlob(pack, "LiveAreaDesigner-assets.zip");
    notice(`LiveArea ZIP exported (${Math.round(pack.size / 1024)} KiB; lossless frame1 + optimized PNG8).` +
      (warnings.length ? ` Size-limit adjustment: ${warnings.join(" ")}` : ""));
  } catch (error) {
    notice(error.message || "Unable to export LiveArea assets.");
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

async function importExistingVpk(file) {
  if (!file) return;
  const open = document.getElementById("open-vpk");
  const save = document.getElementById("save-vpk");
  const statusLine = document.getElementById("vpk-status");
  open.disabled = save.disabled = true;
  statusLine.textContent = "Reading VPK and importing LiveArea assets…";
  const pendingUrls = [];
  try {
    const archive = await readVpk(file);
    const parsed = await readVpkProject(archive);
    const imported = new Map();
    for (const [key, original] of parsed.assets) {
      try {
        await validateFile(original);
        const loaded = await imageDimensions(original, original.name);
        loaded.fromVpkPath = parsed.paths.get(key) ||
          (key === "icon" ? "sce_sys/icon0.png" :
           key === "boot" ? "sce_sys/pic0.png" : null);
        pendingUrls.push(loaded.url);
        imported.set(key, loaded);
      } catch (error) {
        parsed.notes.push(`Cannot preview ${original.name}: ${error.message}`);
      }
    }
    // A new VPK is a new project. Clear stale per-project images before
    // persisting the new set, without touching the source VPK file itself.
    const oldKeys = [...state.frameImageKeys];
    for (const key of oldKeys) {
      try { await assetOperation("delete", `frame:${key}`); } catch { /* session remains editable */ }
    }
    for (const target of ["card", "gate", "icon", "boot", "manual", "button"]) {
      try { await assetOperation("delete", target); } catch { /* local cache optional */ }
    }
    for (const entry of [...Object.values(state.images.frames),
      state.images.card, state.images.gate, state.images.icon, state.images.boot,
      ...state.images.manual]) {
      if (entry?.url) URL.revokeObjectURL(entry.url);
    }
    state.images = { card: null, button: null, frames: {},
      gate: null, icon: null, boot: null, manual: [] };
    state.frameLayouts = parsed.frameLayouts;
    state.importedFrameKeys = parsed.importedFrameKeys;
    state.artworkEdits = {};
    state.layout = parsed.layout;
    state.frameImageKeys = [];
    state.templatePreview = true;
    for (const [key, loaded] of imported) {
      if (key.includes(":")) {
        state.images.frames[key] = loaded;
        state.frameImageKeys.push(key);
      } else {
        state.images[key] = loaded;
      }
      try {
        await assetOperation("put", key.includes(":") ? `frame:${key}` : key,
          { blob: loaded.blob, name: loaded.name });
      } catch {
        parsed.notes.push("Your browser did not persist all images for later visits.");
      }
    }
    state.images.button = state.images.frames[frameKey(state.layout.templateStyle,
      state.layout.frameId)] || null;
    state.vpk = archive; // Large binary is kept only for this page session.
    state.importedLayouts = Object.fromEntries(
      Object.entries(parsed.frameLayouts).map(([key, value]) => [key, { ...value }]));
    state.importedCardColor = parsed.layout.cardColor;
    savePreferences();
    updateManualCount();
    updateInterface(); // Do not report import complete with stale frame controls.
    scheduleDraw();
    save.disabled = false;
    const extra = parsed.notes.length ? ` ${parsed.notes[0]}` : "";
    statusLine.textContent = `${file.name} · ${archive.entries.length} files · ${parsed.frameLayouts
      ? Object.keys(parsed.frameLayouts).length : 0} editable frames. Original preserved.${extra}`;
    notice(`Imported ${file.name}. Select a frame and edit its images.`);
  } catch (error) {
    statusLine.textContent = `Import failed: ${error.message || "Unknown error"}`;
    for (const url of pendingUrls) URL.revokeObjectURL(url);
    save.disabled = !state.vpk;
    notice(error.message || "VPK import failed.");
  } finally {
    open.disabled = false;
  }
}

async function downloadModifiedVpk() {
  if (!state.vpk) return;
  const button = document.getElementById("save-vpk");
  const statusLine = document.getElementById("vpk-status");
  button.disabled = true;
  statusLine.textContent = "Preserving frame1 colors, optimizing other PNG8 images, and repacking VPK locally…";
  try {
    const warnings = [];
    const archive = state.vpk;
    const preserve = new Map();
    const root = "sce_sys/livearea/contents/";
    if (state.images.card?.fromVpkPath && !hasArtworkEdits(state.artworkEdits.card) &&
        state.layout.cardColor === state.importedCardColor)
      preserve.set(root + "bg0.png", state.images.card.fromVpkPath);
    if (hasStartupGate(state.layout) &&
        state.images.gate?.fromVpkPath && !hasArtworkEdits(state.artworkEdits.gate))
      preserve.set(root + "startup.png", state.images.gate.fromVpkPath);
    for (const item of allFrameLayouts(state.layout, state.frameLayouts)) {
      const key = frameKey(item.templateStyle, item.frameId);
      const imported = state.importedLayouts?.[key];
      const artwork = state.images.frames[key];
      if (artwork?.fromVpkPath && imported && !hasArtworkEdits(state.artworkEdits[key]) &&
          item.w === imported.w && item.h === imported.h &&
          item.buttonColor === imported.buttonColor &&
          item.transparentButton === imported.transparentButton)
        preserve.set(root + `frame${item.frameId}.png`, artwork.fromVpkPath);
    }
    if (state.images.icon?.fromVpkPath && !hasArtworkEdits(state.artworkEdits.icon))
      preserve.set("sce_sys/icon0.png", state.images.icon.fromVpkPath);
    if (state.images.boot?.fromVpkPath && !hasArtworkEdits(state.artworkEdits.boot))
      preserve.set("sce_sys/pic0.png", state.images.boot.fromVpkPath);
    const assets = await exportProject(warnings);
    const vpk = await patchVpk(archive, assets, { preserve });
    const basename = archive.filename.replace(/\.vpk$/i, "");
    downloadBlob(vpk, `${basename}-livearea.vpk`);
    statusLine.textContent = `${archive.filename} · Patched LiveArea assets. Modified VPK: ${(vpk.size / 1048576).toFixed(1)} MiB.` +
      (warnings.length ? ` Image-size adjustments: ${warnings.join(" ")}` : "");
    notice("Modified VPK exported. The original file was not changed.");
  } catch (error) {
    statusLine.textContent = `VPK export failed: ${error.message || "Unknown error"}`;
    notice(error.message || "Could not export the VPK.");
  } finally {
    button.disabled = false;
  }
}

async function copyCoordinates() {
  const { w, h } = state.layout;
  const { x, y } = editorOffsets(state.layout, state);
  const { right, bottom } = offsets(state.layout);
  const text = `X=${x}, Y=${y}, W=${w}, H=${h}, RIGHT=${right}, BOTTOM=${bottom}`;
  try {
    await navigator.clipboard.writeText(text);
    notice("Coordinates copied.");
  } catch {
    // Copy still works on some older browsers without the Clipboard API.
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const succeeded = document.execCommand("copy");
    textarea.remove();
    notice(succeeded ? "Coordinates copied." : "Clipboard access is unavailable in this browser.");
  }
}

function bindEditor() {
  for (const view of ["editor", "livearea", "bubble"])
    document.getElementById(`show-${view}`).addEventListener("click", () => showPresentation(view));
  document.getElementById("presentation-export").addEventListener("click", savePresentation);
  document.getElementById("presentation-edit-icon").addEventListener("click",
    () => artworkEditor.open(artworkAsset("icon")));
  elements.move.addEventListener("click", () => setMode("move"));
  elements.resize.addEventListener("click", () => setMode("resize"));
  elements.guides.addEventListener("click", () => {
    state.guides = !state.guides;
    savePreferences();
    scheduleDraw();
  });
  for (const axis of ["x", "y"]) {
    document.getElementById(`invert-${axis}`).addEventListener("change", event => {
      state[axis === "x" ? "invertX" : "invertY"] = event.target.checked;
      savePreferences();
      scheduleDraw();
    });
  }
  elements.templatePreview.addEventListener("click", () => {
    setTemplatePreview(!state.templatePreview);
  });
  document.getElementById("fit-template-frame").addEventListener("click", () => {
    setLayout(fitImageToSelectedFrame(state.layout));
    notice(`Image fitted into frame${state.layout.frameId}.`);
  });
  elements.export.addEventListener("click", downloadImage);
  elements.package = document.getElementById("download-package");
  document.getElementById("download-template").addEventListener("click", downloadTemplate);
  elements.package.addEventListener("click", downloadPackage);
  document.getElementById("download-package-side").addEventListener("click", downloadPackage);
  document.getElementById("optimize-png").checked = state.optimizeImages;
  document.getElementById("optimize-png").addEventListener("change", event => {
    state.optimizeImages = event.target.checked;
    savePreferences();
  });
  document.getElementById("gate-override").addEventListener("change", event => {
    setLayout({ ...state.layout, includeGate: event.target.checked });
    notice(event.target.checked ?
      "Manual gate enabled. Its placement in this style is unverified on Vita." :
      "Manual gate disabled; startup.png is omitted from export.");
  });
  const vpkInput = document.getElementById("vpk-file");
  document.getElementById("open-vpk").addEventListener("click", () => vpkInput.click());
  vpkInput.addEventListener("change", async () => {
    await importExistingVpk(vpkInput.files?.[0]);
    vpkInput.value = "";
  });
  document.getElementById("save-vpk").addEventListener("click", downloadModifiedVpk);
  elements.copy.addEventListener("click", copyCoordinates);
  elements.reset.addEventListener("click", () => {
    const { cardColor, buttonColor } = state.layout;
    setLayout({ ...DEFAULT_LAYOUT, cardColor, buttonColor });
    notice("Position and dimensions reset.");
  });

  const editGeometry = (key, raw) => {
    const number = Number(raw);
    if (!Number.isFinite(number)) return;
    const commitGeometry = next =>
      setLayout(state.templatePreview ? clampLiveitemToFrame(next) : next);
    if (key === "x" || key === "y") {
      const current = editorOffsets(state.layout, state);
      const position = cardPositionFromEditorOffsets(state.layout,
        key === "x" ? number : current.x,
        key === "y" ? number : current.y, state)[key];
      commitGeometry({ ...state.layout, [key]: position });
    } else if (state.layout.lockAspect) {
      commitGeometry(dragLayout(state.layout, key === "w" ? number - state.layout.w : 0,
        key === "h" ? number - state.layout.h : 0, "resize"));
    } else {
      const next = { ...state.layout, [key]: number };
      commitGeometry(next);
    }
  };
  for (const [key, input] of Object.entries(fields)) {
    input.addEventListener("input", () => {
      if (input.value.trim() === "") return;
      editGeometry(key, input.value);
    });
    input.addEventListener("change", () => {
      if (input.value.trim() !== "") {
        editGeometry(key, input.value);
      }
      input.value = key === "x" || key === "y" ? editorOffsets(state.layout, state)[key] : state.layout[key];
    });
  }
  document.getElementById("lock-aspect").addEventListener("change", event => {
    const ratio = state.images.button?.image
      ? state.images.button.image.naturalWidth / state.images.button.image.naturalHeight
      : state.layout.w / state.layout.h;
    setLayout({ ...state.layout, lockAspect: event.target.checked, aspectRatio: ratio });
  });
  document.getElementById("transparent-button").addEventListener("change", event => {
    setLayout({ ...state.layout, transparentButton: event.target.checked });
  });
  for (const [id, key] of Object.entries({
    "xml-style": "templateStyle",
    "xml-frame": "frameId",
    "xml-target": "frameTarget",
    "xml-text": "frameText",
    "xml-lang": "frameLang",
    "xml-age": "ageLimit",
    "xml-vita-only": "vitaOnly",
    "xml-autoflip": "autoFlip"
  })) {
    const input = document.getElementById(id);
    input.addEventListener(input.type === "text" ? "change" : "input", () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      setLayout({ ...state.layout, [key]: value });
    });
  }

  canvas.addEventListener("pointerdown", event => {
    if (state.drag || !event.isPrimary) return;
    const point = toCanvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
    if (state.templatePreview) {
      const frames = previewFrames(state.layout);
      // Prefer the currently selected frame where native slots overlap.
      const ordered = [frames[state.layout.frameId - 1], ...frames].filter(Boolean);
      const frame = ordered.find(slot =>
        point.x >= slot.x && point.x <= slot.x + slot.w &&
        point.y >= slot.y && point.y <= slot.y + slot.h
      );
      if (!frame) return;
      if (frame.id !== state.layout.frameId) {
        setLayout({ ...state.layout, frameId: frame.id });
        notice(`Editing frame${frame.id}. Load its own image or drag its liveitem.`);
        return;
      }
    }
    const action = hitTest(state.layout, point);
    if (!action) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    state.drag = { pointerId: event.pointerId, action, origin: point, initial: { ...state.layout } };
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointermove", event => {
    const point = toCanvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
    if (!state.drag) {
      const action = hitTest(state.layout, point);
      const frameHover = state.templatePreview &&
        previewFrames(state.layout).some(slot =>
          point.x >= slot.x && point.x <= slot.x + slot.w &&
          point.y >= slot.y && point.y <= slot.y + slot.h
        );
      canvas.style.cursor = action === "resize" ? "nwse-resize" :
        action === "move" ? "grab" : frameHover ? "pointer" : "default";
      return;
    }
    if (event.pointerId !== state.drag.pointerId) return;
    const { initial, origin, action } = state.drag;
    let updated = dragLayout(initial, point.x - origin.x, point.y - origin.y, action);
    if (state.templatePreview) updated = clampLiveitemToFrame(updated);
    setLayout(updated, false);
  });

  function releasePointer(event) {
    if (state.drag?.pointerId !== event.pointerId) return;
    state.drag = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    savePreferences();
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", event => {
    if (state.drag?.pointerId === event.pointerId) {
      state.drag = null;
      canvas.classList.remove("dragging");
      savePreferences();
    }
  });

  window.addEventListener("keydown", event => {
    if (presentationView !== "editor" || document.getElementById("artwork-dialog").hasAttribute("open")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key.toLowerCase() === "m") { setMode("move"); return; }
    if (event.key.toLowerCase() === "r") { setMode("resize"); return; }
    if (event.key.toLowerCase() === "p") { setTemplatePreview(!state.templatePreview); return; }
    let dx = 0, dy = 0;
    if (event.key === "ArrowLeft") dx = -1;
    if (event.key === "ArrowRight") dx = 1;
    if (event.key === "ArrowUp") dy = -1;
    if (event.key === "ArrowDown") dy = 1;
    if (dx || dy) {
      event.preventDefault();
      let updated = stepLayout(state.layout, dx, dy, state.mode, event.shiftKey ? 10 : 1);
      if (state.templatePreview) updated = clampLiveitemToFrame(updated);
      setLayout(updated);
    }
  });
}

function bindAssets() {
  artworkEditor = createArtworkEditor({
    onApply(asset, draft) {
      state.artworkEdits[asset.key] = draft;
      savePreferences();
      scheduleDraw();
    },
    async onUpload(asset, file) {
      const error = await chooseImage(asset.target, file, asset.key);
      if (error) throw error;
    }
  });
  for (const target of ["card", "button", "gate", "icon", "boot"]) {
    const fileInput = document.getElementById(`${target}-file`);
    const dropzone = document.getElementById(`${target}-drop`);
    document.getElementById(`${target}-edit`).addEventListener("click",
      () => artworkEditor.open(artworkAsset(target)));
    document.getElementById(`${target}-upload`).addEventListener("click", () => fileInput.click());
    document.getElementById(`${target}-clear`).addEventListener("click", () => clearImage(target));
    fileInput.addEventListener("change", async () => {
      await chooseImage(target, fileInput.files?.[0]);
      fileInput.value = "";
    });
    dropzone.addEventListener("dragover", event => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", event => {
      if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", event => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
      chooseImage(target, event.dataTransfer?.files?.[0]);
    });
    if (target === "card" || target === "button") buildPalette(target);
  }
  const manualFile = document.getElementById("manual-file");
  document.getElementById("manual-upload").addEventListener("click", () => manualFile.click());
  document.getElementById("manual-clear").addEventListener("click", clearManual);
  manualFile.addEventListener("change", () => {
    selectManual(manualFile.files);
    manualFile.value = "";
  });
  const dropzone = document.getElementById("manual-drop");
  dropzone.addEventListener("dragover", event => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  dropzone.addEventListener("drop", event => {
    event.preventDefault();
    selectManual(event.dataTransfer?.files);
  });
  updateManualCount();
}

if (ctx) {
  bindEditor();
  bindAssets();
  updateInterface();
  scheduleDraw();
  restoreImages();
} else {
  notice("Your browser does not support Canvas 2D.");
}

window.addEventListener("pagehide", () => {
  for (const target of ["card", "button", "gate", "icon", "boot"]) {
    const image = state.images[target];
    if (image) URL.revokeObjectURL(image.url);
  }
  for (const page of state.images.manual) URL.revokeObjectURL(page.url);
});
