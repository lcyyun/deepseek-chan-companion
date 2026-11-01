/** Deliberate, bounded gestures on the already calibrated arm poses. */
export const BODY_ANIMATION_PRESETS = Object.freeze([
  { id: 'explain', title: '讲到重点', description: '抬手示意，稍稍前倾，再从容收势', durationMs: 5600 },
  { id: 'think', title: '侧头琢磨', description: '指尖靠近嘴边，抬头想一会儿', durationMs: 6200 },
  { id: 'reassure', title: '轻声安慰', description: '慢慢抚胸，轻轻靠近', durationMs: 6000 },
  { id: 'happy', title: '轻快回应', description: '抬手回应，身体轻轻上提', durationMs: 4800 },
  { id: 'shy', title: '含蓄躲闪', description: '收手抚胸，低头后悄悄看回来', durationMs: 6200 },
  { id: 'listen', title: '认真听你', description: '微微侧身，停下来听，轻轻点头', durationMs: 6400 },
].map(item => Object.freeze(item)));

const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, Number.isFinite(x) ? x : 0));
const ease = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const keys = ['headX', 'headY', 'headZ', 'gazeX', 'gazeY', 'bodyX', 'bodyY', 'bodyZ', 'lean', 'lift', 'turn'];
const neutral = Object.freeze(Object.fromEntries(keys.map(key => [key, 0])));
// Repeated keys create real holds. No frame-random motion or looping hand beats.
const sequences = {
  explain: { gesture: 'pointer', pose: 'idea', frames: [
    [0, {}], [.18, { headX: -3, headY: 2, gazeX: -.18, bodyX: -1, lean: -2, lift: -.5 }],
    [.38, { headY: 4, gazeY: .05, bodyY: 1, lean: -4, lift: 1 }],
    [.54, { headY: 3, gazeY: .05, bodyY: .6, lean: -4, lift: .7 }],
    [.7, { headY: 1, headZ: -2, bodyZ: -.8, lean: -2, lift: .2 }], [1, {}],
  ] },
  think: { gesture: 'pointer', pose: 'think', frames: [
    [0, {}], [.22, { headX: 17, headY: 8, headZ: 2, gazeX: .24, gazeY: .6, bodyX: 1, bodyZ: .7, lift: -.3 }],
    [.43, { headX: 17, headY: 8, headZ: 2, gazeX: .24, gazeY: .6, bodyX: 1, bodyZ: .7, lift: -.3 }],
    [.62, { headX: 18, headY: 9, headZ: 3, gazeX: .32, gazeY: .65, bodyX: 1.6, bodyZ: 1, lift: .4 }],
    [.78, { headX: 17, headY: 8, headZ: 2, gazeX: .24, gazeY: .6, bodyX: 1, bodyZ: .7, lift: -.1 }], [1, {}],
  ] },
  reassure: { gesture: 'chest', pose: 'chest', frames: [
    [0, {}], [.25, { headZ: -4, headY: -1, gazeY: -.05, bodyZ: -1, lean: -5, lift: .3 }],
    [.5, { headZ: -4, headY: -1, gazeY: -.05, bodyZ: -1, lean: -5, lift: .3 }],
    [.67, { headZ: -3, headY: 1, gazeY: 0, bodyZ: -.7, lean: -4, lift: .7 }], [1, {}],
  ] },
  happy: { gesture: 'pointer', pose: 'idea', frames: [
    [0, {}], [.24, { headY: 3, headZ: 2, gazeY: .05, bodyY: 1.4, bodyZ: .8, lean: -2, lift: 1 }],
    [.43, { headY: 1, headZ: 1, gazeY: 0, bodyY: .5, bodyZ: .5, lean: -1, lift: .4 }],
    [.6, { headY: 2, headZ: 2, gazeY: 0, bodyY: .7, bodyZ: .5, lean: -1, lift: .55 }], [1, {}],
  ] },
  shy: { gesture: 'chest', pose: 'chest', frames: [
    [0, {}], [.25, { headX: 7, headY: -5, headZ: -4, gazeX: .4, gazeY: -.3, bodyX: 1.2, bodyZ: -1, lean: 2, lift: -.5 }],
    [.48, { headX: 7, headY: -5, headZ: -4, gazeX: .4, gazeY: -.3, bodyX: 1.2, bodyZ: -1, lean: 2, lift: -.5 }],
    [.7, { headX: 3, headY: -3, headZ: -2, gazeX: 0, gazeY: -.05, bodyX: .8, bodyZ: -.5, lean: 1, lift: -.2 }], [1, {}],
  ] },
  listen: { gesture: 'none', pose: null, frames: [
    [0, {}], [.22, { headZ: 4, gazeX: .04, bodyZ: 1.2, lean: -3 }],
    [.46, { headZ: 4, gazeX: .04, bodyZ: 1.2, lean: -3 }],
    [.59, { headZ: 3, headY: -2.5, gazeX: 0, bodyZ: 1, lean: -3.5 }],
    [.71, { headZ: 3, headY: 1.5, gazeX: 0, bodyZ: 1, lean: -3 }], [1, {}],
  ] },
};

export function bodyAnimationId(value) {
  const id = ({ greet: 'happy', agree: 'happy', idea: 'happy', curious: 'think', disagree: 'explain', playful: 'happy', cuddle: 'reassure' })[value] ?? value;
  return Object.hasOwn(sequences, id) ? id : null;
}

export function sampleBodyAnimation(id, progress, intensity = 1) {
  if (!Object.hasOwn(sequences, id)) return null;
  const sequence = sequences[id];
  const p = clamp(progress), amount = clamp(intensity);
  const next = sequence.frames.findIndex(([at]) => at >= p);
  const right = sequence.frames[next < 0 ? sequence.frames.length - 1 : next];
  const left = sequence.frames[Math.max(0, (next < 0 ? sequence.frames.length - 1 : next) - 1)];
  const weight = right[0] === left[0] ? 0 : ease((p - left[0]) / (right[0] - left[0]));
  const values = Object.fromEntries(keys.map(key => [key, ((left[1][key] ?? 0) + ((right[1][key] ?? 0) - (left[1][key] ?? 0)) * weight) * amount]));
  // Only small continuous inputs are modulated; mesh/hand selectors never oscillate.
  const armOffsets = sequence.pose === 'think' ? { Param39: values.lift * .012, Param41: values.lift * .014 }
    : sequence.pose === 'idea' ? { Param36: values.lift * .018, Param41: values.lift * .04 }
    : sequence.pose === 'chest' ? { Param59: values.lift * .012, Param60: values.lift * .022 } : {};
  return { ...neutral, ...values, gesture: sequence.gesture, pose: sequence.pose, armOffsets };
}
