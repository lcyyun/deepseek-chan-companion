import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transform } from 'esbuild';

const { code } = await transform(await fs.readFile(new URL('../src/renderer/expression-timeline.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { createExpressionTimeline } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const cues = ['puzzled', 'curious', 'happy', 'joyful'].map((emotion, i) => ({ at: i * .25, emotion, intensity: .8 }));

test('expression score stays dormant until actual playback progress arrives', () => {
  const seen = [], timeline = createExpressionTimeline(cues, cue => seen.push(cue.emotion));
  assert.deepEqual(seen, []);
  timeline.update(0, 8); timeline.update(1.9, 8); assert.deepEqual(seen, ['puzzled']);
  timeline.update(2, 8); timeline.update(4, 8); timeline.update(6, 8);
  assert.deepEqual(seen, ['puzzled', 'curious', 'happy', 'joyful']);
});

test('short speech retains its opening expression and skips the tail', () => {
  const seen = [], timeline = createExpressionTimeline(cues, cue => seen.push(cue.emotion));
  for (const time of [0, .25, .5, .75, 1]) timeline.update(time, 1);
  assert.deepEqual(seen, ['puzzled']);
});

test('late animation frames choose one current expression without replaying a queue', () => {
  const seen = [], timeline = createExpressionTimeline(cues, cue => seen.push(cue.emotion));
  timeline.update(0, 8); timeline.update(6.2, 8); timeline.update(8, 8);
  assert.deepEqual(seen, ['puzzled', 'joyful']);
});

test('stop prevents future callbacks from changing the face', () => {
  const seen = [], timeline = createExpressionTimeline(cues, cue => seen.push(cue.emotion));
  timeline.update(0, 8); timeline.cancel(); timeline.update(4, 8);
  assert.deepEqual(seen, ['puzzled']);
});
