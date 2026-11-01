import test from 'node:test';
import assert from 'node:assert/strict';
import { BEHAVIOR_PRESETS } from '../src/shared/behavior.mjs';
import { COMBINATION_IDS, COMBINATION_PRESETS, planSpeechCombination } from '../src/shared/speech-combination.mjs';

const segment = { text: '我们先把这件事的原因解释清楚。', intent: 'explain', emotion: 'gentle', bodyAnimation: 'auto' };

test('combination catalog reuses the manual presets without exposing retired bilateral pointers', () => {
  assert.deepEqual(COMBINATION_IDS, BEHAVIOR_PRESETS.map(preset => preset.id));
  assert.equal(COMBINATION_IDS.length, 12);
  assert.equal(COMBINATION_PRESETS.find(preset => preset.id === 'cuddle').gesture, 'chest');
  for (const id of ['pointer-both', 'compare']) {
    assert.equal(COMBINATION_IDS.includes(id), false);
    assert.equal(planSpeechCombination({ ...segment, combination: id }), null);
  }
  assert.ok(Object.isFrozen(COMBINATION_PRESETS));
  assert.ok(COMBINATION_PRESETS.every(Object.isFrozen));
});

test('automatic openings require a matching declared intent and compatible mood', () => {
  const selected = planSpeechCombination(segment);
  assert.equal(selected.id, 'explain');
  assert.equal(selected.command.emotion, 'gentle', 'a preset without a fixed face inherits the compatible speech mood');
  assert.equal(selected.command.gesture, 'pointer');
  for (const emotion of ['sad', 'worried', 'panic', 'angry', 'cold', 'love', 'not-real']) {
    assert.equal(planSpeechCombination({ ...segment, emotion }), null, emotion);
  }
  for (const [intent, emotion] of [['greet', 'sad'], ['agree', 'worried'], ['shy', 'proud'], ['playful', 'teary'], ['surprised', 'gentle']]) {
    assert.equal(planSpeechCombination({ ...segment, intent, emotion }), null);
  }
  for (const intent of ['neutral', 'listen', 'teleport', 'constructor']) {
    assert.equal(planSpeechCombination({ ...segment, intent }), null);
  }
  const comfort = planSpeechCombination({ ...segment, intent: 'reassure', emotion: 'worried' });
  assert.equal(comfort.id, 'reassure'); assert.equal(comfort.command.emotion, 'gentle');
});

test('quoted emotion words do not override an explicit intent and mood', () => {
  const first = planSpeechCombination({ ...segment, text: '有人说自己很生气，也有人说自己吓坏了。' });
  const second = planSpeechCombination({ ...segment, text: '这里说明几个定义。' });
  assert.deepEqual(first, second);
  assert.equal(planSpeechCombination({ text: '我想到了，好开心！', intent: 'neutral', emotion: 'neutral' }), null);
});

test('explicit body choices own automatic selection while an explicit combination can introduce them', () => {
  for (const bodyAnimation of ['none', 'talk', 'chest-right', 'pointer-left']) {
    assert.equal(planSpeechCombination({ ...segment, bodyAnimation }), null);
    const selected = planSpeechCombination({ ...segment, bodyAnimation, combination: 'reassure', emotion: 'angry' });
    assert.equal(selected.id, 'reassure', 'the explicit combination is a deliberate user/agent override');
    assert.equal(selected.command.gesture, 'chest');
  }
  assert.equal(planSpeechCombination({ ...segment, bodyAnimation: undefined }).id, 'explain');
  assert.equal(planSpeechCombination({ ...segment, combination: 'none' }), null);
});

test('thinking is explicit-only and an already played idea cannot be repeated', () => {
  assert.equal(planSpeechCombination({ ...segment, intent: 'think', emotion: 'puzzled' }), null);
  assert.equal(planSpeechCombination({ ...segment, combination: 'think' }).id, 'think');
  const idea = { ...segment, intent: 'idea', emotion: 'happy' };
  assert.equal(planSpeechCombination(idea).id, 'idea');
  assert.equal(planSpeechCombination(idea, { skipIdea: true }), null);
  assert.equal(planSpeechCombination({ ...idea, combination: 'idea' }, { skipIdea: true }), null);
  assert.equal(planSpeechCombination({ ...segment, combination: 'reassure' }, { skipIdea: true }).id, 'reassure');
});

test('frequency zero disables even explicit combinations and lower frequency is stable', () => {
  for (const combination of ['auto', 'explain', 'cuddle', 'idea']) {
    assert.equal(planSpeechCombination({ ...segment, combination }, { frequency: 0 }), null);
    assert.equal(planSpeechCombination({ ...segment, combination }, { frequency: -1 }), null);
  }
  const replies = Array.from({ length: 1000 }, (_, index) => ({ ...segment, text: `我们现在解释第${index}个问题。` }));
  const choose = frequency => replies.map(reply => planSpeechCombination(reply, { frequency }));
  const reduced = choose(.25);
  assert.deepEqual(reduced, choose(.25));
  assert.ok(reduced.filter(Boolean).length > 150 && reduced.filter(Boolean).length < 350);
  assert.equal(choose(1).filter(Boolean).length, 1000);
});

test('returned commands can be trimmed without changing presets or future openings', () => {
  for (const source of BEHAVIOR_PRESETS) {
    const selected = planSpeechCombination({ combination: source.id });
    assert.equal(selected.durationMs, source.command.durationMs);
    assert.equal(selected.command.durationMs, source.command.durationMs);
    assert.equal(selected.command.type, 'perform');
    selected.command.durationMs = 1;
    assert.equal(planSpeechCombination({ combination: source.id }).command.durationMs, source.command.durationMs);
  }
  assert.equal(planSpeechCombination(null), null);
  assert.equal(planSpeechCombination(undefined), null);
  assert.equal(planSpeechCombination({}), null);
});
