// Independent Windows native-input fixture. It does not connect to the pet or VTS.
// Run: node_modules/electron/dist/electron.exe tests/pet-input-smoke.cjs
// Diagnostic alternative: add --alpha-only (this Windows run blocked empty-area clicks).
// setShape receives DIP/CSS-sized rectangles; only native mouse target coordinates
// are converted with screen.dipToScreenPoint. Do not multiply shape bounds by DPI.
// Read SCREEN PHYSICAL targets from output/pet-input-smoke/result.json and click natively.
// DOM dispatchEvent/sendInputEvent are deliberately not used as evidence of OS routing.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = path.resolve(__dirname, '..', 'output', 'pet-input-smoke');
const nativeShapeEnabled = !process.argv.includes('--alpha-only');
const boundsSize = { width: 640, height: 420 };
const shape = [{ x: 160, y: 110, width: 320, height: 250 }];
const targets = {
  protectedTransparent: { x: 240, y: 220 },
  protectedPainted: { x: 400, y: 220 },
  protectedTopLeft: { x: 170, y: 140 },
  outside: { x: 80, y: 220 },
  boundaryInside: { x: 160, y: 310 },
  boundaryOutside: { x: 159, y: 310 },
  captureReleaseOutside: { x: 570, y: 300 },
};
const inShape = point => shape.some(r => point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height);
assert.equal(inShape(targets.protectedTransparent), true);
assert.equal(inShape(targets.protectedPainted), true);
assert.equal(inShape(targets.outside), false);
assert.equal(inShape(targets.boundaryInside), true);
assert.equal(inShape(targets.boundaryOutside), false);
assert.equal(inShape(targets.captureReleaseOutside), false);

let back, front, timeout, writeQueue = Promise.resolve(), closing = false, captureStartedInside = false;
const state = {
  fixture: 'native-window-shape', electron: process.versions.electron, platform: process.platform,
  pid: process.pid, guardBackground: 'rgba(0,0,0,.004)',
  shapeMode: nativeShapeEnabled ? 'native-shape-dip' : 'alpha-only-no-setShape',
  status: 'starting', validation: 'Only trusted pointer events from native clicks count. Geometric checks alone do not verify Windows routing.',
  shape, targets: {}, events: [], counts: { front: 0, back: 0 }, capturing: false,
  results: { transparentProtected: null, paintedProtected: null, outsidePassesThrough: null, captureRetainedOutside: null },
};
app.setName('L2D native-input test fixture');
app.setPath('userData', path.join(output, 'profile'));
// A GUI child may outlive its launcher's output pipe. Never write fixture logs there.
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});

