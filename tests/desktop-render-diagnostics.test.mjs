import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
const run = promisify(execFile), require = createRequire(import.meta.url);

test('real production model diagnostics reach authenticated API and the settings copy button', {
  skip: process.platform !== 'win32' || !process.env.L2D_MODEL_ROOT,
  timeout: 65000,
}, async t => {
  try { await access(resolve('dist/index.html')); }
  catch { t.skip('Build the production UI first'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'l2d-render-diagnostics-desktop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const dshHome = join(directory, 'empty-dsh-home'); await mkdir(dshHome);
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({
    modelRoot: resolve(process.env.L2D_MODEL_ROOT), renderQuality: 'balanced', mouseTracking: false,
    setupCompleted: true, dshHome, dshPort: port,
  }));
  const env = { ...process.env, COMPANION_PORT: String(port) }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await run(require('electron'), [resolve('tests/desktop-render-diagnostics-fixture.cjs'), directory], {
      cwd: resolve('.'), env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const report = JSON.parse(await readFile(join(directory, 'render-diagnostics-result.json'), 'utf8').catch(() => '{}'));
    throw Error(report.errors?.join('\n') || error.message, { cause: error });
  }
  const report = JSON.parse(await readFile(join(directory, 'render-diagnostics-result.json'), 'utf8'));
  assert.equal(report.ok, true); assert.equal(report.windowsHidden, true); assert.equal(report.privateDataAbsent, true);
  assert.equal(report.clipboardCopies, 1); assert.ok(report.thinkingSampleCount >= 1);
  assert.equal(report.bufferCacheSwitchVerified,true);
  assert.equal(report.ownedStateSwitchVerified,true);
  assert.ok(report.gpuRenderer); assert.ok(report.textureBytes > 0);
  assert.deepEqual(report.errors, []);
  t.diagnostic(JSON.stringify(report));
});
