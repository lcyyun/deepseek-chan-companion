export type ExpressionId = 'neutral' | 'happy' | 'joyful' | 'squeezed' | 'gentle' | 'puzzled' | 'curious' | 'panic' | 'shy' | 'cold' | 'sad' | 'worried' | 'embarrassed' | 'playful' | 'smug' | 'angry' | 'sleepy' | 'surprised' | 'determined' | 'proud' | 'relieved' | 'love' | 'teary' | 'dizzy' | 'speechless';
export interface ExpressionFace {
  readonly smile: number;
  readonly eyeSmile: number;
  readonly browL: number;
  readonly browR: number;
  readonly eye: number;
  readonly open: number;
  readonly blush: number;
  readonly pucker: number;
  readonly funnel: number;
  readonly cheek: number;
  readonly innerBrow: number;
  /** Renderer pupil scale, neutral 1; this is not SHOCKEYE. */
  readonly pupil: number;
}
export interface ExpressionPreset {
  readonly id: ExpressionId;
  readonly title: string;
  readonly icon: string;
  readonly description: string;
  readonly group: '日常' | '积极' | '思考' | '低落' | '俏皮' | '特殊';
  readonly face: ExpressionFace;
  readonly parameters: Readonly<Record<string, number>>;
  readonly specialEyes: boolean;
}
export const EXPRESSION_PARAMETER_DEFAULTS: Readonly<Record<string, number>>;
export const EXPRESSION_PRESETS: readonly ExpressionPreset[];
export const EXPRESSION_IDS: readonly ExpressionId[];
export function getExpressionPreset(id: string): ExpressionPreset;
