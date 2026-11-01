// Record the real production React interface, isolated from normal profiles.
// npx electron scripts/record-ui-promo.cjs [--stills-only]
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'video014', 'ui');
const profile = path.join(os.tmpdir(), 'l2d-promo-ui-' + process.pid);
const width = 1920, height = 1080, fps = 24;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', path.join(profile, 'profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
let service, win, encoder;
const report = { ok: false, width, height, fps, screenshots: [], commands: [], errors: [] };

(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(profile, { recursive: true });
  const { createService } = await import(pathToFileURL(path.join(root, 'server/index.mjs')).href);
  const { DEFAULT_MODEL_TUNING, sanitizeModelTuning } = await import(pathToFileURL(path.join(root, 'src/shared/model-tuning.mjs')).href);
  let tuning = sanitizeModelTuning(DEFAULT_MODEL_TUNING), basinEnabled = false;
  service = await createService({ port: 0, dataDir: path.join(profile, 'service'), modelRoot: path.join(profile, 'no-model'), staticRoot: path.join(root, 'dist') });
  service.events.on('command', event => report.commands.push({ type: event.command?.type, emotion: event.command?.emotion, animation: event.command?.animation }));
  const preload = path.join(profile, 'preload.cjs');
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('companion',{bootstrap:()=>ipcRenderer.invoke('promo-bootstrap'),control:(action,data)=>ipcRenderer.invoke('promo-control',action,data),onEvent:callback=>{const listener=(_e,value)=>callback(value);ipcRenderer.on('promo-event',listener);return()=>ipcRenderer.removeListener('promo-event',listener);}});`);
  ipcMain.handle('promo-bootstrap', () => ({ role: 'chat', url: service.url, token: service.token, modelTuning: tuning }));
  ipcMain.handle('promo-control', (_event, action, value) => {
    if (action === 'diagnostics') return { modelTuning: tuning, basinEnabled, mouseTracking: true, petScale: { scale: 1 }, hotkeyConflicts: [] };
    if (action === 'model-tuning') {
      tuning = sanitizeModelTuning(value, tuning);
      win.webContents.send('promo-event', { type: 'model-tuning', tuning });
      return tuning;
    }
    if (action === 'basin-enabled') {
      basinEnabled = value === true;
      win.webContents.send('promo-event', { type: 'basin-enabled', enabled: basinEnabled });
      return basinEnabled;
    }
    if (action === 'hide-chat') return null;
    throw Error('UI recording does not permit desktop operation: ' + action);
  });
  await app.whenReady();
  win = new BrowserWindow({ width, height, useContentSize: true, show: false, frame: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
  // A demonstration click must never trigger a model/API request.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const external = /^https?:/.test(details.url) && !details.url.startsWith(service.url + '/');
    callback({ cancel: external || details.url.startsWith(service.url + '/api/chat') });
  });
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) report.errors.push(event.message); });
  win.webContents.setFrameRate(fps);
  await win.loadURL(service.url + '/?view=chat');
  win.webContents.setZoomFactor(1.8);
  const js = code => win.webContents.executeJavaScript(code);
  const until = async predicate => { for (let i = 0; i < 100; i++) { if (await js(predicate)) return; await delay(40); } throw Error('UI not ready: ' + predicate); };
  const tab = async name => {
    await js(`Array.from(document.querySelectorAll('.tabs button')).find(button=>button.textContent===${JSON.stringify(name)}).click()`);
    await delay(230);
  };
  const screenshot = async name => {
    await delay(160);
    const image = await win.webContents.capturePage();
    if (image.getSize().width !== width || image.getSize().height !== height) throw Error('Unexpected capture size: '+JSON.stringify(image.getSize()));
    await fs.writeFile(path.join(output, name + '.png'), image.toPNG());
    report.screenshots.push(name + '.png');
  };
  const scroll = async (selector, y) => { await js(`document.querySelector(${JSON.stringify(selector)}).scrollTo({top:${y},behavior:'smooth'})`); await delay(500); };
  const slider = async (selector, value) => {
    await js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await delay(100);
  };
  await until('document.querySelectorAll(".tabs button").length===5');
  await screenshot('01-chat');
  await tab('肢体'); await screenshot('02-body');
  await scroll('.panel-scroll:not(.expression-panel)', 360); await screenshot('02b-body-hands');
  await tab('小表情'); await screenshot('03-expressions');
  await js(`Array.from(document.querySelectorAll('.expression-groups button')).find(button=>button.textContent==='趣味表情').click()`);
  await delay(200); await screenshot('03b-special-expressions');
  await js(`document.querySelector('[data-expression="squeezed"]').click()`);
  await delay(800); await screenshot('04-expression-tuning');
  await tab('调节'); await screenshot('05-tuning');
  await scroll('.tuning-panel', 190); await screenshot('05b-tuning-body');
  await tab('聊一会');

  if (!process.argv.includes('--stills-only')) {
    const file = path.join(output, 'ui-walkthrough.mp4');
    let stderr = '';
    encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', `${width}x${height}`,
      '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { windowsHide: true });
    encoder.stderr.on('data', chunk => { stderr += chunk; });
    const finished = new Promise((resolve, reject) => { encoder.on('error', reject); encoder.on('exit', code => code === 0 ? resolve() : reject(Error('ffmpeg ' + code + ': ' + stderr))); });
    let bitmap = (await win.webContents.capturePage()).toBitmap();
    win.webContents.on('paint', (_event, _rect, image) => { bitmap = image.toBitmap(); });
    const events = [
      [2, () => tab('肢体')],
      [4.5, () => scroll('.panel-scroll:not(.expression-panel)', 360)],
      [7, () => tab('小表情')],
      [8, async () => { await js(`Array.from(document.querySelectorAll('.expression-groups button')).find(button=>button.textContent==='全部').click();document.querySelector('.expression-panel').scrollTop=0`); }],
      [10, async () => { await js(`document.querySelector('[data-expression="happy"]').click()`); }],
      [12.3, () => slider('[data-expression-tuning="smile"]', .15)],
      [13.4, () => slider('[data-expression-tuning="smile"]', .3)],
      [15, () => tab('调节')],
      [16, () => scroll('.tuning-panel', 190)],
      [17.5, () => slider('[data-tuning="bodyMotion"]', .8)],
      [18.5, () => slider('[data-tuning="bodyMotion"]', 1.2)],
    ];
    const started = performance.now();
    let cursor = 0;
    for (let frame = 0; frame < fps * 21; frame++) {
      const now = frame / fps;
      while (cursor < events.length && now >= events[cursor][0]) {
        const action = events[cursor++][1];
        action().catch(error => report.errors.push(String(error)));
      }
      const wait = started + frame * 1000 / fps - performance.now();
      if (wait > 0) await delay(wait);
      if (!encoder.stdin.write(bitmap)) await new Promise(resolve => encoder.stdin.once('drain', resolve));
    }
    encoder.stdin.end(); await finished;
    report.video = { file: 'ui-walkthrough.mp4', durationSeconds: 21, frames: fps*21 };
  }
  report.ok = report.errors.length === 0;
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, screenshots: report.screenshots, video: report.video, output }));
  win.destroy(); await service.close(); app.exit(report.ok ? 0 : 1);
})().catch(async error => {
  report.error = String(error.stack || error);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.error(error); encoder?.kill(); win?.destroy(); await service?.close(); app.exit(1);
});
