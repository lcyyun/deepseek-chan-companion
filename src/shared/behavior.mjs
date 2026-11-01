import { sanitizeModelTuning } from './model-tuning.mjs';
import { EXPRESSION_IDS, EXPRESSION_PRESETS, EXPRESSION_PARAMETER_DEFAULTS, getExpressionPreset } from './expressions.mjs';
import { sanitizeExpressionTuning } from './expression-tuning.mjs';
import { CHEST_REACTION_DURATIONS, sampleChestReaction } from './chest-reaction.mjs';
import { BODY_ANIMATION_PRESETS, bodyAnimationId, sampleBodyAnimation } from './body-animation.mjs';
export { BODY_ANIMATION_PRESETS } from './body-animation.mjs';

/** Model-specific choreography. All times here are seconds; public durations are ms. */
export const BEHAVIOR_PRESETS = Object.freeze([
  { id: 'greet', title: '打个招呼', command: { type: 'perform', intent: 'greet', emotion: 'happy', durationMs: 2600 } },
  { id: 'explain', title: '认真讲解', command: { type: 'perform', intent: 'explain', gesture: 'pointer', durationMs: 4200 } },
  { id: 'agree', title: '点头赞同', command: { type: 'perform', intent: 'agree', emotion: 'happy', durationMs: 1800 } },
  { id: 'disagree', title: '轻轻摇头', command: { type: 'perform', intent: 'disagree', durationMs: 1900 } },
  { id: 'curious', title: '歪头好奇', command: { type: 'perform', intent: 'curious', gaze: 'camera', durationMs: 2600 } },
  { id: 'reassure', title: '抚胸安慰', command: { type: 'perform', intent: 'reassure', emotion: 'gentle', gesture: 'chest', durationMs: 4000 } },
  { id: 'shy', title: '害羞一下', command: { type: 'perform', intent: 'shy', emotion: 'shy', durationMs: 2600 } },
  { id: 'playful', title: '狗尾草彩蛋', command: { type: 'perform', intent: 'playful', emotion: 'playful', gesture: 'foxtail', durationMs: 4500 } },
  { id: 'surprised', title: '有点惊讶', command: { type: 'perform', intent: 'surprised', emotion: 'surprised', durationMs: 1700 } },
  { id: 'cuddle', title: '撒娇捧胸', command: { type: 'perform', intent: 'cuddle', emotion: 'happy', durationMs: 4200 } },
  { id: 'think', title: '冥思苦想', command: { type: 'perform', intent: 'think', emotion: 'puzzled', gesture: 'pointer', durationMs: 6000 } },
  { id: 'idea', title: '想到了', command: { type: 'perform', intent: 'idea', emotion: 'happy', gesture: 'pointer', durationMs: 1800 } },
]);

const STATES = new Set(['idle', 'thinking', 'listening', 'speaking']);
const HANDS = {
  // Canonical manifest names, authored VTS transition times, and selector curves.
  // Runtime retains ALL final curves, not only these Movement selectors.
  pointer: { open: '竖手指切出来动画', close: '竖手指切回默认', closeSeconds: 1.25, selectors: { Movement1: 0, Movement3: 1 } },
  chest: { open: '默认手切举手', close: '举手切默认手', closeSeconds: 1.017, selectors: { Movement2: 1 } },
  foxtail: { open: '狗尾草切换出来', close: '狗尾草切回默认手', closeSeconds: 1.133, selectors: { Movement1: 1, Movement3: 0 } },
};
const GESTURE_ALIASES = { point: 'pointer', point_up: 'pointer', index: 'pointer', hand_on_chest: 'chest', grass: 'foxtail', reset: 'none' };
// Calibrated on the actual rig. These are the author's independent animation
// inputs, not the simulated RArm/RForearm/LArm/LForearm output parameters.
const ARM_POSES = {
  chest: { Movement1: 0, Movement2: 1, Movement3: 0, Param40: 0, Param37: 0, Param38: 0, Param36: 0, Param39: 0, Param41: 0, Param42: 0, Param43: 0,
    Param62: 0.034, Param59: 0.476, Param60: 0.82, Param61: 0.002 },
  cuddle: { Movement1: 0, Movement2: 1, Movement3: 0, Param40: 0, Param37: 0, Param38: 0, Param36: 0, Param39: 0, Param41: 0, Param42: 0, Param43: 0,
    Param62: 0.034, Param59: 0.476, Param60: 0.82, Param61: 0.002 },
  think: { Movement1: 0, Movement2: 0, Movement3: 1, Param40: 1, Param36: 0, Param39: 0.6, Param41: 0.79, Param42: 0, Param43: 0 },
  idea: { Movement1: 0, Movement2: 0, Movement3: 1, Param40: 1, Param36: 0.12, Param39: 0.322, Param41: 0.68, Param42: 0, Param43: 0 },
};
const ARM_IDS = [...new Set(Object.values(ARM_POSES).flatMap(pose => Object.keys(pose)))];
const ARM_SELECTORS = new Set(['Movement1', 'Movement2', 'Movement3', 'Param37', 'Param38', 'Param40']);
const EMOTIONS = Object.fromEntries(EXPRESSION_PRESETS.map(profile => [profile.id, {
  ...profile.face, brow: profile.face.browL, specialEyes: profile.specialEyes,
  expression: ({ shy: '脸红', playful: '屑屑眼', embarrassed: '流冷汗' })[profile.id],
}]));
const SPECIAL_EYE_KEYS = ['key3', 'key4', 'key5', 'key6'];
const FACE_IDS = new Set([...Object.keys(EXPRESSION_PARAMETER_DEFAULTS), 'key7', 'ParamEyeLOpen', 'ParamEyeROpen',
  'ParamMouthOpenY', 'JawOpen', 'ParamMouthForm', 'ParamBrowLY', 'ParamBrowRY', 'BrowInnerUp',
  'Mouthpucker', 'MouthPuckerWiden', 'MouthFunnel', 'CheeckPuff', 'EyeSmile']);
const THOUGHTS = [
  { id: 'peek-left', intent: 'curious', gaze: 'left', duration: 1.7 },
  { id: 'peek-right', intent: 'curious', gaze: 'right', duration: 1.7 },
  { id: 'tiny-nod', intent: 'agree', gaze: 'camera', duration: 1.4 },
  { id: 'loading', intent: 'think', expression: '加载', duration: 1.9 },
  { id: 'little-smile', intent: 'curious', emotion: 'gentle', gaze: 'camera', duration: 1.8 },
];
const OWNED_EXPRESSIONS = Object.values(EMOTIONS).map(x => x.expression).filter(Boolean).concat('加载');
const PHONEMES = { A: 'ParamA', I: 'ParamI', U: 'ParamU', E: 'ParamE', O: 'ParamO', silence: 'ParamSilence' };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value)));
const smooth = (from, to, dt, speed = 9) => from + (to - from) * (1 - Math.exp(-Math.max(0, dt) * speed));
const mix = (from, to, weight) => from + (to - from) * weight;
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const actionFade = duration => Math.min(0.8, duration * 0.4);

