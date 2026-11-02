const GIB = 1024 ** 3;
export const RENDER_MODES = Object.freeze(['auto', 'balanced', 'economy', 'quality']);
export function normalizeRenderMode(value) { return RENDER_MODES.includes(value) ? value : 'auto'; }
const profiles = {
  balanced: { label: '均衡', maxFps: 60, maxTextureSize: 3072, maxPixelRatio: 1.5, maxCanvasPixels: 2560 * 1440, antialias: false },
  economy: { label: '省资源', maxFps: 30, maxTextureSize: 2048, maxPixelRatio: 1, maxCanvasPixels: 1920 * 1080, antialias: false },
  quality: { label: '高清', maxFps: 60, maxTextureSize: 4096, maxPixelRatio: 2, maxCanvasPixels: 3840 * 2160, antialias: true },
};
export function resolveRenderQuality(value = 'auto', totalMemoryBytes = 0) {
  const mode = normalizeRenderMode(value);
  const effective = mode === 'auto'
    ? (Number.isFinite(totalMemoryBytes) && totalMemoryBytes > 20 * GIB ? 'quality' : 'balanced')
    : mode;
  return { mode, effective, ...profiles[effective] };
}
