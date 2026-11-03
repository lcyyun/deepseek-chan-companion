import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderClock, createRenderDiagnostics, readGraphicsInfo, pngDimensions, renderCanvasSize, textureDecodeSize } from '../src/shared/render-performance.mjs';

test('60-fps pacing remains near 60 on 60/75/120/144/165/240-Hz displays', () => {
  for (const refreshRate of [60, 75, 120, 144, 165, 240]) {
    const clock = createRenderClock(60), steps = [];
    for (let frame = 0; frame <= refreshRate * 10; frame++) {
      const dt = clock.advance(frame * 1000 / refreshRate);
      if (dt !== null) steps.push(dt);
    }
    assert.equal(steps.length, 601, `refresh=${refreshRate}`);
    assert.ok(Math.abs(steps.slice(1).reduce((sum, dt) => sum + dt, 0) - 10) < 1e-8);
    assert.ok(Math.max(...steps) <= 1 / 60 + 1 / refreshRate + 1e-8);
  }
});

test('quantized and jittered display ticks retain the requested cadence and actual elapsed time', () => {
  for (const fps of [30,60]) for (const refreshRate of [60,75,120,144,165,240]) {
    for (const quantum of [.1,1]) for (const jitter of [0,.3]) {
      const clock=createRenderClock(fps), rendered=[], steps=[];
      for(let frame=0;frame<=refreshRate*10;frame++) {
        const noise=jitter*Math.sin(frame*1.73);
        const time=Math.max(0,Math.floor((frame*1000/refreshRate+noise)/quantum)*quantum);
        const dt=clock.advance(time);
        if(dt!==null){rendered.push(time);steps.push(dt);}
      }
      const label=`target=${fps}, refresh=${refreshRate}, quantum=${quantum}, jitter=${jitter}`;
      assert.ok(Math.abs(rendered.length-(fps*10+1))<=1,label+`: frames=${rendered.length}`);
      const sum=steps.slice(1).reduce((a,b)=>a+b,0);
      assert.ok(Math.abs(sum-(rendered.at(-1)-rendered[0])/1000)<1e-8,label+': actual dt');
      const intervals=rendered.slice(1).map((time,index)=>time-rendered[index]);
      assert.ok(Math.min(...intervals)>=500/fps-1e-7,label+': no catch-up burst');
      assert.ok(Math.max(...intervals)<=1000/fps+1000/refreshRate+2,label+': no extra missed display tick');
    }
  }
});

test('slightly early or late frames cannot trigger an immediate second catch-up frame', () => {
  const clock=createRenderClock(60);
  assert.equal(clock.advance(0),1/60);
  assert.ok(Math.abs(clock.advance(32.3)-.0323)<1e-10);
  assert.equal(clock.advance(33.4),null);
  assert.equal(clock.advance(34),null);
  assert.ok(Math.abs(clock.advance(50)-.0177)<1e-10);
  assert.equal(clock.advance(50),null);
  assert.equal(clock.advance(NaN),null);assert.equal(clock.advance(Infinity),null);
  assert.ok(Math.abs(clock.advance(1000)-.95)<1e-10);
  assert.equal(clock.advance(1001),null);
  assert.ok(Math.abs(clock.advance(1016.6)-.0166)<1e-10);
});

test('clock rollback after a skipped callback and reset both establish a fresh baseline', () => {
  const clock=createRenderClock(60);
  clock.advance(100);assert.equal(clock.advance(108),null);
  assert.equal(clock.advance(105),1/60,'rollback is observed even if the last callback was skipped');
  assert.equal(clock.advance(106),null);
  clock.reset();assert.equal(clock.advance(50000),1/60);
  assert.equal(clock.advance(50000.1),null);
  assert.ok(Math.abs(clock.advance(50016.6)-.0166)<1e-10);
});

test('render clock skips missed deadlines without a burst or cumulative drift', () => {
  const clock = createRenderClock();
  assert.equal(clock.advance(0), 1 / 60);
  assert.equal(clock.advance(7), null);
  assert.equal(clock.advance(250), .25);
  assert.equal(clock.advance(251), null);
  assert.equal(clock.advance(260), null);
  assert.ok(Math.abs(clock.advance(267) - .017) < 1e-9);
  assert.equal(clock.advance(268), null);
});

