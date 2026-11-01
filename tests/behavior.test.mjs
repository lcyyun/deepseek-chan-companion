import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorController, BEHAVIOR_PRESETS, BODY_ANIMATION_PRESETS } from '../src/shared/behavior.mjs';
import { EXPRESSION_PRESETS } from '../src/shared/expressions.mjs';
import { sanitizeModelTuning } from '../src/shared/model-tuning.mjs';
import { CHEST_REACTION_DURATIONS, sampleChestReaction } from '../src/shared/chest-reaction.mjs';
import { sampleBodyAnimation } from '../src/shared/body-animation.mjs';

// Names emitted by the production model-manifest scan (without JSON suffixes).
const motionNames = new Set(['竖手指切出来动画', '竖手指切回默认', '默认手切举手', '举手切默认手', '狗尾草切换出来', '狗尾草切回默认手']);
const expressionNames = new Set(['加载', '脸红', '屑屑眼', '流冷汗', '钢盆']);
// Exported from this model by the actual Cubism Core runtime, not inferred from
// VTS mapping ranges. Source: vendor/transitions-after/all-parameters.json.
const mocParameterRanges = [
  ...['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput'].map(id => ({ id, min: -30, max: 30, defaultValue: 0 })),
  ...['ParamEyeBallX', 'ParamEyeBallY', 'ParamMouthForm', 'ParamBrowLY', 'ParamBrowRY', 'EyeSmile'].map(id => ({ id, min: -1, max: 1, defaultValue: 0 })),
  ...['ParamEyeLOpen', 'ParamEyeROpen'].map(id => ({ id, min: 0, max: 1.5, defaultValue: 1 })),
  ...['ParamMouthOpenY', 'JawOpen', 'key7', 'ParamBreath', 'Mouthpucker', 'MouthFunnel', 'CheeckPuff', 'BrowInnerUp'].map(id => ({ id, min: 0, max: 1, defaultValue: 0 })),
  ...['key1', 'key2', 'key3', 'key4', 'key5', 'key6', 'key9', 'key13'].map(id => ({ id, min: 0, max: 1, defaultValue: 0 })),
  { id: 'MouthPuckerWiden', min: -1, max: 1, defaultValue: 0 },
  ...['Movement1', 'Movement2', 'Movement3', 'Param37', 'Param38', 'Param40'].map(id => ({ id, min: 0, max: 1, defaultValue: 0 })),
  ...['Param36', 'Param39', 'Param41', 'Param42', 'Param43', 'Param62', 'Param59', 'Param60', 'Param61'].map(id => ({ id, min: -1, max: 1, defaultValue: 0 })),
];

function fixture(options = {}) {
  const calls = [];
  const runtime = {
    params: Object.fromEntries(mocParameterRanges.map(p => [p.id, p.defaultValue])),
    setParameters(values) { Object.assign(this.params, values); calls.push(['parameters', values]); },
    setPoseOverlay(values, weight) { this.overlay = { values, weight }; },
    setPupilScale(scale) { this.pupilScale = scale; },
    setHandForeground(weight) { this.handFront = weight >= 0.5; },
    setCuddleHand(weight, active = false) { this.cuddleHand = weight; this.cuddleActive = active; },
    setGestureHands(kind, side, active) { this.gestureHands = { kind, side, active }; },
    setImpactOverlay(values, weight) { this.impact = { values: { ...values }, weight }; },
    setEarImpulse(left, right) { this.earImpulse = [left, right]; },
    setFaceOverlay(values) { this.faceOverlay = { ...values }; },
    playMotion(...args) { assert.ok(motionNames.has(args[0]), `Unknown manifest motion: ${args[0]}`); calls.push(['motion', ...args]); },
    setExpression(...args) { assert.ok(expressionNames.has(args[0]), `Unknown manifest expression: ${args[0]}`); calls.push(['expression', ...args]); },
    stopMotion() { calls.push(['stopMotion']); },
    reset() { calls.push(['reset']); },
    getParameters() { return mocParameterRanges; },
  };
  const events = [];
  const behavior = new BehaviorController(runtime, { random: () => 0.5, clockSeconds: () => behavior.time, onEvent: event => events.push(event), ...options });
  const advance = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i += 1) behavior.update(1 / 60); };
  return { runtime, calls, events, behavior, advance };
}

function finishChestBoundaryRounds({ behavior, advance }) {
  for (const duration of CHEST_REACTION_DURATIONS.slice(0, 3)) {
    assert.equal(behavior.tapChest(), true);
    advance(duration + 0.1);
  }
  assert.equal(behavior.isChestAwaitingPetting, true);
}

function comfortChest({ behavior, advance }) {
  behavior.setPetting(true, { newContact: true });
  advance(0.35);
  assert.equal(behavior.isChestHeartArmed, true);
  behavior.setPetting(false);
  advance(0.8);
}

test('speech preserves emotion and writes upstream parameters only', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setState('speaking');
  behavior.perform({ emotion: 'happy', intent: 'explain', durationMs: 4000 });
  behavior.setAudioLevel(0.65);
  advance(0.5);
  assert.ok(runtime.params.ParamMouthOpenY > 0.3);
  assert.ok(runtime.params.JawOpen > 0.2);
  assert.ok(runtime.params.ParamMouthForm > 0.2);
  assert.ok(runtime.params.EyeSmile > 0.2);
  assert.ok('AngleX' in runtime.params);
  for (const id of ['ParamAngleX', 'Emotion', 'Emotion2', 'LipPhysics1', 'ParamA']) assert.equal(id in runtime.params, false);
});

test('audio silence closes mouth while speech state remains active', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setState('speaking');
  behavior.setAudioLevel(1);
  advance(0.3);
  behavior.setAudioLevel(0);
  advance(0.5);
  assert.ok(runtime.params.ParamMouthOpenY < 0.001);
  assert.equal(behavior.state, 'speaking');
});

test('interrupt cancels thought timers immediately and never reactivates the old effect', () => {
  const { behavior, runtime, calls, advance } = fixture({ random: () => 0.65 });
  behavior.setState('thinking');
  advance(2.6);
  assert.ok(calls.some(call => call[0] === 'expression' && call[1] === '加载' && call[2]));
  behavior.interrupt();
  const after = calls.length;
  advance(30);
  assert.equal(behavior.state, 'listening');
  assert.equal(runtime.params.ParamMouthOpenY, 0);
  assert.ok(calls.some(call => call[0] === 'expression' && call[1] === '加载' && call[2] === false));
  assert.equal(calls.slice(after).some(call => call[0] === 'expression' && call[2] === true), false);
});

test('thinking easter eggs are infrequent and never repeat consecutively', () => {
  const { behavior, events, advance } = fixture({ random: () => 0 });
  behavior.setState('thinking');
  advance(40);
  const thoughts = events.filter(event => event.type === 'thought');
  assert.ok(thoughts.length >= 3 && thoughts.length <= 6);
  assert.ok(thoughts.every((event, index) => index === 0 || event.id !== thoughts[index - 1].id));
});

test('gesture opens with hold and returns via the paired motion after interruption', () => {
  const { behavior, calls, advance } = fixture();
  behavior.perform({ gesture: 'pointer', durationMs: 4000 });
  assert.deepEqual(calls.find(call => call[0] === 'motion').slice(1), ['竖手指切出来动画', { loop: false, holdLastFrame: true, fadeMs: 200 }]);
  behavior.interrupt();
  const count = calls.filter(call => call[0] === 'motion').length;
  advance(10);
  assert.equal(calls.filter(call => call[0] === 'motion').length, count);
  assert.ok(calls.some(call => call[0] === 'motion' && call[1] === '竖手指切回默认'));
});

test('new action cancels expiry of an older expression', () => {
  const { behavior, calls, advance } = fixture();
  behavior.perform({ emotion: 'shy', durationMs: 400 });
  advance(0.2);
  behavior.perform({ emotion: 'playful', durationMs: 3000 });
  const start = calls.length;
  advance(0.5);
  assert.equal(calls.slice(start).some(call => call[0] === 'expression' && call[1] === '屑屑眼' && !call[2]), false);
});

test('switching gestures completes the return and cancel prevents the queued opening', () => {
  const { behavior, calls, advance } = fixture();
  behavior.perform({ gesture: 'pointer', durationMs: 5000 });
  advance(0.5);
  behavior.perform({ gesture: 'chest', durationMs: 5000 });
  assert.equal(calls.some(call => call[0] === 'motion' && call[1] === '默认手切举手'), false);
  advance(0.5);
  behavior.interrupt();
  advance(3);
  assert.equal(calls.some(call => call[0] === 'motion' && call[1] === '默认手切举手'), false);
});

test('a short action cannot open its queued gesture after the action expires', () => {
  const { behavior, calls, advance } = fixture();
  behavior.perform({ gesture: 'pointer', durationMs: 5000 });
  advance(0.5);
  behavior.perform({ gesture: 'chest', durationMs: 300 });
  advance(3);
  assert.equal(calls.some(call => call[0] === 'motion' && call[1] === '默认手切举手'), false);
});

test('invalid audio values are finite and phonemes require explicit calibration', () => {
  const { behavior, runtime, advance } = fixture({ phonemesVerified: true, parameterLimits: { ParamMouthOpenY: { min: 0, max: 0.4 } } });
  behavior.setState('speaking');
  behavior.setAudioLevel(5, { A: 2, O: NaN });
  advance(0.4);
  assert.ok(runtime.params.ParamA > 0.9 && runtime.params.ParamA <= 1);
  assert.ok(runtime.params.ParamMouthOpenY <= 0.4);
  assert.equal(runtime.params.ParamO, 0);
  behavior.setAudioLevel(NaN);
  advance(0.4);
  assert.ok(Object.values(runtime.params).every(Number.isFinite));
  behavior.interrupt();
  assert.equal(runtime.params.ParamA, 0);
});

test('destroy clears active effects and stops future frame writes', () => {
  const { behavior, calls, advance } = fixture();
  behavior.perform({ emotion: 'shy' });
  behavior.destroy();
  const count = calls.length;
  advance(10);
  behavior.applyCommand({ type: 'perform', emotion: 'happy' });
  assert.equal(calls.length, count);
});

test('every authored preset resolves its actual manifest assets', () => {
  for (const preset of BEHAVIOR_PRESETS) {
    const { behavior, events, advance } = fixture();
    behavior.applyCommand(preset.command);
    advance(6);
    assert.deepEqual(events.filter(event => event.type === 'error'), [], preset.id);
  }
});

