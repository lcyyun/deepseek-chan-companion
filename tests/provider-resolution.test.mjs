import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolveProvider } from '../server/provider-resolution.mjs';
import { createService } from '../server/service.mjs';
import { createSettingsStore } from '../server/settings.mjs';

const reply = provider => ({ provider, segments: [{ text: '配置正确，已经连接。', intent: 'greet', emotion: 'happy', gesture: 'none' }], details: '', sources: [] });
const connected = { connected: true, chatAvailable: true, everConnected: true };
const disconnected = { connected: false, chatAvailable: false, everConnected: true, reconnecting: true };
const auto = { provider: 'unconfigured', providerSource: 'auto' };
const waitFor = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw Error('Expected connection state did not arrive'); };

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'l2d-provider-route-'));
  const service = await createService({ port: 0, dataDir, ...options });
  t.after(async () => { await service.close(); await rm(dataDir, { recursive: true, force: true }); });
  const request = (path, value, method = 'POST') => fetch(service.url + path, { method: value === undefined ? 'GET' : method,
    headers: { Authorization: `Bearer ${service.token}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const settings = value => request('/api/settings', value, 'PUT').then(r => r.json());
  return { service, request, settings, dataDir };
}

async function bridge(t, service, extra = {}) {
  const socket = new WebSocket(service.url.replace('http', 'ws') + '/events', { headers: { Authorization: `Bearer ${service.token}` } });
  t.after(() => socket.terminate());
  const ready = new Promise(resolve => socket.on('message', raw => { if (JSON.parse(raw).type === 'bridge-ready') resolve(); }));
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'bridge-register', name: 'dsh', chat: true, sessionControllerAvailable: true, ...extra }));
  await ready;
  return socket;
}

test('provider matrix respects user choices, DSH-only auto, MCP-only blocking and sticky disconnect', () => {
  const cases = [
    [auto, {}, 'unconfigured', false, 'unconfigured'],
    [auto, { dsh: connected }, 'dsh', true, 'ready'],
    [auto, { performance: { connected: true, dshConnected: true } }, 'dsh', false, 'bridge-disabled'],
    [auto, { performance: { connected: true, dshConnected: false } }, 'unconfigured', false, 'unconfigured'],
    [auto, { dsh: disconnected }, 'dsh', false, 'disconnected'],
    [{ ...auto, autoProvider: 'dsh' }, {}, 'dsh', false, 'disconnected'],
    [auto, { dsh: { connected: true, chatAvailable: false } }, 'dsh', false, 'bridge-disabled'],
    [{ provider: 'codex', providerSource: 'user' }, { dsh: connected }, 'codex', true, 'ready'],
    [{ provider: 'api', providerSource: 'user', baseUrl: 'https://example.com', model: 'test' }, { dsh: connected }, 'api', true, 'ready'],
    [{ provider: 'api', providerSource: 'user' }, {}, 'api', false, 'not-configured'],
    [{ provider: 'dsh', providerSource: 'user' }, {}, 'dsh', false, 'disconnected'],
    [{ provider: 'unconfigured', providerSource: 'user' }, { dsh: connected }, 'unconfigured', false, 'unconfigured'],
  ];
  for (const [settings, connections, providerEffective, chatAvailable, chatStatus] of cases) {
    const resolved = resolveProvider(settings, connections);
    assert.deepEqual([resolved.providerEffective, resolved.chatAvailable, resolved.chatStatus], [providerEffective, chatAvailable, chatStatus]);
    if (providerEffective !== 'codex') assert.doesNotMatch(resolved.chatMessage, /Codex|CLI|登录/);
  }
});

test('choice provenance survives ordinary saves and legacy migration; auto memory cannot overwrite a user', async t => {
  const root = await mkdtemp(join(tmpdir(), 'l2d-provider-provenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fresh = await createSettingsStore({ dataDir: join(root, 'fresh') });
  assert.equal(fresh.get().providerSource, 'auto');
  await fresh.rememberAutoProvider('dsh');
  await fresh.update({ provider: 'unconfigured', providerSource: 'auto', verbosity: 'balanced' });
  assert.equal(fresh.get().autoProvider, 'dsh');
  assert.equal(fresh.get().providerSource, 'auto');
  await fresh.update({ provider: 'codex' });
  await fresh.rememberAutoProvider('dsh');
  assert.equal(fresh.get().providerSource, 'user');
  assert.equal(fresh.get().provider, 'codex');
  const restored = await createSettingsStore({ dataDir: join(root, 'fresh') });
  assert.equal(restored.get().providerSource, 'user');
  assert.equal(restored.get().provider, 'codex');
  for (const provider of ['codex', 'api', 'dsh', 'unconfigured']) {
    const dataDir = join(root, provider); await mkdir(dataDir);
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ settings: { provider } }));
    const old = await createSettingsStore({ dataDir });
    assert.equal(old.get().providerSource, provider === 'unconfigured' ? 'auto' : 'user');
  }
});

test('real MCP activity and state heartbeat are separate; DSH MCP alone cannot start chat', async t => {
  let codexCalls = 0;
  const { service, request, settings } = await fixture(t, { connectionLeaseMs: 150, chatAdapters: { codex: () => { codexCalls++; return reply('codex'); } } });
  await request('/api/bridge/event', { source: 'dsh' });
  assert.equal(service.getState().performance.connected, false, 'An events heartbeat is not an MCP connection');
  const client = new Client({ name: 'deepseek-harness', version: '0.2.1-rc.2' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(service.url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${service.token}` } } }));
  const state = service.getState();
  assert.equal(state.performance.connected, true);
  assert.equal(state.performance.dshConnected, true);
  assert.equal(state.providerEffective, 'dsh');
  assert.equal(state.chatAvailable, false);
  assert.equal(state.chatStatus, 'bridge-disabled');
  assert.match(state.chatMessage, /chat: true/);
  const denied = await request('/api/chat', { text: '不能错误启动 Codex' });
  const error = await denied.json();
  assert.equal(denied.status, 409); assert.equal(error.code, 'DSH_CHAT_NOT_CONNECTED');
  assert.doesNotMatch(error.error, /Codex|CLI|登录/); assert.equal(codexCalls, 0);
  assert.equal(service.getState().busy, false);
  assert.equal(service.getState().latestReply, null);
  const visible = await settings();
  assert.equal(visible.performance.connected, true);
  let expired = false;
  service.events.on('state', event => { if (!event.state.performance.active) expired = true; });
  await waitFor(() => expired);
  assert.equal(service.getState().performance.connected, true, 'Idle registration is not a disconnected MCP transport');
  assert.equal(service.getState().performance.status, 'idle');
  assert.equal(service.getState().performance.registered, true, 'A known MCP client stays registered while idle');
  assert.equal(service.getState().performance.active, false);
  await client.callTool({ name: 'avatar_state', arguments: {} });
  assert.equal(service.getState().performance.dshConnected, true, 'Known-client tool activity refreshes its lease');
});

