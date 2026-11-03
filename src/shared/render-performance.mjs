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
  // rAF timestamps may be rounded down to 0.1–1ms. Treat that small early
  // arrival as the same display tick; otherwise a 60Hz screen can fall to
  // 40fps simply because 16.6 is less than 16.666.... Keep the fixed deadline
  // grid, rather than scheduling from the last (possibly late) callback.
  const tolerance = Math.min(1, interval * .1), minSpacing = interval / 2;
  let previous = null, observed = null, origin = 0, nextTick = 0;
  return {
    maxFps: fps,
    advance(time) {
      if (!Number.isFinite(time)) return null;
      const backwards = observed !== null && time < observed;
      observed = time;
      if (previous === null || backwards) {
        previous = time; origin = time; nextTick = 1; return 1 / fps;
      }
      const deadline=origin+nextTick*interval;
      const numericSlack=Math.max(1e-7,Math.abs(time)*Number.EPSILON*4);
      // A late callback close to the following deadline must not be followed
      // by a near-zero-step catch-up frame (e.g. 32.3ms then 33.4ms).
      if (time + tolerance + numericSlack < deadline || time - previous + numericSlack < minSpacing) return null;
      const dt = (time - previous) / 1000;
      previous = time;
      nextTick=Math.max(nextTick+1,Math.floor((time-origin+tolerance+numericSlack)/interval)+1);
      return dt;
    },
    reset() { previous = null; observed = null; origin = 0; nextTick = 0; },
  };
}

/** Bounded diagnostics only: record is allocation-free; snapshots sort at read time. */
export function createRenderDiagnostics(capacity = 120) {
  const limit = Math.max(1, Math.min(120, Math.floor(positive(capacity, 120))));
  const intervals = new Float64Array(limit), costs = new Float64Array(limit);
  const rafIntervals = new Float64Array(limit), rafLags = new Float64Array(limit);
  let intervalAt = 0, intervalCount = 0, costAt = 0, costCount = 0;
  let rafIntervalAt = 0, rafIntervalCount = 0, rafLagAt = 0, rafLagCount = 0;
  let previousRaf = null, rafCallbacks = 0;
  let previous = null, wallElapsedMs = 0, logicElapsedSeconds = 0, longFrames = 0;
  const resetTiming = () => {
    previous = previousRaf = null; intervalAt = intervalCount = costAt = costCount = 0;
    rafIntervalAt = rafIntervalCount = rafLagAt = rafLagCount = 0;
  };
  const latest = (buffer, at, count) => Array.from({ length: count }, (_, i) => buffer[(at - 1 - i + limit) % limit]);
  const summary = values => {
    if (!values.length) return { mean: 0, p95: 0, max: 0 };
    const sorted = values.sort((a, b) => a - b);
    return { mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted[sorted.length - 1] };
  };
  return {
    /** Observe every callback before the frame cap, including callbacks skipped
     * by the app. The entry/stamp difference is NOT compositor or DWM latency. */
    observeRaf(timestamp, enteredAt) {
      if (!Number.isFinite(timestamp) || timestamp < 0 || !Number.isFinite(enteredAt) || enteredAt < 0) return false;
      if (previousRaf !== null && timestamp < previousRaf) resetTiming();
      if (previousRaf !== null) {
        rafIntervals[rafIntervalAt] = timestamp - previousRaf;
        rafIntervalAt = (rafIntervalAt + 1) % limit;
        rafIntervalCount = Math.min(limit, rafIntervalCount + 1);
      }
      previousRaf = timestamp; rafCallbacks++;
      // Browsers can quantize the two same-origin clocks differently.
      rafLags[rafLagAt] = Math.max(0, enteredAt - timestamp);
      rafLagAt = (rafLagAt + 1) % limit; rafLagCount = Math.min(limit, rafLagCount + 1);
      return true;
    },
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
      const recentRafIntervals = []; let rafWindowMs = 0;
      for (let i = 0; i < rafIntervalCount && rafWindowMs < 2000; i++) {
        const value = rafIntervals[(rafIntervalAt - 1 - i + limit) % limit];
        recentRafIntervals.push(value); rafWindowMs += value;
      }
      const rafRecentSamples = Math.min(rafLagCount, recentRafIntervals.length + (rafWindowMs < 2000 ? 1 : 0));
      const rafInterval = summary(recentRafIntervals), lag = summary(latest(rafLags, rafLagAt, rafRecentSamples));
      return { recentSamples: samples, windowMs, recentFps: interval.mean > 0 ? 1000 / interval.mean : 0,
        frameIntervalP95Ms: interval.p95, frameIntervalMaxMs: interval.max, renderMeanMs: render.mean, renderP95Ms: render.p95,
        rafCallbacks, rafRecentSamples, rafWindowMs, rafRecentFps: rafInterval.mean > 0 ? 1000 / rafInterval.mean : 0,
        rafIntervalP95Ms: rafInterval.p95, rafIntervalMaxMs: rafInterval.max,
        rafCallbackLagMeanMs: lag.mean, rafCallbackLagP95Ms: lag.p95, rafCallbackLagMaxMs: lag.max,
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
