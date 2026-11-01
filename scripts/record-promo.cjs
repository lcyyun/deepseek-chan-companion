// Isolated production-renderer footage for the introduction video.
// No normal app window, profile or source is modified.
// npx electron scripts/record-promo.cjs [--scene=sample|expressions|arms|pet|basin|gaze|talk] [--seconds=12] [--framing=right|close] [--audio=file.wav] [--background=#f5f8ff]
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => process.argv.find(value => value.startsWith('--'+name+'='))?.slice(name.length+3) ?? fallback;
const manifestFile=arg('manifest',null),eventsFile=arg('events',null);
const rawJobs=manifestFile?JSON.parse(fs.readFileSync(path.resolve(manifestFile),'utf8')):[{
  scene:arg('scene','sample'),seconds:Number(arg('seconds','12')),framing:arg('framing','right'),
  label:arg('label',null),background:arg('background','#f5f8ff'),audio:arg('audio',null),
  backgroundImage:arg('background-image',null),mouth:arg('mouth','true')!=='false',
  ...(eventsFile?{events:JSON.parse(fs.readFileSync(path.resolve(eventsFile),'utf8'))}:{}),
}];
if(!Array.isArray(rawJobs)||!rawJobs.length)throw new Error('Manifest must be a nonempty array');
const jobs=rawJobs.map(item=>{
  const options={scene:'idle',seconds:12,framing:'right',background:'#f5f8ff',mouth:true,...item,width:1920,height:1080,fps:30};
  options.label ||= options.scene+'-'+options.framing;
  if(!Number.isFinite(options.seconds)||options.seconds<1||options.seconds>300)throw new Error('Invalid duration');
  if(!/^[a-z0-9-]+$/.test(options.scene)||!/^[a-z0-9-]+$/.test(options.label))throw new Error('Invalid scene or label');
  if(options.audio)options.audioBase64=fs.readFileSync(path.resolve(options.audio)).toString('base64');
  if(options.backgroundImage)options.backgroundDataURL='data:image/png;base64,'+fs.readFileSync(path.resolve(options.backgroundImage)).toString('base64');
  return options;
});
if(new Set(jobs.map(j=>j.label)).size!==jobs.length)throw new Error('Duplicate labels');
const output = path.join(root,'output','video014','capture',manifestFile?'batch-session':jobs[0].label);
fs.mkdirSync(output,{recursive:true});
process.env.L2D_MODEL_ROOT ||= path.join(root, 'models', 'DeepSeek');
let source = fs.readFileSync(path.join(root,'tests','live2d-actions.cjs'),'utf8');
source = source.replace("const root = path.resolve(__dirname, '..');",'const root = '+JSON.stringify(root)+';')
  .replace(/const output = path\.join\(root, 'vendor', .*?\);/,'const output = '+JSON.stringify(output)+';')
  .replace('width:v5Only?1100:500,height:v5Only?900:800','width:750,height:1200');
const anchor=source.indexOf('  if(expressionsOnly){');
if(anchor<0)throw new Error('Production fixture anchor changed');
source=source.slice(0,anchor);
source+='\nconst jobs='+JSON.stringify(jobs)+';\n';
source+=String.raw`
  const js=code=>win.webContents.executeJavaScript(code);
  const {execFileSync}=require('node:child_process');
  for(const options of jobs){
  const clipOutput=path.join(root,'output','video014','capture',options.label);await fs.mkdir(clipOutput,{recursive:true});
  await request('/api/stop',{});
  await js('qaSpeaker.stop();qaBehavior.reset();qaBehavior.setBasinEnabled(false);qaBehavior.setPointerTracking(false);void 0;');
  await delay(1200);
  await js('qaBehavior.setTuning({idleActivity:.55,bodyMotion:1,gestureAmplitude:1});void 0;');
  const recorded=await js('('+(${captureScene.toString()})+')('+JSON.stringify(options)+')');
  await fs.writeFile(path.join(clipOutput,'footage.webm'),Buffer.from(recorded.base64,'base64'));
  await fs.writeFile(path.join(clipOutput,'poster.png'),Buffer.from(recorded.poster.split(',')[1],'base64'));
  delete recorded.base64;delete recorded.poster;
  await fs.writeFile(path.join(clipOutput,'result.json'),JSON.stringify({...recorded,errors:report.errors,pathway:report.pathway},null,2));
  execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',path.join(clipOutput,'footage.webm'),'-vf','fps=30,tpad=stop_mode=clone:stop_duration=1','-t',String(options.seconds),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',...(recorded.hasAudio?['-af','apad']:[]),'-c:a','aac','-b:a','192k','-movflags','+faststart',path.join(clipOutput,'footage.mp4')],{windowsHide:true,timeout:120000});
  console.log(JSON.stringify({output:clipOutput,scene:recorded.scene,seconds:recorded.seconds,frames:recorded.frames,hasAudio:recorded.hasAudio,mouthRange:recorded.mouthSamples?.length?[Math.min(...recorded.mouthSamples.map(s=>s.mouth)),Math.max(...recorded.mouthSamples.map(s=>s.mouth))]:[],errors:report.errors}));
  }
  win.destroy();await service.close();app.exit(0);
})().catch(async error=>{console.error(error);try{win?.destroy();await service?.close();}finally{app.exit(1);}});
`;
// Insert a plain browser function, without evaluating it in the Node process.
source=source.replace('(${captureScene.toString()})',captureScene.toString());
const harness=path.join(output,'harness.cjs');fs.writeFileSync(harness,source);require(harness);

