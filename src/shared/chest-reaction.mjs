/** Local, nonverbal boundary reactions. Pure sampling; no timers or queued clicks. */
export const CHEST_REACTION_DURATIONS = Object.freeze([4.8, 4.4, 4.4, 5]);
const ease = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const pose = (x = 0, y = 0, z = 0, lean = 0, gazeX = 0, gazeY = 0) => ({ x, y, z, lean, gazeX, gazeY });
const node = (at, emotion, phase, position, face = {}) => ({ at, emotion, phase, pose: position, face });
const offended = { blush: 0.78, smile: -0.36, cheek: 0.16, pucker: 0.18, open: 0.02, browL: -0.48, browR: -0.42 };
const firm = { blush: 0.18, smile: -0.48, cheek: 0.08, pucker: 0.08, open: 0, eye: 0.74, browL: -0.72, browR: -0.66, innerBrow: 0.04 };
const heart = { blush: 0.68, smile: 0.56, eyeSmile: 0.24, open: 0.06, eye: 1, browL: 0.14, browR: 0.18, innerBrow: 0.08 };
const sequences = [
  [
    node(0, 'surprised', 'startled', pose(0, 8, -3, 5), { open: 0.36 }),
    node(0.55, 'surprised', 'startled', pose(-2, 5, -2, 4), { open: 0.28 }),
    node(1.1, 'panic', 'flustered', pose(-4, 2, 3, 3), { open: 0.24, blush: 0.2 }),
    node(1.9, 'panic', 'flustered', pose(4, 1, -3, 2), { open: 0.16, blush: 0.4 }),
    node(2.7, 'shy', 'shy', pose(2, -6, -5, -2, 0.1, -0.35), { blush: 0.86, open: 0.02 }),
    node(4.8, 'shy', 'shy', pose(1, -5, -4, -2, 0.08, -0.3), { blush: 0.86, open: 0 }),
  ],
  [
    node(0, 'angry', 'offended', pose(-3, 1, -3, 2), offended),
    node(0.55, 'angry', 'offended', pose(-4, 2, -3, 3), offended),
    node(1.45, 'angry', 'turn-away', pose(24, 3, -4, 3, 0.95, 0.08), offended),
    node(4.4, 'angry', 'turn-away', pose(24, 2, -3, 2, 0.95, 0.06), offended),
  ],
  [
    node(0, 'angry', 'firm', pose(0, 1, 0, 1), firm),
    node(0.45, 'angry', 'firm', pose(-5, -1, -1, 2), firm),
    node(1, 'angry', 'firm', pose(5, -2, 1, 2), firm),
    node(1.55, 'angry', 'firm', pose(-3, -2, -1, 2), firm),
    node(2.2, 'angry', 'firm', pose(0, -3, 0, 1), firm),
    node(4.4, 'angry', 'firm', pose(0, -3, 0, 1), firm),
  ],
  [
    node(0, 'love', 'heart', pose(0, 1, -2, -1, 0, 0.05), heart),
    node(0.8, 'love', 'heart', pose(0, 2, -4, -2, 0, 0.08), heart),
    node(5, 'love', 'heart', pose(0, 1, -3, -1, 0, 0.04), heart),
  ],
];

export function sampleChestReaction(stage, age) {
  if (!Number.isInteger(stage) || stage < 1 || stage > sequences.length) return null;
  const index = stage - 1;
  const duration = CHEST_REACTION_DURATIONS[index];
  if (!Number.isFinite(age) || age < 0 || age >= duration) return null;
  const nodes = sequences[index];
  const next = Math.max(1, nodes.findIndex(frame => frame.at > age));
  const left = nodes[next - 1], right = nodes[next];
  const blend = ease((age - left.at) / (right.at - left.at));
  return {
    stage, age, duration, phase: blend < 0.5 ? left.phase : right.phase,
    left, right, blend,
    weight: ease(age / 0.14) * (1 - ease((age - duration + 0.65) / 0.65)),
    pose: Object.fromEntries(Object.keys(left.pose).map(key => [key, left.pose[key] + (right.pose[key] - left.pose[key]) * blend])),
  };
}
