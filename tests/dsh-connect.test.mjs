import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dsh = require('../desktop/dsh-connect.cjs');

test('generated DSH patch uses a token file and persistent B session file', () => {
  const patch = dsh.patchText({
    root: 'C:\\app',
    dataDir: 'C:\\Users\\me\\AppData\\Roaming\\大肥鱼',
    serviceUrl: 'http://127.0.0.1:39181/',
    token: 'secret',
    mode: 'new',
    sessionFile: 'C:\\Users\\me\\AppData\\Roaming\\大肥鱼\\dsh\\chat-session.txt',
    port: 63616,
  });
  assert.match(patch, /native: true/);
  assert.match(patch, /tokenFile:/);
  assert.match(patch, /sessionFile:/);
  assert.doesNotMatch(patch, /L2D_BRIDGE_TOKEN/);
  assert.match(patch, /process\.getBuiltinModule\("node:fs"\)\.readFileSync/);
  assert.doesNotMatch(patch, /Bearer secret/);
  assert.doesNotMatch(patch, /chatSessionId/);
});

test('generated DSH patch can attach an existing session and rejects malformed IDs', () => {
  const base = { root: 'C:\\app', dataDir: 'C:\\data', serviceUrl: 'http://127.0.0.1:39181', token: 'secret', mode: 'existing', port: 53180 };
  const patch = dsh.patchText({ ...base, sessionId: 'session-1234-abcd' });
  assert.match(patch, /chatSessionId: 'session-1234-abcd'/);
  assert.doesNotMatch(patch, /sessionFile:/);
  assert.throws(() => dsh.patchText({ ...base, sessionId: '../../escape' }), /会话 ID/);
});

test('session listing only returns DSH session directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'l2d-dsh-sessions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const sessions = join(home, 'sessions', 'cwd');
  await mkdir(join(sessions, 'session-bbbb'), { recursive: true });
  await mkdir(join(sessions, 'session-aaaa'), { recursive: true });
  await mkdir(join(sessions, 'not-a-session'), { recursive: true });
  await writeFile(join(sessions, 'session-aaaa', 'session.v4.jsonl.zstd'), '');
  await writeFile(join(sessions, 'session-bbbb', 'session.v4.jsonl.zstd'), '');
  const list = dsh.listSessions(home);
  assert.deepEqual(list.map(item => item.id).sort(), ['session-aaaa', 'session-bbbb']);
  assert.equal(list[0].cwd, 'cwd');
});
