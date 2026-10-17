/**
 * Dependency-free browser smoke test for the GitHub Pages app.
 * Run with: node tests/web-browser-smoke.mjs
 * Requires Google Chrome installed locally (override with CHROME_BIN).
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
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
  throw new Error(`Timed out: ${label}. Browser errors: ${JSON.stringify(errors)}`);
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
  await waitFor(() => evaluate("document.querySelectorAll('.swatch').length === 20"),
    "palette initialization", 30000);
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
  assert.equal(pageState.x, "-1");
  assert.equal(pageState.right, "278");
  console.log("PASS: desktop initialization and native dimensions");

  await evaluate(`(() => {
    const selector = document.getElementById("xml-frame");
    selector.value = "1";
    selector.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("xml-target").value === "psla:eboot"'),
    "frame1 gets default native launch target");
  await evaluate(`(() => {
    const target = document.getElementById("xml-target");
    target.value = "https://example.org/custom-launch";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    const selector = document.getElementById("xml-frame");
    selector.value = "3";
    selector.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("xml-target").value === "https://example.com"'),
    "frame3 retains its independent default target");
  await evaluate(`(() => {
    const selector = document.getElementById("xml-frame");
    selector.value = "1";
    selector.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("xml-target").value === "https://example.org/custom-launch"'),
    "customized frame1 target is not replaced");
  await evaluate(`(() => {
    const target = document.getElementById("xml-target");
    target.value = "psla:eboot";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    const selector = document.getElementById("xml-frame");
    selector.value = "3";
    selector.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  console.log("PASS: default frame1 psla:eboot; independent, editable, persistent target");

  const originalXml = await evaluate(`(async () => {
    const { generateTemplate } = await import("./template.mjs");
    const { DEFAULT_LAYOUT } = await import("./geometry.mjs");
    const p = JSON.parse(localStorage.getItem("livearea-designer-web-v1")) ??
      { layout: DEFAULT_LAYOUT, frameLayouts: {} };
    return generateTemplate(p.layout, p.frameLayouts);
  })()`);
  const originalPixels = await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem("livearea-designer-web-v1"));
    const l = saved?.layout ?? { x: 276, y: 112 };
    return { x: l.x, y: l.y };
  })()`);
  await evaluate('document.getElementById("invert-x").click()');
  await waitFor(() => evaluate('document.getElementById("measure-x").textContent === "1"'),
    "invert X only");
  assert.equal(await evaluate('document.getElementById("measure-y").textContent'), "54");
  await evaluate('document.getElementById("invert-y").click()');
  await waitFor(() => evaluate('document.getElementById("measure-y").textContent === "-54"'),
    "invert Y independently");
  assert.equal(await evaluate('document.getElementById("input-x").value'), "1");
  assert.equal(await evaluate('document.getElementById("input-y").value'), "-54");
  assert.match(await evaluate('document.getElementById("axis-y-direction").textContent'),
    /UP.*DOWN/);
  assert.deepEqual(await evaluate(`(() => {
    const p = JSON.parse(localStorage.getItem("livearea-designer-web-v1"));
    return { x: p.layout.x, y: p.layout.y };
  })()`), originalPixels, "Switching signs does not move the image");
  assert.equal(await evaluate(`(async () => {
    const { generateTemplate } = await import("./template.mjs");
    const p = JSON.parse(localStorage.getItem("livearea-designer-web-v1"));
    return generateTemplate(p.layout, p.frameLayouts);
  })()`), originalXml, "Editor sign preferences do not alter template.xml");

  await send("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate('document.getElementById("invert-x").checked && document.getElementById("invert-y").checked'),
    "independent sign preferences survive reload");
  assert.equal(await evaluate('document.getElementById("measure-y").textContent'), "-54");
  await evaluate(`(() => {
    const x = document.getElementById("input-x");
    const y = document.getElementById("input-y");
    x.value = "-100";
    x.dispatchEvent(new Event("input", { bubbles: true }));
    y.value = "30";
    y.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(
    'document.getElementById("measure-x").textContent === "-100" && document.getElementById("measure-y").textContent === "30"'
  ), "inverted numeric inputs update the underlying position");
  const movedPixels = await evaluate(`(() => {
    const l = JSON.parse(localStorage.getItem("livearea-designer-web-v1")).layout;
    return { x: l.x, y: l.y };
  })()`);
  assert.deepEqual(movedPixels, { x: 377, y: 196 });
  const copied = await evaluate(`(async () => {
    let lastCopied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: async value => { lastCopied = value; } }
    });
    document.getElementById("copy-coordinates").click();
    await new Promise(resolve => setTimeout(resolve, 30));
    return lastCopied;
  })()`);
  assert.match(copied, /^X=-100, Y=30, W=286, H=168,/,
    "Copy Coordinates must honor the selected display signs");
  await evaluate(`(() => {
    document.getElementById("invert-x").click();
    document.getElementById("invert-y").click();
    document.getElementById("reset-geometry").click();
  })()`);
  await waitFor(() => evaluate(
    'document.getElementById("measure-x").textContent === "-1" && document.getElementById("measure-y").textContent === "54"'
  ), "restore default editor signs for further tests");
  console.log("PASS: X/Y sign inversions, persistence, numeric editing and unchanged XML");

  await evaluate(`(() => {
    document.querySelector('#card-palette .swatch[data-index="4"]').click();
    document.querySelector('#button-palette .swatch[data-index="6"]').click();
    const field = document.querySelector("#input-x");
    field.value = "-100";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.querySelector("#measure-x").textContent === "-100"'), "geometry input");
  const colorState = await evaluate(`({
    card: document.querySelector("#card-palette .swatch[data-index='4']").getAttribute("aria-pressed"),
    button: document.querySelector("#button-palette .swatch[data-index='6']").getAttribute("aria-pressed")
  })`);
  assert.equal(colorState.card, "true");
  assert.equal(colorState.button, "true");
  console.log("PASS: image color presets and live numeric geometry");

  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.getElementById("preview").scrollIntoView({ block: "center", behavior: "instant" });
  })()`);
  await pause(150);
  let metrics = await evaluate(`(() => {
    const r = document.querySelector("#preview").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await evaluate('document.getElementById("preview").scrollIntoView({ block: "center", behavior: "instant" })');
    await pause(140);
    metrics = await evaluate(`(() => {
      const r = document.getElementById("preview").getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    const moveStart = point(metrics, 60 + 177 + 75, 44 + 112 + 75);
    const moveEnd = point(metrics, 60 + 177 + 75 + 55, 44 + 112 + 75 + 30);
    await mouse("mousePressed", moveStart.x, moveStart.y, 1);
    await pause(110);
    await mouse("mouseMoved", moveEnd.x, moveEnd.y, 1);
    await pause(110);
    await mouse("mouseReleased", moveEnd.x, moveEnd.y);
    await pause(170);
    if ((await evaluate('document.querySelector("#measure-x").textContent')) === "-45")
      break;
  }
  await waitFor(() => evaluate('document.querySelector("#measure-x").textContent === "-45"'), "pointer drag");
  assert.equal(await evaluate('document.querySelector("#measure-y").textContent'), "24");
  assert.equal(await evaluate('document.getElementById("input-y").value'), "24");
  // Editing signed Y must move the image down for negative values, while
  // leaving persisted top-left geometry in the original pixel coordinate space.
  await evaluate(`(() => {
    const input = document.getElementById("input-y");
    input.value = "-30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("measure-y").textContent === "-30"'),
    "negative Y number entry moves image below the center");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem("livearea-designer-web-v1")).layout.y`),
    196);
  await evaluate(`(() => {
    const input = document.getElementById("input-y");
    input.value = "24";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("measure-y").textContent === "24"'),
    "restoring positive Y moves the image upward");
  const xmlImportCoordinates = await evaluate(`(async () => {
    const { parseVpkTemplate } = await import("./vpk-import.mjs");
    const { frameRelativeOffsets } = await import("./template-preview.mjs");
    const make = y => parseVpkTemplate(
      '<livearea style="a3"><frame id="frame2"><liveitem>' +
      '<image width="111" height="71" x="12" y="' + y + '">frame2.png</image>' +
      '</liveitem></frame></livearea>'
    ).frameLayouts["a3:2"];
    const below = make(-8);
    const above = make(10);
    return { belowY: below.y, aboveY: above.y,
      belowOffset: frameRelativeOffsets(below),
      aboveOffset: frameRelativeOffsets(above) };
  })()`);
  assert.equal(xmlImportCoordinates.belowY, 158);
  assert.equal(xmlImportCoordinates.aboveY, 140);
  assert.deepEqual(xmlImportCoordinates.belowOffset, { x: 12, y: -8 });
  assert.deepEqual(xmlImportCoordinates.aboveOffset, { x: 12, y: 10 });
  console.log("PASS: pointer drag with CSS-scaled canvas coordinates");

  for (let attempt = 0; attempt < 3; attempt++) {
    await evaluate('document.getElementById("preview").scrollIntoView({ block: "center", behavior: "instant" })');
    await pause(120);
    metrics = await evaluate(`(() => {
      const r = document.getElementById("preview").getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    const resizeStart = point(metrics, 60 + 232 + 286, 44 + 142 + 168);
    const resizeEnd = point(metrics, 60 + 232 + 286 + 32, 44 + 142 + 168 + 24);
    await mouse("mousePressed", resizeStart.x, resizeStart.y, 1);
    await pause(110);
    await mouse("mouseMoved", resizeEnd.x, resizeEnd.y, 1);
    await pause(110);
    await mouse("mouseReleased", resizeEnd.x, resizeEnd.y);
    await pause(170);
    if ((await evaluate('document.querySelector("#measure-w").textContent')) === "318")
      break;
  }
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

  await evaluate(`(() => {
    document.getElementById("transparent-button").click();
    document.getElementById("lock-aspect").click();
    const style = document.getElementById("xml-style");
    style.value = "a2";
    style.dispatchEvent(new Event("input", { bubbles: true }));
    const target = document.getElementById("xml-target");
    target.value = "https://example.org/?a=1&b=2";
    target.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(`(() => {
    const p = JSON.parse(localStorage.getItem("livearea-designer-web-v1"));
    return p.frameLayouts["a1:3"].transparentButton === true &&
      p.layout.templateStyle === "a2";
  })()`), "per-frame independent alpha settings");
  await evaluate(`(() => {
    document.getElementById("transparent-button").click();
    document.getElementById("lock-aspect").click();
  })()`);
  const xmlSettings = await evaluate(`({
    aspect: document.getElementById("lock-aspect").checked,
    alpha: document.getElementById("transparent-button").checked,
    style: document.getElementById("xml-style").value,
    target: document.getElementById("xml-target").value
  })`);
  assert.equal(xmlSettings.aspect, true);
  assert.equal(xmlSettings.alpha, true);
  assert.equal(xmlSettings.style, "a2");
  assert.equal(xmlSettings.target, "https://example.org/?a=1&b=2");
  console.log("PASS: aspect lock, transparency and XML options via browser UI");

  const bundle = await evaluate(`(async () => {
    const { buildLiveAreaPackage } = await import("./package.mjs");
    const { generateTemplate } = await import("./template.mjs");
    const { DEFAULT_LAYOUT } = await import("./geometry.mjs");
    const config = { ...DEFAULT_LAYOUT, transparentButton: true };
    const zip = await buildLiveAreaPackage(config, {
      card: null, button: null, gate: null, icon: null, boot: null, manual: []
    });
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const v = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    let pos = 0;
    const assets = [];
    while (pos + 30 < bytes.length && v.getUint32(pos, true) === 0x04034b50) {
      const length = v.getUint32(pos + 18, true);
      const nameLen = v.getUint16(pos + 26, true);
      const extraLen = v.getUint16(pos + 28, true);
      const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
      const start = pos + 30 + nameLen + extraLen;
      const content = bytes.subarray(start, start + length);
      const png = name.endsWith(".png");
      const pngProps = png ? { depth: content[24], colorType: content[25],
        transparency: decoder.decode(content).includes("tRNS") } : {};
      assets.push({ name, ...pngProps });
      pos = start + length;
    }
    return { assets, size: bytes.length,
      xml: generateTemplate(config) };
  })()`);
  assert.ok(bundle.size > 500);
  assert.deepEqual(bundle.assets.map(asset => asset.name), [
    "sce_sys/livearea/contents/template.xml",
    "sce_sys/livearea/contents/bg0.png",
    "sce_sys/livearea/contents/startup.png",
    "sce_sys/livearea/contents/frame1.png",
    "sce_sys/livearea/contents/frame2.png",
    "sce_sys/livearea/contents/frame3.png"
  ]);
  for (const asset of bundle.assets.filter(asset => asset.name.endsWith(".png"))) {
    assert.equal(asset.depth, 8);
    assert.equal(asset.colorType, 3);
  }
  assert.equal(bundle.assets.at(-1).transparency, true);
  assert.match(bundle.xml, /<startup-image>startup.png<\/startup-image>/);
  console.log("PASS: downloadable ZIP contains XML and PNG8 indexed assets with alpha");

  const ad0Bundle = await evaluate(`(async () => {
    const { buildLiveAreaPackage } = await import("./package.mjs");
    const { readZipArchive, readArchiveEntry } = await import("./vpk.mjs");
    const { DEFAULT_LAYOUT } = await import("./geometry.mjs");
    const blank = { card: null, button: null, frames: {}, gate: null, manual: [] };
    const zip = await readZipArchive(await buildLiveAreaPackage(
      { ...DEFAULT_LAYOUT, templateStyle: "ad0", frameId: 1 }, blank));
    const xml = new TextDecoder().decode(await readArchiveEntry(zip,
      "sce_sys/livearea/contents/template.xml"));
    return { names: zip.entries.map(e => e.name), xml };
  })()`);
  assert.doesNotMatch(ad0Bundle.xml, /<gate>|startup-image|startup\.png/);
  assert.ok(!ad0Bundle.names.some(name => name.endsWith("/startup.png")));
  assert.ok(ad0Bundle.names.some(name => name.endsWith("/bg0.png")));
  assert.ok(ad0Bundle.names.some(name => name.endsWith("/frame1.png")));
  await evaluate(`(() => {
    const style = document.getElementById("xml-style");
    style.value = "ad0";
    style.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(
    'document.getElementById("gate-drop").hidden && !document.getElementById("gate-unavailable").hidden'
  ), "gate controls hidden when ad0 is selected");
  await evaluate(`(() => {
    const style = document.getElementById("xml-style");
    style.value = "a2";
    style.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('!document.getElementById("gate-drop").hidden'),
    "gate controls restored for a gated style");
  await waitFor(() => evaluate('document.getElementById("xml-frame").options.length === 3'),
    "restore a2 native frame options");
  await evaluate(`(() => {
    const selector = document.getElementById("xml-frame");
    selector.value = "3";
    selector.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("xml-frame").value === "3"'),
    "restore selected frame after testing ad0");
  console.log("PASS: ad0 gate-less XML, ZIP assets and live editor UI");

  const downloads = join(temp, "downloads");
  await mkdir(downloads, { recursive: true });
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await evaluate('document.getElementById("download-package").click()');
  const zipFilename = join(downloads, "LiveAreaDesigner-assets.zip");
  await waitFor(async () => {
    const data = await readFile(zipFilename);
    return data.length > 400;
  }, "package download", 20000);
  // ZIP integrity and both PNG palette encoding + dimensions are checked from
  // the actual file downloaded using the site's button.
  execFileSync("unzip", ["-t", zipFilename]);
  const xmlFile = execFileSync("unzip", ["-p", zipFilename,
    "sce_sys/livearea/contents/template.xml"]).toString("utf8");
  assert.match(xmlFile, /<livearea style="a2"/);
  assert.match(xmlFile, /https:\/\/example.org\/\?a=1&amp;b=2/);
  const png = execFileSync("unzip", ["-p", zipFilename,
    "sce_sys/livearea/contents/bg0.png"]);
  assert.equal(png.readUInt32BE(16), 840);
  assert.equal(png.readUInt32BE(20), 500);
  assert.equal(png[24], 8);
  assert.equal(png[25], 3);
  const buttonPng = execFileSync("unzip", ["-p", zipFilename,
    "sce_sys/livearea/contents/frame3.png"]);
  assert.ok(buttonPng.includes(Buffer.from("tRNS")));
  console.log("PASS: downloaded ZIP is valid and contains real PNG8 images + escaped XML");

  const oldCanvas = await evaluate('document.getElementById("preview").toDataURL("image/png")');
  await evaluate('document.getElementById("toggle-template-preview").click()');
  await waitFor(() => evaluate(
    'document.getElementById("toggle-template-preview").getAttribute("aria-pressed") === "true"'
  ), "template preview toggle");
  assert.equal(await evaluate('document.getElementById("template-preview-state").textContent'), "ON");
  assert.equal(await evaluate('document.getElementById("template-preview-details").hidden'), false);
  assert.match(await evaluate('document.getElementById("template-preview-summary").textContent'),
    /Style a2.*frame3.*320.*200.*center-aligned gate/);
  assert.ok((await evaluate(
    'document.getElementById("preview").toDataURL("image/png")'
  )) !== oldCanvas, "Preview Template renders differently from freeform mode");

  const samples = await evaluate(`(async () => {
    const colors = [];
    for (const styleName of ["a1", "a2", "a3", "a4", "a5"]) {
      const style = document.getElementById("xml-style");
      style.value = styleName;
      style.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(() =>
        requestAnimationFrame(resolve)));
      const frameOptions = document.getElementById("xml-frame").options.length;
      const screenshot = document.getElementById("preview").toDataURL("image/png");
      colors.push({ style: styleName, screenshot, frameOptions });
    }
    return colors;
  })()`);
  assert.deepEqual(samples.map(sample => sample.frameOptions), [3, 3, 5, 5, 7]);
  assert.equal(new Set(samples.map(sample => sample.screenshot)).size, 5,
    "Every a1-a5 template must show its actual different RCO slot geometry");
  console.log("PASS: a1-a5 all render distinct firmware geometry; 3/3/5/5/7 frame selectors");
  await evaluate(`(() => {
    const style = document.getElementById("xml-style");
    style.value = "a2";
    style.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(
    'document.getElementById("template-preview-summary").textContent.includes("Style a2")'
  ), "restore a2 before psmobile test");
  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.getElementById("preview").scrollIntoView({ behavior: "instant", block: "center" });
  })()`);
  await pause(160);
  metrics = await evaluate(`(() => {
    const r = document.getElementById("preview").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  const frameSelection = point(metrics, 110, 240); // A2 frame1, clear of the editable button.
  await mouse("mousePressed", frameSelection.x, frameSelection.y, 1);
  await mouse("mouseReleased", frameSelection.x, frameSelection.y);
  await waitFor(() => evaluate(
    'document.getElementById("xml-frame").value === "1"'
  ), "click-to-select native frame slot");
  assert.match(await evaluate('document.getElementById("template-preview-summary").textContent'),
    /Style a2.*frame1/);
  console.log("PASS: click a real template slot to select the frame in the XML editor");

  const a2Canvas = await evaluate('document.getElementById("preview").toDataURL("image/png")');
  await evaluate(`(() => {
    const style = document.getElementById("xml-style");
    style.value = "psmobile";
    style.dispatchEvent(new Event("input", { bubbles: true }));
    const frame = document.getElementById("xml-frame");
    frame.value = "2";
    frame.dispatchEvent(new Event("input", { bubbles: true }));
    const text = document.getElementById("xml-text");
    text.value = "Preview test";
    text.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(
    'document.getElementById("template-preview-summary").textContent.includes("Style psmobile")'
  ), "reactive template style");
  assert.match(await evaluate('document.getElementById("template-preview-summary").textContent'),
    /frame2.*right-aligned gate/);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.ok((await evaluate(
    'document.getElementById("preview").toDataURL("image/png")'
  )) !== a2Canvas, "Switching style changes the actual canvas");
  await evaluate(`(() => {
    const field = document.getElementById("input-h");
    field.value = "75";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("measure-h").textContent === "75"'),
    "shrink selected frame image to enable drag");
  const beforeDrag = await evaluate(`(async () => {
    const { buttonOnScreen } = await import("./geometry.mjs");
    const l = JSON.parse(localStorage.getItem("livearea-designer-web-v1")).layout;
    const r = buttonOnScreen(l);
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  })()`);
  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.getElementById("preview").scrollIntoView({ behavior: "instant", block: "center" });
  })()`);
  metrics = await evaluate(`(() => {
    const r = document.getElementById("preview").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  const initialX = Number(await evaluate('document.getElementById("measure-x").textContent'));
  const initialY = Number(await evaluate('document.getElementById("measure-y").textContent'));
  for (let attempt = 0; attempt < 3; attempt++) {
    await evaluate('document.getElementById("preview").scrollIntoView({ behavior: "instant", block: "center" })');
    await pause(120);
    metrics = await evaluate(`(() => {
      const r = document.getElementById("preview").getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    const moveFrom = point(metrics, beforeDrag.x + 30, beforeDrag.y + 45);
    const moveTo = point(metrics, beforeDrag.x + 50, beforeDrag.y + 55);
    await mouse("mousePressed", moveFrom.x, moveFrom.y, 1);
    await pause(120);
    await mouse("mouseMoved", moveTo.x, moveTo.y, 1);
    await pause(120);
    await mouse("mouseReleased", moveTo.x, moveTo.y);
    await pause(130);
    if (Number(await evaluate('document.getElementById("measure-x").textContent')) !== initialX)
      break;
  }
  const movedX = Number(await evaluate('document.getElementById("measure-x").textContent'));
  const movedY = Number(await evaluate('document.getElementById("measure-y").textContent'));
  assert.ok(movedX > initialX, "The selected frame liveitem must be draggable");
  assert.ok(movedY <= initialY, "Dragging downward must decrease the signed Y coordinate");
  const liveXml = await evaluate(`(async () => {
    const { generateTemplate } = await import("./template.mjs");
    const p = JSON.parse(localStorage.getItem("livearea-designer-web-v1"));
    return generateTemplate(p.layout, p.frameLayouts);
  })()`);
  assert.match(liveXml, /<livearea style="psmobile"/);
  assert.match(liveXml, /<frame id="frame2"/);
  assert.match(liveXml, /Preview test/);
  const relative = await evaluate(`(async () => {
    const { frameRelativeOffsets } = await import("./template-preview.mjs");
    return frameRelativeOffsets(
      JSON.parse(localStorage.getItem("livearea-designer-web-v1")).layout
    );
  })()`);
  assert.match(liveXml, new RegExp('x="' + relative.x + '" y="' + relative.y + '"'));
  await evaluate('document.getElementById("fit-template-frame").click()');
  await waitFor(() => evaluate(
    'document.getElementById("template-fit-warning").textContent.startsWith("Image fits")'
  ), "fit liveitem into actual system frame");
  const afterFit = await evaluate(`(async () => {
    const { frameRelativeOffsets, imageFitsSelectedFrame } =
      await import("./template-preview.mjs");
    const layout = JSON.parse(localStorage.getItem("livearea-designer-web-v1")).layout;
    return { fits: imageFitsSelectedFrame(layout), offset: frameRelativeOffsets(layout) };
  })()`);
  assert.equal(afterFit.fits, true);
  assert.ok(Math.abs(afterFit.offset.x) <= 1, "Fit centers the image horizontally to pixel precision");
  assert.ok(Math.abs(afterFit.offset.y) <= 1, "Fit centers the image vertically to pixel precision");
  await send("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate('document.getElementById("template-preview-state").textContent === "ON"'),
    "persisted template preview toggle");
  assert.match(await evaluate('document.getElementById("template-preview-summary").textContent'),
    /Style psmobile.*frame2/);
  console.log("PASS: live template preview, style/frame changes, interactive drag, XML sync and persistence");

  // Every frame has its own image, geometry and XML fields, and the exported
  // package must include all slots, even after switching frames/reloading.
  await evaluate(`(() => {
    const style = document.getElementById("xml-style");
    style.value = "a3";
    style.dispatchEvent(new Event("input", { bubbles: true }));
    const frame = document.getElementById("xml-frame");
    frame.value = "1";
    frame.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("frame-image-label").textContent === "Frame1 image"'),
    "first independent frame selected");
  await evaluate(`(async () => {
    const makeImage = async (color, name) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 40;
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(0, 0, 40, 40);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: "image/png" }));
      const input = document.getElementById("button-file");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    await makeImage("#f04030", "frame-one.png");
  })()`);
  await waitFor(() => evaluate('document.getElementById("button-filename").textContent === "frame-one.png"'),
    "first frame PNG upload");
  await evaluate(`(() => {
    const text = document.getElementById("xml-text");
    text.value = "FRAME ONE";
    text.dispatchEvent(new Event("change", { bubbles: true }));
    const field = document.getElementById("input-w");
    field.value = "130";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const frame = document.getElementById("xml-frame");
    frame.value = "2";
    frame.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("frame-image-label").textContent === "Frame2 image"'),
    "second independent frame selected");
  assert.equal(await evaluate('document.getElementById("button-filename").textContent'), "No image selected");
  await evaluate(`(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 40;
    const context = canvas.getContext("2d");
    context.fillStyle = "#2040f0";
    context.fillRect(0, 0, 40, 40);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "frame-two.png", { type: "image/png" }));
    const input = document.getElementById("button-file");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.getElementById("button-filename").textContent === "frame-two.png"'),
    "second frame PNG upload");
  await evaluate(`(() => {
    const text = document.getElementById("xml-text");
    text.value = "FRAME TWO";
    text.dispatchEvent(new Event("change", { bubbles: true }));
    const field = document.getElementById("input-w");
    field.value = "95";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(`(() => {
    const p = JSON.parse(localStorage.getItem("livearea-designer-web-v1"));
    return p.frameImageKeys.includes("a3:1") && p.frameImageKeys.includes("a3:2") &&
      p.frameLayouts["a3:1"].w === 130 && p.frameLayouts["a3:2"].w === 95 &&
      p.frameLayouts["a3:1"].frameText === "FRAME ONE" &&
      p.frameLayouts["a3:2"].frameText === "FRAME TWO";
  })()`), "independent frame settings and IndexedDB image keys");
  await send("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate(
    'document.getElementById("button-filename").textContent === "frame-two.png"'),
    "second frame image survives refresh");
  await evaluate(`(() => {
    const select = document.getElementById("xml-frame");
    select.value = "1";
    select.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(
    'document.getElementById("button-filename").textContent === "frame-one.png"'),
    "first frame image survives refresh and selection");
  assert.equal(await evaluate('document.getElementById("measure-w").textContent'), "130");
  assert.equal(await evaluate('document.getElementById("xml-text").value'), "FRAME ONE");
  await rm(zipFilename, { force: true });
  await evaluate('document.getElementById("download-package").click()');
  await waitFor(async () => {
    try {
      const result = await readFile(zipFilename);
      return result.length > 1000;
    } catch { return false; }
  }, "complete multi-frame ZIP export", 20000);
  execFileSync("unzip", ["-t", zipFilename]);
  const multiXml = execFileSync("unzip", ["-p", zipFilename,
    "sce_sys/livearea/contents/template.xml"]).toString("utf8");
  assert.equal((multiXml.match(/<frame id=/g) || []).length, 5);
  assert.match(multiXml, /FRAME ONE/);
  assert.match(multiXml, /FRAME TWO/);
  const frameOnePng = execFileSync("unzip", ["-p", zipFilename,
    "sce_sys/livearea/contents/frame1.png"]);
  const frameTwoPng = execFileSync("unzip", ["-p", zipFilename,
    "sce_sys/livearea/contents/frame2.png"]);
  assert.notDeepEqual(frameOnePng, frameTwoPng, "Different frame artwork must produce different PNG assets");
  console.log("PASS: independent frame images, geometry, XML and 5-frame ZIP persisted after reload");

  // Verify the browser's actual Open VPK -> Edit -> Export modified VPK UI
  // using a complete test archive with executable + unrelated game data.
  const pngSizeComparison = await evaluate(`(async () => {
    const { encodeIndexedPng } = await import("./package.mjs");
    const rgba = new Uint8ClampedArray(200 * 160 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 38; rgba[i + 1] = 68; rgba[i + 2] = 138; rgba[i + 3] = 255;
    }
    const legacy = await encodeIndexedPng(200, 160, rgba, false, {optimize: false});
    const optimized = await encodeIndexedPng(200, 160, rgba, false, {optimize: true});
    return { legacy: legacy.length, optimized: optimized.length,
      depth: optimized[24], color: optimized[25] };
  })()`);
  assert.ok(pngSizeComparison.optimized <= pngSizeComparison.legacy,
    "Adaptive filtering must never be larger than the no-filter PNG8 encoding");
  assert.equal(pngSizeComparison.depth, 8);
  assert.equal(pngSizeComparison.color, 3);
  console.log("PASS: optimized PNG8 stays Vita-compatible and saves bytes", pngSizeComparison);

  await evaluate(`(async () => {
    const { readZipArchive, readArchiveEntry } = await import("./vpk.mjs");
    const { makeZip, buildLiveAreaPackage } = await import("./package.mjs");
    const { DEFAULT_LAYOUT } = await import("./geometry.mjs");
    const originalAssets = await readZipArchive(await buildLiveAreaPackage(
      { ...DEFAULT_LAYOUT, templateStyle: "a2", frameId: 3, frameText: "ORIGINAL FRAME" },
      { card: null, button: null, frames: {}, gate: null, icon: null, boot: null, manual: [] }
    ));
    const files = [
      { name: "eboot.bin", data: new TextEncoder().encode("UNCHANGED_EBOOT_TEST_1234") },
      { name: "sce_sys/param.sfo", data: "UNCHANGED_SFO_TEST" },
      { name: "data/game.dat", data: "UNCHANGED_GAME_DATA" }
    ];
    for (const item of originalAssets.entries)
      files.push({ name: item.name, data: await readArchiveEntry(originalAssets, item) });
    const vpk = makeZip(files);
    const file = new File([vpk], "smoke-existing.vpk", {type:"application/zip"});
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById("vpk-file");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate(
    'document.getElementById("vpk-status").textContent.includes("smoke-existing.vpk") && !document.getElementById("save-vpk").disabled && document.getElementById("xml-style").value === "a2"'
  ), "existing VPK import", 20000);
  assert.equal(await evaluate('document.getElementById("card-filename").textContent'),
    "bg0.png", "Import must restore the LiveArea background image");
  assert.equal(await evaluate('document.getElementById("xml-style").value'), "a2");
  assert.equal(await evaluate('document.getElementById("template-preview-state").textContent'), "ON");
  await evaluate(`(() => {
    const input = document.getElementById("xml-text");
    input.value = "EDITED THROUGH VPK";
    input.dispatchEvent(new Event("change", {bubbles:true}));
    document.getElementById("save-vpk").click();
  })()`);
  const modifiedName = join(downloads, "smoke-existing-livearea.vpk");
  await waitFor(async () => {
    try { return (await readFile(modifiedName)).length > 1000; }
    catch { return false; }
  }, "modified VPK export", 20000);
  execFileSync("unzip", ["-t", modifiedName]);
  const modifiedSfo = execFileSync("unzip", ["-p", modifiedName, "sce_sys/param.sfo"]).toString();
  const modifiedGame = execFileSync("unzip", ["-p", modifiedName, "data/game.dat"]).toString();
  const modifiedEboot = execFileSync("unzip", ["-p", modifiedName, "eboot.bin"]).toString();
  const modifiedTemplate = execFileSync("unzip", ["-p", modifiedName,
    "sce_sys/livearea/contents/template.xml"]).toString();
  assert.equal(modifiedSfo, "UNCHANGED_SFO_TEST");
  assert.equal(modifiedGame, "UNCHANGED_GAME_DATA");
  assert.equal(modifiedEboot, "UNCHANGED_EBOOT_TEST_1234");
  assert.match(modifiedTemplate, /EDITED THROUGH VPK/);
  assert.match(modifiedTemplate, /<livearea style="a2"/);
  console.log("PASS: import/edit/patch VPK with original executable and game assets intact");

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

  await waitFor(() => evaluate(
    '!document.getElementById("card-clear").disabled && document.getElementById("card-filename").textContent !== "No image selected"'
  ), "restored imported card image before removal", 30000);
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
