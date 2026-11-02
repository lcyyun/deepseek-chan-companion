import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createService } from '../server/service.mjs';
import { createDshManager } from '../server/dsh-manager.mjs';
import { attachChatBridge } from '../integrations/dsh/live2d-bridge.mjs';
import { registeredAvatarTools, probeCompanionMcp } from '../integrations/dsh/recovery-tools.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 6000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await pause(15); } throw Error('Recovery state did not arrive'); }
const toolNames = ['mcp__live2d__avatar_capabilities', 'mcp__live2d__avatar_reply', 'mcp__live2d__avatar_speak'];
function host(definitions = () => toolNames.map(name => ({ name }))) {
  const cleanup = [], calls = [];
  const ctx = { tools: { schemas: definitions, guard() {} }, on() {}, effect(fn) { cleanup.push(fn()); },
    sessionController: { create() { calls.push('create'); throw Error('Recovery must not create sessions'); }, prompt() { calls.push('prompt'); }, cancel() { calls.push('cancel'); } } };
  return { ctx, calls, dispose: () => cleanup.forEach(fn => fn?.()) };
}

test('pet restart restores actual MCP discovery and native-tool readiness without DSH restart or model turns', { timeout: 12000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'l2d-recovery-'));
  let service = await createService({ port: 0, dataDir: root, connectionLeaseMs: 80 });
  const baseUrl = service.url, token = service.token, port = Number(new URL(baseUrl).port);
  const sessionFile = join(root, 'chat-session.txt'); await writeFile(sessionFile, 'session-existing-fixture');
  const app = host();
  t.after(async () => { app.dispose(); await service.close(); await rm(root, { recursive: true, force: true }); });
  attachChatBridge(app.ctx, { baseUrl, token, sessionFile, native: true, hostPort: 63616, installationId: 'fixture-installation' });
  await until(() => service.getState().dsh.toolsReady);
  const initial = service.getState();
  assert.equal(initial.dsh.sessionId, 'session-existing-fixture');
  assert.equal(initial.dsh.host.installationId, 'fixture-installation');
  assert.equal(initial.dsh.host.port, 63616);
  assert.equal(initial.dsh.host.homeFingerprint.length, 64);
  assert.equal(initial.lastCommand, null);
  await pause(130);
  assert.equal(service.getState().performance.active, false);
  assert.equal(service.getState().performance.connected, true);
  assert.ok(service.getState().performance.lastSeen);
  const oldInstance = initial.instanceId, bridgeId = initial.dsh.host.bridgeId;
  await service.close();
  service = await createService({ port, dataDir: root });
  assert.equal(service.token, token);
  await until(() => service.getState().dsh.toolsReady);
  assert.notEqual(service.getState().instanceId, oldInstance);
  assert.equal(service.getState().dsh.host.bridgeId, bridgeId);
  assert.equal(service.getState().dsh.sessionId, 'session-existing-fixture');
  assert.equal((await readFile(sessionFile, 'utf8')), 'session-existing-fixture');
  const checked = await service.requestDshRecovery();
  assert.equal(checked.ok, true); assert.equal(checked.mcpReachable, true); assert.equal(checked.nativeToolsReady, true);
  assert.equal(service.getState().lastCommand, null); assert.equal(service.getState().latestReply, null);
  assert.deepEqual(app.calls, []);
});

test('startup tool registration is rechecked promptly and does not masquerade as ready when unknown', { timeout: 7000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'l2d-recovery-registry-'));
  const service = await createService({ port: 0, dataDir: root });
  let registered = false;
  const app = host(() => registered ? toolNames.map(name => ({ name })) : []);
  t.after(async () => { app.dispose(); await service.close(); await rm(root, { recursive: true, force: true }); });
  attachChatBridge(app.ctx, { baseUrl: service.url, token: service.token, native: true });
  await until(() => service.getState().dsh.connected);
  assert.equal(service.getState().dsh.toolsReady, false);
  const started = Date.now(); registered = true;
  await until(() => service.getState().dsh.toolsReady);
  assert.ok(Date.now() - started < 4000, 'does not wait for the 20-second heartbeat');
  assert.deepEqual(app.calls, []);
  assert.equal(await registeredAvatarTools({ tools: {}, get() { throw Error('optional service absent'); } }, 'session-cold'), null);
  assert.equal(await registeredAvatarTools({ tools: { schemas: () => [] } }), null);
  assert.equal(await registeredAvatarTools({ agents: { get: () => ({ id: 'owned' }) }, tools: { schemas: () => [] } }, 'owned'), false);
});

