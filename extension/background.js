const BASE = 'http://127.0.0.1:39181';
let scheduled, shareGeneration = 0, followOperation = 0, followSocket;

async function request(path, body, method, suppliedToken) {
  const token = suppliedToken ?? (await chrome.storage.local.get('token')).token;
  if (!token) throw new Error('先从桌宠设置中复制配对码。');
  const response = await fetch(BASE + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result;
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result?.error?.message || result?.error || '桌宠连接失败');
  return result;
}

// Runs in the selected tab's isolated world. No pairing token is passed in.
function readPage(selectionOnly) {
  const blocked = 'input,textarea,select,button,script,style,noscript,form,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]';
  function readable(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || element.isContentEditable || element.closest(blocked) || !element.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  }
  const selection = window.getSelection();
  let selected = '';
  if (selection?.rangeCount && readable(selection.anchorNode) && readable(selection.focusNode)) {
    let unsafe = false;
    for (let i = 0; i < selection.rangeCount && !unsafe; i += 1) {
      const range = selection.getRangeAt(i);
      for (const element of document.querySelectorAll('input,textarea,select,form,[contenteditable]:not([contenteditable="false"])')) {
        if (range.intersectsNode(element)) { unsafe = true; break; }
      }
    }
    if (!unsafe) selected = String(selection).trim().slice(0, 4000);
  }
  const root = document.querySelector('article') || document.querySelector('main') || document.body;
  const blocks = [];
  if (!selectionOnly && root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let size = 0, node;
    while ((node = walker.nextNode()) && size < 12000) {
      if (!readable(node)) continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text.length < 3) continue;
      blocks.push(text); size += text.length;
    }
  }
  const url = new URL(location.href);
  url.hash = ''; url.username = ''; url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|code|session(?:[_-]?id)?|api[_-]?key|password|passwd|secret|signature|sig)$/i.test(key)) url.searchParams.delete(key);
  }
  return { title: document.title.slice(0, 300), url: url.href, text: selectionOnly ? selected : blocks.join('\n').slice(0, 12000), selection: selected, language: document.documentElement.lang || '', capturedAt: Date.now() };
}

async function stopFollowing({ clearContext = false, message = '' } = {}) {
  shareGeneration += 1;
  followOperation += 1;
  clearTimeout(scheduled);
  scheduled = undefined;
  await chrome.storage.session.set({ following: false, followSessionId: null, lastTitle: '', lastSharedAt: 0, lastError: message });
  await chrome.alarms.clear('refresh-watch');
  const socket = followSocket;
  followSocket = undefined;
  socket?.close();
  await chrome.action.setBadgeText({ text: '' });
  if (clearContext) await request('/api/watch', { enabled: false }, 'PUT');
}

async function requireWatchSession(expectedSessionId) {
  const state = await request('/api/state');
  if (!state.watch?.enabled) throw new Error('请先在桌宠聊天窗口开启“一起看”。');
  const sessionId = state.watch.sessionId;
  if (!sessionId) throw new Error('桌宠版本不支持安全陪看会话，请更新桌宠后重试。');
  if (expectedSessionId && sessionId !== expectedSessionId) throw new Error('一起看已重新开启，请再次点击跟随。');
  return sessionId;
}

async function share(selectionOnly = false, expectedSessionId) {
  const generation = ++shareGeneration;
  const sessionId = await requireWatchSession(expectedSessionId);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || tab.incognito) throw new Error('请选择普通浏览窗口的网页。');
  if (!/^https?:\/\//i.test(tab.url || '')) throw new Error('这个页面不能分享，请打开普通网页。');
  if (generation !== shareGeneration) throw new Error('分享已取消。');
  // Manual sharing uses the active tab; only follow mode asks for broad host access.
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage, args: [selectionOnly] });
  const page = results[0]?.result;
  if (!page?.text) throw new Error(selectionOnly ? '请选中网页正文；输入框或编辑器里的文字不会分享。' : '当前页面没有可读取的正文。');
  if (generation !== shareGeneration) throw new Error('分享已取消。');
  await request('/api/watch/context', { ...page, sessionId });
  if (generation !== shareGeneration) throw new Error('分享已取消。');
  await chrome.storage.session.set({ lastTitle: page.title, lastSharedAt: Date.now(), lastError: '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#5995df' });
  await chrome.action.setBadgeText({ text: '看' });
  return { title: page.title, sessionId };
}

