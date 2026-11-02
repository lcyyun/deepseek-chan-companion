/* Isolated real-model benchmark. Run with an ordinary Electron runtime:
 * electron scripts/benchmark-renderer.cjs --variant=baseline --baseline-ref=d3fb1dd --model=ABSOLUTE_DIR
 * Baseline defaults to the 0.21.1 adapter. Never connects to the user's running app.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const variant = arg('variant', 'after');
const baselineRef = arg('baseline-ref', 'd3fb1dd');
if (!['baseline', 'after'].includes(variant)) throw Error('variant must be baseline or after');
const width = Number(arg('width', '2560')), height = Number(arg('height', '1440')), dpr = Number(arg('dpr', '1'));
const hz = Number(arg('hz', '240'));
const modelRoot = path.resolve(arg('model', process.env.L2D_MODEL_ROOT || path.join(root, 'models', 'DeepSeek')));
const output = path.resolve(root, 'output/performance-022', `${variant}-${width}x${height}-dpr${dpr}-${hz}hz`);
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('force-device-scale-factor', String(dpr));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win, sampleTimer;
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
  const snapshot = variant === 'baseline' ? execFileSync('git', ['show', `${baselineRef}:src/renderer/live2d.ts`], { cwd: root, encoding: 'utf8', windowsHide: true }) : await fs.readFile(adapter, 'utf8');
  await fs.writeFile(path.join(output, 'adapter-snapshot.ts'), snapshot);
  const sourceRevision = execFileSync('git', ['rev-parse', variant === 'baseline' ? baselineRef : 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const contents = `export {createLive2D} from ${JSON.stringify(adapter.replaceAll('\\', '/'))};export {BehaviorController} from ${JSON.stringify(path.join(root, 'src/shared/behavior.mjs').replaceAll('\\', '/'))};`;
  const beforeAnchor = '// Each frame starts at authored defaults;';
  const afterAnchor = 'mirroredArm.restore(); restoreBasinShadow(); }';
  if (!snapshot.includes(beforeAnchor) || !snapshot.includes(afterAnchor)) throw Error('Adapter observation anchors changed');
  await build({ stdin: { contents, loader: 'ts', resolveDir: root }, outfile: path.join(output, 'harness.js'), bundle: true, format: 'esm', platform: 'browser',
    plugins: [{ name: 'observe-real-frames', setup(builder) {
      builder.onLoad({ filter: /[\\/]renderer[\\/]live2d\.ts$/ }, () => ({ loader: 'ts', resolveDir: path.dirname(adapter), contents: snapshot
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
  const options = variant === 'baseline' ? { maxTextureSize: 4096 } : { maxTextureSize: 3072, maxFps: 60, maxPixelRatio: 1.5, maxCanvasPixels: 2560 * 1440, antialias: false };
  const entry = `import {createLive2D,BehaviorController} from '/harness.js';
    window.benchErrors=[];window.__benchFrameCosts=[];window.benchTimes=[];window.benchDt=[];window.benchPhase='warmup';
    window.benchPhases=[];window.benchAudio=false;window.benchStart=performance.now();
    window.benchReady=createLive2D(document.querySelector('canvas'),{...${JSON.stringify(options)},manifest:${JSON.stringify(manifest)},
      fetcher:url=>fetch(url,{headers:{Authorization:'Bearer ${token}'}}),
      onFrame:(dt,elapsed)=>{window.benchTimes.push(performance.now());window.benchDt.push(dt);if(window.behavior){behavior.setAudioLevel(window.benchAudio?Math.max(0,Math.sin(elapsed*9))*.6:0);behavior.update(dt,elapsed);}},
      onError:e=>benchErrors.push(e.message)
    }).then(handle=>{window.avatar=handle;window.behavior=new BehaviorController(handle,{onEvent:event=>{if(event.type==='error')benchErrors.push(event.message||String(event.error));}});
      handle.setPlacement({scale:1.7,centerX:${width*.78},centerY:${height*.65},referenceWidth:370,referenceHeight:575});handle.setRenderActive?.(true);window.benchLoadMs=performance.now()-benchStart;return true;});
    window.benchMark=name=>{benchPhase=name;benchPhases.push({name,at:performance.now(),frame:benchTimes.length,cost:__benchFrameCosts.length});return true;};
    window.benchSnapshot=()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl');return{time:performance.now(),loadMs:benchLoadMs,phases:benchPhases,frames:benchTimes,dt:benchDt,costs:__benchFrameCosts,errors:benchErrors,canvas:{width:canvas.width,height:canvas.height,cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight,dpr:devicePixelRatio},context:gl.getContextAttributes(),stats:avatar.getPerformanceStats?.()||null};};`;
  await fs.writeFile(path.join(output, 'entry.js'), entry);
  const csp = (await fs.readFile(path.join(root, 'index.html'), 'utf8')).match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  if (!csp) throw Error('Production CSP missing');
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(`<html><head>${csp}</head><body style="margin:0;background:transparent"><canvas style="display:block;width:100vw;height:100vh"></canvas><script type="module" src="/entry.js"></script></body></html>`); return; }
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
  win=new BrowserWindow({width,height,show:false,transparent:true,frame:false,backgroundColor:'#00000000',webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
  win.setOpacity(254/255);win.webContents.setFrameRate(hz);win.webContents.setAudioMuted(true);
  win.webContents.on('console-message',details=>{if(details.level==='error'||details.level===3)consoleErrors.push(details.message);});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  progress('page loaded');
  const evaluate=source=>win.webContents.executeJavaScript(source);
  await evaluate('Promise.race([benchReady,new Promise((_,reject)=>setTimeout(()=>reject(Error("Model startup timed out")),45000))])');
  progress('model ready');
  await wait(3000);
  const phase=async(name,code,ms)=>{progress(name);console.log(`${variant}: ${name}`);await evaluate(`benchMark(${JSON.stringify(name)});${code};true`);await wait(ms);};
  await phase('idle','behavior.setState("idle")',4000);
  await phase('thinking','behavior.setState("thinking")',4000);
  await phase('speaking','behavior.setState("speaking");benchAudio=true;behavior.previewBodyAnimation("talk",{intensity:.8,durationMs:5000})',5000);
  await phase('petting','benchAudio=false;behavior.setState("idle");behavior.clearBodyAnimation();behavior.setPetting(true,{speed:.5,x:.5,y:.3})',5000);
  await phase('basin','behavior.setPetting(false);behavior.setBasinEnabled(true);setTimeout(()=>behavior.knockBasin(),400);setTimeout(()=>behavior.knockBasin(),1050);setTimeout(()=>behavior.knockBasin(),1700)',4000);
  await phase('hidden-explicit-pause','avatar.setRenderActive?.(false)',2000);
  await phase('resumed','avatar.setRenderActive?.(true);behavior.setBasinEnabled(false)',2000);
  await evaluate('benchMark("end")');
  sample();clearInterval(sampleTimer);
  const result=await evaluate('benchSnapshot()');
  progress('snapshot received');
  const summaries=[];
  for(let i=0;i<result.phases.length-1;i++){
    const p=result.phases[i],next=result.phases[i+1],times=result.frames.slice(p.frame,next.frame);
    const intervals=times.slice(1).map((time,index)=>time-times[index]);
    summaries.push({name:p.name,durationMs:next.at-p.at,frames:next.frame-p.frame,fps:(next.frame-p.frame)*1000/(next.at-p.at),intervalMs:stats(intervals),workMs:stats(result.costs.slice(p.cost,next.cost)),framesOver40ms:intervals.filter(ms=>ms>40).length});
  }
  const finalMetrics=memory.at(-1).processes;
  const peakKb=type=>Math.max(...memory.map(sample=>sample.processes.filter(p=>!type||p.type===type).reduce((sum,p)=>sum+p.memory.workingSetSize,0)));
  const report={variant,sourceRevision,adapterSha256:createHash('sha256').update(snapshot).digest('hex'),afterUsesWorkingTree:variant==='after',isolated:true,noModelOrTtsRequests:true,fixtureMode:'hidden offscreen, production adapter and BehaviorController; synthetic mouth envelope',
    window:{width,height,forcedDpr:dpr,offscreenFrameRate:hz},options,modelTextures,modelLoadMs:result.loadMs,canvas:result.canvas,context:result.context,adapterStats:result.stats,
    phaseResults:summaries,memory:{units:'KiB',peakAllWorkingSet:peakKb(),peakRendererWorkingSet:peakKb('Tab'),peakGpuWorkingSet:peakKb('GPU'),finalProcesses:finalMetrics},errors:[...result.errors,...consoleErrors]};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(output,'samples.json'),JSON.stringify({memory,frameTimes:result.frames,frameCosts:result.costs},null,2));
  await fs.writeFile(path.join(output,'model.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(report));
  await evaluate('behavior.destroy();avatar.destroy();true');win.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));clearTimeout(watchdog);app.exit(report.errors.length?1:0);
}
main().catch(error=>{clearInterval(sampleTimer);console.error(error);win?.destroy();server?.close();app.exit(1);});
