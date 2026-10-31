import { EXPRESSION_IDS } from './expressions.mjs';
import { sanitizeExpressionTuning } from './expression-tuning.mjs';
/** User-facing model controls, shared by the desktop store and both renderers. */
export const MODEL_TUNING_LIMITS = Object.freeze({
  chestSoftness: Object.freeze({ min: 0, max: 2, default: 1.15 }),
  bodyMotion: Object.freeze({ min: 0, max: 1.6, default: 1 }),
  gazeStrength: Object.freeze({ min: 0.3, max: 1.5, default: 1 }),
  blushStrength: Object.freeze({ min: 0, max: 1, default: 0.75 }),
  basinShadow: Object.freeze({ min: 0, max: 1, default: 0.35 }),
  knockVolume: Object.freeze({ min: 0, max: 1, default: 0.55 }),
  expressionIntensity: Object.freeze({ min: 0, max: 1.5, default: 1 }),
});
export const DEFAULT_MODEL_TUNING = Object.freeze({ ...Object.fromEntries(
  Object.entries(MODEL_TUNING_LIMITS).map(([key, range]) => [key, range.default]),
), knockSound: 'basin', expressionOverrides: Object.freeze({}) });

function mergeOverrides(input, fallback) {
  const result = {};
  for (const id of EXPRESSION_IDS) if (fallback?.[id] && typeof fallback[id] === 'object') result[id] = sanitizeExpressionTuning(fallback[id]);
  if (input === null || input && typeof input === 'object' && !Array.isArray(input) && !Object.keys(input).length) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const id of EXPRESSION_IDS) {
    if (!Object.hasOwn(input, id)) continue;
    if (input[id] === null) delete result[id];
    else if (input[id] && typeof input[id] === 'object' && !Array.isArray(input[id])) result[id] = sanitizeExpressionTuning(input[id], result[id]);
  }
  return result;
}

/** Merge a partial update; never accept coercions, unknown keys or unsafe ranges. */
export function sanitizeModelTuning(input, fallback = DEFAULT_MODEL_TUNING) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const values = Object.fromEntries(Object.entries(MODEL_TUNING_LIMITS).map(([key, range]) => {
    const value = Number.isFinite(source[key]) ? source[key] : Number.isFinite(base[key]) ? base[key] : range.default;
    return [key, Math.round(Math.max(range.min, Math.min(range.max, value)) * 1000) / 1000];
  }));
  const isSound = value => value === 'basin' || value === 'pipe';
  const knockSound = isSound(source.knockSound) ? source.knockSound : isSound(base.knockSound) ? base.knockSound : 'basin';
  return { ...values, knockSound, expressionOverrides: mergeOverrides(source.expressionOverrides, base.expressionOverrides) };
}
