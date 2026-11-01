export interface SpeechCombination {
  id: string;
  durationMs: number;
  command: { intent?: string; emotion?: string; gesture?: string; gaze?: string; intensity?: number };
}

/** One opening performance, clocked by playback, followed by ordinary face/body lanes. */
export function createCombinationTimeline(
  combination: SpeechCombination | null,
  apply: (sample: SpeechCombination & { key: string; progress: number }) => void,
  clear: (keepHands: boolean) => void,
  key: string,
) {
  let decided = false, active = false, ended = false, offset = 0, last = -1;
  return {
    update(elapsed: number, duration: number) {
      if (ended || !Number.isFinite(elapsed) || !Number.isFinite(duration) || elapsed < 0 || duration <= 0 || elapsed <= last) return null;
      last = elapsed;
      if (!decided) {
        decided = true;
        // Never compress a complete authored entrance/exit to fit a short reply,
        // or replay the beginning after a late/seeked first playback callback.
        if (combination && elapsed <= .25 && duration >= combination.durationMs / 1000 + .4) {
          offset = combination.durationMs / 1000;
          active = true;
        }
      }
      if (active && elapsed < offset) {
        apply({ ...combination!, key, progress: Math.min(1, elapsed / offset) });
        return null;
      }
      if (active) { active = false; clear(true); }
      return { elapsed: Math.max(0, elapsed - offset), duration: Math.max(.01, duration - offset) };
    },
    finish() { if (ended) return; ended = true; if (active) clear(false); active = false; },
    cancel() { if (ended) return; ended = true; if (active) clear(false); active = false; },
  };
}
