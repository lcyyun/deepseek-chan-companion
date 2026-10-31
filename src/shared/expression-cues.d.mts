export interface ExpressionCue { at: number; emotion: string; intensity: number }
export function normalizeExpressionCues(input: unknown, baseEmotion?: string, baseIntensity?: number): ExpressionCue[];
