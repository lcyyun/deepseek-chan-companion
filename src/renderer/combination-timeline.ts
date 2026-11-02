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
        // A preset must still be visible on a very short spoken reply. Compress
        // the authored opening into the available audio instead of dropping it
        // entirely; long replies keep the original authored duration.
        if (combination && elapsed <= .6) {
          const available = Math.max(.35, Math.min(combination.durationMs / 1000, duration - .05));
          if (available > .2) { offset = available; active = true; }
        }
      }
      if (active && elapsed < offset) {
        // Keep the behavior action in the same shortened clock as the timeline.
        apply({ ...combination!, durationMs: offset * 1000, key, progress: Math.min(1, elapsed / offset) });
        return null;
      }
      if (active) { active = false; clear(true); }
      return { elapsed: Math.max(0, elapsed - offset), duration: Math.max(.01, duration - offset) };
    },
    finish() { if (ended) return; ended = true; if (active) clear(false); active = false; },
    cancel() { if (ended) return; ended = true; if (active) clear(false); active = false; },
  };
}