test('two-second petting threshold is continuous and releases back to thinking', () => {
  const { behavior, calls, advance } = fixture();
  behavior.setState('thinking');
  behavior.setPetting(true);
  advance(1.8);
  assert.equal(calls.some(c => c[0] === 'motion' && c[1] === '默认手切举手'), false);
  // Frequent pointer updates must not reset the two-second contact timer.
  for (let i = 0; i < 30; i++) { behavior.setPetting(true, { x: i / 30 }); advance(1 / 60); }
  advance(1.4);
  assert.equal(behavior.state, 'thinking');
  assert.equal(behavior.gesture, 'chest');
  const opened = calls.filter(c => c[0] === 'motion' && c[1] === '默认手切举手').length;
  advance(8);
  assert.equal(calls.filter(c => c[0] === 'motion' && c[1] === '默认手切举手').length, opened);
  behavior.setPetting(false); advance(1.3);
  assert.equal(behavior.gesture, 'pointer');
  behavior.setPetting(true); advance(1); behavior.setPetting(false); advance(1.5);
  assert.equal(calls.filter(c => c[0] === 'motion' && c[1] === '默认手切举手').length, opened);
});

test('persistent thinking keeps its finger gesture through small thought actions', () => {
  const { behavior, runtime, calls, advance } = fixture();
  behavior.setState('thinking'); advance(24);
  assert.equal(calls.filter(c => c[0] === 'motion' && c[1] === '竖手指切出来动画').length, 1);
  assert.equal(calls.some(c => c[0] === 'motion' && c[1] === '竖手指切回默认'), false);
  assert.ok(runtime.params.ParamBrowLY < -0.15 && runtime.params.ParamBrowRY < -0.1);
  assert.ok(runtime.params.Mouthpucker > 0.5);
  assert.ok(runtime.params.ParamMouthForm < -0.05);
  assert.equal(behavior.activeExpressions.has('加载'), true);
});

test('short repeated touches do not accumulate the sustained two-second threshold', () => {
  const { behavior, calls, advance } = fixture();
  for (let i = 0; i < 12; i++) { behavior.setPetting(true, { newContact: true }); advance(0.4); }
  assert.equal(calls.some(c => c[0] === 'motion' && c[1] === '默认手切举手'), false);
  advance(1.7);
  assert.equal(behavior.gesture, 'chest');
});

test('long touch controls both authored arm inputs and fades the overlay away on release', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setPetting(true); advance(1.9);
  assert.equal(runtime.overlay.weight, 0);
  advance(1.8);
  assert.ok(runtime.overlay.weight > 0.99);
  assert.equal(runtime.overlay.values.Movement2, 1);
  assert.equal(runtime.overlay.values.Movement3, 0, 'use the authored open palm, not the pointing-hand selector');
  assert.equal(runtime.overlay.values.Param37, 0);
  assert.equal(runtime.overlay.values.Param38, 0);
  assert.ok(runtime.cuddleHand > .99);
  assert.equal(runtime.overlay.values.Param41, 0, 'leave the old palm arm at rest while the complete chest arm is mirrored');
  assert.equal(runtime.overlay.values.Param60, .82, 'the calibrated forearm angle leaves space between both fingertips');
  assert.equal(runtime.overlay.values.Param43, 0, 'keep the clean authored finger shape');
  assert.equal(runtime.handFront, true);
  for (const [id, value] of Object.entries(runtime.overlay.values)) {
    const range = mocParameterRanges.find(p => p.id === id);
    assert.ok(range && value >= range.min && value <= range.max, id);
  }
  for (const id of ['RArm', 'RForearm', 'LArm', 'LForearm']) assert.equal(id in runtime.overlay.values, false);
  behavior.setPetting(false);
  behavior.update(1 / 60);
  assert.ok(runtime.overlay.weight > 0.8, 'the release must not drop both hands in one frame');
  for (const id of ['Movement1', 'Movement2', 'Movement3', 'Param37', 'Param38', 'Param40']) {
    assert.equal(id in runtime.overlay.values, false, 'authored close exclusively owns mesh selectors: ' + id);
  }
  advance(1.6);
  assert.equal(runtime.overlay.weight, 0);
  assert.deepEqual(runtime.overlay.values, {});
  assert.equal(runtime.handFront, false);
  assert.ok(runtime.cuddleHand < .001);
});

test('idea continues the raised finger and hands the same gesture to reply without a reset', () => {
  const { behavior, calls, advance } = fixture();
  behavior.setState('thinking'); advance(2);
  behavior.perform({ intent: 'idea', emotion: 'happy', gesture: 'pointer', durationMs: 2000 });
  behavior.setState('idle'); advance(1.8);
  behavior.perform({ intent: 'explain', gesture: 'pointer', durationMs: 4000 });
  assert.equal(calls.filter(c => c[0] === 'motion' && c[1] === '竖手指切出来动画').length, 1);
  assert.equal(calls.some(c => c[0] === 'motion' && c[1] === '竖手指切回默认'), false);
  assert.equal(behavior.activeExpressions.has('加载'), false);
  behavior.interrupt(); advance(5);
  assert.equal(behavior.gesture, 'none');
  assert.equal(behavior.queuedGesture, null);
});

test('idea opens a happy mouth, raises eyebrows and subtly enlarges pupils, then fades', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.nextBlink = Infinity;
  behavior.perform({ intent: 'idea', emotion: 'happy', durationMs: 2000 });
  advance(0.65);
  assert.ok(runtime.params.ParamMouthOpenY > 0.4 && runtime.params.JawOpen > 0.2);
  assert.ok(runtime.params.ParamMouthForm > 0.65);
  assert.ok(runtime.params.ParamBrowLY > 0.5 && runtime.params.ParamBrowRY > 0.5);
  assert.ok(runtime.params.BrowInnerUp > 0.15);
  assert.ok(runtime.pupilScale > 1.04 && runtime.pupilScale <= 1.08);
  assert.ok(runtime.params.ParamEyeLOpen > 1.05);
  advance(1.8);
  assert.equal(runtime.params.ParamMouthOpenY, 0);
  assert.ok(Math.abs(runtime.params.ParamBrowLY) < 0.02);
  assert.ok(Math.abs(runtime.pupilScale - 1) < 0.002);
  behavior.reset();
  assert.equal(runtime.pupilScale, 1);
});

test('thought face looks upward and pouts; touch and speech take ownership without dropping loading', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.perform({ intent: 'think', durationMs: 6000 });
  advance(0.8);
  assert.ok(runtime.params.AngleY > 7 && runtime.params.ParamEyeBallY > 0.2);
  assert.ok(runtime.params.Mouthpucker > 0.65 && runtime.params.MouthPuckerWiden < -0.3);
  assert.ok(runtime.params.ParamBrowLY < -0.2 && runtime.params.ParamBrowRY < -0.15);
  assert.equal(runtime.handFront, true);
  for (const id of ['ParamBrowLAngle', 'ParamBrowRAngle', 'PupilX', 'PupilY']) assert.equal(id in runtime.params, false);
  behavior.setPetting(true); advance(0.8);
  assert.ok(runtime.params.Mouthpucker < 0.02);
  assert.equal(runtime.params.ParamEyeLOpen, 0);
  assert.equal(behavior.activeExpressions.has('加载'), true);
  behavior.setPetting(false);
  behavior.setState('speaking'); behavior.setAudioLevel(0.8); advance(0.8);
  assert.ok(runtime.params.Mouthpucker < 0.001);
  assert.ok(runtime.params.ParamMouthOpenY > 0.5);
  behavior.perform({ intent: 'idea', emotion: 'happy', durationMs: 2000 });
  behavior.setAudioLevel(0); advance(0.8);
  assert.ok(runtime.params.ParamMouthOpenY < 0.001, 'a non-audio smile must not force the speaking mouth open');
  assert.equal(runtime.handFront, false);
  behavior.reset(); assert.equal(runtime.handFront, false);
});

test('stop cancels a queued arm change and a long touch cannot re-trigger it', () => {
  const { behavior, calls, advance } = fixture();
  behavior.setState('thinking'); advance(1.5);
  behavior.setPetting(true); advance(2.1);
  behavior.interrupt(); const stopped = calls.length; advance(10);
  assert.equal(calls.slice(stopped).some(c => c[0] === 'motion'), false);
  assert.equal(behavior.isPetting, false);
});

test('idle/listening snapshots do not cancel an explicit performance', () => {
  const { behavior, calls, advance } = fixture();
  behavior.setState('listening');
  behavior.perform({ gesture: 'pointer', emotion: 'shy', durationMs: 3000 });
  behavior.setState('idle');
  advance(1.6);
  assert.equal(calls.some(call => call[0] === 'motion' && call[1] === '竖手指切回默认'), false);
  assert.equal(calls.some(call => call[0] === 'expression' && call[1] === '脸红' && call[2] === false), false);
  advance(1.6);
  assert.ok(calls.some(call => call[0] === 'motion' && call[1] === '竖手指切回默认'));
});

test('nodding has a visible envelope and thinking signals immediately', () => {
  const { behavior, runtime, calls } = fixture();
  behavior.perform({ intent: 'agree', intensity: 0.65, durationMs: 1800 });
  let peak = 0;
  for (let frame = 0; frame < 90; frame += 1) { behavior.update(1 / 60); peak = Math.max(peak, Math.abs(runtime.params.AngleY)); }
  assert.ok(peak > 6, `Nod peak was only ${peak}`);
  behavior.interrupt('idle');
  behavior.setState('thinking');
  assert.ok(calls.some(call => call[0] === 'expression' && call[1] === '加载' && call[2]));
  behavior.update(1 / 60);
  assert.equal(behavior.state, 'thinking');
});

test('held petting follows live input and has a sustained smile without a timeout', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setPetting(true, { x: -1, y: 0, speed: 0.5, intensity: 1 });
  advance(0.7);
  assert.ok(runtime.params.AngleX < -8);
  behavior.setPetting(true, { x: 1, y: 0.5, speed: 0.7 });
  advance(0.7);
  assert.ok(runtime.params.AngleX > 8);
  assert.ok(runtime.params.ParamEyeLOpen < 0.5);
  assert.ok(runtime.params.EyeSmile > 0.7);
  assert.ok(runtime.params.ParamMouthForm > 0.6);
  assert.ok(runtime.params.key7 > 0.2 && runtime.params.key7 <= 0.35);
  advance(5);
  assert.equal(behavior.isPetting, true);
  behavior.setPetting(false);
  advance(0.8);
  assert.ok(Math.abs(runtime.params.AngleX) < 1.5);
  assert.ok(runtime.params.EyeSmile < 0.05);
  assert.ok(runtime.params.key7 < 0.05, 'the stronger sustained-contact blush fades with the hand release');
  advance(0.4);
  assert.ok(runtime.params.key7 < 0.02);
});

