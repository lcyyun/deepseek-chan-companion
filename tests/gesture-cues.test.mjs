import test from 'node:test';
import assert from 'node:assert/strict';
import { planGestureCues, canContinueGesture, SPEECH_GESTURE_IDS } from '../src/shared/gesture-cues.mjs';

test('short replies choose at most one meaningful gesture and never infer a face', () => {
  assert.deepEqual(planGestureCues({ text: '嗯。', intent: 'agree' }), []);
  const cues = planGestureCues({ text: '这个重点我来解释一下。', intent: 'explain', gesture: 'pointer', emotion: 'angry' });
  assert.deepEqual(cues, [{ at: 0, id: 'explain', gesture: 'pointer', intensity: .65 }]);
  assert.equal('emotion' in cues[0], false);
  assert.equal(planGestureCues({ text: '谢谢你！', intent: 'greet', gesture: 'pointer' })[0].gesture, 'none');
  assert.deepEqual(planGestureCues({ text: '这个人很害怕，不知道怎么办。', intent: 'neutral', emotion: 'happy' }), []);
});

test('explicit no-hand instructions and disabled frequency are respected', () => {
  assert.equal(planGestureCues({ text: '我们先从这里开始仔细分析。', intent: 'explain', gesture: 'none' })[0].gesture, 'none');
  assert.deepEqual(planGestureCues({ text: '我们先分析一下。', intent: 'explain' }, { frequency: 0 }), []);
  assert.deepEqual(planGestureCues({ text: '我们先分析一下。', intent: 'explain' }, { frequency: -2 }), []);
  assert.deepEqual(planGestureCues(null), []);
  assert.deepEqual(planGestureCues({ text: '这句话正常显示。', intent: 'constructor' }), []);
});

test('long explanations use one continuous score, while other intents retain bounded cue density', () => {
  const text = '先把需要解决的问题和已有条件完整列出来，并且确认用户真正需要什么结果，这样之后做判断就有明确的依据。' +
    '所以接下来把问题拆成几个可以单独验证的小步骤，每次只调整其中一项，就能分清楚到底是哪一步产生了影响。' +
    '最后把已经确认有效的步骤连接起来，再检查整体效果和意外情况，保留结果与改动之间的对应关系，下一次就容易继续调整。';
  const cues = planGestureCues({ text, intent: 'explain', gesture: 'pointer' });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].id, 'talk'); assert.equal(cues[0].continuous, true);
  const briefCues = planGestureCues({ text, intent: 'think', gesture: 'pointer' });
  assert.equal(briefCues.length, 2);
  assert.ok(briefCues[1].at >= .3 && briefCues[1].at <= .8);
  assert.ok(planGestureCues({ text, intent: 'explain' }, { frequency: .5 }).length <= 1);
  assert.ok(planGestureCues({ text: text.repeat(30), intent: 'explain' }, { frequency: 99 }).length <= 3);
  assert.ok(cues.every(cue => SPEECH_GESTURE_IDS.includes(cue.id)));
});

test('frequency reduces how many short sentences gesture without reducing their amplitude', () => {
  const sentences = Array.from({ length: 1000 }, (_, index) => ({ text: `我们来看看第${index}个问题应该怎样解决。`, intent: 'explain', gesture: 'pointer' }));
  const plan = frequency => sentences.map(segment => planGestureCues(segment, { frequency }));
  const off = plan(0), quiet = plan(.25), normal = plan(1), lively = plan(1.5);
  assert.equal(off.filter(cues => cues.length).length, 0);
  assert.ok(quiet.filter(cues => cues.length).length > 150 && quiet.filter(cues => cues.length).length < 350);
  assert.equal(normal.filter(cues => cues.length).length, 1000);
  assert.equal(lively.filter(cues => cues.length).length, 1000, 'short replies retain their one-gesture limit');
  assert.deepEqual(quiet, plan(.25), 'replaying the same text keeps the same choices');
  for (let index = 0; index < quiet.length; index++) if (quiet[index].length) assert.equal(quiet[index][0].intensity, normal[index][0].intensity);
  const phrase = '这一部分需要逐项核对每一个条件并且确认实际结果';
  const text = phrase.repeat(4) + '，所以' + phrase.repeat(4) + '，最后' + phrase.repeat(4);
  assert.equal(planGestureCues({ text, intent: 'think' }, { frequency: 1 }).length, 2);
  assert.equal(planGestureCues({ text, intent: 'think' }, { frequency: 1.5 }).length, 3);
});

test('explicit body animation selects sides independently of the legacy hand hint', () => {
  const text = '我来把这两种方案的不同点讲清楚，再一起决定怎样选择。';
  const chosen = planGestureCues({ text, intent: 'explain', gesture: 'none', bodyAnimation: 'chest-right' });
  assert.equal(chosen[0].id, 'chest-right'); assert.equal(chosen[0].gesture, 'chest');
  assert.deepEqual(planGestureCues({ text, intent: 'explain', gesture: 'pointer', bodyAnimation: 'none' }), []);
  const automatic = planGestureCues({ text, intent: 'explain', gesture: 'pointer' });
  assert.equal(automatic[0].id, 'talk');
  const comparison = planGestureCues({ text: '我们先比较这两种方案的区别，再分别讲一讲各自适合什么样的情况。', intent: 'explain', gesture: 'pointer' });
  assert.equal(comparison[0].id, 'talk');
});

test('retired bilateral pointer animations cannot be selected by the speech planner', () => {
  assert.equal(SPEECH_GESTURE_IDS.length, 12);
  for (const bodyAnimation of ['pointer-both', 'compare']) {
    assert.equal(SPEECH_GESTURE_IDS.includes(bodyAnimation), false);
    const cues = planGestureCues({ text: '我们把这两种方案从头讲清楚，然后一起看看它们之间最重要的区别。', intent: 'explain', gesture: 'pointer', bodyAnimation });
    assert.equal(cues[0].id, 'talk', 'obsolete hints use the normal supported explanation');
  }
});

test('continuity requires both the same body intent and the same hand', () => {
  assert.equal(canContinueGesture({ id: 'explain', gesture: 'pointer' }, { id: 'explain', gesture: 'pointer' }), true);
  assert.equal(canContinueGesture({ id: 'explain', gesture: 'pointer' }, { id: 'explain', gesture: 'none' }), false);
  assert.equal(canContinueGesture(undefined, { id: 'explain', gesture: 'none' }), false);
});
