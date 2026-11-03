'use strict';
const STAGES={behavior:'totalBehaviorMs',physics:'totalPhysicsMs',model:'totalModelUpdateMs',handOverlay:'totalHandOverlayMs',stateSetup:'totalGlStateSetupMs',drawSubmit:'totalDrawMs',stateSave:'totalStateSaveMs',sdkDraw:'totalSdkDrawMs',stateRestore:'totalStateRestoreMs'};
const CALLS={stateSave:'totalStateSaveCalls',sdkDraw:'totalSdkDrawCalls',stateRestore:'totalStateRestoreCalls'};
const FIELDS = ['frames','skippedFrames','totalRenderMs','averageRenderMs','maxRenderMs','canvasWidth','canvasHeight','canvasPixels',
  'textureBytes','textureCount','maxFps','recentFps','frameIntervalP95Ms','frameIntervalMaxMs','renderP95Ms','recentSamples','windowMs',
  'longFrames','wallElapsedMs','logicElapsedSeconds','meshBufferUploads','meshBufferUploadSkips','meshBufferUploadBytes','meshBufferCount','meshBufferLegacyCalls',
  'stateSnapshotBypasses','stateRestoreBypasses','renderGeneration',...Object.values(STAGES),...Object.values(CALLS)];
const STATES = new Set(['idle','thinking','listening','speaking','error']);
const text = value => typeof value === 'string' ? value.replace(/[\r\n\x00-\x1f]/g,' ').slice(0,240) : '';
function sanitizeRenderSample(value) {
  if(!value || typeof value!=='object' || !Number.isFinite(value.sampledAtMs) || value.sampledAtMs<0 || !Number.isSafeInteger(value.frames) || value.frames<0)return null;
  const sample={};
  for(const key of FIELDS)if(Number.isFinite(value[key])&&value[key]>=0&&value[key]<=1e15)sample[key]=value[key];
  sample.renderActive=value.renderActive===true;
  sample.meshBufferCacheEnabled=value.meshBufferCacheEnabled===true;
  sample.ownedGlStateEnabled=value.ownedGlStateEnabled===true;
  sample.renderQualityMode=['auto','quality','balanced','economy'].includes(value.renderQualityMode)?value.renderQualityMode:null;
  sample.renderQualityEffective=['quality','balanced','economy'].includes(value.renderQualityEffective)?value.renderQualityEffective:null;
  sample.state=STATES.has(value.state)?value.state:'unknown';
  sample.intent=typeof value.intent==='string'&&/^[a-z_-]{1,32}$/.test(value.intent)?value.intent:null;
  sample.documentVisibility=['visible','hidden','prerender'].includes(value.documentVisibility)?value.documentVisibility:'unknown';
  sample.focused=value.focused===true;
  sample.gpuRenderer=text(value.gpuRenderer);sample.gpuVendor=text(value.gpuVendor);
  sample.gpuInfoSource=['unmasked','standard','unavailable'].includes(value.gpuInfoSource)?value.gpuInfoSource:'unavailable';
  sample.contextAttributes={};
  for(const key of ['alpha','antialias','depth','stencil','premultipliedAlpha','preserveDrawingBuffer'])
    if(typeof value.contextAttributes?.[key]==='boolean')sample.contextAttributes[key]=value.contextAttributes[key];
  return sample;
}
function createRenderDiagnostics({now=Date.now,limit=20}={}) {
  let previous=null,latest=null;const samples=[];
  return {
    update(value) {
      const sample=sanitizeRenderSample(value);if(!sample)return false;
      const same=previous&&previous.session===value.session&&value.sampledAtMs>previous.at&&value.frames>=previous.frames;
      const elapsed=same?value.sampledAtMs-previous.at:0;
      sample.sampleWindowMs=elapsed;
      sample.sampleFps=elapsed>0?Math.round((value.frames-previous.frames)*100000/elapsed)/100:null;
      sample.stageAverageMs={};
      sample.stageCallsPerFrame={};
      const count=same?value.frames-previous.frames:0;
      if(count>0)for(const [stage,key]of Object.entries(STAGES))if(Number.isFinite(sample[key])&&Number.isFinite(previous.totals[key])&&sample[key]>=previous.totals[key])
        sample.stageAverageMs[stage]=Math.round((sample[key]-previous.totals[key])*100/count)/100;
      if(count>0)for(const [stage,key]of Object.entries(CALLS))if(Number.isFinite(sample[key])&&Number.isFinite(previous.totals[key])&&sample[key]>=previous.totals[key])
        sample.stageCallsPerFrame[stage]=Math.round((sample[key]-previous.totals[key])*100/count)/100;
      sample.receivedAt=now();
      if(!same)samples.length=0;
      previous={at:value.sampledAtMs,frames:value.frames,session:text(value.session),totals:Object.fromEntries([...Object.values(STAGES),...Object.values(CALLS)].map(key=>[key,sample[key]]))};
      latest=sample;samples.push(sample);while(samples.length>limit)samples.shift();return true;
    },
    reset() { previous=null;latest=null;samples.length=0; },
    snapshot(host={}, {history=false}={}) {
      return {available:!!latest,...host,sample:latest?{...latest,ageMs:Math.max(0,now()-latest.receivedAt)}:null,
        ...(history?{samples:samples.map(sample=>({...sample}))}:{})};
    },
  };
}
module.exports={createRenderDiagnostics,sanitizeRenderSample};
