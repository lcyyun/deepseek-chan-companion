import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertReleaseChild } from '../scripts/release.mjs';
const run = promisify(execFile);

test('installer separates editions, preserves existing installs and validates runtime edition before publishing', {
  skip: process.platform !== 'win32', timeout: 60000,
}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'l2d-edition-installer-'));
  t.after(async () => { assertReleaseChild(tmpdir(), directory); await rm(directory, { recursive: true, force: true }); });
  const local = path.join(directory, 'isolated-localappdata');
  await mkdir(local);
  const installer = await readFile(new URL('../scripts/install-release.ps1', import.meta.url));
  async function fixture(name, edition, { legacy = false, runtimeEdition = edition, version = '99.0.0' } = {}) {
    const folder = path.join(directory, name);
    const files = {
      'Install.ps1': installer,
      'DeepSeek-chan.exe': Buffer.from('not-an-executable; fixture is never launched'),
      'package-info.json': Buffer.from(JSON.stringify(legacy ? {} : { edition })),
      'resources/app/package.json': Buffer.from(JSON.stringify(legacy ? {} : { companionEdition: runtimeEdition })),
      'resources/app/dist/edition.json': Buffer.from(JSON.stringify(legacy ? {} : { edition })),
    };
    const list = [];
    for (const [relative, data] of Object.entries(files)) {
      const file = path.join(folder, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, data);
      list.push({ path: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
    const manifest = { schemaVersion: 1, package: 'deepseek-chan-companion', version, platform: 'win32-x64',
      ...(!legacy ? { edition } : {}), modelIncluded: false, userDataIncluded: false, fileCount: list.length,
      bytes: list.reduce((sum, item) => sum + item.bytes, 0), files: list };
    await writeFile(path.join(folder, 'release-manifest.json'), JSON.stringify(manifest));
    return folder;
  }
  async function install(folder, installRoot) {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return run(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(folder, 'Install.ps1'), '-NoShortcuts',
      ...(installRoot ? ['-InstallRoot', installRoot] : [])], { env: { ...process.env, LOCALAPPDATA: local }, windowsHide: true, timeout: 12000, maxBuffer: 256 * 1024 });
  }
  const user = await fixture('user', 'user'), developer = await fixture('developer', 'developer');
  const userRoot = path.join(local, 'Programs', 'DeepSeekChan'), developerRoot = path.join(local, 'Programs', 'DeepSeekChanDeveloper');
  await install(user); await install(developer);
  const userManifest = await readFile(path.join(userRoot, 'app-99.0.0', 'release-manifest.json'), 'utf8');
  assert.equal(JSON.parse(userManifest).edition, 'user');
  assert.equal(JSON.parse(await readFile(path.join(developerRoot, 'app-99.0.0', 'release-manifest.json'), 'utf8')).edition, 'developer');
  assert.match((await install(user)).stdout, /identical installed release/);
  await assert.rejects(install(developer, userRoot), /each edition in its own directory/);
  assert.equal(await readFile(path.join(userRoot, 'app-99.0.0', 'release-manifest.json'), 'utf8'), userManifest);
  const wrong = await fixture('wrong', 'user', { runtimeEdition: 'developer', version: '99.0.1' });
  await assert.rejects(install(wrong), /edition metadata does not match/);
  await assert.rejects(access(path.join(userRoot, 'app-99.0.1')));
  const old = await fixture('legacy', 'user', { legacy: true, version: '98.0.0' });
  await install(old);
  await access(path.join(userRoot, 'app-98.0.0', 'DeepSeek-chan.exe'));
  await assert.rejects(install(user, path.join(directory, 'outside-programs')), /escapes the installation root/);
  t.diagnostic('All installs used an isolated LOCALAPPDATA and -NoShortcuts; no executable or user profile was launched.');
});
