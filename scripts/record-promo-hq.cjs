/* Lossless native-resolution promo capture. Uses only explicit local assets.
 * electron scripts/record-promo-hq.cjs --manifest=FILE --out=DIR --model=DIR
 * Optional --only=label and --limit-seconds=3 for a bounded QA pass.
 * The original media, user app, DSH and audio playback are never touched.
 */
'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const {build}=require('esbuild');
const root=path.resolve(__dirname,'..');
const arg=(name,fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const manifestPath=path.resolve(arg('manifest','output/video1080/capture-jobs.json'));
const output=path.resolve(arg('out','output/video1080/capture'));
const modelRoot=arg('model',process.env.L2D_MODEL_ROOT);
if(!modelRoot)throw Error('An explicit --model directory or L2D_MODEL_ROOT is required');
const runtimeDir=path.join(output,'.runtime');
app.setPath('userData',path.join(runtimeDir,'profile-'+process.pid));
app.commandLine.appendSwitch('force-device-scale-factor','2');
let service,win,encoder,encoderDone,encoderError='',framesWritten=0,activeDirectory;
const errors=[];
const WIDTH=1920,HEIGHT=1080,FPS=30;
const writeJson=(file,data)=>fs.writeFile(file,JSON.stringify(data,null,2));
const log=value=>process.stdout.write(JSON.stringify(value)+'\n');
const watchdog=setTimeout(()=>{console.error('HQ capture watchdog expired');encoder?.stdin.destroy();win?.destroy();app.exit(2);},1800000);
async function startEncoder(directory,frames){
  const file=path.join(directory,'footage.mkv');
  encoderError='';framesWritten=0;activeDirectory=directory;
  encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${WIDTH}x${HEIGHT}`,
    '-framerate',String(FPS),'-i','pipe:0','-an','-frames:v',String(frames),'-c:v','libx264rgb','-preset','veryfast','-crf','0','-pix_fmt','rgb24','-threads','4',file],{windowsHide:true});
  encoder.stderr.on('data',data=>{encoderError=(encoderError+data.toString()).slice(-6000);});
  encoder.stdin.on('error',()=>{});
  encoderDone=new Promise((resolve,reject)=>{encoder.once('error',reject);encoder.once('exit',code=>code===0?resolve():reject(Error(`Encoder ${code}: ${encoderError}`)));});
  // Attach rejection immediately; awaited normally once stdin has closed.
  encoderDone.catch(()=>{});
}
ipcMain.handle('hq-frame',async(event,bytes)=>{
  if(event.sender!==win?.webContents||!encoder)throw Error('No active isolated capture');
  const frame=Buffer.from(bytes);if(frame.length!==WIDTH*HEIGHT*4)throw Error('Invalid raw frame dimensions');
  await new Promise((resolve,reject)=>encoder.stdin.write(frame,error=>error?reject(error):resolve()));
  framesWritten++;
  if(framesWritten%150===0)log({capture:path.basename(activeDirectory),frames:framesWritten});
  return framesWritten;
});

async function captureBrowser(options){
  const source=document.querySelector('#model'),canvas=document.querySelector('#output'),ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
  const sceneSeconds=options.sceneSeconds??options.seconds;
  const petEnd=Number.isFinite(options.petEnd)?Math.max(0,Math.min(sceneSeconds,options.petEnd)):Math.max(5,sceneSeconds-2.5);
  let background=null,audio=null;
  if(options.backgroundDataURL){background=new Image();background.src=options.backgroundDataURL;await background.decode();}
  if(options.audioBase64){
    const bytes=Uint8Array.from(atob(options.audioBase64),c=>c.charCodeAt(0));
    const offline=new OfflineAudioContext(1,1,48000);audio=await offline.decodeAudioData(bytes.buffer);
  }
  const audioLevel=time=>{
    if(!audio||!options.mouth||time<0||time>=audio.duration)return 0;
    const data=audio.getChannelData(0),at=Math.floor(time*audio.sampleRate);let energy=0;
    for(let n=0;n<512;n++){const sample=data[at-511+n]||0;energy+=sample*sample;}
    const rms=Math.sqrt(energy/512);return rms<.009?0:Math.min(1,Math.pow(rms*4.2,.65));
  };
  window.hqRuntime.reset();window.hqBehavior?.destroy();
  window.hqBehavior=new window.HqBehavior(window.hqRuntime,{clockSeconds:()=>window.hqTime,random:()=>.4,onEvent:event=>{if(event.type==='error')window.hqErrors.push(event.message||String(event.error));}});
  hqBehavior.setTuning({idleActivity:.55,bodyMotion:1,gestureAmplitude:1});
  hqBehavior.setBasinEnabled(false);hqBehavior.setPointerTracking(false);
  window.hqLevel=0;
  // Stabilize only simulation state; no real-time sleep is needed.
  for(let i=0;i<90;i++){await window.hqStep();}
  hqBehavior.reset();await window.hqFlushAssets();
  const epoch=hqTime;let eventAt=0,talkAt=null,lastChestPulse=-Infinity,audioEnded=false;
  const mouthSamples=[],interactionEvents=[];
  const events=options.events??(options.scene==='sample'?[[0,'think'],[3.2,'idea'],[5.3,'talk']]
    :options.scene==='expressions'?[[0,'happy'],[3,'puzzled'],[6,'shy'],[9,'squeezed']]
    :options.scene==='arms'?[[0,'pointer-left'],[5,'pointer-right'],[10,'chest-both']]
    :options.scene==='pet'?[[0,'pet-start'],[petEnd,'pet-end']]
    :options.scene==='basin'?[[0,'basin-start'],[2,'knock'],[4,'knock'],[5,'knock'],[5.5,'knock'],[6,'knock'],[8.2,'knock']]
    :options.scene==='gaze'?[[0,'gaze']]:options.scene==='idle'?[]:[[0,'talk']]);
  const fire=(name,time)=>{
    if(name.startsWith('expression:'))hqBehavior.previewExpression(name.slice(11),{durationMs:60000,intensity:.85});
    else if(name==='think'){if(audio&&options.mouth)hqBehavior.perform({intent:'think',emotion:'puzzled',gesture:'pointer',durationMs:3200});else hqBehavior.setState('thinking');}
    else if(name==='idea'){if(!audio||!options.mouth)hqBehavior.setState('idle');hqBehavior.perform({intent:'idea',emotion:'happy',gesture:'pointer',durationMs:1800});}
    else if(name==='talk'){if(!audio||!options.mouth)hqBehavior.setState('idle');talkAt=time;hqBehavior.previewExpression('gentle',{durationMs:60000,intensity:.65});}
    else if(['happy','puzzled','shy','squeezed'].includes(name))hqBehavior.previewExpression(name,{durationMs:20000,intensity:.85});
    else if(['pointer-left','pointer-right','chest-both'].includes(name))hqBehavior.previewBodyAnimation(name,{intensity:.9,durationMs:4500});
    else if(name==='pet-start'){hqBehavior.setPetting(true,{x:0,y:0,speed:.5,newContact:true});interactionEvents.push({name,time,petting:hqBehavior.isPetting});}
    else if(name==='pet-end'){hqBehavior.setPetting(false);interactionEvents.push({name,time,petting:hqBehavior.isPetting});}
    else if(name==='chest-tap'){
      const accepted=hqBehavior.tapChest();lastChestPulse=time;
      interactionEvents.push({name,time,accepted,stage:hqBehavior.chestReaction?.stage??null,completed:hqBehavior.completedChestStage,armed:hqBehavior.isChestHeartArmed});
    }else if(name==='basin-start')hqBehavior.setBasinEnabled(true);
    else if(name==='knock')hqBehavior.knockBasin();
  };
  if(audio&&options.mouth)hqBehavior.setState('speaking');
  const dest=options.framing==='close'?{x:210,y:-70,w:1500,h:2400}:{x:740,y:-50,w:1300,h:2080};
  let poster='';const total=Math.round(options.seconds*30);
  for(let frame=0;frame<total;frame++){
    for(let sub=0;sub<2;sub++){
      const time=frame/30+sub/60;
      while(eventAt<events.length&&events[eventAt][0]<=time){fire(events[eventAt][1],time);eventAt++;}
      if(audio&&options.mouth&&!audioEnded&&time>=audio.duration){audioEnded=true;hqBehavior.setState('idle');}
      if(talkAt!==null){const duration=Math.max(.3,sceneSeconds-talkAt-1.4),elapsed=Math.max(0,time-talkAt);if(elapsed<duration)hqBehavior.setSpeechGesture({id:'talk',gesture:'pointer',key:'promo-talk',intensity:.85,durationMs:duration*1000,progress:elapsed/duration,elapsedSeconds:elapsed,continuous:true});else hqBehavior.clearSpeechGesture();}
      if(options.scene==='pet'&&time<petEnd)hqBehavior.setPetting(true,{x:.6*Math.sin(time*2.2),y:0,speed:.6});
      if(options.scene==='easter'&&hqBehavior.isPetting)hqBehavior.setPetting(true,{x:.5*Math.sin(time*2.2),y:0,speed:.5});
      if(options.scene==='gaze')hqBehavior.setPointerTracking(true,{x:.85*Math.sin(time*.65),y:.5*Math.sin(time*.92),speed:.3,travel:.8});
      hqLevel=audioLevel(time);await hqFlushAssets();await hqStep();
    }
    ctx.fillStyle=options.background==='transparent'?'#f5f8ff':(options.background||'#f5f8ff');ctx.fillRect(0,0,1920,1080);
    if(background)ctx.drawImage(background,0,0,1920,1080);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,dest.x,dest.y,dest.w,dest.h);
    const time=frame/30;
    if((options.scene==='pet'&&time<petEnd)||(options.scene==='easter'&&hqBehavior.isPetting)){
      const head=hqRuntime.getInteractionRegions()?.head;
      if(head){const x=dest.x+(head.x+head.width*(.5+.25*Math.sin(time*2.2)))/750*dest.w,y=dest.y+(head.y+head.height*.35)/1200*dest.h;ctx.strokeStyle='#6c8edc';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#6c8edc33';ctx.fill();}
    }
    if(options.scene==='easter'&&time-lastChestPulse<.48){const chest=hqRuntime.getInteractionRegions()?.chest;if(chest){const progress=(time-lastChestPulse)/.48,x=dest.x+(chest.x+chest.width*.5)/750*dest.w,y=dest.y+(chest.y+chest.height*.54)/1200*dest.h;ctx.strokeStyle=`rgba(49,191,215,${1-progress})`;ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,14+progress*23,0,Math.PI*2);ctx.stroke();}}
    if(frame%3===0)mouthSamples.push({time,level:hqLevel,mouth:hqRuntime.getParameters().find(p=>p.id==='ParamMouthOpenY')?.value});
    if(!poster&&frame>=Math.round(total*.45))poster=canvas.toDataURL('image/png');
    await window.hqIO.frame(ctx.getImageData(0,0,1920,1080).data.buffer);
  }
  const {audioBase64,backgroundDataURL,...metadata}=options;
  return {...metadata,frames:total,fps:30,simulationHz:60,simulationSeconds:hqTime-epoch,canvas:{width:source.width,height:source.height,cssWidth:source.clientWidth,cssHeight:source.clientHeight},mouthSamples,interactionEvents,
    finalInteraction:{stage:hqBehavior.chestReaction?.stage??null,completed:hqBehavior.completedChestStage,armed:hqBehavior.isChestHeartArmed,petting:hqBehavior.isPetting},poster,errors:[...hqErrors]};
}

(async()=>{
  await fs.mkdir(runtimeDir,{recursive:true});
  let jobs=JSON.parse(await fs.readFile(manifestPath,'utf8'));const only=arg('only',null),limit=Number(arg('limit-seconds','0'));
  if(!Array.isArray(jobs)||!jobs.length)throw Error('Manifest must be a nonempty array');
  if(only)jobs=jobs.filter(job=>job.label===only);if(!jobs.length)throw Error('Selected job missing');
  for(const job of jobs){if(!/^[a-z0-9-]+$/.test(job.label)||!Number.isFinite(job.seconds)||job.seconds<.5||job.seconds>300)throw Error('Invalid capture job');}
  await fs.cp(path.join(root,'public/vendor'),path.join(runtimeDir,'vendor'),{recursive:true});
  const moduleSource=`export {createLive2D} from ${JSON.stringify(path.join(root,'src/renderer/live2d.ts').replaceAll('\\','/'))};export {BehaviorController} from ${JSON.stringify(path.join(root,'src/shared/behavior.mjs').replaceAll('\\','/'))};`;
  await build({stdin:{contents:moduleSource,resolveDir:root,loader:'ts'},outfile:path.join(runtimeDir,'hq.js'),bundle:true,format:'esm',platform:'browser',define:{__COMPANION_EDITION__:'"developer"'}});
  const preload=path.join(runtimeDir,'preload.cjs');
  await fs.writeFile(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('hqIO',{frame:bytes=>ipcRenderer.invoke('hq-frame',bytes)});");
  const {createService}=await import(pathToFileURL(path.join(root,'server/service.mjs')).href);
  service=await createService({port:0,edition:'developer',modelRoot:path.resolve(modelRoot),dataDir:path.join(runtimeDir,'service'),staticRoot:runtimeDir});
  const manifest=await fetch(service.url+'/api/model-manifest',{headers:{Authorization:'Bearer '+service.token}}).then(r=>r.json());
  if(!manifest.modelUrl)throw Error('Explicit model failed to load');
  const html=`<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}#model{display:block;width:750px;height:1200px}#output{display:none}</style></head><body><canvas id="model"></canvas><canvas id="output" width="1920" height="1080"></canvas><script type="module">
    import {createLive2D,BehaviorController} from '/hq.js';
    let serial=0;const callbacks=new Map();window.requestAnimationFrame=fn=>{callbacks.set(++serial,fn);return serial;};window.cancelAnimationFrame=id=>callbacks.delete(id);
    window.hqTime=0;window.hqLevel=0;window.hqErrors=[];window.HqBehavior=BehaviorController;const pending=new Set();
    window.hqFlushAssets=async()=>{while(pending.size)await Promise.all([...pending]);};
    window.hqStep=async()=>{hqTime+=1/60;const rows=[...callbacks.values()];callbacks.clear();for(const fn of rows)fn(hqTime*1000);await hqFlushAssets();};
    window.hqReady=createLive2D(document.querySelector('#model'),{manifest:${JSON.stringify(manifest)},maxFps:60,maxTextureSize:8192,maxPixelRatio:2,maxCanvasPixels:1500*2400,antialias:true,enableDiagnostics:false,
      fetcher:url=>fetch(url,{headers:{Authorization:${JSON.stringify('Bearer '+service.token)}}}),onFrame:(dt,elapsed)=>{if(window.hqBehavior){hqBehavior.setAudioLevel(hqLevel);hqBehavior.update(dt,elapsed);}},onError:error=>hqErrors.push(error.message)
    }).then(async handle=>{window.hqRuntime=handle;for(const method of ['playMotion','setExpression']){const original=handle[method].bind(handle);handle[method]=(...args)=>{const result=original(...args);if(result?.then){pending.add(result);result.then(()=>pending.delete(result),()=>pending.delete(result));}return result;};}
      for(const motion of ${JSON.stringify(manifest.motions||[])})await handle.playMotion(motion.name,{loop:false});handle.stopMotion();
      for(const expression of ${JSON.stringify(manifest.expressions||[])}){await handle.setExpression(expression.name,true);await handle.setExpression(expression.name,false);}handle.reset();return true;});
  </script></body></html>`;
  await fs.writeFile(path.join(runtimeDir,'index.html'),html);
  await app.whenReady();
  win=new BrowserWindow({width:750,height:1200,useContentSize:true,show:false,frame:false,transparent:true,
    webPreferences:{preload,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
  win.webContents.setAudioMuted(true);
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const external=/^https?:/.test(details.url)&&!details.url.startsWith(service.url+'/');if(external)errors.push('Blocked external request');callback({cancel:external});});
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  await win.loadURL(service.url+'/');
  await win.webContents.executeJavaScript('Promise.race([hqReady,new Promise((_,reject)=>setTimeout(()=>reject(Error("HQ model load timeout")),60000))])');
  const dimensions=await win.webContents.executeJavaScript('({width:document.querySelector("#model").width,height:document.querySelector("#model").height,dpr:devicePixelRatio})');
  if(dimensions.width!==1500||dimensions.height!==2400)throw Error('Native HQ backing mismatch: '+JSON.stringify(dimensions));
  log({ready:true,dimensions,model:modelRoot});
  for(const original of jobs){
    const job={scene:'idle',framing:'right',background:'#f5f8ff',mouth:true,sceneSeconds:original.seconds,...original};
    if(limit>0)job.seconds=Math.min(job.seconds,limit);
    job.seconds=Math.round(job.seconds*FPS)/FPS;
    if(job.audio)job.audioBase64=(await fs.readFile(path.resolve(job.audio))).toString('base64');
    if(job.backgroundImage)job.backgroundDataURL='data:image/png;base64,'+(await fs.readFile(path.resolve(job.backgroundImage))).toString('base64');
    const directory=path.join(output,job.label);await fs.mkdir(directory,{recursive:true});
    try{await fs.access(path.join(directory,'footage.mkv'));throw Error('Refusing to replace capture: '+directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    const started=performance.now();await startEncoder(directory,Math.round(job.seconds*FPS));
    const result=await win.webContents.executeJavaScript(`(${captureBrowser.toString()})(${JSON.stringify(job)})`);
    encoder.stdin.end();await encoderDone;encoder=null;
    if(result.frames!==framesWritten)throw Error('Frame count mismatch');
    await fs.writeFile(path.join(directory,'poster.png'),Buffer.from(result.poster.split(',')[1],'base64'));delete result.poster;
    Object.assign(result,{encoding:'libx264rgb CRF 0 lossless RGB24',maxTextureSize:8192,antialias:true,wallSeconds:(performance.now()-started)/1000,sourceRevision:'working-tree',pathway:'Current production Cubism adapter and BehaviorController; local scripted fixed-step offline capture; no model API or audio playback',errors:[...errors,...result.errors]});
    await writeJson(path.join(directory,'result.json'),result);
    if(result.errors.length)throw Error(result.errors.join('\n'));
    log({done:job.label,frames:framesWritten,seconds:job.seconds,wallSeconds:result.wallSeconds,mouthRange:[Math.min(...result.mouthSamples.map(row=>row.mouth)),Math.max(...result.mouthSamples.map(row=>row.mouth))]});
  }
  win.destroy();await service.close();clearTimeout(watchdog);app.exit(0);
})().catch(async error=>{console.error(error);try{encoder?.stdin.destroy();win?.destroy();await service?.close();}finally{clearTimeout(watchdog);app.exit(1);}});
