export interface CanvasBudget { maxPixelRatio?: number; maxCanvasPixels?: number }
export function renderCanvasSize(width: number, height: number, devicePixelRatio?: number, options?: CanvasBudget): { width: number; height: number; ratio: number };
export function textureDecodeSize(width: number, height: number, maxTextureSize: number): { width: number; height: number };
export function pngDimensions(header: ArrayBuffer | ArrayBufferView): { width: number; height: number } | null;
export function createRenderClock(maxFps?: number): { readonly maxFps: number; advance(time: number): number | null; reset(): void };
export interface RenderDiagnosticsSnapshot {
  recentSamples: number; windowMs: number; recentFps: number; frameIntervalP95Ms: number; frameIntervalMaxMs: number; renderP95Ms: number;
  longFrames: number; wallElapsedMs: number; logicElapsedSeconds: number;
}
export interface GraphicsInfo { gpuRenderer: string; gpuVendor: string; gpuInfoSource: 'unmasked' | 'standard' | 'unavailable' }
export function createRenderDiagnostics(capacity?: number): { record(time: number, renderMs: number, logicStepSeconds: number): boolean; resetTiming(): void; snapshot(): RenderDiagnosticsSnapshot };
export function readGraphicsInfo(gl: WebGLRenderingContext | null): GraphicsInfo;
