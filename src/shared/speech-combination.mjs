import { BEHAVIOR_PRESETS } from './behavior.mjs';

/** A combination is a short opening performance, before the separate speech lanes. */
export const COMBINATION_PRESETS = Object.freeze(BEHAVIOR_PRESETS.map(preset => Object.freeze({
  id: preset.id,
  title: preset.title,
  durationMs: preset.command.durationMs,
  gesture: preset.command.gesture ?? (preset.id === 'cuddle' ? 'chest' : 'none'),
})));
export const COMBINATION_IDS = Object.freeze(COMBINATION_PRESETS.map(preset => preset.id));
const presets = new Map(BEHAVIOR_PRESETS.map(preset => [preset.id, preset]));
const metadata = new Map(COMBINATION_PRESETS.map(preset => [preset.id, preset]));

// Match the speaker's declared intent and mood, never emotional words quoted in
// the text. A mismatch leaves expression/body lanes free to express that nuance.
// Thinking is intentionally explicit-only: a finished reply should not return
// to the long waiting performance with its loading indicator.
const compatibleMoods = Object.freeze({
  greet: ['neutral', 'happy', 'joyful', 'gentle', 'curious'],
  explain: ['neutral', 'happy', 'gentle', 'curious', 'determined', 'proud', 'relieved'],
  agree: ['happy', 'joyful', 'gentle', 'relieved', 'proud'],
  disagree: ['neutral', 'determined', 'puzzled', 'cold'],
  curious: ['neutral', 'curious', 'puzzled'],
  reassure: ['neutral', 'gentle', 'worried', 'sad', 'teary', 'relieved'],
  shy: ['shy', 'embarrassed'],
  playful: ['playful', 'smug', 'squeezed', 'happy', 'joyful'],
  surprised: ['surprised'],
  cuddle: ['happy', 'joyful', 'gentle', 'shy', 'love', 'squeezed'],
  idea: ['happy', 'joyful', 'relieved', 'proud'],
});

function sentenceBucket(text) {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

/**
 * Selection only: the renderer owns real audio duration, once-per-reply limits,
 * cancellation, and the handoff to independent face/body speech timelines.
 */
export function planSpeechCombination(segment, options = {}) {
  if (!segment || typeof segment !== 'object') return null;
  const frequency = Number.isFinite(options.frequency) ? Math.max(0, Math.min(1.5, options.frequency)) : 1;
  if (frequency === 0) return null;
  const requested = segment.combination ?? 'auto';
  if (requested === 'none') return null;
  const automatic = requested === 'auto';
  if (automatic && segment.bodyAnimation !== undefined && segment.bodyAnimation !== 'auto') return null;
  const mood = segment.emotion ?? 'neutral';
  const id = automatic ? segment.intent : requested;
  const preset = presets.get(id);
  if (!preset || options.skipIdea && id === 'idea') return null;
  if (automatic && !compatibleMoods[id]?.includes(mood)) return null;
  if (frequency < 1 && sentenceBucket(typeof segment.text === 'string' ? segment.text : '') >= frequency) return null;
  const entry = metadata.get(id);
  // Return a fresh command: shortening its opening for an actual audio clip
  // must never mutate the manual preset or a future reply's performance.
  const command = { ...preset.command, gesture: entry.gesture };
  if (automatic && command.emotion === undefined) command.emotion = mood;
  return { ...entry, command };
}
