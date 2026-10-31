// Keep choreography independent of DOM/WebGL so interruption and mixing are testable.
export { BehaviorController, BEHAVIOR_PRESETS } from '../shared/behavior.mjs';
export type { BehaviorCommand, BehaviorOptions, BehaviorRuntime, BehaviorState, PettingInput, PointerTrackingInput } from '../shared/behavior.mjs';
