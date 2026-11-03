import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers/import-typescript.mjs';
const { createGpuDrawTimer } = await importTypeScript(new URL('../src/renderer/gpu-timing.ts', import.meta.url));

function fixture({ supported = true } = {}) {
  let time = 0, serial = 0;
  const timers = new Map(), calls = [], queries = [];
  const controls = { disjoint: false, throwAt: '', pollCost: 0, nanos: 2e6, available: true };
  function call(name, ...args) {
    calls.push([name, ...args]);
    if (controls.throwAt === name) throw Error('simulated driver error');
  }
  const extension = {
    TIME_ELAPSED_EXT: 1, QUERY_RESULT_AVAILABLE_EXT: 2, QUERY_RESULT_EXT: 3, GPU_DISJOINT_EXT: 4,
    createQueryEXT() { call('create'); const q = { id: ++serial, available: controls.available, nanos: controls.nanos }; queries.push(q); return q; },
    beginQueryEXT(target, query) { call('begin', query.id); },
    endQueryEXT() { call('end'); },
    deleteQueryEXT(query) { call('delete', query.id); query.deleted = true; },
    getQueryObjectEXT(query, parameter) {
      if (parameter === this.QUERY_RESULT_AVAILABLE_EXT) { call('available', query.id); time += controls.pollCost; return query.available; }
      call('result', query.id); assert.equal(query.available, true, 'unavailable results must never be fetched');
      return query.nanos;
    },
  };
  const gl = {
    getExtension(name) { call('extension', name); return supported ? extension : null; },
    getParameter(name) { call('disjoint', name); return controls.disjoint; },
    finish() { assert.fail('GPU finish is forbidden'); }, flush() { assert.fail('GPU flush is forbidden'); },
    readPixels() { assert.fail('Pixel readback is forbidden'); },
  };
  const timer = createGpuDrawTimer(gl, {
    now: () => time,
    setInterval(callback, delay) { const id = ++serial; timers.set(id, { callback, delay, due: time + delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  return { timer, controls, queries, calls, timers,
    at(value) { time = value; },
    tick(value) {
      time = value;
      for (const [id, task] of [...timers]) if (timers.has(id) && task.due <= time) {
        task.due = time + task.delay; task.callback();
      }
    },
    frame(label = 'thinking', value = time) { time = value; const began = timer.beginFrame(label); timer.endFrame(); return began; },
  };
}

test('GPU diagnostics remain completely inert until explicitly started', () => {
  const f = fixture();
  assert.deepEqual(f.timer.snapshot(), {
    supported: false, active: false, pending: 0, reason: 'not-started', samples: 0,
    gpuMeanMs: 0, gpuP95Ms: 0, gpuMaxMs: 0, pollCpuMaxMs: 0,
    disjointCount: 0, timeoutCount: 0, phases: [],
  });
  assert.equal(f.frame(), false); f.timer.stop(); f.timer.dispose(); f.timer.start();
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});

test('unsupported contexts return an explicit result without polling or fallback synchronization', () => {
  const f = fixture({ supported: false });
  assert.deepEqual(f.timer.start(), { supported: false, active: false, reason: 'unsupported' });
  assert.equal(f.timers.size, 0); assert.equal(f.frame(), false);
  assert.deepEqual(f.calls, [['extension', 'EXT_disjoint_timer_query']]);
});

test('wall-time sampling and bounded polling collect only available results and fixed phase labels', () => {
  const f = fixture(); f.timer.start();
  assert.equal(f.frame('thinking', 0), true);
  assert.equal(f.frame('thinking', 499), false);
  f.tick(500); assert.equal(f.timer.snapshot().samples, 1);
  f.controls.nanos = 6e6; assert.equal(f.frame('idea', 500), true);
  f.tick(750);
  f.controls.nanos = 4e6; assert.equal(f.frame('untrusted-freeform-label', 1000), true);
  f.tick(1250);
  const before = f.calls.length, stats = f.timer.snapshot();
  assert.equal(f.calls.length, before, 'snapshot cannot touch GL');
  assert.equal(stats.samples, 3); assert.equal(stats.gpuMeanMs, 4); assert.equal(stats.gpuP95Ms, 6); assert.equal(stats.gpuMaxMs, 6);
  assert.deepEqual(stats.phases.map(p => [p.label, p.samples, p.gpuMeanMs]), [['thinking', 1, 2], ['idea', 1, 6], ['other', 1, 4]]);
  stats.phases[0].samples = 999;
  assert.equal(f.timer.snapshot().phases[0].samples, 1, 'snapshot does not expose mutable internal state');
  assert.equal(f.calls.filter(c => c[0] === 'result').length, 3);
  assert.equal(f.queries.every(q => q.deleted), true);
  f.timer.dispose();
});

test('pending queries never exceed four and unavailable results are never read', () => {
  const f = fixture(); f.controls.available = false; f.timer.start();
  for (let t = 0; t < 2000; t += 500) { assert.equal(f.frame('thinking', t), true); f.tick(t + 250); }
  assert.equal(f.frame('thinking', 2000), false);
  assert.equal(f.timer.snapshot().pending, 4); assert.equal(f.queries.length, 4);
  assert.equal(f.calls.some(c => c[0] === 'result' || c[0] === 'disjoint'), false);
  f.tick(3000);
  assert.equal(f.timer.snapshot().timeoutCount, 1); assert.equal(f.timer.snapshot().pending, 3);
  assert.equal(f.queries[0].deleted, true);
  assert.equal(f.frame('thinking', 3000), true);
  f.timer.stop(); assert.equal(f.timer.snapshot().reason, 'stopped');
  assert.equal(f.timer.snapshot().pending, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.queries.every(q => q.deleted), true);
});

test('disjoint events invalidate every pending result including those not yet available', () => {
  const f = fixture(); f.timer.start();
  f.frame('idle', 0); f.controls.available = false; f.frame('thinking', 500);
  f.controls.disjoint = true; f.tick(750);
  const stats = f.timer.snapshot();
  assert.equal(stats.disjointCount, 1); assert.equal(stats.samples, 0); assert.equal(stats.pending, 0);
  assert.equal(f.queries.every(q => q.deleted), true);
  assert.equal(f.calls.some(c => c[0] === 'result'), false);
  f.controls.disjoint = false; f.controls.available = true; f.frame('speaking', 1000); f.tick(1250);
  assert.equal(f.timer.snapshot().samples, 1); f.timer.dispose();
});

test('a capture stops issuing after fifteen seconds and drains for at most three more', () => {
  const f = fixture(); f.controls.available = false; f.timer.start(60000);
  f.frame('thinking', 14999); f.tick(15000);
  assert.equal(f.timer.snapshot().reason, 'draining'); assert.equal(f.timer.snapshot().active, true);
  assert.equal(f.frame('thinking', 15000), false);
  f.tick(18000);
  assert.equal(f.timer.snapshot().reason, 'completed'); assert.equal(f.timer.snapshot().active, false);
  assert.equal(f.timer.snapshot().timeoutCount, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.queries[0].deleted, true);
});

test('completed results drain without extending sampling and an empty capture clears its timer', () => {
  const f = fixture(); f.timer.start(500); f.frame('idle', 499); f.tick(500);
  assert.equal(f.timer.snapshot().samples, 1); assert.equal(f.timer.snapshot().reason, 'completed');
  assert.equal(f.timers.size, 0);
  f.timer.start(500); assert.equal(f.timer.snapshot().samples, 0);
  f.tick(1000); assert.equal(f.timer.snapshot().reason, 'completed'); assert.equal(f.timers.size, 0);
});

test('a slow availability poll stops observation immediately instead of creating continuing stutter', () => {
  const f = fixture(); f.controls.available = false; f.controls.pollCost = 9; f.timer.start();
  f.frame('thinking', 0); f.frame('thinking', 500); f.tick(750);
  assert.equal(f.timer.snapshot().reason, 'observer-overhead'); assert.equal(f.timer.snapshot().active, false);
  assert.equal(f.timer.snapshot().pollCpuMaxMs, 9); assert.equal(f.timer.snapshot().pending, 0);
  assert.equal(f.calls.filter(c => c[0] === 'available').length, 1, 'stop before checking the next query');
  assert.equal(f.timers.size, 0); assert.equal(f.queries.every(q => q.deleted), true);
});

test('stop/dispose close an in-progress query and tolerate redundant end calls', () => {
  for (const method of ['stop', 'dispose']) {
    const f = fixture(); f.timer.start(); assert.equal(f.timer.beginFrame('idea'), true);
    assert.equal(f.timer.beginFrame('idea'), false, 'never nest timer queries');
    f.timer[method](); f.timer.endFrame();
    assert.equal(f.calls.filter(c => c[0] === 'end').length, 1);
    assert.equal(f.queries.every(q => q.deleted), true); assert.equal(f.timers.size, 0);
  }
});

test('restarting a capture cleans previous queries and timers and resets statistics', () => {
  const f = fixture(); f.timer.start(); f.frame('idle', 0); f.tick(250);
  assert.equal(f.timer.snapshot().samples, 1);
  f.controls.available = false; f.frame('thinking', 500);
  const oldQuery = f.queries.at(-1);
  f.timer.start();
  assert.equal(oldQuery.deleted, true); assert.equal(f.timers.size, 1);
  assert.equal(f.timer.snapshot().samples, 0); assert.equal(f.timer.snapshot().pending, 0);
  f.controls.available = true; f.controls.nanos = Infinity; f.frame('idea', 500); f.tick(750);
  assert.equal(f.timer.snapshot().samples, 0, 'invalid driver results cannot poison summary numbers');
  f.timer.dispose();
});

test('driver failures are contained at creation, drawing, polling, and cleanup', () => {
  for (const operation of ['extension', 'create', 'begin', 'end', 'available', 'disjoint', 'result']) {
    const f = fixture(); f.controls.throwAt = operation;
    assert.doesNotThrow(() => { f.timer.start(); f.frame('thinking'); f.tick(250); });
    assert.equal(f.timer.snapshot().reason, 'timer-error', operation);
    assert.equal(f.timer.snapshot().active, false, operation); assert.equal(f.timers.size, 0, operation);
  }
  const f = fixture(); f.timer.start(); f.frame(); f.controls.throwAt = 'delete';
  assert.doesNotThrow(() => f.timer.stop()); assert.equal(f.timers.size, 0);
});

test('all default-duration results remain bounded and phase labels never grow with user input', () => {
  const f = fixture(); f.timer.start();
  for (let t = 0; t < 15000; t += 50) { f.frame(`label-${t}`, t); f.tick(t); }
  f.tick(15000);
  const stats = f.timer.snapshot();
  assert.equal(stats.active, false); assert.equal(stats.samples, 30); assert.ok(stats.samples <= 64);
  assert.equal(stats.phases.length, 1); assert.equal(stats.phases[0].label, 'other');
  assert.equal(f.timers.size, 0);
});
