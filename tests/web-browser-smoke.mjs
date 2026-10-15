/**
 * Dependency-free browser smoke test for the GitHub Pages app.
 * Run with: node tests/web-browser-smoke.mjs
 * Requires Google Chrome installed locally (override with CHROME_BIN).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../docs/", import.meta.url)));
const output = resolve(root, "../build-web");
const temp = await mkdtemp(join(tmpdir(), "livearea-chrome-"));
const chromePath = process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + sep)) throw new Error("Invalid path");
    const bytes = await readFile(file);
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-extensions",
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--remote-allow-origins=*", "--remote-debugging-port=0",
  `--user-data-dir=${temp}`, "--window-size=1520,1050", origin
], { stdio: "ignore" });

const pause = delay => new Promise(resolve => setTimeout(resolve, delay));
let socket;
const pending = new Map();
const errors = [];
let id = 0;

async function waitFor(check, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const result = await check();
      if (result) return result;
    } catch { /* browser may be initializing */ }
    await pause(90);
  }
  throw new Error(`Timed out: ${label}`);
}

function send(method, params = {}) {
  const callId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    socket.send(JSON.stringify({ id: callId, method, params }));
    setTimeout(() => {
      if (pending.has(callId)) {
        pending.delete(callId);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 12000).unref();
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text + ": " +
      (result.exceptionDetails.exception?.description || expression));
  return result.result.result?.value;
}

async function screenshot(name) {
  await mkdir(output, { recursive: true });
  const response = await send("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: false
  });
  await writeFile(join(output, name), Buffer.from(response.result.data, "base64"));
}

async function mouse(method, x, y, buttons = 0) {
  await send("Input.dispatchMouseEvent", {
    type: method, x, y, button: method === "mouseMoved" ? "none" : "left",
    buttons, clickCount: buttons ? 1 : 0
  });
}

function point(metrics, x, y) {
  return {
    x: metrics.left + x * metrics.width / 960,
    y: metrics.top + y * metrics.height / 544
  };
}

