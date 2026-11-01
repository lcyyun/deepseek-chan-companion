// Production React, authenticated MCP/bridge transports, and mock model adapters.
// No real account, Codex executable, online speech or user profile is accessed.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const root = path.resolve(__dirname, '..'), directory = process.argv[2];
if (!directory) throw Error('Missing isolated provider fixture directory');
const output = path.join(root, 'output', 'provider-connection-ui');
const report = { ok: false, defaultProvider: '', defaultProviderSource: '', providerCalls: [], chatRequests: 0, externalRequests: 0, errors: [] };
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1'); app.disableHardwareAcceleration();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let service, win, bridge, mcpClient, nextDshError = false;
(async () => {
  await fs.mkdir(output, { recursive: true });
  const { createService } = await import(pathToFileURL(path.join(root, 'server/index.mjs')).href);
  const reply = provider => async ({ settings }) => {
    assert.equal(settings.provider, provider); report.providerCalls.push(provider);
    if (provider === 'codex') throw Object.assign(new Error('Codex 进程初始化失败：访问被拒绝。'), { code: 'CODEX_EXEC_FAILED', status: 502 });
    return { id: `fixture-${provider}`, provider, segments: [{ text: `${provider.toUpperCase()} 已连接。`, intent: 'neutral', emotion: 'neutral', gesture: 'none' }], details: '', sources: [] };
  };
  service = await createService({ port: 0, dataDir: path.join(directory, 'service'), staticRoot: path.join(root, 'dist'), chatAdapters: { api: reply('api'), codex: reply('codex') } });
  const request = async (url, body) => {
    const response = await fetch(service.url + url, { method: body ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + service.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.ok, true); return response.json();
  };
  const initial = await request('/api/settings'); report.defaultProvider = initial.provider; report.defaultProviderSource = initial.providerSource;
  assert.equal(initial.provider, 'unconfigured'); assert.equal(initial.providerSource, 'auto'); assert.equal(initial.chatAvailable, false);
  await request('/api/settings', { voiceEnabled: false });
  const connectBridge = async () => {
    const socket = new WebSocket(service.url.replace(/^http/, 'ws') + '/events');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Bridge registration timeout')), 4000);
      socket.on('error', reject);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: service.token })));
      socket.on('message', raw => {
        const event = JSON.parse(raw.toString());
        if (event.type === 'auth' && event.ok) socket.send(JSON.stringify({ type: 'bridge-register', name: 'dsh', chat: true, sessionControllerAvailable: true, searchAvailable: false }));
        if (event.type === 'bridge-ready') { clearTimeout(timer); resolve(); }
        if (event.type === 'chat-request') {
          report.providerCalls.push('dsh');
          if (nextDshError) { nextDshError = false; socket.send(JSON.stringify({ type: 'chat-result', requestId: event.requestId, code: 'MISSING_CREDENTIAL', error: 'fixture missing model credentials' })); }
          else socket.send(JSON.stringify({ type: 'chat-result', requestId: event.requestId, reply: JSON.stringify({ segments: [{ text: 'DSH 已连接。', intent: 'neutral', emotion: 'gentle', gesture: 'none' }], details: '', sources: [] }) }));
        }
      });
    });
    bridge = socket;
  };
  const disconnectBridge = async () => { const socket = bridge; bridge = null; const closed = once(socket, 'close'); socket.close(); await closed; };
  const preload = path.join(directory, 'preload.cjs');
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('companion',{bootstrap:()=>ipcRenderer.invoke('provider-bootstrap'),control:(action)=>ipcRenderer.invoke('provider-control',action),onEvent:()=>()=>{}});`);
  ipcMain.handle('provider-bootstrap', () => ({ role: 'chat', url: service.url, token: service.token }));
  ipcMain.handle('provider-control', (_event, action) => action === 'diagnostics' ? { mouseTracking: true, petScale: { scale: 1 }, hotkeyConflicts: [] } : null);
  await app.whenReady();
  win = new BrowserWindow({ width: 460, height: 780, useContentSize: true, show: false, frame: false, webPreferences: { preload, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) report.errors.push(event.message); });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const external = /^https?:/.test(details.url) && !details.url.startsWith(service.url + '/'); if (external) report.externalRequests++;
    if (details.method === 'POST' && details.url === service.url + '/api/chat') report.chatRequests++;
    callback({ cancel: external });
  });
  await win.loadURL(service.url + '/?view=chat');
  const js = code => win.webContents.executeJavaScript(code);
  const until = async predicate => { for (let i = 0; i < 150; i++) { if (await js(predicate)) return; await delay(30); } throw Error('UI condition not reached: ' + predicate); };
  const tab = async title => { await js(`Array.from(document.querySelectorAll('.tabs button')).find(button=>button.textContent===${JSON.stringify(title)}).click()`); await delay(70); };
  const shot = async name => fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const openSelect = async id => { await js(`(()=>{const button=document.getElementById(${JSON.stringify(id)});button.scrollIntoView({block:'center'});button.focus();button.click()})()`); await until(`!!document.querySelector('[data-settings-menu="${id}"]')`); await delay(60); };
  const choose = async (id, value) => { await openSelect(id); await js(`document.querySelector('[data-settings-menu="${id}"] [data-option-value="${value}"]').click()`); await until(`document.getElementById('${id}').dataset.value===${JSON.stringify(value)}&&!document.querySelector('[data-settings-menu="${id}"]')`); };
  const save = async () => { await js(`document.querySelector('.settings-panel>.primary').scrollIntoView({block:'center'});document.querySelector('.settings-panel>.primary').click()`); await until(`document.querySelector('.save-result')?.textContent.includes('已保存')`); };
  const writeDraft = async text => { await js(`(()=>{const input=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`); await until(`document.querySelector('.composer textarea')?.value===${JSON.stringify(text)}`); };
  const enter = async () => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); await delay(160); };
  const noCodex = async () => assert.equal(await js('document.body.innerText.includes("Codex")'), false);
  await until('document.querySelector("[data-channel=chat]")?.textContent.includes("未连接")');
  assert.equal(await js('document.querySelector(".send").disabled'), true); await noCodex();
  assert.match(await js('document.querySelector("[data-channel=performance]").textContent'), /MCP 未连接/);
  await shot('fresh-chat');
  const firstDraft = '接入前先写下这句话。'; await writeDraft(firstDraft); await enter();
  assert.equal(await js('document.querySelector(".composer textarea").value'), firstDraft); assert.equal(report.chatRequests, 0); report.blockedDraftPreserved = true;
  await tab('设置'); await until('document.getElementById("provider")?.dataset.value==="auto"');
  assert.equal(await js('document.querySelectorAll(".settings-panel select").length'), 0);
  await openSelect('provider'); assert.equal(await js('document.querySelector("[data-option-value=dsh]").getAttribute("aria-disabled")'), 'true'); await shot('fresh-settings-open');
  await js('document.querySelector("[data-option-value=dsh]").click()'); assert.equal(await js('document.getElementById("provider").dataset.value'), 'auto');
  await js('document.getElementById("provider").click()'); await choose('verbosity', 'balanced'); await save();
  assert.equal((await request('/api/settings')).providerSource, 'auto'); assert.equal((await request('/api/settings')).verbosity, 'balanced'); report.verbosityDoesNotSelectProvider = true;
  await choose('verbosity', 'brief'); await save(); await tab('聊一会');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  mcpClient = new Client({ name: 'deepseek-harness', version: 'fixture-0.2.1' }, { capabilities: {} });
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(service.url + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + service.token } } }));
  await mcpClient.callTool({ name: 'avatar_capabilities', arguments: {} });
  await until('document.querySelector(".chat-connection-note")?.textContent.includes("DSH 表演已连接，聊天桥未启用")');
  assert.match(await js('document.querySelector("[data-channel=performance]").textContent'), /MCP 已连接/);
  assert.equal(await js('document.querySelector(".send").disabled'), true); assert.equal(await js('document.querySelector(".composer textarea").disabled'), true);
  assert.equal(report.chatRequests, 0); await noCodex(); await shot('mcp-only'); report.mcpOnlyBlocked = true;
  await connectBridge();
  await until('document.querySelector("[data-channel=chat]")?.textContent==="对话：DeepSeek Harness"&&!document.querySelector(".send").disabled');
  assert.equal(await js('document.querySelector(".composer textarea").placeholder'), '和 DeepSeek Harness 说点什么…');
  await until('document.querySelector(".notice")?.textContent.includes("检测到 DSH，已使用 DSH 对话")');
  await noCodex(); await shot('dsh-connected');
  assert.equal((await request('/api/settings')).providerSource, 'auto'); assert.equal((await request('/api/settings')).providerEffective, 'dsh'); report.autoDshConnected = true;
  await js('document.querySelector(".send").click()'); await until('Array.from(document.querySelectorAll(".message.assistant .message-text")).some(item=>item.textContent.includes("DSH 已连接"))');
  assert.deepEqual(report.providerCalls, ['dsh']);
  await writeDraft('断线前保留这份草稿。'); await disconnectBridge();
  await until('!document.querySelector(".notice")?.textContent.includes("检测到 DSH")');
  await until('document.querySelector("[data-channel=chat]")?.textContent.includes("DeepSeek Harness")&&document.querySelector("[data-channel=chat]")?.textContent.includes("已断线")&&document.querySelector(".send").disabled');
  assert.equal(await js('document.querySelector(".composer textarea").value'), '断线前保留这份草稿。');
  assert.equal(await js('document.querySelector(".composer textarea").disabled'), true); await noCodex(); await shot('dsh-disconnected'); report.stickyDisconnectPreservesDraft = true;
  await connectBridge(); await until('!document.querySelector(".composer textarea").disabled&&!document.querySelector(".send").disabled');
  assert.equal(await js('document.querySelector(".composer textarea").value'), '断线前保留这份草稿。'); report.reconnectRestoresChat = true;
  nextDshError = true; await js('document.querySelector(".send").click()');
  await until('document.querySelector(".error-banner")?.textContent.includes("DSH")'); await noCodex(); report.dshErrorScoped = true;
  await tab('设置'); await choose('verbosity', 'detailed'); await save();
  assert.equal((await request('/api/settings')).providerSource, 'auto'); assert.equal((await request('/api/settings')).providerEffective, 'dsh');
  await openSelect('provider'); await shot('dsh-settings-open'); await js('document.getElementById("provider").click()');
  await request('/api/settings', { provider: 'api', baseUrl: 'https://example.invalid', model: 'fixture-model' });
  await until('document.getElementById("provider")?.dataset.value==="api"'); await tab('聊一会');
  await until('document.querySelector("[data-channel=chat]")?.textContent==="对话：API"');
  await writeDraft('使用明确选择的 API。'); await enter(); await until('Array.from(document.querySelectorAll(".message.assistant .message-text")).some(item=>item.textContent.includes("API 已连接"))');
  await disconnectBridge(); await connectBridge(); await delay(100);
  assert.equal((await request('/api/settings')).providerSource, 'user'); assert.equal((await request('/api/settings')).providerEffective, 'api'); report.explicitApiPreserved = true;
  await tab('设置'); await choose('provider', 'codex'); await save();
  assert.equal((await request('/api/settings')).providerSource, 'user'); await tab('聊一会');
  await until('document.querySelector("[data-channel=chat]")?.textContent==="对话：Codex"');
  await writeDraft('只测试明确选择的 Codex。'); await enter(); await until('document.querySelector(".error-banner")?.textContent.includes("Codex")');
  await disconnectBridge(); await connectBridge(); await delay(100);
  assert.equal((await request('/api/settings')).providerEffective, 'codex'); report.explicitCodexPreserved = true;
  assert.deepEqual(report.providerCalls, ['dsh', 'dsh', 'api', 'codex']); assert.equal(report.chatRequests, 4);
  assert.equal(report.externalRequests, 0); assert.deepEqual(report.errors, []); report.ok = true;
  for (const target of [directory, output]) await fs.writeFile(path.join(target, 'result.json'), JSON.stringify(report, null, 2));
  bridge?.terminate(); await mcpClient?.close(); win.destroy(); await service.close(); app.exit(0);
})().catch(async error => {
  report.error = String(error.stack || error);
  for (const target of [directory, output]) await fs.writeFile(path.join(target, 'result.json'), JSON.stringify(report, null, 2)).catch(() => {});
  bridge?.terminate(); await mcpClient?.close().catch(() => {}); win?.destroy(); await service?.close(); app.exit(1);
});
