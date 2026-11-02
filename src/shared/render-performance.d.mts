export interface CanvasBudget { maxPixelRatio?: number; maxCanvasPixels?: number }
export function renderCanvasSize(width: number, height: number, devicePixelRatio?: number, options?: CanvasBudget): { width: number; height: number; ratio: number };
export function textureDecodeSize(width: number, height: number, maxTextureSize: number): { width: number; height: number };
export function pngDimensions(header: ArrayBuffer | ArrayBufferView): { width: number; height: number } | null;
export function createRenderClock(maxFps?: number): { readonly maxFps: number; advance(time: number): number | null; reset(): void };
