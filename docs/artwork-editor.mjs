import { centerCrop, cropRect, moveCropAxis, normalizeArtwork, paintArtwork, solidColor, tintedSource } from './artwork.mjs?v=1.33.1';
import { drawBubble } from './presentation.mjs?v=1.33';

export function createArtworkEditor({ onApply, onUpload }) {
  const byId = id => document.getElementById(id);
  const dialog = byId('artwork-dialog');
  const closeButton = byId('artwork-close');
  const isOpen = () => dialog.hasAttribute('open');
  const sourceCanvas = byId('artwork-source');
  const sourceWrap = byId('artwork-source-wrap');
  const selection = byId('crop-selection');
  const handle = byId('crop-handle');
  const output = byId('artwork-output');
  const bubble = byId('artwork-bubble');
  const solid = byId('artwork-solid');
  const picker = byId('artwork-color');
  const fillLabel = byId('artwork-fill-label');
  const browse = byId('artwork-file');
  const message = byId('artwork-message');
  const specs = [
    ['cropWidth', 'Crop width', 0, 95, '%'],
    ['cropHeight', 'Crop height', 0, 95, '%'],
    ['cropX', 'Crop X', -100, 100, '%'],
    ['cropY', 'Crop Y', -100, 100, '%'],
    ['hue', 'Hue', -180, 180, '°'],
    ['saturation', 'Saturation', -100, 100, '%'],
    ['brightness', 'Brightness', -100, 100, '%'],
    ['red', 'Red', 0, 255, ''],
    ['green', 'Green', 0, 255, ''],
    ['blue', 'Blue', 0, 255, '']
  ];
  let current, draft, drag, returnFocus, pendingDraw = 0;
  const controls = specs.map(([name, title, min, max, unit], i) => {
    const label = document.createElement('label');
    label.className = 'artwork-slider';
    const caption = document.createElement('span');
    caption.textContent = title;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'artwork-' + name;
    slider.min = min;
    slider.max = max;
    const value = document.createElement('output');
    value.setAttribute('for', slider.id);
    label.append(caption, slider, value);
    byId(i < 7 ? 'artwork-adjustments' : 'artwork-rgb').append(label);
    slider.addEventListener('input', () => update({ [name]: slider.value }));
    return { name, slider, value, unit };
  });

  function update(change) {
    draft = normalizeArtwork({ ...draft, ...change });
    if (!pendingDraw) pendingDraw = requestAnimationFrame(render);
  }

  function render() {
    pendingDraw = 0;
    if (!current || !isOpen()) return;
    const { source, width, height, transparent, background, target } = current;
    const image = source?.image;
    for (const { name, slider, value, unit } of controls) {
      slider.value = draft[name];
      value.textContent = draft[name] + unit;
      if (name === 'red' || name === 'green' || name === 'blue') slider.disabled = !draft.solid;
      if (name === 'hue' || name === 'saturation' || name === 'brightness') slider.disabled = draft.solid;
    }
    solid.checked = draft.solid;
    fillLabel.textContent = image ? 'Tint image' : 'Solid color';
    picker.disabled = !draft.solid;
    picker.value = solidColor(draft);
    byId('artwork-image-controls').disabled = !image;
    selection.hidden = !image;
    byId('artwork-instructions').hidden = selection.hidden;
    if (!selection.hidden) {
      const crop = cropRect(image.naturalWidth, image.naturalHeight, draft);
      Object.assign(selection.style, { left: `${crop.x * 100 / image.naturalWidth}%`,
        top: `${crop.y * 100 / image.naturalHeight}%`, width: `${crop.w * 100 / image.naturalWidth}%`,
        height: `${crop.h * 100 / image.naturalHeight}%` });
    }
    const ctx = output.getContext('2d');
    ctx.clearRect(0, 0, output.width, output.height);
    const preserveTintAlpha = (target === 'icon' || target === 'button') && tintedSource(source, draft);
    if (!transparent && !preserveTintAlpha && (source || draft.solid || target === 'card' || target === 'button')) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, output.width, output.height);
    }
    paintArtwork(ctx, source, draft, 0, 0, output.width, output.height, width, height);
    if (target === 'icon') {
      const home = bubble.getContext('2d');
      home.clearRect(0, 0, 128, 128);
      if (source || draft.solid) drawBubble(home, output, 0, 0, 128);
    }
  }

  function open(asset) {
    current = asset;
    draft = normalizeArtwork(asset.edit);
    drag = null;
    message.textContent = '';
    byId('artwork-title').textContent = asset.title;
    byId('artwork-dimensions').textContent = `${asset.width} × ${asset.height} px`;
    const icon = asset.target === 'icon';
    byId('artwork-home').hidden = !icon;
    byId('artwork-output-label').textContent = icon ? 'icon0.png' : 'Output preview';
    const scale = Math.min(1, 420 / asset.width, 220 / asset.height);
    output.width = Math.max(1, Math.round(asset.width * scale));
    output.height = Math.max(1, Math.round(asset.height * scale));
    bubble.width = bubble.height = 128;
    const image = asset.source?.image;
    sourceWrap.hidden = !image;
    byId('artwork-empty').hidden = Boolean(image);
    if (image) {
      const ratio = Math.min(1, 420 / image.naturalWidth, 240 / image.naturalHeight);
      sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      sourceWrap.style.width = sourceCanvas.width + 'px';
      sourceCanvas.getContext('2d').drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
    }
    if (!isOpen()) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        returnFocus = document.activeElement;
        dialog.classList.add('dialog-fallback');
        dialog.setAttribute('open', '');
        closeButton.focus();
      }
    }
    render();
  }

  selection.addEventListener('pointerdown', event => {
    if (!current?.source || !event.isPrimary || event.button !== 0) return;
    const { naturalWidth: width, naturalHeight: height } = current.source.image;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, resize: event.target === handle,
      crop: cropRect(width, height, draft), start: draft, width, height };
    selection.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  window.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const { width, height, crop, start } = drag;
    const bounds = sourceWrap.getBoundingClientRect();
    const dx = (event.clientX - drag.x) * width / bounds.width;
    const dy = (event.clientY - drag.y) * height / bounds.height;
    if (!drag.resize) {
      update({ cropX: moveCropAxis(start.cropX, dx, width, crop.w),
        cropY: moveCropAxis(start.cropY, dy, height, crop.h) });
      return;
    }
    const resizeAxis = (offset, visible, delta, source) => {
      const span = Math.max(source * .05, Math.min(source - offset, visible + delta));
      const trim = Math.round(100 * (1 - span / source));
      const remaining = source - Math.max(1, Math.round(source * (100 - trim) / 100));
      return [trim, remaining > 0 ? 200 * offset / remaining - 100 : 0];
    };
    const [cropWidth, cropX] = resizeAxis(crop.x, crop.w, dx, width);
    const [cropHeight, cropY] = resizeAxis(crop.y, crop.h, dy, height);
    update({ cropWidth, cropHeight, cropX, cropY });
  });
  for (const eventName of ['pointerup', 'pointercancel'])
    window.addEventListener(eventName, event => {
      if (drag?.id === event.pointerId) drag = null;
    });
  solid.addEventListener('change', () => update({ solid: solid.checked }));
  picker.addEventListener('input', () => {
    const rgb = Number.parseInt(picker.value.slice(1), 16);
    update({ red: (rgb >> 16) & 255, green: (rgb >> 8) & 255, blue: rgb & 255 });
  });
  byId('artwork-center').addEventListener('click', () => {
    const { naturalWidth: w, naturalHeight: h } = current.source.image;
    update(centerCrop(w, h, current.width, current.height));
  });
  byId('artwork-reset').addEventListener('click', () => {
    draft = normalizeArtwork();
    render();
  });
  byId('artwork-apply').addEventListener('click', () => {
    onApply(current, draft);
    close();
  });
  byId('artwork-upload').addEventListener('click', () => browse.click());
  browse.addEventListener('change', async () => {
    const file = browse.files[0];
    browse.value = '';
    if (!file) return;
    const asset = current;
    message.textContent = '';
    try { await onUpload(asset, file); }
    catch (error) { if (current === asset && isOpen()) message.textContent = error.message; }
  });
  function cleanup() {
    if (isOpen()) return;
    cancelAnimationFrame(pendingDraw);
    pendingDraw = 0;
    drag = null;
    current = null;
  }
  function close() {
    if (!dialog.classList.contains('dialog-fallback')) {
      dialog.close();
      return;
    }
    dialog.removeAttribute('open');
    dialog.classList.remove('dialog-fallback');
    cleanup();
    returnFocus?.focus();
    returnFocus = null;
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.classList.contains('dialog-fallback')) close();
  });
  dialog.addEventListener('close', cleanup);
  return { open, isEditing: key => isOpen() && current?.key === key };
}