/** Runtime applies these upstream values before evaluating Cubism physics. */
export class BehaviorController {
  constructor(runtime, options = {}) {
    if (!runtime || typeof runtime.setParameters !== 'function') throw new TypeError('BehaviorController requires a Live2D runtime');
    this.runtime = runtime;
    this.tuning = sanitizeModelTuning(options.tuning);
    this.currentTuning = { ...this.tuning };
    this.expressionCue = null;
    this.expressionCueWeight = 0;
    this.expressionPreview = null;
    this.bodyPreview = null;
    this.speechGesture = null;
    this.bodySample = null;
    this.idlePose = { x: 0, z: 0, lean: 0 };
    this.idleTarget = { x: 0, z: 0, lean: 0 };
    this.nextIdleShift = 5;
    this.idleSide = 1;
    this.eyeStyle = null;
    this.eyeStyleLevel = 0;
    this.random = options.random ?? Math.random;
    this.clockSeconds = options.clockSeconds ?? (() => performance.now() / 1000);
    this.onEvent = options.onEvent ?? (() => {});
    // Phonemes are opt-in ONLY after the actual model has passed visual calibration.
    this.phonemesVerified = options.phonemesVerified === true;
    const discoveredLimits = Object.fromEntries((runtime.getParameters?.() ?? []).map(parameter => [parameter.id, { min: parameter.min, max: parameter.max }]));
    this.parameterLimits = { ...discoveredLimits, ...options.parameterLimits };
    this.thoughtCooldown = Math.max(5, finite(options.thoughtCooldown, 6));
    this._state = 'idle';
    this.time = 0;
    this.generation = 0;
    this.pending = [];
    this.activeExpressions = new Set();
    this.actionExpressions = new Set();
    this.gesture = 'none';
    this.queuedGesture = null;
    this.gestureClosingUntil = 0;
    this.nextThought = Infinity;
    this.lastThought = '';
    this.action = null;
    this.audioLevel = 0;
    this.viseme = null;
    this.mouth = 0;
    this.values = {};
    this.nextBlink = 2.5;
    this.blinkStart = -Infinity;
    this.stateSince = 0;
    this.petting = { active: false, x: 0, y: 0, speed: 0, intensity: 0.8 };
    this.petWeight = 0;
    this.petX = 0;
    this.petY = 0;
    this.petSpeed = 0;
    this.petContact = 0;
    this.petMotionAt = 0;
    this.petStarted = -Infinity;
    this.cuddleWeight = 0;
    this._callRuntime('setCuddleHand', 0);
    this.poseWeight = 0;
    this.poseValues = {};
    this.eyeOpenness = 1;
    this.pupilScale = 1;
    this.handForegroundWeight = 0;
    this.basinEnabled = false;
    this.knockStarted = -Infinity;
    this.knockCount = 0;
    this.chestReaction = null;
    this.completedChestStage = 0;
    this.lastChestTap = -Infinity;
    this.chestHeartArmed = false;
    this.chestPetStarted = -Infinity;
    this.tracking = { active: false, x: 0, y: 0, speed: 0, travel: 0 };
    this.trackingWeight = 0;
    this.trackingX = 0;
    this.trackingY = 0;
    this.trackingVX = 0;
    this.trackingVY = 0;
    this.trackingSpeed = 0;
    this.trackingTravel = 0;
    this.destroyed = false;
  }

  get state() { return this._state; }
  get isPetting() { return this.petting.active; }
  get isPointerTracking() { return this.tracking.active; }
  get isBasinEnabled() { return this.basinEnabled; }
  get isChestReaction() { return Boolean(this.chestReaction); }
  get isChestAwaitingPetting() { return this.completedChestStage === 3 && !this.chestHeartArmed && !this.chestReaction; }
  get isChestHeartArmed() { return this.completedChestStage === 3 && this.chestHeartArmed; }

  /** Accepted physical taps advance only after a complete, uninterrupted round. */
  tapChest() {
    if (!this._canReactToChest()) return false;
    this._expireChestSequence();
    if (this.completedChestStage === 3 && !this.chestHeartArmed) return false;
    this.lastChestTap = finite(this.clockSeconds(), this.time);
    this.chestHeartArmed = false;
    this.chestPetStarted = -Infinity;
    return this._startChestReaction(this.completedChestStage + 1, false);
  }

  /** Preview does not change physical-tap progression or its cooldown. */
  previewChestReaction(stage) {
    if (![1, 2, 3, 4].includes(stage) || !this._canReactToChest()) return false;
    return this._startChestReaction(stage, true);
  }

  cancelChestReaction() {
    const reaction = this.chestReaction;
    // A local preview must not consume real comfort/progression. Other explicit
    // interruptions require fresh contact before an interrupted heart can retry.
    if (!reaction?.preview) {
      this.chestHeartArmed = false;
      this.chestPetStarted = -Infinity;
    }
    if (!reaction) return;
    this.chestReaction = null;
    this.onEvent({ type: 'chest-reaction-cancelled', id: String(reaction.stage) });
  }

  _resetChestSequence() {
    this.completedChestStage = 0;
    this.lastChestTap = -Infinity;
    this.chestHeartArmed = false;
    this.chestPetStarted = -Infinity;
  }

  _expireChestSequence() {
    const now = finite(this.clockSeconds(), this.time);
    if (now - this.lastChestTap >= 60 || now < this.lastChestTap) this._resetChestSequence();
  }

  _canReactToChest() {
    return !this.destroyed && !this.chestReaction && !this.petting.active && this.petContact < 0.05
      && this.time - this.knockStarted >= 0.66 && this._state !== 'thinking' && this.action?.intent !== 'think';
  }

  _startChestReaction(stage, preview) {
    this.bodyPreview = null;
    if (this.speechGesture) this.speechGesture.blocked = true;
    this.chestReaction = { stage, start: this.time, duration: CHEST_REACTION_DURATIONS[stage - 1], preview };
    this.onEvent({ type: 'chest-reaction-start', id: String(stage) });
    return true;
  }

  _sampleChestReaction() {
    const reaction = this.chestReaction;
    if (!reaction) return null;
    const sample = sampleChestReaction(reaction.stage, this.time - reaction.start);
    if (sample) return sample;
    if (!reaction.preview) {
      if (reaction.stage === 4) this._resetChestSequence();
      else this.completedChestStage = reaction.stage;
      // No previous contact, including its visual release, can comfort stage 3.
      this.chestPetStarted = -Infinity;
    }
    this.chestReaction = null;
    this.onEvent({ type: 'chest-reaction-complete', id: String(reaction.stage) });
    return null;
  }

  /** Changes settle into the active pose without restarting a motion or chat turn. */
  setTuning(tuning, { replace = false } = {}) {
    if (!this.destroyed) this.tuning = replace ? sanitizeModelTuning(tuning) : sanitizeModelTuning(tuning, this.tuning);
  }

  /** Speech progress controls this face-only lane without restarting an arm. */
  setExpressionCue(emotion, intensity = 0.7) {
    if (this.destroyed || !EXPRESSION_IDS.includes(emotion)) return;
    this.expressionCue = { emotion, intensity: clamp(intensity), active: true };
  }

  clearExpressionCue() {
    if (this.expressionCue) this.expressionCue.active = false;
  }

  /** Independent preview: changing a face never starts or cancels an arm. */
  previewExpression(emotion, { intensity = 1, durationMs = 20000 } = {}) {
    if (this.destroyed || !EXPRESSION_IDS.includes(emotion)) return false;
    this.expressionPreview = { emotion, intensity: clamp(intensity), active: true,
      until: this.time + clamp(finite(durationMs, 20000) / 1000, .2, 60) };
    return true;
  }

  clearExpressionPreview() { this.expressionPreview = null; }

  /** Body-only preview; it leaves the active face, voice and dialogue state alone. */
  previewBodyAnimation(id, { intensity = .8, durationMs } = {}) {
    if (this.destroyed || !BODY_ANIMATION_PRESETS.some(item => item.id === id) || this._bodyInteractionActive()) return false;
    const preset = BODY_ANIMATION_PRESETS.find(item => item.id === id);
    this.bodyPreview = { id, intensity: clamp(intensity), start: this.time,
      duration: clamp(finite(durationMs, preset.durationMs) / 1000, 2, 20) };
    this._syncGesture();
    return true;
  }

