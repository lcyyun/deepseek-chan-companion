import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers/import-typescript.mjs';
const {createOwnedGlState}=await importTypeScript(new URL('../src/renderer/owned-gl-state.ts',import.meta.url));

function fixture() {
  const calls=[],queries=[];let lost=false;
  const state={enabled:new Set(),attributes:new Set(),textures:new Map(),bindings:new Map()};
  const gl={};let enumId=1;
  for(const name of ['FRAMEBUFFER','SCISSOR_TEST','STENCIL_TEST','DEPTH_TEST','CULL_FACE','BLEND','FUNC_ADD','ONE','ONE_MINUS_SRC_ALPHA','TEXTURE0','TEXTURE1','TEXTURE_2D','ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','CCW','BACK'])gl[name]=enumId++;
  Object.assign(gl,{
    bindFramebuffer:(target,value)=>{calls.push(['bindFramebuffer',target,value]);state.fbo=value;},
    viewport:(...values)=>{calls.push(['viewport',...values]);state.viewport=values;},
    disable:value=>{calls.push(['disable',value]);state.enabled.delete(value);},
    enable:value=>{calls.push(['enable',value]);state.enabled.add(value);},
    cullFace:value=>{calls.push(['cullFace',value]);state.cull=value;},
    frontFace:value=>{calls.push(['frontFace',value]);state.front=value;},
    colorMask:(...values)=>{calls.push(['colorMask',...values]);state.color=values;},
    blendEquationSeparate:(...values)=>{calls.push(['blendEquationSeparate',...values]);state.equation=values;},
    blendFuncSeparate:(...values)=>{calls.push(['blendFuncSeparate',...values]);state.blend=values;},
    useProgram:value=>{calls.push(['useProgram',value]);state.program=value;},
    disableVertexAttribArray:index=>{calls.push(['disableVertexAttribArray',index]);state.attributes.delete(index);},
    bindBuffer:(target,value)=>{calls.push(['bindBuffer',target,value]);state.bindings.set(target,value);},
    activeTexture:value=>{calls.push(['activeTexture',value]);state.active=value;},
    bindTexture:(target,value)=>{calls.push(['bindTexture',target,value]);state.textures.set(state.active,value);},
    isContextLost:()=>lost,
    getParameter:key=>{queries.push(['getParameter',key]);return null;},
    getVertexAttrib:(...args)=>{queries.push(['getVertexAttrib',...args]);return false;},
    isEnabled:key=>{queries.push(['isEnabled',key]);return false;},
    flush:()=>{throw Error('flush forbidden');},finish:()=>{throw Error('finish forbidden');},
  });
  class Renderer {
    constructor(){this.gl=gl;this._rendererProfile={gl,save(){},restore(){}};this.order=[];this.masks={identity:'unchanged'};this._bufferData={identity:'unchanged'};this.saved=0;this.restored=0;}
    saveProfile(){this.saved++;gl.getParameter('legacy state');}
    restoreProfile(){this.restored++;gl.getVertexAttrib(0,'legacy attr');}
    setRenderState(fbo,viewport){this.renderState={fbo,viewport};}
    preDraw(){this.order.push('pre');}
    doDrawModel(){this.preDraw();this.order.push('mask');gl.bindFramebuffer(gl.FRAMEBUFFER,'mask-fbo');gl.viewport(0,0,1024,1024);if(this.fail)throw Error('draw failed');gl.bindFramebuffer(gl.FRAMEBUFFER,this.renderState?.fbo??null);if(this.renderState)gl.viewport(...this.renderState.viewport);this.order.push('art');}
    drawModel(){this.saveProfile();this.doDrawModel();this.restoreProfile();}
  }
  const renderer=new Renderer(),owner=createOwnedGlState(gl);
  return{gl,state,calls,queries,Renderer,renderer,owner,setLost:value=>{lost=value;}};
}

test('owned frame establishes required state without queries, flushes or changing the SDK draw path',()=>{
  const f=fixture(),draw=f.renderer.drawModel,doDraw=f.renderer.doDrawModel,masks=f.renderer.masks,buffers=f.renderer._bufferData;
  f.state.enabled=new Set([f.gl.SCISSOR_TEST,f.gl.STENCIL_TEST,f.gl.DEPTH_TEST,f.gl.CULL_FACE]);
  f.state.attributes=new Set([0,1,2,3]);
  assert.deepEqual(f.owner.attach(f.renderer),{enabled:true,reason:null});
  assert.equal(f.owner.beginFrame(2562,1368),true);
  assert.equal(f.state.fbo,null);assert.deepEqual(f.state.viewport,[0,0,2562,1368]);
  assert.deepEqual([...f.state.enabled],[f.gl.BLEND]);assert.deepEqual([...f.state.attributes],[]);
  assert.deepEqual(f.state.color,[true,true,true,true]);assert.deepEqual(f.state.equation,[f.gl.FUNC_ADD,f.gl.FUNC_ADD]);
  assert.deepEqual(f.state.blend,[f.gl.ONE,f.gl.ONE_MINUS_SRC_ALPHA,f.gl.ONE,f.gl.ONE_MINUS_SRC_ALPHA]);
  assert.equal(f.state.active,f.gl.TEXTURE0);assert.equal(f.state.textures.get(f.gl.TEXTURE0),null);assert.equal(f.state.textures.get(f.gl.TEXTURE1),null);
  assert.equal(f.state.bindings.get(f.gl.ARRAY_BUFFER),null);assert.equal(f.state.bindings.get(f.gl.ELEMENT_ARRAY_BUFFER),null);
  f.renderer.drawModel();
  assert.deepEqual(f.renderer.order,['pre','mask','art']);assert.deepEqual(f.queries,[]);
  assert.equal(f.renderer.saved,0);assert.equal(f.renderer.restored,0);
  assert.equal(f.renderer.drawModel,draw);assert.equal(f.renderer.doDrawModel,doDraw);
  assert.equal(f.renderer.masks,masks);assert.equal(f.renderer._bufferData,buffers);
  assert.equal(f.owner.stats().bypassedSaves,1);assert.equal(f.owner.stats().bypassedRestores,1);
  f.owner.dispose();
});

