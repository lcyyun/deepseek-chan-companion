// Requires a Windows interactive user session with native child-process access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
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
