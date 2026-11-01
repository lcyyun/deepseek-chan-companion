// Render the production picker in a deliberately clipped, scrollable panel.
// No app profile, agent, model, or external network request is used.
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..'), directory = process.argv[2];
if (!directory) throw Error('Missing isolated profile directory');
const output = path.join(root, 'output/settings-select-ui');
const report = { ok: false, errors: [], externalRequests: 0 };
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1'); app.disableHardwareAcceleration();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win;
(async () => {
  await fs.mkdir(output, { recursive: true });
  const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{SettingsSelect}from${JSON.stringify(path.join(root, 'src/renderer/settings-select.tsx').replaceAll('\\', '/'))};
    import${JSON.stringify(path.join(root, 'src/renderer/style.css').replaceAll('\\', '/'))};
    window.changes=[];window.escapes=0;window.addEventListener('keydown',e=>{if(e.key==='Escape')window.escapes++;});
    function Fixture(){const[provider,setProvider]=useState('auto'),[pace,setPace]=useState('brief'),[dsh,setDsh]=useState(false);window.setDsh=setDsh;
      const providers=[{value:'auto',label:'自动接入 · 优先 DSH',description:'连接聊天桥后自动使用 DeepSeek Harness。'},
        {value:'dsh',label:'DeepSeek Harness',description:dsh?'聊天桥已连接':'聊天桥未连接，请先启用 chat: true。',disabled:!dsh},
        {value:'codex',label:'Codex · 使用本机登录',description:'使用明确选择的 Codex 会话。'},
        {value:'api',label:'大模型 API · 兼容接口',description:'使用你配置的地址和模型。'}];
      return <><header style={{padding:18,background:'#fff'}}>设置弹层测试</header><div className="fixture-panel"><div style={{padding:18}}><div style={{height:360}}/>
        <SettingsSelect id="provider" label="对话来源" value={provider} options={providers} onChange={v=>{window.changes.push(['provider',v]);setProvider(v)}}/>
        <SettingsSelect id="pace" label="回复节奏" value={pace} options={[{value:'brief',label:'短句陪伴 · 想深入再展开'},{value:'balanced',label:'适中 · 两三句说清楚'},{value:'detailed',label:'详细解释 · 分段呈现'}]} onChange={v=>{window.changes.push(['pace',v]);setPace(v)}}/>
        <div style={{height:600}}/></div></div><button id="outside" style={{position:'fixed',bottom:0,left:0,width:'100%',height:40,background:'#eaf3ff'}}>弹层之外</button></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`;
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'esm', outfile: path.join(directory, 'fixture.js') });
  server = createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"><style>body{background:#f8fafd}.fixture-panel{position:absolute;left:0;top:60px;bottom:40px;width:100%;overflow:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
    if (!['/fixture.js', '/fixture.css'].includes(req.url)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(await fs.readFile(path.join(directory, req.url.slice(1))));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await app.whenReady();
  win = new BrowserWindow({ width: 420, height: 680, useContentSize: true, show: false, frame: false,
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) report.errors.push(event.message); });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => { const external = /^https?:/.test(details.url) && !details.url.startsWith(origin + '/'); if (external) report.externalRequests++; callback({ cancel: external }); });
  await win.loadURL(origin + '/');
  const js = code => win.webContents.executeJavaScript(code);
  const until = async predicate => { for (let i = 0; i < 100; i++) { if (await js(predicate)) return; await delay(25); } throw Error('UI condition not reached: ' + predicate); };
  await until('!!document.querySelector("#provider")');
  const key = async name => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: name }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: name }); await delay(35); };
  const position = async (id, edge) => { await js(`(()=>{const panel=document.querySelector('.fixture-panel'),button=document.getElementById(${JSON.stringify(id)});panel.scrollTop+=button.getBoundingClientRect().top-(${edge === 'top' ? '85' : 'innerHeight-92'});})()`); await delay(60); };
  const open = async (id = 'provider') => { await js(`document.getElementById(${JSON.stringify(id)}).focus();document.getElementById(${JSON.stringify(id)}).click()`); await until(`!!document.querySelector('[data-settings-menu="${id}"]')`); await delay(75); };
  const geometry = () => js(`(()=>{const list=document.querySelector('.settings-select-menu'),r=list.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,direction:list.dataset.direction,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight}})()`);
  const inside = value => { assert.ok(value.left >= 7 && value.top >= 7); assert.ok(value.right <= value.width - 7 && value.bottom <= value.height - 7); };
  const screenshot = async name => fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  await position('provider', 'top'); await open(); report.top = await geometry(); inside(report.top); assert.equal(report.top.direction, 'down');
  assert.equal(await js('document.querySelectorAll("select").length'), 0);
  await screenshot('provider-top');
  await js(`document.querySelector('[data-option-value="dsh"]').click()`);
  assert.deepEqual(await js('window.changes'), []); assert.equal(await js('!!document.querySelector(".settings-select-menu")'), true); report.disabledOptionIgnored = true;
  await key('Down'); assert.equal(await js('document.getElementById("provider").getAttribute("aria-activedescendant")'), 'provider-option-2');
  await key('Return'); assert.equal(await js('document.getElementById("provider").dataset.value'), 'codex'); report.keyboardSkipsDisabled = true;
  assert.equal(await js('document.activeElement.id'), 'provider');
  await open(); assert.equal(await js('document.querySelector("[data-option-value=codex]").getAttribute("aria-selected")'), 'true');
  await key('Escape'); assert.equal(await js('window.escapes'), 0); assert.equal(await js('!!document.querySelector(".settings-select-menu")'), false); report.escapeDoesNotBubble = true; report.selectionRetained = true;
  await position('provider', 'bottom'); await open(); report.bottom = await geometry(); inside(report.bottom); assert.equal(report.bottom.direction, 'up'); await screenshot('provider-bottom');
  await key('Home'); await key('Return'); assert.equal(await js('document.getElementById("provider").dataset.value'), 'auto');
  await open(); await key('End'); await key('Space'); assert.equal(await js('document.getElementById("provider").dataset.value'), 'api');
  await open(); await key('Tab'); assert.equal(await js('!!document.querySelector(".settings-select-menu")'), false);
  // An offscreen window has no OS activation; dispatch the focus-in notification
  // explicitly after moving its DOM focus instead of pretending to activate it.
  await open(); await js('(()=>{const outside=document.getElementById("outside");outside.focus();outside.dispatchEvent(new FocusEvent("focusin",{bubbles:true}));})()'); await until('!document.querySelector(".settings-select-menu")');
  await open(); win.webContents.sendInputEvent({ type: 'mouseDown', x: 10, y: 666, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: 10, y: 666, button: 'left', clickCount: 1 }); await delay(50); assert.equal(await js('!!document.querySelector(".settings-select-menu")'), false);
  await position('pace', 'bottom'); await open('pace'); report.pace = await geometry(); inside(report.pace); await key('End'); await key('Return'); assert.equal(await js('document.getElementById("pace").dataset.value'), 'detailed');
  await open('pace'); await screenshot('pace-bottom'); await key('Escape');
  await position('provider', 'top'); await open(); await js('window.setDsh(true)'); await until('document.querySelector("[data-option-value=dsh]")?.getAttribute("aria-disabled")===null'); await key('Home'); await key('Down'); await key('Return'); assert.equal(await js('document.getElementById("provider").dataset.value'), 'dsh'); report.dynamicAvailability = true;
  win.setContentSize(300, 330); await delay(100); await position('provider', 'bottom'); await open(); report.small = await geometry(); inside(report.small); assert.ok(report.small.scrollHeight > report.small.clientHeight); await screenshot('provider-small');
  await js('document.querySelector(".fixture-panel").scrollTop=950'); await until('!document.querySelector(".settings-select-menu")'); report.scrollClosesHiddenAnchor = true;
  await position('provider', 'top'); await open(); await js('window.dispatchEvent(new Event("blur"))'); await until('!document.querySelector(".settings-select-menu")');
  assert.deepEqual(report.errors, []); assert.equal(report.externalRequests, 0); report.ok = true;
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  win.destroy(); await new Promise(resolve => server.close(resolve)); app.exit(0);
})().catch(async error => { report.error = String(error.stack || error); await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2)); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); win?.destroy(); server?.close(); app.exit(1); });
