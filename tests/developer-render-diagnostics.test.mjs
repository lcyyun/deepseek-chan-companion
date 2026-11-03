import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers/import-typescript.mjs';
const { attachDeveloperRenderDiagnostics } = await importTypeScript(new URL('../src/renderer/developer-render-diagnostics.ts', import.meta.url));

function fixture(t) {
  const saved=Object.fromEntries(['window','document','setInterval','clearInterval'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const calls=[],timers=new Map();let listener=null,serial=0,statsReads=0;
  globalThis.window={companion:{onEvent(callback){listener=callback;return()=>{listener=null;};},control(action,data){calls.push({action,data});return Promise.resolve(true);}}};
  globalThis.document={visibilityState:'visible',hasFocus:()=>false};
  globalThis.setInterval=(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;};
  globalThis.clearInterval=id=>timers.delete(id);
  t.after(()=>{for(const [key,value]of Object.entries(saved)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  let runtime={getPerformanceStats(){statsReads++;return{frames:42,rafCallbacks:84};},startGpuTiming(durationMs){calls.push({action:'runtime-start',data:durationMs});return{supported:true,active:true,reason:'capturing'};}};
  const bootstrap={renderGeneration:7,renderQuality:{mode:'quality',effective:'quality'}};
  return{calls,timers,bootstrap,statsReads:()=>statsReads,event:event=>listener?.(event),setRuntime:value=>{runtime=value;},
    start:()=>attachDeveloperRenderDiagnostics({getRuntime:()=>runtime,getBootstrap:()=>bootstrap,getState:()=>'thinking',getIntent:()=>'think'})};
}

test('developer sampler is idle until its existing two-second reporting tick and cleans up subscriptions',t=>{
  const f=fixture(t),dispose=f.start();
  assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.delay,2000);
  assert.equal(f.statsReads(),0);assert.deepEqual(f.calls,[]);
  timer.callback();
  assert.equal(f.statsReads(),1);assert.equal(f.calls.length,1);
  const {action,data}=f.calls[0];assert.equal(action,'render-sample');
  assert.equal(data.frames,42);assert.equal(data.renderGeneration,7);assert.equal(data.state,'thinking');assert.equal(data.intent,'think');
  assert.equal(data.renderQualityEffective,'quality');assert.equal(data.focused,false);assert.ok(data.session);
  dispose();assert.equal(f.timers.size,0);
  f.event({type:'start-gpu-timing',renderGeneration:7});assert.equal(f.calls.length,1);
});

test('GPU diagnostics acknowledge only the current generation and report an unready model without starting it',t=>{
  const f=fixture(t),dispose=f.start();
  f.event({type:'start-gpu-timing',renderGeneration:6,requestId:'stale',durationMs:15000});assert.deepEqual(f.calls,[]);
  f.event({type:'start-gpu-timing',renderGeneration:7,requestId:'current',durationMs:15000});
  assert.deepEqual(f.calls[0],{action:'runtime-start',data:15000});
  assert.deepEqual(f.calls[1],{action:'gpu-timing-status',data:{supported:true,active:true,reason:'capturing',requestId:'current',renderGeneration:7}});
  f.setRuntime(null);
  f.event({type:'start-gpu-timing',renderGeneration:7,requestId:'loading',durationMs:15000});
  assert.deepEqual(f.calls.at(-1),{action:'gpu-timing-status',data:{supported:false,active:false,reason:'not-ready',requestId:'loading',renderGeneration:7}});
  const count=f.calls.length;[...f.timers.values()][0].callback();assert.equal(f.calls.length,count,'no fabricated sample while model is absent');
  dispose();
});
