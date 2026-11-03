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

/** Bounded diagnostics only: record is allocation-free; snapshots sort at read time. */
export function createRenderDiagnostics(capacity = 120) {
  const limit = Math.max(1, Math.min(120, Math.floor(positive(capacity, 120))));
  const intervals = new Float64Array(limit), costs = new Float64Array(limit);
  let intervalAt = 0, intervalCount = 0, costAt = 0, costCount = 0;
  let previous = null, wallElapsedMs = 0, logicElapsedSeconds = 0, longFrames = 0;
  const resetTiming = () => { previous = null; intervalAt = intervalCount = costAt = costCount = 0; };
  const latest = (buffer, at, count) => Array.from({ length: count }, (_, i) => buffer[(at - 1 - i + limit) % limit]);
  const summary = values => {
    if (!values.length) return { mean: 0, p95: 0, max: 0 };
    const sorted = values.sort((a, b) => a - b);
    return { mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted[sorted.length - 1] };
  };
  return {
    record(time, renderMs, logicStepSeconds) {
      if (!Number.isFinite(time) || time < 0 || !Number.isFinite(renderMs) || renderMs < 0 || !Number.isFinite(logicStepSeconds) || logicStepSeconds < 0) return false;
      if (previous !== null && time < previous) resetTiming();
      if (previous !== null) {
        const interval = time - previous;
        intervals[intervalAt] = interval; intervalAt = (intervalAt + 1) % limit;
        intervalCount = Math.min(limit, intervalCount + 1);
        wallElapsedMs += interval;
        if (interval > 40) longFrames++;
      }
      previous = time; logicElapsedSeconds += logicStepSeconds;
      costs[costAt] = renderMs; costAt = (costAt + 1) % limit;
      costCount = Math.min(limit, costCount + 1);
      return true;
    },
    // A hidden period is not a stalled frame. Retain lifetime counters but
    // start the recent window and interval baseline afresh on pause/resume.
    resetTiming,
    snapshot() {
      // At low fps, 120 frames could hide a stall under half a minute of data.
      // Read backwards over about two active seconds; keep a whole long gap.
      const recentIntervals = []; let windowMs = 0;
      for (let i = 0; i < intervalCount && windowMs < 2000; i++) {
        const value = intervals[(intervalAt - 1 - i + limit) % limit];
        recentIntervals.push(value); windowMs += value;
      }
      const samples = Math.min(costCount, recentIntervals.length + (windowMs < 2000 ? 1 : 0));
      const interval = summary(recentIntervals), render = summary(latest(costs, costAt, samples));
      return { recentSamples: samples, windowMs, recentFps: interval.mean > 0 ? 1000 / interval.mean : 0,
        frameIntervalP95Ms: interval.p95, frameIntervalMaxMs: interval.max, renderP95Ms: render.p95,
        longFrames, wallElapsedMs, logicElapsedSeconds };
    },
  };
}

/** Read the actual WebGL backend once, with a normal fallback on restricted contexts. */
export function readGraphicsInfo(gl) {
  const empty = { gpuRenderer: '', gpuVendor: '', gpuInfoSource: 'unavailable' };
  if (!gl) return empty;
  const read = key => {
    try {
      const value = gl.getParameter(key);
      return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 512) : '';
    } catch { return ''; }
  };
  let extension;
  try { extension = gl.getExtension('WEBGL_debug_renderer_info'); } catch {}
  const vendor = extension ? read(extension.UNMASKED_VENDOR_WEBGL) : '';
  const renderer = extension ? read(extension.UNMASKED_RENDERER_WEBGL) : '';
  const gpuVendor = vendor || read(gl.VENDOR), gpuRenderer = renderer || read(gl.RENDERER);
  return { gpuRenderer, gpuVendor, gpuInfoSource: vendor || renderer ? 'unmasked' : gpuVendor || gpuRenderer ? 'standard' : 'unavailable' };
}