async function syncWatch(watch) {
  const local = await chrome.storage.session.get(['following', 'followSessionId']);
  if (!local.following) return;
  if (!watch?.enabled || !watch.sessionId || watch.sessionId !== local.followSessionId) {
    await stopFollowing({ message: '一起看已关闭或重新开启；再次点击跟随才会继续分享。' });
  }
}

async function ensureFollowSocket() {
  if (followSocket) return;
  const { token } = await chrome.storage.local.get('token');
  if (!token || followSocket) return;
  const socket = new WebSocket(BASE.replace(/^http/, 'ws') + '/events');
  followSocket = socket;
  socket.onopen = () => { if (followSocket === socket) socket.send(JSON.stringify({ type: 'auth', token })); };
  socket.onmessage = event => {
    if (followSocket !== socket) return;
    try {
      const message = JSON.parse(event.data);
      const watch = message.type === 'watch' ? message.watch : message.type === 'state' ? message.state?.watch : null;
      if (watch) syncWatch(watch).catch(() => {});
    } catch {}
  };
  socket.onclose = () => {
    if (followSocket === socket) stopFollowing({ message: '桌宠连接已断开；重新连接后请再次点击跟随。' }).catch(() => {});
  };
  socket.onerror = () => {};
}

async function followUpdate() {
  const local = await chrome.storage.session.get(['following', 'followSessionId']);
  if (!local.following) return;
  try {
    const state = await request('/api/state');
    await syncWatch(state.watch);
    if (!(await chrome.storage.session.get('following')).following) return;
    await ensureFollowSocket();
    await share(false, local.followSessionId);
  } catch (error) {
    await chrome.storage.session.set({ lastError: String(error.message || error) });
    if ((await chrome.storage.session.get('following')).following) await chrome.action.setBadgeText({ text: '·' });
  }
}

function queueFollow() {
  shareGeneration += 1;
  clearTimeout(scheduled);
  scheduled = setTimeout(followUpdate, 2200);
}
chrome.tabs.onActivated.addListener(queueFollow);
chrome.tabs.onUpdated.addListener((_id, change, tab) => { if (tab.active && (change.status === 'complete' || change.url)) queueFollow(); });
chrome.windows.onFocusChanged.addListener(id => { if (id !== chrome.windows.WINDOW_ID_NONE) queueFollow(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'refresh-watch') followUpdate(); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    if (message.type === 'connect') {
      const candidate = String(message.token || '').trim();
      await request('/api/state', undefined, 'GET', candidate);
      await stopFollowing();
      await chrome.storage.local.set({ token: candidate });
      return { ok: true };
    }
    if (message.type === 'share') return share(Boolean(message.selectionOnly));
    if (message.type === 'follow') {
      const granted = await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
      if (!granted) throw new Error('跟随需要网页访问权限；仍可使用单次分享。');
      await stopFollowing();
      const operation = followOperation;
      const result = await share();
      if (operation !== followOperation) throw new Error('跟随已取消。');
      await chrome.storage.session.set({ following: true, followSessionId: result.sessionId });
      if (operation !== followOperation) { await stopFollowing(); throw new Error('跟随已取消。'); }
      await chrome.alarms.create('refresh-watch', { periodInMinutes: 0.5 });
      await ensureFollowSocket();
      await syncWatch((await request('/api/state')).watch);
      if (!(await chrome.storage.session.get('following')).following) throw new Error('一起看状态已变化，请重新开启跟随。');
      return result;
    }
    if (message.type === 'stop') { await stopFollowing({ clearContext: true }); return { ok: true }; }
    if (message.type === 'status') {
      const local = await chrome.storage.local.get('token');
      let connected = false;
      if (local.token) {
        try { const state = await request('/api/state'); connected = true; await syncWatch(state.watch); }
        catch (error) { await stopFollowing({ message: String(error.message || error) }); }
      }
      const session = await chrome.storage.session.get(['following', 'lastTitle', 'lastError']);
      if (session.following) await ensureFollowSocket();
      return { paired: Boolean(local.token), connected, ...session };
    }
    throw new Error('未知操作');
  })().then(value => respond({ ok: true, ...value })).catch(error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});
