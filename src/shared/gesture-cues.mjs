/** Semantic body gestures. This module never chooses or modifies a face. */
import { BODY_ANIMATION_PRESETS } from './body-animation.mjs';
export const SPEECH_GESTURE_IDS = Object.freeze(BODY_ANIMATION_PRESETS.map(item => item.id));

const ALIASES = Object.freeze({
  explain: 'explain', disagree: 'explain', think: 'think', curious: 'think',
  reassure: 'reassure', cuddle: 'reassure', shy: 'shy',
  happy: 'happy', greet: 'happy', agree: 'happy', idea: 'happy', playful: 'happy', listen: 'listen',
});
const HANDS = new Set(['none', 'pointer', 'chest', 'foxtail']);
const DEFAULT_HAND = Object.freeze({ explain: 'pointer', think: 'pointer', reassure: 'chest', shy: 'chest', happy: 'none', listen: 'none' });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sentenceBucket = text => {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
};

/**
 * One main gesture for a short reply; longer explanations may emphasize a later
 * clause. Offsets describe semantic locations, not a guessed speech duration.
 * Explicit `gesture: 'none'` retains body/attention motion without raising a hand.
 * No keyword changes emotion: words such as "害怕" may describe someone else.
 */
export function planGestureCues(segment, options = {}) {
  if (!segment || typeof segment.text !== 'string') return [];
  const text = segment.text.trim().slice(0, 6000);
  const frequency = Number.isFinite(options.frequency) ? clamp(options.frequency, 0, 1.5) : 1;
  if (!text || frequency === 0) return [];
  // Below 100%, choose fewer sentences, not weaker gestures. The stable bucket
  // gives replay/tests the same choices and never introduces per-frame jitter.
  if (frequency < 1 && sentenceBucket(text) >= frequency) return [];
  if (segment.bodyAnimation === 'none') return [];
  const chosen = BODY_ANIMATION_PRESETS.find(item => item.id === segment.bodyAnimation);
  const explicitHand = HANDS.has(segment.gesture) ? segment.gesture : null;
  let id = chosen?.id ?? (Object.hasOwn(ALIASES, segment.intent) ? ALIASES[segment.intent] : null)
    ?? (explicitHand === 'pointer' ? 'explain' : explicitHand === 'chest' ? 'reassure' : explicitHand === 'foxtail' ? 'happy' : null);
  if (!id) return [];
  let gesture = chosen?.gesture ?? explicitHand ?? DEFAULT_HAND[id];
  // Acknowledgements need a small response, not a full arm entrance and exit.
  const spokenUnits = Array.from(text.replace(/[\s\p{P}\p{S}]/gu, '')).length;
  if (spokenUnits < 2) return [];
  if (!chosen && id === 'explain' && gesture === 'pointer' && spokenUnits >= 24) {
    id = 'talk';
  }
  const preset = BODY_ANIMATION_PRESETS.find(item => item.id === id);
  const intensity = ({ explain: .65, think: .56, reassure: .58, happy: .65, shy: .68, listen: .68 })[id] ?? .68;
  const cues = [{ at: 0, id, gesture: spokenUnits < 8 ? 'none' : gesture, intensity, ...(preset?.continuous ? { continuous: true } : {}) }];
  // Sustained speech is one performance with internal pauses/accents, not a
  // queue that lowers and raises the same arm at every clause boundary.
  if (preset?.continuous) return cues;
  const maxCues = frequency < .75 || spokenUnits < 48 ? 1 : spokenUnits >= 150 && frequency >= 1.25 ? 3 : 2;
  if (maxCues === 1 || !['explain', 'think'].includes(id)) return cues;

  // Use clause boundaries instead of an arbitrary repeating beat. Matching only
  // a clause's opening avoids emphasizing keywords inside quoted explanations.
  const clauses = /(?:^|[，。！？；：,.!?;:\n])\s*(?:而且|不过|但是|所以|因此|其实|关键|重点|首先|其次|最后|另外|建议|注意|for example\b|however\b|therefore\b|finally\b|first\b|second\b|also\b)/giu;
  for (const match of text.matchAll(clauses)) {
    const at = clamp(match.index / text.length, 0, .8);
    if (match.index / text.length > .8 || at - cues.at(-1).at < .3) continue;
    cues.push({ at, id, gesture, intensity: Math.max(.3, intensity - .08) });
    if (cues.length === maxCues) break;
  }
  return cues;
}

/** Only identical body/hand combinations can carry across a sentence boundary. */
export function canContinueGesture(previous, next) {
  return Boolean(previous && next && previous.id === next.id && previous.gesture === next.gesture);
}
