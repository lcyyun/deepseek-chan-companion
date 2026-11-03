import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers/import-typescript.mjs';
const { createMeshBufferCache } = await importTypeScript(new URL('../src/renderer/mesh-buffer-cache.ts', import.meta.url));

function fixture() {
  let next=0;const uploads=[],deleted=[],binds=new Map();
  class GL {
    ARRAY_BUFFER=34962;ELEMENT_ARRAY_BUFFER=34963;DYNAMIC_DRAW=35048;
    createBuffer(){return{id:++next};}
    deleteBuffer(buffer){deleted.push(buffer);}
    bindBuffer(target,buffer){binds.set(target,buffer);}
    bufferData(target,data,usage,...extra){uploads.push({target,data:ArrayBuffer.isView(data)?Array.from(data):data,usage,extra,buffer:binds.get(target)});}
  }
  const gl=new GL();
  const vertex=[new Float32Array([0,1,2,3]),new Float32Array([4,5,6,7])];
  const uv=[new Float32Array([0,.25,.5,1]),new Float32Array([1,.5,.25,0])];
  const indices=[new Uint16Array([0,1,0]),new Uint16Array([1,0,1])];
  const model={getDrawableCount:()=>2,getDrawableVertices:i=>vertex[i],getDrawableVertexUvs:i=>uv[i],getDrawableVertexIndices:i=>indices[i]};
  class Renderer {
    constructor(){this.gl=gl;this._bufferData={vertex:null,uv:null,index:null};this.draws=[];this.order=[0,1];}
    drawMeshWebGL(m,index){
      for(const [kind,target,data]of [
        ['vertex',gl.ARRAY_BUFFER,m.getDrawableVertices(index)],['uv',gl.ARRAY_BUFFER,m.getDrawableVertexUvs(index)],['index',gl.ELEMENT_ARRAY_BUFFER,m.getDrawableVertexIndices(index)],
      ]){
        this._bufferData[kind]??=gl.createBuffer();gl.bindBuffer(target,this._bufferData[kind]);gl.bufferData(target,data,gl.DYNAMIC_DRAW);
      }
      this.draws.push({index,buffers:{...this._bufferData}});
      if(this.throwAfter)throw Error('injected SDK draw failure');
    }
    drawModel(){for(const index of this.order)this.drawMeshWebGL(model,index);}
  }
  const renderer=new Renderer(),cache=createMeshBufferCache(gl,model);
  return{gl,model,renderer,cache,Renderer,vertex,uv,indices,uploads,deleted,binds};
}

test('static data uploads once per drawable and dynamic vertices upload each frame',()=>{
  const f=fixture(),scratch=f.renderer._bufferData,oldData=f.gl.bufferData,oldBind=f.gl.bindBuffer;
  assert.deepEqual(f.cache.attach(f.renderer),{enabled:true,reason:null});
  f.cache.beginFrame();f.renderer.drawModel();
  assert.equal(f.uploads.length,6);assert.equal(f.cache.stats().bufferCount,6);
  f.cache.beginFrame();f.renderer.drawModel();
  assert.equal(f.uploads.length,8);assert.equal(f.cache.stats().vertexUploads,4);
  assert.equal(f.cache.stats().uvUploads,2);assert.equal(f.cache.stats().indexUploads,2);assert.equal(f.cache.stats().skips,4);
  assert.deepEqual(f.renderer.draws.map(d=>d.index),[0,1,0,1]);
  assert.equal(f.renderer._bufferData,scratch);assert.equal(f.gl.bufferData,oldData);assert.equal(f.gl.bindBuffer,oldBind);
  assert.equal(Object.hasOwn(f.gl,'bufferData'),false);assert.equal(Object.hasOwn(f.gl,'bindBuffer'),false);
  f.cache.dispose();
});

test('repeated mask and art draws reuse uploads within an epoch without changing order',()=>{
  const f=fixture();f.renderer.order=[0,0,1,0,1];f.cache.attach(f.renderer);f.cache.beginFrame();f.renderer.drawModel();
  assert.equal(f.uploads.length,6);assert.equal(f.cache.stats().skips,9);
  assert.deepEqual(f.renderer.draws.map(d=>d.index),[0,0,1,0,1]);f.cache.dispose();
});

test('in-place vertex changes and reversions within a frame upload the correct contents',()=>{
  const f=fixture();f.cache.attach(f.renderer);f.cache.beginFrame();
  f.renderer.drawMeshWebGL(f.model,0);f.vertex[0][0]=99;f.renderer.drawMeshWebGL(f.model,0);
  f.vertex[0][0]=0;f.renderer.drawMeshWebGL(f.model,0);f.renderer.drawMeshWebGL(f.model,0);
  const vertices=f.uploads.filter(u=>u.buffer===f.renderer.draws[0].buffers.vertex);
  assert.deepEqual(vertices.map(u=>u.data[0]),[0,99,0]);assert.equal(f.cache.stats().uploads,5);
  // Signed zero is a content change too.
  f.vertex[0][0]=-0;f.renderer.drawMeshWebGL(f.model,0);assert.equal(f.cache.stats().uploads,6);f.cache.dispose();
});

