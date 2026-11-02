/** Sum pointer deltas and keep at most one desktop IPC in flight. */
export function createMoveQueue(send, { schedule = callback => setTimeout(callback, 16), cancel = clearTimeout } = {}) {
  let dx = 0, dy = 0, timer = null, sending = false, urgent = false, disposed = false;
  const arm = () => { if (!disposed && timer === null && !sending && (dx || dy)) timer = schedule(() => { timer = null; drain(); }); };
  function drain() {
    if (disposed || sending || (!dx && !dy)) return;
    // Main clamps each IPC axis to 2000 DIP. Keep overflow queued instead of
    // dropping it when fast movement accumulates behind a slow native update.
    const delta = { dx: Math.max(-2000, Math.min(2000, dx)), dy: Math.max(-2000, Math.min(2000, dy)) };
    dx -= delta.dx; dy -= delta.dy; sending = true;
    let result;
    try { result = send(delta); } catch { result = undefined; }
    Promise.resolve(result).catch(() => {}).finally(() => { sending = false; if (urgent) drain(); else arm(); });
  }
  const clear = () => { if (timer !== null) cancel(timer); timer = null; dx = 0; dy = 0; urgent = false; };
  return {
    push(x, y) { if (disposed || !Number.isFinite(x) || !Number.isFinite(y)) return; dx += x; dy += y; urgent = false; arm(); },
    flush() { if (timer !== null) cancel(timer); timer = null; urgent = true; drain(); },
    cancel: clear,
    dispose() { clear(); disposed = true; },
  };
}

/** Outward rounding preserves the protected hit area while suppressing float jitter. */
export function quantizeRegion(rect, grid = 4) {
  if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.floor(rect.x / grid) * grid, y = Math.floor(rect.y / grid) * grid;
  return { x, y, width: Math.ceil((rect.x + rect.width) / grid) * grid - x, height: Math.ceil((rect.y + rect.height) / grid) * grid - y };
}
