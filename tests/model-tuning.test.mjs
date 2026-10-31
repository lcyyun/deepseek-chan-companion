import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL_TUNING, MODEL_TUNING_LIMITS, sanitizeModelTuning } from '../src/shared/model-tuning.mjs';
import { DEFAULT_EXPRESSION_TUNING } from '../src/shared/expression-tuning.mjs';

test('persisted tuning migrates missing keys, ignores malformed data and clamps valid numbers', () => {
  for (const bad of [null, false, 'all', [], undefined]) assert.deepEqual(sanitizeModelTuning(bad), DEFAULT_MODEL_TUNING);
  const tuning = sanitizeModelTuning({ chestSoftness: 100, bodyMotion: -5, gazeStrength: NaN, blushStrength: '1', basinShadow: Infinity, knockVolume: 0, extra: 3 });
  assert.deepEqual(tuning, { ...DEFAULT_MODEL_TUNING, chestSoftness: 2, bodyMotion: 0, knockVolume: 0 });
  assert.deepEqual(sanitizeModelTuning({ basinShadow: 0.123456 }, tuning), { ...tuning, basinShadow: 0.123 });
  assert.deepEqual(sanitizeModelTuning({}, { chestSoftness: -20 }), { ...DEFAULT_MODEL_TUNING, chestSoftness: 0 });
  for (const [key, range] of Object.entries(MODEL_TUNING_LIMITS)) assert.ok(DEFAULT_MODEL_TUNING[key] >= range.min && DEFAULT_MODEL_TUNING[key] <= range.max);
});

test('per-expression partial edits persist independently and reset without erasing physical settings', () => {
  let tuning = sanitizeModelTuning({ bodyMotion: .8, expressionOverrides: { happy: { smile: .2 }, shy: { blush: -.3 } } });
  assert.deepEqual(tuning.expressionOverrides.happy, { ...DEFAULT_EXPRESSION_TUNING, smile: .2 });
  tuning = sanitizeModelTuning({ expressionOverrides: { happy: { eyeOpen: .15, intensity: 9 }, bogus: { smile: 1 } } }, tuning);
  assert.equal(tuning.expressionOverrides.happy.smile, .2);
  assert.equal(tuning.expressionOverrides.happy.eyeOpen, .15);
  assert.equal(tuning.expressionOverrides.happy.intensity, 1.5);
  assert.equal(tuning.expressionOverrides.shy.blush, -.3);
  assert.equal('bogus' in tuning.expressionOverrides, false);
  const ignored = sanitizeModelTuning({ expressionOverrides: { happy: { smile: NaN, eyeOpen: '1' } } }, tuning);
  assert.deepEqual(ignored, tuning);
  tuning = sanitizeModelTuning({ expressionOverrides: { happy: null } }, tuning);
  assert.equal('happy' in tuning.expressionOverrides, false);
  assert.equal(tuning.expressionOverrides.shy.blush, -.3);
  for (const reset of [null, {}]) {
    const cleared = sanitizeModelTuning({ expressionOverrides: reset }, tuning);
    assert.deepEqual(cleared.expressionOverrides, {});
    assert.equal(cleared.bodyMotion, .8);
  }
});

test('knock sound migrates to basin, persists the chosen enum and survives unrelated partial updates', () => {
  assert.equal(sanitizeModelTuning({}).knockSound, 'basin');
  const selected = sanitizeModelTuning({ knockSound: 'pipe', knockVolume: .3 });
  assert.equal(selected.knockSound, 'pipe');
  const restored = sanitizeModelTuning(JSON.parse(JSON.stringify(selected)));
  assert.deepEqual(restored, selected);
  for (const input of [{ chestSoftness: 1.2 }, { knockSound: null }, { knockSound: 'url' }, { knockSound: 1 }]) {
    const update = sanitizeModelTuning(input, restored);
    assert.equal(update.knockSound, 'pipe'); assert.equal(update.knockVolume, .3);
  }
  assert.equal(sanitizeModelTuning({ knockSound: 'basin' }, restored).knockSound, 'basin');
  assert.equal(sanitizeModelTuning({ knockSound: 'invalid' }).knockSound, 'basin');
  assert.equal(Object.hasOwn(MODEL_TUNING_LIMITS, 'knockSound'), false, 'sound choices must not appear as numeric sliders');
});