  clearBodyAnimation() { this.bodyPreview = null; this._syncGesture(); }

  /** A progress update from the actual speech clock, not a new motion command. */
  setSpeechGesture(cue) {
    if (!cue) { this.clearSpeechGesture(); return; }
    if (this.destroyed) return;
    const id = bodyAnimationId(cue.id ?? cue.intent);
    if (!id) return;
    const key = cue.key ?? id;
    const previous = this.speechGesture;
    const same = previous?.key === key && previous.id === id;
    // The fixed idea flourish has already introduced the reply. Hand its pose
    // straight to the first spoken cue without closing and reopening the arm.
    if (!same && this.action?.intent === 'idea' && this.action.replyIntro) this._cancelTransient(true);
    this.speechGesture = { id, key, intensity: clamp(finite(cue.intensity, .65)),
      start: same ? previous.start : this.time,
      duration: clamp(finite(cue.durationMs, 5000) / 1000, .3, 30),
      progress: Number.isFinite(cue.progress) ? clamp(cue.progress) : null,
      // A held local interaction consumes incoming cues rather than replaying them later.
      blocked: same ? previous.blocked : this._bodyInteractionActive(),
      gesture: ['pointer', 'chest', 'foxtail', 'none'].includes(cue.gesture) ? cue.gesture : undefined };
    this._syncGesture();
  }

  clearSpeechGesture() { this.speechGesture = null; this._syncGesture(); }

  _bodyInteractionActive() {
    return this.petting.active || this.petContact > .05 || Boolean(this.chestReaction) || this.time - this.knockStarted < .66;
  }

  _bodyPerformance() {
    if (this._bodyInteractionActive()) return null;
    if (this.bodyPreview) return this.bodyPreview;
    if (this.speechGesture?.blocked || this._state === 'thinking' || this.action?.source === 'command') return null;
    return this.speechGesture;
  }

  _sampleBodyPerformance() {
    if (this.bodyPreview && this.time - this.bodyPreview.start >= this.bodyPreview.duration) this.bodyPreview = null;
    if (this.speechGesture && this.speechGesture.progress === null && this.time - this.speechGesture.start >= this.speechGesture.duration) this.speechGesture = null;
    const performance = this._bodyPerformance();
    if (!performance) return null;
    const progress = performance.progress ?? clamp((this.time - performance.start) / performance.duration);
    const sample = sampleBodyAnimation(performance.id, progress, performance.intensity);
    const seconds = progress * performance.duration;
    const weight = ease(seconds / .25) * (1 - ease((seconds - performance.duration + Math.min(.85, performance.duration * .3)) / Math.min(.85, performance.duration * .3)));
    const gesture = performance.gesture ?? sample.gesture;
    return { ...sample, weight, gesture, pose: gesture === sample.gesture ? sample.pose : null };
  }

  /** A persistent authored prop, independent of a chat turn or short performance. */
  setBasinEnabled(enabled) {
    if (this.destroyed) return;
    const next = Boolean(enabled);
    if (next === this.basinEnabled) return;
    this.basinEnabled = next;
    this.setPetting(false);
    this.cancelBasinKnock();
    this._syncExpressions();
  }

  /** Each click restarts one bounded reaction. No timers, backlog, or accumulated force. */
  knockBasin() {
    if (this.destroyed || !this.basinEnabled) return false;
    this.cancelChestReaction();
    this.bodyPreview = null;
    if (this.speechGesture) this.speechGesture.blocked = true;
    this.setPetting(false);
    this.knockStarted = this.time;
    this.knockCount++;
    this._updateImpact();
    this.onEvent({ type: 'basin-knock', id: String(this.knockCount) });
    return true;
  }

  cancelBasinKnock() {
    this.knockStarted = -Infinity;
    this._callRuntime('setImpactOverlay', {}, 0);
    this._callRuntime('setEarImpulse', 0, 0);
  }

  applyCommand(command) {
    if (this.destroyed || !command || typeof command !== 'object') return;
    if (command.type === 'stop') return this.interrupt();
    if (command.type === 'reset') return this.reset();
    if (command.type === 'state') return this.setState(command.state);
    if (command.type === 'expression') return command.active === false ? this.clearExpressionPreview() : this.previewExpression(command.emotion, command);
    if (command.type === 'body') return command.active === false ? this.clearBodyAnimation() : this.previewBodyAnimation(command.animation, command);
    if (command.type === 'speak') {
      this.cancelChestReaction();
      this.setState('speaking');
      if (command.intent || command.emotion || command.gesture || command.gaze) this.perform(command);
      return;
    }
    if (command.type === 'perform') this.perform(command);
  }

  setState(state) {
    if (this.destroyed || !STATES.has(state) || state === this._state) return;
    if (state === 'thinking' || state === 'listening') this.cancelChestReaction();
    // A service snapshot (e.g. idle after dispatch) is not a stop command.
    // Preserve explicit performances; only cancel automatic waiting choreography.
    if (this.action?.source === 'thought') this._cancelTransient(true);
    this._state = state;
    this.stateSince = this.time;
    this.audioLevel = 0;
    this.viseme = null;
    this.nextThought = state === 'thinking' ? this.time + 0.45 : Infinity;
    if (state !== 'speaking') this._closeMouthImmediately();
    this._syncExpressions();
    this._syncGesture();
    this.onEvent({ type: 'state', state });
  }

  perform(command = {}) {
    if (this.destroyed) return;
    this.cancelChestReaction();
    this.bodyPreview = null; this.speechGesture = null;
    this.clearExpressionPreview();
    this.clearExpressionCue();
    this._cancelTransient(true);
    const duration = clamp(finite(command.durationMs, 2800) / 1000, 0.2, 20);
    const emotion = command.intent === 'think' ? 'puzzled' : Object.hasOwn(EMOTIONS, command.emotion) ? command.emotion : 'neutral';
    this.action = {
      intent: typeof command.intent === 'string' ? command.intent : 'neutral',
      emotion,
      gaze: command.gaze ?? 'camera',
      intensity: command.intensity == null ? 0.65 : clamp(command.intensity),
      start: this.time,
      duration,
      source: 'command',
      replyIntro: command.replyIntro === true,
      gesture: command.gesture ?? (['think', 'idea'].includes(command.intent) ? 'pointer' : 'none'),
    };
    this._setEmotionExpression(emotion);
    if (this.action.intent === 'think') this._activateExpression('加载');
    this._syncGesture();
    this.nextThought = this._state === 'thinking' ? this.time + duration + this.thoughtCooldown : Infinity;
    this._schedule(duration - actionFade(duration), () => this._clearExpressions());
    this._schedule(duration, () => this._finishAction());
  }

  /** Level is normalized audio energy, measured from the audio actually playing. */
  setAudioLevel(level, viseme = null) {
    if (this.destroyed) return;
    this.audioLevel = clamp(level);
    this.viseme = viseme && typeof viseme === 'object' ? viseme : null;
  }

  /** Local pointer interaction. x/y: head-local [-1,1], y down; speed: [0,1]. */
  setPetting(active, input = {}) {
    if (this.destroyed) return;
    if (this.basinEnabled) active = false;
    if (active && this.chestReaction) this.cancelChestReaction();
    if (active && (!this.petting.active || input.newContact)) {
      this.bodyPreview = null;
      if (this.speechGesture) this.speechGesture.blocked = true;
      this._expireChestSequence();
      this.petStarted = this.time;
      this.chestPetStarted = this.completedChestStage === 3 && !this.chestHeartArmed ? this.time : -Infinity;
    }
    if (!active) this.petStarted = this.chestPetStarted = -Infinity;
    this.petting.active = Boolean(active);
    if (active) {
      if (input.x !== undefined) this.petting.x = clamp(input.x, -1, 1);
      if (input.y !== undefined) this.petting.y = clamp(input.y, -1, 1);
      if (input.speed !== undefined) { this.petting.speed = clamp(input.speed); this.petMotionAt = this.time; }
      if (input.intensity !== undefined) this.petting.intensity = clamp(input.intensity);
    } else this.petting.speed = 0;
    this._syncExpressions();
    this._syncGesture();
  }

