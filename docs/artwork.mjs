const ranges = {
  cropWidth: [0, 95], cropHeight: [0, 95], cropX: [-100, 100], cropY: [-100, 100],
  hue: [-180, 180], saturation: [-100, 100], brightness: [-100, 100], contrast: [-100, 100],
  red: [0, 255], green: [0, 255], blue: [0, 255]
};

export function normalizeArtwork(values) {
  const edit = { solid: values?.solid === true };
  for (const [name, [min, max]] of Object.entries(ranges)) {
    const value = Number(values?.[name]);
    edit[name] = Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : 0;
  }
  return edit;
}

export function hasArtworkEdits(edit) {
  return Boolean(edit?.solid || edit?.cropWidth || edit?.cropHeight ||
    edit?.hue || edit?.saturation || edit?.brightness || edit?.contrast);
}

export function solidColor(edit) {
  return '#' + [edit.red, edit.green, edit.blue].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function cropRect(width, height, edit) {
  const w = Math.max(1, Math.round(width * (100 - edit.cropWidth) / 100));
  const h = Math.max(1, Math.round(height * (100 - edit.cropHeight) / 100));
  return {
    x: Math.round((width - w) * (100 + edit.cropX) / 200),
    y: Math.round((height - h) * (100 + edit.cropY) / 200), w, h
  };
}

export function centerCrop(width, height, destinationWidth, destinationHeight) {
  const keep = (destinationWidth * height) / (destinationHeight * width);
  return { cropWidth: Math.round(100 * (1 - Math.min(1, keep))),
    cropHeight: Math.round(100 * (1 - Math.min(1, 1 / keep))), cropX: 0, cropY: 0 };
}

export function moveCropAxis(position, delta, source, visible) {
  return source === visible ? position :
    Math.min(100, Math.max(-100, Math.round(position + delta * 200 / (source - visible))));
}

function adjustColor(pixels, edit) {
  const angle = edit.hue * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const sat = 1 + edit.saturation / 100;
  const contrast = 1 + edit.contrast / 100;
  const offset = (1 - contrast) * 128 + edit.brightness * 255 / 100;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const luma = .213 * r + .715 * g + .072 * b;
    pixels[i] = Math.round((luma + sat * (c * (r - luma) + s * (b - luma))) * contrast + offset);
    pixels[i + 1] = Math.round((luma + sat * (c * (g - luma) +
      s * (.143 * r + .140 * g - .283 * b))) * contrast + offset);
    pixels[i + 2] = Math.round((luma + sat * (c * (b - luma) +
      s * (-.787 * r + .715 * g + .072 * b))) * contrast + offset);
  }
}

// Cache the expensive color conversion at the asset's destination size.
// Geometry changes and replacement images naturally invalidate the result.
const rasters = new WeakMap();
export function paintArtwork(context, source, edit, x, y, w, h, width = w, height = h) {
  if (edit?.solid && !source?.image) {
    context.fillStyle = solidColor(edit);
    context.fillRect(x, y, w, h);
    return true;
  }
  if (!source?.image) return false;
  const image = source.image;
  const crop = edit ? cropRect(image.naturalWidth, image.naturalHeight, edit) :
    { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
  const colorAdjusted = edit?.hue || edit?.saturation || edit?.brightness || edit?.contrast;
  if (!edit?.solid && !colorAdjusted) {
    // Clip sampling at the crop edges so interpolated pixels cannot bleed
    // in from sections the user excluded.
    if (crop.x === 0 && crop.y === 0 && crop.w === image.naturalWidth && crop.h === image.naturalHeight) {
      context.drawImage(image, x, y, w, h);
      return true;
    }
  }
  let raster = rasters.get(source);
  if (raster?.edit !== edit || raster?.width !== width || raster?.height !== height) {
    let cropped = image;
    if (crop.w !== image.naturalWidth || crop.h !== image.naturalHeight) {
      cropped = document.createElement('canvas');
      cropped.width = crop.w;
      cropped.height = crop.h;
      cropped.getContext('2d').drawImage(image, -crop.x, -crop.y);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const buffer = canvas.getContext('2d', { willReadFrequently: true });
    buffer.drawImage(cropped, 0, 0, width, height);
    if (edit.solid) {
      // Replace RGB inside the cropped image's existing alpha mask.
      buffer.globalCompositeOperation = 'source-in';
      buffer.fillStyle = solidColor(edit);
      buffer.fillRect(0, 0, width, height);
    } else if (colorAdjusted) {
      const pixels = buffer.getImageData(0, 0, width, height);
      adjustColor(pixels.data, edit);
      buffer.putImageData(pixels, 0, 0);
    }
    raster = { edit, width, height, canvas };
    rasters.set(source, raster);
  }
  context.drawImage(raster.canvas, x, y, w, h);
  return true;
}

export function tintedSource(source, edit) {
  return Boolean(source?.image && edit?.solid);
}

export function frameInProject(item, source, edit, importedFrameKeys) {
  return !importedFrameKeys || importedFrameKeys.includes(`${item.templateStyle}:${item.frameId}`) ||
    Boolean(source || edit?.solid || item.frameText || (item.frameTarget && item.frameTarget !== 'psla:eboot'));
}
