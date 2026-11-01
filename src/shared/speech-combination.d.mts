export type CombinationId = 'greet' | 'explain' | 'agree' | 'disagree' | 'curious' | 'reassure' | 'shy' | 'playful' | 'surprised' | 'cuddle' | 'think' | 'idea';
export interface CombinationPreset {
  id: CombinationId;
  title: string;
  durationMs: number;
  gesture: 'none' | 'pointer' | 'chest' | 'foxtail';
}
export interface SpeechCombination extends CombinationPreset {
  command: {
    type: 'perform';
    intent: CombinationId;
    emotion?: string;
    gesture: CombinationPreset['gesture'];
    gaze?: string;
    durationMs: number;
    intensity?: number;
  };
}
export const COMBINATION_IDS: readonly CombinationId[];
export const COMBINATION_PRESETS: readonly CombinationPreset[];
export function planSpeechCombination(segment: {
  text?: string;
  intent?: string;
  emotion?: string;
  bodyAnimation?: string;
  combination?: string;
} | null | undefined, options?: { frequency?: number; skipIdea?: boolean }): SpeechCombination | null;
