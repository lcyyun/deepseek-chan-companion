import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { classifyDshProcesses } = createRequire(import.meta.url)('../desktop/dsh-connect.cjs');
const options = { localAppData: 'C:\\Users\\me\\AppData\\Local', userProfile: 'C:\\Users\\me', tempDir: 'C:\\Users\\me\\AppData\\Local\\Temp', systemRoot: 'C:\\Windows' };
const codex = `${options.localAppData}\\OpenAI\\Codex`;
const bin = `${codex}\\runtimes\\cua_node\\123abc\\bin`;
const launcher = { pid: 1, name: 'codex.exe', executablePath: `${codex}\\bin\\abc123\\codex.exe` };
const repl = { pid: 2, name: 'node_repl.exe', executablePath: `${bin}\\node_repl.exe` };
const shell = { pid: 3, parentId: 1, name: 'cmd.exe', executablePath: 'C:\\Windows\\system32\\cmd.exe' };
const node = (entry, extra = {}) => ({ pid: 10, parentId: 1, name: 'node.exe', executablePath: `${bin}\\node.exe`, commandLine: `"${bin}\\node.exe" ${entry}`, ...extra });
const state = records => classifyDshProcesses(records, options);
function absent(records) { assert.equal(state(records).processCheckKnown, true); assert.equal(state(records).hasDshProcess, false); }
function unknown(records) { assert.equal(state(records).processCheckKnown, false); assert.equal(state(records).hasDshProcess, false); }

test('named DSH processes and precise Node DSH entries always block a second host', () => {
  for (const records of [
    [{ name: 'DeepSeek Harness.exe' }], [{ name: 'dsh.exe' }],
    [node('"C:\\DSH app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web --token secret')],
    [node('"C:\\DSH app\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" web')],
    [node('--expose-internals "C:\\DSH app\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js"')],
  ]) {
    assert.equal(state(records).processCheckKnown, true);
    assert.equal(state(records).hasDshProcess, true);
    assert.doesNotMatch(JSON.stringify(state(records)), /secret|DSH app|CommandLine|commandLine/);
  }
});

test('known Codex helpers do not block DSH cold start', () => {
  const artifact = `${options.userProfile}\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node`;
  absent([launcher, repl, shell,
    node(`--import file:///C:/browser/guard.mjs "${bin}\\node_modules\\@oai\\cua-repl\\bin\\cua-repl.mjs"`),
    node(`--eval "const x = \\"bootstrap\\";" --experimental-vm-modules "${options.tempDir}\\.tmp123\\kernel.js" --session-id private-session`, { pid: 11, parentId: 2 }),
    node(`--eval "bootstrap();" "${options.tempDir}\\.tmp123\\trusted-worker.js"`, { pid: 12, parentId: 2 }),
    node('./server.mjs', { pid: 13, parentId: 3 }),
    node(`"${artifact}\\node_modules\\@oai\\artifact-tool\\dist\\artifact-session\\host-daemon.mjs"`, { pid: 14, executablePath: `${artifact}\\bin\\node.exe` }),
  ]);
  absent([]);
});

test('an arbitrary Node script or untrusted executable remains unknown', () => {
  for (const item of [
    node('C:\\project\\server.mjs'),
    node(`"${bin}\\node_modules\\@oai\\cua-repl\\bin\\cua-repl.mjs"`, { executablePath: 'C:\\other\\node.exe' }),
    node(`"${bin}\\node_modules\\@oai\\cua-repl\\bin\\cua-repl.mjs"`, { parentId: 999 }),
    node('--inspect=0 ./server.mjs', { parentId: 3 }),
    node('--eval "startDsh();"'),
    node('"C:\\unterminated.js'),
    node('./server.mjs', { commandLine: '' }),
    node('./server.mjs', { executablePath: '' }),
  ]) unknown([launcher, repl, shell, item]);
  unknown(null);
});

test('relative helper paths need the exact trusted parent chain', () => {
  unknown([launcher, node('./server.mjs')]);
  unknown([launcher, { ...shell, executablePath: 'C:\\tools\\cmd.exe' }, node('./server.mjs', { parentId: 3 })]);
  unknown([{ ...launcher, executablePath: `${codex}-untrusted\\bin\\abc123\\codex.exe` }, shell, node('./server.mjs', { parentId: 3 })]);
  unknown([repl, node(`--eval "bootstrap();" "${options.tempDir}\\other\\kernel.js"`, { parentId: 2 })]);
  unknown([repl, node(`--eval "bootstrap();" "${options.tempDir}\\.tmp123\\kernel.js"`, { parentId: 999 })]);
});

test('DSH markers inside quoted text or script arguments do not masquerade as a DSH entry', () => {
  unknown([node('--eval "console.log(\'C:/node_modules/@deepseek-ai/dsh/lib/bin.js\')"')]);
  unknown([node('C:\\project\\server.mjs C:\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js')]);
  unknown([node('C:\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js.other')]);
});

test('known helpers never hide an unknown or a positively identified DSH process', () => {
  const helper = node('./server.mjs', { parentId: 3 });
  unknown([launcher, shell, helper, node('C:\\unknown.js', { pid: 20 })]);
  assert.equal(state([launcher, shell, helper, node('C:\\unknown.js'), { name: 'dsh.exe' }]).hasDshProcess, true);
  const result = state([node('C:\\private.js --token do-not-return-this')]);
  assert.deepEqual(Object.keys(result).sort(), ['hasDshProcess', 'processCheckKnown', 'processCheckReason']);
  assert.doesNotMatch(JSON.stringify(result), /private|do-not-return-this|token|C:\\/);
});
