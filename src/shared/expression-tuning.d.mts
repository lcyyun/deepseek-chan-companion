export interface ExpressionTuning {
  intensity: number;
  smile: number;
  eyeOpen: number;
  brow: number;
  mouthOpen: number;
  blush: number;
}
export const EXPRESSION_TUNING_LIMITS: Readonly<Record<keyof ExpressionTuning, Readonly<{ min: number; max: number; default: number }>>>;
export const DEFAULT_EXPRESSION_TUNING: Readonly<ExpressionTuning>;
export function sanitizeExpressionTuning(input: unknown, fallback?: Partial<ExpressionTuning>): ExpressionTuning;
