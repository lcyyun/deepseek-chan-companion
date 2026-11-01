export interface PerformanceGuideEntry {
  /** Optional user-facing name, distinct from the stable API ID. */
  readonly displayName?: string;
  readonly tags: readonly string[];
  readonly useWhen: string;
  readonly avoidWhen: string;
  /** Alternative independent body selections; for a combination these follow its opening. */
  readonly recommendedBody: readonly string[];
  /** Alternative independent face selections; never stack multiple faces. */
  readonly recommendedEmotions: readonly string[];
}
export interface PerformanceModeGuide {
  readonly fields: string;
  readonly description: string;
}
export const EXPRESSION_GUIDE: Readonly<Record<string, PerformanceGuideEntry>>;
export const BODY_ANIMATION_GUIDE: Readonly<Record<string, PerformanceGuideEntry>>;
export const COMBINATION_GUIDE: Readonly<Record<string, PerformanceGuideEntry>>;
export const PERFORMANCE_GUIDE_BRIEF: string;
export const PERFORMANCE_GUIDE: Readonly<{
  modes: Readonly<Record<'face' | 'body' | 'combination', PerformanceModeGuide>>;
  preferredCombinations: readonly string[];
  expressionPresets: typeof EXPRESSION_GUIDE;
  bodyAnimations: typeof BODY_ANIMATION_GUIDE;
  combinations: typeof COMBINATION_GUIDE;
}>;
export function formatPerformanceGuide(options?: { includeCatalog?: boolean }): string;
