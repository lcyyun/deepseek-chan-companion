// Real production WebAudio class and HTTP server; no model, renderer GPU load,
// native mouse input, or user profile. Output is muted after WebAudio rendering.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {build}=require('esbuild');
const root=path.resolve(__dirname,'..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'l2d-webaudio-qa-'));
const reportFile=path.resolve(process.argv[2]||path.join(root,'output','basin-audio-production.json'));
app.setPath('userData',profile);app.disableHardwareAcceleration();
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
let service,win,finished=false;
async function finish(result){
  if(finished)return;finished=true;clearTimeout(timeout);
  fs.mkdirSync(path.dirname(reportFile),{recursive:true});
  fs.writeFileSync(reportFile,JSON.stringify({at:new Date().toISOString(),electron:process.versions.electron,...result},null,2));
  win?.destroy();await service?.close();app.exit(result.ok?0:1);
}
const timeout=setTimeout(()=>finish({ok:false,error:'WebAudio QA timeout'}),30000);
app.whenReady().then(async()=>{
  const staticRoot=path.join(profile,'static');fs.mkdirSync(path.join(staticRoot,'audio'),{recursive:true});
  fs.writeFileSync(path.join(staticRoot,'index.html'),'<!doctype html><html><body>Hidden WebAudio QA</body></html>');
  fs.copyFileSync(path.join(root,'public','audio','metal-pipe-falling.mp3'),path.join(staticRoot,'audio','metal-pipe-falling.mp3'));
  const {createService}=await import(pathToFileURL(path.join(root,'server','index.mjs')).href);
  service=await createService({port:0,dataDir:path.join(profile,'service'),staticRoot});
  const bundle=await build({entryPoints:[path.join(root,'src','renderer','basin-audio.ts')],bundle:true,write:false,format:'iife',globalName:'BasinAudio',platform:'browser'});
  win=new BrowserWindow({show:false,width:200,height:100,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  win.webContents.setAudioMuted(true);
  await win.loadURL(service.url+'/');
  await win.webContents.executeJavaScript(bundle.outputFiles[0].text+';window.qaSound=new BasinAudio.BasinSound();void 0;');
  const result=await win.webContents.executeJavaScript(`(${async function(){
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const sound=window.qaSound,connected=new Set(),started=new Set();let starts=0;
    const timing={construct:[],decode:[],resume:[],createBuffer:[],preparationMs:0,firstPlayMs:0,firstPipePlayMs:0};
    const base=performance.now(),NativeContext=window.AudioContext;
    window.AudioContext=class extends NativeContext{
      constructor(...args){const at=performance.now();super(...args);timing.construct.push({at:at-base,ms:performance.now()-at,state:this.state});}
      createBuffer(...args){const at=performance.now();const result=super.createBuffer(...args);timing.createBuffer.push({at:at-base,ms:performance.now()-at});return result;}
      async decodeAudioData(...args){const at=performance.now();try{return await super.decodeAudioData(...args);}finally{timing.decode.push({at:at-base,ms:performance.now()-at});}}
      async resume(...args){const at=performance.now();try{return await super.resume(...args);}finally{timing.resume.push({at:at-base,ms:performance.now()-at});}}
    };
    // Instrument real native methods without replacing their work.
    const proto=AudioBufferSourceNode.prototype,connect=proto.connect,disconnect=proto.disconnect,start=proto.start;
    proto.connect=function(...args){const result=connect.apply(this,args);connected.add(this);return result;};
    proto.disconnect=function(...args){const result=disconnect.apply(this,args);connected.delete(this);return result;};
    proto.start=function(...args){const result=start.apply(this,args);starts++;started.add(this);this.addEventListener('ended',()=>started.delete(this),{once:true});return result;};
    sound.setVolume(.08);
    const prepareAt=performance.now();await sound.prepare();timing.preparationMs=performance.now()-prepareAt;
    check(starts===0&&sound.voices.length===0,'preparation emitted an audio source');
    const preparedContext=sound.context,preparedBuffer=sound.buffer;
    const firstPlayAt=performance.now();await sound.play();timing.firstPlayMs=performance.now()-firstPlayAt;
    check(sound.context===preparedContext&&sound.buffer===preparedBuffer&&timing.construct.length===1,'prepared first strike repeated expensive initialization');
    const warmupDropped=sound.voices.length===0;
    check(!warmupDropped,'normal cold first click was incorrectly discarded');
    check(sound.context.state==='running','AudioContext must actually be running');
    check(sound.voices.length===1&&starts===1,'basin source did not start');
    const analyser=sound.context.createAnalyser();analyser.fftSize=2048;
    sound.output.disconnect();sound.output.connect(analyser);analyser.connect(sound.context.destination);
    const samples=new Float32Array(analyser.fftSize);
    const rms=()=>{analyser.getFloatTimeDomainData(samples);let power=0;for(const v of samples)power+=v*v;return Math.sqrt(power/samples.length);};
    await sleep(90);const basinRms=rms();check(basinRms>1e-5,'basin graph did not produce real audio');
    const basinDuration=sound.buffer.duration;
    const beforeSwitch=starts;sound.setSound('pipe');
    check(connected.size===0&&sound.voices.length===0&&sound.retiring.length===0,'switch left basin tail connected');
    await sound.pipeLoading;
    const preparedPipe=sound.pipeBuffer,firstPipeAt=performance.now();await sound.play();timing.firstPipePlayMs=performance.now()-firstPipeAt;
    check(preparedPipe&&sound.pipeBuffer===preparedPipe&&timing.decode.length===1,'pipe selection did not decode before playback');
    if(starts===beforeSwitch)await sound.play();
    const pipe=sound.pipeBuffer;
    check(pipe&&pipe.duration>3.1&&pipe.duration<3.25,'HTTP MP3 failed real decode or has unexpected duration');
    check(starts===beforeSwitch+1,'pipe source did not start');
    let pipeRms=0;for(let i=0;i<6;i++){await sleep(40);pipeRms=Math.max(pipeRms,rms());}
    check(pipeRms>1e-5,'pipe graph did not produce real audio');
    let maxVoices=0,maxRetiring=0,maxConnected=0;
    for(let i=0;i<35;i++){
      await sound.play();maxVoices=Math.max(maxVoices,sound.voices.length);maxRetiring=Math.max(maxRetiring,sound.retiring.length);maxConnected=Math.max(maxConnected,connected.size);
      check(sound.voices.length<=4&&sound.retiring.length<=4&&connected.size<=8,'rapid taps exceeded the live graph cap');
    }
    sound.stop();check(connected.size===0&&sound.voices.length===0&&sound.retiring.length===0,'stop left sources connected');
    await sleep(160);const stoppedRms=rms();check(stoppedRms<1e-7&&started.size===0,'stop left audible tail or live sources');
    const mutedStarts=starts;sound.setVolume(0);await sound.play();await sleep(40);
    check(starts===mutedStarts&&rms()<1e-7,'mute started a source or produced audio');
    sound.setSound('basin');sound.setVolume(.08);await sound.play();
    check(sound.voices.length===1&&sound.voices[0].source.buffer===sound.buffer,'switching back did not play basin');
    sound.setSound('pipe');check(connected.size===0,'switching back to pipe left basin connected');
    await sound.play();check(sound.voices[0].source.buffer===pipe,'cached real clip was not reused');
    sound.stop();await sleep(80);sound.destroy();
    return{contextWasRunning:true,assetPath:'/audio/metal-pipe-falling.mp3',basinDuration,pipeDuration:pipe.duration,pipeChannels:pipe.numberOfChannels,pipeSampleRate:pipe.sampleRate,basinRms,pipeRms,stoppedRms,sourceStarts:starts,maxVoices,maxRetiring,maxConnected,switchStopsOld:true,stopSilent:true,muteSkipsPlayback:true,warmupDropped,timing};
  }.toString()})()`);
  await finish({ok:true,profileIsolated:true,windowHidden:!win.isVisible(),outputMuted:win.webContents.isAudioMuted(),port:Number(new URL(service.url).port),...result});
}).catch(error=>finish({ok:false,error:String(error?.stack||error)}));