test('pause/resume resets the time base so hidden time never becomes a physics step', () => {
  const clock = createRenderClock();
  clock.advance(1000); clock.advance(1020);
  clock.reset();
  assert.equal(clock.advance(60000), 1 / 60);
  assert.equal(clock.advance(60001), null);
  assert.ok(Math.abs(clock.advance(60020) - .02) < 1e-9);
  assert.equal(clock.advance(12), 1 / 60, 'a backwards clock starts a new time base');
});

test('canvas DPR and area budgets bound high-resolution and scaled desktops', () => {
  assert.deepEqual(renderCanvasSize(1708, 1020, 1.5, { maxPixelRatio: 1.5, maxCanvasPixels: 2560 * 1440 }),
    { width: 2484, height: 1483, ratio: Math.sqrt((2560 * 1440) / (1708 * 1020)) });
  for (const [width, height, dpr] of [[3840,2160,2], [2560,1440,1.5], [1080,1920,2], [8192,32,2], [1,1000000,2]]) {
    const size = renderCanvasSize(width,height,dpr,{maxPixelRatio:1.5,maxCanvasPixels:2560*1440});
    assert.ok(size.width >= 1 && size.height >= 1);
    assert.ok(size.width * size.height <= 2560 * 1440);
    assert.ok(size.width <= width * 1.5 && size.height <= height * 1.5);
  }
  assert.deepEqual(renderCanvasSize(100,50,2,{maxPixelRatio:1}), {width:100,height:50,ratio:1});
  assert.equal(renderCanvasSize(100,100,2,{maxCanvasPixels:1}).width * renderCanvasSize(100,100,2,{maxCanvasPixels:1}).height,1);
});

test('texture fitting keeps aspect ratio, does not upscale, and reduces the real atlas budget', () => {
  assert.deepEqual(textureDecodeSize(4096,8192,3072), {width:1536,height:3072});
  assert.deepEqual(textureDecodeSize(2048,2048,3072), {width:2048,height:2048});
  const textures = [[4096,8192],[4096,8192],[2048,2048],[8192,8192],[4096,4096]];
  const bytes = limit => textures.reduce((sum,[w,h])=>{ const d=textureDecodeSize(w,h,limit);return sum+d.width*d.height*4; },0);
  assert.equal(bytes(4096),208*1024*1024);
  assert.equal(bytes(3072),124*1024*1024);
  assert.equal(bytes(2048),64*1024*1024);
  assert.throws(()=>textureDecodeSize(0,8192,2048),RangeError);
});

test('PNG header parsing handles typed-array offsets and rejects non-PNG or invalid dimensions', () => {
  const outer = new Uint8Array(32), bytes = outer.subarray(4,28);
  bytes.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  view.setUint32(8,13);view.setUint32(12,0x49484452);view.setUint32(16,8192);view.setUint32(20,4096);
  assert.deepEqual(pngDimensions(bytes),{width:8192,height:4096});
  assert.deepEqual(pngDimensions(bytes.slice().buffer),{width:8192,height:4096});
  assert.equal(pngDimensions(bytes.subarray(0,20)),null);
  assert.equal(pngDimensions(new Uint8Array(24)),null);
  view.setUint32(16,0);assert.equal(pngDimensions(bytes),null);
  view.setUint32(16,8192);view.setUint32(12,0);assert.equal(pngDimensions(bytes),null);
});

test('render diagnostics retain only the latest bounded samples and calculate p95 on snapshots', () => {
  const diagnostics = createRenderDiagnostics(4);
  for (let i = 0; i < 8; i++) diagnostics.record(i * 20, i + 1, .02);
  const result = diagnostics.snapshot();
  assert.equal(result.recentSamples, 4);
  assert.equal(result.recentFps, 50);
  assert.equal(result.frameIntervalP95Ms, 20);
  assert.equal(result.renderP95Ms, 8);
  assert.equal(result.wallElapsedMs, 140);
  assert.ok(Math.abs(result.logicElapsedSeconds - .16) < 1e-9);
  const bounded = createRenderDiagnostics(999);
  for (let i = 0; i < 1000; i++) bounded.record(i * 10, i < 880 ? 300 : 2, .01);
  assert.equal(bounded.snapshot().recentSamples, 120);
  assert.equal(bounded.snapshot().renderP95Ms, 2, 'old slow renders have left the rolling window');
});

