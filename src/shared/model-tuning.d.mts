import type { ExpressionTuning } from './expression-tuning.mjs';
export interface ModelTuning {
  chestSoftness: number;
  bodyMotion: number;
  bodyFollow: number;
  gestureAmplitude: number;
  gestureFrequency: number;
  idleActivity: number;
  gazeStrength: number;
  blushStrength: number;
  basinShadow: number;
  knockVolume: number;
  knockSound: 'basin' | 'pipe';
  expressionIntensity: number;
  expressionOverrides: Record<string, ExpressionTuning>;
}
export type ModelTuningUpdate = Omit<Partial<ModelTuning>, 'expressionOverrides'> & { expressionOverrides?: Record<string, Partial<ExpressionTuning> | null> | null };
export const MODEL_TUNING_LIMITS: Readonly<Record<Exclude<keyof ModelTuning, 'expressionOverrides' | 'knockSound'>, Readonly<{ min: number; max: number; default: number }>>>;
export const DEFAULT_MODEL_TUNING: Readonly<ModelTuning>;
export function sanitizeModelTuning(input: unknown, fallback?: Partial<ModelTuning>): ModelTuning;