test('petting preserves speaking audio and respects actual runtime limits', () => {
  const { behavior, runtime, advance } = fixture({ parameterLimits: { AngleX: { min: -10, max: 10 }, AngleZ: { min: -7, max: 7 } } });
  behavior.setState('speaking');
  behavior.setAudioLevel(0.7);
  behavior.setPetting(true, { x: 100, y: NaN, speed: Infinity, intensity: 5 });
  advance(1);
  assert.equal(behavior.state, 'speaking');
  assert.ok(runtime.params.ParamMouthOpenY > 0.5);
  assert.ok(runtime.params.AngleX <= 10 && runtime.params.AngleZ >= -7);
  assert.ok(Object.values(runtime.params).every(Number.isFinite));
});

test('petting retains the thinking loading indicator until the request is interrupted', () => {
  const { behavior, calls, advance } = fixture();
  behavior.setState('thinking');
  behavior.setPetting(true, { x: 0, y: 0, speed: 0 });
  advance(1);
  assert.equal(behavior.state, 'thinking');
  assert.equal(behavior.activeExpressions.has('加载'), true);
  behavior.setPetting(false);
  advance(0.8);
  assert.equal(calls.some(call => call[0] === 'expression' && call[1] === '加载' && call[2] === false), false);
  behavior.setPetting(true, { x: 1, y: 1, speed: 0.5 });
  advance(0.4);
  behavior.interrupt();
  assert.equal(behavior.isPetting, false);
  assert.equal(behavior.state, 'listening');
  assert.equal(behavior.activeExpressions.has('加载'), false);
});

test('petting fully closes both eyes at their real minima without closing a speaking mouth', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.nextBlink = Infinity;
  behavior.setState('speaking');
  behavior.setAudioLevel(0.8);
  behavior.setPetting(true, { x: 0, y: 0, speed: 0 });
  advance(0.8);
  assert.equal(runtime.params.ParamEyeLOpen, 0);
  assert.equal(runtime.params.ParamEyeROpen, 0);
  assert.ok(runtime.params.ParamMouthForm > 0.6);
  assert.ok(runtime.params.ParamMouthOpenY > 0.5 && runtime.params.JawOpen > 0.4);
  behavior.setPetting(false);
  behavior.update(1 / 60);
  assert.ok(runtime.params.ParamEyeLOpen > 0 && runtime.params.ParamEyeLOpen < 0.2);
  advance(0.8);
  assert.ok(runtime.params.ParamEyeLOpen > 0.99);
  assert.ok(runtime.params.ParamMouthOpenY > 0.5);
});

test('natural action expiry fades pose, emotion and non-audio mouth continuously', () => {
  for (const command of [
    { intent: 'curious', emotion: 'surprised', gaze: 'right' },
    { intent: 'surprised', emotion: 'surprised' },
    { intent: 'shy', emotion: 'shy', gaze: 'left' },
    { intent: 'think', emotion: 'puzzled' },
    { intent: 'idea', emotion: 'happy' },
  ]) {
    const { behavior, runtime } = fixture();
    behavior.nextBlink = Infinity;
    behavior.perform({ ...command, intensity: 1, durationMs: 1800 });
    let previous, maxTailStep = 0, maxExpiryStep = 0, maxBlushStep = 0;
    for (let frame = 0; frame < 140; frame += 1) {
      behavior.update(1 / 60);
      const current = { ...runtime.params };
      if (previous && frame > 95 && frame < 120) {
        for (const p of mocParameterRanges) {
          const delta = Math.abs(current[p.id] - previous[p.id]) / (p.max - p.min);
          // v0.8 shy has a strong authored blush instead of only the old light
          // pat tint. Check its opacity fade separately from physical pose jumps.
          if (p.id === 'key7') { maxBlushStep = Math.max(maxBlushStep, delta); continue; }
          maxTailStep = Math.max(maxTailStep, delta);
          if (frame >= 106 && frame <= 110) maxExpiryStep = Math.max(maxExpiryStep, delta);
        }
        maxTailStep = Math.max(maxTailStep, Math.abs(current.ParamMouthOpenY - previous.ParamMouthOpenY));
      }
      previous = current;
    }
    assert.ok(maxTailStep < 0.025, `${command.intent}: fade step ${maxTailStep}`);
    assert.ok(maxExpiryStep < 0.015, `${command.intent}: expiry step ${maxExpiryStep}`);
    assert.ok(maxBlushStep < 0.035, `${command.intent}: blush flashed by ${maxBlushStep}`);
    assert.ok(runtime.params.key7 < .02);
    assert.ok(Math.abs(runtime.params.ParamMouthForm) < 0.02);
    assert.ok(runtime.params.ParamMouthOpenY < 0.001);
    assert.ok(Math.abs(runtime.params.AngleZ) < 1);
  }
});

test('pointer distance drives head and body proportionally through real bounded upstream inputs', () => {
  const small = fixture(), large = fixture();
  for (const [f, x] of [[small, 0.2], [large, 0.9]]) {
    f.behavior.setPointerTracking(true, { x, y: -x, speed: 0.3, travel: x });
    f.advance(1.2);
  }
  assert.ok(large.runtime.params.AngleX > small.runtime.params.AngleX * 3);
  assert.ok(large.runtime.params.PositionX > small.runtime.params.PositionX * 3);
  assert.ok(large.runtime.params.ParamEyeBallX > 0.4 && large.runtime.params.ParamEyeBallY > 0.35);
  large.behavior.setPointerTracking(true, { x: 100, y: -100, speed: Infinity, travel: 5 });
  large.advance(1);
  for (const p of mocParameterRanges) assert.ok(large.runtime.params[p.id] >= p.min && large.runtime.params[p.id] <= p.max, p.id);
  for (const id of ['ParamAngleX', 'ParamAngleY', 'ParamBodyAngleX', 'Param50', 'Emotion']) assert.equal(id in large.runtime.params, false);
});

test('pointer reversal and release preserve inertia without frame discontinuities', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setPointerTracking(true, { x: 1, y: -0.7, speed: 1, travel: 1 });
  advance(1.2);
  const before = runtime.params.AngleX;
  behavior.setPointerTracking(true, { x: -1, y: 0.7, speed: 1, travel: 1 });
  assert.equal(runtime.params.AngleX, before);
  let previous = before, maxStep = 0;
  for (let i = 0; i < 90; i += 1) { behavior.update(1 / 60); maxStep = Math.max(maxStep, Math.abs(runtime.params.AngleX - previous)); previous = runtime.params.AngleX; }
  assert.ok(runtime.params.AngleX < -20);
  assert.ok(maxStep < 2.1, `Reversal step ${maxStep}`);
  behavior.setPointerTracking(false);
  behavior.update(1 / 60);
  assert.ok(Math.abs(runtime.params.AngleX - previous) < 1);
  advance(1.2);
  assert.equal(behavior.isPointerTracking, false);
  assert.ok(Math.abs(runtime.params.AngleX) < 1);
});

test('petting takes priority over global tracking; stop/reset clear both sustained inputs', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setPointerTracking(true, { x: 1, y: 0, speed: 0, travel: 1 });
  advance(1);
  behavior.setPetting(true, { x: -1, y: 0, speed: 0 });
  advance(0.9);
  assert.ok(runtime.params.AngleX < -9);
  assert.equal(runtime.params.ParamEyeLOpen, 0);
  assert.equal(behavior.isPointerTracking, true);
  behavior.setPetting(false);
  advance(1.1);
  assert.ok(runtime.params.AngleX > 20);
  behavior.interrupt();
  assert.equal(behavior.isPointerTracking, false);
  assert.equal(behavior.isPetting, false);
  advance(1.3);
  assert.ok(Math.abs(runtime.params.AngleX) < 1);
  behavior.setPointerTracking(true, { x: -1 });
  behavior.setPetting(true);
  behavior.reset();
  assert.equal(behavior.isPointerTracking, false);
  assert.equal(behavior.isPetting, false);
});

test('basin is persistent, replaces petting, and survives state changes and reset', () => {
  const { behavior, calls, runtime, advance } = fixture();
  assert.equal(behavior.knockBasin(), false);
  behavior.setPetting(true); advance(.8);
  behavior.setBasinEnabled(true);
  assert.equal(behavior.isPetting, false);
  behavior.setPetting(true); advance(3);
  assert.equal(behavior.isPetting, false);
  assert.equal(behavior.gesture, 'none');
  assert.equal(behavior.activeExpressions.has('钢盆'), true);
  behavior.setState('thinking'); advance(1);
  behavior.knockBasin(); behavior.interrupt();
  assert.equal(runtime.impact.weight, 0);
  assert.equal(behavior.activeExpressions.has('钢盆'), true);
  const beforeReset = calls.length;
  behavior.reset();
  assert.equal(behavior.isBasinEnabled, true);
  assert.ok(calls.slice(beforeReset).some(c => c[0] === 'expression' && c[1] === '钢盆' && c[2]));
  behavior.setBasinEnabled(false); advance(.1);
  assert.equal(behavior.activeExpressions.has('钢盆'), false);
  assert.equal(behavior.knockBasin(), false);
  behavior.setPetting(true); advance(.8);
  assert.equal(behavior.isPetting, true);
  assert.equal(runtime.params.ParamEyeLOpen, 0);
});

test('rapid basin taps restart one bounded response, with no stale queue after the last tap', () => {
  const { behavior, runtime, events, advance } = fixture();
  behavior.setBasinEnabled(true);
  behavior.setState('thinking');
  for (let i = 0; i < 30; i++) {
    assert.equal(behavior.knockBasin(), true);
    assert.equal(runtime.impact.weight, 1);
    assert.equal(runtime.impact.values.key3, 1);
    behavior.setBasinEnabled(true);
    assert.equal(runtime.impact.weight, 1, 'a redundant persisted-state snapshot must not cancel the strike');
    assert.equal(runtime.impact.values.key4 + runtime.impact.values.key5 + runtime.impact.values.key6, 0);
    assert.ok(runtime.earImpulse.every(value => Math.abs(value) <= .45));
    assert.equal('LControl' in runtime.impact.values, false, 'LControl is a physics output, not an input');
    advance(i % 3 === 0 ? .17 : .05);
  }
  assert.equal(events.filter(e => e.type === 'basin-knock').length, 30);
  assert.equal(behavior.state, 'thinking');
  assert.equal(behavior.activeExpressions.has('加载'), true);
  advance(.8);
  assert.deepEqual(runtime.impact, { values: {}, weight: 0 });
  assert.deepEqual(runtime.earImpulse, [0, 0]);
  advance(4);
  assert.equal(events.filter(e => e.type === 'basin-knock').length, 30);
  assert.equal('LControl' in runtime.params, false, 'idle ear physics must not be permanently overridden');
});

