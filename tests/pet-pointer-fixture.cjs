// Production main.tsx + React + BehaviorController, isolated from WebGL, audio,
// network, user profiles and OS mouse input. Chromium sendInputEvent exercises
// the renderer lifecycle, not Windows native routing. All windows stay hidden.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..'), directory = path.resolve(process.argv[2]);
const sourcePath = process.env.PET_POINTER_SOURCE || path.join(root, 'src/renderer/main.tsx');
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
let win;
const report = { hardwareAcceleration: false, realReactAndBehavior: true, cases: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.join(directory, 'result.json');
const runtimeStub = `
export async function createLive2D(canvas,options){
 const q=window.__qa;let elapsed=0;
 const runtime={setParameters:p=>Object.assign(q.params,p),getParameters:()=>[],
 getInteractionRegions:()=>{q.regionReads++;return({body:{x:100,y:40,width:400,height:500},fullBody:{x:100,y:40,width:400,height:500},head:{x:200,y:70,width:200,height:140},chest:{x:220,y:260,width:160,height:100},basin:q.basin?{x:210,y:50,width:180,height:100}:undefined,revision:0})},
 setRenderActive(active){q.renderActive=active;q.renderCalls.push(active)},
 setPlacement(){},setView(){},setModelTuning(){},setPoseOverlay(){},setPupilScale(){},setHandForeground(){},setCuddleHand(){},setImpactOverlay(){},setEarImpulse(){},setFaceOverlay(){},
 playMotion:async()=>{},stopMotion(){},setExpression:async()=>{},reset(){},destroy(){clearInterval(timer)}};
 const timer=setInterval(()=>{if(!q.renderActive)return;q.frames++;elapsed+=1/60;options.onFrame?.(1/60,elapsed)},1000/60);q.runtime=runtime;return runtime;
}`;
const stubs = {
  './api': `export const credentials=()=>window.__qa.boot;export const initialize=async()=>credentials();export const api=async path=>path==='/api/model-manifest'?{}:{voiceEnabled:false};export const events=callback=>{window.__qa.service.add(callback);return()=>window.__qa.service.delete(callback);};`,
  './live2d': runtimeStub,
  './audio': `export class SpeechPlayer{level(){return 0;}stop(){}destroy(){}async speak(_text,start){start?.();}}`,
  './basin-audio': `export class BasinSound{setVolume(){}setSound(){}stop(){}destroy(){}async prepare(){window.__qa.prepared=(window.__qa.prepared||0)+1;}async play(){window.__qa.sounds++;}}`,
  './behavior': `import {BehaviorController as Real,BEHAVIOR_PRESETS} from ${JSON.stringify(path.join(root, 'src/shared/behavior.mjs').replaceAll('\\','/'))};export {BEHAVIOR_PRESETS};export class BehaviorController extends Real{constructor(...args){super(...args);window.__qa.behavior=this;}setPetting(active,input){window.__qa.pets.push({active,input});super.setPetting(active,input);}tapChest(){const accepted=super.tapChest();window.__qa.taps.push(accepted);return accepted;}}`,
};
const setup = `
window.__qa={controls:[],pets:[],taps:[],sounds:0,params:{},errors:[],desktop:new Set(),service:new Set(),failSet:0,failRelease:0,setFailures:0,releaseFailures:0,dropRelease:false,basin:false,renderActive:true,renderCalls:[],frames:0,regionReads:0,boot:{url:'http://fixture.invalid',token:'fixture',role:'pet',basinEnabled:false,renderActive:true}};
const q=window.__qa;
const fixture=JSON.parse(new URLSearchParams(location.search).get('fixture')||'{}');
q.boot.renderActive=fixture.bootActive!==false;
q.diagnosticsActive=fixture.diagnosticsActive??q.boot.renderActive;
window.companion={bootstrap:async()=>q.boot,control:async(action,value)=>{q.controls.push({action,value});if(action==='diagnostics'){const result={dragMode:false,basinEnabled:q.basin,renderActive:q.diagnosticsActive};if(fixture.deferDiagnostics)return new Promise(resolve=>{q.resolveDiagnostics=()=>resolve(result)});return result;}return true;},onEvent:callback=>{q.desktop.add(callback);return()=>q.desktop.delete(callback);}};
q.emit=event=>{if(event.type==='basin-enabled')q.basin=event.enabled;for(const callback of q.desktop)callback(event);};
window.addEventListener('error',event=>{q.errors.push(event.message);event.preventDefault();});
const capture=Element.prototype.setPointerCapture,release=Element.prototype.releasePointerCapture,has=Element.prototype.hasPointerCapture;
Element.prototype.setPointerCapture=function(id){if(q.failSet>0){q.failSet--;q.setFailures++;throw new DOMException('Injected missing pointer','NotFoundError');}return capture.call(this,id);};
Element.prototype.hasPointerCapture=function(id){return q.failRelease>0||has.call(this,id);};
Element.prototype.releasePointerCapture=function(id){if(q.failRelease>0){q.failRelease--;q.releaseFailures++;throw new DOMException('Injected lost pointer','NotFoundError');}return release.call(this,id);};
for(const type of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(type,event=>{if(q.dropRelease)event.stopImmediatePropagation();},true);
`;

async function evaluate(code) { return win.webContents.executeJavaScript(code); }
async function until(code) {
  for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(15); }
  throw Error('Expected renderer state: ' + code);
}
const head = { x: 300, y: 130 }, chest = { x: 300, y: 314 };
function input(type, point = head) {
  const bounds = win.getContentBounds();
  win.webContents.sendInputEvent({ type, ...point, globalX: bounds.x + point.x, globalY: bounds.y + point.y, button: 'left', clickCount: 1 });
}
async function click(point = head) { input('mouseDown', point); await delay(25); input('mouseUp', point); await delay(40); }
async function fresh(initial = {}) {
  await win.loadFile(path.join(directory, 'index.html'), { query: { fixture: JSON.stringify(initial) } });
  await until('!!window.__qa.behavior && !document.querySelector(".model-status")');
}
async function check(name, task, initial = {}) {
  await fresh(initial);
  try { await task(); report.cases.push({ name, ok: true }); }
  catch (error) { report.cases.push({ name, ok: false, error: String(error.stack || error), browserErrors: await evaluate('__qa.errors') }); }
}
async function lockedSession() {
  return evaluate(`(()=>{const rows=__qa.controls.filter(c=>c.action==='pet-pointer-lock'&&c.value?.locked===true);return rows.at(-1)?.value.id;})()`);
}
async function releaseNative(id, point) {
  const bounds = win.getContentBounds();
  await evaluate(`__qa.emit(${JSON.stringify({ type: 'pet-pointer-release', id, x: bounds.x + point.x, y: bounds.y + point.y })})`);
}

