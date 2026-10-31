export type ChestReactionStage = 1 | 2 | 3 | 4;
export const CHEST_REACTION_DURATIONS: readonly [4.8, 4.4, 4.4, 5];
export interface ChestReactionPose {
  x: number; y: number; z: number; lean: number; gazeX: number; gazeY: number;
}
export interface ChestReactionNode {
  at: number;
  emotion: string;
  phase: string;
  pose: ChestReactionPose;
  face: Record<string, number>;
}
export interface ChestReactionSample {
  stage: ChestReactionStage;
  age: number;
  duration: number;
  phase: string;
  left: ChestReactionNode;
  right: ChestReactionNode;
  blend: number;
  weight: number;
  pose: ChestReactionPose;
}
export function sampleChestReaction(stage: ChestReactionStage, age: number): ChestReactionSample | null;
