import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import vm from 'node:vm';

// The production wrapper is Windows-specific; exercise its protocol on any CI
// host with an isolated platform facade and injected, in-memory child pipes.
const source = new URL('../desktop/mouse-input.cjs', import.meta.url);
const fixtureModule = { exports: {} };
vm.runInNewContext(await readFile(source, 'utf8'), {
  module: fixtureModule, require: createRequire(source),
  __dirname: dirname(fileURLToPath(source)),
  process: { platform: 'win32', pid: process.pid, env: process.env },
  setTimeout, clearTimeout, setInterval, clearInterval,
}, { filename: fileURLToPath(source) });
const mouseInput = fixtureModule.exports;

const windows = { timeout: 10000 };
const deadline = (promise, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('observer test timeout')), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

function fakeProcess() {
  const child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  const close = code => { if (child.exitCode !== null) return; child.exitCode = code; child.emit('exit', code, null); };
  child.stdin.on('finish', () => close(0));
  child.kill = () => close(1);
  child.message = message => child.stdout.write(JSON.stringify(message) + '\n');
  return child;
}

async function wrapperFixture(t, options = {}) {
  const child = fakeProcess(), changes = [], failures = [];
  let failed;
  const failure = new Promise(resolve => { failed = resolve; });
  const controller = mouseInput.startMouseInput({
    executable: 'fixture-not-executed.exe', heartbeatTimeoutMs: 250,
    spawnImpl(file, args, config) {
      assert.ok(file.endsWith('fixture-not-executed.exe'));
      assert.deepEqual(Array.from(args), ['--parent-pid', String(process.pid)]);
      assert.equal(config.windowsHide, true); assert.equal(config.shell, false);
      return child;
    },
    onButton: value => changes.push(value),
    onUnavailable: error => { failures.push(error); failed(error); },
    ...options,
  });
  t.after(() => controller.stop());
  await nextTurn();
  child.message({ type: 'button', button: 'left', down: true, seq: 0 });
  assert.equal(await controller.ready, true);
  assert.deepEqual(changes, [false, true]);
  return { controller, child, changes, failures, failure };
}

test('explicit stop synchronously releases a press without reporting a failure', windows, async t => {
  const { controller, changes, failures } = await wrapperFixture(t);
  controller.stop();
  assert.deepEqual(changes, [false, true, false]);
  await nextTurn(); assert.equal(failures.length, 0);
});

test('fresh held samples reach consumers without duplicating button edges or fabricating a release',windows,async t=>{
  const samples=[];
  const {controller,child,changes}=await wrapperFixture(t,{onSample:sample=>samples.push({...sample})});
  child.message({type:'heartbeat',button:'left',down:true,seq:1});
  child.message({type:'heartbeat',button:'left',down:true,seq:2});
  assert.deepEqual(changes,[false,true]);
  assert.deepEqual(samples,[{down:true,seq:0},{down:true,seq:1},{down:true,seq:2}]);
  controller.stop();assert.deepEqual(changes,[false,true,false]);assert.equal(samples.length,3,'shutdown is cancellation, not a physical up sample');
});

test('heartbeat loss releases a held button and reports unavailable once', windows, async t => {
  const { changes, failures, failure } = await wrapperFixture(t);
  assert.equal((await deadline(failure)).code, 'MOUSE_HEARTBEAT_TIMEOUT');
  assert.deepEqual(changes, [false, true, false]); assert.equal(failures.length, 1);
});

test('helper exit and malformed output cannot leave a held button active', windows, async t => {
  for (const mode of ['exit', 'malformed']) {
    await t.test(mode, async subtest => {
      const { child, changes, failure } = await wrapperFixture(subtest);
      if (mode === 'exit') child.kill(); else child.stdout.write('invalid json\n');
      const error = await deadline(failure);
      assert.equal(error.code, mode === 'exit' ? 'MOUSE_HELPER_EXITED' : 'MOUSE_PROTOCOL_ERROR');
      assert.deepEqual(changes, [false, true, false]);
    });
  }
});
