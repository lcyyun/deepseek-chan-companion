import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRenderQuality } from '../src/shared/render-quality.mjs';
import { createMoveQueue, quantizeRegion } from '../src/shared/input-scheduling.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('automatic quality selects the 16GB budget and respects explicit user modes', () => {
  for (const ram of [0, 8, 16, 20]) assert.equal(resolveRenderQuality('auto', ram * 1024 ** 3).effective, 'balanced');
  assert.equal(resolveRenderQuality('auto', 32 * 1024 ** 3).effective, 'quality');
  assert.equal(resolveRenderQuality('quality', 8 * 1024 ** 3).maxTextureSize, 4096);
  assert.equal(resolveRenderQuality('economy', 40 * 1024 ** 3).maxFps, 30);
  assert.equal(resolveRenderQuality('bad', NaN).effective, 'balanced');
});

test('drag deltas coalesce, preserve direction changes, and flush the final move under IPC backpressure', async () => {
  let scheduled, finish;
  const calls=[];
  const queue=createMoveQueue(delta=>{calls.push(delta);return new Promise(resolve=>{finish=resolve;});},
    {schedule:fn=>{scheduled=fn;return 1;},cancel:()=>{scheduled=undefined;}});
  for(let i=0;i<100;i++)queue.push(1,2);
  queue.push(-25,-50); assert.equal(calls.length,0);
  scheduled(); assert.deepEqual(calls,[{dx:75,dy:150}]);
  queue.push(4,5);queue.push(-1,2);queue.flush();assert.equal(calls.length,1);
  finish();await tick();assert.deepEqual(calls[1],{dx:3,dy:7});
  finish();await tick();queue.dispose();
});

test('cancelled or disposed pointer queues never replay stale movement', async () => {
  let scheduled; const calls=[];
  const queue=createMoveQueue(d=>calls.push(d),{schedule:fn=>{scheduled=fn;return 1;},cancel:()=>{scheduled=undefined;}});
  queue.push(10,10);queue.cancel();assert.equal(scheduled,undefined);
  queue.flush();await tick();assert.equal(calls.length,0);
  queue.push(5,5);queue.dispose();queue.push(9,9);queue.flush();await tick();assert.equal(calls.length,0);
});

test('subpixel geometry jitter is stable and conservative around screen edges', () => {
  const first=quantizeRegion({x:-7.6,y:3.2,width:24.1,height:31.2});
  assert.deepEqual(quantizeRegion({x:-7.5,y:3.3,width:24.1,height:31.2}),first);
  assert.ok(first.x<=-7.6&&first.y<=3.2&&first.x+first.width>=16.5&&first.y+first.height>=34.4);
  assert.equal(quantizeRegion({x:0,y:0,width:0,height:4}),null);
});

test('large drag batches retain overflow beyond the native 2000-DIP clamp', async () => {
  const calls=[];let finish;
  const queue=createMoveQueue(delta=>{calls.push(delta);return new Promise(resolve=>{finish=resolve;});}, {schedule:()=>1,cancel:()=>{}});
  queue.push(3000,-4500);queue.flush();
  assert.deepEqual(calls[0],{dx:2000,dy:-2000});
  queue.push(-250,450);queue.flush();finish();await tick();
  assert.deepEqual(calls[1],{dx:750,dy:-2000});
  finish();await tick();assert.deepEqual(calls[2],{dx:0,dy:-50});
  finish();await tick();
  assert.deepEqual(calls.reduce((sum,d)=>({dx:sum.dx+d.dx,dy:sum.dy+d.dy}),{dx:0,dy:0}),{dx:2750,dy:-4050});
  queue.dispose();
});
