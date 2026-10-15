import {
  SCREEN, CARD, PALETTE, DEFAULT_LAYOUT,
  normalizeLayout, offsets, buttonOnScreen, toCanvasPoint, hitTest,
  dragLayout, stepLayout
} from "./geometry.mjs";

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
  images: { card: null, button: null },
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
      layout: state.layout, mode: state.mode, guides: state.guides
    }));
    status("Salvato nel browser");
  } catch {
    status("Salvataggio non disponibile", false);
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
        reject(new Error("Dimensioni massime: 2048 × 2048 pixel."));
        return;
      }
      resolve({ image, url: objectUrl, blob: file, name });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Impossibile leggere l'immagine PNG/JPG."));
    };
    image.src = objectUrl;
  });
}

async function validateFile(file) {
  if (!file || file.size <= 0 || file.size > MAX_IMAGE_BYTES)
    throw new Error("Il file deve essere inferiore a 12 MB.");
  if (!/\.(png|jpe?g)$/i.test(file.name))
    throw new Error("Sono supportati soltanto i file PNG, JPG e JPEG.");

  // Check signatures instead of trusting the extension or the MIME type alone.
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((part, i) => bytes[i] === part);
  const jpeg = bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg)
    throw new Error("Il contenuto del file non è un PNG o JPG valido.");
}

function replaceImage(target, loaded) {
  const previous = state.images[target];
  state.images[target] = loaded;
  if (previous) URL.revokeObjectURL(previous.url);
  updateAssetUI(target);
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
      status("Salvato nel browser");
      notice(`Immagine ${target === "card" ? "card" : "pulsante"} caricata e salvata.`);
    } catch {
      status("Immagine solo per questa sessione", false);
      notice("Immagine caricata; il browser non consente di salvarla in modo permanente.");
    }
  } catch (error) {
    if (loaded && state.images[target] !== loaded) URL.revokeObjectURL(loaded.url);
    notice(error.message || "Impossibile caricare questa immagine.");
  }
}

async function clearImage(target) {
  replaceImage(target, null);
  try {
    await assetOperation("delete", target);
    status("Salvato nel browser");
    notice(`Immagine ${target === "card" ? "card" : "pulsante"} rimossa.`);
  } catch {
    status("Salvataggio non disponibile", false);
    notice("Immagine rimossa dall'anteprima; impossibile aggiornare la memoria locale.");
  }
}

async function restoreImages() {
  for (const target of ["card", "button"]) {
    try {
      const saved = await assetOperation("get", target);
      if (!saved?.blob || !saved.name) continue;
      await validateFile(new File([saved.blob], saved.name, { type: saved.blob.type }));
      const loaded = await imageDimensions(saved.blob, saved.name);
      replaceImage(target, loaded);
    } catch (error) {
      console.warn(`Immagine salvata per ${target} non disponibile:`, error);
    }
  }
}

