export const EXPRESSION_TUNING_LIMITS = Object.freeze({
  intensity: Object.freeze({ min: 0, max: 1.5, default: 1 }),
  smile: Object.freeze({ min: -0.4, max: 0.4, default: 0 }),
  eyeOpen: Object.freeze({ min: -0.25, max: 0.25, default: 0 }),
  brow: Object.freeze({ min: -0.35, max: 0.35, default: 0 }),
  mouthOpen: Object.freeze({ min: -0.2, max: 0.3, default: 0 }),
  blush: Object.freeze({ min: -0.4, max: 0.4, default: 0 }),
});
export const DEFAULT_EXPRESSION_TUNING = Object.freeze(Object.fromEntries(
  Object.entries(EXPRESSION_TUNING_LIMITS).map(([key, range]) => [key, range.default]),
));
export function sanitizeExpressionTuning(input, fallback = DEFAULT_EXPRESSION_TUNING) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  return Object.fromEntries(Object.entries(EXPRESSION_TUNING_LIMITS).map(([key, range]) => {
    const value = Number.isFinite(source[key]) ? source[key] : Number.isFinite(base[key]) ? base[key] : range.default;
    return [key, Math.round(Math.max(range.min, Math.min(range.max, value)) * 1000) / 1000];
  }));
}
