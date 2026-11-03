export type RenderMode = 'auto' | 'balanced' | 'economy' | 'quality';
export interface RenderQuality {
  mode: RenderMode; effective: Exclude<RenderMode, 'auto'>; label: string;
  maxFps: number; maxTextureSize: number; maxPixelRatio: number; maxCanvasPixels: number; antialias: boolean; cacheMeshBuffers?: boolean;
}
export const RENDER_MODES: readonly RenderMode[];
export function normalizeRenderMode(value: unknown): RenderMode;
export function resolveRenderQuality(value?: unknown, totalMemoryBytes?: number): RenderQuality;
