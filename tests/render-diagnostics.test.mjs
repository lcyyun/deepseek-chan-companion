import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostics from '../desktop/render-diagnostics.cjs';
const sample=(frames,at,extra={})=>({session:'test-instance',sampledAtMs:at,frames,state:'thinking',renderActive:true,gpuRenderer:'ANGLE (NVIDIA)',...extra});

test('render diagnostics measure actual reporting windows, bounded history and reload resets',()=>{
  let now=100;const d=diagnostics.createRenderDiagnostics({now:()=>now,limit:2});
  assert.equal(d.snapshot().available,false);
  d.update(sample(30,1000,{totalDrawMs:90,totalStateSaveCalls:30}));now+=2000;d.update(sample(40,3000,{totalDrawMs:140,totalStateSaveCalls:40}));
  assert.equal(d.snapshot().sample.sampleFps,5);
  assert.equal(d.snapshot().sample.stageAverageMs.drawSubmit,5);
  assert.equal(d.snapshot().sample.stageCallsPerFrame.stateSave,1);
  now+=2000;d.update(sample(160,5000));assert.equal(d.snapshot().sample.sampleFps,60);
  assert.equal(d.snapshot({}, {history:true}).samples.length,2);
  assert.equal('samples' in d.snapshot(),false);
  d.update(sample(1,300,{session:'reloaded'}));
  assert.equal(d.snapshot().sample.sampleFps,null);assert.equal(d.snapshot({}, {history:true}).samples.length,1);
  d.reset();assert.equal(d.snapshot().available,false);assert.equal(d.snapshot({}, {history:true}).samples.length,0);
});

test('diagnostics reject invalid samples and never copy arbitrary credentials, paths or chat fields',()=>{
  const d=diagnostics.createRenderDiagnostics();
  assert.equal(d.update({frames:NaN,sampledAtMs:50}),false);
  d.update(sample(1,100,{token:'private-pairing',modelRoot:'C:/private',latestReply:'private-chat',
    apiKey:'secret',maxFps:Infinity,contextAttributes:{antialias:false,private:'private'}}));
  const output=JSON.stringify(d.snapshot({}, {history:true}));
  assert.doesNotMatch(output,/private|secret|modelRoot|latestReply|apiKey|token/);
  assert.equal(d.snapshot().sample.contextAttributes.antialias,false);assert.equal(d.snapshot().sample.maxFps,undefined);
});

test('GPU diagnostics retain only bounded summary values and known phases, never raw queries or samples',()=>{
  const gpuTiming={supported:true,active:false,reason:'completed',samples:20,pending:0,disjointCount:1,timeoutCount:2,
    gpuMeanMs:1.5,gpuP95Ms:3,gpuMaxMs:4,pollCpuMaxMs:0.2,rawSamples:[{token:'private'}],query:{path:'C:/private'},
    phases:[{label:'thinking',samples:10,gpuMeanMs:2,gpuP95Ms:3,gpuMaxMs:4,private:'secret'},
      {label:'idea',samples:5,gpuMeanMs:1,gpuP95Ms:2,gpuMaxMs:3},{label:'thinking',samples:9000},
      {label:'C:/private',samples:1},...Array.from({length:40},()=>({label:'speaking',samples:5,gpuMeanMs:1,gpuP95Ms:2,gpuMaxMs:3}))]};
  const d=diagnostics.createRenderDiagnostics();d.update(sample(1,100,{gpuTiming}));
  const clean=d.snapshot().sample.gpuTiming;
  assert.equal(clean.samples,20);assert.equal(clean.gpuP95Ms,3);assert.equal(clean.pollCpuMaxMs,0.2);
  assert.deepEqual(clean.phases.map(phase=>phase.label),['thinking','idea','speaking']);
  assert.doesNotMatch(JSON.stringify(d.snapshot({}, {history:true})),/private|secret|rawSamples|query/);
  assert.notEqual(clean,gpuTiming);assert.notEqual(clean.phases[0],gpuTiming.phases[0]);
});

test('GPU diagnostic fields reject unknown reasons, nonfinite times and unbounded counters',()=>{
  assert.equal(diagnostics.sanitizeGpuTiming({supported:true,active:true,reason:'C:/private'}),null);
  assert.equal(diagnostics.sanitizeGpuTimingStatus({supported:false,active:true,reason:'capturing'}),null);
  assert.equal(diagnostics.sanitizeGpuTimingStatus({supported:1,active:false,reason:'unsupported'}),null);
  for(const reason of ['not-ready','hidden']){
    const status={supported:false,active:false,reason};
    assert.equal(diagnostics.sanitizeGpuTiming(status),null);
    assert.deepEqual(diagnostics.sanitizeGpuTimingStatus(status,{allowStartFailure:true}),status);
  }
  const clean=diagnostics.sanitizeGpuTiming({supported:true,active:true,reason:'capturing',samples:Infinity,pending:99999,
    gpuMeanMs:NaN,gpuP95Ms:-1,gpuMaxMs:1e100,pollCpuMaxMs:Infinity,disjointCount:1.5,timeoutCount:-1,
    phases:[{label:'idle',samples:NaN,gpuMeanMs:Infinity,gpuP95Ms:-1,gpuMaxMs:1e100}]});
  assert.equal(clean.samples,0);assert.equal(clean.pending,0);assert.equal(clean.disjointCount,0);
  for(const field of ['gpuMeanMs','gpuP95Ms','gpuMaxMs','pollCpuMaxMs'])assert.equal(clean[field],0);
  assert.deepEqual(clean.phases,[{label:'idle',samples:0,gpuMeanMs:0,gpuP95Ms:0,gpuMaxMs:0}]);
  for(const reason of ['not-started','unsupported','observer-overhead','timer-error','disposed','stopped','draining','completed']){
    const status=diagnostics.sanitizeGpuTimingStatus({supported:false,active:false,reason,raw:'secret'});
    assert.deepEqual(status,{supported:false,active:false,reason});
  }
});
