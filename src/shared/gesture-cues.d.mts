export type SpeechGestureId = 'explain' | 'think' | 'reassure' | 'happy' | 'shy' | 'listen' | 'chest-left' | 'chest-right' | 'chest-both' | 'pointer-left' | 'pointer-right' | 'talk';
export type SpeechHand = 'none' | 'pointer' | 'chest' | 'foxtail';
export interface GestureCue { at: number; id: SpeechGestureId; gesture: SpeechHand; intensity: number; continuous?: boolean }
export interface SpeechGestureSample extends GestureCue { key: string; progress: number; durationMs: number; elapsedSeconds?: number; hold?: boolean; continuing?: boolean }
export const SPEECH_GESTURE_IDS: readonly SpeechGestureId[];
export function planGestureCues(segment: { text?: string; intent?: string; gesture?: string; emotion?: string; bodyAnimation?: string }, options?: { frequency?: number }): GestureCue[];
export function canContinueGesture(previous?: GestureCue, next?: GestureCue): boolean;