  /** Continuous local/global pointer input. x right, y down; no physics outputs. */
  setPointerTracking(active, input = {}) {
    if (this.destroyed) return;
    this.tracking.active = Boolean(active);
    if (active) {
      if (input.x !== undefined) this.tracking.x = clamp(input.x, -1, 1);
      if (input.y !== undefined) this.tracking.y = clamp(input.y, -1, 1);
      if (input.speed !== undefined) this.tracking.speed = clamp(input.speed);
      if (input.travel !== undefined) this.tracking.travel = clamp(input.travel);
    } else { this.tracking.speed = 0; this.tracking.travel = 0; }
  }

  interrupt(nextState = 'listening') {
    if (this.destroyed) return;
    this.cancelChestReaction();
    this.clearExpressionCue();
    this.expressionPreview = null; this.bodyPreview = null; this.speechGesture = null; this.bodySample = null;
    this._cancelTransient();
    this._state = STATES.has(nextState) ? nextState : 'listening';
    this.cancelBasinKnock();
    this.petting.active = false;
    this.petStarted = -Infinity;
    this.petWeight = 0;
    this.tracking.active = false;
    this.tracking.speed = 0;
    this.tracking.travel = 0;
    this.nextThought = Infinity;
    this.audioLevel = 0;
    this.viseme = null;
    this._closeMouthImmediately();
    this._syncExpressions();
    this.onEvent({ type: 'interrupted', state: this._state });
  }

  reset() {
    if (this.destroyed) return;
    this.interrupt('idle');
    this._callRuntime('reset');
    // Runtime reset clears expression resources. Restore the user's persistent
    // prop even though its desired boolean has not changed.
    this.activeExpressions.clear();
    this._syncExpressions();
    this.values = {};
    this._resetChestSequence();
    this.expressionCue = null; this.expressionCueWeight = 0; this.eyeStyle = null; this.eyeStyleLevel = 0;
    this._callRuntime('setFaceOverlay', {});
    this.petContact = 0;
    this.eyeOpenness = 1;
    this.pupilScale = 1;
    this._callRuntime('setPupilScale', 1);
    this.handForegroundWeight = 0;
    this._callRuntime('setHandForeground', 0);
    this.trackingWeight = this.trackingX = this.trackingY = this.trackingVX = this.trackingVY = 0;
    this.trackingSpeed = this.trackingTravel = 0;
    this.gestureClosingUntil = 0;
    this.queuedGesture = null;
    this.cuddleWeight = 0;
    this._callRuntime('setCuddleHand', 0);
    this.poseWeight = 0;
    this.poseValues = {};
    this.idlePose = { x: 0, z: 0, lean: 0 }; this.idleTarget = { x: 0, z: 0, lean: 0 }; this.nextIdleShift = this.time + 5;
    this._callRuntime('setPoseOverlay', {}, 0);
    this._closeMouthImmediately();
  }