test('native and mirror renderers never share vertex or static buffers',()=>{
  const f=fixture(),mirror=new f.Renderer();f.cache.attach(f.renderer);f.cache.attach(mirror);f.cache.beginFrame();
  f.renderer.drawMeshWebGL(f.model,0);f.vertex[0][0]=-20;mirror.drawMeshWebGL(f.model,0);
  f.vertex[0][0]=0;f.renderer.drawMeshWebGL(f.model,0);
  f.vertex[0][0]=-20;mirror.drawMeshWebGL(f.model,0);
  assert.notEqual(f.renderer.draws[0].buffers.vertex,mirror.draws[0].buffers.vertex);
  assert.notEqual(f.renderer.draws[0].buffers.uv,mirror.draws[0].buffers.uv);
  assert.equal(f.cache.stats().uploads,6);assert.equal(f.cache.stats().skips,6);f.cache.dispose();
});

test('mirror mask prepass and manually interleaved art draws share only their own unchanged uploads',()=>{
  const f=fixture(),mirror=new f.Renderer();mirror.order=[0];f.renderer.order=[0];
  f.cache.attach(f.renderer);f.cache.attach(mirror);f.cache.beginFrame();
  const drawMirror=mirror.drawMeshWebGL,drawNative=f.renderer.drawMeshWebGL;
  f.vertex[0][0]=-20;
  mirror.drawMeshWebGL=function(m,i){drawMirror.call(this,m,i);};
  try{mirror.drawModel();}finally{mirror.drawMeshWebGL=drawMirror;}
  f.vertex[0][0]=0;
  f.renderer.drawMeshWebGL=function(m,i){
    f.vertex[0][0]=-20;try{drawMirror.call(mirror,m,0);}finally{f.vertex[0][0]=0;}
    drawNative.call(this,m,i);
  };
  try{f.renderer.drawModel();}finally{f.renderer.drawMeshWebGL=drawNative;}
  assert.equal(f.uploads.length,6);assert.equal(f.cache.stats().skips,3);
  assert.deepEqual(f.uploads.filter(u=>u.buffer===mirror.draws[0].buffers.vertex).map(u=>u.data[0]),[-20]);
  assert.deepEqual(f.uploads.filter(u=>u.buffer===f.renderer.draws[0].buffers.vertex).map(u=>u.data[0]),[0]);
  assert.equal(Object.hasOwn(f.gl,'bufferData'),false);f.cache.dispose();
});

test('content validation updates modified static arrays and newly sized geometry',()=>{
  const f=fixture();f.cache.attach(f.renderer);f.cache.beginFrame();f.renderer.drawMeshWebGL(f.model,0);
  f.uv[0][1]=.75;f.indices[0][0]=1;f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.cache.stats().uvUploads,2);assert.equal(f.cache.stats().indexUploads,2);
  f.vertex[0]=new Float32Array([0,1,2,3,4,5]);f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.cache.stats().vertexUploads,2);assert.equal(f.uploads.at(-1).data.length,6);f.cache.dispose();
});

test('Float32 validation preserves distinct NaN payloads and signed-zero bit patterns',()=>{
  const f=fixture();f.cache.attach(f.renderer);f.cache.beginFrame();
  const bits=new Uint32Array(f.vertex[0].buffer,f.vertex[0].byteOffset,f.vertex[0].length);
  bits[0]=0x7fc00001;f.renderer.drawMeshWebGL(f.model,0);
  f.renderer.drawMeshWebGL(f.model,0);assert.equal(f.cache.stats().vertexUploads,1);
  bits[0]=0x7fc00002;f.renderer.drawMeshWebGL(f.model,0);assert.equal(f.cache.stats().vertexUploads,2);
  bits[0]=0x80000000;f.renderer.drawMeshWebGL(f.model,0);assert.equal(f.cache.stats().vertexUploads,3);
  bits[0]=0x00000000;f.renderer.drawMeshWebGL(f.model,0);assert.equal(f.cache.stats().vertexUploads,4);
  f.cache.dispose();
});

