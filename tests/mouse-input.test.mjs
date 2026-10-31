import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import mouseInput from '../desktop/mouse-input.cjs';

const windows = { skip: process.platform !== 'win32', timeout: 10000 };
const deadline = (promise, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('observer test timeout')), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

async function observe(t, parentPid) {
  const { path } = await mouseInput.ensureMouseInput();
  const child = spawn(path, ['--parent-pid', String(parentPid)], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.stdin.end(); if (child.exitCode === null) child.kill(); });
  const messages = new EventEmitter(), received = [];
  let pending = '', stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines.filter(Boolean)) { const message = JSON.parse(line); received.push(message); messages.emit(message.type, message); }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await deadline(once(messages, 'button'));
  return { child, messages, received, stderr: () => stderr };
}

test('native observer emits only left-button state, heartbeats, and exits when stdin closes', windows, async t => {
  const { child, messages, received, stderr } = await observe(t, process.pid);
  await deadline(once(messages, 'heartbeat'));
  assert.ok(received.length >= 2);
  for (const [index, message] of received.entries()) {
    assert.deepEqual(Object.keys(message).sort(), ['button', 'down', 'seq', 'type']);
    assert.equal(message.button, 'left'); assert.equal(typeof message.down, 'boolean');
    assert.ok(['button', 'heartbeat'].includes(message.type));
    if (index) assert.ok(message.seq > received[index - 1].seq);
  }
  const exit = once(child, 'exit'); child.stdin.end();
  assert.equal((await deadline(exit))[0], 0);
  assert.equal(stderr(), '');
});

test('native observer exits when its declared parent exits even while stdin stays open', windows, async t => {
  const parent = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { windowsHide: true, shell: false, stdio: 'ignore' });
  t.after(() => { if (parent.exitCode === null) parent.kill(); });
  await once(parent, 'spawn');
  const { child } = await observe(t, parent.pid);
  const exit = once(child, 'exit'); parent.kill();
  assert.equal((await deadline(exit))[0], 0);
});

test('wrapper starts the real bundled observer and stops with a released state', windows, async t => {
  const changes = [], failures = [];
  const controller = mouseInput.startMouseInput({ onButton: value => changes.push(value), onUnavailable: error => failures.push(error.code) });
  t.after(() => controller.stop());
  assert.equal(await deadline(controller.ready), true);
  controller.stop();
  assert.equal(changes.at(-1), false);
  assert.deepEqual(failures, []);
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
      assert.deepEqual(args, ['--parent-pid', String(process.pid)]);
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
  const {controller,child,changes}=await wrapperFixture(t,{onSample:sample=>samples.push(sample)});
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
