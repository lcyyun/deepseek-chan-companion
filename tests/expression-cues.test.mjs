import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExpressionCues } from '../src/shared/expression-cues.mjs';
import { EXPRESSION_IDS } from '../src/shared/expressions.mjs';
import { CAPABILITIES, RESPONSE_SCHEMA, normalizeReply, normalizeCommand, makeMessages } from '../server/protocol.mjs';

test('old providers get a baseline face and invalid or fast cue storms are bounded', () => {
  assert.deepEqual(normalizeExpressionCues(undefined, 'gentle'), [{ at: 0, emotion: 'gentle', intensity: .7 }]);
  const input = [{ at: .8, emotion: 'relieved', intensity: 2 }, { at: 0, emotion: 'puzzled', intensity: .65 },
    { at: .05, emotion: 'cold' }, { at: .3, emotion: 'happy', intensity: .8 }, { at: .31, emotion: 'angry' },
    { at: .5, emotion: 'happy', intensity: .8 }, { at: 1, emotion: 'panic' }, { at: NaN, emotion: 'neutral' }, { at: .6, emotion: 'fake' }];
  assert.deepEqual(normalizeExpressionCues(input), [{ at: 0, emotion: 'puzzled', intensity: .65 }, { at: .3, emotion: 'happy', intensity: .8 }, { at: .8, emotion: 'relieved', intensity: 1 }]);
  const many = normalizeExpressionCues(Array.from({ length: 1000 }, (_, i) => ({ at: i / 5, emotion: EXPRESSION_IDS[i % EXPRESSION_IDS.length] })));
  assert.ok(many.length <= 4);
});

test('all preview expressions are available to replies and agent speech without changing text budgets', () => {
  assert.deepEqual(CAPABILITIES.emotions, [...EXPRESSION_IDS]);
  assert.deepEqual(RESPONSE_SCHEMA.properties.segments.items.properties.expressionCues.items.properties.emotion.enum, [...EXPRESSION_IDS]);
  const reply = normalizeReply({ segments: [{ text: '咦，原来是这样！', intent: 'explain', emotion: 'puzzled', gesture: 'none', expressionCues: [{ at: 0, emotion: 'puzzled', intensity: .6 }, { at: .55, emotion: 'relieved', intensity: .8 }] }] });
  assert.equal(reply.segments[0].text, '咦，原来是这样！');
  assert.equal(reply.segments[0].expressionCues[1].emotion, 'relieved');
  for (const emotion of EXPRESSION_IDS) assert.equal(normalizeCommand({ type: 'perform', emotion }).emotion, emotion);
  const speak = normalizeCommand({ type: 'speak', text: '喜欢！', emotion: 'love', expressionCues: [{ at: 0, emotion: 'squeezed', intensity: .8 }] });
  assert.equal(speak.expressionCues[0].emotion, 'squeezed');
  const { messages, budget } = makeMessages({ text: '今天我有点难过', verbosity: 'brief' });
  assert.ok(messages[0].content.includes('安慰负面经历优先gentle/worried'));
  assert.ok(messages[0].content.includes('不得为了展示表情而拉长回复'));
  assert.equal(budget.spokenSoftMax, 140);
});