  /** Called by runtime.onFrame(dt, elapsed), with seconds as the time unit. */
  update(dt, elapsed) {
    if (this.destroyed) return;
    const step = clamp(dt, 0, 10);
    this.time += step;
    const smoothingStep = Math.min(step, 0.1);
    const chestReaction = this._sampleChestReaction();
    const chestWeight = chestReaction?.weight ?? 0;
    if (this.petting.active && this.completedChestStage === 3 && !this.chestHeartArmed && this.time - this.chestPetStarted >= 0.3 && Number.isFinite(this.chestPetStarted)) {
      this._expireChestSequence();
      if (this.completedChestStage === 3) {
        this.chestHeartArmed = true;
        this.chestPetStarted = -Infinity;
        this.onEvent({ type: 'chest-heart-armed', id: '4' });
      }
    }
    for (const key of ['bodyMotion', 'gazeStrength', 'blushStrength', 'expressionIntensity', 'gestureAmplitude', 'bodyFollow', 'idleActivity']) {
      this.currentTuning[key] = smooth(finite(this.currentTuning[key], 1), finite(this.tuning[key], 1), smoothingStep, 8);
    }
    this.petWeight = smooth(this.petWeight, this.petting.active ? this.petting.intensity : 0, smoothingStep, 9);
    this.petX = smooth(this.petX, this.petting.x, smoothingStep, 12);
    this.petY = smooth(this.petY, this.petting.y, smoothingStep, 12);
    this.petSpeed = smooth(this.petSpeed, this.petting.active ? this.petting.speed * Math.exp(-Math.max(0, this.time - this.petMotionAt) * 5) : 0, smoothingStep, 10);
    const contactTarget = this.petting.active ? 1 : 0;
    this.petContact = smooth(this.petContact, contactTarget, smoothingStep, 11);
    if (Math.abs(this.petContact - contactTarget) < 0.001) this.petContact = contactTarget;
    this.trackingWeight = smooth(this.trackingWeight, this.tracking.active ? 1 : 0, smoothingStep, 7);
    this.trackingSpeed = smooth(this.trackingSpeed, this.tracking.active ? this.tracking.speed : 0, smoothingStep, 8);
    this.trackingTravel = smooth(this.trackingTravel, this.tracking.active ? this.tracking.travel : 0, smoothingStep, 8);
    // A damped upstream spring preserves velocity across pointer reversals. The
    // model's own physics then produces hair, clothing and body secondary motion.
    let remaining = smoothingStep;
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 120);
      this.trackingVX += ((this.tracking.active ? this.tracking.x : 0) - this.trackingX) * 48 * h - this.trackingVX * 12 * h;
      this.trackingVY += ((this.tracking.active ? this.tracking.y : 0) - this.trackingY) * 48 * h - this.trackingVY * 12 * h;
      this.trackingX += this.trackingVX * h;
      this.trackingY += this.trackingVY * h;
      remaining -= h;
    }
    this._syncExpressions();
    const due = this.pending.filter(item => item.at <= this.time);
    this.pending = this.pending.filter(item => item.at > this.time);
    for (const event of due) if (event.generation === this.generation) event.run();
    this.bodySample = this._sampleBodyPerformance();
    if (this._state === 'thinking' && !this.action && !this.petting.active && this.petWeight < 0.15 && this.time >= this.nextThought) this._playThought();
    this._syncGesture();
    if (this.queuedGesture && this.queuedGesture.at <= this.time) {
      const next = this.queuedGesture.gesture;
      this.queuedGesture = null;
      if (this._desiredGesture() === next) this._startGesture(next);
    }

    const action = this.action;
    const age = action ? this.time - action.start : 0;
    const actionWeight = action ? ease(age / 0.16) * (1 - ease((age - action.duration + actionFade(action.duration)) / actionFade(action.duration))) : 0;
    const intensity = (action?.intensity ?? 0.35) * actionWeight;
    const thinking = this._state === 'thinking' && (!action || action.source === 'thought') || action?.intent === 'think';
    const thinkingWeight = thinking ? (this._state === 'thinking' ? 1 : actionWeight) : 0;
    const ideaWeight = action?.intent === 'idea' ? actionWeight : 0;
    const bodySample = this.bodySample;
    const bodyWeight = bodySample?.weight ?? 0;
    const face = this._composeFace(thinking ? 'neutral' : action?.emotion ?? 'neutral',
      thinking ? thinkingWeight : action ? intensity : 1, smoothingStep);
    if (chestReaction) this._blendChestFace(face, chestReaction);
    const thoughtFace = thinkingWeight * (1 - this.expressionCueWeight) * (1 - chestWeight);
    const ideaFace = ideaWeight * (1 - this.expressionCueWeight) * (1 - chestWeight);
    const cuddling = this.petting.active && this.time - this.petStarted >= 2 || action?.intent === 'cuddle';
    // Keep the finger visible through the pose's exit, until it clears the face/chest.
    const foregroundWeight = Math.max(thinkingWeight, bodySample?.pose === 'think' ? bodyWeight : 0, cuddling ? (this.petting.active ? 1 : actionWeight) : 0);
    this.handForegroundWeight = smooth(this.handForegroundWeight, foregroundWeight, smoothingStep, 5);
    this._callRuntime('setHandForeground', foregroundWeight > 0.001 || this.handForegroundWeight > 0.02 ? 1 : 0);
    this.cuddleWeight = smooth(this.cuddleWeight, cuddling ? (this.petting.active ? 1 : actionWeight) : 0, smoothingStep, 5);
    // Speech cues own the face of a scripted cuddle, while real touch keeps
    // its closed-eye response. Neither choice changes the arm performance.
    const cuddleFace = this.cuddleWeight * (1 - this.expressionCueWeight * (1 - this.petContact)) * (1 - chestWeight);
    // A queued gesture must finish the previous arm's authored close before its
    // new selector/pose can enter. Facial expression and loading remain live.
    const bodyArm = bodySample?.gesture !== 'none' && bodySample?.gesture === this.gesture && bodyWeight > .001 ? bodySample.pose : null;
    const armPose = bodySample ? bodyArm : (cuddling && this.gesture === 'chest' ? 'cuddle'
      : this.gesture === 'pointer' ? thinking ? 'think' : action?.intent === 'idea' ? 'idea' : null : null);
    this._callRuntime('setCuddleHand', bodySample ? 0 : this.cuddleWeight, armPose === 'cuddle');
    this._updateArmPose(armPose,
      bodyArm ? bodyWeight : armPose === 'cuddle' || thinking && this._state === 'thinking' ? 1 : actionWeight, smoothingStep,
      bodyArm ? bodySample.armOffsets : null);
    const phase = finite(elapsed, this.time);
    const stateLean = this._state === 'listening' ? -3.5 : 0;
    const stateGaze = this._gaze(this._state === 'thinking' ? 'up' : 'camera');
    const actionGaze = this._gaze(action?.gaze ?? stateGaze);
    const gaze = { x: mix(stateGaze.x, actionGaze.x, actionWeight), y: mix(stateGaze.y, actionGaze.y, actionWeight) };
    let headX = gaze.x * 10;
    let headY = gaze.y * 6;
    let headZ = 0;
    let lean = stateLean;
    let mouthPose = 0;
    if (thinking) {
      const waitingAge = this.time - this.stateSince;
      headX = mix(headX, 18 + Math.sin(waitingAge * 0.75) * 1.2, thinkingWeight);
      headY = mix(headY, 8 + Math.sin(waitingAge * 1.05) * 0.8, thinkingWeight);
      headZ = (2 + Math.sin(waitingAge * 0.7) * 0.8) * thinkingWeight;
      gaze.y = mix(gaze.y, 0.6, thinkingWeight);
    }
    if (action) {
      switch (action.intent) {
        case 'agree': headY += Math.sin(age * Math.PI * 2.4) * Math.exp(-age * 0.55) * 20 * intensity; break;
        case 'disagree': headX += Math.sin(age * Math.PI * 2.2) * Math.exp(-age * 0.6) * 21 * intensity; break;
        case 'curious': headZ = mix(headZ, 15 * (action.intensity ?? 0.65), actionWeight); headY += 3 * actionWeight; break;
        case 'greet': headZ = mix(headZ, Math.sin(age * 2.7) * 9 * action.intensity, actionWeight); break;
        case 'explain': headY += Math.sin(age * 2.5) * 4 * intensity; break;
        case 'reassure': lean = mix(lean, -12 * action.intensity, actionWeight); headZ = mix(headZ, -7 * action.intensity, actionWeight); break;
        case 'shy': headY -= 7 * intensity; headZ = mix(headZ, -10 * action.intensity, actionWeight); break;
        case 'playful': headZ = mix(headZ, Math.sin(age * 1.6) * 11 * action.intensity, actionWeight); break;
        case 'surprised': headY += 8 * intensity; mouthPose = 0.18 * intensity; break;
        case 'think': break; // The same lip-side pose is used by the preview and waiting loop.
        case 'idea': headY += (6 + Math.sin(age * 5) * 3) * actionWeight; headZ = mix(headZ, 5, actionWeight); lean = mix(lean, -5, actionWeight); mouthPose = 0.5 * ideaFace; break;
        case 'cuddle': headZ = mix(headZ, -3 + Math.sin(age * 1.8) * 1, actionWeight); lean = mix(lean, -4, actionWeight); break;
      }
    }
    if (bodySample) {
      headX = mix(headX, bodySample.headX, bodyWeight);
      headY = mix(headY, bodySample.headY, bodyWeight);
      headZ = mix(headZ, bodySample.headZ, bodyWeight);
      lean = mix(lean, bodySample.lean, bodyWeight);
      gaze.x = mix(gaze.x, bodySample.gazeX, bodyWeight);
      gaze.y = mix(gaze.y, bodySample.gazeY, bodyWeight);
    }
    // A posture settles and rests for several seconds. Tiny breath remains, but
    // a continuously oscillating torso is not used as a substitute for intent.
    const idle = !action && !bodySample && ['idle', 'listening'].includes(this._state) && !this._bodyInteractionActive() && this.trackingWeight < .02;
    if (idle && this.time >= this.nextIdleShift) {
      this.idleSide *= -1;
      this.idleTarget = { x: this.idleSide * (.5 + clamp(this.random()) * .65), z: -this.idleSide * (.35 + clamp(this.random()) * .5), lean: -.25 - clamp(this.random()) * .5 };
      this.nextIdleShift = this.time + 6 + clamp(this.random()) * 7;
    }
    for (const key of ['x', 'z', 'lean']) this.idlePose[key] = smooth(this.idlePose[key], idle ? this.idleTarget[key] * this.currentTuning.idleActivity : 0, smoothingStep, 1.5);
    headX += this.idlePose.x + Math.sin(phase * .46) * .22 * this.currentTuning.idleActivity;
    headZ += this.idlePose.z + Math.sin(phase * .63 + .7) * .18 * this.currentTuning.idleActivity;
    lean += this.idlePose.lean;

    const track = this.trackingWeight * (1 - chestWeight);
    const follow = this.currentTuning.gazeStrength;
    const trackingGain = (1 + this.trackingTravel * 0.16 + this.trackingSpeed * 0.08) * follow;
    headX = mix(headX, this.trackingX * 23 * trackingGain, track);
    headY = mix(headY, -this.trackingY * 16 * trackingGain, track);
    headZ = mix(headZ, (-this.trackingX * 10 + clamp(this.trackingVX, -3, 3) * 0.6) * follow, track);
    lean = mix(lean, -Math.hypot(this.trackingX, this.trackingY) * 5 * follow, track);
    gaze.x = mix(gaze.x, clamp(this.trackingX * follow, -1, 1), track);
    gaze.y = mix(gaze.y, clamp(-this.trackingY * follow, -1, 1), track);

    if (chestReaction) {
      const pose = chestReaction.pose;
      headX = mix(headX, pose.x, chestWeight); headY = mix(headY, pose.y, chestWeight);
      headZ = mix(headZ, pose.z, chestWeight); lean = mix(lean, pose.lean, chestWeight);
      gaze.x = mix(gaze.x, pose.gazeX, chestWeight); gaze.y = mix(gaze.y, pose.gazeY, chestWeight);
    }

    // Touch temporarily owns head/gaze/expression, not speech or request state.
    const pet = this.petWeight;
    const rub = Math.sin(phase * (4 + this.petSpeed * 3)) * this.petSpeed * 2.5;
    headX = mix(headX, (this.petX * 15 + rub) * this.petting.intensity, this.petContact);
    headY = mix(headY, (-this.petY * 8 + 3 + Math.sin(phase * 1.8) * 0.8) * this.petting.intensity, this.petContact);
    headZ = mix(headZ, (-this.petX * 11 + rub * 0.5) * this.petting.intensity, this.petContact);
    lean = mix(lean, -9 * this.petting.intensity, this.petContact);

    const eyeStyleWanted = pet > .1 || cuddleFace > .1 ? null : SPECIAL_EYE_KEYS.find(key => face.parameters[key] > .15) ?? null;
    if (eyeStyleWanted !== this.eyeStyle) {
      this.eyeStyleLevel = smooth(this.eyeStyleLevel, 0, smoothingStep, 18);
      if (this.eyeStyleLevel < .015) { this.eyeStyleLevel = 0; this.eyeStyle = eyeStyleWanted; }
    } else this.eyeStyleLevel = smooth(this.eyeStyleLevel, eyeStyleWanted ? 1 : 0, smoothingStep, 14);
    const specialEyes = Boolean(this.eyeStyle) && this.eyeStyleLevel > .03;
    if (!specialEyes && pet < 0.2 && this.time >= this.nextBlink) {
      this.blinkStart = this.time;
      this.nextBlink = this.time + 2.7 + clamp(this.random()) * 3.2;
    }
    const blinkAge = this.time - this.blinkStart;
    const blink = !specialEyes && pet < 0.2 && blinkAge >= 0 && blinkAge <= 0.18 ? Math.sin(blinkAge / 0.18 * Math.PI) ** 2 : 0;
    const speaking = this._state === 'speaking';
    const energy = speaking && this.audioLevel > 0.018 ? clamp((this.audioLevel - 0.018) * 1.35) : 0;
    this.mouth = smooth(this.mouth, energy, smoothingStep, energy > this.mouth ? 25 : 18);
    if (!speaking && this.mouth < 0.001) this.mouth = 0;

    // Heart breathing blends from the normal oscillator and eases out with the
    // face. Only upstream inputs are touched; speech retains mouth ownership.
    const heartWeight = chestReaction?.stage === 4 ? chestWeight : 0;
    const heartBreath = Math.sin((chestReaction?.age ?? 0) * 3.1);
    const breathGain = heartWeight * clamp(this.currentTuning.bodyMotion);
    // Eyes respond first; the torso follows the already moving head, rather
    // than receiving the identical target on the same frame. Touch keeps its
    // existing timings, and the model's physics remains the only secondary rig.
    const localResponse = this.petContact > .01 || chestWeight > .001;
    const torsoHeadX = localResponse ? headX : finite(this.values.AngleX, 0);
    const torsoHeadY = localResponse ? headY : finite(this.values.AngleY, 0);
    const torsoHeadZ = localResponse ? headZ : finite(this.values.AngleZ, 0);
    const torsoFollow = this.currentTuning.bodyFollow;
    const target = {
      AngleX: headX,
      AngleY: headY,
      AngleZ: headZ,
      PositionX: torsoHeadX * .4 * torsoFollow + Math.sin(phase * 1.25) * 2.4 * thinkingWeight * (1 - track) * (1 - this.petContact) + (this.trackingX * 5 + clamp(this.trackingVX, -3, 3) * 1.2) * track * (1 - this.petContact) + (bodySample?.bodyX ?? 0) * bodyWeight,
      PositionY: torsoHeadY * .3 * torsoFollow - this.trackingY * 3 * track * (1 - this.petContact) + heartBreath * 2.2 * heartWeight + (bodySample?.bodyY ?? 0) * bodyWeight,
      PositionZ: torsoHeadZ * .35 * torsoFollow - this.trackingX * 2 * track * (1 - this.petContact) + (bodySample?.bodyZ ?? 0) * bodyWeight,
      LeanInput: lean + Math.sin((chestReaction?.age ?? 0) * 3.1 + 0.3) * 1.5 * heartWeight,
      ParamEyeBallX: mix(gaze.x * 0.6, this.petX * 0.25, this.petContact),
      ParamEyeBallY: mix(gaze.y * 0.5, 0.15, this.petContact),
      ParamBrowLY: mix(mix(mix(face.browL, -0.24, thoughtFace), 0.6, ideaFace), 0.12, pet),
      ParamBrowRY: mix(mix(mix(face.browR, -0.2, thoughtFace), 0.6, ideaFace), 0.12, pet),
      // Eyebrow-angle and pupil-perspective parameters are physics outputs.
      // Use the real face inputs and a reversible iris geometry overlay instead.
      BrowInnerUp: mix(face.innerBrow, 0.18, ideaFace) * (1 - this.petContact),
      Mouthpucker: speaking ? 0 : mix(face.pucker, 0.7, thoughtFace) * (1 - this.petContact),
      MouthPuckerWiden: speaking ? 0 : mix(face.parameters.MouthPuckerWiden, -0.35, thoughtFace) * (1 - this.petContact),
      MouthFunnel: speaking ? 0 : mix(face.funnel, 0.12, thoughtFace) * (1 - this.petContact),
      CheeckPuff: speaking ? 0 : mix(face.cheek, 0.18, thoughtFace) * (1 - this.petContact),
      EyeSmile: mix(mix(face.eyeSmile, 0.2, ideaFace), 0.92, Math.max(pet, cuddleFace)),
      ParamMouthForm: mix(mix(mix(face.smile, -0.16, thoughtFace), 0.8, ideaFace), 0.8, Math.max(pet, cuddleFace)),
      // A brief pat stays light; sustained contact blooms into a shy crimson.
      key7: mix(face.blush, Math.max(pet * (0.35 / 0.75), cuddleFace) * this.currentTuning.blushStrength, Math.max(this.petContact, cuddleFace)),
      ParamBreath: 0.5 + mix(Math.sin(phase * 1.65), heartBreath, breathGain) * 0.48,
    };
    for (const [key, value] of Object.entries(face.parameters)) if (key !== 'MouthPuckerWiden' && !SPECIAL_EYE_KEYS.includes(key)) target[key] = value * (1 - this.petContact);
    for (const key of ['PositionX', 'PositionY', 'PositionZ', 'LeanInput']) target[key] *= this.currentTuning.bodyMotion;
    for (const [id, value] of Object.entries(target)) {
      const speed = ['ParamEyeBallX', 'ParamEyeBallY'].includes(id) ? 18
        : !localResponse && ['PositionX', 'PositionY', 'PositionZ', 'LeanInput'].includes(id) ? 4.5 : 7.5;
      this.values[id] = smooth(finite(this.values[id], value), value, smoothingStep, speed);
    }
    for (const key of SPECIAL_EYE_KEYS) this.values[key] = key === this.eyeStyle ? this.eyeStyleLevel : 0;
    // Blinks and speech are evaluated after the slow pose smoothing so that their
    // short timing is retained, but still BEFORE the renderer's physics update.
    this.eyeOpenness = smooth(this.eyeOpenness, mix(mix(face.eye, 0.96, thoughtFace), 1.1, ideaFace), smoothingStep, 9);
    const pupilTarget = mix(face.pupil, 1 + ideaFace * (0.08 - 0.11 * Math.exp(-Math.max(0, age) * 5)), Math.max(ideaFace, this.petContact));
    this.pupilScale = smooth(this.pupilScale, pupilTarget, smoothingStep, 9);
    this._callRuntime('setPupilScale', this.pupilScale);
    const leftClosed = finite(this.parameterLimits.ParamEyeLOpen?.min, 0);
    const rightClosed = finite(this.parameterLimits.ParamEyeROpen?.min, 0);
    this.values.ParamEyeLOpen = mix(mix(this.eyeOpenness, leftClosed, blink), leftClosed, Math.max(this.petContact, cuddleFace));
    this.values.ParamEyeROpen = mix(mix(this.eyeOpenness, rightClosed, blink), rightClosed, Math.max(this.petContact, cuddleFace));
    const faceMouth = Math.max(mouthPose, face.open * (1 - thoughtFace));
    this.values.ParamMouthOpenY = speaking ? this.mouth * 0.85 : smooth(finite(this.values.ParamMouthOpenY), faceMouth * (1 - this.petContact), smoothingStep, 14);
    this.values.JawOpen = speaking ? this.mouth * 0.58 : this.values.ParamMouthOpenY * 0.56;
    if (!speaking && faceMouth < .001 && this.values.ParamMouthOpenY < .001) this.values.ParamMouthOpenY = this.values.JawOpen = 0;
    if (this.phonemesVerified) {
      for (const [name, id] of Object.entries(PHONEMES)) {
        const value = speaking ? clamp(this.viseme?.[name]) : 0;
        this.values[id] = smooth(finite(this.values[id]), value, smoothingStep, 25);
      }
    }
    this._writeParameters(this.values);
    this._callRuntime('setFaceOverlay', Object.fromEntries(Object.entries(this.values).filter(([key]) => FACE_IDS.has(key)).map(([key, value]) => {
      const range = this.parameterLimits[key]; return [key, range ? clamp(value, range.min, range.max) : value];
    })));
    this._updateImpact();
  }

  _profileFace(emotionId, amount, overrides = {}) {
      const profile = getExpressionPreset(emotionId), face = { ...profile.face, ...overrides };
      const tweak = sanitizeExpressionTuning(this.tuning.expressionOverrides[emotionId]);
      const gain = clamp(amount * this.currentTuning.expressionIntensity * tweak.intensity, 0, 1.5);
      return {
        smile: clamp((face.smile + tweak.smile) * gain, -1, 1), eyeSmile: clamp(face.eyeSmile * gain, -1, 1),
        browL: clamp((face.browL + tweak.brow) * gain, -1, 1), browR: clamp((face.browR + tweak.brow) * gain, -1, 1),
        eye: clamp(1 + (clamp(face.eye + tweak.eyeOpen, 0, 1.5) - 1) * gain, 0, 1.5),
        open: clamp((face.open + tweak.mouthOpen) * gain), blush: clamp((face.blush + tweak.blush) * gain),
        pucker: clamp(face.pucker * gain), funnel: clamp(face.funnel * gain), cheek: clamp(face.cheek * gain), innerBrow: clamp(face.innerBrow * gain),
        pupil: clamp(1 + (face.pupil - 1) * gain, .9, 1.1),
        parameters: Object.fromEntries(Object.entries(profile.parameters).map(([key, value]) => [key, value * gain])),
      };
  }

  _blendChestFace(base, reaction) {
    const left = this._profileFace(reaction.left.emotion, 1, reaction.left.face);
    const right = this._profileFace(reaction.right.emotion, 1, reaction.right.face);
    for (const key of Object.keys(base)) if (key !== 'parameters') {
      const value = mix(left[key], right[key], reaction.blend);
      base[key] = mix(base[key], key === 'blush' ? value * this.currentTuning.blushStrength : value, reaction.weight);
    }
    for (const key of Object.keys(base.parameters)) base.parameters[key] = mix(base.parameters[key], mix(left.parameters[key], right.parameters[key], reaction.blend), reaction.weight);
  }

  _composeFace(id, strength, dt) {
    const base = this._profileFace(id, strength);
    if (this.expressionPreview && this.time >= this.expressionPreview.until) this.expressionPreview = null;
    const faceCue = this.expressionPreview ?? this.expressionCue;
    this.expressionCueWeight = smooth(this.expressionCueWeight, faceCue?.active ? 1 : 0, dt, 11);
    if (!faceCue || this.expressionCueWeight < .001) {
      if (!this.expressionCue?.active) { this.expressionCueWeight = 0; this.expressionCue = null; }
      return base;
    }
    const baseStyle = { ...base.parameters };
    const cue = this._profileFace(faceCue.emotion, faceCue.intensity);
    for (const key of Object.keys(base)) if (key !== 'parameters') base[key] = mix(base[key], cue[key], this.expressionCueWeight);
    for (const key of Object.keys(base.parameters)) base.parameters[key] = mix(base.parameters[key], cue.parameters[key], this.expressionCueWeight);
    // A style switch is sequential, not two overlapping sets of pupils.
    const dominant = this.expressionCueWeight > .5 ? cue.parameters : baseStyle;
    for (const key of SPECIAL_EYE_KEYS) base.parameters[key] = dominant[key];
    return base;
  }

  destroy() {
    if (this.destroyed) return;
    this.basinEnabled = false;
    this.interrupt('idle');
    this._callRuntime('setPoseOverlay', {}, 0);
    this._callRuntime('setPupilScale', 1);
    this._callRuntime('setHandForeground', 0);
    this._callRuntime('setCuddleHand', 0);
    this._callRuntime('setFaceOverlay', {});
    this.pending = [];
    this.destroyed = true;
  }

  _updateImpact() {
    const age = this.time - this.knockStarted;
    if (!this.basinEnabled || age < 0 || age >= 0.66) {
      this._callRuntime('setImpactOverlay', {}, 0);
      this._callRuntime('setEarImpulse', 0, 0); return;
    }
    const weight = 1 - ease((age - 0.22) / 0.44);
    const pulse = Math.exp(-age * 7) * Math.cos(age * 22);
    // A short shoulder/torso shudder through authored upstream physics inputs.
    // A new click replaces its phase, never adds force to earlier strikes.
    const shudder = Math.exp(-age * 6.5) * Math.cos(age * 30) * this.currentTuning.bodyMotion;
    const side = this.knockCount % 2 ? 1 : -1;
    this._callRuntime('setEarImpulse', pulse * weight * (side > 0 ? 0.45 : 0.36), pulse * weight * (side > 0 ? 0.36 : 0.45));
    // These are the exact inputs of the author's circle-eye expression.
    // The independent runtime overlay also overrides competing eye
    // expressions, and releases back to them after the reaction.
    const impact = {
      key3: 1, key4: 0, key5: 0, key6: 0,
      AngleY: finite(this.values.AngleY) - 6 * pulse,
      AngleZ: finite(this.values.AngleZ) + side * 2 * pulse,
      PositionX: finite(this.values.PositionX) + side * 14 * shudder,
      PositionY: finite(this.values.PositionY) - 7 * shudder,
      PositionZ: finite(this.values.PositionZ) + side * 9 * shudder,
      LeanInput: finite(this.values.LeanInput) - 8 * shudder,
      ParamBrowLY: 0.65, ParamBrowRY: 0.65, BrowInnerUp: 0.3,
      ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, EyeSmile: 0,
      ParamMouthForm: -0.2, Mouthpucker: 0, MouthPuckerWiden: 0, MouthFunnel: 0, CheeckPuff: 0,
    };
    // Prop sounds never enter the speech analyser. An active spoken reply keeps
    // complete ownership of the mouth opening, including silence between words.
    if (this._state !== 'speaking') { impact.ParamMouthOpenY = 0.28; impact.JawOpen = 0.16; }
    for (const id of ['PositionX', 'PositionY', 'PositionZ', 'LeanInput', 'AngleY', 'AngleZ']) {
      impact[id] = clamp(impact[id], this.parameterLimits[id]?.min ?? -30, this.parameterLimits[id]?.max ?? 30);
    }
    this._callRuntime('setImpactOverlay', impact, weight);
  }

  _schedule(delay, run) { this.pending.push({ at: this.time + delay, generation: this.generation, run }); }

  _cancelTransient(keepGesture = false) {
    this.generation += 1;
    this.pending = [];
    this.action = null;
    this._clearExpressions();
    if (!keepGesture) this._setGesture('none');
  }

  _finishAction() {
    this.generation += 1;
    this.pending = [];
    this.action = null;
    this._clearExpressions();
    this._syncGesture();
  }

  _clearExpressions() {
    this.actionExpressions.clear();
    this._syncExpressions();
  }

  _setEmotionExpression(emotion) {
    const expression = EMOTIONS[emotion]?.expression;
    if (expression) this._activateExpression(expression);
  }

  _activateExpression(name) {
    if (!OWNED_EXPRESSIONS.includes(name)) return;
    this.actionExpressions.add(name);
    this._syncExpressions();
  }

  _syncExpressions() {
    const desired = new Set(this.actionExpressions);
    const touched = this.petting.active || this.petWeight > 0.03;
    if (this.basinEnabled) desired.add('钢盆');
    if (this._state === 'thinking') desired.add('加载');
    if (touched) desired.delete('屑屑眼');
    for (const name of this.activeExpressions) if (!desired.has(name)) this._callRuntime('setExpression', name, false);
    for (const name of desired) if (!this.activeExpressions.has(name)) this._callRuntime('setExpression', name, true);
    this.activeExpressions = desired;
  }

  _setGesture(input) {
    const gesture = GESTURE_ALIASES[input] ?? input;
    if (gesture !== 'none' && !Object.hasOwn(HANDS, gesture)) return;
    if (gesture === this.queuedGesture?.gesture) return;
    if (gesture === this.gesture) { this.queuedGesture = null; return; }
    this.queuedGesture = null;
    const previous = this.gesture;
    // One hand-motion lane: queued instructions are canceled by generation.
    if (previous !== 'none') {
      this._callRuntime('stopMotion');
      this._callRuntime('playMotion', HANDS[previous].close, { loop: false, holdLastFrame: false, fadeMs: 200 });
      this.gestureClosingUntil = this.time + HANDS[previous].closeSeconds + 0.05;
      this.gesture = 'none';
    }
    if (gesture !== 'none') {
      const wait = Math.max(0, this.gestureClosingUntil - this.time);
      if (wait === 0) this._startGesture(gesture);
      else this.queuedGesture = { at: this.time + wait, gesture };
    }
  }

  _startGesture(gesture) {
    this.gesture = gesture;
    this._callRuntime('playMotion', HANDS[gesture].open, { loop: false, holdLastFrame: true, fadeMs: 200 });
  }

  _desiredGesture() {
    if (this.petting.active && this.time - this.petStarted >= 2) return 'chest';
    const performance = this._bodyPerformance();
    if (performance) {
      const progress = performance.progress ?? (this.time - performance.start) / performance.duration;
      if (progress >= 1) return 'none';
      return performance.gesture ?? sampleBodyAnimation(performance.id, 0).gesture;
    }
    if (this.action?.intent === 'cuddle') return 'chest';
    if (this.action?.source === 'command') return GESTURE_ALIASES[this.action.gesture] ?? this.action.gesture ?? 'none';
    return this._state === 'thinking' ? 'pointer' : 'none';
  }

  _syncGesture() { this._setGesture(this._desiredGesture()); }

  _updateArmPose(name, strength, dt, offsets = null) {
    const pose = ARM_POSES[name];
    const targetWeight = pose ? clamp(strength) : 0;
    this.poseWeight = smooth(this.poseWeight, targetWeight, dt, 5);
    if (this.poseWeight < 0.001 && !pose) {
      this.poseWeight = 0; this.poseValues = {};
      this._callRuntime('setPoseOverlay', {}, 0); return;
    }
    if (pose) for (const id of ARM_IDS) {
      const adjustment = ARM_SELECTORS.has(id) ? 0 : finite(offsets?.[id]) * this.currentTuning.gestureAmplitude;
      const to = (pose[id] ?? 0) + adjustment;
      // Initial entrance blends against the currently authored motion in runtime;
      // subsequent pose changes interpolate the same input set continuously.
      // A completed close hands selectors to the new mesh immediately. Blending
      // stale selectors would briefly expose both replacement hands at once.
      this.poseValues[id] = ARM_SELECTORS.has(id) ? to : smooth(finite(this.poseValues[id], to), to, dt, 7);
    }
    // During an authored close, selector curves alone decide which mesh is
    // present. Even a 3% stale selector reveals a second translucent hand.
    const values = pose ? this.poseValues : Object.fromEntries(Object.entries(this.poseValues).filter(([id]) => !ARM_SELECTORS.has(id)));
    this._callRuntime('setPoseOverlay', values, this.poseWeight);
  }

  _playThought() {
    const candidates = THOUGHTS.filter(item => item.id !== this.lastThought);
    const thought = candidates[Math.min(candidates.length - 1, Math.floor(clamp(this.random()) * candidates.length))];
    this.lastThought = thought.id;
    this.action = { ...thought, emotion: thought.emotion ?? 'neutral', gaze: thought.gaze ?? 'camera', intensity: 0.72, start: this.time, source: 'thought' };
    if (thought.expression) this._activateExpression(thought.expression);
    this._setEmotionExpression(this.action.emotion);
    this.nextThought = this.time + thought.duration + this.thoughtCooldown + clamp(this.random()) * 3;
    this._schedule(thought.duration - actionFade(thought.duration), () => this._clearExpressions());
    this._schedule(thought.duration, () => this._finishAction());
    this.onEvent({ type: 'thought', id: thought.id });
  }

  _gaze(value) {
    if (value && typeof value === 'object') return { x: clamp(value.x, -1, 1), y: clamp(value.y, -1, 1) };
    return ({ camera: { x: 0, y: 0 }, left: { x: -0.8, y: 0.12 }, right: { x: 0.8, y: 0.12 }, down: { x: 0.16, y: -0.5 }, up: { x: 0, y: 0.65 } })[value] ?? { x: 0, y: 0 };
  }

  _closeMouthImmediately() {
    this.mouth = 0;
    this.values.ParamMouthOpenY = 0;
    this.values.JawOpen = 0;
    if (this.phonemesVerified) for (const id of Object.values(PHONEMES)) this.values[id] = 0;
    this._writeParameters({ ParamMouthOpenY: 0, JawOpen: 0, ...(this.phonemesVerified ? Object.fromEntries(Object.values(PHONEMES).map(id => [id, 0])) : {}) });
  }

  _writeParameters(parameters) {
    const output = {};
    for (const [id, value] of Object.entries(parameters)) {
      if (!Number.isFinite(value)) continue;
      const limits = this.parameterLimits[id];
      output[id] = limits && Number.isFinite(limits.min) && Number.isFinite(limits.max) ? clamp(value, limits.min, limits.max) : value;
    }
    this.runtime.setParameters(output);
  }

  _callRuntime(method, ...args) {
    try {
      const result = this.runtime[method]?.(...args);
      if (result && typeof result.catch === 'function') result.catch(error => this.onEvent({ type: 'error', message: String(error?.message ?? error) }));
    } catch (error) {
      this.onEvent({ type: 'error', message: String(error?.message ?? error) });
    }
  }
}