test('a basin strike preserves speech mouth ownership and unmount/disable/stop cancel it', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setBasinEnabled(true); behavior.setState('speaking');
  behavior.setAudioLevel(.8); advance(.3);
  behavior.knockBasin(); advance(.05);
  assert.ok(runtime.params.ParamMouthOpenY > .5);
  assert.equal('ParamMouthOpenY' in runtime.impact.values, false);
  behavior.setAudioLevel(0); advance(.4);
  assert.ok(runtime.params.ParamMouthOpenY < .001);
  behavior.setBasinEnabled(false);
  assert.equal(runtime.impact.weight, 0);
  behavior.setBasinEnabled(true); behavior.knockBasin(); behavior.interrupt();
  assert.equal(runtime.impact.weight, 0);
  behavior.knockBasin(); behavior.destroy();
  assert.equal(runtime.impact.weight, 0);
  assert.equal(behavior.knockBasin(), false);
  assert.equal(behavior.activeExpressions.has('钢盆'), false);
});

test('long petting blooms into crimson and personalization fades without resetting contact', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setPetting(true); advance(1.8);
  assert.ok(runtime.params.key7 > .25 && runtime.params.key7 < .36);
  advance(1.4);
  assert.ok(runtime.params.key7 > .7 && runtime.params.key7 <= .75);
  assert.equal(runtime.params.ParamEyeLOpen, 0);
  behavior.setTuning({ blushStrength: 0 });
  behavior.update(1 / 60);
  assert.ok(runtime.params.key7 > .65, 'a slider edit should not flash the face in one frame');
  assert.equal(behavior.isPetting, true);
  advance(1.8);
  assert.ok(runtime.params.key7 < .001);
  behavior.setTuning({ blushStrength: 1 }); advance(1.8);
  assert.ok(runtime.params.key7 > .99);
  behavior.setPetting(false); advance(2);
  assert.ok(runtime.params.key7 < .001);
});

test('cuddle arm ownership holds through the face fade and releases at the authored closing transition', () => {
  const { behavior, runtime, calls, advance } = fixture();
  behavior.perform({ intent: 'cuddle', emotion: 'happy', durationMs: 4200 });
  advance(4.0);
  assert.equal(runtime.cuddleActive, true);
  assert.ok(runtime.overlay.weight > .99, 'hands stay posed while the facial expression fades');
  advance(.3);
  assert.equal(runtime.cuddleActive, false);
  assert.ok(calls.some(call => call[0] === 'motion' && call[1] === '举手切默认手'));
  behavior.setPetting(true); advance(3.2);
  assert.equal(runtime.cuddleActive, true);
  behavior.setPetting(false); advance(1 / 60);
  assert.equal(runtime.cuddleActive, false);
});

test('queued thinking and cuddle poses cannot bypass the previous authored arm close', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.perform({ intent: 'cuddle', durationMs: 6000 }); advance(1.5);
  behavior.perform({ intent: 'think', durationMs: 6000 }); advance(.7);
  assert.equal(behavior.gesture, 'none');
  assert.equal(runtime.cuddleActive, false);
  assert.equal('Movement3' in runtime.overlay.values, false, 'a queued finger must not enter during the chest close');
  assert.ok(runtime.params.Mouthpucker > .5, 'thinking face and loading do not wait for the arm');
  assert.equal(behavior.activeExpressions.has('加载'), true);
  advance(.8); assert.equal(behavior.gesture, 'pointer');
  assert.ok(runtime.overlay.values.Movement3 > .9);
  behavior.setPetting(true); advance(2.6);
  assert.equal(behavior.gesture, 'none');
  assert.equal(runtime.cuddleActive, false, 'mirrored chest arm waits for the pointing arm to close');
  advance(.8); assert.equal(behavior.gesture, 'chest');
  assert.equal(runtime.cuddleActive, true);
});

test('movement tuning scales the torso and gaze separately, remains bounded, and survives reset', () => {
  const small = fixture({ tuning: { bodyMotion: 0, gazeStrength: .3 } });
  const large = fixture({ tuning: { bodyMotion: 1.6, gazeStrength: 1.5 } });
  for (const f of [small, large]) { f.behavior.setPointerTracking(true, { x: .6, y: -.4 }); f.advance(1.5); }
  assert.equal(small.runtime.params.PositionX, 0);
  assert.equal(small.runtime.params.LeanInput, 0);
  assert.ok(large.runtime.params.AngleX > small.runtime.params.AngleX * 4);
  assert.ok(large.runtime.params.PositionX > 10);
  large.behavior.reset();
  assert.equal(large.behavior.tuning.bodyMotion, 1.6);
  large.behavior.setTuning({ bodyMotion: Infinity, gazeStrength: 100 });
  assert.equal(large.behavior.tuning.bodyMotion, 1.6);
  assert.equal(large.behavior.tuning.gazeStrength, 1.5);
  large.behavior.setPointerTracking(true, { x: 1, y: -1, speed: 1, travel: 1 }); large.advance(2);
  for (const key of ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput']) assert.ok(Math.abs(large.runtime.params[key]) <= 30);
});

test('basin shudder alternates through bounded body inputs and retriggers without accumulating', () => {
  const { behavior, runtime, advance } = fixture({ tuning: { bodyMotion: 1.6 } });
  behavior.setBasinEnabled(true); advance(.1); behavior.knockBasin();
  const first = runtime.impact.values.PositionX - runtime.params.PositionX;
  assert.ok(first > 20);
  advance(.1);
  assert.ok(runtime.impact.values.PositionX - runtime.params.PositionX < -8, 'body shudders back after the initial startle');
  for (let i = 0; i < 100; i++) {
    behavior.knockBasin();
    for (const id of ['PositionX', 'PositionY', 'PositionZ', 'LeanInput']) assert.ok(Math.abs(runtime.impact.values[id]) <= 30);
    assert.ok(Math.abs(Math.abs(runtime.impact.values.PositionX - runtime.params.PositionX) - first) < .001);
  }
  advance(.8);
  assert.equal(runtime.impact.weight, 0);
  behavior.setTuning({ bodyMotion: 0 }); advance(2); behavior.knockBasin();
  assert.ok(Math.abs(runtime.impact.values.PositionX - runtime.params.PositionX) < .001);
  assert.equal(runtime.impact.values.key3, 1, 'a quiet body setting keeps the startled face');
});

test('every face preset remains finite and does not activate props, loading or a hand motion', () => {
  for (const profile of EXPRESSION_PRESETS) {
    const { behavior, runtime, calls, advance } = fixture();
    behavior.perform({ intent: 'neutral', emotion: profile.id, gesture: 'none', intensity: 1, durationMs: 4000 }); advance(.9);
    assert.equal(calls.some(call => call[0] === 'motion'), false, profile.id);
    for (const parameter of mocParameterRanges) assert.ok(Number.isFinite(runtime.params[parameter.id]) && runtime.params[parameter.id] >= parameter.min && runtime.params[parameter.id] <= parameter.max, profile.id + ':' + parameter.id);
    for (const id of ['key8', 'key10', 'key11', 'key12']) assert.equal(id in runtime.faceOverlay, false);
  }
});

test('face-only cues retain the speaking mouth and arm performance and stop cannot replay them', () => {
  const { behavior, runtime, calls, advance } = fixture();
  behavior.perform({ intent: 'explain', gesture: 'pointer', emotion: 'happy', durationMs: 9000 });
  behavior.setState('speaking'); behavior.setAudioLevel(.7); advance(.5);
  const action = behavior.action, count = calls.filter(call => call[0] === 'motion').length;
  behavior.setExpressionCue('panic', .9); advance(.8);
  assert.ok(runtime.params.key13 > .7 && runtime.params.ParamBrowLY > .6);
  assert.ok(runtime.params.ParamMouthOpenY > .5);
  assert.equal(behavior.action, action);
  assert.equal(calls.filter(call => call[0] === 'motion').length, count);
  behavior.setExpressionCue('squeezed', 1); advance(1);
  assert.ok(runtime.params.key5 > .9);
  behavior.interrupt(); advance(1.5);
  assert.equal(behavior.expressionCue, null);
  for (const key of ['key3', 'key4', 'key5', 'key6', 'key13']) assert.ok(runtime.params[key] < .001);
  behavior.reset(); assert.deepEqual(runtime.faceOverlay, {});
});

test('mutually exclusive eye parts never overlap and touch overrides them without clearing loading', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setState('thinking');
  for (const emotion of ['love', 'squeezed', 'dizzy', 'smug', 'neutral']) {
    behavior.setExpressionCue(emotion, 1);
    for (let i = 0; i < 90; i++) {
      behavior.update(1 / 60);
      assert.ok(['key3', 'key4', 'key5', 'key6'].filter(key => runtime.params[key] > .001).length <= 1);
    }
  }
  behavior.setExpressionCue('love', 1); advance(.8);
  behavior.setPetting(true); advance(.8);
  assert.equal(runtime.params.ParamEyeLOpen, 0);
  assert.ok(runtime.params.key4 < .001);
  assert.equal(behavior.activeExpressions.has('加载'), true);
});

test('per-face tuning updates the current face smoothly and leaves another face untouched', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.perform({ emotion: 'cold', intensity: 1, durationMs: 10000 }); advance(1);
  const before = runtime.params.ParamMouthForm;
  behavior.setTuning({ expressionOverrides: { cold: { smile: .4, eyeOpen: .2, brow: .3, mouthOpen: .25, blush: .3 } } });
  behavior.update(1 / 60);
  assert.ok(Math.abs(runtime.params.ParamMouthForm - before) < .1);
  advance(1);
  assert.ok(runtime.params.ParamMouthForm > 0);
  assert.ok(runtime.params.ParamEyeLOpen > .75 && runtime.params.ParamMouthOpenY > .2 && runtime.params.key7 > .25);
  behavior.perform({ emotion: 'neutral', intensity: 1, durationMs: 4000 }); advance(1);
  assert.ok(Math.abs(runtime.params.ParamMouthForm) < .01 && runtime.params.key7 < .01);
  behavior.setTuning({ expressionIntensity: 0 });
  behavior.perform({ emotion: 'love', intensity: 1, durationMs: 4000 }); advance(1.5);
  assert.ok(runtime.params.key4 < .001 && runtime.params.key7 < .001);
});

