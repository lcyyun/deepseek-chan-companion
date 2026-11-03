/** Opt-in, bounded WebGL 1 draw timing. Never waits for the GPU or reads pixels. */
export type GpuTimingPhase = 'idle' | 'thinking' | 'idea' | 'speaking' | 'other';
export type GpuTimingReason = 'not-started' | 'capturing' | 'draining' | 'completed' | 'stopped'
  | 'unsupported' | 'observer-overhead' | 'timer-error' | 'disposed';
export interface GpuPhaseTiming {
  label: GpuTimingPhase; samples: number; gpuMeanMs: number; gpuP95Ms: number; gpuMaxMs: number;
}
export interface GpuTimingSnapshot {
  supported: boolean; active: boolean; samples: number; pending: number;
  gpuMeanMs: number; gpuP95Ms: number; gpuMaxMs: number; pollCpuMaxMs: number;
  disjointCount: number; timeoutCount: number; reason: GpuTimingReason; phases: GpuPhaseTiming[];
}
interface TimerExtension {
  TIME_ELAPSED_EXT: number; QUERY_RESULT_AVAILABLE_EXT: number; QUERY_RESULT_EXT: number; GPU_DISJOINT_EXT: number;
  createQueryEXT(): WebGLQuery | null;
  beginQueryEXT(target: number, query: WebGLQuery): void;
  endQueryEXT(target: number): void;
  deleteQueryEXT(query: WebGLQuery): void;
  getQueryObjectEXT(query: WebGLQuery, parameter: number): unknown;
}
interface TimingDependencies {
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}
interface PendingQuery { query: WebGLQuery; label: GpuTimingPhase; issuedAt: number }
const PHASES: GpuTimingPhase[] = ['idle', 'thinking', 'idea', 'speaking', 'other'];
const MAX_PENDING = 4, MAX_RESULTS = 64, SAMPLE_MS = 500, POLL_MS = 250, TIMEOUT_MS = 3000, MAX_CAPTURE_MS = 15000;

/** `beginFrame`/`endFrame` bracket the complete SDK draw, including mirrored arms.
 * Call `endFrame` in a finally block. `stop` on hide and `dispose` on destruction.
 * This measures GPU draw execution, not browser composition or screen presentation.
 * Constructing, snapshotting, and leaving this disabled do not touch WebGL at all.
 */
