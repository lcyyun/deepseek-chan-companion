// One pointer capture only. Native cursor sampling ends with this session; it
// never becomes a general desktop tracker. Coordinates and bounds are DIP.
function createToggleDragSession({ start, bounds, getCursor, isPressed, onMove, onRelease = () => {},
  onError = () => {}, schedule = fn => setInterval(fn, 16), unschedule = clearInterval }) {
  let active = true, moved = false, native = false, last = { x: bounds.x, y: bounds.y };
  const valid = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const matches = point => { const cursor = getCursor(); return valid(cursor) && Math.hypot(cursor.x - point.x, cursor.y - point.y) <= 24; };
  // A real pointer-down can reach Chromium before the 32ms physical-button
  // observer. Remember the matching cursor, then wait for the physical press.
  let nativeCandidate = matches(start);
  const snapshot = () => ({ active, moved, native });
  function apply(point) {
    if (!valid(point)) return;
    const dx = point.x - start.x, dy = point.y - start.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true;
    const next = { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
    if (next.x === last.x && next.y === last.y) return;
    last = next;
    onMove(next, snapshot());
  }
  function stop(reason = 'end') {
    if (!active) return snapshot();
    active = false; unschedule(timer);
    // Capture the release location even when no last pointermove was delivered.
    if (native && (reason === 'end' || reason === 'released')) apply(getCursor());
    return snapshot();
  }
  function poll() {
    if (!active) return;
    try {
      if (native && !isPressed()) { const result = stop('released'); onRelease(result); return; }
      if (!native) {
        if (!nativeCandidate || !isPressed()) return;
        native = true;
      }
      apply(getCursor());
    } catch (error) { stop('error'); onError(error); }
  }
  const timer = schedule(poll); timer?.unref?.();
  return {
    move(point) {
      if (!active) return snapshot();
      if (!native && isPressed() && matches(point)) { nativeCandidate = true; native = true; }
      if (native) poll(); // Ignore queued renderer coordinates after native takeover.
      else apply(point);
      return snapshot();
    },
    stop,
    get active() { return active; },
    get moved() { return moved; },
    get native() { return native; },
  };
}

module.exports = { createToggleDragSession };
