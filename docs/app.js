import {
  SCREEN, CARD, RESERVED_TOP, PALETTE, DEFAULT_LAYOUT, centeredOffsets,
  normalizeLayout, offsets, buttonOnScreen, toCanvasPoint, hitTest,
  dragLayout, stepLayout
} from "./geometry.mjs";
import { generateTemplate } from "./template.mjs";
import { buildLiveAreaPackage } from "./package.mjs";
import { previewGate, previewSummary } from "./template-preview.mjs";

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
  mode: stored?.mode === "resize" ? "resize" : "move",
  guides: stored?.guides !== false,
  templatePreview: stored?.templatePreview === true,
  images: { card: null, button: null, gate: null, icon: null, boot: null, manual: [] },
  drag: null
};
let drawScheduled = false;
let toastTimeout = 0;

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
      templatePreview: state.templatePreview
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

function replaceImage(target, loaded) {
  const previous = state.images[target];
  state.images[target] = loaded;
  if (previous) URL.revokeObjectURL(previous.url);
  updateAssetUI(target);
  if (target === "button" && loaded?.image) {
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

async function chooseImage(target, file) {
  if (!file) return;
  let loaded;
  try {
    await validateFile(file);
    loaded = await imageDimensions(file, file.name);
    replaceImage(target, loaded);
    try {
      await assetOperation("put", target, { blob: file, name: file.name });
      status("Saved in this browser");
      notice(`${target === "card" ? "Card" : "Button"} image uploaded and saved locally.`);
    } catch {
      status("Image available for this session only", false);
      notice("Image loaded, but your browser could not save it for future visits.");
    }
  } catch (error) {
    if (loaded && state.images[target] !== loaded) URL.revokeObjectURL(loaded.url);
    notice(error.message || "Unable to load this image.");
  }
}

async function clearImage(target) {
  replaceImage(target, null);
  try {
    await assetOperation("delete", target);
    status("Saved in this browser");
    notice(`${target === "card" ? "Card" : "Button"} image removed.`);
  } catch {
    status("Local storage unavailable", false);
    notice("Image removed from the preview, but the saved copy could not be deleted.");
  }
}

async function restoreImages() {
  for (const target of ["card", "button", "gate", "icon", "boot"]) {
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
  const thumb = document.getElementById(`${target}-thumb`);
  const filename = document.getElementById(`${target}-filename`);
  const color = PALETTE[state.layout[target === "card" ? "cardColor" : "buttonColor"]].hex;
  thumb.style.backgroundColor = color;
  thumb.style.backgroundImage = image ? `url("${image.url}")` : "none";
  thumb.querySelector(".asset-thumb-icon").style.visibility = image ? "hidden" : "visible";
  filename.textContent = image ? image.name : "No image selected";
  filename.title = image ? image.name : "No image selected";
  document.getElementById(`${target}-clear`).disabled = !image;
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
  const center = centeredOffsets(layout);
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
  fields.x.min = String(Math.round(layout.w / 2 - CARD.width / 2));
  fields.x.max = String(Math.round(CARD.width / 2 - layout.w / 2));
  fields.y.min = String(Math.round(RESERVED_TOP + layout.h / 2 - CARD.height / 2));
  fields.y.max = String(Math.round(CARD.height / 2 - layout.h / 2));
  fields.w.max = String(CARD.width - layout.x);
  fields.h.max = String(CARD.height - layout.y);
  document.getElementById("lock-aspect").checked = layout.lockAspect;
  document.getElementById("transparent-button").checked = layout.transparentButton;
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
      `Style ${summary.style} · ${summary.frame} · ${summary.gateDescription}`;
  }
}

function scheduleDraw() {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => {
    drawScheduled = false;
    drawScene(ctx, { guides: state.guides, hud: true });
    updateInterface();
  });
}

function setLayout(next, persist = true) {
  state.layout = normalizeLayout(next);
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
  const gate = previewGate(layout);
  const frame = buttonOnScreen(layout);
  ctx2d.save();

  // The Vita reserves these slots. Their alignment is documented, but their
  // exact pixel offsets are not; this is an interactive structural preview.
  ctx2d.fillStyle = "#141e36ec";
  ctx2d.fillRect(CARD.x + 1, CARD.y + 1, CARD.width - 2, RESERVED_TOP - 1);
  ctx2d.font = '600 14px "Space Grotesk", sans-serif';
  ctx2d.textAlign = "left";
  ctx2d.textBaseline = "middle";
  ctx2d.fillStyle = "#e9e5fa";
  ctx2d.fillText("LIVEAREA", CARD.x + 17, CARD.y + RESERVED_TOP / 2);
  const buttons = [
    { name: "UPDATE", w: 91 },
    { name: "MANUAL", w: 94 }
  ];
  let right = CARD.x + CARD.width - 12;
  for (const button of buttons) {
    const x = right - button.w;
    roundedBox(ctx2d, x, CARD.y + 8, button.w, 27, 6);
    ctx2d.fillStyle = "#334663";
    ctx2d.fill();
    ctx2d.strokeStyle = "#778bb0";
    ctx2d.stroke();
    ctx2d.fillStyle = "#f4f2ff";
    ctx2d.textAlign = "center";
    ctx2d.font = '600 11px "Space Grotesk", sans-serif';
    ctx2d.fillText(button.name, x + button.w / 2, CARD.y + 21);
    right = x - 9;
  }

  ctx2d.fillStyle = "#12213ab5";
  roundedBox(ctx2d, gate.x - 5, gate.y - 5, gate.w + 10, gate.h + 38, 13);
  ctx2d.fill();
  ctx2d.strokeStyle = "#bfd0e28f";
  ctx2d.lineWidth = 1.5;
  ctx2d.stroke();
  if (state.images.gate?.image) {
    ctx2d.drawImage(state.images.gate.image, gate.x, gate.y, gate.w, gate.h);
  } else {
    const grad = ctx2d.createLinearGradient(gate.x, gate.y, gate.x, gate.y + gate.h);
    grad.addColorStop(0, "#585d87");
    grad.addColorStop(1, "#2b314f");
    ctx2d.fillStyle = grad;
    roundedBox(ctx2d, gate.x, gate.y, gate.w, gate.h, 8);
    ctx2d.fill();
    ctx2d.fillStyle = "#eeebff";
    ctx2d.font = '700 18px "Space Grotesk", sans-serif';
    ctx2d.textAlign = "center";
    ctx2d.fillText("STARTUP IMAGE", gate.x + gate.w / 2, gate.y + gate.h / 2);
  }
  roundedBox(ctx2d, gate.x + 54, gate.y + gate.h + 3, gate.w - 108, 24, 12);
  ctx2d.fillStyle = "#48a5ea";
  ctx2d.fill();
  ctx2d.fillStyle = "#fff";
  ctx2d.textAlign = "center";
  ctx2d.font = '700 12px "Space Grotesk", sans-serif';
  ctx2d.fillText("START", gate.x + gate.w / 2, gate.y + gate.h + 15);

  // The selected liveitem remains the draggable element in either mode.
  // Highlight overlapping content so it is clear why a system slot matters.
  const overlaps = frame.x < gate.x + gate.w && frame.x + frame.w > gate.x &&
    frame.y < gate.y + gate.h && frame.y + frame.h > gate.y;
  ctx2d.fillStyle = "#091326c7";
  roundedBox(ctx2d, CARD.x + 15, CARD.y + RESERVED_TOP + 11, 230, 24, 4);
  ctx2d.fill();
  ctx2d.font = '600 12px "Space Grotesk", sans-serif';
  ctx2d.textAlign = "left";
  ctx2d.fillStyle = "#d7f0ff";
  ctx2d.fillText(`STYLE: ${layout.templateStyle.toUpperCase()}  |  FRAME ${layout.frameId}`,
    CARD.x + 26, CARD.y + RESERVED_TOP + 23);
  if (overlaps) {
    ctx2d.fillStyle = "#ffe49f";
    ctx2d.font = '600 12px "Space Grotesk", sans-serif';
    ctx2d.fillText("GATE OVERLAP", CARD.x + 26, CARD.y + RESERVED_TOP + 45);
  }
  ctx2d.restore();
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

function drawScene(ctx2d, { guides = true, hud = true } = {}) {
  const layout = state.layout;
  const rect = buttonOnScreen(layout);
  ctx2d.clearRect(0, 0, SCREEN.width, SCREEN.height);
  drawBackdrop(ctx2d);

  ctx2d.fillStyle = PALETTE[layout.cardColor].hex;
  ctx2d.fillRect(CARD.x, CARD.y, CARD.width, CARD.height);

  if (state.images.card?.image) {
    ctx2d.drawImage(state.images.card.image, CARD.x, CARD.y, CARD.width, CARD.height);
  } else {
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

  if (!layout.transparentButton) {
    ctx2d.fillStyle = PALETTE[layout.buttonColor].hex;
    ctx2d.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  if (state.images.button?.image) {
    ctx2d.drawImage(state.images.button.image, rect.x, rect.y, rect.w, rect.h);
  } else {
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
  ctx2d.strokeStyle = "#ffffffed";
  ctx2d.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

  if (state.templatePreview) drawLiveitemLabels(ctx2d, layout, rect);

  if (guides || state.templatePreview) {
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
  downloadBlob(new Blob([generateTemplate(state.layout)], { type: "application/xml;charset=utf-8" }), "template.xml");
  notice("template.xml downloaded. Export the ZIP for its referenced assets.");
}

async function downloadPackage() {
  const buttons = [elements.package, document.getElementById("download-package-side")];
  for (const button of buttons) button.disabled = true;
  try {
    const pack = await buildLiveAreaPackage(state.layout, state.images);
    downloadBlob(pack, "LiveAreaDesigner-assets.zip");
    notice("LiveArea ZIP exported with indexed PNGs and template.xml.");
  } catch (error) {
    notice(error.message || "Unable to export LiveArea assets.");
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

async function copyCoordinates() {
  const { w, h } = state.layout;
  const { x, y } = centeredOffsets(state.layout);
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
  elements.move.addEventListener("click", () => setMode("move"));
  elements.resize.addEventListener("click", () => setMode("resize"));
  elements.guides.addEventListener("click", () => {
    state.guides = !state.guides;
    savePreferences();
    scheduleDraw();
  });
  elements.templatePreview.addEventListener("click", () => {
    setTemplatePreview(!state.templatePreview);
  });
  elements.export.addEventListener("click", downloadImage);
  elements.package = document.getElementById("download-package");
  document.getElementById("download-template").addEventListener("click", downloadTemplate);
  elements.package.addEventListener("click", downloadPackage);
  document.getElementById("download-package-side").addEventListener("click", downloadPackage);
  elements.copy.addEventListener("click", copyCoordinates);
  elements.reset.addEventListener("click", () => {
    const { cardColor, buttonColor } = state.layout;
    setLayout({ ...DEFAULT_LAYOUT, cardColor, buttonColor });
    notice("Position and dimensions reset.");
  });

  const editGeometry = (key, raw) => {
    const number = Number(raw);
    if (!Number.isFinite(number)) return;
    if (key === "x" || key === "y") {
      const position = key === "x"
        ? Math.round(number + CARD.width / 2 - state.layout.w / 2)
        : Math.round(number + CARD.height / 2 - state.layout.h / 2);
      setLayout({ ...state.layout, [key]: position });
    } else if (state.layout.lockAspect) {
      setLayout(dragLayout(state.layout, key === "w" ? number - state.layout.w : 0,
        key === "h" ? number - state.layout.h : 0, "resize"));
    } else {
      const next = { ...state.layout, [key]: number };
      setLayout(next);
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
      input.value = key === "x" || key === "y" ? centeredOffsets(state.layout)[key] : state.layout[key];
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
      canvas.style.cursor = action === "resize" ? "nwse-resize" : action === "move" ? "grab" : "default";
      return;
    }
    if (event.pointerId !== state.drag.pointerId) return;
    const { initial, origin, action } = state.drag;
    setLayout(dragLayout(initial, point.x - origin.x, point.y - origin.y, action), false);
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
      setLayout(stepLayout(state.layout, dx, dy, state.mode, event.shiftKey ? 10 : 1));
    }
  });
}

function bindAssets() {
  for (const target of ["card", "button", "gate", "icon", "boot"]) {
    const fileInput = document.getElementById(`${target}-file`);
    const dropzone = document.getElementById(`${target}-drop`);
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