test('reconnect rereads the pairing file rather than persisting a bad credential in memory', { timeout: 8000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'l2d-recovery-token-'));
  const service = await createService({ port: 0, dataDir: root });
  const tokenFile = join(root, 'bridge-credential'); await writeFile(tokenFile, 'invalid-fixture');
  const app = host();
  t.after(async () => { app.dispose(); await service.close(); await rm(root, { recursive: true, force: true }); });
  attachChatBridge(app.ctx, { baseUrl: service.url, tokenFile, native: true });
  await pause(250); assert.equal(service.getState().dsh.connected, false);
  await writeFile(tokenFile, service.token);
  await until(() => service.getState().dsh.toolsReady);
  assert.deepEqual(app.calls, []);
});

const socket = () => ({ readyState: 1, sent: [], send(value) { this.sent.push(JSON.parse(value)); } });
test('manual recovery coalesces, rejects stale instance/socket proofs, times out safely and preserves legacy chat', async () => {
  const manager = createDshManager(() => {}, { instanceId: 'instance-fixture' });
  const legacy = socket(); manager.register(legacy, { chat: true });
  const old = await manager.requestRecovery(); assert.equal(old.requiresUpgrade, true); assert.equal(old.chatAvailable, true);
  assert.equal(legacy.sent.some(value => value.type === 'bridge-recovery-request'), false);
  manager.disconnected(legacy);
  const current = socket(); manager.register(current, { chat: true, recoveryProtocol: 1, host: { pid: -10, homeFingerprint: 'secret-invalid-path' } });
  const first = manager.requestRecovery({ timeoutMs: 100 });
  assert.equal(first, manager.requestRecovery());
  const request = current.sent.find(value => value.type === 'bridge-recovery-request');
  const proof = { type: 'bridge-recovery', instanceId: 'instance-fixture', requestId: request.requestId, mcpReachable: true, nativeToolsReady: true };
  manager.result(legacy, proof); manager.result(current, { ...proof, instanceId: 'old-instance' });
  assert.equal(manager.state().toolsReady, false);
  manager.result(current, proof);
  assert.equal((await first).ok, true);
  manager.result(current, { type: 'bridge-health', instanceId: 'instance-fixture' });
  assert.equal(manager.state().nativeToolsReady, true, 'omitted field preserves old bridge compatibility');
  manager.result(current, { type: 'bridge-health', instanceId: 'instance-fixture', nativeToolsReady: null });
  assert.equal(manager.state().nativeToolsReady, null, 'a failed registry query cannot retain stale positive evidence');
  assert.equal(manager.state().toolsReady, false); assert.equal(manager.state().recoveryStatus, 'partial');
  assert.equal(manager.state().host.pid, null); assert.equal(manager.state().host.homeFingerprint, '');
  const timed = manager.requestRecovery({ timeoutMs: 100 });
  await pause(140); assert.equal((await timed).timedOut, true);
  const pending = manager.requestRecovery(); manager.disconnected(current);
  assert.equal((await pending).connected, false);
});

test('read-only MCP discovery has a hard deadline against a nonresponsive endpoint', { timeout: 3000 }, async t => {
  const server = createServer((_req, _res) => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const result = await probeCompanionMcp({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'fixture', timeoutMs: 80 });
  assert.equal(result.mcpReachable, false); assert.equal(result.recoveryError, 'MCP_DISCOVERY_TIMEOUT');
});
