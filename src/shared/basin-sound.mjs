/** Original modal synthesis for the pet's metal-basin tap, generated locally. */
export function synthesizeBasinTap(sampleRate = 44100) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Unsupported audio sample rate');
  const samples = new Float32Array(Math.round(sampleRate * 1.15));
  // Inharmonic modes and slightly detuned pairs give a hollow metal ring rather
  // than a pitched notification beep. The upper modes decay more quickly.
  const modes = [[286, .32, .42], [443, .24, .32], [618, .21, .27], [951, .18, .22], [1273, .13, .17], [1789, .09, .13], [2471, .045, .09]];
  let seed = 0x36a12f, previousNoise = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, attack = 1 - Math.exp(-t / .0008);
    let value = 0;
    for (const [frequency, amplitude, decay] of modes) {
      value += amplitude * Math.exp(-t / decay) * (Math.sin(2 * Math.PI * frequency * t) + .23 * Math.sin(2 * Math.PI * frequency * 1.008 * t));
    }
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    value += .2 * (noise - previousNoise) * Math.exp(-t / .009);
    previousNoise = noise;
    const tail = Math.min(1, Math.max(0, (1.15 - t) / .12)) ** 2;
    samples[i] = value * attack * tail;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const gain = peak > 0 ? .55 / peak : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}
