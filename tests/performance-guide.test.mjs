import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPRESSION_PRESETS } from '../src/shared/expressions.mjs';
import { BODY_ANIMATION_PRESETS } from '../src/shared/body-animation.mjs';
import { COMBINATION_PRESETS } from '../src/shared/speech-combination.mjs';
import { EXPRESSION_GUIDE, BODY_ANIMATION_GUIDE, COMBINATION_GUIDE, PERFORMANCE_GUIDE, PERFORMANCE_GUIDE_BRIEF, formatPerformanceGuide } from '../src/shared/performance-guide.mjs';

const catalogs = [
  ['face', EXPRESSION_PRESETS, EXPRESSION_GUIDE, 25],
  ['body', BODY_ANIMATION_PRESETS, BODY_ANIMATION_GUIDE, 12],
  ['combination', COMBINATION_PRESETS, COMBINATION_GUIDE, 12],
];

test('every supported face, body and combination has distinct selection guidance', () => {
  for (const [mode, presets, guide, count] of catalogs) {
    assert.equal(Object.keys(guide).length, count, mode);
    assert.deepEqual(Object.keys(guide).sort(), presets.map(item => item.id).sort(), mode);
    assert.equal(new Set(Object.values(guide).map(item => item.useWhen)).size, count, `${mode} choices must have distinct purposes`);
    for (const [id, item] of Object.entries(guide)) {
      assert.ok(item.tags.length >= 2 && item.tags.length <= 3, `${mode}/${id} tags`);
      assert.equal(new Set(item.tags).size, item.tags.length);
      assert.ok(item.tags.every(tag => /^[a-z]+(?:-[a-z]+)*$/.test(tag)), `${mode}/${id} stable machine-readable tags`);
      assert.ok(item.useWhen.length > 4 && item.useWhen.length <= 28, `${mode}/${id} concise purpose`);
      assert.ok(item.avoidWhen.length > 4 && item.avoidWhen.length <= 28, `${mode}/${id} useful limitation`);
    }
  }
});

test('recommended pairings use only existing independent face/body IDs', () => {
  const faces = new Set(EXPRESSION_PRESETS.map(item => item.id));
  const bodies = new Set(BODY_ANIMATION_PRESETS.map(item => item.id));
  for (const [mode, , guide] of catalogs) for (const [id, item] of Object.entries(guide)) {
    assert.ok(item.recommendedEmotions.length <= 3 && item.recommendedBody.length <= 2, `${mode}/${id} avoids an exhaustive pairing list`);
    for (const emotion of item.recommendedEmotions) assert.ok(faces.has(emotion), `${mode}/${id} recommends unknown face ${emotion}`);
    for (const body of item.recommendedBody) assert.ok(bodies.has(body), `${mode}/${id} recommends unknown body ${body}`);
    if (mode === 'face') assert.ok(item.recommendedBody.length > 0);
    if (mode === 'body') assert.ok(item.recommendedEmotions.length > 0);
    if (mode === 'combination') assert.ok(item.recommendedBody.length > 0 && item.recommendedEmotions.length > 0);
  }
  assert.deepEqual(PERFORMANCE_GUIDE.preferredCombinations, ['agree', 'explain', 'shy', 'think', 'idea', 'cuddle']);
  for (const id of PERFORMANCE_GUIDE.preferredCombinations) assert.ok(Object.hasOwn(COMBINATION_GUIDE, id));
  for (const [id, name] of Object.entries({ agree: '开心点头', explain: '讲个重点', shy: '有点害羞', think: '冥思苦想', idea: '想到了', cuddle: '撒娇捧胸' })) {
    assert.equal(COMBINATION_GUIDE[id].displayName, name);
    assert.ok(formatPerformanceGuide().includes(`${id}(${name})=`), 'the compact prompt maps familiar UI names back to stable IDs');
  }
  assert.ok(COMBINATION_GUIDE.think.tags.includes('explicit'));
});

test('guidance remains immutable and compact enough for a prompt without playback internals', () => {
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) walk(child);
  };
  walk(PERFORMANCE_GUIDE);
  assert.deepEqual(Object.keys(PERFORMANCE_GUIDE.modes), ['face', 'body', 'combination']);
  assert.match(PERFORMANCE_GUIDE.modes.face.description, /不带肢体/);
  assert.match(PERFORMANCE_GUIDE.modes.body.description, /面部独立/);
  assert.match(PERFORMANCE_GUIDE.modes.combination.description, /随后/);
  assert.equal(formatPerformanceGuide({ includeCatalog: false }), PERFORMANCE_GUIDE_BRIEF);
  const full = formatPerformanceGuide();
  assert.ok(PERFORMANCE_GUIDE_BRIEF.length < 500);
  assert.ok(full.length < 2200, `compact guide grew to ${full.length} characters`);
  assert.equal(full.split('\n').length, 4);
  for (const [, , guide] of catalogs) for (const [id, item] of Object.entries(guide)) {
    assert.ok(full.includes(item.useWhen));
    assert.ok(full.includes(item.displayName ? `${id}(${item.displayName})=` : `${id}=`));
  }
  assert.doesNotMatch(full, /Param|ArtMesh|Part\d|setSpeech|compare=|pointer-both=/);
});
