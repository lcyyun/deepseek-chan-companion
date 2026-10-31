import type { ExpressionCue } from '../shared/expression-cues.mjs';

/** Advance only from actual audio or reading progress, never from request time. */
export function createExpressionTimeline(cues: readonly ExpressionCue[], apply: (cue: ExpressionCue) => void) {
  let next = 0, lastChange = -Infinity, cancelled = false;
  return {
    update(elapsed: number, duration: number) {
      if (cancelled || !Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0) return;
      if (next === 0 && cues.length) { apply(cues[0]); next = 1; lastChange = elapsed; }
      let candidate: ExpressionCue | undefined;
      while (next < cues.length && cues[next].at * duration <= elapsed) candidate = cues[next++];
      // A delayed frame should select at most one face. Very short utterances
      // keep their opening expression rather than flashing through a sequence.
      if (!candidate || elapsed - lastChange < 0.75 || duration - elapsed < 0.4) return;
      apply(candidate); lastChange = elapsed;
    },
    cancel() { cancelled = true; },
  };
}
