import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
function fixture() {
  const local = { token: 'valid' }, session = {};
  const state = { watch: { enabled: true, sessionId: 'session-a' } };
  const uploads = [], clearedAlarms = [], handlers = {};
  const storage = values => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]])); },
    async set(patch) { Object.assign(values, patch); },
  });
  const hook = name => ({ addListener(fn) { handlers[name] = fn; } });
  const chrome = {
    storage: { local: storage(local), session: storage(session) },
    tabs: { onActivated: hook('tab'), onUpdated: hook('updated'), query: async () => [{ id: 4, url: 'https://example.com', incognito: false }] },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: hook('focus') },
    alarms: { onAlarm: hook('alarm'), clear: async name => clearedAlarms.push(name), create: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    permissions: { contains: async () => true },
    scripting: { executeScript: async () => [{ result: { title: '文章', url: 'https://example.com', text: '正文' } }] },
    runtime: { id: 'extension-id', onMessage: hook('message') },
  };
  class FakeSocket { close() {} send() {} }
  const context = vm.createContext({ chrome, URL, WebSocket: FakeSocket, console, setTimeout, clearTimeout, fetch: async (url, options) => {
    const ok = options.headers.Authorization === 'Bearer valid';
    if (ok && url.endsWith('/api/watch/context')) uploads.push(JSON.parse(options.body));
    if (ok && url.endsWith('/api/watch') && options.method === 'PUT') Object.assign(state.watch, { enabled: false, sessionId: null });
    return { ok, json: async () => ok ? structuredClone(state) : { error: 'invalid token' } };
  } });
  vm.runInContext(script, context);
  const call = message => new Promise(resolve => handlers.message(message, { id: chrome.runtime.id }, resolve));
  return { local, session, state, uploads, clearedAlarms, handlers, chrome, context, call };
}

test('invalid re-pairing preserves the valid saved token', async () => {
  const f = fixture();
  const response = await f.call({ type: 'connect', token: 'invalid' });
  assert.equal(response.ok, false);
  assert.equal(f.local.token, 'valid');
});

test('share attaches current watch session and does not pass token into page code', async () => {
  const f = fixture();
  let injection;
  f.chrome.scripting.executeScript = async value => { injection = value; return [{ result: { title: '文章', url: 'https://example.com', text: '正文' } }]; };
  assert.equal((await f.call({ type: 'share' })).ok, true);
  assert.equal(f.uploads[0].sessionId, 'session-a');
  assert.equal(JSON.stringify(injection).includes('valid'), false);
  assert.equal(injection.target.tabId, 4);
});

test('a new watch session disables old follow instead of silently resuming', async () => {
  const f = fixture();
  f.session.following = true; f.session.followSessionId = 'session-a';
  f.state.watch.sessionId = 'session-b';
  await vm.runInContext('followUpdate()', f.context);
  assert.equal(f.session.following, false);
  assert.equal(f.uploads.length, 0);
  assert.ok(f.clearedAlarms.includes('refresh-watch'));
});

test('stop during capture cancels upload and clears follow plus server context', async () => {
  const f = fixture();
  let release, captured;
  const capturing = new Promise(resolve => { captured = resolve; });
  f.chrome.scripting.executeScript = () => { captured(); return new Promise(resolve => { release = resolve; }); };
  const pending = f.call({ type: 'share' });
  await capturing;
  assert.equal((await f.call({ type: 'stop' })).ok, true);
  release([{ result: { title: '旧页面', url: 'https://example.com', text: '旧正文' } }]);
  assert.equal((await pending).ok, false);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.state.watch.enabled, false);
  assert.equal(f.session.following, false);
});

test('editable selections and hidden-ancestor text are excluded and URL credentials removed', () => {
  const f = fixture();
  const visible = { nodeType: 1, parentElement: null, isContentEditable: false, closest: () => null, getClientRects: () => [1], style: {} };
  const hidden = { ...visible, style: { display: 'none' } };
  const hiddenChild = { ...visible, parentElement: hidden };
  const editor = { ...visible, isContentEditable: true };
  const nodes = [{ parentElement: visible, textContent: '可见文章' }, { parentElement: hiddenChild, textContent: '隐藏私密内容' }, { parentElement: editor, textContent: '编辑框秘密' }];
  let cursor = 0;
  Object.assign(f.context, {
    Node: { ELEMENT_NODE: 1 }, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: element => ({ display: 'block', visibility: 'visible', opacity: '1', ...element.style }),
    location: { href: 'https://user:pass@example.com/article?API_KEY=private&q=normal#private' },
    window: { getSelection: () => ({ rangeCount: 1, anchorNode: editor, focusNode: editor, toString: () => '编辑框秘密' }) },
    document: { title: '测试', documentElement: { lang: 'zh' }, body: visible, querySelector: () => visible, createTreeWalker: () => ({ nextNode: () => nodes[cursor++] }), querySelectorAll: () => [] },
  });
  const page = vm.runInContext('readPage(false)', f.context);
  assert.equal(page.text, '可见文章');
  assert.equal(page.selection, '');
  assert.equal(page.url, 'https://example.com/article?q=normal');
});