function updateAssetUI(target) {
  const image = state.images[target];
  const thumb = document.getElementById(`${target}-thumb`);
  const filename = document.getElementById(`${target}-filename`);
  const color = PALETTE[state.layout[target === "card" ? "cardColor" : "buttonColor"]].hex;
  thumb.style.backgroundColor = color;
  thumb.style.backgroundImage = image ? `url("${image.url}")` : "none";
  thumb.querySelector(".asset-thumb-icon").style.visibility = image ? "hidden" : "visible";
  filename.textContent = image ? image.name : "Nessuna immagine";
  filename.title = image ? image.name : "Nessuna immagine";
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
    button.setAttribute("aria-label", `Seleziona ${color.name} per ${target === "card" ? "card" : "pulsante"}`);
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
  const measures = {
    x: layout.x, y: layout.y, w: layout.w, h: layout.h,
    right: margin.right, bottom: margin.bottom
  };
  for (const [key, value] of Object.entries(measures)) {
    document.getElementById(`measure-${key}`).textContent = String(value);
  }
  document.getElementById("offset-right").textContent = String(margin.right);
  document.getElementById("offset-bottom").textContent = String(margin.bottom);
  for (const [key, input] of Object.entries(fields)) {
    if (document.activeElement !== input) input.value = layout[key];
  }
  fields.x.max = String(CARD.width - layout.w);
  fields.y.max = String(CARD.height - layout.h);
  fields.w.max = String(CARD.width - layout.x);
  fields.h.max = String(CARD.height - layout.y);

  for (const target of ["card", "button"]) {
    const index = layout[target === "card" ? "cardColor" : "buttonColor"];
    document.getElementById(`${target}-color-name`).textContent = PALETTE[index].name;
    document.querySelectorAll(`#${target}-palette .swatch`).forEach(button => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.index) === index));
    });
    updateAssetUI(target);
  }

  elements.move.classList.toggle("is-active", state.mode === "move");
  elements.resize.classList.toggle("is-active", state.mode === "resize");
  elements.move.setAttribute("aria-pressed", String(state.mode === "move"));
  elements.resize.setAttribute("aria-pressed", String(state.mode === "resize"));
  elements.guides.classList.toggle("is-active", state.guides);
  elements.guides.setAttribute("aria-pressed", String(state.guides));
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
    ctx2d.fillText("840 × 480 PX  /  CANVAS", CARD.x + 28, CARD.y + 60);
  }
  ctx2d.strokeStyle = "#ffffffa6";
  ctx2d.lineWidth = 2;
  ctx2d.strokeRect(CARD.x + 1, CARD.y + 1, CARD.width - 2, CARD.height - 2);

  if (guides) renderGuides(ctx2d, rect, layout);

  ctx2d.fillStyle = PALETTE[layout.buttonColor].hex;
  ctx2d.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (state.images.button?.image) {
    ctx2d.drawImage(state.images.button.image, rect.x, rect.y, rect.w, rect.h);
  } else {
    ctx2d.fillStyle = "#ffffff13";
    ctx2d.fillRect(rect.x, rect.y, rect.w, rect.h);
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

  if (hud) {
    ctx2d.fillStyle = "#0c1227db";
    ctx2d.fillRect(0, 0, SCREEN.width, 31);
    ctx2d.fillRect(0, SCREEN.height - 27, SCREEN.width, 27);
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "middle";
    ctx2d.font = '600 13px "Space Grotesk", sans-serif';
    ctx2d.fillStyle = "#f6eeff";
    ctx2d.fillText(`X:${layout.x}  Y:${layout.y}  W:${layout.w}  H:${layout.h}  R:${offsets(layout).right}  B:${offsets(layout).bottom}`, 16, 16);
    ctx2d.font = '600 12px "Space Grotesk", sans-serif';
    ctx2d.fillStyle = "#ffd988";
    ctx2d.fillText(state.mode === "move" ? "MODE: MOVE" : "MODE: RESIZE", 16, SCREEN.height - 13);
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
    if (!blob) { notice("Impossibile esportare l'anteprima."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "livearea-preview.png";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    notice("Anteprima PNG esportata.");
  }, "image/png");
}

async function copyCoordinates() {
  const { x, y, w, h } = state.layout;
  const { right, bottom } = offsets(state.layout);
  const text = `X=${x}, Y=${y}, W=${w}, H=${h}, RIGHT=${right}, BOTTOM=${bottom}`;
  try {
    await navigator.clipboard.writeText(text);
    notice("Coordinate copiate.");
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
    notice(succeeded ? "Coordinate copiate." : "Clipboard non disponibile su questo browser.");
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
  elements.export.addEventListener("click", downloadImage);
  elements.copy.addEventListener("click", copyCoordinates);
  elements.reset.addEventListener("click", () => {
    const { cardColor, buttonColor } = state.layout;
    setLayout({ ...DEFAULT_LAYOUT, cardColor, buttonColor });
    notice("Posizione e dimensioni ripristinate.");
  });

  for (const [key, input] of Object.entries(fields)) {
    input.addEventListener("input", () => {
      if (input.value.trim() === "") return;
      const value = Number(input.value);
      if (Number.isFinite(value)) setLayout({ ...state.layout, [key]: value });
    });
    input.addEventListener("change", () => {
      if (input.value.trim() !== "") {
        const value = Number(input.value);
        if (Number.isFinite(value)) setLayout({ ...state.layout, [key]: value });
      }
      input.value = state.layout[key];
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
  for (const target of ["card", "button"]) {
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
    buildPalette(target);
  }
}

if (ctx) {
  bindEditor();
  bindAssets();
  updateInterface();
  scheduleDraw();
  restoreImages();
} else {
  notice("Il tuo browser non supporta Canvas 2D.");
}

window.addEventListener("pagehide", () => {
  for (const target of ["card", "button"]) {
    const image = state.images[target];
    if (image) URL.revokeObjectURL(image.url);
  }
});
