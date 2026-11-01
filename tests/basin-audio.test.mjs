import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers/import-typescript.mjs';
const { BasinSound } = await importTypeScript(new URL('../src/renderer/basin-audio.ts', import.meta.url));

function audioFixture(t, suspended = false) {
  const previous = globalThis.AudioContext;
  const sources = [], decoded = [], buffers = []; let context, resume, constructions = 0, resumes = 0;
  const parameter = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } });
  globalThis.AudioContext = class {
    constructor(options) { context = this; constructions++; this.options = options; this.sampleRate = 22050; this.currentTime = 0; this.state = suspended ? 'suspended' : 'running'; this.destination = {}; }
    createBuffer() { const buffer = { copyToChannel() {} }; buffers.push(buffer); return buffer; }
    async decodeAudioData(bytes) {
      const channels = [new Float32Array([-.9, .4, .7]), new Float32Array([.2, -.3, .6])];
      const buffer = { duration: 3.17, numberOfChannels: 2, bytes, getChannelData: index => channels[index] };
      decoded.push(buffer); return buffer;
    }
    createDynamicsCompressor() { return { threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(), connect() {}, disconnect() {} }; }
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
    createBufferSource() {
      const source = { connected: false, started: false, stops: [], connect() { this.connected = true; }, disconnect() { this.connected = false; }, start() { this.started = true; }, stop(at = 0) { this.stops.push(at); } };
      sources.push(source); return source;
    }
    resume() { resumes++; return new Promise(resolve => { resume = () => { this.state = 'running'; resolve(); }; }); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  };
  t.after(() => { globalThis.AudioContext = previous; });
  return { sources, decoded, buffers, resume: () => resume(), get context() { return context; }, get constructions() { return constructions; }, get resumes() { return resumes; } };
}

function fetchFixture(t, handler = async () => new Response(new Uint8Array([0x49, 0x44, 0x33]))) {
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = (url, options) => { requests.push({ url, options }); return handler(url, options); };
  t.after(() => { globalThis.fetch = previous; }); return requests;
}

test('preparing the enabled prop moves device construction and synthesis off the first strike', async t => {
  const fixture = audioFixture(t); let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const Context = globalThis.AudioContext;
  globalThis.AudioContext = class extends Context {
    constructor(options) { super(options); clock += 250; }
    createBuffer(...args) { clock += 20; return super.createBuffer(...args); }
  };
  const sound = new BasinSound();
  await sound.prepare();
  assert.equal(fixture.constructions, 1);
  assert.equal(fixture.buffers.length, 1);
  assert.equal(fixture.context.options.latencyHint, 'interactive');
  assert.equal(fixture.sources.length, 0, 'preparation itself must stay silent');
  const ready = clock;
  await sound.play();
  assert.equal(clock, ready, 'the prepared first strike does no device construction or synthesis');
  assert.equal(fixture.sources.length, 1);
  sound.stop(); await sound.prepare(); await sound.play();
  assert.equal(fixture.constructions, 1, 'hiding and re-enabling reuse the audio device');
  assert.equal(fixture.buffers.length, 1);
  sound.destroy();
});

test('preparation respects mute and leaves suspended devices asleep until an actual strike', async t => {
  const fixture = audioFixture(t, true), sound = new BasinSound();
  sound.setVolume(0); await sound.prepare();
  assert.equal(fixture.context, undefined);
  sound.setVolume(.55); await sound.prepare();
  assert.equal(fixture.context.state, 'suspended');
  assert.equal(fixture.resumes, 0);
  assert.equal(fixture.sources.length, 0);
  const pending = sound.play();
  assert.equal(fixture.resumes, 1);
  fixture.resume(); await pending;
  assert.equal(fixture.sources.length, 1);
  sound.destroy(); await sound.prepare();
  assert.equal(fixture.constructions, 1, 'destroyed preparation cannot reopen a device');
});

test('pipe preparation and switching on a prepared device decode before the next strike', async t => {
  const fixture = audioFixture(t), requests = fetchFixture(t), sound = new BasinSound();
  sound.setSound('pipe');
  assert.equal(fixture.context, undefined, 'sound selection alone remains device-free');
  await sound.prepare();
  assert.equal(fixture.decoded.length, 1);
  assert.equal(fixture.sources.length, 0);
  await sound.play();
  assert.equal(fixture.sources[0].buffer, fixture.decoded[0]);
  sound.setSound('basin');
  assert.equal(fixture.buffers.length, 1, 'the other sound is prepared during selection');
  sound.setSound('pipe'); await sound.prepare();
  assert.equal(fixture.decoded.length, 1);
  assert.equal(requests.length, 1);
  sound.destroy();

  const second = new BasinSound();
  await second.prepare(); second.setSound('pipe');
  await second.pipeLoading;
  assert.equal(fixture.decoded.length, 2, 'an existing prepared device decodes newly selected pipe audio immediately');
  const count = fixture.decoded.length;
  await second.play(); assert.equal(fixture.decoded.length, count);
  second.destroy();
});

test('rapid clicks have bounded sound polyphony and stop removes every active/fading voice', async t => {
  const { sources } = audioFixture(t);
  const sound = new BasinSound();
  for (let i = 0; i < 100; i++) {
    await sound.play();
    assert.ok(sources.filter(s => s.connected).length <= 8, 'four ringing taps plus at most four short crossfades');
  }
  assert.equal(sources.filter(s => s.started).length, 100);
  sound.stop();
  assert.equal(sources.filter(s => s.connected).length, 0);
  assert.ok(sources.every(s => s.stops.length > 0));
  sound.destroy(); await sound.play();
  assert.equal(sources.length, 100);
});