async function captureScene(options){
  const source=document.querySelector('canvas'), canvas=document.createElement('canvas');
  canvas.width=options.width;canvas.height=options.height;
  const ctx=canvas.getContext('2d',{alpha:true}),stream=canvas.captureStream(0),videoTrack=stream.getVideoTracks()[0];
  let backgroundImage=null;
  if(options.backgroundDataURL){backgroundImage=new Image();backgroundImage.src=options.backgroundDataURL;await backgroundImage.decode();}
  let audioSource=null,audioContext=null;
  if(options.audioBase64){
    const bytes=Uint8Array.from(atob(options.audioBase64),c=>c.charCodeAt(0));
    audioContext=new AudioContext();await audioContext.resume();
    const decoded=await audioContext.decodeAudioData(bytes.buffer),analyser=audioContext.createAnalyser(),destination=audioContext.createMediaStreamDestination();
    analyser.fftSize=512;analyser.smoothingTimeConstant=.3;
    audioSource=audioContext.createBufferSource();audioSource.buffer=decoded;audioSource.connect(analyser);analyser.connect(destination);
    if(options.mouth){qaSpeaker.context=audioContext;qaSpeaker.source=audioSource;qaSpeaker.analyser=analyser;qaSpeaker.data=new Float32Array(analyser.fftSize);}
    for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
    if(options.mouth)qaBehavior.setState('speaking');
    audioSource.onended=()=>{qaSpeaker.source=undefined;qaBehavior.setState('idle');};
  }
  const mime='video/webm;codecs=vp8';
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:10000000}),chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const done=new Promise(resolve=>{recorder.onstop=async()=>{const blob=new Blob(chunks,{type:mime}),reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);};});
  let frames=0,last=-1,poster='',lastEvent=-1,talkAt=null,lastChestPulse=-Infinity;
  const mouthSamples=[],interactionEvents=[];
  const events=options.events??(options.scene==='sample'?[[0,'think'],[3.2,'idea'],[5.3,'talk']]
    :options.scene==='expressions'?[[0,'happy'],[3,'puzzled'],[6,'shy'],[9,'squeezed']]
    :options.scene==='arms'?[[0,'pointer-left'],[5,'pointer-right'],[10,'chest-both']]
    :options.scene==='pet'?[[0,'pet-start'],[Math.max(5,options.seconds-2.5),'pet-end']]
    :options.scene==='basin'?[[0,'basin-start'],[2,'knock'],[4,'knock'],[5,'knock'],[5.5,'knock'],[6,'knock'],[8.2,'knock']]
    :options.scene==='gaze'?[[0,'gaze']]:options.scene==='idle'?[]:[[0,'talk']]);
  const fire=name=>{
    if(name.startsWith('expression:'))qaBehavior.previewExpression(name.slice('expression:'.length),{durationMs:60000,intensity:.85});
    else if(name==='think'){if(audioSource&&options.mouth)qaBehavior.perform({intent:'think',emotion:'puzzled',gesture:'pointer',durationMs:3200});else qaBehavior.setState('thinking');}
    else if(name==='idea'){if(!audioSource||!options.mouth)qaBehavior.setState('idle');qaBehavior.perform({intent:'idea',emotion:'happy',gesture:'pointer',durationMs:1800});}
    else if(name==='talk'){if(!audioSource||!options.mouth)qaBehavior.setState('idle');talkAt=(performance.now()-start)/1000;qaBehavior.previewExpression('gentle',{durationMs:60000,intensity:.65});}
    else if(['happy','puzzled','shy','squeezed'].includes(name))qaBehavior.previewExpression(name,{durationMs:20000,intensity:.85});
    else if(['pointer-left','pointer-right','chest-both'].includes(name))qaBehavior.previewBodyAnimation(name,{intensity:.9,durationMs:4500});
    else if(name==='pet-start')qaBehavior.setPetting(true,{x:0,y:0,speed:.5,newContact:true});
    else if(name==='pet-end')qaBehavior.setPetting(false);
    else if(name==='chest-tap'){
      const accepted=qaBehavior.tapChest();lastChestPulse=(performance.now()-start)/1000;
      interactionEvents.push({name,time:lastChestPulse,accepted,stage:qaBehavior.chestReaction?.stage??null,completed:qaBehavior.completedChestStage,armed:qaBehavior.isChestHeartArmed});
    }
    else if(name==='basin-start')qaBehavior.setBasinEnabled(true);
    else if(name==='knock')qaBehavior.knockBasin();
  };
  const draw=time=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(options.background!=='transparent'){ctx.fillStyle=options.background;ctx.fillRect(0,0,canvas.width,canvas.height);}
    if(backgroundImage)ctx.drawImage(backgroundImage,0,0,canvas.width,canvas.height);
    const dest=options.framing==='close'?{x:210,y:-70,w:1500,h:2400}:{x:740,y:-50,w:1300,h:2080};
    ctx.drawImage(source,dest.x,dest.y,dest.w,dest.h);
    if((options.scene==='pet'&&time<Math.max(5,options.seconds-2.5))||(options.scene==='easter'&&qaBehavior.isPetting)){
      const head=qaRuntime.getInteractionRegions().head;
      if(head){const x=dest.x+(head.x+head.width*(.5+.25*Math.sin(time*2.2)))/750*dest.w,y=dest.y+(head.y+head.height*.35)/1200*dest.h;
        ctx.strokeStyle='#6c8edc';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#6c8edc33';ctx.fill();}
    }
    if(options.scene==='easter'&&time-lastChestPulse<.48){
      const chest=qaRuntime.getInteractionRegions().chest;
      if(chest){const progress=(time-lastChestPulse)/.48,x=dest.x+(chest.x+chest.width*.5)/750*dest.w,y=dest.y+(chest.y+chest.height*.54)/1200*dest.h;
        ctx.strokeStyle=`rgba(49,191,215,${1-progress})`;ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,14+progress*23,0,Math.PI*2);ctx.stroke();}
    }
    videoTrack.requestFrame();frames++;if(!poster&&time>options.seconds*.45)poster=canvas.toDataURL('image/png');
    if(frames%3===0)mouthSamples.push({time,level:qaSpeaker.level(),mouth:qaRuntime.getParameters().find(p=>p.id==='ParamMouthOpenY')?.value});
  };
  const start=performance.now();recorder.start(1000);audioSource?.start();
  await new Promise(resolve=>{function frame(now){const time=(now-start)/1000;
    for(let i=lastEvent+1;i<events.length&&events[i][0]<=time;i++){fire(events[i][1]);lastEvent=i;}
    if(talkAt!==null){const duration=Math.max(.3,options.seconds-talkAt-1.4),elapsed=Math.max(0,time-talkAt);if(elapsed<duration)qaBehavior.setSpeechGesture({id:'talk',gesture:'pointer',key:'promo-talk',intensity:.85,durationMs:duration*1000,progress:elapsed/duration,elapsedSeconds:elapsed,continuous:true});else qaBehavior.clearSpeechGesture();}
    if(options.scene==='pet'&&time<Math.max(5,options.seconds-2.5))qaBehavior.setPetting(true,{x:.6*Math.sin(time*2.2),y:0,speed:.6});
    if(options.scene==='easter'&&qaBehavior.isPetting)qaBehavior.setPetting(true,{x:.5*Math.sin(time*2.2),y:0,speed:.5});
    if(options.scene==='gaze')qaBehavior.setPointerTracking(true,{x:.85*Math.sin(time*.65),y:.5*Math.sin(time*.92),speed:.3,travel:.8});
    const tick=Math.floor(time*options.fps);if(tick!==last){draw(time);last=tick;}
    if(time>=options.seconds){recorder.stop();resolve();}else requestAnimationFrame(frame);
  }requestAnimationFrame(frame);});
  const base64=await done;stream.getTracks().forEach(t=>t.stop());
  const {audioBase64,backgroundDataURL,...metadata}=options;
  audioSource?.stop();audioContext?.close();
  return{...metadata,hasAudio:Boolean(audioBase64),mime,frames,elapsed:(performance.now()-start)/1000,mouthSamples,interactionEvents,
    finalInteraction:{stage:qaBehavior.chestReaction?.stage??null,completed:qaBehavior.completedChestStage,armed:qaBehavior.isChestHeartArmed,petting:qaBehavior.isPetting},base64,poster};
}
