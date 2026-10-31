import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url), run = promisify(execFile);

test('production Pet recovers capture failures and dropped pointer releases', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'l2d-pet-pointer-'));
  t.after(async () => {
    const target = resolve(directory), temporary = resolve(tmpdir());
    assert.ok(target.startsWith(temporary + require('node:path').sep) && target.includes('l2d-pet-pointer-'));
    await rm(target, { recursive: true, force: true });
  });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await run(require('electron'), [resolve('tests/pet-pointer-fixture.cjs'), directory], {
      cwd: resolve('.'), windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024, env,
    });
  } catch (error) {
    let report; try { report = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')); } catch {}
    throw new Error(report?.fatal || error.message, { cause: error });
  }
  const report = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'));
  assert.equal(report.hardwareAcceleration, false);
  assert.equal(report.windowVisible, false);
  assert.equal(report.realReactAndBehavior, true);
  for (const result of report.cases) await t.test(result.name, () => assert.equal(result.ok, true, result.error));
});
