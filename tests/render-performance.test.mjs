import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderClock, pngDimensions, renderCanvasSize, textureDecodeSize } from '../src/shared/render-performance.mjs';

test('60-fps pacing remains near 60 on 60/75/120/144/240-Hz displays', () => {
  for (const refreshRate of [60, 75, 120, 144, 240]) {
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
