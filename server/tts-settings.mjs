export const TTS_PROVIDERS = ['edge', 'system', 'api'];

// API voice and Windows voice are retained when switching providers.
export const DEFAULT_TTS = {
  provider: 'edge', enabled: false,
  baseUrl: '', apiKey: '', model: '', voice: 'alloy', systemVoice: '',
};

export function getTtsProvider(tts = {}) {
  if (TTS_PROVIDERS.includes(tts.provider)) return tts.provider;
  // Migrate an existing configured API or explicitly selected offline voice.
  if (tts.enabled) return 'api';
  if (tts.systemVoice) return 'system';
  return 'edge';
}
