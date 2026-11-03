/* Deterministic real-model regression for dedicated-context GL state ownership.
 * electron scripts/verify-owned-state-equivalence.cjs --model=ABSOLUTE_DIR [--mode=legacy|both] [--scene-set=standard|idea]
 * Uses an isolated profile/loopback server, manual frame timestamps and no user app.
 */
'use strict';
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const mode = arg('mode', 'both');
const sceneSet=arg('scene-set','standard');if(!['standard','idea'].includes(sceneSet))throw Error('scene-set must be standard or idea');
if (!['legacy','both'].includes(mode)) throw Error('mode must be legacy or both');
const modelRoot = path.resolve(arg('model', process.env.L2D_MODEL_ROOT || path.join(root,'models/DeepSeek')));
const output = path.resolve(root, arg('out', 'output/owned-state-equivalence-0223'));
app.setPath('userData', path.join(output,'profile'));
app.commandLine.appendSwitch('force-device-scale-factor','1');
let service,win,timer;
const report = { ok:false, deterministic:false, sceneSet, comparisons:[], errors:[], variants:[] };
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main() {
  await fs.mkdir(output,{recursive:true});
  const progress = message => require('node:fs').appendFileSync(path.join(output,'progress.log'),`${new Date().toISOString()} ${message}\n`);
  timer=setTimeout(()=>{progress('timeout');win?.destroy();service?.close();app.exit(2);},300000);
  const adapter=path.join(root,'src/renderer/live2d.ts');
  const source=await fs.readFile(adapter,'utf8');
  if(mode==='both'&&!source.includes('preserveGlState'))throw Error('Dedicated context integration is not ready; refusing a false equivalence comparison');
  report.adapterSha256=createHash('sha256').update(source).digest('hex');
  report.meshBufferModuleSha256=createHash('sha256').update(await fs.readFile(path.join(root,'src/renderer/mesh-buffer-cache.ts'))).digest('hex');
  for(const name of ['owned-gl-state.ts','owned-gl-state.mjs','render-context-state.ts']){const file=path.join(root,'src/renderer',name);try{report.ownedStateModule={file:name,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')};break;}catch{}}
  await fs.cp(path.join(root,'public/vendor'),path.join(output,'vendor'),{recursive:true});
  await build({stdin:{contents:`export {createLive2D} from ${JSON.stringify(adapter.replaceAll('\\','/'))};export {BehaviorController} from ${JSON.stringify(path.join(root,'src/shared/behavior.mjs').replaceAll('\\','/'))};`,loader:'ts',resolveDir:root},outfile:path.join(output,'harness.js'),bundle:true,format:'esm',platform:'browser'});
  const {createService}=await import(pathToFileURL(path.join(root,'server/service.mjs')));
  service=await createService({port:0,modelRoot,dataDir:path.join(output,'service-data'),staticRoot:output});
  const manifest=await(await fetch(service.url+'/api/model-manifest',{headers:{Authorization:'Bearer '+service.token}})).json();
  if(!manifest.motions?.length||!manifest.expressions?.length)throw Error('The real author motion/expression manifest is required');
  const entry=`import {createLive2D,BehaviorController} from '/harness.js';
    const callbacks=new Map();let next=0,clock=0,controller;
    window.qaUploads=0;window.qaUploadBytes=0;window.qaStateQueries={getParameter:0,getVertexAttrib:0,isEnabled:0};
    for(const name of Object.keys(qaStateQueries)){const original=WebGLRenderingContext.prototype[name];WebGLRenderingContext.prototype[name]=function(...args){qaStateQueries[name]++;return original.apply(this,args);};}
    const originalBufferData=WebGLRenderingContext.prototype.bufferData;
    WebGLRenderingContext.prototype.bufferData=function(...args){qaUploads++;const data=args[1];qaUploadBytes+=ArrayBuffer.isView(data)||data instanceof ArrayBuffer?data.byteLength:typeof data==='number'?data:0;return originalBufferData.apply(this,args);};
    window.requestAnimationFrame=callback=>{callbacks.set(++next,callback);return next;};
    window.cancelAnimationFrame=id=>callbacks.delete(id);
    const pending=new Set();window.qaErrors=[];window.qaDirectPupil=null;
    async function settle(){for(let i=0;pending.size&&i<100;i++)await Promise.all([...pending]);if(pending.size)throw Error('Asset promises did not settle');}
    window.qaReady=createLive2D(document.querySelector('canvas'),{manifest:${JSON.stringify(manifest)},
      fetcher:url=>fetch(url,{headers:{Authorization:'Bearer '+${JSON.stringify(service.token)}}}),
      maxTextureSize:3072,maxFps:60,maxPixelRatio:1,maxCanvasPixels:1440000,antialias:false,
      cacheMeshBuffers:new URLSearchParams(location.search).get('cache')==='1',
      preserveGlState:new URLSearchParams(location.search).get('preserve')==='1',
      onFrame:(dt,elapsed)=>{controller?.update(dt,elapsed);if(window.qaDirectPupil!==null)window.avatar?.setPupilScale(window.qaDirectPupil);},
      onError:error=>qaErrors.push(String(error.message||error))
    }).then(handle=>{
      window.avatar=handle;
      for(const name of ['playMotion','setExpression']){const original=handle[name].bind(handle);handle[name]=(...args)=>{const promise=Promise.resolve(original(...args));pending.add(promise);promise.then(()=>pending.delete(promise),error=>{pending.delete(promise);qaErrors.push(String(error.message||error));});return promise;};}
      window.behavior=controller=new BehaviorController(handle,{random:()=>.5,clockSeconds:()=>clock/1000,onEvent:event=>{if(event.type==='error')qaErrors.push(event.message||String(event.error));}});
      handle.setPlacement({scale:1.8,centerX:600,centerY:600,referenceWidth:370,referenceHeight:575});return true;
    });
    window.qaSettle=settle;
    window.qaStep=async(count,capture=false)=>{
      let result;
      for(let frame=0;frame<count;frame++){
        await settle();clock+=1000/60;const jobs=[...callbacks.values()];callbacks.clear();
        for(const callback of jobs)callback(clock);
        if(capture&&frame===count-1){const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl');result={png:canvas.toDataURL('image/png'),glError:gl.getError(),contextLost:gl.isContextLost(),clock,
          parameters:Object.fromEntries(avatar.getParameters().filter(p=>/^(Movement[23]|Param(36|39|40|41|42|43|59|60|61|62)|Angle[XYZ])$/.test(p.id)).map(p=>[p.id,p.value]))};}
      }
      await settle();return result||true;
    };
    window.qaReset=async()=>{qaDirectPupil=null;behavior.setBasinEnabled(false);behavior.reset();avatar.setPlacement({scale:1.8,centerX:600,centerY:600,referenceWidth:370,referenceHeight:575});await settle();await qaStep(45);};
  `;
  await fs.writeFile(path.join(output,'entry.js'),entry);
  const csp=(await fs.readFile(path.join(root,'index.html'),'utf8')).match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0]||'';
  await fs.writeFile(path.join(output,'index.html'),`<!doctype html><html><head>${csp}</head><body style="margin:0;background:transparent"><canvas style="width:1200px;height:1200px;display:block"></canvas><script type="module" src="/entry.js"></script></body></html>`);
  await app.whenReady();
  win=new BrowserWindow({width:1200,height:1200,show:false,frame:false,transparent:true,backgroundColor:'#00000000',webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
  win.webContents.on('console-message',detail=>{if(detail.level==='error'||detail.level===3)report.errors.push(detail.message);});
  const evaluate=code=>win.webContents.executeJavaScript(code);
  const variants=mode==='both'?[['legacy-a',true,false],['legacy-b',true,false],['owned',false,false],['owned-cache',false,true]]:[['legacy-a',true,false],['legacy-b',true,false]];
  const standardScenes = [
    ['idle', 'await qaReset()', 90],
    ['thinking-enter', 'behavior.setState("thinking")', 18],
    ['thinking-hold', '', 120],
    ['thinking-halfbody', 'avatar.setPlacement({scale:3.6,centerX:700,centerY:1100,referenceWidth:370,referenceHeight:575})', 30],
    ['thinking-close', 'behavior.setState("idle");avatar.setPlacement({scale:1.8,centerX:600,centerY:600,referenceWidth:370,referenceHeight:575})', 90],
    ['loading-only', 'await qaReset();await avatar.setExpression("加载",true)', 90],
    ['chest-left', 'await qaReset();behavior.previewBodyAnimation("chest-left",{durationMs:9000,intensity:.85})', 150],
    ['chest-right', 'await qaReset();behavior.previewBodyAnimation("chest-right",{durationMs:9000,intensity:.85})', 150],
    ['chest-both', 'await qaReset();behavior.previewBodyAnimation("chest-both",{durationMs:9000,intensity:.85})', 150],
    ['cuddle-entry', 'await qaReset();behavior.setPetting(true,{intensity:.85,x:.2,y:.1,speed:.4,newContact:true})', 165],
    ['cuddle-held', '', 90],
    ['cuddle-closing', 'behavior.setPetting(false)', 30],
    ['cuddle-closed', '', 120],
    ['pointer-left', 'await qaReset();behavior.previewBodyAnimation("pointer-left",{durationMs:9000,intensity:.85})', 150],
    ['pointer-right', 'await qaReset();behavior.previewBodyAnimation("pointer-right",{durationMs:9000,intensity:.85})', 150],
    ['pupils-large', 'await qaReset();qaDirectPupil=1.1', 30],
    ['pupils-small', 'qaDirectPupil=.9', 30],
    ['basin-peak', 'await qaReset();behavior.setBasinEnabled(true);await qaStep(45);behavior.knockBasin()', 3],
    ['basin-release', '', 15],
    ['basin-repeated', 'behavior.knockBasin()', 3],
  ];
  const idea='behavior.applyCommand({type:"perform",intent:"idea",emotion:"happy",gesture:"pointer",intensity:.7,durationMs:3400,replyIntro:true});behavior.setState("idle")';
  const ideaScenes=[
    ['idea-enter','await qaReset();'+idea,18],
    ['idea-hold','',90],
    ['idea-close','',108],
    ['idea-settled','',90],
    ['thinking-before-idea','await qaReset();behavior.setState("thinking")',90],
    ['think-to-idea-enter',idea,18],
    ['think-to-idea-pre-speech','',174],
    ['idea-to-speech','behavior.setState("speaking");behavior.setSpeechGesture({id:"talk",key:"fixture-reply",durationMs:5000,progress:.02,continuous:true,gesture:"pointer"});behavior.setAudioLevel(.4)',30],
  ];
  const scenes=sceneSet==='idea'?ideaScenes:standardScenes;
  const captures=new Map();
  for(const [label,preserve,cache]of variants){
    progress(label+' start');const target=path.join(output,label);await fs.mkdir(target,{recursive:true});
    await win.loadURL(service.url+'/?cache='+(cache?'1':'0')+'&preserve='+(preserve?'1':'0'));
    await evaluate('Promise.race([qaReady,new Promise((_,reject)=>setTimeout(()=>reject(Error("Model startup timeout")),45000))])');
    const rows=[];
    for(const [name,code,frames]of scenes){
      progress(label+' '+name);
      const capture=await evaluate(`(async()=>{${code};return qaStep(${frames},true)})()`);
      if(capture.glError||capture.contextLost)throw Error(`${label}/${name} WebGL failed`);
      const image=nativeImage.createFromDataURL(capture.png), pixels=image.toBitmap(), size=image.getSize();
      let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>20)visible++;
      if(visible<30000)throw Error(`${label}/${name}: model not visible`);
      await fs.writeFile(path.join(target,name+'.png'),image.toPNG());
      const row={name,clock:capture.clock,size,visible,pixelSha256:createHash('sha256').update(pixels).digest('hex'),parameters:capture.parameters};rows.push(row);
      if(label==='legacy-a')captures.set(name,{pixels,size,row});
      else{
        const reference=captures.get(name);if(reference.pixels.length!==pixels.length)throw Error('Capture dimensions changed');
        let changed=0,maxDelta=0,totalDelta=0;
        for(let i=0;i<pixels.length;i+=4){let pixelDelta=0;for(let c=0;c<4;c++){const delta=Math.abs(pixels[i+c]-reference.pixels[i+c]);pixelDelta=Math.max(pixelDelta,delta);totalDelta+=delta;}if(pixelDelta)changed++;maxDelta=Math.max(maxDelta,pixelDelta);}
        report.comparisons.push({variant:label,name,changedPixels:changed,maxChannelDelta:maxDelta,meanChannelDelta:totalDelta/pixels.length,parametersEqual:JSON.stringify(row.parameters)===JSON.stringify(reference.row.parameters)});
      }
    }
    const result=await evaluate('({errors:qaErrors,stats:avatar.getPerformanceStats(),uploads:qaUploads,uploadBytes:qaUploadBytes,stateQueries:qaStateQueries})');
    if(result.errors.length)throw Error(result.errors.join('\n'));
    if(cache&&result.stats.meshBufferCacheEnabled!==true)throw Error('Cache mode was requested but not enabled');
    if(!cache&&result.stats.meshBufferCacheEnabled===true)throw Error('Legacy mode unexpectedly enabled the cache');
    if(!preserve&&result.stats.ownedGlStateEnabled!==true)throw Error('Owned state mode was requested but not enabled');
    if(preserve&&result.stats.ownedGlStateEnabled===true)throw Error('Legacy profile unexpectedly enabled owned state');
    if(!preserve&&(result.stats.totalStateSaveCalls!==0||result.stats.totalStateRestoreCalls!==0))throw Error('Owned mode still called the SDK external profile');
    if(!preserve&&(!(result.stats.stateSnapshotBypasses>0)||!(result.stats.totalSdkDrawCalls>0)))throw Error('Owned mode did not actually draw through the bypass');
    report.variants.push({label,preserve,cache,scenes:rows,stats:result.stats,uploads:result.uploads,uploadBytes:result.uploadBytes,stateQueries:result.stateQueries});
    await fs.writeFile(path.join(target,'scenes.json'),JSON.stringify(rows,null,2));
    await evaluate('behavior.destroy();avatar.destroy();true');
  }
  report.deterministic=report.comparisons.filter(row=>row.variant==='legacy-b').every(row=>row.changedPixels===0&&row.parametersEqual);
  const cached=report.variants.find(variant=>variant.cache),legacy=report.variants[0];
  report.cacheUploadReductionVerified=!cached||cached.uploads<legacy.uploads*.75;
  const owned=report.variants.filter(variant=>!variant.preserve);
  report.stateQueryReductionVerified=owned.every(variant=>['getParameter','getVertexAttrib','isEnabled'].every(key=>variant.stateQueries[key]<Math.max(1,legacy.stateQueries[key]*.1)));
  report.ok=report.deterministic&&report.comparisons.every(row=>row.changedPixels===0&&row.parametersEqual)&&report.errors.length===0&&report.cacheUploadReductionVerified&&report.stateQueryReductionVerified;
  report.notes='Exact RGBA comparisons after deterministic manual rAF, plus actual GL state-query counts. No performance claims; no live user profiles, DSH or TTS were used.';
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  progress('complete '+report.ok);
  console.log(JSON.stringify({ok:report.ok,deterministic:report.deterministic,comparisons:report.comparisons,output}));
  win.destroy();await Promise.race([service.close(),wait(1500)]);clearTimeout(timer);app.exit(report.ok?0:1);
}
main().catch(async error=>{report.errors.push(String(error.stack||error));await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.error(error);win?.destroy();await Promise.race([service?.close(),wait(1500)]);clearTimeout(timer);app.exit(1);});