(async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  await build({ stdin: { contents: source, sourcefile: 'main.tsx', loader: 'tsx', resolveDir: path.join(root, 'src/renderer') },
    bundle: true, format: 'iife', platform: 'browser', outfile: path.join(directory, 'app.js'),
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
    plugins: [{ name: 'pet-pointer-boundaries', setup(builder) {
      builder.onResolve({ filter: /^\.\/(api|live2d|audio|basin-audio|behavior)$/ }, args =>
        args.resolveDir === path.join(root, 'src/renderer') ? { path: args.path, namespace: 'pet-pointer-stub' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'pet-pointer-stub' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: root }));
    } }],
  });
  await fs.writeFile(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script>${setup}</script><script src="app.js"></script>`);
  await app.whenReady();
  win = new BrowserWindow({ x: 0, y: 0, width: 800, height: 650, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  report.windowVisible = win.isVisible();
  await check('initially hidden bootstrap is corrected by the actual visible diagnostics snapshot', async () => {
    assert.equal(await evaluate('__qa.boot.renderActive'), false);
    await until('__qa.renderActive && __qa.frames>0');
    assert.equal(await evaluate('__qa.renderCalls.at(-1)'), true);
    assert.deepEqual(await evaluate('__qa.errors'), []);
  }, { bootActive: false, diagnosticsActive: true });
  await check('native show wins over stale hidden diagnostics, and native hide pauses frames and geometry work', async () => {
    await until('typeof __qa.resolveDiagnostics==="function"');
    assert.equal(await evaluate('__qa.renderActive'), false);
    assert.equal(await evaluate('__qa.frames'), 0);
    await evaluate('__qa.emit({type:"render-active",active:true})');
    await until('__qa.frames>0');
    await evaluate('__qa.resolveDiagnostics()');await delay(120);
    assert.equal(await evaluate('__qa.renderActive'), true, 'old hidden diagnostics cannot override a more recent show');
    input('mouseDown', head);await until('__qa.behavior.isPetting');
    await evaluate('__qa.emit({type:"input-cancel"});__qa.emit({type:"render-active",active:false})');
    input('mouseUp',head);await delay(60);
    const paused=await evaluate('({frames:__qa.frames,reads:__qa.regionReads})');
    await delay(240);
    assert.deepEqual(await evaluate('({frames:__qa.frames,reads:__qa.regionReads})'),paused);
    assert.equal(await evaluate('__qa.behavior.isPetting'),false);
    await evaluate('__qa.emit({type:"render-active",active:true})');
    await until(`__qa.frames>${paused.frames}`);
    input('mouseDown',head);await until('__qa.behavior.isPetting');input('mouseUp',head);
    assert.deepEqual(await evaluate('__qa.errors'), []);
  }, { bootActive: false, diagnosticsActive: false, deferDiagnostics: true });
  await check('native hide wins over stale visible diagnostics and DOM visibility cannot resume a hidden desktop pet', async () => {
    await until('__qa.frames>0 && typeof __qa.resolveDiagnostics==="function"');
    await evaluate('__qa.emit({type:"render-active",active:false});__qa.resolveDiagnostics()');await delay(60);
    assert.equal(await evaluate('__qa.renderActive'),false);
    const calls=await evaluate('__qa.renderCalls.length'),frames=await evaluate('__qa.frames');
    await evaluate('document.dispatchEvent(new Event("visibilitychange"))');await delay(100);
    assert.equal(await evaluate('__qa.renderCalls.length'),calls);
    assert.equal(await evaluate('__qa.frames'),frames);
    await evaluate('__qa.emit({type:"render-active",active:true})');await until(`__qa.frames>${frames}`);
  }, { bootActive: true, diagnosticsActive: true, deferDiagnostics: true });
  for (const kind of ['head', 'basin', 'chest']) await check(`setPointerCapture failure preserves ${kind} interaction and the next contact`, async () => {
    if (kind === 'basin') await evaluate('__qa.emit({type:"basin-enabled",enabled:true})');
    await evaluate('__qa.failSet=1');
    input('mouseDown', kind === 'chest' ? chest : head); await delay(45);
    assert.equal(await evaluate('__qa.setFailures'), 1);
    if (kind === 'head') assert.equal(await evaluate('__qa.behavior.isPetting'), true);
    if (kind === 'basin') assert.equal(await evaluate('__qa.sounds'), 1);
    input('mouseUp', kind === 'chest' ? chest : head); await delay(45);
    if (kind === 'chest') assert.deepEqual(await evaluate('__qa.taps'), [true]);
    await evaluate('__qa.behavior.reset();__qa.emit({type:"basin-enabled",enabled:false})');
    input('mouseDown', head); await delay(40);
    assert.equal(await evaluate('__qa.behavior.isPetting'), true, 'a later head contact still works');
    input('mouseUp', head);
    assert.deepEqual(await evaluate('__qa.errors'), [], 'capture exceptions must be contained');
  });
  await check('a new primary down takes over after both pointerup and cancellation were lost', async () => {
    input('mouseDown', head); await delay(35);
    assert.equal(await evaluate('__qa.behavior.isPetting'), true);
    await evaluate('__qa.dropRelease=true'); input('mouseUp', head); await delay(60);
    await evaluate('__qa.dropRelease=false');
    input('mouseDown', chest);
    await until('!__qa.behavior.isPetting');
    // Advance the fake runtime's frames explicitly: the real behavior blocks
    // chest taps during petting's fade. CPU load must not turn that unrelated
    // fade into a 450ms pointer-hold failure in this lifecycle regression.
    await evaluate('for(let i=0;i<30;i++)__qa.behavior.update(1/60)');
    input('mouseUp', chest); await delay(40);
    assert.equal(await evaluate('__qa.behavior.isPetting'), false);
    assert.deepEqual(await evaluate('__qa.taps'), [true], 'new chest down replaces the stale head hold');
  });
  await check('native pointer release is session-scoped and cannot end a newer contact', async () => {
    input('mouseDown', chest); await delay(30); const old = await lockedSession();
    assert.equal(typeof old, 'string');
    await evaluate('__qa.dropRelease=true'); input('mouseUp', chest); await delay(35); await evaluate('__qa.dropRelease=false');
    input('mouseDown', chest); await delay(30); const current = await lockedSession();
    assert.equal(typeof current, 'string'); assert.notEqual(current, old);
    await evaluate('document.querySelector(".pet-stage").dispatchEvent(new PointerEvent("lostpointercapture",{bubbles:true,pointerId:1,isPrimary:true}))');
    assert.equal(await evaluate('document.querySelector(".pet-stage").hasPointerCapture(1)'), true, 'a late old lostcapture cannot release the new capture');
    await releaseNative(old, chest); await delay(25);
    assert.deepEqual(await evaluate('__qa.taps'), [], 'old release cannot complete the new chest tap');
    await releaseNative(current, chest); await delay(35);
    assert.deepEqual(await evaluate('__qa.taps'), [true]);
    await releaseNative(current, chest); input('mouseUp', chest); await delay(35);
    assert.deepEqual(await evaluate('__qa.taps'), [true], 'native and Chromium release are idempotent');
  });
  await check('releasePointerCapture failure cannot leave petting active or block a later tap', async () => {
    input('mouseDown', head); await delay(35); await evaluate('__qa.failRelease=1');
    input('mouseUp', head); await delay(950);
    assert.equal(await evaluate('__qa.releaseFailures'), 1);
    assert.equal(await evaluate('__qa.behavior.isPetting'), false);
    assert.deepEqual(await evaluate('__qa.errors'), []);
    await evaluate('for(let i=0;i<30;i++)__qa.behavior.update(1/60)');
    await click(chest); assert.deepEqual(await evaluate('__qa.taps'), [true]);
  });
  await check('native release preserves chest movement and hold thresholds without restarting head feedback', async () => {
    input('mouseDown', chest); await delay(30); let id = await lockedSession();
    assert.equal(typeof id, 'string');
    await releaseNative(id, { x: chest.x + 30, y: chest.y }); input('mouseUp', chest); await delay(35);
    assert.deepEqual(await evaluate('__qa.taps'), [], 'a native release outside the tap tolerance is a drag');
    input('mouseDown', chest); await delay(500); id = await lockedSession();
    await releaseNative(id, chest); input('mouseUp', chest); await delay(35);
    assert.deepEqual(await evaluate('__qa.taps'), [], 'a native release cannot turn a long hold into a tap');
    input('mouseDown', head); await delay(30); id = await lockedSession();
    await releaseNative(id, head); input('mouseUp', head); await delay(950);
    assert.equal(await evaluate('__qa.behavior.isPetting'), false);
    assert.equal(await evaluate('document.querySelector(".pet-stage").hasPointerCapture(1)'), false);
  });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  win.destroy(); app.exit(0);
})().catch(async error => {
  await fs.writeFile(output, JSON.stringify({ ...report, fatal: String(error.stack || error) }, null, 2));
  win?.destroy(); app.exit(1);
});
