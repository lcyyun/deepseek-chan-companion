import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url), run = promisify(execFile);

test('fresh chat preserves drafts without a provider and enables sending after external agent configuration', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  await access(resolve('dist/index.html'));
  const prefix = join(tmpdir(), 'l2d-provider-ui-'), directory = await mkdtemp(prefix);
  t.after(() => { assert.ok(resolve(directory).startsWith(resolve(prefix))); return rm(directory, { recursive: true, force: true }); });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try { await run(require('electron'), [resolve('tests/desktop-provider-fixture.cjs'), directory], { cwd: resolve('.'), env, windowsHide: true, timeout: 35000 }); }
  catch (error) { const result = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8').catch(() => '{}')); throw Error(result.error || error.message); }
  const result = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.defaultProvider, 'unconfigured');
  assert.equal(result.blockedDraftPreserved, true);
  assert.deepEqual(result.providerCalls, ['api', 'dsh']);
  assert.equal(result.chatRequests, 2);
  assert.equal(result.externalRequests, 0);
  assert.deepEqual(result.errors, []);
});
