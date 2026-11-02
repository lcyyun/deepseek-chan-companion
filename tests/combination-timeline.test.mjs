import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers/import-typescript.mjs';
const { createCombinationTimeline } = await importTypeScript(new URL('../src/renderer/combination-timeline.ts', import.meta.url));
const preset = { id: 'reassure', durationMs: 4000, command: { intent: 'reassure', gesture: 'chest', emotion: 'gentle' } };
function fixture(combination = preset) {
  const samples = [], clears = [];
  return { samples, clears, clock: createCombinationTimeline(combination, sample => samples.push(sample), keep => clears.push(keep), 'test') };
}

test('opening waits for playback, follows its clock once, then leaves the remainder to face/body', () => {
  const { clock, samples, clears } = fixture();
  assert.deepEqual(samples, []);
  assert.equal(clock.update(0, 14), null);
  assert.equal(clock.update(2, 14), null);
  assert.equal(samples.at(-1).progress, .5);
  clock.update(2, 14); clock.update(1, 14);
  assert.equal(samples.length, 2);
  assert.deepEqual(clock.update(4, 14), { elapsed: 0, duration: 10 });
  assert.deepEqual(clock.update(10, 14), { elapsed: 6, duration: 10 });
  assert.deepEqual(clears, [true]);
  clock.finish(); clock.cancel();
  assert.deepEqual(clears, [true]);
});

test('short clips compress a preset into the available audio instead of dropping it', () => {
  const { clock, samples } = fixture();
  assert.equal(clock.update(0, 2), null);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].durationMs, 1950);
  assert.equal(samples[0].progress, 0);
});

test('a late first playback callback still skips a preset instead of replaying it', () => {
  const { clock, samples } = fixture();
  assert.deepEqual(clock.update(1, 14), { elapsed: 1, duration: 14 });
  assert.deepEqual(samples, []);
});

test('stop releases an active opening once and rejects old audio callbacks', () => {
  const { clock, samples, clears } = fixture();
  clock.update(0, 14); clock.cancel(); clock.cancel(); clock.update(2, 14); clock.finish();
  assert.equal(samples.length, 1);
  assert.deepEqual(clears, [false]);
});