try {
  const port = await waitFor(async () => {
    const data = await readFile(join(temp, "DevToolsActivePort"), "utf8");
    return Number(data.split("\n")[0]);
  }, "Chrome DevTools port");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(candidate => candidate.type === "page");
  assert.ok(page?.webSocketDebuggerUrl, "Browser page is accessible");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.exception?.description ||
                  message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await waitFor(() => evaluate("document.querySelectorAll('.swatch').length === 20"), "palette initialization");
  let pageState = await evaluate(`({
    title: document.title,
    lang: document.documentElement.lang,
    heading: document.querySelector("h1").textContent,
    download: document.querySelector(".download-link").textContent.trim(),
    export: document.querySelector("#export-preview").textContent.trim(),
    settings: document.querySelector("#settings-heading").textContent.trim(),
    paletteLabel: document.querySelector('#card-palette .swatch[data-index="0"]').getAttribute("aria-label"),
    width: document.querySelector("#preview").width,
    height: document.querySelector("#preview").height,
    x: document.querySelector("#measure-x").textContent,
    right: document.querySelector("#measure-right").textContent
  })`);
  assert.equal(pageState.lang, "en");
  assert.match(pageState.heading, /Your LiveArea.*Pixel perfect\./);
  assert.equal(pageState.download, "Download VPK");
  assert.equal(pageState.export, "Export PNG Preview");
  assert.equal(pageState.settings, "Settings");
  assert.equal(pageState.paletteLabel, "Select Purple for the card");
  assert.equal(pageState.width, 960);
  assert.equal(pageState.height, 544);
  assert.equal(pageState.x, "276");
  assert.equal(pageState.right, "278");
  console.log("PASS: desktop initialization and native dimensions");

  await evaluate(`(() => {
    document.querySelector('#card-palette .swatch[data-index="4"]').click();
    document.querySelector('#button-palette .swatch[data-index="6"]').click();
    const field = document.querySelector("#input-x");
    field.value = "200";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.querySelector("#measure-x").textContent === "200"'), "geometry input");
  const colorState = await evaluate(`({
    card: document.querySelector("#card-palette .swatch[data-index='4']").getAttribute("aria-pressed"),
    button: document.querySelector("#button-palette .swatch[data-index='6']").getAttribute("aria-pressed")
  })`);
  assert.equal(colorState.card, "true");
  assert.equal(colorState.button, "true");
  console.log("PASS: image color presets and live numeric geometry");

  let metrics = await evaluate(`(() => {
    const r = document.querySelector("#preview").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  const dragStart = point(metrics, 60 + 200 + 75, 44 + 112 + 75);
  const dragEnd = point(metrics, 60 + 200 + 75 + 55, 44 + 112 + 75 + 30);
  await mouse("mousePressed", dragStart.x, dragStart.y, 1);
  await mouse("mouseMoved", dragEnd.x, dragEnd.y, 1);
  await mouse("mouseReleased", dragEnd.x, dragEnd.y);
  await waitFor(() => evaluate('document.querySelector("#measure-x").textContent === "255"'), "pointer drag");
  assert.equal(await evaluate('document.querySelector("#measure-y").textContent'), "142");
  console.log("PASS: pointer drag with CSS-scaled canvas coordinates");

  const resizeStart = point(metrics, 60 + 255 + 286, 44 + 142 + 168);
  const resizeEnd = point(metrics, 60 + 255 + 286 + 32, 44 + 142 + 168 + 24);
  await mouse("mousePressed", resizeStart.x, resizeStart.y, 1);
  await mouse("mouseMoved", resizeEnd.x, resizeEnd.y, 1);
  await mouse("mouseReleased", resizeEnd.x, resizeEnd.y);
  await waitFor(() => evaluate('document.querySelector("#measure-w").textContent === "318"'), "pointer resize");
  assert.equal(await evaluate('document.querySelector("#measure-h").textContent'), "192");
  console.log("PASS: independent resize handle");

  await evaluate(`(() => {
    document.querySelector("#mode-resize").click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.querySelector("#measure-w").textContent === "328"'), "keyboard resize");
  console.log("PASS: keyboard resize acceleration");

  // Simulate selecting a local PNG through the same browser file input as a user.
  await evaluate(`(async () => {
    const c = document.createElement("canvas");
    c.width = 40; c.height = 40;
    c.getContext("2d").fillStyle = "#32b488";
    c.getContext("2d").fillRect(0, 0, 40, 40);
    const blob = await new Promise(done => c.toBlob(done, "image/png"));
    const file = new File([blob], "web-test-card.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const field = document.getElementById("card-file");
    field.files = transfer.files;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(done => setTimeout(done, 400));
  })()`);
  await waitFor(() => evaluate('document.getElementById("card-filename").textContent === "web-test-card.png"'), "PNG import");
  console.log("PASS: PNG input import and thumbnail display");

  await send("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate('document.querySelectorAll(".swatch").length === 20'), "page reload");
  await waitFor(() => evaluate('document.getElementById("card-filename").textContent === "web-test-card.png"'), "persisted image restoration");
  assert.equal(await evaluate('document.getElementById("measure-w").textContent'), "328");
  assert.equal(await evaluate('document.getElementById("card-color-name").textContent'), "Green");
  console.log("PASS: geometry, colors, and images persist after reload");

  await screenshot("desktop.png");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    screenWidth: 390, screenHeight: 844
  });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("document.querySelectorAll('.swatch').length === 20"), "mobile initialization");
  pageState = await evaluate(`({
    innerWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    canvasWidth: document.querySelector("#preview").getBoundingClientRect().width,
    swatches: document.querySelectorAll(".swatch").length,
    screenWidth: screen.width,
    viewportMeta: document.querySelector('meta[name="viewport"]').content
  })`);
  console.log("MOBILE DIAGNOSTICS:", pageState);
  await screenshot("mobile.png");
  assert.equal(pageState.innerWidth, 390);
  assert.ok(pageState.scrollWidth <= 392, "No horizontal overflow on mobile");
  assert.ok(pageState.canvasWidth > 300 && pageState.canvasWidth < 400);
  console.log("PASS: mobile layout without horizontal overflow");

  await evaluate('document.querySelector("#card-clear").click()');
  await waitFor(() => evaluate('document.getElementById("card-filename").textContent === "No image selected"'), "asset removal");
  await waitFor(() => evaluate('document.getElementById("toast").textContent === "Card image removed."'), "English removal message");
  assert.deepEqual(errors, [], "No uncaught browser runtime errors");
  console.log("PASS: image removal; no JavaScript runtime errors");
  console.log("Screenshots written to:", output);
} finally {
  for (const entry of pending.values()) entry.reject(new Error("Browser shutdown"));
  pending.clear();
  if (socket) socket.close();
  chrome.kill("SIGTERM");
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}
