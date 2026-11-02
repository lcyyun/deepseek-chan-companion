import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const dsh = createRequire(import.meta.url)('../desktop/dsh-connect.cjs');

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'l2d-connect-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'dsh home'), dataDir = join(root, 'data'), cli = join(root, 'dsh.cmd');
  await mkdir(home); await mkdir(dataDir); await mkdir(join(root, 'integrations/dsh'), { recursive: true });
  await writeFile(cli, '@echo off'); await writeFile(join(dataDir, 'bridge-token'), 'fixture-token');
  await writeFile(join(root, 'integrations/dsh/live2d-bridge.mjs'), 'export const name="fixture";');
  const config = { dshHome: home, dshCli: cli, dshPort: 63616, dshMode: 'new' };
  const options = { root, dataDir, config, serviceUrl: 'http://127.0.0.1:39181', mode: 'new', ...extra };
  const installation = dsh.prepareInstallation(options);
  return { root, home, dataDir, cli, config, options, installation };
}
function harness(fixture, options = {}) {
  const state = { connected: false };
  const counters = { starts: 0, recoveries: 0, probes: [] };
  const metadata = { ...fixture.installation, host: { homeFingerprint: dsh.homeFingerprint(fixture.home), port: 63616, profile: 'web', pid: 1234 } };
  const connected = ready => Object.assign(state, { connected: true, chatAvailable: true, recoverySupported: true, recoveryProtocol: 1,
    installationId: metadata.installationId, host: metadata.host, toolsReady: ready, nativeToolsReady: ready, mcpReachable: ready });
  const service = { url: fixture.options.serviceUrl, getState: () => ({ dsh: { ...state } }),
    requestDshRecovery: async () => { counters.recoveries++; Object.assign(state, { toolsReady: true, nativeToolsReady: true, mcpReachable: true }); return { ...state, ok: true }; } };
  const flow = dsh.createConnectionController({ root: fixture.root, getDataDir: () => fixture.dataDir,
    getConfig: () => fixture.config, getService: () => service,
    detect: async (_config, probe) => { counters.probes.push(probe); return { cli: fixture.cli, home: fixture.home, homeExists: true, port: 63616, open: [], processCheckKnown: true, hasDshProcess: false, ...options.detectResult }; },
    start: input => { counters.starts++; assert.equal(input.patch, fixture.installation.patch); connected(false); return new EventEmitter(); },
    ...options.controller,
  });
  return { flow, state, counters, connected, service };
}

