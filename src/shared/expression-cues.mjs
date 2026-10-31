import { EXPRESSION_IDS } from './expressions.mjs';

/** A small, bounded face score. The renderer times it against actual playback. */
export function normalizeExpressionCues(input, baseEmotion = 'neutral', baseIntensity = 0.7) {
  const validEmotion = value => EXPRESSION_IDS.includes(value);
  const intensity = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.7;
  const first = { at: 0, emotion: validEmotion(baseEmotion) ? baseEmotion : 'neutral', intensity: intensity(baseIntensity) };
  if (!Array.isArray(input)) return [first];
  const rows = input.slice(0, 24).filter(cue => cue && validEmotion(cue.emotion) && Number.isFinite(cue.at) && cue.at >= 0 && cue.at <= 0.9)
    .map(cue => ({ at: cue.at, emotion: cue.emotion, intensity: intensity(cue.intensity) })).sort((a, b) => a.at - b.at);
  const cues = [rows[0]?.at === 0 ? rows.shift() : first];
  for (const row of rows) {
    const previous = cues.at(-1);
    if (row.at - previous.at < 0.18 || row.emotion === previous.emotion && Math.abs(row.intensity - previous.intensity) < 0.15) continue;
    cues.push(row);
    if (cues.length === 4) break;
  }
  return cues;
}
