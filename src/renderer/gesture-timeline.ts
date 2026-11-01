import type { GestureCue, SpeechGestureSample } from '../shared/gesture-cues.mjs';

let sequence = 0;
interface GestureTimelineOptions {
  /** Consecutive segments with the same final/first pose need no arm round-trip. */
  holdLast?: boolean;
  continueFirst?: boolean;
  key?: string;
}
interface ScheduledGesture { cue: GestureCue; index: number; start: number; end: number; duration: number; hold: boolean }

/**
 * Body cues use the real audio/read clock. No timer runs before playback, while
 * paused, or after cancellation. Late frames drop expired gestures rather than
 * replaying a queue of arm entrances. `finish` is normal completion; `cancel`
 * always releases the body lane, including a pose carried from an earlier line.
 */
export function createGestureTimeline(
  cues: readonly GestureCue[],
  apply: (sample: SpeechGestureSample) => void,
  clear: () => void,
  options: GestureTimelineOptions = {},
) {
  const key = options.key ?? `speech-body-${++sequence}`;
  const safeCues = [...cues].filter(cue => cue && Number.isFinite(cue.at) && cue.at >= 0 && cue.at <= .8)
    .sort((a, b) => a.at - b.at).slice(0, 3);
  let scheduled: ScheduledGesture[] | null = null;
  let next = 0, active: ScheduledGesture | null = null;
  let ended = false, cancelled = false, lastElapsed = -Infinity, lastProgress = -1;
  let carrying = Boolean(options.continueFirst), released = false;

  const release = () => {
    if (!released) clear();
    released = true; carrying = false; active = null;
  };
  const publish = (item: ScheduledGesture, progress: number) => {
    if (progress === lastProgress && active === item) return;
    lastProgress = progress; released = false;
    apply({ ...item.cue, key: `${key}:${item.index}`, progress, durationMs: item.duration * 1000 });
  };
  const plan = (duration: number) => {
    const items: ScheduledGesture[] = [];
    for (let index = 0; index < safeCues.length; index++) {
      const cue = safeCues[index];
      const start = Math.max(0, cue.at * duration - .25);
      const minimum = cue.gesture === 'none' ? 1.35 : 2.8;
      if (duration - start < minimum) continue;
      const previous = items.at(-1);
      if (previous && start < previous.end + .45) continue;
      const span = Math.min(cue.gesture === 'none' ? 3.2 : 4.2, duration - start - .15);
      items.push({ cue, index, start, end: start + span, duration: span, hold: false });
    }
    if (options.holdLast && items.length) {
      const last = items.at(-1)!;
      // Retain continuity only when the planned final cue actually survived the
      // real-duration filter. A skipped cue must not hold the wrong hand pose.
      if (last.index === safeCues.length - 1) { last.hold = true; last.end = duration; }
    }
    return items;
  };

  return {
    update(elapsed: number, duration: number) {
      if (ended || cancelled || !Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(duration) || duration <= 0 || elapsed < lastElapsed) return;
      scheduled ??= plan(duration);
      lastElapsed = elapsed;

      if (active && elapsed >= active.end && !active.hold) {
        publish(active, 1); release();
      }
      while (next < scheduled.length && scheduled[next].start <= elapsed) {
        const item = scheduled[next++];
        // Actual playback can begin at a late offset after buffering/seeking.
        // Never start an already expired flourish or accelerate it to catch up.
        if (elapsed >= item.end || elapsed - item.start > .8) continue;
        active = item; lastProgress = -1; released = false;
      }
      if (active) {
        const skipEntrance = options.continueFirst && active.index === 0;
        const initial = skipEntrance ? .28 : 0;
        const progress = initial + (1 - initial) * Math.max(0, elapsed - active.start) / active.duration;
        publish(active, Math.min(active.hold ? .72 : 1, progress));
        carrying = active.hold;
      } else if (carrying) {
        // A very short new segment may reject its first gesture. The previous
        // pose must still be released, not remain latched indefinitely.
        release();
      }
    },
    finish() {
      if (cancelled || ended) return;
      ended = true;
      if (active?.hold) { publish(active, .72); carrying = true; }
      else release();
    },
    cancel() {
      if (cancelled) return;
      cancelled = true; ended = true; release();
    },
  };
}
