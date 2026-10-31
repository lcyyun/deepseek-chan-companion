// Exercise the production HTTP -> authenticated WebSocket -> behavior -> asset lookup path.
// Only the WebGL/audio boundary is replaced; events and controller code are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createService } from '../server/index.mjs';
import { BehaviorController } from '../src/shared/behavior.mjs';
import { buildAssetLookup, resolveAssetFile } from '../src/shared/model-assets.mjs';

const MOTIONS = [
  '竖手指切出来动画', '竖手指切回默认', '默认手切举手',
  '举手切默认手', '狗尾草切换出来', '狗尾草切回默认手',
];
const EXPRESSIONS = ['脸红', '屑屑眼', '流冷汗', '加载'];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'l2d-production-events-'));
  const modelRoot = join(root, 'model');
  await mkdir(join(modelRoot, 'Animation'), { recursive: true });
  await mkdir(join(modelRoot, 'Exp3'), { recursive: true });
  await writeFile(join(modelRoot, '大肥鱼.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 'model.moc3', Textures: [] } }));
  await writeFile(join(modelRoot, 'model.moc3'), 'fixture');
  for (const name of MOTIONS) await writeFile(join(modelRoot, 'Animation', `${name}.motion3.json`), JSON.stringify({ fixture: name }));
  for (const name of EXPRESSIONS) await writeFile(join(modelRoot, 'Exp3', `${name}.exp3.json`), JSON.stringify({ fixture: name }));
  const service = await createService({ port: 0, modelRoot, dataDir: join(root, 'data') });
  const request = (path, data) => fetch(service.url + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const manifest = await (await request('/api/model-manifest')).json();
  const motionLookup = buildAssetLookup(manifest.motions, '.motion3.json');
  const expressionLookup = buildAssetLookup(manifest.expressions, '.exp3.json');
  const assetCalls = [], pendingLoads = new Set(), errors = [], wire = [];
  function load(lookup, kind, name, active = true) {
    const file = resolveAssetFile(lookup, name);
    if (!file) throw new Error(`Unresolved ${kind}: ${name}`);
    const work = request('/model/' + file.split('/').map(encodeURIComponent).join('/')).then(async response => {
      assert.equal(response.status, 200);
      const document = await response.json();
      assetCalls.push({ kind, file, active, asset: document.fixture });
    });
    pendingLoads.add(work);
    work.then(() => pendingLoads.delete(work), () => pendingLoads.delete(work));
    return work;
  }
  const runtime = {
    parameters: {},
    setParameters(values) { Object.assign(this.parameters, values); },
    playMotion(name) { return load(motionLookup, 'motion', name); },
    setExpression(name, active) { return load(expressionLookup, 'expression', name, active); },
    stopMotion() {},
    reset() {},
  };
  const behavior = new BehaviorController(runtime, {
    random: () => 0.65,
    onEvent(event) { if (event.type === 'error') errors.push(event); },
  });
  const ws = new WebSocket(service.url.replace('http:', 'ws:') + '/events');
  const ready = new Promise(resolve => ws.on('message', raw => {
    const event = JSON.parse(raw);
    wire.push(event);
    // The renderer uses this same dispatch for regular command/state events.
    if (event.type === 'command') behavior.applyCommand(event.command);
    if (event.type === 'state') { behavior.setState(event.state.state); resolve(); }
  }));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'auth', token: service.token }));
  await ready;
  t.after(async () => {
    behavior.destroy();
    await Promise.allSettled([...pendingLoads]);
    ws.terminate(); await service.close();
    await rm(root, { recursive: true, force: true });
  });
  async function command(input) {
    const id = `qa-${wire.length}`;
    const delivered = new Promise(resolve => {
      const listener = raw => {
        const event = JSON.parse(raw);
        if (event.type === 'state' && event.state.lastCommand?.id === id) { ws.off('message', listener); resolve(); }
      };
      ws.on('message', listener);
    });
    const response = await request('/api/command', { ...input, id });
    assert.equal(response.status, 202);
    await delivered;
    return id;
  }
  const advance = seconds => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) behavior.update(1 / 60); };
  const flush = async () => { await Promise.all([...pendingLoads]); assert.deepEqual(errors, []); };
  return { manifest, behavior, runtime, assetCalls, wire, command, advance, flush };
}

test('production command/state events preserve visible preset assets from the real manifest shape', async t => {
  const f = await fixture(t);
  assert.ok(f.manifest.motions.some(asset => asset.name === '竖手指切出来动画' && asset.file.endsWith('.motion3.json')));
  const cases = [
    [{ intent: 'explain', gesture: 'pointer' }, '竖手指切出来动画'],
    [{ intent: 'reassure', gesture: 'chest' }, '默认手切举手'],
    [{ intent: 'playful', gesture: 'foxtail' }, '狗尾草切换出来'],
    [{ intent: 'shy', emotion: 'shy' }, '脸红'],
  ];
  for (const [input, expectedAsset] of cases) {
    await f.command({ type: 'reset' }); f.advance(1.5);
    const start = f.assetCalls.length;
    const id = await f.command({ type: 'perform', durationMs: 4500, ...input });
    f.advance(0.5); await f.flush();
    assert.ok(f.assetCalls.slice(start).some(call => call.asset === expectedAsset && call.active), expectedAsset);
    const events = f.wire.filter(event => event.command?.id === id || event.state?.lastCommand?.id === id);
    assert.deepEqual(events.map(event => event.type), ['command', 'state']);
    assert.equal(events[1].state.state, 'idle');
    assert.equal(f.assetCalls.slice(start).some(call => call.asset === expectedAsset && call.active === false), false);
  }
});

test('real thinking/stop events load the thought expression and prevent later stale thoughts', async t => {
  const f = await fixture(t);
  await f.command({ type: 'state', state: 'thinking' });
  f.advance(2.6); await f.flush();
  assert.ok(f.assetCalls.some(call => call.asset === '加载' && call.active));
  await f.command({ type: 'stop' }); await f.flush();
  assert.ok(f.assetCalls.some(call => call.asset === '加载' && call.active === false));
  const count = f.assetCalls.length;
  f.advance(30); await f.flush();
  assert.equal(f.assetCalls.length, count);
  assert.equal(f.runtime.parameters.ParamMouthOpenY, 0);
});

test('state changes do not erase an explicit gesture before its deadline', async t => {
  const f = await fixture(t);
  await f.command({ type: 'state', state: 'listening' });
  await f.command({ type: 'perform', gesture: 'pointer', durationMs: 4500 });
  f.advance(0.3); await f.flush();
  await f.command({ type: 'state', state: 'idle' });
  f.advance(0.5); await f.flush();
  assert.equal(f.assetCalls.some(call => call.asset === '竖手指切回默认'), false);
  f.advance(4); await f.flush();
  assert.ok(f.assetCalls.some(call => call.asset === '竖手指切回默认'));
});