test('a complete settings snapshot removes one face override without retaining it until restart', () => {
  const saved = sanitizeModelTuning({ expressionOverrides: { happy: { smile: -.4 }, shy: { blush: -.3 } } });
  const { behavior, runtime, advance } = fixture({ tuning: saved });
  behavior.perform({ emotion: 'happy', intensity: 1, durationMs: 20000 }); advance(1.2);
  const action = behavior.action, customizedSmile = runtime.params.ParamMouthForm;
  assert.ok(customizedSmile < .25, 'the happy adjustment is active before its reset');
  behavior.setTuning({ expressionOverrides: { happy: { eyeOpen: -.1 } } });
  assert.equal(behavior.tuning.expressionOverrides.happy.smile, -.4, 'ordinary partial edits keep sibling values');
  assert.equal(behavior.tuning.expressionOverrides.shy.blush, -.3);

  // The main process deletes happy, saves JSON, then broadcasts a full snapshot
  // containing shy. It does not send a null tombstone to every receiving window.
  const snapshot = JSON.parse(JSON.stringify(sanitizeModelTuning({ expressionOverrides: { happy: null } }, behavior.tuning)));
  behavior.setTuning(snapshot, { replace: true }); advance(1.2);
  assert.equal(Object.hasOwn(behavior.tuning.expressionOverrides, 'happy'), false);
  assert.equal(behavior.tuning.expressionOverrides.shy.blush, -.3);
  assert.equal(behavior.action, action, 'resetting a face adjustment must not restart its performance');
  assert.ok(runtime.params.ParamMouthForm > .59, 'the live face returns to the authored happy smile');

  const restarted = fixture({ tuning: snapshot });
  restarted.behavior.perform({ emotion: 'happy', intensity: 1, durationMs: 20000 }); restarted.advance(2.4);
  assert.ok(Math.abs(runtime.params.ParamMouthForm - restarted.runtime.params.ParamMouthForm) < .001,
    'live reset and loading the persisted snapshot must display the same face');
});

test('speech cues replace idea/cuddle faces, retain their arms and yield to actual touch', () => {
  for (const intent of ['idea', 'cuddle']) {
    const { behavior, runtime, calls, advance } = fixture();
    behavior.perform({ intent, emotion: 'happy', intensity: .7, durationMs: 20000 });
    behavior.setState('speaking'); behavior.setAudioLevel(.7); advance(1);
    const action = behavior.action, motionCount = calls.filter(call => call[0] === 'motion').length;
    const selector = intent === 'idea' ? 'Movement3' : 'Movement2';
    assert.equal(runtime.overlay.values[selector], 1, `${intent} starts its authored hand pose`);

    behavior.setExpressionCue('sad', 1); advance(1.1);
    assert.ok(runtime.params.ParamMouthForm < -.58 && runtime.params.ParamBrowLY < -.32,
      `${intent} must let the spoken sad face replace its fixed cheerful smile and eyebrows`);
    assert.ok(runtime.params.ParamEyeLOpen > .6 && runtime.params.ParamEyeLOpen < .75,
      `${intent} must not force surprised or closed eyes over the cue`);
    assert.equal(runtime.overlay.values[selector], 1);
    assert.ok(runtime.overlay.weight > .99);
    if (intent === 'cuddle') assert.equal(runtime.cuddleActive, true);
    assert.equal(behavior.action, action);
    assert.equal(calls.filter(call => call[0] === 'motion').length, motionCount, 'face changes do not restart hands');
    assert.ok(runtime.params.ParamMouthOpenY > .5, 'actual speech keeps ownership of mouth opening');

    behavior.setExpressionCue('sad', 0); advance(1.1);
    assert.ok(Math.abs(runtime.params.ParamMouthForm) < .01 && Math.abs(runtime.params.ParamBrowLY) < .01,
      'a zero-strength cue settles to a neutral face rather than restoring the scripted smile');
    assert.equal(runtime.overlay.values[selector], 1);

    behavior.setExpressionCue('sad', 1); behavior.setPetting(true, { intensity: 1 }); advance(.8);
    assert.equal(runtime.params.ParamEyeLOpen, 0, 'real touch still closes the eyes');
    assert.ok(runtime.params.ParamMouthForm > .6, 'real touch still gives the enjoyed-petting smile');
    assert.ok(runtime.params.ParamMouthOpenY > .5, 'touch also leaves spoken mouth opening intact');
    behavior.setPetting(false); advance(1.1);
    assert.ok(runtime.params.ParamMouthForm < -.57, 'release restores the current spoken cue');
  }
});

test('chest taps ignore every busy click and never queue or skip a stage', () => {
  const { behavior, events, calls, advance } = fixture();
  assert.equal(behavior.tapChest(), true);
  for (let i = 0; i < 47; i++) {
    advance(.1);
    assert.equal(behavior.tapChest(), false);
    assert.equal(behavior.previewChestReaction(3), false);
  }
  assert.equal(behavior.isChestReaction, true);
  advance(.2);
  assert.equal(behavior.isChestReaction, false);
  assert.deepEqual(events.filter(e => e.type === 'chest-reaction-start').map(e => e.id), ['1']);
  assert.equal(behavior.tapChest(), true);
  assert.equal(events.at(-1).id, '2');
  advance(5);
  assert.equal(events.filter(e => e.type === 'chest-reaction-start').length, 2);
  assert.equal(calls.filter(c => c[0] === 'motion').length, 0, 'a chest reaction never opens or restarts an arm');
});

test('chest reactions progress from surprise through shyness to averted and firm boundaries', () => {
  const { behavior, runtime, events, advance } = fixture();
  behavior.tapChest(); advance(.35);
  assert.ok(runtime.params.ParamMouthOpenY > .15 && runtime.params.ParamBrowLY > .3);
  advance(1.1);
  assert.ok(runtime.params.key13 > .7, 'the first round has a visible flustered/sweat phase');
  advance(1.9);
  assert.ok(runtime.params.key7 > .6 && runtime.params.AngleY < -3, 'the shy blush approaches .86 × the default .75 blush tuning');
  advance(1.6);
  assert.equal(behavior.tapChest(), true);
  behavior.setPointerTracking(true, { x: -1, y: 0, speed: 1, travel: 1 });
  advance(2.1);
  assert.ok(runtime.params.AngleX > 20 && runtime.params.ParamEyeBallX > .4, 'turn-away owns head and gaze over opposite mouse input');
  assert.ok(runtime.params.key7 > .55 && runtime.params.ParamBrowLY < -.3, 'the offended blush approaches .78 × the default .75 tuning');
  behavior.setPointerTracking(false); advance(2.6);
  assert.equal(behavior.tapChest(), true);
  advance(.6); const firstSide = runtime.params.AngleX;
  advance(.65);
  assert.ok(runtime.params.AngleX > firstSide + 3, 'the third round gives a small disapproving head shake');
  assert.ok(runtime.params.ParamBrowLY < -.6 && runtime.params.ParamMouthForm < -.4);
  assert.ok(runtime.params.CheeckPuff < .12, 'anger stays restrained rather than exaggerated cheek inflation');
  advance(3.4); assert.equal(behavior.tapChest(), false);
  assert.equal(behavior.isChestAwaitingPetting, true);
  assert.deepEqual(events.filter(e => e.type === 'chest-reaction-start').map(e => e.id), ['1', '2', '3']);
});

test('chest cooldown uses accepted taps and previews never change real progression', () => {
  const { behavior, events, advance } = fixture();
  assert.equal(behavior.previewChestReaction(3), true); advance(4.6);
  assert.equal(behavior.tapChest(), true);
  assert.equal(events.at(-1).id, '1');
  for (let i = 0; i < 40; i++) { advance(.1); assert.equal(behavior.tapChest(), false); }
  advance(56.1);
  assert.equal(behavior.tapChest(), true);
  assert.equal(events.at(-1).id, '1', 'ignored taps do not postpone the 60-second reset');
  behavior.cancelChestReaction();
  assert.equal(behavior.previewChestReaction(0), false);
  assert.equal(behavior.previewChestReaction(5), false);
});

test('chest cooldown also expires when rendering is suspended', () => {
  let wallTime = 0;
  const { behavior, events, advance } = fixture({ clockSeconds: () => wallTime });
  behavior.tapChest(); advance(4.9);
  wallTime = 61; // No RAF updates occurred during this background interval.
  assert.equal(behavior.tapChest(), true);
  assert.equal(events.at(-1).id, '1');
});

test('chest interruption cannot complete an old round or advance a cancelled stage', () => {
  const { behavior, events, advance } = fixture();
  behavior.tapChest(); advance(4.9);
  behavior.tapChest(); advance(.5); behavior.cancelChestReaction();
  assert.equal(behavior.isChestReaction, false); advance(8);
  behavior.tapChest(); assert.equal(events.at(-1).id, '2');
  behavior.applyCommand({ type: 'stop' }); advance(8);
  assert.deepEqual(events.filter(e => e.type === 'chest-reaction-complete').map(e => e.id), ['1']);
  behavior.reset(); behavior.tapChest(); assert.equal(events.at(-1).id, '1');
  behavior.destroy(); advance(10);
  assert.equal(behavior.tapChest(), false);
  assert.equal(behavior.isChestReaction, false);
});

test('new requests, explicit performances, head touch and basin knocks preempt chest reactions', () => {
  const { behavior, advance } = fixture();
  behavior.tapChest(); behavior.setState('thinking');
  assert.equal(behavior.isChestReaction, false);
  assert.equal(behavior.tapChest(), false);
  behavior.setState('idle'); behavior.tapChest(); behavior.perform({ emotion: 'gentle' });
  assert.equal(behavior.isChestReaction, false);
  behavior.tapChest(); behavior.applyCommand({ type: 'speak' });
  assert.equal(behavior.isChestReaction, false);
  behavior.tapChest(); behavior.setPetting(true);
  assert.equal(behavior.isChestReaction, false);
  assert.equal(behavior.tapChest(), false);
  behavior.setPetting(false); advance(.7);
  behavior.setBasinEnabled(true); assert.equal(behavior.tapChest(), true);
  assert.equal(behavior.knockBasin(), true);
  assert.equal(behavior.isChestReaction, false);
  assert.equal(behavior.tapChest(), false);
  advance(.8); assert.equal(behavior.tapChest(), true);
});

test('every chest stage preserves live audio mouth ownership, including silent speech intervals', () => {
  for (const stage of [1, 2, 3, 4]) {
    const active = fixture(), control = fixture();
    for (const item of [active, control]) { item.behavior.setState('speaking'); item.behavior.setAudioLevel(.75); }
    assert.equal(active.behavior.previewChestReaction(stage), true);
    for (let i = 0; i < 90; i++) {
      active.behavior.update(1 / 60); control.behavior.update(1 / 60);
      assert.equal(active.runtime.params.ParamMouthOpenY, control.runtime.params.ParamMouthOpenY);
      assert.equal(active.runtime.params.JawOpen, control.runtime.params.JawOpen);
    }
    active.behavior.setAudioLevel(0); active.advance(.6);
    assert.equal(active.behavior.state, 'speaking');
    assert.ok(active.runtime.params.ParamMouthOpenY < .001 && active.runtime.params.JawOpen < .001);
    assert.equal(active.behavior.isChestReaction, true);
  }
});

