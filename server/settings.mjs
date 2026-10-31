import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_SETTINGS = {
  provider: 'codex', baseUrl: 'https://api.deepseek.com', model: '', apiKey: '',
  codexCommand: 'codex', codexModel: '', webSearch: true, verbosity: 'brief', voiceEnabled: true,
  tts: { enabled: false, baseUrl: '', apiKey: '', model: '', voice: 'alloy', systemVoice: '' },
  watch: { enabled: false, ttlMs: 120000 },
};

export async function createSettingsStore({ dataDir, encrypt, decrypt }) {
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, 'settings.json');
  let settings = structuredClone(DEFAULT_SETTINGS);
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const secrets = {};
    if (decrypt && saved.encryptedSecrets) {
      try { Object.assign(secrets, JSON.parse(await decrypt(Buffer.from(saved.encryptedSecrets, 'base64')))); } catch { /* Keep configuration usable if this OS user cannot decrypt credentials. */ }
    }
    settings = { ...settings, ...saved.settings, apiKey: secrets.apiKey || '', tts: { ...settings.tts, ...saved.settings?.tts, apiKey: secrets.ttsKey || '' }, watch: { ...settings.watch, ...saved.settings?.watch, enabled: false } };
  } catch (err) { if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err; }
  settings.apiKey ||= process.env.L2D_API_KEY || '';
  settings.tts.apiKey ||= process.env.L2D_TTS_API_KEY || '';

  function publicSettings() {
    const { apiKey, ...rest } = settings;
    const { apiKey: ttsKey, ...tts } = rest.tts;
    return { ...rest, tts, hasApiKey: Boolean(apiKey), hasTtsKey: Boolean(ttsKey), secretsPersisted: Boolean(encrypt && decrypt) };
  }
  async function applyUpdate(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置格式错误。');
    const next = structuredClone(settings);
    for (const field of ['provider', 'baseUrl', 'model', 'codexCommand', 'codexModel', 'verbosity']) if (patch[field] !== undefined) next[field] = String(patch[field]).slice(0, 2000);
    if (!['api', 'codex', 'dsh'].includes(next.provider)) throw new Error('provider须为api、codex或dsh。');
    if (!['brief', 'balanced', 'detailed'].includes(next.verbosity)) throw new Error('回复长度设置无效。');
    if (patch.apiKey !== undefined) next.apiKey = String(patch.apiKey);
    if (patch.webSearch !== undefined) next.webSearch = Boolean(patch.webSearch);
    if (patch.voiceEnabled !== undefined) next.voiceEnabled = Boolean(patch.voiceEnabled);
    const tts = { ...(patch.tts || {}) };
    for (const [flat, nested] of Object.entries({ ttsBaseUrl: 'baseUrl', ttsKey: 'apiKey', ttsModel: 'model', ttsVoice: 'voice', ttsEnabled: 'enabled' })) if (patch[flat] !== undefined) tts[nested] = patch[flat];
    for (const key of ['baseUrl', 'apiKey', 'model', 'voice', 'systemVoice']) if (tts[key] !== undefined) next.tts[key] = String(tts[key]).slice(0, 8000);
    if (tts.enabled !== undefined) next.tts.enabled = Boolean(tts.enabled);
    if (patch.watch?.ttlMs !== undefined) next.watch.ttlMs = Math.max(10000, Math.min(600000, Number(patch.watch.ttlMs) || 120000));
    if (patch.watch?.enabled !== undefined) next.watch.enabled = Boolean(patch.watch.enabled);
    for (const urlValue of [next.baseUrl, next.tts.baseUrl]) if (urlValue) {
      const parsed = new URL(urlValue);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('API地址必须是无用户名密码的HTTP(S)地址。');
    }
    const { apiKey, ...safe } = next;
    const { apiKey: ttsKey, ...ttsSafe } = safe.tts;
    const saved = { version: 1, settings: { ...safe, tts: ttsSafe, watch: { ...safe.watch, enabled: false } } };
    if (encrypt && decrypt) {
      const encrypted = await encrypt(JSON.stringify({ apiKey, ttsKey }));
      saved.encryptedSecrets = Buffer.isBuffer(encrypted) ? encrypted.toString('base64') : String(encrypted);
    }
    await writeFile(`${file}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    settings = next;
    return publicSettings();
  }
  let writeQueue = Promise.resolve();
  function update(patch) { const result = writeQueue.then(() => applyUpdate(patch)); writeQueue = result.catch(() => {}); return result; }
  return { get: () => structuredClone(settings), public: publicSettings, update };
}