function save() {
  const json = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const temporary = path.join(output, 'result.next.json');
    await fs.writeFile(temporary, json);
    await fs.rename(temporary, path.join(output, 'result.json'));
  });
  return writeQueue;
}
function nearestTarget(x, y) {
  let best, distance = Infinity;
  for (const [name, point] of Object.entries(targets)) {
    const next = Math.hypot(x - point.x, y - point.y);
    if (next < distance) { best = name; distance = next; }
  }
  return distance <= 18 ? best : null;
}
function updateCapture(enabled) {
  if (!front || front.isDestroyed()) return;
  if (nativeShapeEnabled) {
    const size = front.getContentBounds();
    const rects = enabled ? [{ x: 0, y: 0, width: size.width, height: size.height }] : shape;
    // BrowserWindow geometry is in DIP. Do not infer units from an external
    // GetWindowRgn probe unless that process's DPI awareness is explicitly known.
    front.setShape(rects);
    state.nativeShapeInputDip = rects;
  }
  state.capturing = enabled;
  state.currentAlwaysOnTop = front.isAlwaysOnTop();
}
function publish() {
  for (const win of [back, front]) if (win && !win.isDestroyed()) win.webContents.send('fixture-stats', { counts: state.counts, capturing: state.capturing, results: state.results });
  return save();
}
async function finish() {
  if (closing) return;
  closing = true; clearTimeout(timeout);
  state.status = Object.values(state.results).every(value => value === true) ? 'native-routing-passed' : 'ended-see-results';
  await save(); app.quit();
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  if (process.platform !== 'win32') { state.status = 'skipped-non-windows'; await save(); app.quit(); return; }
  const preload = path.join(output, 'preload.cjs');
  await fs.writeFile(preload, `const {ipcRenderer}=require('electron');
window.addEventListener('DOMContentLoaded',()=>{
  const role=document.body.dataset.role;
  const send=(type,e)=>ipcRenderer.send('fixture-pointer',{type,role,x:e.clientX,y:e.clientY,screenX:e.screenX,screenY:e.screenY,pointerId:e.pointerId,trusted:e.isTrusted});
  window.addEventListener('pointerdown',e=>{if(role==='front'){document.body.classList.add('capturing');document.body.setPointerCapture(e.pointerId);}send('down',e);});
  window.addEventListener('pointerup',e=>{document.body.classList.remove('capturing');send('up',e);});
  window.addEventListener('pointercancel',e=>{document.body.classList.remove('capturing');send('cancel',e);});
  window.addEventListener('lostpointercapture',e=>{document.body.classList.remove('capturing');send('lostcapture',e);});
  window.addEventListener('keydown',e=>{if(e.key==='Escape')ipcRenderer.send('fixture-close');});
  ipcRenderer.on('fixture-stats',(_e,s)=>{const el=document.querySelector('#counts');if(el)el.textContent='Front '+s.counts.front+' / Back '+s.counts.back+(s.capturing?' — capturing':'');});
});`);
  await app.whenReady();
  const display = screen.getPrimaryDisplay(), work = display.workArea;
  const bounds = { x: work.x + Math.round((work.width - boundsSize.width) / 2), y: work.y + Math.round((work.height - boundsSize.height) / 2), ...boundsSize };
  state.boundsDip = bounds; state.displayScaleFactor = display.scaleFactor;
  for (const [name, local] of Object.entries(targets)) {
    const dip = { x: bounds.x + local.x, y: bounds.y + local.y };
    state.targets[name] = { local, dip, physical: screen.dipToScreenPoint(dip), expectedWindow: inShape(local) ? 'front' : 'back' };
  }
  const common = { ...bounds, show: false, frame: false, resizable: false, movable: false, skipTaskbar: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } };
  back = new BrowserWindow({ ...common, title: 'L2D INPUT TEST — back counter', backgroundColor: '#f5f1dd' });
  front = new BrowserWindow({ ...common, title: 'L2D INPUT TEST — shaped transparent front', transparent: true, backgroundColor: '#00000000', alwaysOnTop: true });
  state.frontStages = [];
  const recordStage = stage => state.frontStages.push({ stage, alwaysOnTop: front.isAlwaysOnTop(), visible: front.isVisible(), bounds: front.getBounds() });
  recordStage('constructed');
  const handle = front.getNativeWindowHandle();
  state.nativeHandleHex = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(16);
  const html = role => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;font:15px Segoe UI,sans-serif;user-select:none}body{position:relative;background:${role === 'back' ? '#f5f1dd' : 'transparent'}}h1{font-size:20px;margin:20px}p{margin:10px 20px}.input-guard{position:absolute;left:160px;top:110px;width:320px;height:250px;background:rgba(0,0,0,.004);pointer-events:auto}.region{position:absolute;left:160px;top:110px;width:320px;height:250px;border:2px dashed #287ee0;pointer-events:none}.region b{display:block;margin:8px;color:#075493}.marker{position:absolute;width:120px;height:58px;transform:translate(-50%,-50%);text-align:center;display:grid;place-items:center;border:1px solid #b2a988;border-radius:8px}.paint{left:400px;top:220px;background:rgba(48,138,241,.3);border-color:#287ee0}#counts{position:absolute;bottom:24px;left:20px;font-weight:600}.close{position:absolute;bottom:2px;left:20px;font-size:12px;color:#74705e}</style><body data-role="${role}">${role === 'back' ? `<h1>Independent Windows input routing test</h1><p>Click the three marked points. Blue dashed area belongs to FRONT.</p><div class="marker" style="left:80px;top:220px">OUTSIDE<br>must reach BACK</div><div class="marker" style="left:240px;top:220px">ALPHA 1 GUARD<br>must reach FRONT</div><div class="marker" style="left:400px;top:220px">PAINTED<br>must reach FRONT</div><div id="counts">Front 0 / Back 0</div><div class="close">Esc closes only these test windows. Results: output/pet-input-smoke/result.json</div>` : `<div class="input-guard"></div><div class="region"><b>Native setShape + alpha 1 guard</b></div><div class="marker paint">PAINTED<br>FRONT</div>`}</body>`;
  const validSenders = new Map([[back.webContents.id, 'back'], [front.webContents.id, 'front']]);
  ipcMain.on('fixture-close', event => { if (validSenders.has(event.sender.id)) finish(); });
  ipcMain.on('fixture-pointer', (event, input) => {
    const role = validSenders.get(event.sender.id);
    if (!role || input.role !== role || !input.trusted) return;
    const target = nearestTarget(input.x, input.y);
    const record = { at: Date.now(), role, type: input.type, x: input.x, y: input.y, target, capturingBefore: state.capturing, trusted: true };
    state.events.push(record);
    if (state.events.length > 300) state.events.shift();
    if (input.type === 'down') {
      state.counts[role]++;
      if (target === 'protectedTransparent') state.results.transparentProtected = role === 'front';
      if (target === 'protectedPainted') state.results.paintedProtected = role === 'front';
      if (target === 'outside') state.results.outsidePassesThrough = role === 'back';
      if (role === 'front') { captureStartedInside = inShape(input); updateCapture(true); }
    }
    if (input.type === 'up' && role === 'front' && state.capturing && captureStartedInside && !inShape(input)) state.results.captureRetainedOutside = true;
    if (['up', 'cancel', 'lostcapture'].includes(input.type) && role === 'front') { updateCapture(false); captureStartedInside = false; }
    state.status = 'native-input-observed';
    publish().catch(() => {});
  });
  await back.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html('back')));
  const frontHtml = html('front').replace('</style>', '.capturing .input-guard{left:0;top:0;width:100%;height:100%}</style>').replace('Native setShape + alpha 1 guard', nativeShapeEnabled ? 'Native shape (DIP) + alpha 1 guard' : 'ALPHA ONLY — no native setShape');
  await front.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(frontHtml));
  front.setIgnoreMouseEvents(false);
  back.show(); front.show(); recordStage('shown'); front.focus(); recordStage('focused');
  await front.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  updateCapture(false); recordStage(nativeShapeEnabled ? 'shape-set-dip' : 'alpha-only-no-setShape');
  front.setAlwaysOnTop(true, 'screen-saver'); recordStage('topmost-explicit');
  state.currentAlwaysOnTop = front.isAlwaysOnTop();
  state.frontDiagnostics = {
    visible: front.isVisible(), alwaysOnTop: front.isAlwaysOnTop(), bounds: front.getBounds(), contentBounds: front.getContentBounds(),
    page: await front.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.input-guard'),paint=document.querySelector('.paint');return{role:document.body.dataset.role,width:innerWidth,height:innerHeight,guard:el?{background:getComputedStyle(el).backgroundColor,rect:el.getBoundingClientRect().toJSON()}:null,paint:paint?{background:getComputedStyle(paint).backgroundColor,rect:paint.getBoundingClientRect().toJSON()}:null};})()`),
  };
  const screenshot = await front.webContents.capturePage();
  await fs.writeFile(path.join(output, 'front.png'), screenshot.toPNG());
  const size = screenshot.getSize(), pixels = screenshot.toBitmap();
  let nontransparent = 0, blue = 0;
  for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3]) nontransparent++; if (pixels[i] > pixels[i + 2] + 30 && pixels[i + 3] > 40) blue++; }
  state.frontDiagnostics.capture = { size, nontransparent, blue };
  for (const win of [back, front]) win.on('close', () => { if (!closing) finish(); });
  state.status = 'awaiting-native-clicks';
  await save();
  const timeoutArg = process.argv.find(value => value.startsWith('--timeout='));
  const duration = Math.max(30000, Math.min(900000, Number(timeoutArg?.split('=')[1]) || 300000));
  timeout = setTimeout(finish, duration);
}
app.on('window-all-closed', () => { if (!closing) finish(); });
main().catch(async error => { state.status = 'fixture-error'; state.error = String(error?.stack || error); try { await save(); } finally { app.exit(1); } });
