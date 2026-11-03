import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { codexFailureDetails } from '../server/codex-diagnostics.mjs';
import { codexChat } from '../server/adapters.mjs';
import { createDshManager } from '../server/dsh-manager.mjs';
import { dshFailureCode, dshWireFailure } from '../integrations/dsh/chat-errors.mjs';
import { attachChatBridge } from '../integrations/dsh/live2d-bridge.mjs';

test('Codex permission/init stderr becomes a bounded safe cause with exit code, not a login diagnosis', () => {
  const secret = 'secret-fixture-value';
  const raw = `WARNING: failed to clean up stale arg0 temp dirs C:\\Users\\Private\\.codex: 拒绝访问。 (os error 5)\nAuthorization: Bearer ${secret}\nError: failed to initialize in-process app-server client: 拒绝访问。 (os error 5)`;
  const result = codexFailureDetails(raw, 1);
  assert.equal(result.code, 'CODEX_PERMISSION_DENIED');
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /初始化.*拒绝访问/);
  assert.match(result.diagnostic, /临时目录清理失败/);
  assert.match(result.diagnostic, /OS错误号 5/);
  assert.doesNotMatch(JSON.stringify(result), /secret-fixture-value|Users|Private|Authorization|登录/);
  assert.ok(result.diagnostic.length < 200);
});

test('unknown Codex exits preserve exit information without guessing failed authentication', () => {
  const unknown = codexFailureDetails('Unrecognized problem with a user-specific secret', 2147483651, 'SIGABRT');
  assert.equal(unknown.code, 'CODEX_EXEC_FAILED');
  assert.match(unknown.message, /2147483651/);
  assert.match(unknown.diagnostic, /SIGABRT/);
  assert.doesNotMatch(unknown.message, /登录/);
  assert.equal(codexFailureDetails('401 unauthorized').code, 'CODEX_AUTH_REQUIRED');
  assert.equal(codexFailureDetails('failed to initialize app-server').code, 'CODEX_INIT_FAILED');
});

test('actual Codex adapter consumes stderr through its mocked child and exposes only safe diagnostics', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'codex-diagnostic-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.stdin.once('finish', () => queueMicrotask(() => {
    child.stderr.write('Error: failed to initialize in-process app-server client: Permission denied (os error 5)\nsecret-fixture-token');
    child.emit('close', 1, null);
  }));
  await assert.rejects(codexChat({ dataDir, settings: { codexCommand: 'fixture.exe', codexModel: 'fixture-model', webSearch: false, verbosity: 'brief' },
    request: { text: 'hello' }, history: [], spawnImpl: (_command, args, options) => {
      assert.ok(args.includes('--sandbox')); assert.equal(options.shell, false); return child;
    } }), error => {
      assert.equal(error.code, 'CODEX_PERMISSION_DENIED'); assert.equal(error.provider, 'codex');
      assert.equal(error.exitCode, 1); assert.match(error.diagnostic, /初始化/);
      assert.doesNotMatch(JSON.stringify(error), /secret-fixture-token|登录/); return true;
    });
});

function bridgeSocket() { return { readyState: 1, sent: [], send(text) { this.sent.push(JSON.parse(text)); } }; }
const chatArgs = () => ({ settings: { webSearch: false, verbosity: 'brief' }, request: { text: '你好' }, history: [] });

test('DSH availability requires a capable chat bridge and retains disconnect/reconnect identity', async () => {
  const manager = createDshManager();
  assert.equal(manager.state().connected, false); assert.equal(manager.state().chatAvailable, false);
  assert.equal(manager.state().everConnected, false); assert.equal(manager.state().reconnecting, false);
  assert.equal(manager.state().sessionId, ''); assert.equal(manager.state().searchAvailable, false);
  assert.equal(manager.state().recoveryStatus, 'disconnected'); assert.equal(manager.state().toolsReady, false);
  const unsupported = bridgeSocket(); manager.register(unsupported, { chat: true, sessionControllerAvailable: false });
  assert.equal(manager.state().connected, true); assert.equal(manager.state().chatAvailable, false);
  assert.throws(() => manager.chat(chatArgs()), { code: 'DSH_CHAT_NOT_CONNECTED' });
  manager.disconnected(unsupported);
  const active = bridgeSocket(); manager.register(active, { chat: true, sessionControllerAvailable: true, sessionId: 'owned' });
  assert.equal(manager.state().chatAvailable, true);
  const reply = manager.chat(chatArgs());
  manager.disconnected(active);
  await assert.rejects(reply, { code: 'DSH_BRIDGE_DISCONNECTED', provider: 'dsh' });
  assert.equal(manager.state().sessionId, 'owned'); assert.equal(manager.state().reconnecting, true);
  const restored = bridgeSocket(); manager.register(restored, { chat: true, sessionId: 'owned' });
  assert.equal(manager.state().chatAvailable, true); assert.equal(manager.state().reconnecting, false);
});

