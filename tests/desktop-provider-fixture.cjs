// Production React and local backend; model adapters are in-memory fixtures.
// No user profile, real agent, online speech, or Live2D model is opened.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), directory = process.argv[2];
if (!directory) throw Error('Missing isolated provider fixture directory');
const output = path.join(root, 'output', 'provider-neutral-ui');
const report = { ok: false, defaultProvider: '', blockedDraftPreserved: false, providerCalls: [], chatRequests: 0, externalRequests: 0, errors: [] };
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let service, win;

(async () => {
  await fs.mkdir(output, { recursive: true });
  const { createService } = await import(pathToFileURL(path.join(root, 'server/index.mjs')).href);
  const reply = provider => async ({ settings }) => {
    assert.equal(settings.provider, provider);
    report.providerCalls.push(provider);
    return { id: `fixture-${provider}`, provider, segments: [{ text: `${provider.toUpperCase()} 已连接。`, intent: 'neutral', emotion: 'neutral', gesture: 'none' }], details: '', sources: [] };
  };
  service = await createService({ port: 0, dataDir: path.join(directory, 'service'), staticRoot: path.join(root, 'dist'),
    chatAdapters: { api: reply('api'), dsh: reply('dsh'), codex: () => { throw Error('This fixture must never choose Codex'); } } });
  const request = async (url, body) => {
    const response = await fetch(service.url + url, { method: body ? 'PUT' : 'GET',
      headers: { Authorization: 'Bearer ' + service.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.ok, true); return response.json();
  };
  report.defaultProvider = (await request('/api/settings')).provider;
  assert.equal(report.defaultProvider, 'unconfigured');
  const preload = path.join(directory, 'preload.cjs');
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('companion',{bootstrap:()=>ipcRenderer.invoke('provider-bootstrap'),control:(action)=>ipcRenderer.invoke('provider-control',action),onEvent:()=>()=>{}});`);
  ipcMain.handle('provider-bootstrap', () => ({ role: 'chat', url: service.url, token: service.token }));
  ipcMain.handle('provider-control', (_event, action) => action === 'diagnostics' ? { mouseTracking: true, petScale: { scale: 1 }, hotkeyConflicts: [] } : null);
  await app.whenReady();
  win = new BrowserWindow({ width: 460, height: 780, useContentSize: true, show: false, frame: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) report.errors.push(event.message); });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const external = /^https?:/.test(details.url) && !details.url.startsWith(service.url + '/');
    if (external) report.externalRequests++;
    if (details.method === 'POST' && details.url === service.url + '/api/chat') report.chatRequests++;
    callback({ cancel: external });
  });
  await win.loadURL(service.url + '/?view=chat');
  const js = code => win.webContents.executeJavaScript(code);
  const until = async predicate => { for (let i = 0; i < 150; i++) { if (await js(predicate)) return; await delay(30); } throw Error('UI condition not reached: ' + predicate); };
  const tab = async title => { await js(`Array.from(document.querySelectorAll('.tabs button')).find(button=>button.textContent===${JSON.stringify(title)}).click()`); await delay(70); };
  const writeDraft = async text => {
    await js(`(()=>{const input=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`);
    await until(`document.querySelector('.composer textarea')?.value===${JSON.stringify(text)}`);
  };
  const enter = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await delay(180);
  };
  await until('document.querySelector(".connection")?.textContent==="待接入"');
  assert.equal(await js('document.querySelector(".empty-state h1").textContent'), '先连接你的智能体');
  assert.equal(await js('document.querySelector(".send").disabled'), true);
  await fs.writeFile(path.join(output, 'fresh-chat.png'), (await win.webContents.capturePage()).toPNG());
  await tab('设置');
  await until('document.querySelector("select[aria-label=对话来源]")?.value==="unconfigured"');
  await fs.writeFile(path.join(output, 'fresh-settings.png'), (await win.webContents.capturePage()).toPNG());
  await tab('聊一会');
  const firstDraft = '接入前先写下这句话。';
  await writeDraft(firstDraft);
  assert.equal(await js('document.querySelector(".send").disabled'), true);
  await enter();
  await js('document.querySelector(".send").click()');
  await delay(100);
  assert.equal(await js('document.querySelector(".composer textarea").value'), firstDraft);
  assert.equal(await js('document.querySelectorAll(".message").length'), 0);
  assert.equal(report.chatRequests, 0);
  assert.deepEqual(report.providerCalls, []);
  report.blockedDraftPreserved = true;

  // These authenticated updates originate outside the renderer, as from an agent.
  // Production WebSocket settings events must refresh the page without reloading.
  await request('/api/settings', { provider: 'api', voiceEnabled: false, baseUrl: 'https://example.invalid', model: 'fixture-model' });
  await until('document.querySelector(".connection")?.textContent==="API"&&!document.querySelector(".send").disabled');
  assert.equal(await js('document.querySelector(".composer textarea").value'), firstDraft);
  await js('document.querySelector(".send").click()');
  await until('document.querySelector(".message.assistant .message-text")?.textContent.includes("API 已连接")');
  assert.equal(report.chatRequests, 1);
  assert.deepEqual(report.providerCalls, ['api']);

  await request('/api/settings', { provider: 'unconfigured' });
  await until('document.querySelector(".connection")?.textContent==="待接入"');
  const secondDraft = '保留草稿，等 DSH 接入后再发。';
  await writeDraft(secondDraft); await enter();
  assert.equal(await js('document.querySelector(".composer textarea").value'), secondDraft);
  assert.equal(report.chatRequests, 1);
  await request('/api/settings', { provider: 'dsh' });
  await until('document.querySelector(".connection")?.textContent==="DeepSeek Harness"&&!document.querySelector(".send").disabled');
  await enter();
  await until('Array.from(document.querySelectorAll(".message.assistant .message-text")).some(item=>item.textContent.includes("DSH 已连接"))');
  assert.equal(report.chatRequests, 2);
  assert.deepEqual(report.providerCalls, ['api', 'dsh']);
  await tab('设置');
  await until('document.querySelector("select[aria-label=对话来源]")?.value==="dsh"');
  assert.equal(report.externalRequests, 0);
  assert.deepEqual(report.errors, []);
  report.ok = true;
  for (const target of [directory, output]) await fs.writeFile(path.join(target, 'result.json'), JSON.stringify(report, null, 2));
  win.destroy(); await service.close(); app.exit(0);
})().catch(async error => {
  report.error = String(error.stack || error);
  for (const target of [directory, output]) await fs.writeFile(path.join(target, 'result.json'), JSON.stringify(report, null, 2)).catch(() => {});
  win?.destroy(); await service?.close(); app.exit(1);
});
