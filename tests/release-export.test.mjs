import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { assertReleaseChild, collectReleaseFiles, rejectedReleasePath, writeReleaseZip } from '../scripts/release.mjs';

test('release rejects private data, model assets and escaping entry paths', () => {
  for (const file of ['../outside.txt', '/absolute.txt', 'C:/outside.txt', 'a\\b.txt', 'a//b.txt', 'DeepSeek-chan-data/settings.json', '.dsh/profile.yml', 'resources/app/models/example.png', 'resources/app/bridge-token', 'resources/app/settings.json', 'resources/app/.env', 'resources/app/auth.json', 'resources/app/test.moc3', 'resources/app/test.model3.json', 'resources/app/private.pem', 'resources/app/GPUCache/data_0']) assert.ok(rejectedReleasePath(file), file);
  for (const file of ['DeepSeek-chan.exe', 'resources/app/server/settings.mjs', 'resources/app/server/edge-tts-token.mjs', 'resources/app/.env.example', 'docs/model-analysis.md', 'resources/app/node_modules/zod/package.json', 'resources/app/node_modules/hono/dist/cjs/middleware/cache/index.js', 'resources/app/node_modules/hono/dist/middleware/cache/index.js']) assert.equal(rejectedReleasePath(file), null, file);
  for (const file of ['resources/app/node_modules/hono/dist/cjs/middleware/cache/bridge-token', 'resources/app/node_modules/hono/dist/middleware/cache/settings.json', 'resources/app/node_modules/other/cache/private.json']) assert.ok(rejectedReleasePath(file), file);
});

test('streaming release ZIP round-trips and rejects files changed after audit', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'companion-release-zip-test-'));
  const source = path.join(temp, 'payload');
  try {
    await mkdir(source);
    await writeFile(path.join(source, 'example.txt'), 'abc');
    const files = await collectReleaseFiles(source);
    const manifest = { files, bytes: 3 };
    await writeFile(path.join(temp, 'release-manifest.json'), JSON.stringify(manifest));
    await writeReleaseZip(source, temp, manifest, path.join(temp, 'release.zip'));
    const contents = unzipSync(new Uint8Array(await readFile(path.join(temp, 'release.zip'))));
    assert.deepEqual(Object.keys(contents), ['example.txt', 'release-manifest.json']);
    assert.equal(Buffer.from(contents['example.txt']).toString(), 'abc');
    assert.deepEqual(JSON.parse(Buffer.from(contents['release-manifest.json']).toString()), manifest);
    await writeFile(path.join(source, 'example.txt'), 'xyz');
    await assert.rejects(writeReleaseZip(source, temp, manifest, path.join(temp, 'changed.zip')), /changed during export/);
  } finally {
    assertReleaseChild(os.tmpdir(), temp);
    await rm(temp, { recursive: true });
  }
});

test('release output checks reject sibling and parent paths', () => {
  const parent = path.resolve('release');
  assert.equal(assertReleaseChild(parent, path.join(parent, 'distributables')), path.join(parent, 'distributables'));
  for (const candidate of [parent, path.dirname(parent), path.resolve('release-outside')]) assert.throws(() => assertReleaseChild(parent, candidate), /outside/);
});

test('release manifest hashes payloads and excludes the producer workspace marker', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'companion-release-test-'));
  try {
    await mkdir(path.join(temp, 'resources'));
    await writeFile(path.join(temp, '.companion-package.json'), '{"workspace":"private-local-path"}');
    await writeFile(path.join(temp, 'resources', 'example.txt'), 'abc');
    const files = await collectReleaseFiles(temp);
    assert.deepEqual(files, [{ path: 'resources/example.txt', bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }]);
    await writeFile(path.join(temp, 'resources', 'bridge-token'), 'private');
    await assert.rejects(collectReleaseFiles(temp), /private settings or credentials/);
  } finally {
    assertReleaseChild(os.tmpdir(), temp);
    await rm(temp, { recursive: true });
  }
});
