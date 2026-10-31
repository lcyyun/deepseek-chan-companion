import type { ModelTuning } from './model-tuning.mjs';
export type BehaviorState = 'idle' | 'thinking' | 'listening' | 'speaking';
export interface BehaviorRuntime {
  setParameters(parameters: Record<string, number>): void;
  setPoseOverlay?(parameters: Record<string, number>, weight: number): void;
  setPupilScale?(scale: number): void;
  setHandForeground?(weight: number): void;
  setCuddleHand?(weight: number, active?: boolean): void;
  setImpactOverlay?(parameters: Record<string, number>, weight: number): void;
  setEarImpulse?(left: number, right: number): void;
  setFaceOverlay?(parameters: Record<string, number>): void;
  playMotion?(name: string, options?: { loop?: boolean; holdLastFrame?: boolean; fadeMs?: number }): unknown;
  setExpression?(name: string, active: boolean): unknown;
  stopMotion?(): unknown;
  reset?(): unknown;
  getParameters?(): { id: string; min: number; max: number }[];
}
export interface BehaviorOptions {
  tuning?: Partial<ModelTuning>;
  random?: () => number;
  /** Monotonic wall-clock seconds for the tap cooldown; defaults to performance.now()/1000. */
  clockSeconds?: () => number;
  onEvent?: (event: { type: string; state?: BehaviorState; id?: string; message?: string }) => void;
  phonemesVerified?: boolean;
  parameterLimits?: Record<string, { min: number; max: number }>;
  thoughtCooldown?: number;
}
export interface BehaviorCommand {
  id?: string;
  type: 'perform' | 'speak' | 'stop' | 'reset' | 'state';
  intent?: string;
  emotion?: string;
  gesture?: string;
  gaze?: string | { x: number; y: number };
  intensity?: number;
  durationMs?: number;
  text?: string;
  state?: BehaviorState;
}
export interface PettingInput {
  /** A fresh pointer-down resets the continuous-contact timer, not the visual fade. */
  newContact?: boolean;
  /** Head-local [-1,1]; x right, y down. */
  x?: number;
  y?: number;
  /** Normalized pointer speed [0,1]. */
  speed?: number;
  intensity?: number;
}
export interface PointerTrackingInput {
  /** Normalized [-1,1], x right and y down relative to the chosen screen/head center. */
  x?: number;
  y?: number;
  /** Normalized [0,1] cursor speed and distance from the chosen center. */
  speed?: number;
  travel?: number;
}
export const BEHAVIOR_PRESETS: readonly { id: string; title: string; command: BehaviorCommand }[];
export class BehaviorController {
  constructor(runtime: BehaviorRuntime, options?: BehaviorOptions);
  readonly state: BehaviorState;
  readonly isPetting: boolean;
  readonly isPointerTracking: boolean;
  readonly isBasinEnabled: boolean;
  readonly isChestReaction: boolean;
  readonly isChestAwaitingPetting: boolean;
  readonly isChestHeartArmed: boolean;
  /** False when a reaction or a higher-priority local interaction is active. */
  tapChest(): boolean;
  /** Preview never advances the physical-tap sequence or its cooldown. */
  previewChestReaction(stage: 1 | 2 | 3 | 4): boolean;
  /** Cancel without advancing; remaining face/body values ease back next frame. */
  cancelChestReaction(): void;
  setTuning(tuning: Partial<ModelTuning>, options?: { replace?: boolean }): void;
  setExpressionCue(emotion: string, intensity?: number): void;
  clearExpressionCue(): void;
  setBasinEnabled(enabled: boolean): void;
  knockBasin(): boolean;
  cancelBasinKnock(): void;
  applyCommand(command: BehaviorCommand): void;
  perform(command?: Partial<BehaviorCommand>): void;
  setState(state: BehaviorState): void;
  setAudioLevel(level: number, viseme?: Record<string, number> | null): void;
  setPetting(active: boolean, input?: PettingInput): void;
  setPointerTracking(active: boolean, input?: PointerTrackingInput): void;
  interrupt(nextState?: BehaviorState): void;
  reset(): void;
  update(dt: number, elapsed?: number): void;
  destroy(): void;
}