test('chest inputs remain bounded, ease out continuously, and honor body-motion tuning', () => {
  for (const stage of [1, 2, 3, 4]) {
    const { behavior, runtime } = fixture({ tuning: { bodyMotion: 0 } });
    behavior.previewChestReaction(stage);
    let previous = { ...runtime.params };
    for (let frame = 0; frame < (CHEST_REACTION_DURATIONS[stage - 1] + 1) * 60; frame++) {
      behavior.update(1 / 60);
      for (const p of mocParameterRanges) assert.ok(runtime.params[p.id] >= p.min && runtime.params[p.id] <= p.max, p.id);
      for (const id of ['AngleX', 'AngleY', 'AngleZ']) assert.ok(Math.abs(runtime.params[id] - previous[id]) < 3, `${id} must not jump when a phase ends`);
      for (const id of ['PositionX', 'PositionY', 'PositionZ', 'LeanInput']) assert.equal(runtime.params[id], 0);
      previous = { ...runtime.params };
    }
    assert.equal(behavior.isChestReaction, false);
    assert.ok(Math.abs(runtime.params.AngleX) < 1 && Math.abs(runtime.params.AngleY) < 1);
    assert.ok(runtime.params.key7 < .01 && runtime.params.key13 < .01 && runtime.params.key4 < .01);
    for (const id of ['Emotion', 'LipPhysics1', 'ChestX1', 'ChestY1']) assert.equal(id in runtime.params, false);
  }
});

test('three completed chest rounds require fresh comfort before one heart round resets the sequence', () => {
  const item = fixture(), { behavior, events, runtime, calls, advance } = item;
  finishChestBoundaryRounds(item);
  for (let i = 0; i < 10; i++) { advance(.15); assert.equal(behavior.tapChest(), false); }
  assert.equal(behavior.isChestHeartArmed, false);
  behavior.setPetting(true, { newContact: true }); advance(.2);
  assert.equal(behavior.isChestHeartArmed, false);
  advance(.15);
  assert.equal(behavior.isChestHeartArmed, true);
  assert.equal(behavior.isChestAwaitingPetting, false);
  assert.equal(behavior.tapChest(), false, 'comfort must release before a chest tap is accepted');
  behavior.setPetting(false); advance(.8);
  assert.equal(behavior.tapChest(), true);
  assert.equal(behavior.isChestHeartArmed, false, 'one physical tap consumes the comfort');
  advance(1);
  assert.ok(runtime.params.key4 > .95 && runtime.params.key7 > .45, 'heart eyes and gentle blush are both visible');
  for (let i = 0; i < 20; i++) { assert.equal(behavior.tapChest(), false); advance(.1); }
  advance(2.2);
  assert.equal(behavior.isChestReaction, false);
  assert.equal(behavior.isChestAwaitingPetting, false);
  assert.equal(behavior.isChestHeartArmed, false);
  assert.equal(behavior.tapChest(), true);
  assert.deepEqual(events.filter(e => e.type === 'chest-reaction-start').map(e => e.id), ['1', '2', '3', '4', '1']);
  assert.equal(events.filter(e => e.type === 'chest-heart-armed').length, 1);
  assert.equal(calls.filter(c => c[0] === 'motion').length, 0, 'short comfort and chest reactions do not restart arms');
});

test('old petting, release fades, short contact and an unfinished third round cannot arm the heart', () => {
  const item = fixture(), { behavior, advance } = item;
  behavior.setPetting(true); advance(.85); behavior.setPetting(false); advance(.8);
  behavior.tapChest(); advance(4.9); behavior.tapChest(); advance(4.5);
  behavior.tapChest(); advance(4.1);
  behavior.setPetting(true, { newContact: true }); advance(.4);
  assert.equal(behavior.isChestReaction, false, 'touch interrupts the unfinished third round');
  assert.equal(behavior.isChestHeartArmed, false);
  behavior.setPetting(false); advance(.8);
  assert.equal(behavior.tapChest(), true); advance(4.5);
  assert.equal(behavior.isChestAwaitingPetting, true);
  advance(1);
  assert.equal(behavior.tapChest(), false, 'neither an old contact nor its release can unlock stage 4');
  behavior.setPetting(true, { newContact: true }); advance(.2);
  behavior.setPetting(false); advance(.8);
  assert.equal(behavior.isChestHeartArmed, false);
  assert.equal(behavior.tapChest(), false);
  for (let i = 0; i < 4; i++) { behavior.setPetting(true, { newContact: true }); advance(.15); }
  assert.equal(behavior.isChestHeartArmed, false, 'separate brief contacts do not accumulate');
  advance(.2);
  assert.equal(behavior.isChestHeartArmed, true);
});

test('heart preview never advances, consumes or clears real chest comfort', () => {
  const item = fixture(), { behavior, events, advance } = item;
  assert.equal(behavior.previewChestReaction(4), true); advance(5.1);
  assert.equal(behavior.isChestHeartArmed, false);
  assert.equal(behavior.tapChest(), true); assert.equal(events.at(-1).id, '1');
  behavior.reset(); finishChestBoundaryRounds(item); comfortChest(item);
  assert.equal(behavior.previewChestReaction(4), true); advance(1); behavior.cancelChestReaction();
  assert.equal(behavior.isChestHeartArmed, true, 'cancelling a preview leaves real comfort intact');
  assert.equal(behavior.previewChestReaction(4), true); advance(5.1);
  assert.equal(behavior.isChestHeartArmed, true, 'finishing a preview leaves real comfort intact');
  assert.equal(behavior.tapChest(), true); assert.equal(events.at(-1).id, '4');
});

test('waiting taps and heart previews do not postpone the wall-clock chest reset', () => {
  let wallTime = 0;
  const item = fixture({ clockSeconds: () => wallTime }), { behavior, events, advance } = item;
  finishChestBoundaryRounds(item);
  for (wallTime = 10; wallTime < 60; wallTime += 10) assert.equal(behavior.tapChest(), false);
  wallTime = 55;
  comfortChest(item);
  behavior.previewChestReaction(4); advance(5.1);
  wallTime = 61; // No rendering frames are needed to expire a real sequence.
  assert.equal(behavior.tapChest(), true);
  assert.equal(events.at(-1).id, '1');
  assert.equal(behavior.isChestHeartArmed, false);
  assert.equal(behavior.isChestAwaitingPetting, false);
});

test('cancelled heart reactions shed their face and breathing without completing or rearming', () => {
  const cancellations = [
    b => b.cancelChestReaction(),
    b => b.applyCommand({ type: 'stop' }),
    b => b.reset(),
    b => b.setState('thinking'),
    b => b.perform({ intent: 'greet', emotion: 'happy', durationMs: 1000 }),
    b => b.applyCommand({ type: 'speak' }),
  ];
  for (const cancel of cancellations) {
    const item = fixture(), { behavior, runtime, events, advance } = item;
    finishChestBoundaryRounds(item); comfortChest(item);
    behavior.tapChest(); advance(1); assert.ok(runtime.params.key4 > .95);
    cancel(behavior); advance(1.6);
    assert.equal(behavior.isChestReaction, false);
    assert.equal(behavior.isChestHeartArmed, false);
    assert.ok(runtime.params.key4 < .01, 'heart eyes must be released on cancellation');
    assert.equal(events.some(e => e.type === 'chest-reaction-complete' && e.id === '4'), false);
    const control = fixture(); control.behavior.time = behavior.time;
    for (let i = 0; i < 100; i++) { behavior.update(1 / 60); control.behavior.update(1 / 60); }
    assert.ok(Math.abs(runtime.params.ParamBreath - control.runtime.params.ParamBreath) < .001, 'normal breathing resumes');
  }
});

test('new requests invalidate waiting comfort and continuing an old touch cannot restore it', () => {
  const item = fixture(), { behavior, advance } = item;
  finishChestBoundaryRounds(item);
  behavior.setPetting(true, { newContact: true }); advance(.35);
  assert.equal(behavior.isChestHeartArmed, true);
  behavior.perform({ intent: 'greet' });
  for (let i = 0; i < 60; i++) { behavior.setPetting(true, { x: .1 }); advance(1 / 60); }
  assert.equal(behavior.isChestHeartArmed, false);
  behavior.setPetting(false); advance(.8); assert.equal(behavior.tapChest(), false);
  comfortChest(item); assert.equal(behavior.tapChest(), true);
});

test('heart breathing is faster but bounded, continuous and scaled by body-motion tuning', () => {
  for (const bodyMotion of [0, 1, 1.6]) {
    const active = fixture({ tuning: { bodyMotion } }), control = fixture({ tuning: { bodyMotion } });
    active.behavior.previewChestReaction(4);
    const samples = [], baseline = [];
    let previous = null;
    for (let i = 0; i < 390; i++) {
      active.behavior.update(1 / 60); control.behavior.update(1 / 60);
      const p = active.runtime.params;
      assert.ok(p.ParamBreath >= .02 && p.ParamBreath <= .98);
      assert.ok(Math.abs(p.PositionY) <= 6 && Math.abs(p.LeanInput) <= 6);
      if (previous) for (const id of ['PositionY', 'LeanInput', 'ParamBreath']) assert.ok(Math.abs(p[id] - previous[id]) < .4, `${id} has no frame discontinuity`);
      if (bodyMotion === 0) {
        assert.equal(p.ParamBreath, control.runtime.params.ParamBreath, 'zero body motion disables enhanced breathing');
        assert.equal(p.PositionY, 0); assert.equal(p.LeanInput, 0);
      }
      if (i >= 30 && i < 250) { samples.push({ ...p }); baseline.push(control.runtime.params.ParamBreath); }
      previous = { ...p };
    }
    if (bodyMotion > 0) {
      const crossings = data => data.slice(1).filter((value, i) => (value - .5) * (data[i] - .5) < 0).length;
      assert.ok(crossings(samples.map(p => p.ParamBreath)) > crossings(baseline), 'heart breathing completes more cycles');
      const y = samples.map(p => p.PositionY);
      assert.ok(Math.max(...y) - Math.min(...y) > 3 * bodyMotion, 'the bounded body rise and fall is visible');
    }
    assert.equal(active.behavior.isChestReaction, false);
    assert.ok(active.runtime.params.key4 < .01);
    for (const id of ['Emotion', 'ChestX1', 'ChestY1', 'ChestX2', 'ChestY2']) assert.equal(id in active.runtime.params, false);
  }
});

