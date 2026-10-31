import { synthesizeBasinTap } from '../shared/basin-sound.mjs';

/** Separate from speech: a local prop sound must never drive the speaking mouth. */
export class BasinSound {
  private context?: AudioContext;
  private buffer?: AudioBuffer;
  private pipeBuffer?: AudioBuffer;
  private pipeBytes?: Promise<ArrayBuffer>;
  private pipeLoading?: Promise<AudioBuffer>;
  private fetchController?: AbortController;
  private sound: 'basin' | 'pipe' = 'basin';
  private compressor?: DynamicsCompressorNode;
  private output?: GainNode;
  private volume = 0.55;
  private voices: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private retiring: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private generation = 0;
  private destroyed = false;

  setSound(value: 'basin' | 'pipe') {
    if (this.destroyed || (value !== 'basin' && value !== 'pipe') || value === this.sound) return;
    this.stop(); this.sound = value;
    // Preload only bytes. Choosing a sound, especially while muted, must not
    // open an audio device; errors are reported by the next actual play call.
    if (value === 'pipe') void this.loadPipeBytes().catch(() => {});
  }

  private loadPipeBytes(): Promise<ArrayBuffer> {
    if (!this.pipeBytes) {
      const controller = new AbortController(); this.fetchController = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      const pending = fetch('./audio/metal-pipe-falling.mp3', { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error(`钢管音效加载失败 (${response.status})`);
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) throw new Error('钢管音效文件大小无效');
        return bytes;
      }).finally(() => { clearTimeout(timeout); if (this.fetchController === controller) this.fetchController = undefined; });
      this.pipeBytes = pending;
      void pending.catch(() => { if (this.pipeBytes === pending) this.pipeBytes = undefined; });
    }
    return this.pipeBytes;
  }

  private async loadPipe(context: AudioContext): Promise<AudioBuffer> {
    if (this.pipeBuffer) return this.pipeBuffer;
    if (!this.pipeLoading) {
      const pending = this.loadPipeBytes().then(bytes => context.decodeAudioData(bytes.slice(0))).then(decoded => {
        if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 10) throw new Error('钢管音效时长无效');
        // Keep the original clip, but normalize its decoded peak to the same
        // headroom as our basin synthesis before the shared compressor/volume.
        let peak = 0;
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) for (const value of decoded.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
        if (peak > 0) for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const samples = decoded.getChannelData(channel); for (let i = 0; i < samples.length; i++) samples[i] *= .55 / peak;
        }
        if (!this.destroyed) this.pipeBuffer = decoded;
        return decoded;
      });
      this.pipeLoading = pending;
      void pending.finally(() => { if (this.pipeLoading === pending) this.pipeLoading = undefined; }).catch(() => {});
    }
    return this.pipeLoading;
  }

  setVolume(value: number) {
    if (!Number.isFinite(value) || this.destroyed) return;
    this.volume = Math.max(0, Math.min(1, value));
    // Muting also invalidates a tap still waiting for the audio device to wake.
    if (this.volume === 0) this.generation++;
    if (this.output && this.context) {
      const now = this.context.currentTime;
      this.output.gain.cancelScheduledValues(now);
      this.output.gain.setValueAtTime(this.output.gain.value, now);
      this.output.gain.linearRampToValueAtTime(this.volume / 0.55, now + .015);
    }
  }

  async play() {
    if (this.destroyed || this.volume === 0) return;
    const generation = this.generation, sound = this.sound;
    this.context ||= new AudioContext();
    const context = this.context;
    // Windows may synchronously spend ~200ms constructing its first running
    // context. That is not a queued click: start the stale-playback clock after
    // construction, while retaining the strict limit on async decode/resume.
    const requested = performance.now();
    if (sound === 'basin' && !this.buffer) {
      const samples = synthesizeBasinTap(context.sampleRate);
      this.buffer = context.createBuffer(1, samples.length, context.sampleRate);
      this.buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    }
    if (!this.compressor) {
      this.compressor = context.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = .002;
      this.compressor.release.value = .12;
      this.output = context.createGain();
      this.output.gain.value = this.volume / 0.55;
      this.compressor.connect(this.output);
      this.output.connect(context.destination);
    }
    let buffer: AudioBuffer;
    try {
      [buffer] = await Promise.all([sound === 'pipe' ? this.loadPipe(context) : Promise.resolve(this.buffer!), context.state !== 'running' ? context.resume() : Promise.resolve()]);
    } catch (error) {
      if (this.destroyed || generation !== this.generation) return;
      throw error;
    }
    // A delayed audio permission/device resume must not replay stale clicks.
    if (this.destroyed || this.volume === 0 || generation !== this.generation || performance.now() - requested > 180) return;
    const now = context.currentTime;
    while (this.voices.length >= 4) {
      const oldest = this.voices.shift()!;
      // A bounded set of 12ms crossfades; even synthetic click storms cannot
      // create an unlimited number of simultaneously connected audio nodes.
      if (this.retiring.length >= 4) {
        const retired = this.retiring.shift()!;
        try { retired.source.stop(); } catch {}
        retired.source.disconnect(); retired.gain.disconnect();
      }
      this.retiring.push(oldest);
      oldest.gain.gain.cancelScheduledValues(now);
      oldest.gain.gain.setValueAtTime(oldest.gain.gain.value, now);
      oldest.gain.gain.linearRampToValueAtTime(0, now + .012);
      oldest.source.stop(now + .015);
    }
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = .55;
    source.connect(gain); gain.connect(this.compressor!);
    const voice = { source, gain };
    this.voices.push(voice);
    source.onended = () => {
      const i = this.voices.indexOf(voice); if (i >= 0) this.voices.splice(i, 1);
      const retired = this.retiring.indexOf(voice); if (retired >= 0) this.retiring.splice(retired, 1);
      source.disconnect(); gain.disconnect();
    };
    source.start(now);
  }

  stop() {
    this.generation++;
    for (const { source, gain } of [...this.voices.splice(0), ...this.retiring.splice(0)]) {
      try { source.stop(); } catch { /* A completed source is already silent. */ }
      source.disconnect(); gain.disconnect();
    }
  }

  destroy() {
    this.destroyed = true;
    this.stop(); this.fetchController?.abort(); this.pipeBuffer = undefined; this.pipeBytes = undefined;
    this.compressor?.disconnect(); this.output?.disconnect(); void this.context?.close();
  }
}
