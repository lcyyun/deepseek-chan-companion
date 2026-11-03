import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../server/service.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'l2d-render-diagnostics-'));
  const modelRoot = join(directory, 'model'); await mkdir(modelRoot);
  await writeFile(join(modelRoot, 'fixture.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 'fixture.moc3', Textures: [] } }));
  await writeFile(join(modelRoot, 'fixture.moc3'), 'test fixture, not a model');
  const service = await createService({ port: 0, dataDir: directory, modelRoot, ...options });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, init = {}) => fetch(service.url + path, { ...init, headers: {
    Authorization: `Bearer ${service.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers,
  } });
  return { service, request };
}

test('render diagnostics require pairing and preserve existing origin checks', async t => {
  const calls = [];
  const { service, request } = await fixture(t, { getRenderingDiagnostics: options => { calls.push(options); return { available: true }; } });
  const before = calls.length;
  assert.equal((await fetch(service.url + '/api/performance')).status, 401);
  assert.equal((await request('/api/performance', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await request('/api/performance', { headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal(calls.length, before, 'rejected requests never reach the host hook');
  assert.equal((await request('/api/performance', { method: 'POST' })).status, 405);
  assert.equal(calls.length, before, 'the endpoint is read-only');
});

test('state includes only the summary and the explicit performance endpoint requests history', async t => {
  const calls = [];
  const summary = { available: true, fps: 60, renderer: 'fixture GPU' };
  const history = [{ at: 100, fps: 5 }, { at: 200, fps: 60 }];
  const { service, request } = await fixture(t, { getRenderingDiagnostics: options => {
    calls.push(options); return { ...summary, ...(options.history ? { history } : {}) };
  } });
  const events = []; service.events.on('event', event => events.push(event));
  const settingsBefore = JSON.stringify(service.settings);
  assert.deepEqual(service.getState().rendering, summary);
  const state = await (await request('/api/state')).json();
  assert.deepEqual(state.rendering, summary);
  const response = await request('/api/performance');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ...summary, history });
  assert.deepEqual(calls.slice(-3), [{ history: false }, { history: false }, { history: true }]);
  assert.equal(JSON.stringify(service.settings), settingsBefore);
  assert.deepEqual(events, [], 'diagnostic reads do not start a broadcast or modify avatar state');
});

test('a service without an Electron diagnostics host returns null', async t => {
  const { service, request } = await fixture(t);
  assert.equal(service.getState().rendering, null);
  assert.equal((await (await request('/api/state')).json()).rendering, null);
  const response = await request('/api/performance');
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
});

test('a failed diagnostics host cannot break state, commands or chat', async t => {
  let chatCalls = 0;
  const { service, request } = await fixture(t, {
    getRenderingDiagnostics: () => { throw Error('private diagnostic failure detail'); },
    chatAdapters: { api: async () => { chatCalls++; return { segments: [{ text: '测试回复。', emotion: 'happy' }], details: '', sources: [] }; } },
  });
  assert.deepEqual(service.getState().rendering, { available: false });
  const diagnostic = await request('/api/performance');
  assert.equal(diagnostic.status, 200);
  assert.deepEqual(await diagnostic.json(), { available: false });
  service.dispatch({ type: 'state', state: 'thinking' });
  assert.equal(service.getState().state, 'thinking');
  assert.equal((await request('/api/settings', { method: 'PUT', body: JSON.stringify({ provider: 'api', model: 'fixture-model' }) })).status, 200);
  const reply = await request('/api/chat', { method: 'POST', body: JSON.stringify({ text: '诊断异常时的聊天测试' }) });
  assert.equal(reply.status, 200);
  assert.equal(chatCalls, 1);
  assert.equal((await reply.json()).segments[0].text, '测试回复。');
  const state = service.getState();
  assert.equal(state.busy, false);
  assert.deepEqual(state.rendering, { available: false });
  assert.doesNotMatch(JSON.stringify(state), /private diagnostic failure detail/);
});

test('an accidentally asynchronous diagnostics provider fails closed without rejecting state reads', async t => {
  const { service, request } = await fixture(t, { getRenderingDiagnostics: async () => { throw Error('async unavailable'); } });
  assert.deepEqual(service.getState().rendering, { available: false });
  assert.deepEqual(await (await request('/api/performance')).json(), { available: false });
  await new Promise(resolve => setImmediate(resolve));
});
