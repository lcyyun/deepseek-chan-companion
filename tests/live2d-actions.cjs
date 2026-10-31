// Real production service -> WebSocket -> React Pet -> BehaviorController -> Cubism.
// A separate hidden window/service/data directory never touches the user's instance.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const expressionFinalOnly = process.argv.includes('--expression-final-only');
const expressionsOnly = process.argv.includes('--expressions-only') || expressionFinalOnly;
const inputOnly = process.argv.includes('--input-only');
const nativeInputOnly = process.argv.includes('--native-input-only');
const effectsOnly = process.argv.includes('--effects-only');
const v5Only = process.argv.includes('--v5-only');
const physicsOnly = process.argv.includes('--physics-only');
const cuddleOnly = process.argv.includes('--cuddle-only');
const tuningTransitionOnly = process.argv.includes('--tuning-transition-only');
const tuningOnly = process.argv.includes('--tuning-only') || tuningTransitionOnly;
const posesOnly = process.argv.includes('--poses-only');
const transitionsOnly = process.argv.includes('--transitions-only');
const replyPoseOnly = process.argv.includes('--reply-pose-only');
const replyFlowOnly = process.argv.includes('--reply-flow-only') || replyPoseOnly;
const baseline = process.argv.includes('--baseline');
const output = path.join(root, 'vendor', expressionsOnly ? (expressionFinalOnly?'expressions-final-smoke':'expressions-smoke') : tuningOnly ? 'tuning-smoke' : cuddleOnly ? 'cuddle-smoke' : physicsOnly ? (baseline?'chest-original':'chest-softened') : v5Only ? 'v5-smoke' : effectsOnly ? 'effects-smoke' : nativeInputOnly ? 'native-touch-smoke' : replyPoseOnly ? 'reply-pose-smoke' : replyFlowOnly ? 'reply-flow-smoke' : transitionsOnly ? (baseline ? 'transitions-before' : 'transitions-after') : inputOnly ? 'input-smoke' : posesOnly ? 'poses-smoke' : 'actions-smoke');
const modelRoot = process.env.L2D_MODEL_ROOT || path.join(root, 'models', 'DeepSeek');
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let service, win;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { pathway: 'Isolated real HTTP/WS service, production React Pet source, official Cubism and original model', inputOnly, presets: [], motions: [], errors: [] };
function differences(first, second, size, rect) {
  let changed = 0, total = 0;
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    if (rect && (x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height)) continue;
    const i = (y * size.width + x) * 4;
    if (Math.max(first[i+3], second[i+3]) < 20) continue;
    total++;
    if (Math.max(...[0,1,2,3].map(c => Math.abs(first[i+c] - second[i+c]))) > 24) changed++;
  }
  return { changed, total, fraction: changed / Math.max(1, total) };
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.cp(path.join(root, 'public/vendor'), path.join(output, 'vendor'), { recursive: true });
  // Observation hooks only: production dispatch/render code is otherwise unchanged.
  await build({ entryPoints: [path.join(root,'src/renderer/main.tsx')], outfile:path.join(output,'app.js'),
    bundle:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'qa-observe',setup(build){
      build.onLoad({filter:/[\\/]renderer[\\/]main\.tsx$/},async args=>{
        const source=await fs.readFile(args.path,'utf8');
        if(!source.includes('runtime.current=handle'))throw new Error('QA observation anchor changed');
        const observer=`(window as any).qaBehavior=behavior.current;(window as any).qaSpeaker=speaker.current;(window as any).qaBasinSound=basinSound.current;(window as any).qaFlow=[];(window as any).qaEvents=[];(window as any).qaExpressionLog=[];(window as any).qaAudioProgress=[];
          const qaCue=behavior.current.setExpressionCue.bind(behavior.current);behavior.current.setExpressionCue=(emotion:string,intensity:number)=>{(window as any).qaExpressionLog.push({kind:'cue',at:performance.now(),emotion,intensity});return qaCue(emotion,intensity);};
          const qaClear=behavior.current.clearExpressionCue.bind(behavior.current);behavior.current.clearExpressionCue=()=>{(window as any).qaExpressionLog.push({kind:'clear',at:performance.now()});return qaClear();};
          const qaApply=behavior.current.applyCommand.bind(behavior.current);behavior.current.applyCommand=(command:any)=>{(window as any).qaFlow.push({kind:'command',at:performance.now(),command});return qaApply(command);};
          const qaSpeak=speaker.current.speak.bind(speaker.current);speaker.current.speak=(text:string,onStart?:()=>void,onProgress?:any)=>{(window as any).qaFlow.push({kind:'audio-request',at:performance.now(),text});return qaSpeak(text,()=>{(window as any).qaFlow.push({kind:'audio-start',at:performance.now(),text});onStart?.();},(progress:any)=>{(window as any).qaAudioProgress.push({...progress,at:performance.now(),mouth:handle.getParameters().find(p=>p.id==='ParamMouthOpenY')?.value});onProgress?.(progress);});};`;
        return {contents:source.replace('runtime.current=handle','(window as any).qaRuntime=handle;runtime.current=handle')
          .replace('setReady(true);setState(activeState.current)',observer+'setReady(true);setState(activeState.current)')
          .replace('maxTextureSize:4096','maxTextureSize:'+((nativeInputOnly||effectsOnly||v5Only||physicsOnly||cuddleOnly||tuningOnly||expressionsOnly)?2048:4096)+((effectsOnly||v5Only||physicsOnly||tuningOnly)?',idleMotion:false':'')+(physicsOnly?',softenChestPhysics:'+!baseline:''))
          .replace('const off=events(e=>{','const off=events((window as any).qaHandleEvent=(e:any)=>{(window as any).qaEvents?.push({at:performance.now(),event:e});')+'\n(window as any).qaActions=ACTIONS;',loader:'tsx'};
      });
      build.onLoad({filter:/[\\/]renderer[\\/]live2d\.ts$/},async args=>({
        contents:(await fs.readFile(args.path,'utf8')).replace('options.onFrame?.(dt, elapsed);','(window as any).qaElapsed=elapsed;if ((window as any).qaPhysicsDriver) handle.setParameters((window as any).qaPhysicsDriver());else if (!(window as any).qaDirect) options.onFrame?.(dt, elapsed);')
          .replace('const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 1 / 60;',physicsOnly||tuningOnly?'const dt = 1 / 60;':'const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 1 / 60;')
          .replace('const handle: Live2DHandle = {',`(window as any).qaArmProbe=()=>({presence:cuddleHandWeight,active:cuddleActive,closingRemaining:Math.max(0,cuddleClosingUntil-elapsed),sourceCount:chestArmDrawables.size,replacedCount:replacedArmDrawables.size});const qaRigIdentity=physics?._physicsRig;(window as any).qaTuningProbe=()=>({sameRig:qaRigIdentity===physics?._physicsRig,softness:chestSoftness,shadow:basinShadow,particles:chestParticles.map(row=>({mobility:row.particle.mobility,acceleration:row.particle.acceleration,originalMobility:row.mobility,originalAcceleration:row.acceleration}))});const handle: Live2DHandle = {`)
          .replace('physics?.evaluate(model, dt);','if (!(window as any).qaFreezePhysics) physics?.evaluate(model, dt);'),loader:'ts'}));
    }}] });
  const actualIndex=await fs.readFile(path.join(root,'index.html'),'utf8');
  const csp=actualIndex.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)[0];
  await fs.writeFile(path.join(output,'index.html'),`<!doctype html><html><head>${csp}<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
  const {createService}=await import(pathToFileURL(path.join(root,'server/index.mjs')).href);
  const chatJobs=[];
  service=await createService({port:0,modelRoot,dataDir:path.join(output,'service-data'),staticRoot:output,
    ...(replyFlowOnly?{chatAdapters:{codex:options=>new Promise((resolve,reject)=>chatJobs.push({options,resolve,reject}))}}:{})});
  const request=async (pathname,body)=>{
    const response=await fetch(service.url+pathname,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    if(!response.ok)throw new Error(`HTTP ${response.status} ${pathname}`);return response.json();
  };
  if(replyFlowOnly)await request('/api/settings',{provider:'codex',voiceEnabled:false});
  const manifest=await request('/api/model-manifest');
  const preload=path.join(output,'preload.cjs');
  await fs.writeFile(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('companion',{bootstrap:()=>ipcRenderer.invoke('qa-bootstrap'),control:(action,data)=>ipcRenderer.invoke('qa-control',action,data),onEvent:callback=>{const listener=(_event,payload)=>callback(payload);ipcRenderer.on('qa-desktop-event',listener);return()=>ipcRenderer.removeListener('qa-desktop-event',listener);}});`);
  const {DEFAULT_MODEL_TUNING,sanitizeModelTuning}=await import(pathToFileURL(path.join(root,'src/shared/model-tuning.mjs')).href);
  let fixtureBasin=false,fixtureChat,fixtureTuning={...DEFAULT_MODEL_TUNING};
  ipcMain.handle('qa-bootstrap',event=>({url:service.url,token:service.token,role:new URL(event.sender.getURL()).searchParams.get('view')||'pet',basinEnabled:fixtureBasin,modelTuning:fixtureTuning}));
  const nativeLog={pid:process.pid,events:[],frames:[],regions:[],locked:false,shape:[],status:'starting'};
  let nativeShapeKey='';
  const updateNativeShape=()=>{if(!win)return;const [width,height]=win.getContentSize();const shape=nativeLog.locked?[]:require('../desktop/pet-input.cjs').normalizeRegions(nativeLog.regions,width,height);const key=JSON.stringify(shape);if(key!==nativeShapeKey){win.setShape(shape);nativeShapeKey=key;nativeLog.shape=shape;nativeLog.events.push({at:Date.now(),kind:'setShape',shape});}};
  ipcMain.handle('qa-control',(_event,action,data)=>{
    if(v5Only||tuningOnly||expressionsOnly){
      nativeLog.events.push({at:Date.now(),action,data});
      if(action==='diagnostics')return{dragMode:false,basinEnabled:fixtureBasin,modelTuning:fixtureTuning};
      if(action==='basin-enabled'){fixtureBasin=data===true;for(const target of [win,fixtureChat])target?.webContents.send('qa-desktop-event',{type:'basin-enabled',enabled:fixtureBasin});return fixtureBasin;}
      if(action==='model-tuning'){fixtureTuning=sanitizeModelTuning(data,fixtureTuning);for(const target of [win,fixtureChat])target?.webContents.send('qa-desktop-event',{type:'model-tuning',tuning:fixtureTuning});return fixtureTuning;}
    }
    if(!nativeInputOnly)return {};
    if(action==='diagnostics')return{dragMode:false,clickThrough:false};
    if(action==='pet-hit-regions'){nativeLog.regions=Array.isArray(data)?data:data.regions;updateNativeShape();}
    if(action==='pet-pointer-lock'){nativeLog.locked=data===true||data?.locked===true;nativeLog.events.push({at:Date.now(),kind:'pointer-lock',locked:nativeLog.locked});updateNativeShape();}
    return {};
  });
  await app.whenReady();
  win=new BrowserWindow({width:v5Only?1100:500,height:v5Only?900:800,show:false,transparent:true,frame:false,...(nativeInputOnly?{x:120,y:50,focusable:false,title:'L2D Native Touch QA',alwaysOnTop:true}:{}),
    webPreferences:{preload,offscreen:!nativeInputOnly,backgroundThrottling:false,contextIsolation:true,sandbox:true,autoplayPolicy:'no-user-gesture-required'}});
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message',e=>{if(e.level==='error'||e.level===3)report.errors.push(e.message);});
  await win.loadURL(service.url+'/?view=pet');
  await win.webContents.executeJavaScript(`(async()=>{const start=Date.now();while(!window.qaRuntime){if(Date.now()-start>30000)throw Error(document.body.innerText||'Startup timeout');await new Promise(r=>setTimeout(r,100));}})()`);
  if(nativeInputOnly){
    win.setTitle('L2D Native Touch QA');win.on('page-title-updated',e=>e.preventDefault());win.setIgnoreMouseEvents(false);win.setAlwaysOnTop(true,'screen-saver');win.showInactive();
    await win.webContents.executeJavaScript(`window.qaPointerEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','blur','focus'])window.addEventListener(type,e=>qaPointerEvents.push({at:performance.now(),type,trusted:e.isTrusted,id:e.pointerId,x:e.clientX,y:e.clientY,buttons:e.buttons,target:e.target?.className}),true);
      const petCall=qaBehavior.setPetting.bind(qaBehavior);qaBehavior.setPetting=(active,input)=>{qaPointerEvents.push({at:performance.now(),type:'setPetting',active,input});return petCall(active,input);};
      const mark=document.createElement('div');mark.id='qa-head-target';mark.style.cssText='position:fixed;border:2px solid #ff45aa;color:#ff45aa;font:12px sans-serif;pointer-events:none;z-index:99';mark.textContent='Native head target';document.body.appendChild(mark);
      window.qaMarkTimer=setInterval(()=>{const h=qaRuntime.getInteractionRegions()?.head,r=document.querySelector('canvas').getBoundingClientRect();if(h)Object.assign(mark.style,{left:(h.x+r.x)+'px',top:(h.y+r.y)+'px',width:h.width+'px',height:h.height+'px'});},100);`);
    nativeLog.status='awaiting-native-input';nativeLog.bounds=win.getBounds();
    const finish=path.join(output,'finish-request.json');await fs.rm(finish,{force:true});
    const until=Date.now()+300000;
    while(Date.now()<until){
      const frame=await win.webContents.executeJavaScript(`({at:Date.now(),events:qaPointerEvents.splice(0),head:qaRuntime.getInteractionRegions()?.head,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(),petting:qaBehavior.isPetting,cuddle:qaBehavior.cuddleWeight,eye:qaRuntime.getParameters().find(p=>p.id==='ParamEyeLOpen').value,focus:document.hasFocus(),className:document.querySelector('.pet-stage').className})`);
      nativeLog.events.push(...frame.events);delete frame.events;nativeLog.frames.push(frame);if(nativeLog.frames.length>1200)nativeLog.frames.shift();
      await fs.writeFile(path.join(output,'result.json'),JSON.stringify(nativeLog,null,2));
      if(await fs.access(finish).then(()=>true,()=>false))break;await delay(100);
    }
    win.destroy();await service.close();app.exit(0);return;
  }
  const params=()=>win.webContents.executeJavaScript(`Object.fromEntries(qaRuntime.getParameters().filter(p=>['Movement1','Movement2','Movement3','Param36','Param39','Param41','Param42','Param37','Param38','Param59','Param60','Param61','Param62','LWrist','LHand','LHand2','Param56','Param57','key8','key3','Param11','AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput','ParamEyeBallX','ParamEyeBallY','ParamMouthForm','ParamEyeLOpen','ParamEyeROpen'].includes(p.id)).map(p=>[p.id,p.value]))`);
  const capture=async name=>{
    const image=await win.webContents.capturePage();await fs.writeFile(path.join(output,name+'.png'),image.toPNG());
    {
      const canvasData=await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>resolve(document.querySelector('canvas').toDataURL('image/png'))))`);
      await fs.writeFile(path.join(output,name+'-canvas.png'),Buffer.from(canvasData.split(',')[1],'base64'));
      // Electron offscreen capturePage may omit unchanged transparent-window
      // tiles. Compare the completed WebGL frame itself for static-pose QA.
      const canvasImage=nativeImage.createFromDataURL(canvasData);
      if(transitionsOnly||replyFlowOnly||effectsOnly||v5Only||physicsOnly||tuningOnly)return{bytes:canvasImage.toBitmap(),size:canvasImage.getSize()};
    }
    return{bytes:image.toBitmap(),size:image.getSize()};
  };
  if(expressionsOnly){
    const {EXPRESSION_PRESETS}=await import(pathToFileURL(path.join(root,'src/shared/expressions.mjs')).href);
    fixtureChat=new BrowserWindow({width:420,height:780,show:false,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
    await fixtureChat.loadURL(service.url+'/?view=chat');await delay(150);
    await fixtureChat.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='小表情').click()`);await delay(100);
    const uiCount=await fixtureChat.webContents.executeJavaScript(`document.querySelectorAll('[data-expression]').length`);if(uiCount!==EXPRESSION_PRESETS.length)throw Error('Catalogue cards missing');
    await fs.writeFile(path.join(output,'expressions-page.png'),(await fixtureChat.webContents.capturePage()).toPNG());
    const select=async id=>{await fixtureChat.webContents.executeJavaScript(`document.querySelector('[data-expression="${id}"]').click()`);await delay(1050);};
    const face=()=>win.webContents.executeJavaScript(`Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(key[1-9]|key13|ParamEye[LR]Open|ParamMouthForm|ParamMouthOpenY|ParamBrow[LR]Y)$/.test(p.id)).map(p=>[p.id,p.value]))`);
    const save=async name=>{const data=await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>resolve(document.querySelector('canvas').toDataURL('image/png'))))`);await fs.writeFile(path.join(output,name+'.png'),Buffer.from(data.split(',')[1],'base64'));return data;};
    report.expressions=[];
    for(const item of (expressionFinalOnly?EXPRESSION_PRESETS.filter(item=>['squeezed','love','happy'].includes(item.id)):EXPRESSION_PRESETS)){await select(item.id);const actual=await face();await save(item.id);report.expressions.push({id:item.id,title:item.title,actual,head:await win.webContents.executeJavaScript('qaRuntime.getInteractionRegions().head')});if(item.specialEyes&&Math.max(...['key3','key4','key5','key6'].map(id=>actual[id]||0))<.8)throw Error('Authored eye style did not reach production: '+item.id);}
    await fixtureChat.webContents.executeJavaScript(`window.companion.control('model-tuning',{expressionOverrides:{sad:{smile:-.2}}})`);await select('happy');const original=await face();
    const adjust=async(selector,value)=>{await fixtureChat.webContents.executeJavaScript(`(()=>{const input=document.querySelector('${selector}');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${value});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(900);};
    await adjust('[data-expression-tuning="smile"]',-.4);const low=await face();await save('tweak-smile-low');
    await adjust('[data-expression-tuning="smile"]',.4);const high=await face();await save('tweak-smile-high');
    if(high.ParamMouthForm-low.ParamMouthForm<.45)throw Error('Current preview did not respond to mouth-corner tuning');
    await adjust('[data-expression-global]',0);const quiet=await face();if(Math.abs(quiet.ParamMouthForm)>.03)throw Error('Global expression intensity did not settle at zero');
    await adjust('[data-expression-global]',1);
    await fixtureChat.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.expression-tools button')).find(b=>b.textContent==='重置这个表情').click()`);await delay(1000);const restored=await face();
    if(Math.abs(restored.ParamMouthForm-original.ParamMouthForm)>.035||fixtureTuning.expressionOverrides.happy||!fixtureTuning.expressionOverrides.sad||await win.webContents.executeJavaScript('Boolean(qaBehavior.tuning.expressionOverrides.happy)'))throw Error('Single-expression reset failed');
    await fixtureChat.webContents.executeJavaScript(`document.querySelector('.expression-editor').scrollIntoView({block:'start'})`);await delay(100);await fs.writeFile(path.join(output,'expression-editor.png'),(await fixtureChat.webContents.capturePage()).toPNG());
    report.tuning={original,low,high,quiet,restored,stored:fixtureTuning};
    await select('love');win.webContents.send('qa-desktop-event',{type:'basin-enabled',enabled:true});await delay(350);
    const hit=await win.webContents.executeJavaScript('(()=>{const b=qaRuntime.getInteractionRegions().basin;return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()');
    win.webContents.sendInputEvent({type:'mouseDown',...hit,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...hit,button:'left',clickCount:1});
    report.impact=await win.webContents.executeJavaScript(`new Promise(resolve=>{const rows=[];function frame(){const p=Object.fromEntries(qaRuntime.getParameters().filter(p=>['key3','key4','key5','key6'].includes(p.id)).map(p=>[p.id,p.value]));rows.push({...p,frame:rows.length,...([15,75].includes(rows.length)?{image:document.querySelector('canvas').toDataURL('image/png')}:{} )});if(rows.length>=90)resolve(rows);else requestAnimationFrame(frame);}requestAnimationFrame(frame);})`);
    if(report.impact.some(row=>['key3','key4','key5','key6'].filter(key=>row[key]>.02).length>1)||Math.max(...report.impact.map(row=>row.key3))<.8||report.impact.at(-1).key4<.9)throw Error('Basin impact overlapped eye drawings or failed to restore the selected face');
    for(const row of report.impact)if(row.image){await fs.writeFile(path.join(output,'impact-'+row.frame+'.png'),Buffer.from(row.image.split(',')[1],'base64'));delete row.image;}
    win.webContents.send('qa-desktop-event',{type:'basin-enabled',enabled:false});

    await request('/api/stop',{});await delay(400);
    const cues=[{at:0,emotion:'puzzled',intensity:.8},{at:.25,emotion:'curious',intensity:.8},{at:.5,emotion:'happy',intensity:.8},{at:.75,emotion:'joyful',intensity:.8}];
    const resetLog=()=>win.webContents.executeJavaScript('qaExpressionLog=[];qaAudioProgress=[];qaFlow=[];true;');
    const until=async predicate=>{const deadline=Date.now()+30000;while(!await win.webContents.executeJavaScript(predicate)){if(Date.now()>deadline)throw Error('Expression speech timeout: '+predicate);await delay(80);}};
    await request('/api/settings',{voiceEnabled:false});await resetLog();await request('/api/command',{type:'speak',text:'先让我想一想。现在已经找到办法，我们可以开心地开始了。',intent:'neutral',emotion:'puzzled',gesture:'none',expressionCues:cues});
    await until("qaExpressionLog.filter(e=>e.kind==='cue').length===4");report.reading=await win.webContents.executeJavaScript('qaExpressionLog');
    const reading=report.reading.filter(e=>e.kind==='cue');if(reading.slice(1).some((e,i)=>e.at-reading[i].at<735))throw Error('Silent reading changed expressions too quickly');
    await request('/api/stop',{});await resetLog();await request('/api/settings',{voiceEnabled:true});
    await request('/api/command',{type:'speak',text:'先让我认真想一想，我已经找到办法了，现在一起试试看吧。',intent:'neutral',emotion:'puzzled',gesture:'none',expressionCues:cues});
    await until('qaAudioProgress.some(p=>p.ratio===1)');report.audio=await win.webContents.executeJavaScript('({flow:qaFlow,cues:qaExpressionLog,progress:qaAudioProgress})');
    const start=report.audio.flow.find(e=>e.kind==='audio-start'),spoken=report.audio.cues.filter(e=>e.kind==='cue');
    if(!start||spoken[0].at<start.at||spoken.length<2||Math.max(...report.audio.progress.map(p=>p.mouth))<.02)throw Error('Real WAV expression score or mouth synchronisation failed');
    if(spoken.slice(1).some((e,i)=>e.at-spoken[i].at<735))throw Error('Audio cues exceeded the expression change limit');
    await request('/api/stop',{});await resetLog();await request('/api/command',{type:'speak',text:'这是一个稍长的句子，用来确认停止后不会继续切换脸上的表情。',emotion:'puzzled',expressionCues:cues});await until("qaExpressionLog.some(e=>e.kind==='cue')");await request('/api/stop',{});const beforeStop=await win.webContents.executeJavaScript("qaExpressionLog.filter(e=>e.kind==='cue').length");await delay(1200);const afterStop=await win.webContents.executeJavaScript("qaExpressionLog.filter(e=>e.kind==='cue').length");if(beforeStop!==afterStop)throw Error('Stopped audio delivered a late expression cue');report.cancelled={beforeStop,afterStop};
    if(report.errors.length)throw Error(report.errors.join('; '));await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({expressions:'passed',count:report.expressions.length,readingCues:reading.length,audioCues:spoken.length,audioDuration:report.audio.progress.at(-1).duration,mouthPeak:Math.max(...report.audio.progress.map(p=>p.mouth)),cancelled:report.cancelled}));fixtureChat.destroy();win.destroy();await service.close();app.exit(0);return;
  }
  if(tuningOnly){
    fixtureChat=new BrowserWindow({width:420,height:740,show:false,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
    await fixtureChat.loadURL(service.url+'/?view=chat');await delay(200);
    await fixtureChat.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='调节').click()`);await delay(150);
    const ui=()=>fixtureChat.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-tuning]')).map(e=>({name:e.getAttribute('aria-label'),key:e.dataset.tuning,value:Number(e.value),text:e.getAttribute('aria-valuetext')}))`);
    const change=async(key,value)=>{await fixtureChat.webContents.executeJavaScript(`(()=>{const input=document.querySelector('[data-tuning="${key}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${value});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(80);if(Math.abs(fixtureTuning[key]-value)>.001)throw Error('Tuning UI did not reach desktop event: '+key);};
    report.controls=await ui();if(report.controls.length!==7)throw Error('Expected seven tuning controls');
    await fs.writeFile(path.join(output,'tuning-top.png'),(await fixtureChat.webContents.capturePage()).toPNG());
    await fixtureChat.webContents.executeJavaScript(`document.querySelector('.tuning-panel').scrollTop=10000`);await delay(80);
    await fs.writeFile(path.join(output,'tuning-bottom.png'),(await fixtureChat.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('window.qaDirect=true;window.qaFreezePhysics=true;qaRuntime.reset();qaRuntime.clearParameters();');
    win.webContents.send('qa-desktop-event',{type:'basin-enabled',enabled:true});
    const settled=async(key,value)=>{const until=Date.now()+5000;while(Math.abs((await win.webContents.executeJavaScript('qaTuningProbe()'))[key]-value)>.0001){if(Date.now()>until)throw Error('Tuning smoothing did not converge');await delay(60);}};
    if(tuningTransitionOnly){
      await change('chestSoftness',1);await settled('softness',1);
      await win.webContents.executeJavaScript(`window.qaFreezePhysics=false;qaRuntime.reset();qaRuntime.clearParameters();window.qaPhysicsFrame=0;window.qaPhysicsDriver=()=>{const w=Math.sin(qaPhysicsFrame++/60*Math.PI*2);return{PositionX:w*20,PositionY:w*20,LeanInput:w*12};};true;`);
      const pending=win.webContents.executeJavaScript(`new Promise(resolve=>{const rows=[];function frame(){const probe=qaTuningProbe();rows.push({frame:qaPhysicsFrame,softness:probe.softness,sameRig:probe.sameRig,x:qaRuntime.getParameters().find(p=>p.id==='ChestX2').value,y:qaRuntime.getParameters().find(p=>p.id==='ChestY2').value,...([60,70,85,120].includes(qaPhysicsFrame)?{image:document.querySelector('canvas').toDataURL('image/png')}:{} )});if(qaPhysicsFrame>=180){window.qaPhysicsDriver=null;resolve(rows);}else requestAnimationFrame(frame);}requestAnimationFrame(frame);})`);
      await win.webContents.executeJavaScript(`new Promise(resolve=>{function frame(){if(qaPhysicsFrame>=60)resolve(true);else requestAnimationFrame(frame);}requestAnimationFrame(frame);})`);
      await change('chestSoftness',2);report.transition=await pending;
      report.transitionMaxStep=Math.max(...report.transition.slice(1).map((p,i)=>Math.max(Math.abs(p.x-report.transition[i].x),Math.abs(p.y-report.transition[i].y))));
      if(report.transition.some(p=>!p.sameRig)||!report.transition.some(p=>p.softness>1.01&&p.softness<1.99)||report.transitionMaxStep>.2)throw Error('Live spring tuning reset or jumped while the model was moving');
      for(const row of report.transition)if(row.image){await fs.writeFile(path.join(output,'transition-'+row.frame+'-canvas.png'),Buffer.from(row.image.split(',')[1],'base64'));delete row.image;}
      await fs.writeFile(path.join(output,'transition-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({transition:'passed',maxFrameStep:report.transitionMaxStep,finalSoftness:report.transition.at(-1).softness}));fixtureChat.destroy();win.destroy();await service.close();app.exit(0);return;
    }
    await change('basinShadow',1);await settled('shadow',1);await delay(300);const originalShadow=await capture('shadow-100');
    await change('basinShadow',.35);await settled('shadow',.35);const lightShadow=await capture('shadow-35');
    await change('basinShadow',0);await settled('shadow',0);const noShadow=await capture('shadow-0');
    await change('basinShadow',1);await settled('shadow',1);const restoredShadow=await capture('shadow-restored');
    report.shadow={light:differences(originalShadow.bytes,lightShadow.bytes,lightShadow.size),none:differences(originalShadow.bytes,noShadow.bytes,noShadow.size),restored:differences(originalShadow.bytes,restoredShadow.bytes,restoredShadow.size)};
    if(report.shadow.light.changed<100||report.shadow.none.changed<report.shadow.light.changed||report.shadow.restored.changed>5)throw Error('Basin shadow tuning was invisible or modified the basin permanently');
    report.chest={};
    for(const level of [0,1,2]){
      await change('chestSoftness',level);await settled('softness',level);
      const probe=await win.webContents.executeJavaScript('qaTuningProbe()');if(!probe.sameRig||probe.particles.length!==8)throw Error('Tuning rebuilt physics or targeted the wrong particles');
      if(level===1&&probe.particles.some(p=>p.mobility!==p.originalMobility||p.acceleration!==p.originalAcceleration))throw Error('100% did not restore authored spring coefficients');
      await win.webContents.executeJavaScript(`window.qaFreezePhysics=false;qaRuntime.reset();qaRuntime.clearParameters();window.qaPhysicsFrame=0;window.qaPhysicsDriver=()=>{const t=qaPhysicsFrame++/60,w=t<.5||t>1.5?0:Math.sin((t-.5)*Math.PI*2);return{PositionY:w*20,PositionX:w*20,LeanInput:w*12,AngleX:w*22,AngleZ:w*10};};true;`);
      const curve=await win.webContents.executeJavaScript(`new Promise(resolve=>{const rows=[];const sample=()=>{const p=Object.fromEntries(qaRuntime.getParameters().filter(p=>['ChestX2','ChestY2','ChestY4','ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ'].includes(p.id)).map(p=>[p.id,p.value]));rows.push({frame:qaPhysicsFrame,...p});if(qaPhysicsFrame>=240){window.qaPhysicsDriver=null;resolve(rows);}else requestAnimationFrame(sample);};requestAnimationFrame(sample);})`);
      report.chest[level]={probe,curve,peakX:Math.max(...curve.map(p=>Math.abs(p.ChestX2))),peakY:Math.max(...curve.map(p=>Math.abs(p.ChestY2)))};
    }
    if(!(report.chest[0].peakX<report.chest[1].peakX&&report.chest[1].peakX<report.chest[2].peakX))throw Error('Chest slider did not produce progressively softer motion');
    await change('bodyMotion',.7);await change('gazeStrength',1.3);await change('blushStrength',.9);await change('knockVolume',0);
    report.liveTargets=await win.webContents.executeJavaScript('({volume:qaBasinSound.volume,tuning:qaBehavior.tuningTarget||qaBehavior.targetTuning||qaBehavior.tuning})');
    if(report.liveTargets.volume!==0)throw Error('Knock volume did not apply');
    await fixtureChat.webContents.executeJavaScript(`document.querySelector('.tuning-reset').click()`);await delay(900);
    report.restoredControls=await ui();report.defaults=fixtureTuning;
    if(JSON.stringify(fixtureTuning)!==JSON.stringify(DEFAULT_MODEL_TUNING))throw Error('Restore defaults failed');
    await win.webContents.executeJavaScript('window.qaPhysicsDriver=null;window.qaDirect=false;window.qaFreezePhysics=false;qaBehavior.reset();');await delay(600);
    const beforeKnock=await capture('knock-body-before'),region=await win.webContents.executeJavaScript('qaRuntime.getInteractionRegions().fullBody');
    const target=await win.webContents.executeJavaScript('(()=>{const b=qaRuntime.getInteractionRegions().basin;return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()');
    win.webContents.sendInputEvent({type:'mouseDown',...target,button:'left',clickCount:1});await delay(20);win.webContents.sendInputEvent({type:'mouseUp',...target,button:'left',clickCount:1});await delay(80);
    const shudder=await capture('knock-body-shudder');report.knockParams=await params();
    const ratio=shudder.size.width/(await win.webContents.executeJavaScript('document.querySelector("canvas").clientWidth'));
    report.bodyDifference=differences(beforeKnock.bytes,shudder.bytes,shudder.size,{x:region.x*ratio,y:(region.y+region.height*.3)*ratio,width:region.width*ratio,height:region.height*.5*ratio});
    if(report.bodyDifference.changed<100)throw Error('Basin knock body shudder was not visible');
    report.errors.push(...await fixtureChat.webContents.executeJavaScript('window.qaErrors||[]'));
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));if(report.errors.length)throw Error(report.errors.join('; '));
    console.log(JSON.stringify({tuning:'passed',shadow:report.shadow,chest:Object.fromEntries(Object.entries(report.chest).map(([k,v])=>[k,{peakX:v.peakX,peakY:v.peakY}])),bodyDifference:report.bodyDifference}));fixtureChat.destroy();win.destroy();await service.close();app.exit(0);return;
  }
  if(cuddleOnly){
    const checkPalm=p=>p.Movement2>.95&&p.Movement3<.01&&p.Param37<.01&&p.Param38<.01&&Math.abs(p.Param60-.82)<.025&&Math.abs(p.LWrist-.85)>.05;
    const preset=await win.webContents.executeJavaScript(`qaActions.find(a=>a.command.intent==='cuddle').command`);
    await request('/api/command',{type:'perform',intensity:.85,...preset});report.enter=[];let entering=0;for(const step of [100,140,200,360,1000]){await delay(step);entering+=step;report.enter.push({ms:entering,...await params(),arm:await win.webContents.executeJavaScript('qaArmProbe()')});await capture('enter-'+entering);}
    report.preset=await params();report.presetArm=await win.webContents.executeJavaScript('qaArmProbe()');await capture('preset-cuddle');if(report.presetArm.presence!==1)throw Error('Steady cuddle retained a translucent default right arm');if(!checkPalm(report.preset))throw Error('Production cuddle preset missed its whole authored chest arm or retained the obsolete wrist override');
    report.close=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const rows=[],targets=[0,.15,.3,.45,.533,.55,.65,.85,1.1,1.4],deadline=performance.now()+9000;let start=null;function frame(){const arm=qaArmProbe();if(start===null&&!arm.active)start=qaBehavior.time;if(start!==null&&qaBehavior.time-start>=targets[rows.length]){rows.push({target:targets[rows.length],sinceClose:qaBehavior.time-start,parameters:Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(Movement[123]|Param(36|39|41|42|59|60|61|62))$/.test(p.id)).map(p=>[p.id,p.value])),arm,image:document.querySelector('canvas').toDataURL('image/png')});}if(rows.length===targets.length)return resolve(rows);if(performance.now()>deadline)return reject(Error('Author close capture timed out'));requestAnimationFrame(frame);}requestAnimationFrame(frame);})`);
    for(const row of report.close){await fs.writeFile(path.join(output,'natural-close-'+Math.round(row.target*1000)+'-canvas.png'),Buffer.from(row.image.split(',')[1],'base64'));delete row.image;}
    if(report.close.slice(0,8).some(row=>row.arm.presence!==1))throw Error('Mirrored arm disappeared before the authored close finished');
    if(report.close.filter(row=>row.target>=.65).some(row=>row.parameters.Movement2>.001))throw Error('A fading pose resurrected the chest hand after the author switched back to the default rig');
    await request('/api/stop',{});await delay(500);
    await request('/api/command',{type:'perform',intensity:.85,...preset});await delay(1200);
    const handoffThink=await win.webContents.executeJavaScript(`qaActions.find(a=>a.command.intent==='think').command`);await request('/api/command',{type:'perform',...handoffThink});report.handoff=[];
    for(let i=0;i<20;i++){await delay(100);report.handoff.push({...await params(),arm:await win.webContents.executeJavaScript('qaArmProbe()')});}
    if(report.handoff.some(row=>row.Movement3>.5&&row.arm.presence>.01)||report.handoff.at(-1).Movement3<.95)throw Error('Mirrored arm ownership leaked into the next pointing animation');
    await capture('immediate-cuddle-thinking');await request('/api/stop',{});await delay(500);
    const point=await win.webContents.executeJavaScript('(()=>{const h=qaRuntime.getInteractionRegions().head,c=document.querySelector("canvas").getBoundingClientRect();return{x:Math.round(c.x+h.x+h.width/2),y:Math.round(c.y+h.y+h.height/2)}})()');
    win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
    report.longPat=[];
    for(const ms of [800,1000,1000]){await delay(ms);report.longPat.push({...await params(),weight:await win.webContents.executeJavaScript('qaBehavior.cuddleWeight')});}
    await capture('long-pat-cuddle');
    if(report.longPat[1].weight>.01||!checkPalm(report.longPat[2])||report.longPat[2].ParamEyeLOpen!==0)throw Error('Sustained head touch did not enter the final palm after two seconds');
    win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await delay(2400);
    report.released=await params();report.releasedWeight=await win.webContents.executeJavaScript('qaBehavior.cuddleWeight');await capture('released');
    if(report.releasedWeight>.01||report.released.Movement2>.01||report.released.Param37>.01)throw Error('Cuddle hand survived release');
    const think=await win.webContents.executeJavaScript(`qaActions.find(a=>a.command.intent==='think').command`);await request('/api/command',{type:'perform',...think});await delay(1800);
    report.thinking=await params();await capture('after-cuddle-thinking');
    if(report.thinking.Movement3<.95||report.thinking.Movement2>.01||Math.abs(report.thinking.LWrist-.85)<.05)throw Error('Cuddle palm pose contaminated the next pointing gesture');
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));if(report.errors.length)throw Error(report.errors.join('; '));
    console.log(JSON.stringify({cuddle:'passed',preset:report.preset,releaseWeight:report.releasedWeight,thinkingHand:report.thinking.Movement3}));win.destroy();await service.close();app.exit(0);return;
  }
  if(physicsOnly){
    await win.webContents.executeJavaScript(`qaBehavior.interrupt();window.qaDirect=true;qaRuntime.reset();qaRuntime.clearParameters();window.qaPhysicsFrame=0;window.qaPhysicsCurve=[];window.qaPhysicsShots={};window.qaPhysicsDriver=()=>{const t=qaPhysicsFrame++/60;const wave=t<.5||t>1.5?0:Math.sin((t-.5)*Math.PI*2);return{PositionY:wave*20,PositionX:wave*20,LeanInput:wave*12,AngleX:wave*22,AngleZ:wave*10};};true;`);
    const physicsResult=await win.webContents.executeJavaScript(`new Promise(resolve=>{const sample=()=>{const frame=qaPhysicsFrame;const p=Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(Chest[XY]|Position|ParamBodyAngle)/.test(p.id)).map(p=>[p.id,p.value]));qaPhysicsCurve.push({frame,t:frame/60,...p});if([45,65,85,110,150].includes(frame))qaPhysicsShots[frame]=document.querySelector('canvas').toDataURL('image/png');if(frame>=300){window.qaPhysicsDriver=null;resolve({curve:qaPhysicsCurve,shots:qaPhysicsShots});}else requestAnimationFrame(sample);};requestAnimationFrame(sample);})`);
    report.curve=physicsResult.curve;for(const [frame,data] of Object.entries(physicsResult.shots))await fs.writeFile(path.join(output,'frame-'+frame+'.png'),Buffer.from(data.split(',')[1],'base64'));report.baseline=baseline;
    report.metrics={};
    for(const id of ['ChestX1','ChestX2','ChestX3','ChestY1','ChestY2','ChestY3','ChestY4']){
      const values=report.curve.map(row=>row[id]||0),tail=report.curve.filter(row=>row.t>=2).map(row=>row[id]||0);
      report.metrics[id]={peak:Math.max(...values.map(Math.abs)),peakDelta:Math.max(...values.map(v=>Math.abs(v-values.at(-1)))),tailRms:Math.sqrt(tail.reduce((sum,v)=>sum+(v-values.at(-1))**2,0)/tail.length),end:values.at(-1)};
    }
    await capture('settled');await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    if(report.errors.length||Object.values(report.metrics).some(m=>!Number.isFinite(m.peak)))throw Error('Invalid physics output');
    console.log(JSON.stringify({physics:baseline?'original':'softened',metrics:report.metrics}));win.destroy();await service.close();app.exit(0);return;
  }
  if(v5Only){
    const read=ids=>win.webContents.executeJavaScript(`Object.fromEntries(qaRuntime.getParameters().filter(p=>${JSON.stringify(ids)}.includes(p.id)).map(p=>[p.id,p.value]))`);
    const placement=(scale,revision)=>({type:'pet-scale',scale,revision,placement:{scale,centerX:550,centerY:470,referenceWidth:370,referenceHeight:575,revision}});
    await win.webContents.executeJavaScript('window.qaDirect=true;window.qaFreezePhysics=true;qaRuntime.reset();qaRuntime.clearParameters();');
    win.webContents.send('qa-desktop-event',{type:'drag-mode',enabled:true});
    report.placements=[];
    for(const [i,scale] of [1,4,.5,1].entries()){
      win.webContents.send('qa-desktop-event',placement(scale,i+1));await delay(260);
      const region=await win.webContents.executeJavaScript('qaRuntime.getInteractionRegions()');
      const frame=await win.webContents.executeJavaScript(`document.querySelector('.drag-frame').getBoundingClientRect().toJSON()`);
      const shape=nativeLog.events.filter(e=>e.action==='pet-hit-regions').at(-1)?.data;
      report.placements.push({scale,region,frame,shape});await capture('placement-'+i+'-'+scale);
      if(region.revision!==i+1||shape?.revision!==i+1||Math.abs(frame.width-region.body.width-24)>1)throw Error('Frame or native geometry did not follow placement revision');
    }
    const first=report.placements[0].region.fullBody,last=report.placements[3].region.fullBody,small=report.placements[2].region.fullBody;
    if(Math.abs(first.x-last.x)>1||Math.abs(first.y-last.y)>1||Math.abs(first.height-small.height*2)>1)throw Error('Zoom accumulated model drift or left a large empty frame');
    win.webContents.send('qa-desktop-event',placement(4,2));await delay(180);
    report.afterStalePlacement=await win.webContents.executeJavaScript('qaRuntime.getInteractionRegions()');
    if(report.afterStalePlacement.revision!==4||Math.abs(report.afterStalePlacement.fullBody.height-last.height)>1)throw Error('A stale resize response overwrote the current placement');
    win.webContents.send('qa-desktop-event',{type:'drag-mode',enabled:false});
    await win.webContents.executeJavaScript('qaRuntime.setEarImpulse(0,0)');await delay(70);const earsRest=await capture('ears-rest');
    await win.webContents.executeJavaScript('qaRuntime.setEarImpulse(.45,.36)');await delay(70);const earsImpact=await capture('ears-impact');
    report.earDifference=differences(earsRest.bytes,earsImpact.bytes,earsImpact.size);
    await win.webContents.executeJavaScript('qaRuntime.setEarImpulse(0,0)');await delay(70);const earsRestored=await capture('ears-restored');
    report.earRestoration=differences(earsRest.bytes,earsRestored.bytes,earsRestored.size);
    if(report.earDifference.changed<30||report.earRestoration.changed)throw Error('Ear impulse was invisible or accumulated permanent deformation');
    await win.webContents.executeJavaScript('window.qaDirect=false;window.qaFreezePhysics=false;qaBehavior.reset();');
    fixtureChat=new BrowserWindow({width:420,height:600,show:false,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
    await fixtureChat.loadURL(service.url+'/?view=chat');await delay(200);
    await fixtureChat.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='小动作').click()`);await delay(100);
    await fixtureChat.webContents.executeJavaScript(`document.querySelector('.basin-toggle').click()`);await delay(500);
    const worn=await read(['key10','key3','key4','key5','key6']);report.worn=worn;
    if(worn.key10<.99||!fixtureBasin)throw Error('Persistent basin UI did not equip the authored prop');
    await capture('basin-worn');
    const target=await win.webContents.executeJavaScript(`(()=>{const r=qaRuntime.getInteractionRegions().basin;return{x:Math.round(r.x+r.width*.85),y:Math.round(r.y+r.height*.25),r}})()`);
    const click=async()=>{win.webContents.sendInputEvent({type:'mouseDown',x:target.x,y:target.y,button:'left',clickCount:1});await delay(25);win.webContents.sendInputEvent({type:'mouseUp',x:target.x,y:target.y,button:'left',clickCount:1});};
    await click();await delay(40);report.firstKnock=await read(['key10','key3','key4','key5','key6','LEar1','LEar2','REar1','ParamMouthOpenY']);await capture('basin-knock');
    report.knockCount=await win.webContents.executeJavaScript('qaBehavior.knockCount');
    if(report.knockCount!==1||report.firstKnock.key3<.5||await win.webContents.executeJavaScript('qaBehavior.isPetting'))throw Error('Basin top click did not replace petting with one visible knock');
    for(let i=0;i<6;i++){await click();await delay(35);}
    const afterClicks=await win.webContents.executeJavaScript('({count:qaBehavior.knockCount,voices:qaBasinSound.voices.length,retiring:qaBasinSound.retiring.length})');
    await delay(900);report.afterRapid=await read(['key10','key3','LEar1','REar1']);report.rapid=afterClicks;
    if(afterClicks.count!==7||afterClicks.voices>4||afterClicks.retiring>4||report.afterRapid.key3>.01)throw Error('Rapid knocks queued stale reactions or lost clicks');
    await click();win.webContents.send('qa-desktop-event',{type:'input-cancel'});await delay(60);
    report.afterHide=await read(['key10','key3']);report.hiddenVoices=await win.webContents.executeJavaScript('qaBasinSound.voices.length');
    if(report.afterHide.key3>.01||report.hiddenVoices!==0)throw Error('Hide/cancel left a reaction or sound active');
    await fixtureChat.webContents.executeJavaScript(`document.querySelector('.basin-toggle').click()`);await delay(700);
    report.removed=await read(['key10','key3']);if(report.removed.key10>.01)throw Error('Basin toggle did not remove prop');
    const head=await win.webContents.executeJavaScript('(()=>{const h=qaRuntime.getInteractionRegions().head;return{x:Math.round(h.x+h.width/2),y:Math.round(h.y+h.height/2)}})()');
    win.webContents.sendInputEvent({type:'mouseDown',...head,button:'left',clickCount:1});await delay(300);report.pettingRestored=await win.webContents.executeJavaScript('qaBehavior.isPetting');win.webContents.sendInputEvent({type:'mouseUp',...head,button:'left',clickCount:1});
    if(!report.pettingRestored)throw Error('Removing basin did not restore petting');
    report.desktopEvents=nativeLog.events;await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    if(report.errors.length)throw Error(report.errors.join('; '));
    console.log(JSON.stringify({v5:'passed',rapid:report.rapid,firstKnock:report.firstKnock,placements:report.placements.map(p=>p.scale)}));fixtureChat.destroy();win.destroy();await service.close();app.exit(0);return;
  }
  if(effectsOnly){
    await win.webContents.executeJavaScript('window.qaDirect=true;window.qaFreezePhysics=true;qaRuntime.reset();qaRuntime.clearParameters();qaRuntime.setParameters({ParamEyeLOpen:1,ParamEyeROpen:1});');
    await delay(200);
    const normal=await capture('pupils-normal');
    await win.webContents.executeJavaScript('qaRuntime.setPupilScale(1.08)');await delay(100);
    const expanded=await capture('pupils-expanded');
    await win.webContents.executeJavaScript('qaRuntime.setPupilScale(1)');await delay(100);
    const restored=await capture('pupils-restored');
    report.pupilDifference=differences(normal.bytes,expanded.bytes,normal.size);
    report.pupilRestoration=differences(normal.bytes,restored.bytes,normal.size);
    if(report.pupilDifference.changed<8||report.pupilRestoration.changed!==0)throw Error('Pupil emphasis was invisible or left mesh drift');
    // Test a view where clipping makes the visible head more than 45% of the
    // visible body. The old fallback incorrectly turns it into a top strip.
    report.zoomHits=[];
    for(const [scale,offsetY] of [[1,0],[3,-2.25],[5,-3.6]]){
      await win.webContents.executeJavaScript(`qaRuntime.setView(${scale},0,${offsetY});`);await delay(150);
      const region=await win.webContents.executeJavaScript(`(()=>{const r=qaRuntime.getInteractionRegions(),c=document.querySelector('canvas').getBoundingClientRect();return{...r,canvas:c.toJSON(),x:Math.round(r.head.x+r.head.width/2+c.x),y:Math.round(r.head.y+r.head.height*.67+c.y)}})()`);
      if(region.head.width<20||region.head.height<20)throw Error('Expected visible enlarged head');
      win.webContents.sendInputEvent({type:'mouseDown',x:region.x,y:region.y,button:'left',clickCount:1});await delay(80);
      const petting=await win.webContents.executeJavaScript('qaBehavior.isPetting');
      win.webContents.sendInputEvent({type:'mouseUp',x:region.x,y:region.y,button:'left',clickCount:1});
      report.zoomHits.push({scale,offsetY,region,petting});await capture('zoom-'+scale);
      if(!petting)throw Error('Visible zoomed face missed its touch region');
      win.webContents.send('qa-desktop-event',{type:'input-cancel'});await delay(30);
    }
    if(report.zoomHits.at(-1).region.head.height/report.zoomHits.at(-1).region.body.height<.45)throw Error('Zoom case did not exercise clipped-head fallback regression');
    await win.webContents.executeJavaScript('qaRuntime.setView(1,0,0);qaRuntime.reset();window.qaDirect=false;window.qaFreezePhysics=false;qaBehavior.perform({intent:"think",emotion:"puzzled",gesture:"pointer",durationMs:8000});');await delay(1800);
    await capture('thinking-foreground');
    await win.webContents.executeJavaScript('window.qaDirect=true;window.qaFreezePhysics=true;qaRuntime.reset();qaRuntime.clearParameters();qaRuntime.setParameters({Movement3:1,Param40:1,Param36:0,Param39:.6,Param41:.79,Param42:0,Param43:0,AngleY:8,AngleX:18,AngleZ:2,ParamEyeLOpen:1,ParamEyeROpen:1});qaRuntime.setHandForeground(0)');await delay(100);
    const handBehind=await capture('thinking-hand-behind');
    await win.webContents.executeJavaScript('qaRuntime.setHandForeground(1)');await delay(100);
    const handFront=await capture('thinking-hand-front');
    report.handDifference=differences(handBehind.bytes,handFront.bytes,handFront.size);
    if(report.handDifference.changed<50)throw Error('Thinking finger did not visibly render in front');
    await win.webContents.executeJavaScript('qaRuntime.setHandForeground(0)');await delay(100);
    const handRestored=await capture('thinking-hand-restored');
    report.handRestoration=differences(handBehind.bytes,handRestored.bytes,handRestored.size);
    if(report.handRestoration.changed!==0)throw Error('Foreground effect left permanent render order changes');
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    if(report.errors.length)throw Error(report.errors.join('; '));
    console.log(JSON.stringify({effects:'passed',pupil:report.pupilDifference,hand:report.handDifference,zoomHits:report.zoomHits.map(v=>({scale:v.scale,petting:v.petting}))}));
    win.destroy();await service.close();app.exit(0);return;
  }
  if(replyFlowOnly){
    const flow=()=>win.webContents.executeJavaScript('qaFlow');
    const waitUntil=async(expression,timeout=6000)=>{const start=Date.now();while(!await win.webContents.executeJavaScript(expression)){if(Date.now()-start>timeout)throw Error('Timed out: '+expression);await delay(80);}};
    const startChat=async text=>{const index=chatJobs.length;const work=request('/api/chat',{text}).then(value=>({value}),error=>({error:String(error)}));const start=Date.now();while(chatJobs.length===index){if(Date.now()-start>2000)throw Error('Adapter did not start');await delay(20);}return{job:chatJobs[index],work};};
    const answer=(id,text)=>({id,segments:[{text,intent:'explain',emotion:'happy',gesture:'pointer'}],details:'',sources:[]});
    const ideaCount=async()=>(await flow()).filter(e=>e.command?.intent==='idea').length;
    const first=await startChat('第一题');await delay(1450);
    report.waiting=await params();await capture('waiting-thinking');
    if(report.waiting.key8<.9)throw Error('Thinking loading did not persist while waiting');
    first.job.resolve(answer('success-1','这是第一句。'));const firstResponse=await first.work;await delay(120);
    const ideaBubble=await win.webContents.executeJavaScript("document.querySelector('.speech-bubble')?.textContent");
    if(ideaBubble!=='想到了！'||await ideaCount()!==1)throw Error('Success did not enter exactly one idea presentation');
    // The real server emits idle immediately after chat: that snapshot must not cut the gate short.
    await delay(750);report.idea=await params();await capture('idea-before-speech');
    if(report.idea.key8>.05)throw Error('Loading expression was not cleared during idea');
    await waitUntil("qaFlow.some(e=>e.command?.text==='这是第一句。')");
    const firstFlow=await flow(),idea=firstFlow.find(e=>e.command?.intent==='idea'),spoken=firstFlow.find(e=>e.command?.text==='这是第一句。');
    report.success={gateMs:spoken.at-idea.at,ideaCount:await ideaCount(),voiceDisabledAudioCalls:firstFlow.filter(e=>e.kind==='audio-request').length};
    if(report.success.gateMs<1750||report.success.gateMs>2500||report.success.voiceDisabledAudioCalls)throw Error('Silent reply gate timing was incorrect');
    if(replyPoseOnly){
      await capture('first-reply');report.flow=await flow();await request('/api/stop',{});await delay(2200);
      report.afterStop=await params();report.overlayAfterStop=await win.webContents.executeJavaScript('qaBehavior.poseWeight');
      await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
      if(report.overlayAfterStop!==0||report.afterStop.Movement2>.01||report.afterStop.Movement3>.01)throw Error('Stop left an arm overlay active');
      console.log(JSON.stringify({replyPose:'passed',success:report.success,overlayAfterStop:report.overlayAfterStop}));win.destroy();await service.close();app.exit(0);return;
    }
    await win.webContents.executeJavaScript(`qaHandleEvent(${JSON.stringify({type:'chat',reply:firstResponse.value})})`);await delay(120);
    if(await ideaCount()!==1)throw Error('Duplicate reply replayed idea');
    await request('/api/stop',{});
    const stopped=await startChat('停止案例');stopped.job.resolve(answer('stopped','不应显示的旧回复'));await stopped.work;await delay(200);
    report.close=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const rows=[],targets=[0,.15,.3,.45,.533,.55,.65,.85,1.1,1.4],deadline=performance.now()+9000;let start=null;function frame(){const arm=qaArmProbe();if(start===null&&!arm.active)start=qaBehavior.time;if(start!==null&&qaBehavior.time-start>=targets[rows.length]){rows.push({target:targets[rows.length],sinceClose:qaBehavior.time-start,parameters:Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(Movement[123]|Param(36|39|41|42|59|60|61|62))$/.test(p.id)).map(p=>[p.id,p.value])),arm,image:document.querySelector('canvas').toDataURL('image/png')});}if(rows.length===targets.length)return resolve(rows);if(performance.now()>deadline)return reject(Error('Author close capture timed out'));requestAnimationFrame(frame);}requestAnimationFrame(frame);})`);
    for(const row of report.close){await fs.writeFile(path.join(output,'natural-close-'+Math.round(row.target*1000)+'-canvas.png'),Buffer.from(row.image.split(',')[1],'base64'));delete row.image;}
    if(report.close.slice(0,8).some(row=>row.arm.presence!==1))throw Error('Mirrored arm disappeared before the authored close finished');
    if(report.close.filter(row=>row.target>=.65).some(row=>row.parameters.Movement2>.001))throw Error('A fading pose resurrected the chest hand after the author switched back to the default rig');
    await request('/api/stop',{});await delay(500);
    await request('/api/command',{type:'perform',intensity:.85,...preset});await delay(1200);
    const handoffThink=await win.webContents.executeJavaScript(`qaActions.find(a=>a.command.intent==='think').command`);await request('/api/command',{type:'perform',...handoffThink});report.handoff=[];
    for(let i=0;i<20;i++){await delay(100);report.handoff.push({...await params(),arm:await win.webContents.executeJavaScript('qaArmProbe()')});}
    if(report.handoff.some(row=>row.Movement3>.5&&row.arm.presence>.01)||report.handoff.at(-1).Movement3<.95)throw Error('Mirrored arm ownership leaked into the next pointing animation');
    await capture('immediate-cuddle-thinking');await request('/api/stop',{});await delay(500);
    if((await flow()).some(e=>e.command?.text==='不应显示的旧回复'))throw Error('Stop did not cancel the delayed reply');
    const old=await startChat('被替换的题目');old.job.resolve(answer('old-reply','替换后不应朗读'));await old.work;await delay(200);
    const newest=await startChat('新题目');await delay(150);newest.job.resolve(answer('new-reply','新题目的回复'));await newest.work;
    await waitUntil("qaFlow.some(e=>e.command?.text==='新题目的回复')");
    if((await flow()).some(e=>e.command?.text==='替换后不应朗读'))throw Error('New request did not cancel old idea gate');
    await request('/api/stop',{});
    const beforeError=await ideaCount(),failed=await startChat('错误案例');failed.job.reject(new Error('fixture failure'));await failed.work;await delay(350);
    if(await ideaCount()!==beforeError)throw Error('Provider error triggered idea');
    await request('/api/command',{type:'speak',text:'直接说话',intent:'neutral',gesture:'none'});await delay(250);
    if(await ideaCount()!==beforeError)throw Error('Direct speak without thinking inserted idea');
    await request('/api/stop',{});
    // Real system WAV / SpeechPlayer, muted test output. It cannot start before the gate.
    await request('/api/settings',{voiceEnabled:true});
    const voice=await startChat('语音案例');voice.job.resolve(answer('voice-reply','你好。'));await voice.work;
    await waitUntil("qaFlow.some(e=>e.kind==='audio-start'&&e.text==='你好。')",25000);
    const voiceFlow=await flow(),voiceIdea=voiceFlow.filter(e=>e.command?.intent==='idea').at(-1),audioRequest=voiceFlow.find(e=>e.kind==='audio-request'&&e.text==='你好。'),audioStart=voiceFlow.find(e=>e.kind==='audio-start'&&e.text==='你好。');
    report.voice={requestDelayMs:audioRequest.at-voiceIdea.at,audioStartDelayMs:audioStart.at-voiceIdea.at};
    if(report.voice.requestDelayMs<1750)throw Error('Audio was requested before idea completed');
    await request('/api/stop',{});
    report.flow=await flow();report.cases=['success','duplicate','idle snapshot','voice off','stop during idea','new request during idea','provider error','direct speak','real voice gate'];
    report.notice=await win.webContents.executeJavaScript("document.querySelector('.pet-notice')?.textContent||''");
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    if(report.notice||report.errors.length)throw Error(report.notice||report.errors.join('; '));
    console.log(JSON.stringify({replyFlow:'passed',cases:report.cases,success:report.success,voice:report.voice}));win.destroy();await service.close();app.exit(0);return;
  }
  if(transitionsOnly){
    await fs.writeFile(path.join(output,'all-parameters.json'),JSON.stringify(await win.webContents.executeJavaScript('qaRuntime.getParameters()'),null,2));
    report.parameterRanges=await win.webContents.executeJavaScript(`qaRuntime.getParameters().filter(p=>/^(Angle[XYZ]|Position[XYZ]|LeanInput|ParamEye[LR]Open|ParamEyeBall[XY]|ParamMouthForm)$/.test(p.id))`);
    await fs.writeFile(path.join(output,'parameter-ranges.json'),JSON.stringify(report.parameterRanges,null,2));
    await win.webContents.executeJavaScript('window.qaDirect=true;qaRuntime.clearParameters();qaRuntime.reset();');
    report.transitions=[];
    for(const [open,close] of [['默认手切举手','举手切默认手'],['竖手指切出来动画','竖手指切回默认'],['狗尾草切换出来','狗尾草切回默认手']]){
      await win.webContents.executeJavaScript(`qaRuntime.reset();qaRuntime.playMotion(${JSON.stringify(open)},{holdLastFrame:true})`);await delay(1750);
      const held=await capture(open+'-held');
      const tracePromise=win.webContents.executeJavaScript(`new Promise(resolve=>{const samples=[];const start=performance.now();window.qaTraceStart=start;function frame(now){samples.push({ms:now-start,p:Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(Movement[123]|Param(56|57|62|59|60|61|36|39|40|41|42|43))$/.test(p.id)).map(p=>[p.id,p.value]))});if(now-start<2850)requestAnimationFrame(frame);else resolve(samples);}requestAnimationFrame(frame);})`);
      await delay(65);
      const stopMs=await win.webContents.executeJavaScript('qaRuntime.stopMotion();performance.now()-qaTraceStart');
      // A delayed first fetch must not reveal defaults while the close asset loads.
      await delay(90);const gap=await capture(open+'-loading-gap');
      const closeMs=await win.webContents.executeJavaScript(`qaRuntime.playMotion(${JSON.stringify(close)},{loop:false,holdLastFrame:false,fadeMs:200}).then(()=>performance.now()-qaTraceStart)`);
      await delay(800);const nearEnd=await capture(close+'-near-end');
      await delay(400);const afterEnd=await capture(close+'-after-end');
      const samples=await tracePromise;
      const ranges=Object.fromEntries((await win.webContents.executeJavaScript('qaRuntime.getParameters()')).map(p=>[p.id,p.max-p.min]));
      const jumps=[];
      for(let i=1;i<samples.length;i++)for(const [id,value] of Object.entries(samples[i].p)){
        const normalized=Math.abs(value-samples[i-1].p[id])/(ranges[id]||1);
        if(normalized>.015)jumps.push({id,ms:samples[i].ms,dt:samples[i].ms-samples[i-1].ms,normalized,from:samples[i-1].p[id],to:value});
      }
      const stopJumps=jumps.filter(j=>j.ms>=stopMs&&j.ms<closeMs+30);
      // Param56/57 are authored sawtooth phase clocks: IDLE intentionally resets
      // them 1->0 once per cycle. Keep their trace, but do not call that a regression.
      const tailJumps=jumps.filter(j=>j.ms>closeMs+1250&&!['Param56','Param57'].includes(j.id));
      const result={open,close,stopMs,closeMs,loadingGapPixels:differences(held.bytes,gap.bytes,gap.size),endingPixels:differences(nearEnd.bytes,afterEnd.bytes,afterEnd.size),maxStopJump:Math.max(0,...stopJumps.map(j=>j.normalized)),maxTailJump:Math.max(0,...tailJumps.map(j=>j.normalized)),jumps,samples};
      report.transitions.push(result);console.log(JSON.stringify({open,maxStopJump:result.maxStopJump,maxTailJump:result.maxTailJump}));
    }
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    if(!baseline&&report.transitions.some(t=>t.maxStopJump>.12||t.maxTailJump>.16))throw Error('Motion transition has an abrupt upstream parameter jump');
    win.destroy();await service.close();app.exit(0);return;
  }
  if(!inputOnly){
  const actions=await win.webContents.executeJavaScript('qaActions');
  for(let i=0;i<actions.length;i++){
    await request('/api/command',{type:'reset'});await delay(1400);
    const before=await capture(`preset-${i}-before`);
    await request('/api/command',{type:'perform',intensity:.85,durationMs:6500,...actions[i].command});
    const curve=[];
    for(let j=0;j<12;j++){await delay(125);curve.push(await params());}
    const after=await capture(`preset-${i}-after`);
    const regions=await win.webContents.executeJavaScript(`({regions:qaRuntime.getInteractionRegions(),canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(),ratio:devicePixelRatio})`);
    const head=regions.regions.head;
    const headRect={x:(head.x+regions.canvas.x)*regions.ratio,y:(head.y+regions.canvas.y)*regions.ratio,width:head.width*regions.ratio,height:head.height*regions.ratio};
    const diff=differences(before.bytes,after.bytes,after.size);
    const headDiff=differences(before.bytes,after.bytes,after.size,headRect);
    report.presets.push({title:actions[i].title,command:actions[i].command,diff,headDiff,curve,regions});
    if(actions[i].command.intent==='cuddle'&&(curve.at(-1).Movement2<.95||curve.at(-1).Movement3>.01||curve.at(-1).Param37>.01||curve.at(-1).Param38>.01))throw Error('Cuddle preset did not raise both authored hand rigs');
    if(diff.changed<500)throw new Error('Preset did not visibly change: '+actions[i].title);
    console.log(JSON.stringify({preset:actions[i].title,changedPixels:diff.changed,headPixels:headDiff.changed,parameters:curve.at(-1)}));
  }
  // Persistent thinking must animate the author's spinner loop across time.
  await request('/api/command',{type:'reset'});await delay(800);
  await request('/api/command',{type:'state',state:'thinking'});await delay(1700);
  const thoughtA=await capture('thinking-a'), thoughtParamsA=await params();await delay(600);
  const thoughtB=await capture('thinking-b'), thoughtParamsB=await params();
  report.thinking={diff:differences(thoughtA.bytes,thoughtB.bytes,thoughtB.size),before:thoughtParamsA,after:thoughtParamsB};
  if(thoughtParamsB.key8<.9||Math.abs(thoughtParamsA.Param11-thoughtParamsB.Param11)<.05)throw new Error('Thinking effect did not persist/animate');
  }
  await request('/api/command',{type:'reset'});await delay(800);
  const headPoint=await win.webContents.executeJavaScript(`(()=>{const h=qaRuntime.getInteractionRegions().head,r=document.querySelector('canvas').getBoundingClientRect();return{x:Math.round(r.x+h.x+h.width/2),y:Math.round(r.y+h.y+h.height*.4)};})()`);
  const beforePat=await capture('petting-before'), beforePatParams=await params();
  win.webContents.sendInputEvent({type:'mouseMove',...headPoint});
  win.webContents.sendInputEvent({type:'mouseDown',...headPoint,button:'left',clickCount:1});
  const patCurve=[];
  for(let i=0;i<16;i++){
    await delay(250);
    win.webContents.sendInputEvent({type:'mouseMove',x:headPoint.x+Math.round(Math.sin(i)*20),y:headPoint.y+Math.round(Math.cos(i)*5),modifiers:['leftButtonDown']});
    patCurve.push({...await params(),...await win.webContents.executeJavaScript('({isPetting:qaBehavior.isPetting,cuddleWeight:qaBehavior.cuddleWeight})')});
  }
  const duringPat=await capture('petting-held');
  win.webContents.sendInputEvent({type:'mouseUp',...headPoint,button:'left',clickCount:1});await delay(2200);
  const released={...await params(),isPetting:await win.webContents.executeJavaScript('qaBehavior.isPetting')};
  await capture('petting-released');
  win.webContents.sendInputEvent({type:'mouseDown',...headPoint,button:'left',clickCount:1});await delay(350);
  await request('/api/stop',{});await delay(100);
  win.webContents.sendInputEvent({type:'mouseMove',x:headPoint.x+15,y:headPoint.y,modifiers:['leftButtonDown']});await delay(350);
  const stopped=await win.webContents.executeJavaScript('qaBehavior.isPetting');
  win.webContents.sendInputEvent({type:'mouseUp',...headPoint,button:'left',clickCount:1});
  report.petting={headPoint,before:beforePatParams,curve:patCurve,released,stopped,diff:differences(beforePat.bytes,duringPat.bytes,duringPat.size)};
  if(!patCurve.every(p=>p.isPetting)||released.isPetting||stopped)throw Error('Pointer hold/release/stop lifecycle failed');
  if(Math.max(...patCurve.map(p=>p.ParamMouthForm))<.35||Math.min(...patCurve.map(p=>p.ParamEyeLOpen))>.85)throw Error('Petting did not visibly soften eyes/smile');
  if(patCurve.slice(3).some(p=>p.ParamEyeLOpen!==0||p.ParamEyeROpen!==0))throw Error('Sustained petting did not fully close both eyes');
  if(patCurve.slice(0,6).some(p=>p.Movement2>.01||p.Param37>.01||p.cuddleWeight>.01)||patCurve.at(-1).Movement2<.95||patCurve.at(-1).Movement3>.01||patCurve.at(-1).Param37>.01||patCurve.at(-1).Param38>.01)throw Error('Two-second sustained touch threshold failed');
  if(released.Movement2>.01||released.Movement3>.01)throw Error('Released touch left a hand overlay active');
  console.log(JSON.stringify({petting:'passed',changedPixels:report.petting.diff.changed,released:released.isPetting,stopped}));
  const isPetting=()=>win.webContents.executeJavaScript('qaBehavior.isPetting');
  const bodyPoint=await win.webContents.executeJavaScript(`(()=>{const b=qaRuntime.getInteractionRegions().body,r=document.querySelector('canvas').getBoundingClientRect();return{x:Math.round(r.x+b.x+b.width/2),y:Math.round(r.y+b.y+b.height*.6)};})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...headPoint});
  win.webContents.sendInputEvent({type:'mouseDown',...headPoint,button:'left',clickCount:1});await delay(60);
  win.webContents.sendInputEvent({type:'mouseUp',...headPoint,button:'left',clickCount:1});await delay(100);
  const shortTapFeedback=await isPetting();
  win.webContents.sendInputEvent({type:'mouseMove',...bodyPoint});
  win.webContents.sendInputEvent({type:'mouseDown',...bodyPoint,button:'left',clickCount:1});await delay(100);
  const bodyDown=await isPetting();
  win.webContents.sendInputEvent({type:'mouseUp',...bodyPoint,button:'left',clickCount:1});await delay(850);
  const afterOldFeedbackDeadline=await isPetting();
  if(!shortTapFeedback||bodyDown||afterOldFeedbackDeadline)throw Error('Short tap -> non-head press did not clear old feedback');
  const tapWeights=[];
  for(let i=0;i<7;i++){
    win.webContents.sendInputEvent({type:'mouseMove',...headPoint});win.webContents.sendInputEvent({type:'mouseDown',...headPoint,button:'left',clickCount:1});await delay(60);
    win.webContents.sendInputEvent({type:'mouseUp',...headPoint,button:'left',clickCount:1});await delay(270);
    tapWeights.push(await win.webContents.executeJavaScript('qaBehavior.cuddleWeight'));
  }
  if(tapWeights.some(weight=>weight>.01))throw Error('Repeated short taps accumulated into a sustained cuddle');
  await delay(900);report.repeatedTapWeights=tapWeights;
  win.webContents.sendInputEvent({type:'mouseMove',...headPoint});
  win.webContents.sendInputEvent({type:'mouseDown',...headPoint,button:'left',clickCount:1});await delay(150);
  const beforeUnrelatedPointer=await isPetting();
  await win.webContents.executeJavaScript(`for(const type of ['pointerup','pointercancel'])document.querySelector('.pet-stage').dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:9999,pointerType:'touch',isPrimary:false}));`);
  const afterUnrelatedPointer=await isPetting();
  // Uses the real preload subscription and production desktop event callback.
  win.webContents.send('qa-desktop-event',{type:'input-cancel'});await delay(120);
  const desktopCanceled=await isPetting();
  win.webContents.sendInputEvent({type:'mouseMove',x:headPoint.x+10,y:headPoint.y,modifiers:['leftButtonDown']});await delay(120);
  const moveAfterCancel=await isPetting();
  win.webContents.sendInputEvent({type:'mouseUp',...headPoint,button:'left',clickCount:1});
  if(!beforeUnrelatedPointer||!afterUnrelatedPointer||desktopCanceled||moveAfterCancel)throw Error('Pointer ID / desktop input-cancel lifecycle failed');
  report.inputLifecycle={shortTapFeedback,bodyDown,afterOldFeedbackDeadline,beforeUnrelatedPointer,afterUnrelatedPointer,desktopCanceled,moveAfterCancel};
  await capture('input-canceled');
  console.log(JSON.stringify({inputLifecycle:'passed',...report.inputLifecycle}));
  const trackEvent=(active,x=0,y=0,speed=0)=>win.webContents.send('qa-desktop-event',{type:'pointer-tracking',active,x,y,speed});
  trackEvent(false);await delay(100);
  report.documentHidden=await win.webContents.executeJavaScript('document.hidden');
  trackEvent(true,-1000,-1000,1);await delay(1000);
  const trackLeft=await params(), leftImage=await capture('tracking-left-up');
  const trackingActive=await win.webContents.executeJavaScript('qaBehavior.isPointerTracking');
  trackEvent(true,1500,1500,1);await delay(1100);
  const trackRight=await params(), rightImage=await capture('tracking-right-down');
  trackEvent(false);await delay(35);const justReleased=await params();await delay(1400);const recovered=await params();
  await capture('tracking-recovered');
  trackEvent(true,1500,0,.8);await delay(250);await request('/api/stop',{});await delay(100);
  trackEvent(true,1500,0,.8);await delay(100);const blocked=await win.webContents.executeJavaScript('qaBehavior.isPointerTracking');trackEvent(false);
  report.tracking={trackingActive,left:trackLeft,right:trackRight,justReleased,recovered,blocked,diff:differences(leftImage.bytes,rightImage.bytes,rightImage.size)};
  if(!trackingActive||trackLeft.AngleX>-15||trackRight.AngleX<15||trackLeft.AngleY<8||trackRight.AngleY>-8||trackLeft.PositionX>-8||trackRight.PositionX<8)throw Error('Desktop pointer tracking did not produce large directional movement');
  if(Math.abs(justReleased.AngleX)<Math.abs(trackRight.AngleX)*.5||Math.abs(recovered.AngleX)>2||blocked)throw Error('Pointer tracking release/stop did not preserve a smooth recovery');
  console.log(JSON.stringify({tracking:'passed',leftAngleX:trackLeft.AngleX,rightAngleX:trackRight.AngleX,immediateReleaseAngleX:justReleased.AngleX,recoveredAngleX:recovered.AngleX,blocked}));
  if(!inputOnly&&!posesOnly){
  await request('/api/command',{type:'reset'});await delay(800);
  await win.webContents.executeJavaScript('window.qaDirect=true;qaRuntime.clearParameters();qaRuntime.reset();');
  const groups=[['默认手切举手','举手切默认手'],['竖手指切出来动画','竖手指切回默认'],['狗尾草切换出来','狗尾草切回默认手'],['IDLE'],['脱捕']];
  for(const group of groups){
    await win.webContents.executeJavaScript('qaRuntime.reset()');await delay(700);
    // Author IDLE animates effect phases, which are intentionally hidden without an expression.
    if(group[0]==='IDLE'){await win.webContents.executeJavaScript(`qaRuntime.setExpression('加载',true)`);await delay(300);}
    let before=await capture('motion-'+group[0]+'-before');
    for(const name of group){
      const file=manifest.motions.find(m=>m.name===name).file;
      const motionJson=await request('/model/'+file.split('/').map(encodeURIComponent).join('/'));
      const close=name.includes('回默认')||name==='举手切默认手';
      await win.webContents.executeJavaScript(`qaRuntime.playMotion(${JSON.stringify(file)},{loop:false,holdLastFrame:${!close}})`);
      const curve=[];
      const seconds=Math.min(motionJson.Meta.Duration,3.5);
      for(let j=0;j<14;j++){await delay(seconds*1000/14);curve.push(await params());}
      if(motionJson.Meta.Duration<3.5)await delay(250);
      const after=await capture('motion-'+name+'-after');
      const diff=differences(before.bytes,after.bytes,after.size);
      report.motions.push({name,authoredDuration:motionJson.Meta.Duration,sampledSeconds:seconds,diff,curve});
      if(diff.changed<(name==='IDLE'?50:500))throw new Error('Motion did not visibly change: '+name);
      console.log(JSON.stringify({motion:name,changedPixels:diff.changed,parameters:curve.at(-1)}));before=after;
    }
  }
  // Alternate aliases must refer to one expression state, including deactivation.
  await win.webContents.executeJavaScript(`(async()=>{qaRuntime.reset();await qaRuntime.setExpression('Exp3/加载.exp3.json',true)})()`);await delay(350);
  const aliasOn=await params();await win.webContents.executeJavaScript(`qaRuntime.setExpression('加载',false)`);await delay(750);
  const aliasOff=await params();report.aliasToggle={on:aliasOn.key8,off:aliasOff.key8};
  if(aliasOn.key8<.9||aliasOff.key8>.01)throw Error('Canonical expression alias toggle failed');
  }
  const notices=await win.webContents.executeJavaScript(`document.querySelector('.pet-notice')?.textContent||''`);if(notices)report.errors.push(notices);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
  if(report.errors.length)throw Error(report.errors.join('; '));
  console.log(inputOnly?'PASS: production React pointer lifecycle, petting, and tracking.':posesOnly?'PASS: all real React presets, sustained-touch threshold, and pointer lifecycle.':'PASS: all real React presets, eight authored motions, and pointer lifecycle.');
  win.destroy();await service.close();app.exit(0);
})().catch(async error=>{report.failure=String(error.stack||error);await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)).catch(()=>{});console.error(error);win?.destroy();await service?.close();app.exit(1);});