export function createGpuDrawTimer(gl: WebGLRenderingContext, dependencies: TimingDependencies = {}) {
  const now = dependencies.now || (() => performance.now());
  const schedule = dependencies.setInterval || ((callback, delay) => setInterval(callback, delay));
  const unschedule = dependencies.clearInterval || (timer => clearInterval(timer as ReturnType<typeof setInterval>));
  let extension: TimerExtension | null = null, interval: unknown = null;
  let supported = false, active = false, accepting = false, disposed = false;
  let reason: GpuTimingReason = 'not-started', deadline = 0, lastSampleAt = -Infinity;
  let current: PendingQuery | null = null, currentBegan = false, pending: PendingQuery[] = [];
  let results: { label: GpuTimingPhase; ms: number }[] = [];
  let pollCpuMaxMs = 0, disjointCount = 0, timeoutCount = 0;

  function deleteQuery(item: PendingQuery) {
    try { extension?.deleteQueryEXT(item.query); } catch { /* Diagnostics must never interrupt rendering. */ }
  }
  function clearIntervalHandle() {
    if (interval !== null) { try { unschedule(interval); } catch {} interval = null; }
  }
  function halt(nextReason: GpuTimingReason) {
    accepting = false; active = false; reason = nextReason; clearIntervalHandle();
    if (current) {
      if (currentBegan) { try { extension?.endQueryEXT(extension.TIME_ELAPSED_EXT); } catch {} }
      deleteQuery(current); current = null; currentBegan = false;
    }
    for (const item of pending) deleteQuery(item);
    pending = [];
  }
  function updateDeadline(time: number) {
    if (accepting && time >= deadline) { accepting = false; reason = 'draining'; }
    if (active && !accepting && !current && !pending.length) halt('completed');
  }
  function overBudget(started: number) {
    const elapsed = Math.max(0, now() - started);
    pollCpuMaxMs = Math.max(pollCpuMaxMs, elapsed);
    if (elapsed > 8) { halt('observer-overhead'); return true; }
    return false;
  }
  function poll() {
    if (!active || !extension) return;
    const started = now();
    try {
      updateDeadline(started);
      if (!active) return;
      // Both the individual query and the entire drain have a hard time limit.
      for (const item of [...pending]) {
        if (started - item.issuedAt >= TIMEOUT_MS || started >= deadline + TIMEOUT_MS) {
          pending.splice(pending.indexOf(item), 1); timeoutCount++; deleteQuery(item);
          if (overBudget(started)) return;
        }
      }
      const ready: PendingQuery[] = [];
      for (const item of pending) {
        if (extension.getQueryObjectEXT(item.query, extension.QUERY_RESULT_AVAILABLE_EXT)) ready.push(item);
        if (overBudget(started)) return;
      }
      if (ready.length) {
        // Availability is checked first. Never request a result that could block.
        const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
        if (overBudget(started)) return;
        if (disjoint) {
          disjointCount++;
          for (const item of pending) deleteQuery(item);
          pending = [];
        } else for (const item of ready) {
          const nanoseconds = Number(extension.getQueryObjectEXT(item.query, extension.QUERY_RESULT_EXT));
          if (overBudget(started)) return;
          if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
            results.push({ label: item.label, ms: nanoseconds / 1e6 });
            if (results.length > MAX_RESULTS) results.shift();
          }
          pending.splice(pending.indexOf(item), 1); deleteQuery(item);
          if (overBudget(started)) return;
        }
      }
      updateDeadline(now());
    } catch { halt('timer-error'); }
    finally {
      // Also include cleanup/error overhead in the recorded cost.
      const elapsed = Math.max(0, now() - started);
      pollCpuMaxMs = Math.max(pollCpuMaxMs, elapsed);
      if (elapsed > 8 && reason !== 'disposed') halt('observer-overhead');
    }
  }
  function aggregate(values: number[]) {
    if (!values.length) return { samples: 0, gpuMeanMs: 0, gpuP95Ms: 0, gpuMaxMs: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return { samples: values.length, gpuMeanMs: values.reduce((a, b) => a + b, 0) / values.length,
      gpuP95Ms: sorted[Math.ceil(sorted.length * .95) - 1], gpuMaxMs: sorted[sorted.length - 1] };
  }
  function snapshot(): GpuTimingSnapshot {
    return { supported, active, pending: pending.length + (current ? 1 : 0), reason,
      ...aggregate(results.map(item => item.ms)), pollCpuMaxMs, disjointCount, timeoutCount,
      phases: PHASES.filter(label => results.some(item => item.label === label))
        .map(label => ({ label, ...aggregate(results.filter(item => item.label === label).map(item => item.ms)) })) };
  }
  return {
    start(durationMs = MAX_CAPTURE_MS) {
      if (disposed) return { supported, active: false, reason };
      halt('not-started'); results = []; pollCpuMaxMs = 0; disjointCount = 0; timeoutCount = 0;
      supported = false; extension = null; lastSampleAt = -Infinity;
      try {
        extension = gl.getExtension('EXT_disjoint_timer_query') as TimerExtension | null;
        if (!extension) { reason = 'unsupported'; return { supported, active, reason }; }
        supported = true;
        const duration = Number.isFinite(durationMs) ? Math.min(MAX_CAPTURE_MS, Math.max(1, durationMs)) : MAX_CAPTURE_MS;
        deadline = now() + duration; accepting = true; active = true; reason = 'capturing';
        interval = schedule(poll, POLL_MS);
      } catch { halt('timer-error'); }
      return { supported, active, reason };
    },
    beginFrame(label: string, time?: number) {
      if (!active || !accepting || !extension || current) return false;
      const at = Number.isFinite(time) ? time! : now();
      updateDeadline(at);
      if (!active || !accepting || at - lastSampleAt < SAMPLE_MS || pending.length >= MAX_PENDING) return false;
      try {
        const query = extension.createQueryEXT();
        if (!query) { halt('timer-error'); return false; }
        current = { query, label: PHASES.includes(label as GpuTimingPhase) ? label as GpuTimingPhase : 'other', issuedAt: at };
        extension.beginQueryEXT(extension.TIME_ELAPSED_EXT, query); currentBegan = true; lastSampleAt = at;
        return true;
      } catch { halt('timer-error'); return false; }
    },
    endFrame() {
      if (!current || !extension) return;
      try {
        extension.endQueryEXT(extension.TIME_ELAPSED_EXT); currentBegan = false;
        pending.push(current); current = null;
      } catch { halt('timer-error'); }
    },
    snapshot,
    stop() { if (active) halt('stopped'); },
    dispose() { halt('disposed'); disposed = true; extension = null; },
  };
}