test('source views rebind for changed buffers, offsets and lengths while stable aliases remain valid',()=>{
  const f=fixture();f.cache.attach(f.renderer);f.cache.beginFrame();f.renderer.drawMeshWebGL(f.model,0);
  const backing=new Float32Array([0,.25,.5,1,1,.5,.25,0]);
  f.uv[0]=new Float32Array(backing.buffer,16,4);f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.cache.stats().uvUploads,2);assert.deepEqual(f.uploads.at(-1).data,[1,.5,.25,0]);
  f.uv[0]=new Float32Array(backing.buffer,0,4);f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.cache.stats().uvUploads,3);assert.deepEqual(f.uploads.at(-1).data,[0,.25,.5,1]);
  f.uv[0]=new Float32Array(backing.buffer,0,4);f.renderer.drawMeshWebGL(f.model,0);assert.equal(f.cache.stats().uvUploads,3);
  backing[1]=.75;f.renderer.drawMeshWebGL(f.model,0);assert.equal(f.cache.stats().uvUploads,4);
  f.uv[0]=new Float32Array(backing.buffer,0,6);f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.cache.stats().uvUploads,5);assert.equal(f.uploads.at(-1).data.length,6);f.cache.dispose();
});

test('unknown views and bufferData overloads are forwarded and invalidate the touched cache',()=>{
  const f=fixture(),original=f.renderer.drawMeshWebGL;
  f.renderer.drawMeshWebGL=function(m,index){
    original.call(this,m,index);
    if(this.unknown){
      f.gl.bindBuffer(f.gl.ARRAY_BUFFER,this._bufferData.vertex);
      f.gl.bufferData(f.gl.ARRAY_BUFFER,new Float32Array([88,88,88,88]),f.gl.DYNAMIC_DRAW);
      f.gl.bufferData(f.gl.ARRAY_BUFFER,m.getDrawableVertices(index),f.gl.DYNAMIC_DRAW,0);
    }
  };
  f.cache.attach(f.renderer);f.cache.beginFrame();f.renderer.unknown=true;f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.uploads.length,5);assert.deepEqual(f.uploads[3].data,[88,88,88,88]);assert.deepEqual(f.uploads[4].extra,[0]);
  f.renderer.unknown=false;f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.uploads.length,6);assert.deepEqual(f.uploads[5].data,[0,1,2,3]);f.cache.dispose();
});

test('exceptions restore context methods and SDK scratch data; dispose restores methods and releases buffers once',()=>{
  const f=fixture(),oldMesh=f.renderer.drawMeshWebGL,oldModel=f.renderer.drawModel,scratch=f.renderer._bufferData,oldData=f.gl.bufferData,oldBind=f.gl.bindBuffer;
  f.cache.attach(f.renderer);f.cache.beginFrame();f.renderer.throwAfter=true;
  assert.throws(()=>f.renderer.drawModel(),/injected/);
  assert.equal(f.renderer._bufferData,scratch);assert.equal(f.gl.bufferData,oldData);assert.equal(f.gl.bindBuffer,oldBind);
  f.renderer.throwAfter=false;f.cache.beginFrame();f.renderer.drawModel();
  const count=f.cache.stats().bufferCount;f.cache.dispose();f.cache.dispose();
  assert.equal(f.deleted.length,count);assert.equal(new Set(f.deleted).size,count);
  assert.equal(f.cache.stats().bufferCount,0);assert.equal(f.cache.stats().rendererCount,0);
  assert.equal(f.renderer.drawMeshWebGL,oldMesh);assert.equal(f.renderer.drawModel,oldModel);assert.equal(f.renderer._bufferData,scratch);
  assert.equal(Object.hasOwn(f.renderer,'drawMeshWebGL'),false);assert.equal(Object.hasOwn(f.renderer,'drawModel'),false);
});

test('unknown renderer/context layouts stay on the legacy path',()=>{
  const f=fixture(),before=f.renderer.drawMeshWebGL;
  delete f.renderer._bufferData.index;assert.equal(f.cache.attach(f.renderer).enabled,false);assert.equal(f.renderer.drawMeshWebGL,before);
  const r=new f.Renderer();Object.defineProperty(r,'_bufferData',{value:r._bufferData,writable:false});
  assert.equal(f.cache.attach(r).enabled,false);
  const g=fixture();Object.defineProperty(g.gl,'bufferData',{value:g.gl.bufferData,writable:false});assert.equal(g.cache.attach(g.renderer).enabled,false);
  assert.equal(f.cache.stats().bufferCount,0);f.cache.dispose();g.cache.dispose();
});

test('partial allocation failure deletes only owned resources and returns to original rendering',()=>{
  const f=fixture();const create=f.gl.createBuffer.bind(f.gl);let calls=0;
  f.gl.createBuffer=()=>++calls===2?null:create();
  f.cache.attach(f.renderer);f.cache.beginFrame();f.renderer.drawMeshWebGL(f.model,0);
  assert.equal(f.cache.attach(f.renderer).enabled,false);assert.equal(f.cache.stats().bufferCount,0);
  assert.equal(f.deleted.length,1);assert.equal(f.uploads.length,3);f.cache.dispose();
});