test('native avatar_reply emits one atomic performance plan', async t => {
  const { service } = await fixture(t);
  const client = new Client({ name: 'native-pet', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(service.url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${service.token}` } } }));
  let event;
  service.events.on('chat', value => { event = value; });
  const response = await client.callTool({ name: 'avatar_reply', arguments: { segments: [
    { text: '第一段。', intent: 'agree', emotion: 'happy', gesture: 'none', bodyAnimation: 'auto', combination: 'agree' },
    { text: '第二段。', intent: 'explain', emotion: 'gentle', gesture: 'none', bodyAnimation: 'talk', combination: 'none' },
  ], details: '完整说明' } });
  const accepted = JSON.parse(response.content[0].text);
  assert.equal(accepted.accepted, true);
  assert.equal(event.nativeTool, true);
  assert.equal(event.reply.nativeTool, true);
  assert.equal(event.reply.segments.length, 2);
  assert.equal(event.reply.segments[1].bodyAnimation, 'talk');
  assert.equal(event.reply.details, '完整说明');
  await client.callTool({ name: 'avatar_reply', arguments: { segments: [
    { text: '先害羞地抚胸。', emotion: 'shy', gesture: 'chest', combination: 'shy', expressionCues: [{ at: 0, emotion: 'shy', intensity: 0.8 }] },
  ] } });
  assert.equal(event.reply.segments[0].combination, 'reassure', 'An explicit chest gesture must not become a face-only shy opening');
});

test('DSH bridge thinking updates status without inventing a chat command or request id', async t => {
  const { service, request } = await fixture(t);
  const emitted = [];
  service.events.on('event', event => emitted.push(event));
  const response = await request('/api/bridge/event', { source: 'dsh', state: 'thinking' });
  assert.equal(response.status, 200);
  assert.equal(service.getState().state, 'thinking');
  assert.equal(service.getState().requestId, null);
  assert.equal(emitted.some(event => event.type === 'command'), false, 'Bridge status must not emit a command with a new id');
  assert.equal(emitted.some(event => event.type === 'state' && event.state.state === 'thinking'), true);
});

test('fresh DSH chat bridge automatically routes to DSH, reconnects and retains its route after restart', async t => {
  const calls = [];
  const { service, request, settings, dataDir } = await fixture(t, { chatAdapters: {
    codex: () => assert.fail('Auto must never invoke Codex'),
    dsh: async options => { calls.push(options.settings.provider); return reply('dsh'); },
  } });
  const socket = await bridge(t, service);
  assert.equal(service.getState().providerSource, 'auto');
  assert.equal(service.getState().providerEffective, 'dsh');
  assert.equal(service.getState().chatAvailable, true);
  assert.equal(service.getState().performance.connected, false, 'Chat bridge is not an MCP connection');
  assert.equal((await request('/api/chat', { text: '你好' })).status, 200);
  assert.deepEqual(calls, ['dsh']);
  await waitFor(() => service.settings.autoProvider === 'dsh');
  socket.close(); await waitFor(() => !service.getState().dsh.connected);
  assert.equal(service.getState().providerEffective, 'dsh');
  assert.equal(service.getState().chatAvailable, false);
  const denied = await request('/api/chat', { text: '断线后不能降级' });
  assert.equal((await denied.json()).code, 'DSH_BRIDGE_DISCONNECTED');
  const reconnected = await bridge(t, service);
  assert.equal((await settings()).chatAvailable, true);
  assert.equal((await request('/api/chat', { text: '恢复' })).status, 200);
  reconnected.close(); await waitFor(() => !service.getState().dsh.connected);
  await service.close();
  const restarted = await createService({ port: 0, dataDir });
  t.after(() => restarted.close());
  assert.equal(restarted.getState().providerEffective, 'dsh');
  assert.equal(restarted.getState().providerSource, 'auto');
  assert.equal(restarted.getState().chatAvailable, false);
});

test('explicit providers remain selected when a DSH bridge appears or leaves', async t => {
  for (const selected of ['codex', 'api', 'dsh', 'unconfigured']) {
    const current = await fixture(t);
    await current.settings({ provider: selected, baseUrl: 'https://example.com', model: 'test' });
    const socket = await bridge(t, current.service);
    assert.equal(current.service.getState().providerEffective, selected);
    assert.equal(current.service.getState().providerSource, 'user');
    socket.close(); await waitFor(() => !current.service.getState().dsh.connected);
    assert.equal(current.service.getState().providerEffective, selected);
    assert.equal(current.service.settings.provider, selected);
  }
});

test('provider changes cancel the old request and DSH cannot return Codex errors or diagnostics', async t => {
  let begin;
  const started = new Promise(resolve => { begin = resolve; });
  const { service, request, settings } = await fixture(t, { chatAdapters: {
    codex: async ({ signal }) => { begin(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })); },
    dsh: async () => { throw Object.assign(Error('Codex 登录错误，不能泄漏到 DSH'), { code: 'CODEX_EXEC_FAILED', status: 502, diagnostic: 'private diagnostic' }); },
  } });
  await settings({ provider: 'codex' });
  const running = request('/api/chat', { text: '旧提供方请求' });
  await started;
  await bridge(t, service);
  await settings({ provider: 'dsh' });
  assert.equal((await running).status, 499);
  const dshError = await (await request('/api/chat', { text: '新提供方' })).json();
  assert.equal(dshError.provider, 'dsh'); assert.equal(dshError.code, 'DSH_CHAT_FAILED');
  assert.equal(dshError.diagnostic, undefined); assert.doesNotMatch(dshError.error, /Codex|CLI|登录/);
});

test('Codex HTTP errors expose only the adapter safe diagnostic and exit code in explicit Codex mode', async t => {
  const { request, settings } = await fixture(t, { chatAdapters: { codex: async () => {
    throw Object.assign(Error('Codex 初始化失败：拒绝访问。'), { code: 'CODEX_EXEC_FAILED', status: 502, exitCode: 1, diagnostic: '初始化失败；拒绝访问；OS 错误 5' });
  } } });
  await settings({ provider: 'codex' });
  const response = await request('/api/chat', { text: '验证诊断' });
  const body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.provider, 'codex');
  assert.equal(body.exitCode, 1); assert.match(body.diagnostic, /OS 错误 5/);
});
