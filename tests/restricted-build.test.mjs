import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { bundleTypescript, extractSdkZip } from '../scripts/build-in-process.mjs';

async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'l2d-restricted-build-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('restricted bundler resolves TypeScript imports and emits usable ESM without external TS', async t => {
  const folder = await fixture(t);
  await writeFile(path.join(folder, 'value.ts'), 'export const value: number = 42;');
  await writeFile(path.join(folder, 'entry.ts'), "import { value } from './value'; export const answer: number = value;");
  const outfile = path.join(folder, 'built.mjs');
  await bundleTypescript({ input: path.join(folder, 'entry.ts'), outfile });
  const built = await readFile(outfile, 'utf8');
  assert.match(built, /42/);
  assert.doesNotMatch(built, /\.\/value|: number/);
  assert.equal((await import(pathToFileURL(outfile).href)).answer, 42);
});

test('restricted extraction accepts normal SDK folders and rejects traversal before escaping', async t => {
  const folder = await fixture(t);
  await extractSdkZip(zipSync({ 'sdk/Core/test.js': strToU8('verified-content') }), path.join(folder, 'safe'));
  assert.equal(await readFile(path.join(folder, 'safe/sdk/Core/test.js'), 'utf8'), 'verified-content');
  for (const name of ['../escaped.txt', '/absolute.txt', 'C:/escaped.txt', 'sdk/../../escaped.txt']) {
    await assert.rejects(extractSdkZip(zipSync({ [name]: strToU8('bad') }), path.join(folder, 'unsafe')), /Unsafe path/);
  }
  await assert.rejects(access(path.join(folder, 'escaped.txt')));
});

test('restricted CSS is included deterministically and unsupported CSS assets fail clearly', async t => {
  const folder = await fixture(t);
  await writeFile(path.join(folder, 'first.css'), '.first { color: red; }');
  await writeFile(path.join(folder, 'second.css'), '.second { color: blue; }');
  const entry = path.join(folder, 'entry.ts');
  await writeFile(entry, "import './first.css'; import './second.css'; export const ready = true;");
  await bundleTypescript({ input: entry, outfile: path.join(folder, 'bundle.js'), css: true });
  const css = await readFile(path.join(folder, 'bundle.css'), 'utf8');
  assert.ok(css.indexOf('.first') < css.indexOf('.second'));
  await writeFile(path.join(folder, 'first.css'), '.first { background: url(./unsupported.png); }');
  await assert.rejects(bundleTypescript({ input: entry, outfile: path.join(folder, 'bundle.js'), css: true }), /plain CSS only/);
});