test('stop during audio-device resume does not emit a stale strike', async t => {
  const fixture = audioFixture(t, true), sound = new BasinSound();
  const pending = sound.play();
  sound.stop(); fixture.resume(); await pending;
  assert.equal(fixture.sources.length, 0);
  await sound.play(); assert.equal(fixture.sources.length, 1);
  sound.destroy(); assert.equal(fixture.context.state, 'closed');
});

test('volume updates ringing tails, mute skips new audio, and settings stay bounded', async t => {
  const fixture = audioFixture(t), sound = new BasinSound();
  sound.setVolume(0); await sound.play();
  assert.equal(fixture.context, undefined, 'silent taps should not open an audio device');
  sound.setVolume(.3); await sound.play();
  assert.ok(Math.abs(sound.output.gain.value - .3 / .55) < 1e-6);
  sound.setVolume(0);
  assert.equal(sound.output.gain.value, 0, 'mute also silences the existing ringing tail');
  await sound.play(); assert.equal(fixture.sources.length, 1);
  sound.setVolume(10); assert.equal(sound.volume, 1);
  sound.setVolume(NaN); assert.equal(sound.volume, 1);
  sound.setVolume(-1); assert.equal(sound.volume, 0);
  sound.destroy();
});

test('muting then unmuting during device resume discards the old pending tap', async t => {
  const fixture = audioFixture(t, true), sound = new BasinSound();
  const pending = sound.play();
  sound.setVolume(0); sound.setVolume(.55);
  fixture.resume(); await pending;
  assert.equal(fixture.sources.length, 0);
  await sound.play(); assert.equal(fixture.sources.length, 1);
  sound.destroy();
});

test('switching sound ends ringing voices, reuses one decoded local clip, and preserves its voice cap', async t => {
  const fixture = audioFixture(t), requests = fetchFixture(t), sound = new BasinSound();
  await sound.play(); const basin = fixture.sources[0].buffer;
  sound.setSound('pipe');
  assert.equal(fixture.sources[0].connected, false, 'switching immediately stops the basin tail');
  await sound.play(); const pipe = fixture.sources[1].buffer;
  assert.notEqual(pipe, basin); assert.equal(pipe.duration, 3.17);
  assert.ok(Math.abs(Math.max(...pipe.getChannelData(0).map(Math.abs)) - .55) < 1e-6, 'pipe uses the same peak headroom');
  for (let i = 0; i < 40; i++) {
    await sound.play(); assert.ok(fixture.sources.filter(s => s.connected).length <= 8);
  }
  assert.equal(requests.length, 1); assert.equal(requests[0].url, './audio/metal-pipe-falling.mp3');
  assert.equal(fixture.decoded.length, 1, 'repeated taps share a decoded buffer');
  sound.setSound('basin'); assert.equal(fixture.sources.filter(s => s.connected).length, 0);
  await sound.play(); assert.equal(fixture.sources.at(-1).buffer, basin);
  sound.stop(); assert.equal(fixture.sources.filter(s => s.connected).length, 0); sound.destroy();
});

test('switching during a pipe load discards the old strike, including when switching back', async t => {
  const fixture = audioFixture(t); let resolve;
  fetchFixture(t, () => new Promise(done => { resolve = done; }));
  const sound = new BasinSound(); sound.setSound('pipe'); const pending = sound.play();
  sound.setSound('basin'); sound.setSound('pipe');
  resolve(new Response(new Uint8Array([0x49, 0x44, 0x33]))); await pending;
  assert.equal(fixture.sources.length, 0, 'an old same-sound load must not survive a round-trip switch');
  await sound.play(); assert.equal(fixture.sources.length, 1); sound.destroy();
});

test('pipe preload is silent, errors reject playback, and a later click can retry', async t => {
  const fixture = audioFixture(t); let failing = true;
  const requests = fetchFixture(t, async () => new Response(new Uint8Array([1, 2, 3]), { status: failing ? 404 : 200 }));
  const sound = new BasinSound(); sound.setVolume(0); sound.setSound('pipe');
  await sound.play(); assert.equal(fixture.context, undefined);
  sound.setVolume(.4); await assert.rejects(sound.play(), /钢管音效加载失败/);
  assert.equal(fixture.sources.length, 0);
  failing = false; await sound.play(); assert.equal(fixture.sources.length, 1);
  assert.ok(requests.length >= 2); sound.destroy();
});

test('switching sound while the audio device wakes cannot replay an obsolete strike', async t => {
  const fixture = audioFixture(t, true); fetchFixture(t);
  const sound = new BasinSound(), pending = sound.play();
  sound.setSound('pipe'); fixture.resume(); await pending;
  assert.equal(fixture.sources.length, 0);
  await sound.play(); assert.equal(fixture.sources.length, 1); sound.destroy();
});

test('a slow synchronous first AudioContext constructor does not discard the first click', async t => {
  const fixture = audioFixture(t); let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const Context = globalThis.AudioContext;
  globalThis.AudioContext = class extends Context { constructor() { super(); clock += 250; } };
  const sound = new BasinSound(); await sound.play();
  assert.equal(fixture.sources.length, 1); assert.equal(fixture.sources[0].started, true);
  sound.destroy();
});

test('a genuinely late asynchronous device resume still discards the pending click', async t => {
  const fixture = audioFixture(t, true); let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const sound = new BasinSound(), pending = sound.play();
  clock += 220; fixture.resume(); await pending;
  assert.equal(fixture.sources.length, 0, 'the 180ms async deadline remains enforced');
  await sound.play(); assert.equal(fixture.sources.length, 1); sound.destroy();
});
