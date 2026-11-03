import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEdition, parsePackageOptions, USER_DOCUMENTS, DEVELOPMENT_ROOT_FILES, developmentScriptAllowed, editionArchiveName, validatePackageEdition } from '../scripts/package-editions.mjs';
import { editionExtension } from '../scripts/build-extension.mjs';

test('source builds default to developer, packages default to user, and outputs cannot silently collide', () => {
  assert.equal(validateEdition(undefined), 'developer');
  assert.deepEqual(parsePackageOptions([]), { edition: 'user', outDir: 'release/user' });
  assert.deepEqual(parsePackageOptions(['--edition=developer']), { edition: 'developer', outDir: 'release/developer' });
  assert.deepEqual(parsePackageOptions(['--out-dir=release/candidate', '--edition=user']), { edition: 'user', outDir: 'release/candidate' });
  for (const args of [['--edition=debug'], ['--edition=user', '--edition=developer'], ['--out-dir='], ['--unknown=x']]) assert.throws(() => parsePackageOptions(args));
  assert.equal(editionArchiveName('0.24.0', 'user'), 'DeepSeek-chan-0.24.0-user-win32-x64.zip');
  assert.equal(editionArchiveName('0.24.0', 'developer'), 'DeepSeek-chan-0.24.0-developer-win32-x64.zip');
  assert.throws(() => editionArchiveName('../outside', 'user'));
});

test('package export rejects renderer, metadata or runtime edition mismatches', () => {
  const coherent = edition => ({ marker: { edition }, packageInfo: { edition }, appManifest: { companionEdition: edition }, rendererInfo: { edition } });
  for (const edition of ['user', 'developer']) {
    assert.equal(validatePackageEdition(coherent(edition)), edition);
    for (const key of ['marker', 'packageInfo', 'appManifest', 'rendererInfo']) {
      const broken = coherent(edition); broken[key] = {};
      assert.throws(() => validatePackageEdition(broken), /edition/i);
    }
    const wrong = coherent(edition); wrong.rendererInfo.edition = edition === 'user' ? 'developer' : 'user';
    assert.throws(() => validatePackageEdition(wrong), /edition/i);
  }
});

test('edition source/docs whitelist includes rebuild tools, not producer media tools or private state', () => {
  assert.deepEqual(USER_DOCUMENTS, ['user-guide.md', 'audio-sources.md', 'icon-sources.md']);
  assert.ok(DEVELOPMENT_ROOT_FILES.includes('package-lock.json'));
  for (const file of ['package.mjs', 'package-editions.mjs', 'test.mjs', 'build-in-process.mjs', 'benchmark-compositor.cjs', 'verify-owned-state-equivalence.cjs']) assert.equal(developmentScriptAllowed(file), true);
  for (const file of ['video-voice.py', 'record-promo.cjs', '../secrets.json', 'VERIFICATION.md', '.dsh/profile.yaml']) assert.equal(developmentScriptAllowed(file), false);
});

test('each browser extension targets only its own exact loopback port and identifies its edition', async () => {
  for (const edition of ['user', 'developer']) {
    const files = await editionExtension(edition), manifest = JSON.parse(files['manifest.json']);
    const port = edition === 'developer' ? 39182 : 39181;
    assert.deepEqual(manifest.host_permissions, [`http://127.0.0.1:${port}/*`]);
    assert.ok(files['background.js'].startsWith(`const BASE = 'http://127.0.0.1:${port}';`));
    assert.equal(manifest.name.includes('开发版'), edition === 'developer');
    assert.equal(files['popup.html'].includes('开发版'), edition === 'developer');
    assert.doesNotMatch(files['popup.html'], /小鲸/);
  }
});