test('render diagnostics distinguish real long intervals from capped simulation time', () => {
  const diagnostics = createRenderDiagnostics();
  diagnostics.record(0, 12, 1/60);
  diagnostics.record(250, 13, .05);
  const result = diagnostics.snapshot();
  assert.equal(result.frameIntervalP95Ms, 250);
  assert.equal(result.frameIntervalMaxMs, 250);
  assert.equal(result.longFrames, 1);
  assert.equal(result.recentFps, 4);
  assert.equal(result.wallElapsedMs, 250);
  assert.ok(Math.abs(result.logicElapsedSeconds - (1/60+.05)) < 1e-9);
});

test('render diagnostics use about two active seconds even after falling to low fps', () => {
  const diagnostics = createRenderDiagnostics();
  for (let i = 0; i < 120; i++) diagnostics.record(i * 16, 200, .016);
  for (let i = 1; i <= 12; i++) diagnostics.record(119 * 16 + i * 250, 2, .05);
  const low = diagnostics.snapshot();
  assert.equal(low.windowMs, 2000);
  assert.equal(low.recentSamples, 8);
  assert.equal(low.recentFps, 4);
  assert.equal(low.frameIntervalP95Ms, 250);
  assert.equal(low.renderP95Ms, 2, 'old render costs do not dilute the new low-fps window');
  diagnostics.record(119 * 16 + 12 * 250 + 2500, 100, .05);
  assert.equal(diagnostics.snapshot().windowMs, 2500);
  assert.equal(diagnostics.snapshot().frameIntervalP95Ms, 2500, 'one large interval is not discarded by the window');
  assert.equal(diagnostics.snapshot().recentSamples, 1);
});

test('render diagnostics ignore invalid input and exclude hidden time after reset', () => {
  const diagnostics = createRenderDiagnostics();
  diagnostics.record(1000, 5, .02); diagnostics.record(1050, 6, .05);
  const before = diagnostics.snapshot();
  for (const args of [[NaN,1,.01],[Infinity,1,.01],[1100,NaN,.01],[1100,-1,.01],[1100,1,Infinity],[1100,1,-1]]) {
    assert.equal(diagnostics.record(...args), false);
  }
  assert.deepEqual(diagnostics.snapshot(), before);
  diagnostics.resetTiming();
  assert.equal(diagnostics.snapshot().recentSamples, 0);
  assert.equal(diagnostics.snapshot().recentFps, 0);
  diagnostics.record(61000, 4, 1/60); diagnostics.record(61020, 4, .02);
  assert.equal(diagnostics.snapshot().longFrames, 1);
  assert.equal(diagnostics.snapshot().wallElapsedMs, 70);
  assert.equal(diagnostics.snapshot().frameIntervalP95Ms, 20);
  diagnostics.record(10, 3, 1/60);
  assert.equal(diagnostics.snapshot().frameIntervalMaxMs, 0, 'backwards time starts a new interval baseline');
  assert.equal(diagnostics.snapshot().longFrames, 1);
});

test('graphics diagnostics prefer the active unmasked backend and safely fall back', () => {
  const fake = (extension, values) => ({ VENDOR: 1, RENDERER: 2, getExtension: () => extension, getParameter: key => values[key] });
  assert.deepEqual(readGraphicsInfo(fake({UNMASKED_VENDOR_WEBGL:3,UNMASKED_RENDERER_WEBGL:4}, {1:'WebKit',2:'WebGL',3:'NVIDIA',4:'ANGLE RTX 4060'})),
    {gpuVendor:'NVIDIA',gpuRenderer:'ANGLE RTX 4060',gpuInfoSource:'unmasked'});
  assert.deepEqual(readGraphicsInfo(fake(null,{1:'WebKit',2:'WebKit WebGL'})),
    {gpuVendor:'WebKit',gpuRenderer:'WebKit WebGL',gpuInfoSource:'standard'});
  assert.deepEqual(readGraphicsInfo({getExtension(){throw Error('blocked');},getParameter(){throw Error('lost');}}),
    {gpuVendor:'',gpuRenderer:'',gpuInfoSource:'unavailable'});
  assert.equal(readGraphicsInfo(fake(null,{1:42,2:undefined})).gpuInfoSource,'unavailable');
  assert.equal(readGraphicsInfo(fake(null,{1:'\nVendor\0',2:'x'.repeat(1000)})).gpuRenderer.length,512);
});