test('explicit setup is idempotent, preserves B session and never embeds pairing credentials', async t => {
  const f = await fixture(t);
  await writeFile(f.installation.sessionFile, 'session-existing-b');
  const before = await stat(f.installation.patch);
  const again = dsh.prepareInstallation(f.options);
  assert.equal(again.installationId, f.installation.installationId);
  assert.equal(again.reused, true);
  assert.equal((await stat(f.installation.patch)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(again.sessionFile, 'utf8'), 'session-existing-b');
  const patch = await readFile(again.patch, 'utf8');
  assert.match(patch, /installationId:/); assert.match(patch, /X-L2D-Client-Id: dsh-live2d/);
  assert.doesNotMatch(patch, /fixture-token/);
  assert.equal(dsh.readInstallation(f.options).valid, true);
});

test('A session remains explicit and changed registration files prohibit automatic launching', async t => {
  const f = await fixture(t, { mode: 'existing', sessionId: 'session-explicit-a' });
  Object.assign(f.config, { dshMode: 'existing', dshSessionId: 'session-explicit-a' });
  const patch = await readFile(f.installation.patch, 'utf8');
  assert.match(patch, /chatSessionId: 'session-explicit-a'/); assert.doesNotMatch(patch, /sessionFile:/);
  await writeFile(f.installation.launcher, 'modified-by-user');
  const h = harness(f);
  assert.equal((await h.flow.status()).requiresSetup, true);
  assert.equal((await h.flow.connect({ start: true })).ok, false);
  assert.equal(h.counters.starts, 0);
});

test('healthy authenticated host reconnects without scanning or starting DSH', async t => {
  const f = await fixture(t), h = harness(f);
  h.connected(true);
  assert.equal((await h.flow.status()).connectionState, 'ready');
  assert.equal((await h.flow.connect()).ok, true);
  assert.equal(h.counters.recoveries, 1);
  assert.equal(h.counters.starts, 0);
  assert.equal(h.counters.probes.length, 0);
});

test('ordinary Connect never launches; explicit Start coalesces concurrent requests and waits for handshake', async t => {
  const f = await fixture(t), h = harness(f);
  assert.equal((await h.flow.connect()).connectionState, 'start_available');
  assert.equal(h.counters.starts, 0);
  const first = h.flow.connect({ start: true }), second = h.flow.connect({ start: true });
  assert.equal(first, second);
  assert.equal((await first).connectionState, 'ready');
  assert.equal(h.counters.starts, 1);
  assert.equal(h.counters.recoveries, 1);
  assert.equal(h.counters.probes.at(-1).fresh, true, 'Explicit startup does not trust cached process detection');
});

test('an unknown open port, existing DSH process or failed process probe cannot be treated as a healthy host', async t => {
  for (const detectResult of [{ open: [63616] }, { hasDshProcess: true }, { processCheckKnown: false }]) {
    const f = await fixture(t), h = harness(f, { detectResult });
    const status = await h.flow.connect({ start: true });
    assert.equal(status.connectionState, 'occupied');
    assert.equal(status.running, false);
    assert.equal(status.hostVerified, false);
    assert.equal(h.counters.starts, 0);
  }
});

test('mismatched identity and legacy bridge retain chat but require explicit setup instead of restart', async t => {
  const f = await fixture(t), h = harness(f);
  h.connected(true); h.state.host = { ...h.state.host, homeFingerprint: 'wrong-home' };
  assert.equal((await h.flow.connect()).connectionState, 'occupied');
  assert.equal(h.counters.recoveries, 0);
  h.state.recoveryProtocol = 0; h.state.recoverySupported = false;
  const legacy = await h.flow.connect({ start: true });
  assert.equal(legacy.connectionState, 'upgrade_required');
  assert.equal(legacy.chatAvailable, true);
  assert.equal(h.counters.starts, 0);
});

test('changed bridge code asks for one reload, while status reads never rewrite configuration', async t => {
  const f = await fixture(t), h = harness(f);
  const original = await readFile(f.installation.patch, 'utf8');
  await writeFile(join(f.root, 'integrations/dsh/live2d-bridge.mjs'), 'export const name="new-version";');
  assert.equal((await h.flow.status()).connectionState, 'upgrade_required');
  assert.equal((await h.flow.connect({ start: true })).canStartConfigured, false);
  assert.equal(await readFile(f.installation.patch, 'utf8'), original);
  assert.equal(h.counters.starts, 0);
});

test('paired native host on a dynamic port is reused without rewriting the registered web launcher', async t => {
  const f = await fixture(t), h = harness(f);
  const original = await readFile(join(f.dataDir, 'dsh/installation.json'), 'utf8');
  h.connected(true);
  h.state.host = { ...h.state.host, port: 61441, portSource: 'command-line', profile: 'desktop' };
  const status = await h.flow.connect();
  assert.equal(status.hostVerified, true);
  assert.equal(status.connectionState, 'ready');
  assert.equal(status.actualHostPort, 61441);
  assert.equal(status.actualHostProfile, 'desktop');
  assert.equal(status.openPort, 61441);
  assert.equal(status.port, 63616, 'Dedicated launcher keeps its explicit registration');
  assert.equal(h.counters.starts, 0);
  assert.equal(await readFile(join(f.dataDir, 'dsh/installation.json'), 'utf8'), original);
  h.state.host.portSource = 'configuration';
  assert.equal((await h.flow.status()).canOpenDsh, false, 'A config hint cannot identify a dynamic desktop web address');
});

test('startup timeout remains diagnosable and a still-running process is never started a second time', async t => {
  const f = await fixture(t);
  let clock = 0, starts = 0;
  const detection = { processCheckKnown: true, hasDshProcess: false };
  const h = harness(f, { detectResult: detection, controller: {
    now: () => clock, startupTimeoutMs: 500, delay: async ms => { clock += ms; },
    start: () => { starts++; detection.hasDshProcess = true; return new EventEmitter(); },
  } });
  const failure = await h.flow.connect({ start: true });
  assert.equal(failure.connectionState, 'start_failed');
  assert.equal(failure.canStartConfigured, false);
  assert.match(failure.message, /尚未完成连接/);
  assert.equal((await h.flow.status()).message, failure.message);
  await h.flow.connect({ start: true });
  assert.equal(starts, 1);
});
