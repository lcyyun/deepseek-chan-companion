import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { resolveCompanionChatCwd } from '../integrations/dsh/home-paths.mjs';
import { attachChatBridge } from '../integrations/dsh/live2d-bridge.mjs';

test('DSH home paths honor override precedence, spaces, Unicode and relative roots', () => {
  const cwd = resolve('fixture-launch'), home = resolve('fixture-user');
  const options = { cwd, home, env: { DSH_HOME: '隔离 profile/home' } };
  assert.equal(resolveCompanionChatCwd({}, options), join(cwd, '隔离 profile/home/live2d-companion'));
  assert.equal(resolveCompanionChatCwd({ dshHome: 'explicit-home' }, options), join(cwd, 'explicit-home/live2d-companion'));
  assert.equal(resolveCompanionChatCwd({ dshHome: 'unused', chatCwd: 'my chat' }, options), join(cwd, 'my chat'));
  assert.equal(resolveCompanionChatCwd({}, { ...options, env: {} }), join(home, '.dsh/live2d-companion'));
  assert.equal(resolveCompanionChatCwd({}, { ...options, env: { DSH_HOME: '   ' } }), join(home, '.dsh/live2d-companion'));
});

test('home paths expand only current-user tilde prefixes and do not evaluate shell text', () => {
  const options = { cwd: resolve('fixture-launch'), home: resolve('fixture-user'), env: {} };
  for (const prefix of ['~/', '~\\']) {
    assert.equal(resolveCompanionChatCwd({ dshHome: `${prefix}isolated` }, options), join(options.home, 'isolated/live2d-companion'));
    assert.equal(resolveCompanionChatCwd({ chatCwd: `${prefix}chat` }, options), join(options.home, 'chat'));
  }
  assert.equal(resolveCompanionChatCwd({ dshHome: '~' }, options), join(options.home, 'live2d-companion'));
  assert.equal(resolveCompanionChatCwd({ dshHome: '~someone' }, options), join(options.cwd, '~someone/live2d-companion'));
  assert.equal(resolveCompanionChatCwd({ chatCwd: '${HOME}/chat' }, options), join(options.cwd, '${HOME}/chat'));
  assert.throws(() => resolveCompanionChatCwd({ chatCwd: 12 }, options), /path string/);
});

async function bridgeFixture(t, config, envHome) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const events = new EventEmitter(), disposers = [], created = [], prompts = [];
  let socket, ready, result;
  const registered = new Promise(resolve => { ready = resolve; });
  const finished = new Promise(resolve => { result = resolve; });
  server.on('connection', client => {
    socket = client;
    client.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'auth') client.send(JSON.stringify({ type: 'auth', ok: true }));
      if (message.type === 'bridge-register') ready(message);
      if (message.type === 'chat-result') result(message);
    });
  });
  const ctx = {
    on: (name, callback) => events.on(name, callback),
    effect: callback => disposers.push(callback()),
    tools: { definitions: () => [], guard() {} },
    systemPrompt: { section() {} },
    sessionController: {
      create: async input => { created.push(input); return { sessionId: 'isolated-chat' }; },
      prompt: async input => {
        prompts.push(input);
        const session = { id: input.sessionId };
        events.emit('session/event', session, { type: 'turn/start', data: { turn: 1 } });
        events.emit('agent/inbox/claimed', { agent: session, turn: 1, message: { source: { rpcId: input.requestId } } });
        events.emit('session/event', session, { type: 'user/message', data: { source: { rpcId: input.requestId } } });
        events.emit('session/event', session, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '隔离 profile 回复' }] } } });
        events.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
      },
      cancel: async () => {},
    },
  };
  t.after(async () => {
    disposers.forEach(dispose => dispose?.());
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
    events.removeAllListeners();
  });
  const originalHome = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = envHome;
    attachChatBridge(ctx, { baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token', ...config });
  } finally {
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome;
  }
  await registered;
  socket.send(JSON.stringify({ type: 'chat-request', requestId: 'fixture-request', searchAllowed: false, messages: [{ role: 'user', content: '测试' }] }));
  const reply = await finished;
  assert.equal(reply.reply, '隔离 profile 回复');
  return { created, prompts };
}

test('the bridge creates its session inside the captured DSH_HOME, even after env changes', { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, '隔离 profile');
  const { created } = await bridgeFixture(t, {}, home);
  assert.deepEqual(created, [{ cwd: join(home, 'live2d-companion') }]);
  assert.equal((await stat(created[0].cwd)).isDirectory(), true);
  assert.deepEqual(await readdir(root), ['隔离 profile']);
});

test('explicit chatCwd creates only the chosen workspace, not a DSH default workspace', { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cwd-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { created } = await bridgeFixture(t, { chatCwd: join(root, 'chosen chat') }, join(root, 'unused-home'));
  assert.equal(created[0].cwd, join(root, 'chosen chat'));
  assert.deepEqual(await readdir(root), ['chosen chat']);
});

test('reusing chatSessionId never creates a session or any companion directory', { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-existing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { created, prompts } = await bridgeFixture(t, { chatSessionId: 'existing-session', chatCwd: join(root, 'unused-cwd') }, root);
  assert.deepEqual(created, []);
  assert.equal(prompts[0].sessionId, 'existing-session');
  assert.deepEqual(await readdir(root), []);
});