test('legacy profile is preserved until a complete known-state frame and paired unknown calls remain legacy',()=>{
  const f=fixture();f.owner.attach(f.renderer);f.renderer.drawModel();
  assert.equal(f.renderer.saved,1);assert.equal(f.renderer.restored,1);
  f.owner.beginFrame(640,480);f.renderer.saveProfile('unknown overload');f.renderer.restoreProfile();
  assert.equal(f.renderer.saved,2);assert.equal(f.renderer.restored,2);
  f.renderer.drawModel();assert.equal(f.owner.stats().bypassedSaves,1);f.owner.dispose();
});

test('primary and lazy mirror use the same default target without sharing profile bookkeeping',()=>{
  const f=fixture();f.owner.attach(f.renderer);f.owner.beginFrame(1200,900);
  const mirror=new f.Renderer();f.owner.attach(mirror);
  assert.equal(mirror.renderState.fbo,null);assert.deepEqual(mirror.renderState.viewport,[0,0,1200,900]);
  mirror.drawModel();f.renderer.drawModel();
  assert.equal(f.owner.stats().rendererCount,2);assert.equal(f.owner.stats().saveCalls,2);assert.equal(f.owner.stats().restoreCalls,2);
  assert.equal(f.owner.stats().bypassedSaves,2);assert.deepEqual(f.queries,[]);
  assert.equal(f.state.fbo,null);assert.deepEqual(f.state.viewport,[0,0,1200,900]);
  f.owner.beginFrame(800,600);assert.deepEqual(mirror.renderState.viewport,[0,0,800,600]);f.owner.dispose();
});

test('failed draws are reset on the next owned frame and disposal restores exact own/prototype methods',()=>{
  const f=fixture(),save=f.renderer.saveProfile,restore=f.renderer.restoreProfile;
  f.owner.attach(f.renderer);f.owner.beginFrame(100,100);f.renderer.fail=true;
  assert.throws(()=>f.renderer.drawModel(),/draw failed/);assert.equal(f.state.fbo,'mask-fbo');
  f.renderer.fail=false;f.owner.beginFrame(100,100);f.renderer.drawModel();assert.equal(f.state.fbo,null);
  f.owner.dispose();f.owner.dispose();assert.equal(f.renderer.saveProfile,save);assert.equal(f.renderer.restoreProfile,restore);
  assert.equal(Object.hasOwn(f.renderer,'saveProfile'),false);assert.equal(Object.hasOwn(f.renderer,'restoreProfile'),false);
  const g=fixture();Object.defineProperty(g.renderer,'saveProfile',{value:g.renderer.saveProfile,writable:true,configurable:true,enumerable:false});
  const before=Object.getOwnPropertyDescriptor(g.renderer,'saveProfile');g.owner.attach(g.renderer);g.owner.dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(g.renderer,'saveProfile'),before);
});

test('invalid targets, shared contexts and unsupported SDK shapes do not silently enable owned-state mode',()=>{
  const f=fixture();const shared=createOwnedGlState(f.gl,{preserveExternalState:true});
  assert.equal(shared.attach(f.renderer).enabled,false);assert.equal(shared.beginFrame(10,10),false);
  assert.equal(f.calls.length,0);assert.equal(f.owner.attach({...f.renderer,_rendererProfile:null}).enabled,false);
  const readonly=new f.Renderer();Object.defineProperty(readonly,'saveProfile',{value:readonly.saveProfile,writable:false});
  assert.equal(f.owner.attach(readonly).enabled,false);f.owner.attach(f.renderer);
  for(const dims of [[0,1],[-1,1],[1.2,10],[NaN,10],[10,Infinity],[2**31,10]]){
    const before=f.calls.length;assert.throws(()=>f.owner.beginFrame(...dims),RangeError);assert.equal(f.calls.length,before);
  }
  f.setLost(true);assert.throws(()=>f.owner.beginFrame(10,10),/context is lost/);assert.equal(f.owner.stats().ready,false);
  f.owner.dispose();assert.equal(f.owner.beginFrame(10,10),false);assert.equal(f.owner.attach(f.renderer).enabled,false);
});

test('later decorators survive disposal and captured bypass methods become legacy delegates',()=>{
  const f=fixture();f.owner.attach(f.renderer);f.owner.beginFrame(10,10);
  const captured=f.renderer.saveProfile,decorator=function(){return captured.call(this);};f.renderer.saveProfile=decorator;
  f.owner.dispose();assert.equal(f.renderer.saveProfile,decorator);f.renderer.saveProfile();assert.equal(f.renderer.saved,1);
});
