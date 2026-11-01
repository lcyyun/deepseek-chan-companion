import type { ExpressionId } from './expressions.mjs';
import type { SpeechGestureId } from './gesture-cues.mjs';
export type AvatarState = 'idle' | 'thinking' | 'listening' | 'speaking' | 'error';
export type AvatarIntent = 'neutral' | 'greet' | 'agree' | 'disagree' | 'curious' | 'explain' | 'reassure' | 'shy' | 'playful' | 'surprised' | 'think' | 'cuddle' | 'idea';
export type AvatarEmotion = ExpressionId;
export interface ExpressionCue { at: number; emotion: AvatarEmotion; intensity: number }
export interface AvatarCommand {
  id?: string;
  type: 'perform' | 'speak' | 'stop' | 'reset' | 'state' | 'expression' | 'body';
  animation?: SpeechGestureId;
  bodyAnimation?: SpeechGestureId | 'auto' | 'none';
  active?: boolean;
  intent?: AvatarIntent; emotion?: AvatarEmotion; gesture?: string; gaze?: string;
  intensity?: number; durationMs?: number; text?: string; state?: AvatarState;
}
export interface ReplySegment { id?: string; text: string; intent?: AvatarIntent; emotion?: AvatarEmotion; gesture?: string; bodyAnimation?: SpeechGestureId | 'auto' | 'none'; expressionCues?: ExpressionCue[] }
export interface Reply { id: string; requestId?: string; segments: ReplySegment[]; details?: string; sources?: {title?: string; url: string}[]; }
export interface Bootstrap { url: string; token: string; role: 'pet'|'toggle'|'chat'; }
declare global {
  interface Window {
    companion?: {
      bootstrap: () => Promise<Bootstrap>;
      control: (action: string, data?: unknown) => Promise<unknown>;
      onEvent: (callback: (event: any) => void) => () => void;
    };
  }
}
