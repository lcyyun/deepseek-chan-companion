/* Visible native-window probe. Run with an ordinary Electron runtime:
 * electron scripts/benchmark-thinking-gl.cjs --model=ABSOLUTE_DIR
 * Measures thinking GL calls/profile stages, owned-context and cache A/B.
 * Never connects to the user's companion; no forced GPU synchronization is inserted.
 */
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const {buildInputShape}=require('../desktop/pet-input.cjs');
const { createServer } = require('node:http');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readBenchmarkRevision, readBenchmarkBaseline } = require('./benchmark-source.cjs');
const { createHash } = require('node:crypto');
const { getPriority } = require('node:os');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const variant = arg('variant', 'after');
const baselineRef = arg('baseline-ref', '6c6a747');
if (!['baseline', 'after'].includes(variant)) throw Error('variant must be baseline or after');
const width = Number(arg('width', '2560')), height = Number(arg('height', '1440')), dpr = Number(arg('dpr', '1'));
const hz = Number(arg('hz', '240'));
const cssWidth=Number(arg('css-width',String(width))),cssHeight=Number(arg('css-height',String(height)));
const tag=arg('tag','gl');if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid tag');
const glProfile=arg('gl-profile','on')!=='off',cacheMode=arg('cache-mode','legacy'),suite=arg('suite','profile');
const preserveState=arg('preserve-gl-state','on');
const sampleMs=Number(arg('sample-ms','4000')),settleMs=Number(arg('settle-ms','1800'));
if(!['legacy','cached'].includes(cacheMode)||!['profile','cache','state'].includes(suite)||!['on','off'].includes(preserveState))throw Error('Invalid cache-mode, suite or preserve-gl-state');
const scale=Number(arg('scale','4')),centerYFactor=Number(arg('center-y-factor','.9'));
if(!Number.isFinite(scale)||scale<.5||scale>4||!Number.isFinite(centerYFactor)||centerYFactor<0||centerYFactor>2)throw Error('Invalid scale or center-y-factor');
const modelRoot = path.resolve(arg('model', process.env.L2D_MODEL_ROOT || path.join(root, 'models', 'DeepSeek')));
const output = path.resolve(root, 'output/thinking-gl-probe', `${tag}-${variant}-${cssWidth}x${cssHeight}-dpr${dpr}-scale${scale}-cy${centerYFactor}`);
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('force-device-scale-factor', String(dpr));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win, sampleTimer;
let shapeMode='fixed',shapeKey='',shapeEnvelope=null,phaseName='warmup';
const shapeEvents=[],loopSamples=[],rendererPrioritySamples=[];let loopTimer;
function sampleOwnRendererPriority(){const pid=win?.webContents.getOSProcessId();try{return{pid,priority:getPriority(pid)};}catch{return{pid,priority:null};}}
function shapeUpdate(regions){
  if(!win||win.isDestroyed()||!regions?.body)return;
  const size=win.getContentSize();
  const quant=r=>({x:Math.floor(r.x/4)*4,y:Math.floor(r.y/4)*4,width:Math.ceil((r.x+r.width)/4)*4-Math.floor(r.x/4)*4,height:Math.ceil((r.y+r.height)/4)*4-Math.floor(r.y/4)*4});
  let shapes;
  if(shapeMode==='fixed')shapes=[{x:0,y:0,width:size[0],height:size[1]}];
  else if(shapeMode==='envelope'){
    const r=regions.fullBody||regions.body;
    if(!shapeEnvelope||r.x<shapeEnvelope.x+8||r.y<shapeEnvelope.y+8||r.x+r.width>shapeEnvelope.x+shapeEnvelope.width-8||r.y+r.height>shapeEnvelope.y+shapeEnvelope.height-8)shapeEnvelope={x:r.x-48,y:r.y-48,width:r.width+96,height:r.height+96};
    shapes=buildInputShape({regions:[shapeEnvelope],width:size[0],height:size[1],padding:0});
  }else shapes=buildInputShape({regions:[quant(regions.fullBody||regions.body),quant(regions.body)],width:size[0],height:size[1],padding:18*scale});
  const key=JSON.stringify(shapes);let duration=0,applied=false;
  if(key!==shapeKey||shapeMode==='forced'){const start=performance.now();win.setShape(shapes);duration=performance.now()-start;shapeKey=key;applied=true;}
  shapeEvents.push({at:Date.now(),phase:phaseName,applied,duration});
}

