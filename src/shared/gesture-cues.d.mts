export type SpeechGestureId = 'explain' | 'think' | 'reassure' | 'happy' | 'shy' | 'listen';
export type SpeechHand = 'none' | 'pointer' | 'chest' | 'foxtail';
export interface GestureCue { at: number; id: SpeechGestureId; gesture: SpeechHand; intensity: number }
export interface SpeechGestureSample extends GestureCue { key: string; progress: number; durationMs: number }
export const SPEECH_GESTURE_IDS: readonly SpeechGestureId[];
export function planGestureCues(segment: { text?: string; intent?: string; gesture?: string; emotion?: string }, options?: { frequency?: number }): GestureCue[];
export function canContinueGesture(previous?: GestureCue, next?: GestureCue): boolean;