test('DSH maps model credentials and cancellation, rejects injected Codex errors and raw logs', async () => {
  for (const [wireCode, expected] of [['MISSING_CREDENTIAL', 'DSH_MODEL_NOT_CONFIGURED'], ['DSH_TURN_CANCELLED', 'DSH_TURN_CANCELLED'], ['CODEX_EXEC_FAILED', 'DSH_CHAT_FAILED']]) {
    const manager = createDshManager(), socket = bridgeSocket(); manager.register(socket, { chat: true });
    const response = manager.chat(chatArgs());
    const requestId = socket.sent.find(item => item.type === 'chat-request').requestId;
    manager.result(socket, { type: 'chat-result', requestId, error: 'Codex login failed; secret-fixture-key', code: wireCode });
    await assert.rejects(response, error => {
      assert.equal(error.code, expected); assert.equal(error.provider, 'dsh');
      assert.doesNotMatch(error.message, /Codex|CLI|secret-fixture-key/i); return true;
    });
  }
});

test('DSH explicit abort uses the DSH cancellation code and cannot affect a future request', async () => {
  const manager = createDshManager(), socket = bridgeSocket(), controller = new AbortController();
  manager.register(socket, { chat: true });
  const response = manager.chat({ ...chatArgs(), signal: controller.signal });
  controller.abort();
  await assert.rejects(response, { code: 'DSH_TURN_CANCELLED', status: 499 });
  assert.equal(socket.sent.at(-1).type, 'chat-cancel');
});

test('host DSH errors are classified without carrying raw content over the bridge', () => {
  assert.equal(dshFailureCode({ code: 'MISSING_CREDENTIAL', message: 'private details' }), 'DSH_MODEL_NOT_CONFIGURED');
  assert.equal(dshFailureCode({ reason: { error: { code: 'MODEL_NOT_CONFIGURED' } } }), 'DSH_MODEL_NOT_CONFIGURED');
  assert.equal(dshFailureCode({ kind: 'aborted' }), 'DSH_TURN_CANCELLED');
  assert.deepEqual(dshWireFailure({ code: 'CODEX_EXEC_FAILED', message: 'Codex login; secret-fixture-key' }), { error: 'DSH request failed', code: 'DSH_CHAT_FAILED' });
});

test('production DSH plugin advertises Session Controller availability and propagates a safe model error', { timeout: 5000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const home = await mkdtemp(join(tmpdir(), 'dsh-error-test-')), disposers = [];
  let resolveResult; const finished = new Promise(resolve => { resolveResult = resolve; });
  t.after(async () => { disposers.forEach(dispose => dispose()); for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  server.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'auth') socket.send(JSON.stringify({ type: 'auth', ok: true }));
    if (message.type === 'bridge-register') {
      assert.equal(message.chat, true); assert.equal(message.sessionControllerAvailable, true);
      socket.send(JSON.stringify({ type: 'chat-request', requestId: 'fixture-turn', messages: [{ role: 'user', content: 'test' }] }));
    }
    if (message.type === 'chat-result') resolveResult(message);
  }));
  attachChatBridge({ on() {}, effect: fn => disposers.push(fn()), tools: { definitions: () => [], guard() {} },
    systemPrompt: { section() {} },
    sessionController: { create: async () => ({ sessionId: 'owned' }), prompt: async () => { throw Object.assign(new Error('api_key=secret-fixture-key'), { code: 'MISSING_CREDENTIAL' }); }, cancel: async () => {} } },
  { baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token', chatCwd: home });
  const reply = await finished;
  assert.equal(reply.code, 'DSH_MODEL_NOT_CONFIGURED');
  assert.doesNotMatch(JSON.stringify(reply), /secret-fixture-key|api_key|Codex/);
});