let watchdog;
const memory = [], consoleErrors = [];
const token = 'isolated-renderer-benchmark';
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };
const stats = values => {
  if (!values.length) return { count: 0, mean: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.floor((sorted.length - 1) * .95)], max: sorted.at(-1) };
};
async function main() {
  await fs.mkdir(output, { recursive: true });
  const progress = stage => require('node:fs').appendFileSync(path.join(output, 'progress.log'), `${new Date().toISOString()} ${stage}\n`);
  watchdog = setTimeout(() => { progress('WATCHDOG'); win?.destroy(); server?.close(); app.exit(2); }, 120000);
  progress('start');
  const adapter = path.join(root, 'src/renderer/live2d.ts');
  const snapshot = variant === 'baseline' ? readBenchmarkBaseline({ root, baselineRef }) : await fs.readFile(adapter, 'utf8');
  if(preserveState==='off'&&!snapshot.includes('preserveGlState'))throw Error('Owned-context integration is not ready; refusing an ignored A/B option');
  await fs.writeFile(path.join(output, 'adapter-snapshot.ts'), snapshot);
  const cachePath=path.join(root,'src/renderer/mesh-buffer-cache.ts');const cacheSource=await fs.readFile(cachePath,'utf8').catch(()=>null);
  if(cacheSource)await fs.writeFile(path.join(output,'mesh-buffer-cache-snapshot.ts'),cacheSource);
  const ownedPath=path.join(root,'src/renderer/owned-gl-state.ts');const ownedSource=await fs.readFile(ownedPath,'utf8').catch(()=>null);
  if(ownedSource)await fs.writeFile(path.join(output,'owned-gl-state-snapshot.ts'),ownedSource);
  const sourceRevision = readBenchmarkRevision({ root, variant, baselineRef });
  const contents = `export {createLive2D} from ${JSON.stringify(adapter.replaceAll('\\', '/'))};export {BehaviorController} from ${JSON.stringify(path.join(root, 'src/shared/behavior.mjs').replaceAll('\\', '/'))};`;
  const beforeAnchor = '// Each frame starts at authored defaults;';
  const afterAnchor = 'mirroredArm.restore(); restoreBasinShadow(); }';
  if (!snapshot.includes(beforeAnchor) || !snapshot.includes(afterAnchor)) throw Error('Adapter observation anchors changed');
  await build({ stdin: { contents, loader: 'ts', resolveDir: root }, outfile: path.join(output, 'harness.js'), bundle: true, format: 'esm', platform: 'browser',
    plugins: [{ name: 'observe-real-frames', setup(builder) {
      if(cacheSource)builder.onLoad({filter:/[\\/]mesh-buffer-cache\.ts$/},()=>({loader:'ts',resolveDir:path.dirname(cachePath),contents:cacheSource}));
      if(ownedSource)builder.onLoad({filter:/[\\/]owned-gl-state\.ts$/},()=>({loader:'ts',resolveDir:path.dirname(ownedPath),contents:ownedSource}));
      builder.onLoad({ filter: /[\\/]renderer[\\/]live2d\.ts$/ }, () => ({ loader: 'ts', resolveDir: path.dirname(adapter), contents: snapshot
        .replace('if (!thinkingHandFront || !handDrawables.size)', 'if ((window as any).__probeNoForeground || !thinkingHandFront || !handDrawables.size)')
        .replace('renderer = new sdk.CubismRenderer_WebGL();', `
          if ((window as any).glProfileEnabled && !(window as any).__profileHookInstalled) {
            (window as any).__profileHookInstalled=true;
            for (const method of ['saveProfile','doDrawModel','restoreProfile']) {
              const original=sdk.CubismRenderer_WebGL.prototype[method];
              if(typeof original!=='function')continue;
              sdk.CubismRenderer_WebGL.prototype[method]=function(...args:any[]) {
                const scope=(window as any), skip=scope.__probeNoProfile && method!=='doDrawModel';
                if(!scope.glCollect)return skip?undefined:original.apply(this,args);
                const group=scope.profileGroups[scope.benchPhase]||(scope.profileGroups[scope.benchPhase]={});
                const row=group[method]||(group[method]={count:0,totalMs:0,maxMs:0,skipped:0});
                const began=performance.now();
                try {if(skip){row.skipped++;return;}return original.apply(this,args);}
                finally{const ms=performance.now()-began;row.count++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);}
              };
            }
          }
          renderer = new sdk.CubismRenderer_WebGL();`)
        .replace('renderer.startUp(gl);', 'renderer.startUp(gl); if ((window as any).glProfileEnabled) { const probeDraw = renderer.drawMeshWebGL; renderer.drawMeshWebGL = function(...args: any[]) { if ((window as any).glCollect) { const key = (window as any).benchPhase, groups = (window as any).meshGroups; const group = groups[key] || (groups[key] = {mask:0,art:0}); group[this.isGeneratingMask()?\"mask\":\"art\"]++; } return probeDraw.apply(this,args); }; }')
        .replace(beforeAnchor, '(window as any).__benchFrameStarted=performance.now(); ' + beforeAnchor)
        .replace(afterAnchor, afterAnchor + ' (window as any).__benchFrameCosts?.push(performance.now()-(window as any).__benchFrameStarted);') }));
    } }] });
  progress('bundle ready');
  const files = await fs.readdir(modelRoot);
  const modelFile = files.find(name => name.endsWith('.model3.json'));
  if (!modelFile) throw Error('No model3.json in the explicit model directory');
  const model = JSON.parse(await fs.readFile(path.join(modelRoot, modelFile), 'utf8'));
  // The original model stores its author motions/expressions beside model3,
  // without listing them in FileReferences. Match production discovery.
  const discover=async(suffix, directory=modelRoot)=>{
    const result=[];
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      const full=path.join(directory,entry.name);
      if(entry.isDirectory())result.push(...await discover(suffix,full));
      else if(entry.isFile()&&entry.name.endsWith(suffix))result.push({name:entry.name.slice(0,-suffix.length),file:path.relative(modelRoot,full).replaceAll('\\','/')});
    }
    return result;
  };
  const manifest = { modelUrl: `/model/${encodeURIComponent(modelFile)}`,
    motions: await discover('.motion3.json'), expressions: await discover('.exp3.json') };
  if(!manifest.motions.length||!manifest.expressions.length)throw Error('Author actions/expressions are required for this benchmark');
  const modelTextures = [];
  for (const file of model.FileReferences.Textures) {
    const fd = await fs.open(path.join(modelRoot, file), 'r');
    try { const bytes = Buffer.alloc(24); await fd.read(bytes, 0, 24, 0); modelTextures.push({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }); }
    finally { await fd.close(); }
  }
  const options = { preserveGlState:preserveState==='on', cacheMeshBuffers:cacheMode==='cached', maxTextureSize: 3072, maxFps: 60, maxPixelRatio: 1.5, maxCanvasPixels: 2560 * 1440, antialias: false };
  const entry = `import {createLive2D,BehaviorController} from '/harness.js';
    window.glProfileEnabled=${glProfile};window.__probeNoForeground=false;window.__probeNoLoading=false;window.__probeNoProfile=false;window.profileGroups={};window.glGroups={};window.meshGroups={};window.glCollect=false;
    const contextOriginal=HTMLCanvasElement.prototype.getContext;
    const wrapped=new WeakSet();
    HTMLCanvasElement.prototype.getContext=function(...args){
      const gl=contextOriginal.apply(this,args);
      if(window.glProfileEnabled&&gl&&String(args[0]).startsWith('webgl')&&!wrapped.has(gl)){
        wrapped.add(gl);let textureUnit=gl.TEXTURE0;const textureBindings=new Map();
        for(const name of ['drawElements','bufferData','bufferSubData','getParameter','getVertexAttrib','isEnabled','getError','bindFramebuffer','framebufferTexture2D','clear','useProgram','activeTexture','bindTexture','texImage2D','createProgram','linkProgram','getProgramParameter','getShaderParameter','compileShader','flush','finish']){
          if(typeof gl[name]!=='function')continue;const original=gl[name];
          gl[name]=function(...values){
            if(!window.glCollect)return original.apply(this,values);
            const key=window.benchPhase;
            const group=window.glGroups[key]||(window.glGroups[key]={});
            const row=group[name]||(group[name]={count:0,totalMs:0,maxMs:0,over1ms:0,bytes:0,elements:0});
            const started=performance.now();
            try{return original.apply(this,values);}finally{
              const ms=performance.now()-started;row.count++;row.totalMs+=ms;if(name==='activeTexture')textureUnit=values[0];if(name==='bindTexture'){const slot=textureUnit+':'+values[0];if(textureBindings.get(slot)!==values[1]){row.changed=(row.changed||0)+1;textureBindings.set(slot,values[1]);}}row.maxMs=Math.max(row.maxMs,ms);if(ms>1)row.over1ms++;
              if(name==='getParameter'||name==='getVertexAttrib'||name==='isEnabled'){
                const slot=name==='getVertexAttrib'?values[0]+':'+values[1]:String(values[0]);
                const argumentsMap=row.arguments||(row.arguments={});const call=argumentsMap[slot]||(argumentsMap[slot]={count:0,totalMs:0,maxMs:0});
                call.count++;call.totalMs+=ms;call.maxMs=Math.max(call.maxMs,ms);
              }
              if(name==='bufferData')row.bytes+=typeof values[1]==='number'?values[1]:(values[1]?.byteLength||0);
              if(name==='bufferSubData')row.bytes+=values[2]?.byteLength||0;
              if(name==='drawElements')row.elements+=values[1]||0;
            }
          };
        }
      }
      return gl;
    };
    window.benchErrors=[];window.__benchFrameCosts=[];window.benchTimes=[];window.benchDt=[];window.benchPhase='warmup';
    window.benchPhases=[];window.benchAudio=false;window.benchStart=performance.now();window.benchVisibility=[];document.addEventListener('visibilitychange',()=>benchVisibility.push({at:performance.now(),visibility:document.visibilityState}));
    window.benchReady=createLive2D(document.querySelector('canvas'),{...${JSON.stringify(options)},manifest:${JSON.stringify(manifest)},
      fetcher:url=>fetch(url,{headers:{Authorization:'Bearer ${token}'}}),
      onFrame:(dt,elapsed)=>{window.benchTimes.push(performance.now());window.benchDt.push(dt);if(window.behavior){behavior.setAudioLevel(window.benchAudio?Math.max(0,Math.sin(elapsed*9))*.6:0);behavior.update(dt,elapsed);}},
      onError:e=>benchErrors.push(e.message)
    }).then(handle=>{window.avatar=handle;const expressionOriginal=handle.setExpression.bind(handle);handle.setExpression=(name,active)=>expressionOriginal(name,name==='加载'&&window.__probeNoLoading?false:active);window.behavior=new BehaviorController(handle,{random:()=>.4,onEvent:event=>{if(event.type==='error')benchErrors.push(event.message||String(event.error));}});
      handle.setPlacement({scale:${scale},centerX:${width*.32},centerY:${height*centerYFactor},referenceWidth:370,referenceHeight:575});handle.setRenderActive?.(true);window.benchLoadMs=performance.now()-benchStart;window.benchGeometryTimer=setInterval(()=>{const r=handle.getInteractionRegions();if(r)window.nativeProbe.geometry(r);},100);return true;});
    window.benchMark=name=>{benchPhase=name;benchPhases.push({name,at:performance.now(),frame:benchTimes.length,cost:__benchFrameCosts.length,visibility:document.visibilityState,focused:document.hasFocus()});return true;};
    window.benchSnapshot=()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl');return{glGroups:window.glGroups,meshGroups:window.meshGroups,profileGroups:window.profileGroups,time:performance.now(),documentVisibility:document.visibilityState,visibilityEvents:benchVisibility,loadMs:benchLoadMs,phases:benchPhases,frames:benchTimes,dt:benchDt,costs:__benchFrameCosts,errors:benchErrors,canvas:{width:canvas.width,height:canvas.height,cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight,dpr:devicePixelRatio},context:gl.getContextAttributes(),glErrorAfterMeasurement:gl.getError(),renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL||gl.RENDERER),stats:avatar.getPerformanceStats?.()||null};};`;
  await fs.writeFile(path.join(output, 'entry.js'), entry);
  const csp = (await fs.readFile(path.join(root, 'index.html'), 'utf8')).match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  if (!csp) throw Error('Production CSP missing');
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(`<html><head>${csp}</head><body style="margin:0;background:transparent;overflow:hidden"><canvas style="display:block;width:${cssWidth}px;height:${cssHeight}px"></canvas><script type="module" src="/entry.js"></script></body></html>`); return; }
      let base, file;
      if (['/harness.js', '/entry.js'].includes(url.pathname)) { base=output;file=path.join(base,url.pathname.slice(1)); }
      else if (url.pathname.startsWith('/vendor/')) {base=path.join(root,'public/vendor');file=path.resolve(base,decodeURIComponent(url.pathname.slice(8)));}
      else if (url.pathname.startsWith('/model/')) {if(request.headers.authorization!==`Bearer ${token}`){response.writeHead(401).end();return;}base=modelRoot;file=path.resolve(base,decodeURIComponent(url.pathname.slice(7)));}
      else {response.writeHead(404).end();return;}
      if (!file.startsWith(base+path.sep)) {response.writeHead(403).end();return;}
      response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
      const stream=createReadStream(file);stream.on('error',()=>response.destroy());stream.pipe(response);
    } catch {response.writeHead(500).end('Fixture request failed');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await app.whenReady();
  progress('app ready');
  const sample = () => memory.push({ at:Date.now(), processes:app.getAppMetrics().map(row=>({pid:row.pid,type:row.type,cpu:row.cpu.percentCPUUsage,memory:row.memory})) });
  sampleTimer=setInterval(sample,200);sample();
  const preload=path.join(output,'preload.cjs');
  await fs.writeFile(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('nativeProbe',{geometry:value=>ipcRenderer.send('native-probe-geometry',value)});`);
  win=new BrowserWindow({x:0,y:0,width,height,show:false,transparent:true,frame:false,skipTaskbar:true,focusable:true,title:'Temporary Native Rendering Probe',backgroundColor:'#00000000',webPreferences:{preload,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
  ipcMain.on('native-probe-geometry',(event,value)=>{if(event.sender===win.webContents)shapeUpdate(value);});
  win.setOpacity(254/255);win.setIgnoreMouseEvents(true);win.setAlwaysOnTop(true,'floating');win.webContents.setAudioMuted(true);
  let previousLoop=performance.now();loopTimer=setInterval(()=>{const now=performance.now();loopSamples.push({phase:phaseName,ms:now-previousLoop});previousLoop=now;},50);
  win.webContents.on('console-message',details=>{if(details.level==='error'||details.level===3)consoleErrors.push(details.message);});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  progress('page loaded');
  const evaluate=source=>win.webContents.executeJavaScript(source);
  await evaluate('Promise.race([benchReady,new Promise((_,reject)=>setTimeout(()=>reject(Error("Model startup timed out")),45000))])');
  progress('model ready');
  win.showInactive();
  await wait(3000);
  const phase=async(name,{state='thinking',noForeground=false,noLoading=false,loadingOnly=false,pointerOnly=false,noProfile=false,cuddle=false,idea=false,talk=false}={})=>{
    progress(name);phaseName=name;shapeMode='dynamic';shapeKey='';shapeEnvelope=null;
    rendererPrioritySamples.push({phase:name,...sampleOwnRendererPriority()});
    await evaluate(`glCollect=false;benchAudio=${talk};behavior.reset();window.__probeNoForeground=${noForeground};window.__probeNoLoading=${noLoading};window.__probeNoProfile=${noProfile};behavior.setState(${JSON.stringify(state)});${loadingOnly?"avatar.setExpression('加载',true);":''}${pointerOnly?"behavior.perform({type:'perform',intent:'explain',gesture:'pointer',durationMs:20000});":''}${cuddle?"behavior.perform({type:'perform',intent:'cuddle',emotion:'happy',durationMs:20000});":''}${idea?"behavior.perform({type:'perform',intent:'idea',emotion:'happy',gesture:'pointer',durationMs:6000,replyIntro:true});behavior.setState('idle');":''}${talk?"behavior.previewBodyAnimation('talk',{durationMs:20000,intensity:.7});":''}true`);
    await wait(settleMs);
    await evaluate(`benchMark(${JSON.stringify(name)});glCollect=true;true`);
    await wait(sampleMs);
    await evaluate(`glCollect=false;benchMark(${JSON.stringify(name+'-end')});true`);
  };
  if(suite==='state'){
    await phase('idle',{state:'idle'});await phase('thinking-full');await phase('idea-reply-intro-extended',{idea:true});
    await phase('speaking-talk',{state:'speaking',talk:true});await phase('cuddle',{state:'idle',cuddle:true});
  }else if(suite==='cache'){
    await phase('idle',{state:'idle'});await phase('thinking-full');await phase('cuddle',{state:'idle',cuddle:true});
  }else{
  await phase('idle',{state:'idle'});
  await phase('thinking-full');
  await phase('loading-only',{state:'idle',loadingOnly:true});
  await phase('thinking-no-foreground',{noForeground:true});
  await phase('thinking-no-loading',{noLoading:true});
  await phase('thinking-no-both',{noForeground:true,noLoading:true});
  await phase('pointer-only',{state:'idle',pointerOnly:true});
  await phase('thinking-no-profile',{noProfile:true});
  }
  await evaluate('benchMark("end")');
  sample();clearInterval(sampleTimer);clearInterval(loopTimer);
  const result=await evaluate('benchSnapshot()');
  progress('snapshot received');
  const verificationErrors=[];
  if(result.glErrorAfterMeasurement!==0)verificationErrors.push(`WebGL error after measurement: ${result.glErrorAfterMeasurement}`);
  if(cacheMode==='legacy'&&result.stats?.meshBufferCacheEnabled)verificationErrors.push('Mesh buffer caching unexpectedly enabled in the state-snapshot comparison');
  if(preserveState==='off'&&result.stats?.ownedGlStateEnabled!==true)verificationErrors.push('Owned GL state was not actually enabled');
  if(preserveState==='on'&&result.stats?.ownedGlStateEnabled===true)verificationErrors.push('Legacy state preservation was not actually selected');
  if(glProfile&&preserveState==='off')for(const [name,group]of Object.entries(result.glGroups))for(const query of ['getParameter','getVertexAttrib','isEnabled']){
    if(group[query]?.count)verificationErrors.push(`${name}: unexpected steady-state ${query} calls: ${group[query].count}`);
  }
  const summaries=[];
  for(let i=0;i<result.phases.length-1;i++){
    const p=result.phases[i],next=result.phases[i+1];if(p.name.endsWith('-end'))continue;const times=result.frames.slice(p.frame,next.frame);
    const intervals=times.slice(1).map((time,index)=>time-times[index]);
    summaries.push({name:p.name,documentVisibility:p.visibility,documentFocused:p.focused,durationMs:next.at-p.at,frames:next.frame-p.frame,fps:(next.frame-p.frame)*1000/(next.at-p.at),intervalMs:stats(intervals),workMs:stats(result.costs.slice(p.cost,next.cost)),framesOver40ms:intervals.filter(ms=>ms>40).length});
  }
  const finalMetrics=memory.at(-1).processes;
  const peakKb=type=>Math.max(...memory.map(sample=>sample.processes.filter(p=>!type||p.type===type).reduce((sum,p)=>sum+p.memory.workingSetSize,0)));
  const shapeSummary=result.phases.filter(p=>p.name!=='end').map(p=>{const rows=shapeEvents.filter(e=>e.phase===p.name),applied=rows.filter(e=>e.applied);return{name:p.name,geometryMessages:rows.length,shapeChanges:applied.length,shapeCallMs:stats(applied.map(e=>e.duration)),mainLoopMs:stats(loopSamples.filter(e=>e.phase===p.name).map(e=>e.ms))};});
  const report={variant,sourceRevision,glProfile,cacheMode,preserveGlState:preserveState==='on',suite,sampleMs,settleMs,cacheModuleSha256:cacheSource?createHash('sha256').update(cacheSource).digest('hex'):null,ownedStateModuleSha256:ownedSource?createHash('sha256').update(ownedSource).digest('hex'):null,adapterSha256:createHash('sha256').update(snapshot).digest('hex'),afterUsesWorkingTree:variant==='after',isolated:true,noModelOrTtsRequests:true,fixtureMode:'Visible native transparent window; GL methods wrapped only when requested; CPU/frame-clock timings are not GPU completion or final DWM presentation timings' ,
    window:{width,height,cssWidth,cssHeight,scale,centerYFactor,forcedDpr:dpr,opacity:win.getOpacity(),visible:win.isVisible(),focusable:win.isFocusable(),bounds:win.getBounds()},schedulingFlags:{backgroundThrottling:false,disableBackgroundTimerThrottling:app.commandLine.hasSwitch('disable-background-timer-throttling'),disableRendererBackgrounding:app.commandLine.hasSwitch('disable-renderer-backgrounding')},options,ideaTest:suite==='state'?{durationMs:6000,order:'setState(thinking), perform(idea, replyIntro), setState(idle)',note:'Duration extended from the production 3400ms only to obtain a stable measurement window'}:null,modelTextures,modelLoadMs:result.loadMs,canvas:result.canvas,context:result.context,glErrorAfterMeasurement:result.glErrorAfterMeasurement,adapterStats:result.stats,glGroups:result.glGroups,meshGroups:result.meshGroups,profileGroups:result.profileGroups,
    shapeSummary,rendererPrioritySamples,documentVisibility:result.documentVisibility,visibilityEvents:result.visibilityEvents,gpuFeatures:app.getGPUFeatureStatus(),renderer:result.renderer,phaseResults:summaries,memory:{units:'KiB',peakAllWorkingSet:peakKb(),peakRendererWorkingSet:peakKb('Tab'),peakGpuWorkingSet:peakKb('GPU'),finalProcesses:finalMetrics},errors:[...result.errors,...consoleErrors,...verificationErrors]};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(output,'samples.json'),JSON.stringify({memory,shapeEvents,loopSamples,frameTimes:result.frames,frameCosts:result.costs},null,2));
  await fs.writeFile(path.join(output,'model.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(report));
  progress('report saved');ipcMain.removeAllListeners('native-probe-geometry');
  await Promise.race([evaluate('clearInterval(benchGeometryTimer);behavior.destroy();avatar.destroy();true').catch(()=>{}),wait(1500)]);
  progress('dispose requested');server.closeAllConnections();server.close();win.destroy();clearTimeout(watchdog);app.exit(report.errors.length?1:0);
}
main().catch(error=>{clearInterval(sampleTimer);clearInterval(loopTimer);console.error(error);win?.destroy();server?.close();app.exit(1);});
