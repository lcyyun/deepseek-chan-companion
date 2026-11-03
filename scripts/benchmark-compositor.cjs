/* Isolated production-window scheduling probe. Run with an ordinary Electron:
 * electron scripts/benchmark-compositor.cjs --model=ABSOLUTE_DIR --tag=baseline
 * Opens temporary native windows. Uses no user profile, DSH, TTS, or model API.
 * Diagnostic variants change only this process, never production defaults.
 */
'use strict';
const { app, screen, dialog, clipboard, session, contentTracing } = require('electron');
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const root=path.resolve(__dirname,'..');
const arg=(key,fallback)=>process.argv.find(value=>value.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
const tag=arg('tag','baseline');if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid tag');
const output=path.join(root,'output/compositor-probe',tag),directory=path.join(output,'profile');
const modelRoot=path.resolve(arg('model',process.env.L2D_MODEL_ROOT||''));
if(!fs.existsSync(modelRoot)||!fs.readdirSync(modelRoot).some(name=>name.endsWith('.model3.json')))throw Error('Pass an explicit model directory');
const sampleMs=Number(arg('sample-ms','6500')),settleMs=Number(arg('settle-ms','1500'));
if(!(sampleMs>=6000&&sampleMs<=15000&&settleMs>=1000&&settleMs<=5000))throw Error('Invalid timing');
fs.mkdirSync(directory,{recursive:true});app.setPath('userData',directory);
app.commandLine.appendSwitch('force-device-scale-factor',arg('dpr','1.5'));
const windows=new Map(),errors=[],nativeCalls=[],focusEvents=[];let variant='normal',currentPhase='startup',started=false,trace=false;
const fingerprint=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const report={sourceRevision:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true,encoding:'utf8'}).trim(),
  sourceHashes:Object.fromEntries(['desktop/main.cjs','desktop/preload.cjs','src/renderer/main.tsx','src/renderer/live2d.ts','dist/index.html'].map(file=>[file,fingerprint(file)])),
  isolated:true,productionEntry:true,errors,phases:[],focusEvents,createdAt:new Date().toISOString()};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function persist(){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
function progress(value){fs.appendFileSync(path.join(output,'progress.log'),`${new Date().toISOString()} ${value}\n`);}
function fail(error){errors.push(String(error?.stack||error));persist();app.exit(1);}
dialog.showErrorBox=(_title,message)=>fail(Error(message));clipboard.writeText=()=>{};
require('../desktop/mouse-input.cjs').startMouseInput=options=>{options.onButton(false);options.onSample({down:false,seq:0});return{ready:Promise.resolve(true),stop:()=>options.onButton(false)};};
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
const watchdog=setTimeout(()=>fail(Error('Probe timeout')),240000);
app.on('browser-window-created',(_event,win)=>{
  let role='unknown',shapeInitialized=false,lastTopmost=null;
  for(const event of ['focus','blur'])win.on(event,()=>focusEvents.push({event,role,at:Date.now(),phase:currentPhase}));
  // Never suppress the first native input shape. Changes are local diagnostic variants.
  for(const method of ['setShape','moveTop','setAlwaysOnTop']){
    const original=win[method].bind(win);
    win[method]=(...args)=>{
      const topmostKey=method==='setAlwaysOnTop'?JSON.stringify(args):null;
      const suppress=role==='pet'&&((variant==='frozen-shape'&&method==='setShape'&&shapeInitialized)||(variant==='no-raise'&&['moveTop','setAlwaysOnTop'].includes(method)))
        ||variant==='no-repeat-zorder'&&(method==='moveTop'||method==='setAlwaysOnTop'&&lastTopmost===topmostKey);
      const began=performance.now();const value=suppress?undefined:original(...args);
      if(method==='setAlwaysOnTop'&&!suppress)lastTopmost=topmostKey;
      if(method==='setShape'){shapeInitialized=true;if(!suppress)win.__lastNativeShape=args[0].map(rect=>({...rect}));}
      nativeCalls.push({at:Date.now(),role,method,suppressed:suppress,ms:performance.now()-began,phase:currentPhase});
      return value;
    };
  }
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(String(event.message));});
  win.webContents.on('did-finish-load',async()=>{
    try{
      const bootstrap=await win.webContents.executeJavaScript('window.companion.bootstrap()');
      role=bootstrap.role;windows.set(role,win);
      if(windows.size===3&&!started){started=true;await verify(bootstrap);}
    }catch(error){fail(error);}
  });
});
const js=(role,code)=>windows.get(role).webContents.executeJavaScript(code);
const control=(role,action,data)=>js(role,`window.companion.control(${JSON.stringify(action)},${JSON.stringify(data)})`);
async function until(test,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const result=await test();if(result)return result;await wait(100);}throw Error(`Timed out: ${label}`);}
function stats(values){if(!values.length)return{count:0,mean:0,p95:0,max:0};const sorted=[...values].sort((a,b)=>a-b);return{count:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};}
async function captureShapeCoverage(name){
  const pet=windows.get('pet'),image=await pet.webContents.capturePage(),size=image.getSize(),bitmap=image.toBitmap();
  if(bitmap.length!==size.width*size.height*4)throw Error('Unexpected captured bitmap dimensions');
  const bounds=pet.getContentBounds(),shape=pet.__lastNativeShape||[],holes=[...windows].filter(([role,win])=>role!=='pet'&&win.isVisible()).map(([,win])=>{const rect=win.getBounds();return{x:rect.x-bounds.x,y:rect.y-bounds.y,width:rect.width,height:rect.height};});
  const inside=(x,y,rects)=>rects.some(r=>x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height);
  let painted=0,outsideShape=0,behindTools=0;const outsideExamples=[];
  for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
    if(bitmap[(y*size.width+x)*4+3]<32)continue;
    painted++;const dx=(x+.5)*bounds.width/size.width,dy=(y+.5)*bounds.height/size.height;
    if(inside(dx,dy,shape))continue;
    if(inside(dx,dy,holes)){behindTools++;continue;}
    outsideShape++;if(outsideExamples.length<12)outsideExamples.push({x:dx,y:dy});
  }
  const screenshot=`${name}.png`;fs.writeFileSync(path.join(output,screenshot),image.toPNG());
  return{screenshot,size,bounds,shape,holes,painted,outsideShape,behindTools,outsideExamples,alphaThreshold:32,
    note:'Checks captured WebContents alpha against the actual native shape plus deliberate visible-tool holes; no desktop pixels are captured.'};
}
async function verify(bootstrap){
  const request=async(route,body)=>{const result=await fetch(bootstrap.url+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${bootstrap.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!result.ok)throw Error(`${route}: ${result.status}`);return result.json();};
  const command=value=>request('/api/command',value);
  await until(async()=>{const result=await request('/api/performance');return result.sample?.frames>60&&result.sample?.gpuRenderer?result:null;},'model ready');
  await control('chat','hide-chat');await control('chat','show-pet');
  // Probe the callback delivery separately from the existing model frame gate.
  await js('pet',`(()=>{
    const native=requestAnimationFrame.bind(window);window.__rafProbe={samples:[],longTasks:[]};
    window.requestAnimationFrame=callback=>native(stamp=>{const begin=performance.now();try{callback(stamp);}finally{const p=window.__rafProbe;p.samples.push({stamp,begin,end:performance.now()});if(p.samples.length>4000)p.samples.shift();}});
    try{new PerformanceObserver(list=>{for(const item of list.getEntries()){const a=window.__rafProbe.longTasks;a.push({start:item.startTime,duration:item.duration});if(a.length>64)a.shift();}}).observe({entryTypes:['longtask']});}catch{}
  })()`);
  report.display=screen.getPrimaryDisplay();report.window=Object.fromEntries([...windows].map(([role,win])=>[role,{bounds:win.getBounds(),opacity:win.getOpacity(),backgroundThrottling:win.webContents.getBackgroundThrottling()}]));
  if(arg('trace','off')==='on'){await contentTracing.startRecording({included_categories:['blink','cc','viz','gpu','renderer.scheduler','disabled-by-default-devtools.timeline']});trace=true;}
  const cases=[
    ['idle-closed','idle',false,'normal'],['thinking-closed','thinking',false,'normal'],
    ['idea-closed','idea',false,'normal'],['talk-closed','talk',false,'normal'],
    ['thinking-open','thinking',true,'normal'],['idle-open','idle',true,'normal'],
    ['idea-open','idea',true,'normal'],['talk-open','talk',true,'normal'],
    ['thinking-no-css','thinking',true,'no-css'],['thinking-no-raise','thinking',true,'no-raise'],
    ['thinking-frozen-shape','thinking',true,'frozen-shape'],['thinking-open-repeat','thinking',true,'normal'],
    ['thinking-zorder-closed-before','thinking',false,'normal'],['thinking-zorder-closed-after','thinking',false,'no-repeat-zorder'],
    ['thinking-zorder-open-before','thinking',true,'normal'],['thinking-zorder-open-after','thinking',true,'no-repeat-zorder'],
  ];
  const selected=arg('cases','all');
  for(const [name,state,chatOpen,mode] of cases){
    if(selected!=='all'&&!selected.split(',').includes(name))continue;
    currentPhase=name;variant='normal';progress(`start ${name}`);
    await command({type:'stop'});
    const chat=windows.get('chat');if(chatOpen&&!chat.isVisible())await control('chat','toggle-chat');else if(!chatOpen&&chat.isVisible())await control('chat','hide-chat');
    for(const role of ['pet','chat','toggle'])await js(role,`(()=>{document.getElementById('probe-css')?.remove();${mode==='no-css'?`const style=document.createElement('style');style.id='probe-css';style.textContent='*{animation:none!important;transition:none!important}.input-guard{background:transparent!important}';document.head.append(style);`:''}})()`);
    if(state==='idle')await command({type:'state',state:'idle'});
    if(state==='thinking')await command({type:'state',state:'thinking'});
    if(state==='idea')await command({type:'perform',intent:'idea',emotion:'happy',gesture:'pointer',durationMs:20000});
    if(state==='talk')await command({type:'body',animation:'talk',durationMs:20000});
    await wait(settleMs);variant=mode;
    await js('pet','window.__rafProbe.samples=[];window.__rafProbe.longTasks=[];');
    const before=await request('/api/performance'),begin=Date.now(),callStart=nativeCalls.length;
    await wait(sampleMs);
    const after=await request('/api/performance'),raf=await js('pet','JSON.parse(JSON.stringify(window.__rafProbe))');
    const wallMs=Date.now()-begin,frames=after.sample.frames-before.sample.frames,callRows=nativeCalls.slice(callStart);
    const intervals=raf.samples.slice(1).map((row,index)=>row.stamp-raf.samples[index].stamp);
    const callbackMs=raf.samples.map(row=>row.end-row.begin),lateness=raf.samples.map(row=>row.begin-row.stamp);
    const phase={name,state,variant:mode,chatOpen,wallMs,frames,modelSampleWindowMs:after.sample.receivedAt-before.sample.receivedAt,
      rendererSampleFps:after.sample.sampleFps,rafFps:intervals.length?1000/stats(intervals).mean:0,
      rafIntervals:stats(intervals),rafCallbackMs:stats(callbackMs),rafLatenessMs:stats(lateness),longTasks:raf.longTasks,
      nativeCalls:Object.fromEntries(['setShape','moveTop','setAlwaysOnTop'].map(method=>[method,{count:callRows.filter(row=>row.method===method).length,suppressed:callRows.filter(row=>row.method===method&&row.suppressed).length,time:stats(callRows.filter(row=>row.method===method&&!row.suppressed).map(row=>row.ms))}])),before,after};
    if(arg('capture','off')==='on')phase.visual=await captureShapeCoverage(name);
    report.phases.push(phase);persist();progress(`done ${name} raf=${phase.rafFps.toFixed(1)} render=${phase.rendererSampleFps}`);
  }
  variant='normal';await command({type:'stop'});
  if(trace){report.trace=await contentTracing.stopRecording(path.join(output,'trace.json'));trace=false;}
  report.completedAt=new Date().toISOString();report.nativeCalls=nativeCalls;persist();clearTimeout(watchdog);progress('complete');app.quit();
}
(async()=>{
  await app.whenReady();const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));process.env.COMPANION_PORT=String(port);
  const dshHome=path.join(directory,'empty-dsh-home');fs.mkdirSync(dshHome,{recursive:true});
  const area=screen.getPrimaryDisplay().workArea;
  fs.writeFileSync(path.join(directory,'desktop.json'),JSON.stringify({modelRoot,renderQuality:'quality',cacheMeshBuffers:false,preserveGlState:false,mouseTracking:false,setupCompleted:true,dshHome,dshPort:port,petLayoutVersion:2,petScale:4,petPosition:{x:area.x+area.width*.55,y:area.y+area.height*1.4}}));
  // Allow only this new companion and its model files. A probe cannot contact
  // installed DSH backends, TTS services, or user accounts even accidentally.
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{try{const url=new URL(details.url);callback({cancel:!['devtools:','data:','blob:','about:'].includes(url.protocol)&&url.origin!==`http://127.0.0.1:${port}`&&url.origin!==`ws://127.0.0.1:${port}`});}catch{callback({cancel:true});}});
  progress('boot production main');require('../desktop/main.cjs');
})().catch(fail);
