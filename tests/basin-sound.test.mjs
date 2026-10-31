import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeBasinTap } from '../src/shared/basin-sound.mjs';

test('basin sound has a bounded strike, audible ringing tail and a quiet ending at device sample rates', () => {
  for (const rate of [22050, 44100, 48000, 96000]) {
    const sound = synthesizeBasinTap(rate);
    assert.equal(sound.length, Math.round(rate * 1.15));
    assert.ok(sound.every(Number.isFinite));
    assert.equal(sound[0], 0);
    let peak = 0; for (const value of sound) peak = Math.max(peak, Math.abs(value));
    assert.ok(peak <= .551 && peak >= .5, 'single strikes stay well below clipping');
    const rms = (start, end) => {
      const segment = sound.subarray(Math.round(start * rate), Math.round(end * rate));
      return Math.sqrt(segment.reduce((sum, value) => sum + value * value, 0) / segment.length);
    };
    assert.ok(rms(.02, .1) > rms(.3, .4) * 2);
    assert.ok(rms(.3, .4) > .01, 'a metal basin rings after the initial tap');
    assert.ok(rms(1.1, 1.15) < .002, 'the sound ends quietly without a cut');
  }
});
