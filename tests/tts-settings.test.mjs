import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore } from '../server/settings.mjs';
import { generateSpeech } from '../server/adapters.mjs';

async function fixture(t, saved) {
  const dataDir = await mkdtemp(join(tmpdir(), 'companion-tts-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  if (saved) await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ settings: saved }));
  const options = { dataDir, encrypt: async value => Buffer.from(value), decrypt: async value => value.toString() };
  return { options, store: await createSettingsStore(options) };
}

test('fresh and uncustomized legacy profiles use Xiaoyi; configured voices survive migration', async t => {
  for (const [saved, expected] of [
    [undefined, 'edge'], [{ tts: { enabled: false } }, 'edge'],
    [{ tts: { enabled: true, model: 'custom', voice: 'old' } }, 'api'],
    [{ tts: { enabled: false, systemVoice: 'Chinese offline' } }, 'system'],
    [{ tts: { provider: 'system', enabled: false } }, 'system'],
    [{ tts: { provider: 'edge', enabled: true } }, 'edge'],
  ]) {
    const { store } = await fixture(t, saved);
    assert.equal(store.get().tts.provider, expected);
    assert.equal(store.get().tts.enabled, expected === 'api');
  }
});

test('provider switching persists without losing custom API settings or credentials', async t => {
  const { store, options } = await fixture(t);
  await store.update({ tts: { provider: 'api', baseUrl: 'https://example.com/v1', model: 'tts-model', voice: 'custom-voice', apiKey: 'fixture-secret' } });
  const result = await store.update({ tts: { provider: 'edge' } });
  assert.equal(result.tts.provider, 'edge');
  assert.equal(result.tts.apiKey, undefined);
  assert.equal(result.hasTtsKey, true);
  const restarted = await createSettingsStore(options);
  assert.equal(restarted.get().tts.provider, 'edge');
  assert.equal(restarted.get().tts.apiKey, 'fixture-secret');
  await restarted.update({ tts: { provider: 'api' } });
  assert.equal(restarted.get().tts.model, 'tts-model');
  assert.equal(restarted.get().tts.voice, 'custom-voice');
  const disk = JSON.parse(await readFile(join(options.dataDir, 'settings.json'), 'utf8'));
  assert.equal(disk.settings.tts.apiKey, undefined);
});

test('legacy API toggles remain supported and explicit provider takes precedence', async t => {
  const { store } = await fixture(t);
  await store.update({ ttsEnabled: true });
  assert.equal(store.get().tts.provider, 'api');
  await store.update({ ttsEnabled: false });
  assert.equal(store.get().tts.provider, 'edge');
  await store.update({ tts: { provider: 'system', enabled: true } });
  assert.equal(store.get().tts.provider, 'system');
  assert.equal(store.get().tts.enabled, false);
  await assert.rejects(store.update({ tts: { provider: 'unknown' } }), /语音来源/);
  assert.equal(store.get().tts.provider, 'system');
});

test('default synthesis routes to Xiaoyi and keeps the real audio and cancellation signal', async () => {
  const signal = new AbortController().signal;
  const audio = { buffer: Buffer.from('fixture-mp3'), contentType: 'audio/mpeg' };
  const result = await generateSpeech({ settings: { tts: { enabled: false } }, text: '你好，我是大肥鱼。', signal,
    edgeSpeechImpl: async options => { assert.equal(options.text, '你好，我是大肥鱼。'); assert.equal(options.signal, signal); return audio; },
    systemSpeechImpl: () => assert.fail('Should not use offline voice'), fetchImpl: () => assert.fail('Should not use API') });
  assert.equal(result, audio);
});

test('explicit system and custom API route without making an Edge request', async () => {
  let usedSystem = false;
  await generateSpeech({ settings: { tts: { provider: 'system', systemVoice: 'offline' } }, text: '你好',
    edgeSpeechImpl: () => assert.fail('Unexpected cloud request'), systemSpeechImpl: async options => { usedSystem = true; assert.equal(options.voice, 'offline'); return {}; } });
  assert.equal(usedSystem, true);
  const result = await generateSpeech({ settings: { tts: { enabled: true, baseUrl: 'https://example.com', model: 'tts', voice: 'v' } }, text: '你好',
    edgeSpeechImpl: () => assert.fail('Unexpected Edge request'), fetchImpl: async (url, init) => {
      assert.equal(url, 'https://example.com/v1/audio/speech');
      assert.equal(JSON.parse(init.body).voice, 'v'); return new Response('test-mp3');
    } });
  assert.equal(result.contentType, 'audio/mpeg');
});

test('voice errors never fall back to another provider; cancelled/invalid input makes no request', async () => {
  let calls = 0;
  const args = { settings: {}, text: '你好', edgeSpeechImpl: async () => { calls++; throw new Error('network-fixture'); },
    systemSpeechImpl: () => assert.fail('No silent fallback'), fetchImpl: () => assert.fail('No silent fallback') };
  await assert.rejects(generateSpeech(args), /network-fixture/);
  await assert.rejects(generateSpeech({ ...args, signal: AbortSignal.abort() }), { code: 'CANCELLED' });
  await assert.rejects(generateSpeech({ ...args, text: '' }), { code: 'INVALID_TEXT' });
  assert.equal(calls, 1);
});
