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
  await js('chat', `(()=>{const details=Array.from(document.querySelectorAll('details')).find(node=>node.querySelector('summary')?.textContent==='性能与画质');details.open=true;Array.from(details.querySelectorAll('button')).find(button=>button.textContent==='复制性能诊断').click();})()`);
  await until(() => copies.length === 1, 'mock clipboard receives the production button result', 5000);
  const copied = JSON.parse(copies[0]);
  assert.equal(copied.available, true); assert.ok(copied.sample.gpuRenderer); assert.ok(copied.samples.length > 0);
  const strings = [];
  function visit(value) { if (typeof value === 'string') strings.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); }
  visit(copied);
  for (const value of strings) {
    assert.ok(!value.includes(token), 'copied diagnostics never expose the pairing token');
    assert.doesNotMatch(value, /[A-Za-z]:[\\/]/, 'copied diagnostics never expose machine-local file paths');
  }
  assert.doesNotMatch(copies[0], /"(?:apiKey|ttsKey|modelRoot|dataDir|token|session)"\s*:/);
  result.clipboardCopies = copies.length; result.privateDataAbsent = true;
  result.windowsHidden = [...windows.values()].every(win => !win.__nativeIsVisible());
  assert.equal(result.windowsHidden, true);
  assert.equal(observedOrigins.size, 1);
  result.errors = failures; assert.deepEqual(failures, []);
  result.ok = true;
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  clearTimeout(timer); app.quit();
}
timer = setTimeout(() => fail(Error('Production rendering diagnostics fixture timed out')), 55000);
require('../desktop/main.cjs');
