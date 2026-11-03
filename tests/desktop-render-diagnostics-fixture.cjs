// Real main/preload/React/Live2D/service; hidden native windows and isolated data.
// Requires an explicitly supplied local model. No account, TTS, DSH or mouse input.
const { app, dialog, clipboard } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const directory = process.argv[2];
if (!directory || !process.env.L2D_MODEL_ROOT) throw Error('An isolated directory and explicit L2D_MODEL_ROOT are required');
app.setPath('userData', directory);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const windows = new Map(), copies = [], failures = [], observedOrigins = new Set();
let running = false, timer;
const output = path.join(directory, 'render-diagnostics-result.json');
const result = { ok: false, windowsHidden: false, realFramesObserved: false, errors: [] };
function fail(error) {
  result.errors.push(String(error?.stack || error));
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  app.exit(1);
}
dialog.showErrorBox = (_title, message) => fail(Error(message));
clipboard.writeText = value => { copies.push(String(value)); };
require('../desktop/mouse-input.cjs').startMouseInput = options => {
  options.onButton(false); options.onSample({ down: false, seq: 0 });
  return { ready: Promise.resolve(true), stop: () => options.onButton(false) };
};
process.stdout?.on('error', () => {}); process.stderr?.on('error', () => {});
app.on('browser-window-created', (_event, win) => {
  win.__nativeIsVisible = win.isVisible.bind(win); win.__simulatedVisible = false;
  win.isVisible = () => win.__simulatedVisible;
  win.show = win.showInactive = () => { win.__simulatedVisible = true; win.emit('show'); };
  win.hide = () => { win.__simulatedVisible = false; win.emit('hide'); };
  win.focus = win.moveTop = () => {};
  win.webContents.focus = () => {};
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) failures.push(event.message); });
  win.webContents.on('did-finish-load', async () => {
    try {
      const bootstrap = await win.webContents.executeJavaScript('window.companion.bootstrap()');
      assert.equal(new URL(bootstrap.url).port, process.env.COMPANION_PORT);
      observedOrigins.add(bootstrap.url);
      windows.set(bootstrap.role, win);
      if (windows.size === 3 && !running) { running = true; await verify(bootstrap.url, bootstrap.token); }
    } catch (error) { fail(error); }
  });
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (role, code) => windows.get(role).webContents.executeJavaScript(code);
const control = (role, action, value) => js(role, `window.companion.control(${JSON.stringify(action)},${JSON.stringify(value)})`);
async function until(predicate, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(100); }
  throw Error('Timed out: ' + label);
}
async function verify(url, token) {
  const request = (route, options = {}) => fetch(url + route, { ...options, headers: {
    Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers,
  } });
  assert.equal((await fetch(url + '/api/performance')).status, 401);
  await control('chat', 'show-pet');
  const report = await until(async () => {
    const response = await request('/api/performance'); assert.equal(response.status, 200);
    const data = await response.json();
    return data.available && data.sample?.gpuRenderer && data.samples?.length >= 2 ? data : null;
  }, 'real GPU sample reaches main and service');
  assert.equal(report.quality.mode, 'balanced'); assert.equal(report.quality.effective, 'balanced');
  assert.equal(report.sample.maxFps, 60); assert.ok(report.sample.textureCount > 0);
  assert.ok(report.sample.canvasPixels > 0); assert.equal(report.sample.contextAttributes.antialias, false);
  assert.equal(report.sample.gpuTiming?.reason,'not-started','GPU queries stay off until explicitly requested');
  assert.equal(report.sample.gpuTiming?.samples,0);
  await assert.rejects(control('pet','start-gpu-timing'),/仅聊天/);
  await assert.rejects(control('chat','gpu-timing-status',{supported:false,active:false,reason:'unsupported'}),/仅桌宠/);
  // Delay only this diagnostic event to exercise the production main/preload
  // acknowledgement contract without depending on GPU extension support.
  async function holdGpuStart(){
    const web=windows.get('pet').webContents,original=web.send;
    let event;
    web.send=function(channel,payload,...rest){
      if(channel==='desktop-event'&&payload?.type==='start-gpu-timing'){event=payload;return;}
      return original.call(this,channel,payload,...rest);
    };
    const promise=control('chat','start-gpu-timing').then(value=>({value}),error=>({error:String(error.message)}));
    try{await until(()=>event,'GPU timing IPC request',3000);}finally{web.send=original;}
    return {event,promise};
  }
  const held=await holdGpuStart();
  assert.equal(held.event.durationMs,15000);assert.equal(held.event.renderGeneration,report.renderGeneration);
  const ack={requestId:held.event.requestId,renderGeneration:held.event.renderGeneration,supported:false,active:false,reason:'unsupported'};
  assert.equal(await control('pet','gpu-timing-status',{...ack,requestId:'stale'}),false);
  assert.equal(await control('pet','gpu-timing-status',{...ack,renderGeneration:ack.renderGeneration-1}),false);
  assert.equal(await control('pet','gpu-timing-status',{...ack,reason:'untrusted-reason'}),false);
  assert.equal(await control('pet','gpu-timing-status',{...ack,private:'secret'}),true);
  assert.deepEqual((await held.promise).value,ack);
  assert.equal(await control('pet','gpu-timing-status',ack),false,'completed requests cannot be replayed');
  const timed=await holdGpuStart(),startedAt=Date.now();
  assert.match((await timed.promise).error,/超时/);assert.ok(Date.now()-startedAt<6000);
  const hidden=await holdGpuStart();await control('chat','hide-pet');
  assert.match((await hidden.promise).error,/隐藏/);
  await assert.rejects(control('chat','start-gpu-timing'),/显示桌宠/);
  await control('chat','show-pet');
  const reloading=await holdGpuStart();windows.get('pet').webContents.reload();
  assert.match((await reloading.promise).error,/重新加载/);
  await until(async()=>{const value=await(await request('/api/performance')).json();return value.sample?.frames>0&&value.sample?.renderGeneration===value.renderGeneration&&value.renderGeneration>report.renderGeneration;},'new model generation after cancelled GPU start',10000);
  assert.equal(await control('pet','gpu-timing-status',{...ack,requestId:reloading.event.requestId}),false);
  result.gpuTimingIpcVerified=true;
  result.realFramesObserved = report.sample.frames > 0;
  result.gpuRenderer = report.sample.gpuRenderer;
  result.sampleFps = report.sample.sampleFps;
  result.textureBytes = report.sample.textureBytes;
  result.frameCount = report.sample.frames;
  const state = await (await request('/api/state')).json();
  assert.equal(state.rendering.available, true);
  assert.equal(Object.hasOwn(state.rendering, 'samples'), false, 'ordinary state reads omit history');
  assert.equal(Object.hasOwn(state.rendering, 'history'), false);
  assert.equal((await request('/api/command', { method: 'POST', body: JSON.stringify({ type: 'state', state: 'thinking' }) })).status, 202);
  await delay(3100);
  const thinking = await until(async () => {
    const value = await (await request('/api/performance')).json();
    return value.samples?.some(sample => sample.state === 'thinking') ? value : null;
  }, 'thinking scene appears in bounded diagnostic history', 6000);
  result.thinkingSampleCount = thinking.samples.filter(sample => sample.state === 'thinking').length;
  await assert.rejects(control('pet', 'copy-performance'), /设置/);
  await assert.rejects(control('chat', 'render-sample', { frames: 1, sampledAtMs: 1 }), /仅桌宠/);
  await js('chat', `Array.from(document.querySelectorAll('.tabs button')).find(button=>button.textContent==='设置').click()`);
  await until(() => js('chat', `!!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='复制性能诊断')`), 'production diagnostics button');
  await js('chat', `(()=>{const details=Array.from(document.querySelectorAll('details')).find(node=>node.querySelector('summary')?.textContent==='性能与画质');details.open=true;Array.from(details.querySelectorAll('button')).find(button=>button.textContent==='采集 GPU 用时（15 秒）').click();})()`);
  await until(()=>js('chat',`(()=>{const value=document.querySelector('[data-gpu-timing-status]')?.textContent||'';return value&&!value.includes('正在确认')?value:null;})()`),'GPU capture UI receives real renderer acknowledgement',6000);
  const gpuReport=await until(async()=>{
    const value=await(await request('/api/performance')).json(),timing=value.sample?.gpuTiming;
    return timing&&timing.reason!=='not-started'&&!timing.active?value:null;
  },'GPU capture completes or explicitly reports unsupported/protected state',23000);
  const timing=gpuReport.sample.gpuTiming;
  assert.ok(['completed','unsupported','observer-overhead','timer-error'].includes(timing.reason),timing.reason);
  assert.equal(typeof timing.supported,'boolean');assert.equal(timing.active,false);
  assert.ok(timing.phases.every(phase=>['idle','thinking','idea','speaking','other'].includes(phase.label)));
  for(const field of ['samples','gpuMeanMs','gpuP95Ms','gpuMaxMs','pollCpuMaxMs','disjointCount','timeoutCount','pending'])assert.ok(Number.isFinite(timing[field])&&timing[field]>=0,field);
  assert.equal(Object.hasOwn(timing,'rawSamples'),false);
  if(!timing.supported){assert.equal(timing.samples,0);assert.ok(['unsupported','timer-error'].includes(timing.reason));}
  result.gpuTimingSummary={supported:timing.supported,reason:timing.reason,samples:timing.samples,phases:timing.phases.map(phase=>phase.label)};
  result.gpuTimingUiVerified=true;
  await js('chat', `Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='复制性能诊断').click()`);
  await until(() => copies.length === 1, 'mock clipboard receives the production button result', 5000);
  const copied = JSON.parse(copies[0]);
  assert.equal(copied.available, true); assert.ok(copied.sample.gpuRenderer); assert.ok(copied.samples.length > 0);
  assert.ok(copied.sample.gpuTiming);assert.equal(copied.sample.gpuTiming.active,false);
  const strings = [];
  function visit(value) { if (typeof value === 'string') strings.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); }
  visit(copied);
  for (const value of strings) {
    assert.ok(!value.includes(token), 'copied diagnostics never expose the pairing token');
    assert.doesNotMatch(value, /[A-Za-z]:[\\/]/, 'copied diagnostics never expose machine-local file paths');
  }
  assert.doesNotMatch(copies[0], /"(?:apiKey|ttsKey|modelRoot|dataDir|token|session)"\s*:/);
  result.clipboardCopies = copies.length; result.privateDataAbsent = true;
  assert.equal(copied.sample.meshBufferCacheEnabled,false,'experimental GPU buffer reuse is opt-in');
  assert.equal(copied.sample.ownedGlStateEnabled,true,'the dedicated desktop canvas avoids external snapshots by default');
  assert.equal(copied.sample.totalStateSaveCalls,0);assert.ok(copied.sample.stateSnapshotBypasses>0);
  assert.ok(copied.runId);assert.equal(copied.sample.renderGeneration,copied.renderGeneration);
  const beforeSwitch=copied.sample.receivedAt;
  await js('chat', `Array.from(document.querySelectorAll('label')).find(node=>node.textContent.includes('GPU 数据复用')).querySelector('input').click()`);
  const cached=await until(async()=>{const value=await(await request('/api/performance')).json();return value.quality?.cacheMeshBuffers===true&&value.sample?.meshBufferCacheEnabled===true&&value.sample?.meshBufferUploads>0&&value.sample?.meshBufferUploadSkips>0&&value.sample?.receivedAt>beforeSwitch?value:null;},'GPU reuse after the real UI switch',10000);
  await js('chat', `Array.from(document.querySelectorAll('label')).find(node=>node.textContent.includes('GPU 数据复用')).querySelector('input').click()`);
  await until(async()=>{const value=await(await request('/api/performance')).json();return value.quality?.cacheMeshBuffers===false&&value.sample?.meshBufferCacheEnabled===false&&value.sample?.receivedAt>cached.sample.receivedAt;},'legacy rendering restored after reload',10000);
  result.bufferCacheSwitchVerified=true;
  const beforeCompatibility=await(await request('/api/performance')).json();
  await js('chat', `Array.from(document.querySelectorAll('label')).find(node=>node.textContent.includes('保留 SDK 状态快照')).querySelector('input').click()`);
  const legacyState=await until(async()=>{const value=await(await request('/api/performance')).json();return value.quality?.preserveGlState===true&&value.sample?.ownedGlStateEnabled===false&&value.sample?.totalStateSaveCalls>0&&value.renderGeneration>beforeCompatibility.renderGeneration?value:null;},'compatibility state snapshots after reload',10000);
  assert.equal(legacyState.runId,copied.runId);assert.equal(legacyState.sample.renderGeneration,legacyState.renderGeneration);
  await js('chat', `Array.from(document.querySelectorAll('label')).find(node=>node.textContent.includes('保留 SDK 状态快照')).querySelector('input').click()`);
  await until(async()=>{const value=await(await request('/api/performance')).json();return value.quality?.preserveGlState===false&&value.sample?.ownedGlStateEnabled===true&&value.sample?.totalStateSaveCalls===0&&value.renderGeneration>legacyState.renderGeneration;},'dedicated state ownership restored after reload',10000);
  result.ownedStateSwitchVerified=true;
  result.windowsHidden = [...windows.values()].every(win => !win.__nativeIsVisible());
  assert.equal(result.windowsHidden, true);
  assert.equal(observedOrigins.size, 1);
  result.errors = failures; assert.deepEqual(failures, []);
  result.ok = true;
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  clearTimeout(timer); app.quit();
}
timer = setTimeout(() => fail(Error('Production rendering diagnostics fixture timed out')), 80000);
require('../desktop/main.cjs');
