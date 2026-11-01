import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transform } from 'esbuild';

const { code } = await transform(await fs.readFile(new URL('../src/renderer/gesture-timeline.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { createGestureTimeline } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const cue = (at = 0, gesture = 'pointer') => ({ at, id: 'explain', gesture, intensity: .55 });
function fixture(cues = [cue()], options) {
  const seen = [], cleared = [];
  const timeline = createGestureTimeline(cues, sample => seen.push(sample), () => cleared.push(true), options);
  return { timeline, seen, cleared };
}

test('body score is dormant until real playback and advances the same gesture without restarting', () => {
  const { timeline, seen, cleared } = fixture();
  assert.deepEqual(seen, []);
  timeline.update(NaN, 8); timeline.update(0, 0); assert.equal(seen.length, 0);
  timeline.update(0, 8); timeline.update(1, 8); timeline.update(1, 8);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].key, seen[1].key);
  assert.equal(seen[0].progress, 0);
  assert.ok(seen[1].progress > 0);
  timeline.update(.2, 8); assert.equal(seen.length, 2);
  timeline.update(4.3, 8); assert.equal(cleared.length, 1);
  assert.equal(seen.at(-1).progress, 1);
});

test('real short audio rejects a full arm entrance but can show a small body response', () => {
  const short = fixture(); short.timeline.update(0, 2); short.timeline.update(1, 2); short.timeline.finish();
  assert.equal(short.seen.length, 0);
  const body = fixture([cue(0, 'none')]); body.timeline.update(0, 2);
  assert.equal(body.seen.length, 1);
});

test('cooldown prevents rapid successive gestures, while a later emphasis remains available', () => {
  const { timeline, seen } = fixture([cue(0), cue(.2), cue(.65)]);
  for (const time of [0, 2, 4.3, 6.3, 8, 10]) timeline.update(time, 10);
  assert.deepEqual([...new Set(seen.map(sample => sample.key.split(':').at(-1)))], ['0', '2']);
});

test('seeking or late frames drop expired gestures instead of replaying an animation queue', () => {
  const late = fixture([cue(0), cue(.5)]);
  late.timeline.update(7, 10); late.timeline.update(8, 10);
  assert.equal(late.seen.length, 0);
  const active = fixture([cue(0), cue(.6)]);
  active.timeline.update(0, 10); active.timeline.update(5.8, 10);
  assert.equal(new Set(active.seen.map(sample => sample.key)).size, 2);
});

test('identical adjacent segment poses hold and resume without dropping the arm', () => {
  const first = fixture([cue()], { holdLast: true, key: 'first' });
  first.timeline.update(0, 8); first.timeline.update(7.9, 8); first.timeline.finish();
  assert.equal(first.seen.at(-1).progress, .72);
  assert.equal(first.cleared.length, 0);
  const next = fixture([cue()], { continueFirst: true, key: 'next' });
  next.timeline.update(0, 8);
  assert.equal(next.seen[0].progress, .28);
  next.timeline.finish(); assert.equal(next.cleared.length, 1);
  first.timeline.cancel(); assert.equal(first.cleared.length, 1);
});

test('cancel is idempotent and rejects late progress, including an inherited pose', () => {
  const { timeline, seen, cleared } = fixture([cue()], { continueFirst: true });
  timeline.cancel(); timeline.cancel(); timeline.update(0, 8); timeline.finish();
  assert.equal(seen.length, 0); assert.equal(cleared.length, 1);
  const short = fixture([cue()], { continueFirst: true });
  short.timeline.update(0, .5); assert.equal(short.cleared.length, 1);
});