test('heart sampler has an exact five-second boundary and rejects invalid stages', () => {
  assert.equal(sampleChestReaction(4, 0).phase, 'heart');
  assert.equal(sampleChestReaction(4, 2).left.emotion, 'love');
  assert.ok(sampleChestReaction(4, 4.9).weight < .1);
  assert.equal(sampleChestReaction(4, 5), null);
  for (const stage of [0, 5, 1.5, NaN, Infinity]) assert.equal(sampleChestReaction(stage, 1), null);
});

test('all body previews leave every facial recipe and speech mouth independent', () => {
  assert.equal(BODY_ANIMATION_PRESETS.length, 14);
  for (const preset of BODY_ANIMATION_PRESETS) {
    const active = fixture(), control = fixture();
    for (const f of [active, control]) {
      f.behavior.setState('speaking'); f.behavior.setExpressionCue('happy', .8); f.behavior.setAudioLevel(.4);
      f.advance(.5);
    }
    assert.equal(active.behavior.previewBodyAnimation(preset.id), true);
    const faceIds = ['ParamMouthForm', 'ParamMouthOpenY', 'JawOpen', 'key7', 'ParamBrowLY', 'ParamBrowRY', 'ParamEyeLOpen', 'EyeSmile'];
    let previous, moved = false;
    for (let frame = 0; frame < Math.ceil(preset.durationMs / 1000 * 60) + 120; frame++) {
      active.behavior.update(1 / 60); control.behavior.update(1 / 60);
      for (const id of faceIds) assert.ok(Math.abs(active.runtime.params[id] - control.runtime.params[id]) < 1e-9, `${preset.id} cannot control ${id}`);
      const overlay = active.runtime.overlay?.values ?? {};
      if (previous && Object.keys(overlay).some(id => !id.startsWith('Movement') && Math.abs(overlay[id] - (previous[id] ?? 0)) > .00005)) moved = true;
      previous = { ...overlay };
    }
    assert.equal(active.behavior.bodyPreview, null);
    assert.equal(active.behavior.gesture, 'none');
    assert.equal(active.behavior.state, 'speaking');
    if (preset.id !== 'listen') assert.ok(moved, `${preset.id} has a continuous hand adjustment`);
    assert.equal(active.calls.some(c => c[0] === 'expression' && c[1] === '加载' && c[2]), false, 'thinking preview owns no loading expression');
  }
});

test('face preview overlays latest speech face without cancelling a body or restarting its hand', () => {
  const { behavior, runtime, calls, advance } = fixture();
  behavior.setExpressionCue('cold', .8);
  behavior.previewBodyAnimation('reassure', { durationMs: 10000 }); advance(1.5);
  const body = behavior.bodyPreview, gesture = behavior.gesture;
  const motionCount = calls.filter(c => c[0] === 'motion' || c[0] === 'stopMotion').length;
  behavior.applyCommand({ type: 'expression', emotion: 'happy', intensity: 1, durationMs: 1500 }); advance(.5);
  assert.ok(runtime.params.ParamMouthForm > .2);
  behavior.setExpressionCue('puzzled', 1);
  assert.equal(behavior.bodyPreview, body); assert.equal(behavior.gesture, gesture);
  assert.equal(calls.filter(c => c[0] === 'motion' || c[0] === 'stopMotion').length, motionCount);
  advance(2);
  assert.equal(behavior.expressionPreview, null);
  assert.equal(behavior.expressionCue.emotion, 'puzzled');
  assert.ok(runtime.params.ParamBrowRY < 0);
  behavior.applyCommand({ type: 'body', active: false });
  assert.equal(behavior.bodyPreview, null); assert.equal(behavior.expressionCue.emotion, 'puzzled');
});

test('speech progress changes hand emphasis without replaying the authored entrance', () => {
  const { behavior, runtime, calls, advance } = fixture();
  behavior.perform({ intent: 'idea', gesture: 'pointer', durationMs: 2000, replyIntro: true }); advance(1.8);
  const openings = () => calls.filter(c => c[0] === 'motion' && c[1] === '竖手指切出来动画').length;
  for (let frame = 0; frame < 120; frame++) {
    behavior.setSpeechGesture({ id: 'explain', key: 'a:0', intensity: .8, durationMs: 5000, progress: .2 + frame / 300 });
    behavior.update(1 / 60);
  }
  assert.equal(behavior.action, null, 'reply consumes the preceding idea flourish');
  assert.equal(openings(), 1);
  const pose = runtime.overlay.values.Param41;
  behavior.setSpeechGesture({ id: 'happy', key: 'b:0', intensity: .8, durationMs: 5000, progress: .28 }); advance(.3);
  assert.equal(openings(), 1, 'a new segment can keep the same hand raised');
  assert.ok(Math.abs(runtime.overlay.values.Param41 - pose) > .001);
  behavior.clearSpeechGesture(); advance(2);
  assert.equal(behavior.gesture, 'none');
  assert.ok(calls.some(c => c[0] === 'motion' && c[1] === '竖手指切回默认'));
});

test('explicit speech gesture none never leaks a pose selector or opens a hand', () => {
  const { behavior, runtime, calls, advance } = fixture();
  behavior.setSpeechGesture({ id: 'explain', key: 'none', gesture: 'none', progress: .4, durationMs: 4000 });
  advance(1);
  assert.equal(behavior.gesture, 'none');
  assert.equal(calls.some(c => c[0] === 'motion'), false);
  assert.equal(runtime.overlay.weight, 0);
  assert.ok(runtime.params.LeanInput < -.5, 'the head and body can still express the cue');
});

test('touch consumes an active speech cue and repeated progress cannot take ownership back', () => {
  const { behavior, calls, advance } = fixture();
  const cue = { id: 'explain', key: 'old', gesture: 'pointer', durationMs: 10000, progress: .3 };
  behavior.setSpeechGesture(cue); advance(1.5);
  behavior.setPetting(true, { newContact: true });
  for (let i = 0; i < 150; i++) { behavior.setSpeechGesture(cue); behavior.update(1 / 60); }
  assert.equal(behavior.gesture, 'chest', 'sustained touch owns the cuddle');
  behavior.setPetting(false); advance(2);
  const openings = calls.filter(c => c[0] === 'motion' && c[1] === '竖手指切出来动画').length;
  behavior.setSpeechGesture(cue); advance(1);
  assert.equal(behavior.gesture, 'none', 'an old cue is not replayed after touch');
  assert.equal(calls.filter(c => c[0] === 'motion' && c[1] === '竖手指切出来动画').length, openings);
  behavior.setSpeechGesture({ ...cue, key: 'new' }); advance(.1);
  assert.equal(behavior.gesture, 'pointer', 'a genuinely new cue can resume naturally');
});

test('body preview wins over ongoing speech progress, stop and reset clear each lane safely', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.previewBodyAnimation('reassure');
  for (let i = 0; i < 120; i++) { behavior.setSpeechGesture({ id: 'explain', key: 'a', progress: .4 }); behavior.update(1 / 60); }
  assert.equal(behavior.gesture, 'chest');
  behavior.previewExpression('love');
  behavior.interrupt('idle'); advance(2);
  for (const key of ['bodyPreview', 'speechGesture', 'expressionPreview']) assert.equal(behavior[key], null);
  assert.equal(behavior.gesture, 'none'); assert.ok(runtime.overlay.weight < .001);
  behavior.previewBodyAnimation('think'); behavior.previewExpression('happy'); behavior.reset();
  for (const key of ['bodyPreview', 'speechGesture', 'expressionPreview']) assert.equal(behavior[key], null);
});

test('body preview supersedes an older scripted cuddle body while retaining its face', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.perform({ intent: 'cuddle', emotion: 'happy', durationMs: 15000 }); advance(2);
  assert.equal(behavior.gesture, 'chest');
  const oldAction = behavior.action;
  behavior.previewBodyAnimation('explain', { durationMs: 7000 }); advance(1.8);
  assert.equal(behavior.action, oldAction, 'the existing facial expression is independent');
  assert.equal(behavior.gesture, 'pointer');
  assert.equal(runtime.cuddleActive, false);
  assert.equal(runtime.overlay.values.Movement3, 1);
  assert.equal(runtime.overlay.values.Movement2, 0);
});

test('eyes lead the head and torso; authored body outputs are never directly overwritten', () => {
  const { behavior, runtime, advance } = fixture({ tuning: { idleActivity: 0 } });
  advance(.5);
  behavior.perform({ gaze: 'right', durationMs: 5000 }); advance(.2);
  const eye = runtime.params.ParamEyeBallX / .48, head = runtime.params.AngleX / 8, body = runtime.params.PositionX / 3.2;
  assert.ok(eye > head && head > body, `progress eye=${eye}, head=${head}, body=${body}`);
  for (const id of ['ParamAngleX', 'RArm', 'LArm', 'RForearm', 'LForearm', 'ChestX1', 'ChestY1']) assert.equal(id in runtime.params, false);
});

test('deliberate body motion has rest sections and bounded, selector-free emphasis offsets', () => {
  for (const preset of BODY_ANIMATION_PRESETS) {
    let last;
    for (let i = 0; i <= 300; i++) {
      const sample = sampleBodyAnimation(preset.id, i / 300, 1);
      for (const [id, value] of Object.entries(sample.armOffsets)) {
        assert.ok(!id.startsWith('Movement')); assert.ok(Math.abs(value) <= .066);
        if (last?.armOffsets[id] !== undefined) assert.ok(Math.abs(value - last.armOffsets[id]) < .01);
      }
      last = sample;
    }
  }
  assert.deepEqual(sampleBodyAnimation('think', .28), sampleBodyAnimation('think', .38), 'thought pose rests instead of oscillating forever');
  assert.equal(sampleBodyAnimation('missing', .5), null);
});

test('new body controls alter continuous motion while retaining valid hand selection', () => {
  const quiet = fixture({ tuning: { gestureAmplitude: 0, bodyFollow: 0, idleActivity: 0 } });
  const expressive = fixture({ tuning: { gestureAmplitude: 1.5, bodyFollow: 1.5, idleActivity: 0 } });
  for (const f of [quiet, expressive]) {
    f.behavior.setSpeechGesture({ id: 'explain', key: 'amplitude', intensity: 1, progress: .38, durationMs: 5000 }); f.advance(1.5);
  }
  assert.ok(expressive.runtime.overlay.values.Param41 > quiet.runtime.overlay.values.Param41 + .05);
  for (const id of ['Movement1', 'Movement2', 'Movement3', 'Param40']) assert.equal(expressive.runtime.overlay.values[id], quiet.runtime.overlay.values[id]);
  for (const f of [quiet, expressive]) { f.behavior.clearSpeechGesture(); f.behavior.perform({ gaze: 'right', durationMs: 4000 }); f.advance(1.5); }
  assert.equal(quiet.runtime.params.PositionX, 0);
  assert.ok(expressive.runtime.params.PositionX > 4);
});

