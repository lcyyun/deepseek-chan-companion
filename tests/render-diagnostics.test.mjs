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
