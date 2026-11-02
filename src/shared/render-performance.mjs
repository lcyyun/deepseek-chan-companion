/** Frame scheduling and backing-store budgets, independent of DOM and Cubism. */
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

export function renderCanvasSize(width, height, devicePixelRatio = 1, options = {}) {
  const cssWidth = positive(width, 1), cssHeight = positive(height, 1);
  const maxPixelRatio = positive(options.maxPixelRatio, 2);
  const maxCanvasPixels = Math.max(1, Math.floor(positive(options.maxCanvasPixels, 3840 * 2160)));
  const ratio = Math.min(positive(devicePixelRatio, 1), maxPixelRatio, Math.sqrt(maxCanvasPixels / (cssWidth * cssHeight)));
  // Floor instead of round so the backing store never exceeds its area budget.
  const pixelWidth = Math.min(maxCanvasPixels, Math.max(1, Math.floor(cssWidth * ratio)));
  const pixelHeight = Math.min(Math.floor(maxCanvasPixels / pixelWidth), Math.max(1, Math.floor(cssHeight * ratio)));
  return { width: pixelWidth, height: pixelHeight, ratio };
}

export function textureDecodeSize(width, height, maxTextureSize) {
  if (![width, height, maxTextureSize].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Texture dimensions and limit must be positive');
  const limit = Math.max(1, Math.floor(maxTextureSize));
  const ratio = Math.min(1, limit / Math.max(width, height));
  return { width: Math.max(1, Math.min(limit, Math.round(width * ratio))), height: Math.max(1, Math.min(limit, Math.round(height * ratio))) };
}

/** Read only the PNG header before requesting a resized decode, not the pixels. */
export function pngDimensions(header) {
  const bytes = header instanceof ArrayBuffer ? new Uint8Array(header)
    : ArrayBuffer.isView(header) ? new Uint8Array(header.buffer, header.byteOffset, header.byteLength) : null;
  if (!bytes || bytes.length < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return null;
  const width = view.getUint32(16), height = view.getUint32(20);
  return width > 0 && height > 0 && width <= 0x7fffffff && height <= 0x7fffffff ? { width, height } : null;
}

/** Deadline-based pacing avoids turning a 60-fps cap into 48 fps on 144-Hz screens. */
export function createRenderClock(maxFps = 60) {
  const fps = Math.min(240, positive(maxFps, 60)), interval = 1000 / fps;
  const epsilon = 0.0001;
  let previous = null, deadline = null;
  return {
    maxFps: fps,
    advance(time) {
      if (!Number.isFinite(time)) return null;
      if (previous === null || time < previous) {
        previous = time; deadline = time + interval; return 1 / fps;
      }
      if (time + epsilon < deadline) return null;
      const dt = (time - previous) / 1000;
      previous = time;
      deadline += Math.max(1, Math.floor((time - deadline + epsilon) / interval) + 1) * interval;
      return dt;
    },
    reset() { previous = null; deadline = null; },
  };
}