test('explicit performances end face previews and own the body over automatic speech progress', () => {
  const { behavior, runtime, advance } = fixture();
  behavior.setExpressionCue('cold', .7);
  behavior.previewExpression('love', { durationMs: 20000 }); advance(.6);
  assert.ok(runtime.params.key4 > .8);
  behavior.perform({ intent: 'reassure', emotion: 'gentle', gesture: 'chest', durationMs: 4000 });
  const manual = behavior.action;
  for (let i = 0; i < 120; i++) {
    behavior.setSpeechGesture({ id: 'explain', key: 'chat:1', progress: .4, durationMs: 6000 });
    behavior.update(1 / 60);
  }
  assert.equal(behavior.expressionPreview, null);
  assert.ok(runtime.params.key4 < .01);
  assert.equal(behavior.action, manual);
  assert.equal(behavior.gesture, 'chest');
  assert.equal(behavior.bodySample, null, 'automatic head/body motion cannot cover a manual performance');
  advance(3.5);
  assert.equal(behavior.action, null);
  assert.equal(behavior.gesture, 'pointer', 'only the latest still-active cue resumes after the manual action');
});

test('automatic speech never consumes a manually requested idea action', () => {
  const { behavior, advance } = fixture();
  behavior.perform({ intent: 'idea', emotion: 'happy', gesture: 'pointer', durationMs: 4000 }); advance(.2);
  const manualIdea = behavior.action;
  behavior.setSpeechGesture({ id: 'reassure', key: 'chat:manual', progress: .4, durationMs: 5000 }); advance(.8);
  assert.equal(behavior.action, manualIdea);
  assert.equal(behavior.gesture, 'pointer');
  assert.equal(behavior.bodySample, null);
});

test('screen-side arm changes close the old whole arm before opening the other side', () => {
  for (const kind of ['chest','pointer']) {
    const {behavior,runtime,advance,calls}=fixture();
    behavior.previewBodyAnimation(`${kind}-left`,{durationMs:12000});advance(2);
    assert.deepEqual(runtime.gestureHands,{kind,side:'left',active:true});
    const openings=calls.filter(row=>row[0]==='motion').length;
    behavior.previewBodyAnimation(`${kind}-right`,{durationMs:12000});advance(.1);
    assert.equal(behavior.gesture,'none','the first arm must lower before crossing to another screen side');
    assert.deepEqual(runtime.gestureHands,{kind,side:'left',active:false});
    assert.equal(calls.filter(row=>row[0]==='motion').length,openings+1,'only the old closing motion is started');
    advance(1.5);
    assert.equal(behavior.gesture,kind);
    assert.deepEqual(runtime.gestureHands,{kind,side:'right',active:true});
    behavior.previewBodyAnimation(`${kind}-both`,{durationMs:12000});advance(1.6);
    assert.deepEqual(runtime.gestureHands,{kind,side:'both',active:true});
    behavior.clearBodyAnimation();advance(.05);assert.equal(runtime.gestureHands.active,false);
    advance(2);assert.equal(behavior.gesture,'none');
  }
});

test('continuous explanation remains animated past four seconds and holds across a sentence boundary', () => {
  const {behavior,runtime,calls,advance}=fixture();
  const cue={id:'talk',key:'long-talk',durationMs:90000,continuous:true,intensity:1,hold:true};
  const values=[];
  for(let frame=0;frame<300;frame++){
    const elapsed=7+frame/60;
    behavior.setSpeechGesture({...cue,progress:elapsed/90,elapsedSeconds:elapsed});
    behavior.update(1/60);values.push(runtime.overlay?.values.Param41??0);
  }
  assert.equal(behavior.speechGesture.duration,90,'actual long speech time is not clamped to 30 seconds');
  assert.ok(Math.max(...values)-Math.min(...values)>.025,'the hand continues emphasis after the old four-second cutoff');
  const opens=calls.filter(row=>row[0]==='motion').length;
  behavior.setSpeechGesture({...cue,progress:1,elapsedSeconds:90});advance(.2);
  assert.equal(behavior.gesture,'pointer','hold does not close the arm at p=1');
  behavior.setSpeechGesture({...cue,key:'next-talk',continuing:true,progress:0,elapsedSeconds:0,durationMs:6000});advance(.2);
  assert.equal(behavior.gesture,'pointer');
  assert.equal(calls.filter(row=>row[0]==='motion').length,opens);
  assert.ok(runtime.overlay.weight>.95,'the continuation does not fade a raised hand back to zero');
  behavior.clearSpeechGesture();advance(2);assert.equal(behavior.gesture,'none');
});

test('continuous hand cadence pauses with the audio clock and does not bend unsupported finger controls', () => {
  const {behavior,runtime,advance}=fixture();
  const cue={id:'talk',key:'pause',durationMs:12000,progress:.5,elapsedSeconds:6,continuous:true,intensity:1};
  behavior.setSpeechGesture(cue);advance(4);
  const pose={...runtime.overlay.values};advance(3);
  for(const id of ['Param36','Param39','Param41','Param42'])assert.ok(Math.abs(runtime.overlay.values[id]-pose[id])<.0001);
  assert.equal(runtime.overlay.values.Param43,0,'finger softness comes from wrist motion, not uncalibrated hand deformation');
  for(const id of ['talk','compare']){
    const rest=sampleBodyAnimation(id,.5,1,{durationSeconds:12,elapsedSeconds:3.15,hold:true});
    assert.equal(rest.armOffsets.Param41,0,'cadence includes a quiet interval');
  }
});

test('continuous sentence boundaries preserve cadence without adding elapsed time twice', () => {
  for (const id of ['talk', 'compare']) {
    const { behavior, advance } = fixture();
    const cue = { id, gesture: 'pointer', intensity: 1, continuous: true, hold: true };
    behavior.setSpeechGesture({ ...cue, key: 'first', durationMs: 12000, progress: 1, elapsedSeconds: 12 }); advance(.1);
    const boundary = { ...behavior.bodySample };
    behavior.setSpeechGesture({ ...cue, key: 'second', durationMs: 8000, progress: 0, elapsedSeconds: 0, continuing: true }); advance(.1);
    assert.equal(behavior.speechGesture.cadenceOffset, 12);
    assert.deepEqual(behavior.bodySample, boundary, `${id} must not jump at the new sentence's zero audio offset`);
    const progress = { ...cue, key: 'second', durationMs: 8000, progress: .75, elapsedSeconds: 6, continuing: true };
    for (let frame = 0; frame < 120; frame++) { behavior.setSpeechGesture(progress); behavior.update(1 / 60); }
    assert.equal(behavior.speechGesture.cadenceOffset, 12, 'repeated frames must retain one inherited offset');
    assert.deepEqual(behavior.bodySample, {
      ...sampleBodyAnimation(id, .75, 1, { durationSeconds: 8, elapsedSeconds: 18, hold: true, continuing: true }), weight: 1,
    });
    behavior.setSpeechGesture({ ...progress, progress: 1, elapsedSeconds: 8 }); advance(.1);
    const nextBoundary = { ...behavior.bodySample };
    behavior.setSpeechGesture({ ...cue, key: 'third', durationMs: 9000, progress: 0, elapsedSeconds: 0, continuing: true }); advance(.1);
    assert.equal(behavior.speechGesture.cadenceOffset, 20, 'continuity accumulates over more than two sentences');
    assert.deepEqual(behavior.bodySample, nextBoundary);
    behavior.clearSpeechGesture();
    behavior.setSpeechGesture({ ...cue, key: 'after-stop', durationMs: 9000, progress: 0, elapsedSeconds: 0, continuing: true });
    assert.equal(behavior.speechGesture.cadenceOffset, 0, 'a stopped reply cannot donate its cadence to a later reply');
  }
});

test('cadence inheritance requires a matching held continuous gesture', () => {
  for (const change of [{ id: 'compare' }, { gesture: 'none' }, { continuous: false }, { continuing: false }]) {
    const { behavior } = fixture();
    const cue = { id: 'talk', gesture: 'pointer', intensity: 1, continuous: true, hold: true, durationMs: 12000 };
    behavior.setSpeechGesture({ ...cue, key: 'first', progress: 1, elapsedSeconds: 12 });
    behavior.setSpeechGesture({ ...cue, key: 'second', progress: 0, elapsedSeconds: 0, continuing: true, ...change });
    assert.equal(behavior.speechGesture.cadenceOffset, 0, JSON.stringify(change));
  }
  const { behavior } = fixture();
  const cue = { id: 'talk', gesture: 'pointer', continuous: true, durationMs: 12000 };
  behavior.setSpeechGesture({ ...cue, key: 'first', progress: 1, elapsedSeconds: 12, hold: false });
  behavior.setSpeechGesture({ ...cue, key: 'second', progress: 0, elapsedSeconds: 0, continuing: true });
  assert.equal(behavior.speechGesture.cadenceOffset, 0, 'a gesture already exiting must not carry its phase');
});

test('continuous entrance and exit use sentence time rather than accumulated cadence', () => {
  for (const id of ['talk', 'compare']) {
    for (const [progress, continuing] of [[0, false], [1, true]]) {
      const sample = sampleBodyAnimation(id, progress, 1, { durationSeconds: 12, elapsedSeconds: 18, continuing });
      for (const field of ['headX', 'headY', 'bodyX', 'bodyY', 'lean', 'lift', 'turn']) assert.equal(Math.abs(sample[field]), 0, `${id} ${field} at ${progress}`);
    }
  }
});

test('shy and listening have visibly distinct head and torso performances', () => {
  const shy=fixture({tuning:{idleActivity:0}}),listen=fixture({tuning:{idleActivity:0}});
  shy.behavior.previewBodyAnimation('shy',{intensity:.8});
  listen.behavior.previewBodyAnimation('listen',{intensity:.8});
  const shyX=[],shyY=[],listenY=[],listenLean=[];
  for(let frame=0;frame<400;frame++){
    shy.behavior.update(1/60);listen.behavior.update(1/60);
    shyX.push(shy.runtime.params.AngleX);shyY.push(shy.runtime.params.AngleY);
    listenY.push(listen.runtime.params.AngleY);listenLean.push(listen.runtime.params.LeanInput);
  }
  assert.ok(Math.max(...shyX)>12&&Math.min(...shyY)<-7,'shy visibly turns away and lowers her head');
  assert.ok(Math.min(...listenLean)<-5.5,'listening leans toward the user');
  assert.ok(Math.max(...listenY)-Math.min(...listenY)>6,'listening includes a visible nod after the hold');
});
