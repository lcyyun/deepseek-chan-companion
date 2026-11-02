/** Official Cubism Web SDK adapter. All model assets remain on the local server. */
import { buildAssetLookup, resolveAssetFile } from '../shared/model-assets.mjs';
import { DEFAULT_MODEL_TUNING, sanitizeModelTuning, type ModelTuning } from '../shared/model-tuning.mjs';
import { createRenderClock, pngDimensions, renderCanvasSize, textureDecodeSize } from '../shared/render-performance.mjs';
export interface ParameterInfo { id: string; name: string; min: number; max: number; defaultValue: number; value: number }
export interface InteractionRect { x: number; y: number; width: number; height: number }
export interface ModelPlacement { scale: number; centerX: number; centerY: number; referenceWidth?: number; referenceHeight?: number; revision?: number }
export interface ModelAsset { name: string; file: string }
export interface Live2DManifest { modelUrl: string; expressions?: ModelAsset[]; motions?: ModelAsset[] }
export interface MotionOptions { loop?: boolean; holdLastFrame?: boolean; fadeMs?: number; releaseMs?: number }
export interface RenderPerformanceStats {
  frames: number; skippedFrames: number; totalRenderMs: number; averageRenderMs: number; maxRenderMs: number;
  canvasWidth: number; canvasHeight: number; canvasPixels: number;
  textureBytes: number; textureCount: number; maxFps: number; renderActive: boolean;
  contextAttributes: WebGLContextAttributes | null;
}
export interface Live2DHandle {
  setParameters(values: Record<string, number>): void;
  clearParameters(ids?: string[]): void;
  /** Temporary pose blended over authored animation, before physics. Replaced each call. */
  setPoseOverlay(values: Record<string, number>, weight: number): void;
  /** Calculated facial controls after authored expressions, below transient impacts. */
  setFaceOverlay(values: Record<string, number>): void;
  /** Short impact lane after expressions and before physical simulation. */
  setImpactOverlay(values: Record<string, number>, weight: number): void;
  /** A small additive impulse over the ears' freshly computed physics output. */
  setEarImpulse(left: number, right: number): void;
  /** Cuddle-only whole-arm mirroring, with the authored hand, cuff and sleeve together. */
  setCuddleHand(weight: number, active?: boolean): void;
  /** Whole-arm side selection for body choreography. Sides refer to the screen. */
  setGestureHands(kind: 'chest' | 'pointer' | null, side: 'left' | 'right' | 'both', active: boolean): void;
  setModelTuning(tuning: Partial<ModelTuning>, options?: {replace?: boolean}): void;
  /** Subtle eye-ball mesh emphasis; restored after each draw, never written to Core state. */
  setPupilScale(scale: number): void;
  /** Raises only the authored pointing hand for thinking or overlapping chest poses. */
  setHandForeground(weight: number): void;
  playMotion(name: string, options?: MotionOptions): Promise<void>;
  stopMotion(): void;
  setExpression(name: string, active?: boolean): Promise<void>;
  reset(): void;
  destroy(): void;
  getParameters(): ParameterInfo[];
  getInteractionRegions(): { body: InteractionRect; fullBody: InteractionRect; head: InteractionRect; chest?: InteractionRect; basin?: InteractionRect; revision?: number } | null;
  setView(scale: number, offsetX?: number, offsetY?: number): void;
  setPlacement(placement: ModelPlacement): void;
  /** Native window visibility is authoritative; no physics work while hidden. */
  setRenderActive(active: boolean): void;
  /** Local counters only. Texture bytes estimate RGBA upload size, not process memory. */
  getPerformanceStats(): RenderPerformanceStats;
}
export interface Live2DOptions {
  modelBaseUrl?: string;
  manifest?: Live2DManifest;
  manifestUrl?: string;
  maxTextureSize?: number;
  maxFps?: number;
  maxPixelRatio?: number;
  maxCanvasPixels?: number;
  antialias?: boolean;
  /** Mild local tuning of the two authored chest spring groups. */
  softenChestPhysics?: boolean;
  /** Author's effect loop runs beneath gestures; false disables it for calibration. */
  idleMotion?: string | false;
  /** Supplies authentication headers to ALL model, texture and expression requests. */
  fetcher?: (url: string) => Promise<Response>;
  coreUrl?: string;
  frameworkUrl?: string;
  onReady?: (handle: Live2DHandle) => void;
  onError?: (error: Error) => void;
  /** Runs after motion, before physical simulation. dt and elapsed are seconds. */
  onFrame?: (dt: number, elapsed: number) => void;
}

// These are the unmodified official JS runtime objects, loaded after Core initializes.
// Keep the SDK's non-strict TypeScript in its own generated bundle.
type Runtime = Record<string, any>;
let sdkPromise: Promise<Runtime> | undefined;
function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('Cubism Core 加载超时。')); }, 20000);
    script.src = url;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('找不到官方 Cubism Core，请运行 npm run setup:live2d。')); };
    document.head.appendChild(script);
  });
}
async function loadSdk(options: Live2DOptions): Promise<Runtime> {
  if (!sdkPromise) sdkPromise = (async () => {
    if (!(globalThis as any).Live2DCubismCore) await loadScript(options.coreUrl ?? '/vendor/live2dcubismcore.min.js');
    const url = options.frameworkUrl ?? '/vendor/cubism-framework.js';
    const sdk = await import(/* @vite-ignore */ url);
    const startup = new sdk.Option();
    startup.logFunction = (message: string) => console.debug('[Cubism]', message);
    startup.loggingLevel = sdk.LogLevel.LogLevel_Warning;
    if (!sdk.CubismFramework.startUp(startup)) throw new Error('Cubism Framework 初始化失败。');
    sdk.CubismFramework.initialize();
    return sdk;
  })().catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

export async function createLive2D(canvas: HTMLCanvasElement, options: Live2DOptions = {}): Promise<Live2DHandle> {
  const fetcher = options.fetcher ?? ((url: string) => fetch(url));
  const fetchAsset = async (url: string) => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`模型资源加载失败 (${response.status}): ${url.split('?')[0]}`);
    return response;
  };
  const base = new URL(options.modelBaseUrl ?? '/model/', location.href);
  const assetUrl = (file: string) => new URL(file, base).href;
  const textures: WebGLTexture[] = [];
  let sdk: Runtime, moc: any, model: any, renderer: any, mirrorRenderer: any, physics: any, motionManager: any, idleMotionManager: any;
  let requestId = 0, destroyed = false, gl: WebGLRenderingContext | null = null;
  let renderActive = true, textureBytes = 0, frames = 0, skippedFrames = 0, totalRenderMs = 0, maxRenderMs = 0;
  const frameClock = createRenderClock(options.maxFps);
  let resizeObserver: ResizeObserver | undefined;
  let modelTuning = sanitizeModelTuning(DEFAULT_MODEL_TUNING);
  let chestSoftness = options.softenChestPhysics === false ? 1 : modelTuning.chestSoftness;
  let basinShadow = modelTuning.basinShadow;
  const chestParticles: { particle: any; mobility: number; acceleration: number }[] = [];
  const updateChestSprings = (dt: number) => {
    const target = options.softenChestPhysics === false ? 1 : modelTuning.chestSoftness;
    chestSoftness += (target - chestSoftness) * (1 - Math.exp(-dt * 12));
    if (Math.abs(target - chestSoftness) < 0.0001) chestSoftness = target;
    basinShadow += (modelTuning.basinShadow - basinShadow) * (1 - Math.exp(-dt * 14));
    if (Math.abs(modelTuning.basinShadow - basinShadow) < 0.0001) basinShadow = modelTuning.basinShadow;
    const soft = Math.max(0, chestSoftness - 1), aboveDefault = Math.max(0, soft - 0.15) / 0.85;
    const mobilityDelta = chestSoftness <= 1 ? -0.12 * (1 - chestSoftness) : Math.min(soft / 0.15, 1) * 0.01 + aboveDefault * 0.015;
    const accelerationFactor = chestSoftness <= 1 ? 1 + 0.4 * (1 - chestSoftness) : 1 - Math.min(soft / 0.15, 1) * 0.05 - aboveDefault * 0.1;
    for (const row of chestParticles) {
      row.particle.mobility = Math.min(0.96, row.mobility + mobilityDelta);
      row.particle.acceleration = row.acceleration * accelerationFactor;
    }
  };
  const dispose = () => {
    if (destroyed) return;
    destroyed = true;
    renderActive = false;
    cancelAnimationFrame(requestId);
    resizeObserver?.disconnect();
    motionManager?.release();
    idleMotionManager?.release();
    renderer?.release();
    mirrorRenderer?.release();
    physics?.release();
    for (const texture of textures) gl?.deleteTexture(texture);
    if (moc && model) moc.deleteModel(model);
    moc?.release();
  };
  try {
    sdk = await loadSdk(options);
    const manifest: Live2DManifest = options.manifest ?? await (await fetchAsset(options.manifestUrl ?? '/api/model-manifest')).json();
    if (!manifest.modelUrl) throw new Error('模型清单缺少 modelUrl。');
    const modelUrl = assetUrl(manifest.modelUrl);
    const modelBase = new URL('.', modelUrl);
    const modelAsset = (file: string) => new URL(file, modelBase).href;
    const definition = await (await fetchAsset(modelUrl)).json();
    const references = definition.FileReferences;
    if (!references?.Moc || !references.Textures?.length) throw new Error('model3.json 缺少 Moc 或 Textures。');
    const mocBytes = await (await fetchAsset(modelAsset(references.Moc))).arrayBuffer();
    moc = sdk.CubismMoc.create(mocBytes, true);
    if (!moc) throw new Error('MOC3 一致性校验失败，或模型版本与 Cubism Core 不兼容。');
    model = moc.createModel();
    if (!model) throw new Error('无法创建 Live2D 模型实例。');
    if (references.Physics) {
      const bytes = await (await fetchAsset(modelAsset(references.Physics))).arrayBuffer();
      physics = sdk.CubismPhysics.create(bytes, bytes.byteLength);
      const authoredPhysics = JSON.parse(new TextDecoder().decode(bytes));
      // The pinned official Framework exposes the parsed particle objects at
      // these fields. Change spring coefficients in place, retaining simulation
      // positions, velocities, cache interpolation and every other physics rig.
      for (const [index, group] of (authoredPhysics.PhysicsSettings ?? []).entries()) {
        if (!['PhysicsSetting64', 'PhysicsSetting65'].includes(group.Id) || !group.Output?.length || !group.Output.every((output: any) => /^Chest[XY]/.test(output.Destination?.Id ?? ''))) continue;
        const rig = physics?._physicsRig, setting = rig?.settings?.at(index);
        if (!setting) continue;
        for (let i = 1; i < setting.particleCount; i++) {
          const particle = rig.particles.at(setting.baseParticleIndex + i);
          chestParticles.push({ particle, mobility: particle.mobility, acceleration: particle.acceleration });
        }
      }
      updateChestSprings(1);
    }
    let displayNames: Record<string, string> = {};
    if (references.DisplayInfo) {
      const cdi = await (await fetchAsset(modelAsset(references.DisplayInfo))).json();
      displayNames = Object.fromEntries((cdi.Parameters ?? []).map((p: any) => [p.Id, p.Name]));
    }
    const parameters: ParameterInfo[] = [];
    const indices = new Map<string, number>();
    for (let index = 0; index < model.getParameterCount(); index++) {
      const id = model.getParameterId(index).getString().s;
      indices.set(id, index);
      parameters.push({ id, name: displayNames[id] ?? id, min: model.getParameterMinimumValue(index), max: model.getParameterMaximumValue(index),
        defaultValue: model.getParameterDefaultValue(index), value: model.getParameterValueByIndex(index) });
    }
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: options.antialias ?? false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('此设备未提供 WebGL，无法显示 Live2D 模型。');
    renderer = new sdk.CubismRenderer_WebGL();
    // One default mask atlas supports only 36 groups. This model exceeds that;
    // allocate enough atlases instead of silently drawing parts without masks.
    const uniqueMasks = new Set<string>();
    for (const mask of model.getDrawableMasks() as Int32Array[]) {
      if (mask.length) uniqueMasks.add(Array.from(mask).sort((a, b) => a - b).join(','));
    }
    renderer.initialize(model, Math.max(1, Math.ceil(uniqueMasks.size / 32)));
    renderer.setClippingMaskBufferSize(1024);
    renderer.startUp(gl);
    renderer.setIsPremultipliedAlpha(true);
    const textureLimit = Math.min(options.maxTextureSize ?? 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    // Sequential upload limits peak memory while decoding the model's 8192px atlases.
    for (let index = 0; index < references.Textures.length; index++) {
      const blob = await (await fetchAsset(modelAsset(references.Textures[index]))).blob();
      let bitmap: ImageBitmap | undefined, upload: HTMLCanvasElement | undefined;
      try {
        const header = pngDimensions(await blob.slice(0, 24).arrayBuffer());
        const decode = header ? textureDecodeSize(header.width, header.height, textureLimit) : null;
        bitmap = await createImageBitmap(blob, {
          premultiplyAlpha: 'none', colorSpaceConversion: 'none',
          ...(decode ? { resizeWidth: decode.width, resizeHeight: decode.height, resizeQuality: 'high' as ResizeQuality } : {}),
        });
        if (destroyed) throw new Error('模型加载已取消。');
        const size = textureDecodeSize(bitmap.width, bitmap.height, textureLimit);
        upload = document.createElement('canvas'); upload.width = size.width; upload.height = size.height;
        const context = upload.getContext('2d');
        if (!context) throw new Error('无法解码模型贴图。');
        context.drawImage(bitmap, 0, 0, size.width, size.height);
        const texture = gl.createTexture();
        if (!texture) throw new Error('无法分配模型贴图。');
        textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        // Keep canvas upload: ImageBitmap ignores WebGL's premultiply unpack flag.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        renderer.bindTexture(index, texture);
        textureBytes += size.width * size.height * 4;
      } finally {
        bitmap?.close();
        if (upload) { upload.width = 1; upload.height = 1; }
      }
    }
    model.update();
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (let i = 0; i < model.getDrawableCount(); i++) {
      if (model.getDrawableOpacity(i) < 0.01) continue;
      const vertices: Float32Array = model.getDrawableVertices(i);
      for (let v = 0; v < vertices.length; v += 2) {
        bounds.minX = Math.min(bounds.minX, vertices[v]); bounds.maxX = Math.max(bounds.maxX, vertices[v]);
        bounds.minY = Math.min(bounds.minY, vertices[v + 1]); bounds.maxY = Math.max(bounds.maxY, vertices[v + 1]);
      }
    }
    if (!Number.isFinite(bounds.minX) || bounds.maxY <= bounds.minY) throw new Error('模型没有可见的网格。');
    const motionAssets: ModelAsset[] = manifest.motions ?? Object.entries(references.Motions ?? {}).flatMap(([group, files]: [string, any]) =>
      files.map((file: any, index: number) => ({ name: `${group}:${index}`, file: file.File })));
    const expressionAssets: ModelAsset[] = manifest.expressions ?? (references.Expressions ?? []).map((entry: any) => ({ name: entry.Name, file: entry.File }));
    const motionFiles = buildAssetLookup(motionAssets, '.motion3.json');
    const expressionFiles = buildAssetLookup(expressionAssets, '.exp3.json');
    const effectIds = (name: string) => {
      const vector = new sdk.csmVector();
      for (const id of (definition.Groups ?? []).find((group: any) => group.Name === name)?.Ids ?? []) {
        if (indices.has(id)) vector.pushBack(sdk.CubismFramework.getIdManager().getId(id));
      }
      return vector;
    };
    const eyeBlinkIds = effectIds('EyeBlink'), lipSyncIds = effectIds('LipSync');
    const bytesCache = new Map<string, Promise<ArrayBuffer>>();
    const getBytes = (file: string) => {
      if (!bytesCache.has(file)) bytesCache.set(file, fetchAsset(modelAsset(file)).then(response => response.arrayBuffer()).catch(error => { bytesCache.delete(file); throw error; }));
      return bytesCache.get(file)!;
    };
    const expressionCache = new Map<string, any>();
    const expressionStates = new Map<string, { motion: any; active: boolean; weight: number }>();
    const expressionVersions = new Map<string, number>();
    const targetValues = new Map<string, number>();
    let poseOverlay = new Map<string, number>(), poseWeight = 0, pupilScale = 1, thinkingHandFront = false;
    let impactOverlay = new Map<string, number>(), impactWeight = 0;
    let faceOverlay = new Map<string, number>();
    const specialEyeIds = ['key3', 'key4', 'key5', 'key6'];
    let impactEyeOwned = false, impactEyeStyle: string | null = null, impactEyeLevel = 0;
    let earImpulse = [0, 0];
    let cuddleHandWeight = 0, cuddleActive = false, cuddleClosingUntil = -Infinity;
    let gestureHands: { kind: 'chest' | 'pointer'; side: 'left' | 'right' | 'both'; active: boolean; closingUntil: number; weight: number } | null = null;
    const heldMotionValues = new Map<string, number>();
    motionManager = new sdk.CubismMotionManager();
    idleMotionManager = new sdk.CubismMotionManager();
    const idleFile = options.idleMotion === false ? undefined : resolveAssetFile(motionFiles, options.idleMotion ?? 'IDLE');
    if (idleFile) {
      const bytes = await getBytes(idleFile);
      const idle = sdk.CubismMotion.create(bytes, bytes.byteLength, undefined, undefined, true);
      if (!idle) throw new Error('模型的待机动作无效。');
      idle.setEffectIds(eyeBlinkIds, lipSyncIds); idle.setLoop(true);
      idleMotionManager.startMotionPriority(idle, true, 1);
    }
    let activeMotion: { finalValues: Map<string, number>; hold: boolean; releaseSeconds: number } | undefined;
    let releaseMotion: { values: Map<string, number>; start: number; seconds: number } | undefined;
    // Capture before controller/expression/physics so transition poses never feed
    // simulated output back into the next frame's simulation inputs.
    const upstreamValues = new Float32Array(parameters.map(p => p.defaultValue));
    let motionVersion = 0, expressionVersion = 0, elapsed = 0;
    let viewScale = 1, viewX = 0, viewY = 0;
    let placement: ModelPlacement | null = null;
    const matrix = new sdk.CubismMatrix44();
    let interactionRegions: { body: InteractionRect; fullBody: InteractionRect; head: InteractionRect; chest?: InteractionRect; basin?: InteractionRect; revision?: number } | null = null;
    let regionUpdatedAt = -Infinity;
    const headParts = new Set<number>();
    const partParents: Int32Array = model.getPartParentPartIndices();
    for (let i = 0; i < model.getPartCount(); i++) {
      if (['Part99', 'Part15', 'Part154', 'Part80'].includes(model.getPartId(i).getString().s)) headParts.add(i);
    }
    const headDrawables = new Set<number>();
    const basinShadowDrawables: number[] = [];
    const pupilParts = new Map<number, number[]>();
    const handParts = new Set<number>(), handDrawables = new Set<number>();
    const chestArmParts = new Set<number>(), chestArmDrawables = new Set<number>();
    const replacedArmParts = new Set<number>(), replacedArmDrawables = new Set<number>();
    const leftArmParts = new Set<number>(), leftArmDrawables = new Set<number>();
    const pointerArmParts = new Set<number>(), pointerArmDrawables = new Set<number>();
    let chestAxisUpper = -1, chestAxisLower = -1;
    let mirroredInteractionVertices: Float32Array[] = [];
    const basinParts = new Set<number>(), basinDrawables = new Set<number>();
    const chestParts = new Set<number>(), chestDrawables = new Set<number>();
    for (let i = 0; i < model.getPartCount(); i++) {
      if (['Part43', 'Part35', 'Part140', 'Part145'].includes(model.getPartId(i).getString().s)) pupilParts.set(i, []);
      if (model.getPartId(i).getString().s === 'Part56') handParts.add(i);
      if (model.getPartId(i).getString().s === 'Part52') chestArmParts.add(i);
      // The puff sleeves are parented to the bodice, not the arm roots. They
      // still follow each arm's deformation and must travel with its handoff.
      if (['Part128', 'Part68'].includes(model.getPartId(i).getString().s)) replacedArmParts.add(i);
      if (['Part129', 'Part94'].includes(model.getPartId(i).getString().s)) leftArmParts.add(i);
      if (model.getPartId(i).getString().s === 'Part54') pointerArmParts.add(i);
      if (model.getPartId(i).getString().s === 'Part80') basinParts.add(i);
      if (['Part86', 'Part88'].includes(model.getPartId(i).getString().s)) chestParts.add(i);
    }
    for (let i = 0; i < model.getDrawableCount(); i++) {
      if (model.getDrawableId(i).getString().s === 'ArtMesh157') basinShadowDrawables.push(i);
      if (model.getDrawableId(i).getString().s === 'ArtMesh394') chestAxisUpper = i;
      if (model.getDrawableId(i).getString().s === 'ArtMesh407') chestAxisLower = i;
      let parent = model.getDrawableParentPartIndex(i), steps = 0;
      while (parent >= 0 && steps++ <= partParents.length) {
        if (headParts.has(parent)) headDrawables.add(i);
        if (handParts.has(parent)) handDrawables.add(i);
        if (chestArmParts.has(parent)) chestArmDrawables.add(i);
        if (replacedArmParts.has(parent)) replacedArmDrawables.add(i);
        if (leftArmParts.has(parent)) leftArmDrawables.add(i);
        if (pointerArmParts.has(parent)) pointerArmDrawables.add(i);
        if (basinParts.has(parent)) basinDrawables.add(i);
        if (chestParts.has(parent)) chestDrawables.add(i);
        pupilParts.get(parent)?.push(i);
        parent = partParents[parent];
      }
    }
    const scalePupils = () => {
      const backups: { vertices: Float32Array; original: Float32Array }[] = [];
      if (Math.abs(pupilScale - 1) < 0.0001) return () => {};
      for (const drawables of pupilParts.values()) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const visible = drawables.filter(i => model.getDrawableOpacity(i) > 0.01 && model.getDrawableDynamicFlagIsVisible(i));
        for (const i of visible) {
          const vertices: Float32Array = model.getDrawableVertices(i);
          for (let j = 0; j < vertices.length; j += 2) {
            minX = Math.min(minX, vertices[j]); maxX = Math.max(maxX, vertices[j]);
            minY = Math.min(minY, vertices[j + 1]); maxY = Math.max(maxY, vertices[j + 1]);
          }
        }
        if (!Number.isFinite(minX)) continue;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        for (const i of visible) {
          const vertices: Float32Array = model.getDrawableVertices(i);
          backups.push({ vertices, original: vertices.slice() });
          for (let j = 0; j < vertices.length; j += 2) {
            vertices[j] = cx + (vertices[j] - cx) * pupilScale;
            vertices[j + 1] = cy + (vertices[j + 1] - cy) * pupilScale;
          }
        }
      }
      return () => { for (const { vertices, original } of backups) vertices.set(original); };
    };
    const raiseThinkingHand = () => {
      if (!thinkingHandFront || !handDrawables.size) return () => {};
      const orders: Int32Array = model.getDrawableRenderOrders(), original = orders.slice();
      const sorted = Array.from(orders, (_, i) => i).sort((a, b) => orders[a] - orders[b]);
      // The renderer indexes an array with these values, so retain a complete
      // permutation rather than assigning a large arbitrary foreground number.
      const foreground = (i: number) => handDrawables.has(i);
      const reordered = [...sorted.filter(i => !foreground(i)), ...sorted.filter(foreground)];
      reordered.forEach((i, order) => { orders[i] = order; });
      return () => { orders.set(original); };
    };
    const prepareMirroredArm = () => {
      mirroredInteractionVertices = [];
      const inactive = { drawModel: () => renderer.drawModel(), restore: () => {} };
      // One owner, one complete arm. Different arm topologies must never be
      // alpha-crossfaded: even a short blend displays two wrists or sleeves.
      const owner = cuddleHandWeight >= .001 ? { kind: 'chest', side: 'both' }
        : gestureHands && gestureHands.weight >= .001 ? gestureHands : null;
      if (!owner || chestAxisUpper < 0 || chestAxisLower < 0) return inactive;
      const nativeSide = owner.kind === 'chest' ? 'left' : 'right';
      if (owner.side === nativeSide) return inactive;
      const left = new Set([...leftArmDrawables, ...chestArmDrawables]);
      const right = new Set([...replacedArmDrawables, ...pointerArmDrawables]);
      if (!left.size || !right.size) return inactive;
      const sourceSet = owner.side === 'both' ? (nativeSide === 'left' ? left : right) : new Set([...left, ...right]);
      const hiddenSet = owner.side === 'both' ? (nativeSide === 'left' ? right : left) : new Set([...left, ...right]);
      const center = (index: number) => {
        const vertices: Float32Array = model.getDrawableVertices(index);
        let x = 0, y = 0;
        for (let i = 0; i < vertices.length; i += 2) { x += vertices[i]; y += vertices[i + 1]; }
        return { x: x / (vertices.length / 2), y: y / (vertices.length / 2) };
      };
      const upper = center(chestAxisUpper), lower = center(chestAxisLower);
      const length = Math.hypot(upper.x - lower.x, upper.y - lower.y);
      if (!Number.isFinite(length) || length < .0001) return inactive;
      const ux = (upper.x - lower.x) / length, uy = (upper.y - lower.y) / length;
      const transformedSet = new Set(sourceSet), masks = model.getDrawableMasks() as Int32Array[];
      for (const index of transformedSet) for (const mask of masks[index]) transformedSet.add(mask);
      const core = model.getModel().drawables, opacities: Float32Array = core.opacities;
      const rows = Array.from(transformedSet, index => {
        const vertices: Float32Array = model.getDrawableVertices(index), original = vertices.slice(), reflected = vertices.slice();
        for (let i = 0; i < reflected.length; i += 2) {
          const x = original[i] - lower.x, y = original[i + 1] - lower.y, dot = x * ux + y * uy;
          reflected[i] = lower.x + 2 * dot * ux - x; reflected[i + 1] = lower.y + 2 * dot * uy - y;
        }
        const opacity = sourceSet.has(index) && model.getDrawableDynamicFlagIsVisible(index) ? opacities[index] : 0;
        if (opacity >= .05) mirroredInteractionVertices.push(reflected);
        return { index, vertices, original, reflected, opacity };
      });
      const hidden = Array.from(hiddenSet, index => ({ index, opacity: opacities[index] }));
      for (const row of hidden) opacities[row.index] = 0;
      return {
        drawModel() {
          if (!mirrorRenderer) {
            mirrorRenderer = new sdk.CubismRenderer_WebGL();
            mirrorRenderer.initialize(model, Math.max(1, Math.ceil(uniqueMasks.size / 32)));
            mirrorRenderer.setClippingMaskBufferSize(1024); mirrorRenderer.startUp(gl); mirrorRenderer.setIsPremultipliedAlpha(true);
            textures.forEach((texture, index) => mirrorRenderer.bindTexture(index, texture));
          }
          mirrorRenderer.setMvpMatrix(matrix); mirrorRenderer.setRenderState(null, [0, 0, canvas.width, canvas.height]);
          const drawMirror = mirrorRenderer.drawMeshWebGL;
          const flags: Uint8Array = core.dynamicFlags, originalFlags = flags.slice();
          // Build independent reflected masks, without painting the arm yet.
          // Core geometry is restored before the native renderer builds its masks.
          try {
            for (const row of rows) { row.vertices.set(row.reflected); flags[row.index] |= 32; }
            mirrorRenderer.drawMeshWebGL = (m: any, index: number) => {
              if (mirrorRenderer.isGeneratingMask()) drawMirror.call(mirrorRenderer, m, index);
            };
            mirrorRenderer.drawModel();
          } finally {
            mirrorRenderer.drawMeshWebGL = drawMirror;
            for (const row of rows) row.vertices.set(row.original);
            flags.set(originalFlags);
          }
          const orders: Int32Array = model.getDrawableRenderOrders();
          const pending = rows.filter(row => row.opacity > .001).sort((a, b) => orders[a.index] - orders[b.index]);
          let next = 0;
          const paintThrough = (order: number) => {
            while (next < pending.length && orders[pending[next].index] <= order) {
              const row = pending[next++], savedOpacity = opacities[row.index];
              try {
                row.vertices.set(row.reflected); opacities[row.index] = row.opacity;
                const clip = mirrorRenderer._clippingManager?.getClippingContextListForDraw().at(row.index) ?? null;
                mirrorRenderer.setClippingContextBufferForDraw(clip);
                mirrorRenderer.setIsCulling(model.getDrawableCulling(row.index));
                drawMirror.call(mirrorRenderer, model, row.index);
              } finally { row.vertices.set(row.original); opacities[row.index] = savedOpacity; }
            }
          };
          const drawNative = renderer.drawMeshWebGL;
          try {
            renderer.drawMeshWebGL = (m: any, index: number) => {
              if (!renderer.isGeneratingMask()) paintThrough(orders[index]);
              drawNative.call(renderer, m, index);
            };
            // Insert every reflected mesh at its authored depth: behind/front
            // hair, bodice, cuff and skirt keep their original relationships.
            renderer.drawModel();
            paintThrough(Infinity);
          } finally { renderer.drawMeshWebGL = drawNative; }
        },
        restore() { for (const row of hidden) opacities[row.index] = row.opacity; },
      };
    };
    const adjustBasinShadow = () => {
      const opacities: Float32Array = model.getModel().drawables.opacities;
      const originals = basinShadowDrawables.map(index => opacities[index]);
      basinShadowDrawables.forEach((index, i) => { opacities[index] = originals[i] * basinShadow; });
      return () => { basinShadowDrawables.forEach((index, i) => { opacities[index] = originals[i]; }); };
    };
    const updateInteractionRegions = (sx: number, sy: number, tx: number, ty: number) => {
      const full = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      const head = { ...full };
      const basin = { ...full };
      const chest = { ...full };
      for (const vertices of mirroredInteractionVertices) for (let i = 0; i < vertices.length; i += 2) {
        full.minX = Math.min(full.minX, vertices[i]); full.maxX = Math.max(full.maxX, vertices[i]); full.minY = Math.min(full.minY, vertices[i + 1]); full.maxY = Math.max(full.maxY, vertices[i + 1]);
      }
      for (let i = 0; i < model.getDrawableCount(); i++) {
        if (model.getDrawableOpacity(i) < 0.05 || !model.getDrawableDynamicFlagIsVisible(i)) continue;
        const vertices: Float32Array = model.getDrawableVertices(i);
        for (let j = 0; j < vertices.length; j += 2) {
          const x = vertices[j], y = vertices[j + 1];
          full.minX = Math.min(full.minX, x); full.maxX = Math.max(full.maxX, x);
          full.minY = Math.min(full.minY, y); full.maxY = Math.max(full.maxY, y);
          if (headDrawables.has(i)) {
            head.minX = Math.min(head.minX, x); head.maxX = Math.max(head.maxX, x);
            head.minY = Math.min(head.minY, y); head.maxY = Math.max(head.maxY, y);
          }
          if (basinDrawables.has(i)) {
            basin.minX = Math.min(basin.minX, x); basin.maxX = Math.max(basin.maxX, x);
            basin.minY = Math.min(basin.minY, y); basin.maxY = Math.max(basin.maxY, y);
          }
          if (chestDrawables.has(i)) {
            chest.minX = Math.min(chest.minX, x); chest.maxX = Math.max(chest.maxX, x);
            chest.minY = Math.min(chest.minY, y); chest.maxY = Math.max(chest.maxY, y);
          }
        }
      }
      if (!Number.isFinite(full.minX)) { interactionRegions = null; return; }
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const toRect = (b: typeof full, clip = true): InteractionRect => {
        if (!clip) return { x: (b.minX * sx + tx + 1) * width / 2, y: (1 - b.maxY * sy - ty) * height / 2,
          width: (b.maxX - b.minX) * sx * width / 2, height: (b.maxY - b.minY) * sy * height / 2 };
        const left = Math.max(0, Math.min(width, (b.minX * sx + tx + 1) * width / 2));
        const right = Math.max(left, Math.min(width, (b.maxX * sx + tx + 1) * width / 2));
        const top = Math.max(0, Math.min(height, (1 - b.maxY * sy - ty) * height / 2));
        const bottom = Math.max(top, Math.min(height, (1 - b.minY * sy - ty) * height / 2));
        return { x: left, y: top, width: right - left, height: bottom - top };
      };
      const body = toRect(full);
      // Decide which geometry is a head before viewport clipping. At high zoom
      // a valid head can fill most of the visible body; comparing clipped sizes
      // incorrectly replaces it with a narrow strip above the actual face.
      const headBounds = Number.isFinite(head.minX) && head.maxY - head.minY <= (full.maxY - full.minY) * 0.45 ? head : {
        minX: full.minX + (full.maxX - full.minX) * 0.25,
        maxX: full.maxX - (full.maxX - full.minX) * 0.25,
        minY: full.maxY - (full.maxY - full.minY) * 0.22,
        maxY: full.maxY,
      };
      // Keep the hit ellipse in the uncut rig coordinates: viewport clipping
      // must never move its centre onto a shoulder or the waist at high zoom.
      const chestRect = Number.isFinite(chest.minX) ? toRect(chest, false) : null;
      interactionRegions = { body, fullBody: toRect(full, false), head: toRect(headBounds), ...(chestRect ? {chest:chestRect} : {}), ...(Number.isFinite(basin.minX) ? {basin:toRect(basin)} : {}), revision: placement?.revision ?? 0 };
    };
    const apply = (values: Map<string, number>) => {
      for (const [id, value] of values) {
        const index = indices.get(id); if (index === undefined) continue;
        const p = parameters[index];
        model.setParameterValueByIndex(index, Math.max(p.min, Math.min(p.max, value)));
      }
    };
    const ownedMotionIds = () => new Set([
      ...heldMotionValues.keys(), ...(activeMotion?.finalValues.keys() ?? []), ...(releaseMotion?.values.keys() ?? []),
    ]);
    const snapshot = (ids: Iterable<string>) => new Map(Array.from(ids, id => [id, upstreamValues[indices.get(id)!]]));
    const stopMotion = () => {
      const values = snapshot(ownedMotionIds());
      motionVersion++; motionManager.stopAllMotions(); activeMotion = undefined; heldMotionValues.clear();
      releaseMotion = values.size ? { values, start: elapsed, seconds: 0.8 } : undefined;
    };
    const handle: Live2DHandle = {
      setParameters(values) { for (const [id, value] of Object.entries(values)) if (indices.has(id) && Number.isFinite(value)) targetValues.set(id, value); },
      clearParameters(ids) { if (!ids) { targetValues.clear(); faceOverlay.clear(); } else for (const id of ids) { targetValues.delete(id); faceOverlay.delete(id); } },
      setFaceOverlay(values) { faceOverlay = new Map(Object.entries(values).filter(([id, value]) => indices.has(id) && Number.isFinite(value))); },
      setPoseOverlay(values, weight) {
        poseWeight = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
        poseOverlay = new Map(Object.entries(values).filter(([id, value]) => indices.has(id) && Number.isFinite(value)));
      },
      setImpactOverlay(values, weight) {
        impactWeight = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
        impactOverlay = new Map(impactWeight > 0 ? Object.entries(values).filter(([id, value]) => indices.has(id) && Number.isFinite(value)) : []);
      },
      setEarImpulse(left, right) { earImpulse = [left, right].map(value => Number.isFinite(value) ? Math.max(-0.6, Math.min(0.6, value)) : 0); },
      setCuddleHand(weight, active) {
        const value = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
        if (typeof active !== 'boolean') {
          cuddleHandWeight = value; cuddleActive = false; cuddleClosingUntil = -Infinity;
        } else if (active) {
          cuddleActive = true; cuddleClosingUntil = -Infinity;
          cuddleHandWeight = Math.max(cuddleHandWeight, value);
        } else {
          if (cuddleActive) cuddleClosingUntil = elapsed + 1.067;
          cuddleActive = false;
        }
      },
      setGestureHands(kind, side, active) {
        // Retired dual-pointer commands must not revive the removed pose.
        if (kind === 'pointer' && side === 'both') side = 'right';
        if (active && (kind === 'chest' || kind === 'pointer') && ['left', 'right', 'both'].includes(side)) {
          if (gestureHands?.kind === kind && gestureHands.side === side) {
            gestureHands.active = true; gestureHands.closingUntil = -Infinity;
          } else gestureHands = { kind, side, active: true, closingUntil: -Infinity, weight: 0 };
        } else if (gestureHands?.active) {
          gestureHands.active = false;
          gestureHands.closingUntil = elapsed + (gestureHands.kind === 'chest' ? 1.067 : 1.3);
        }
      },
      setModelTuning(value, options) { modelTuning = sanitizeModelTuning(value, options?.replace ? undefined : modelTuning); },
      async playMotion(name, motionOptions = {}) {
        const file = resolveAssetFile(motionFiles, name); if (!file) throw new Error(`模型没有动作：${name}`);
        const version = ++motionVersion;
        const bytes = await getBytes(file);
        if (destroyed || version !== motionVersion) return;
        const json = JSON.parse(new TextDecoder().decode(bytes));
        const motion = sdk.CubismMotion.create(bytes, bytes.byteLength, undefined, undefined, true);
        if (!motion) throw new Error(`动作文件无效：${name}`);
        motion.setEffectIds(eyeBlinkIds, lipSyncIds);
        const loop = motionOptions.loop ?? file.toLowerCase().endsWith('/idle.motion3.json');
        const hold = !loop && (motionOptions.holdLastFrame ?? true);
        motion.setLoop(loop);
        motion.setFadeInTime(Math.max(0, motionOptions.fadeMs ?? 200) / 1000);
        // Keep the authored closing curves intact. Blending out inside their last
        // 0.2s previously cut them short and exposed an unrelated IDLE phase.
        motion.setFadeOutTime(0);
        const finalValues = new Map<string, number>((json.Curves ?? []).filter((curve: any) => curve.Target === 'Parameter' && indices.has(curve.Id))
          .map((curve: any) => [curve.Id, curve.Segments.at(-1)]));
        // The next right-hand gesture starts after the close lane finishes.
        // Return its controls immediately rather than retaining the mirror's
        // final crossfade over the new pointing/foxtail animation.
        if (!cuddleActive && ((finalValues.get('Movement3') ?? 0) > 0.5 || (finalValues.get('Movement1') ?? 0) > 0.5)) {
          cuddleHandWeight = 0; cuddleClosingUntil = -Infinity;
        }
        const outgoing = snapshot(Array.from(ownedMotionIds()).filter(id => !finalValues.has(id)));
        heldMotionValues.clear();
        for (const [id, value] of snapshot(finalValues.keys())) heldMotionValues.set(id, value);
        releaseMotion = outgoing.size ? { values: outgoing, start: elapsed, seconds: 0.8 } : undefined;
        motionManager.stopAllMotions();
        activeMotion = { finalValues, hold, releaseSeconds: Math.max(0.05, Math.min(2, (motionOptions.releaseMs ?? 800) / 1000)) };
        motionManager.startMotionPriority(motion, true, 3);
      },
      stopMotion,
      async setExpression(name, active = true) {
        const file = resolveAssetFile(expressionFiles, name); if (!file) throw new Error(`模型没有表情：${name}`);
        const perExpressionVersion = (expressionVersions.get(file) ?? 0) + 1;
        expressionVersions.set(file, perExpressionVersion);
        const version = expressionVersion;
        const current = expressionStates.get(file);
        if (current) { current.active = active; return; }
        if (!active) return;
        let motion = expressionCache.get(file);
        if (!motion) { const bytes = await getBytes(file); motion = sdk.CubismExpressionMotion.create(bytes, bytes.byteLength); expressionCache.set(file, motion); }
        if (destroyed || expressionVersion !== version || expressionVersions.get(file) !== perExpressionVersion) return;
        expressionStates.set(file, { motion, active, weight: 0 });
      },
      reset() {
        stopMotion(); releaseMotion = undefined; targetValues.clear(); faceOverlay.clear(); impactEyeOwned = false; impactEyeStyle = null; impactEyeLevel = 0; poseOverlay.clear(); poseWeight = 0; impactOverlay.clear(); impactWeight = 0; earImpulse = [0, 0]; cuddleHandWeight = 0; cuddleActive = false; cuddleClosingUntil = -Infinity; gestureHands = null; pupilScale = 1; thinkingHandFront = false; expressionVersion++; expressionStates.clear();
        for (let i = 0; i < parameters.length; i++) {
          model.setParameterValueByIndex(i, parameters[i].defaultValue);
          upstreamValues[i] = parameters[i].defaultValue;
        }
        physics?.stabilization(model);
      },
      destroy: dispose,
      getParameters: () => parameters.map((parameter, i) => ({ ...parameter, value: model.getParameterValueByIndex(i) })),
      setPupilScale(scale) { pupilScale = Number.isFinite(scale) ? Math.max(0.9, Math.min(1.1, scale)) : 1; },
      setHandForeground(weight) { thinkingHandFront = Number.isFinite(weight) && weight >= 0.5; },
      getInteractionRegions: () => interactionRegions,
      setView(scale, offsetX = 0, offsetY = 0) { placement = null; viewScale = Math.max(0.25, Math.min(16, scale)); viewX = offsetX; viewY = offsetY; interactionRegions = null; regionUpdatedAt = -Infinity; },
      setPlacement(value) {
        if (![value.scale, value.centerX, value.centerY].every(Number.isFinite)) return;
        placement = { scale: Math.max(0.5, Math.min(4, value.scale)), centerX: value.centerX, centerY: value.centerY,
          referenceWidth: Math.max(1, value.referenceWidth ?? 370), referenceHeight: Math.max(1, value.referenceHeight ?? 575), revision: value.revision ?? 0 };
        interactionRegions = null; regionUpdatedAt = -Infinity;
      },
      setRenderActive(active) {
        const next = active !== false;
        if (destroyed || next === renderActive) return;
        renderActive = next; cancelAnimationFrame(requestId); requestId = 0; frameClock.reset();
        if (next) requestId = requestAnimationFrame(frame);
      },
      getPerformanceStats() {
        return { frames, skippedFrames, totalRenderMs, averageRenderMs: frames ? totalRenderMs / frames : 0, maxRenderMs,
          canvasWidth: canvas.width, canvasHeight: canvas.height, canvasPixels: canvas.width * canvas.height,
          textureBytes, textureCount: textures.length, maxFps: frameClock.maxFps, renderActive: renderActive && !destroyed,
          contextAttributes: gl?.getContextAttributes() ?? null };
      },
    };
    const resize = () => {
      const { width, height } = renderCanvasSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1, options);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); resize();
    physics?.stabilization(model);
    const frame = (time: number) => {
      requestId = 0;
      if (destroyed || !renderActive || !gl) return;
      const step = frameClock.advance(time);
      if (step === null) { skippedFrames++; requestId = requestAnimationFrame(frame); return; }
      const renderStarted = performance.now();
      try {
        const dt = Math.min(0.05, step);
        elapsed += dt;
        // Each frame starts at authored defaults; transient expression/physics values never accumulate.
        for (let i = 0; i < parameters.length; i++) model.setParameterValueByIndex(i, parameters[i].defaultValue);
        idleMotionManager.updateMotion(model, dt);
        if (releaseMotion) {
          const t = Math.max(0, Math.min(1, (elapsed - releaseMotion.start) / releaseMotion.seconds));
          const weight = 1 - t * t * (3 - 2 * t);
          for (const [id, from] of releaseMotion.values) {
            const index = indices.get(id)!;
            const to = model.getParameterValueByIndex(index);
            model.setParameterValueByIndex(index, to + (from - to) * weight);
          }
          if (t >= 1) releaseMotion = undefined;
        }
        apply(heldMotionValues);
        motionManager.updateMotion(model, dt);
        if (activeMotion && motionManager.isFinished()) {
          if (activeMotion.hold) {
            for (const [id, value] of activeMotion.finalValues) heldMotionValues.set(id, value);
            apply(heldMotionValues);
          } else {
            const values = new Map(Array.from(ownedMotionIds(), id => [id, model.getParameterValueByIndex(indices.get(id)!)]));
            releaseMotion = { values, start: elapsed, seconds: activeMotion.releaseSeconds };
            heldMotionValues.clear();
          }
          activeMotion = undefined;
        }
        for (let i = 0; i < parameters.length; i++) upstreamValues[i] = model.getParameterValueByIndex(i);
        options.onFrame?.(dt, elapsed);
        if (gestureHands?.active) {
          gestureHands.weight += (1 - gestureHands.weight) * (1 - Math.exp(-dt * 16));
          if (gestureHands.weight > .995) gestureHands.weight = 1;
        } else if (gestureHands && elapsed > gestureHands.closingUntil) {
          gestureHands.weight = Math.max(0, gestureHands.weight - dt / .18);
          if (!gestureHands.weight) gestureHands = null;
        }
        // The face's envelope fades before the authored arm closes. Keep the
        // complete mirrored arm present through that motion, then hand back to
        // the resting rig only once both sleeves are down.
        if (cuddleActive) {
          cuddleHandWeight += (1 - cuddleHandWeight) * (1 - Math.exp(-dt * 10));
          if (cuddleHandWeight > 0.995) cuddleHandWeight = 1;
        } else if (Number.isFinite(cuddleClosingUntil) && elapsed > cuddleClosingUntil) {
          cuddleHandWeight = Math.max(0, cuddleHandWeight - dt / 0.25);
          if (!cuddleHandWeight) cuddleClosingUntil = -Infinity;
        }
        apply(targetValues);
        for (const [id, value] of poseOverlay) {
          const index = indices.get(id)!, p = parameters[index];
          const from = model.getParameterValueByIndex(index);
          model.setParameterValueByIndex(index, from + (Math.max(p.min, Math.min(p.max, value)) - from) * poseWeight);
        }
        for (const [name, state] of expressionStates) {
          state.weight += Math.sign((state.active ? 1 : 0) - state.weight) * Math.min(Math.abs((state.active ? 1 : 0) - state.weight), dt / (state.active ? 0.25 : 0.65));
          if (!state.active && state.weight <= 0) { expressionStates.delete(name); continue; }
          state.motion.doUpdateParameters(model, elapsed, state.weight, null);
        }
        apply(faceOverlay);
        for (const [id, value] of impactOverlay) {
          if (specialEyeIds.includes(id)) continue;
          const index = indices.get(id)!, p = parameters[index], from = model.getParameterValueByIndex(index);
          model.setParameterValueByIndex(index, from + (Math.max(p.min, Math.min(p.max, value)) - from) * impactWeight);
        }
        const hasImpactEyes = impactWeight > 0 && specialEyeIds.some(id => (impactOverlay.get(id) ?? 0) > 0);
        if (hasImpactEyes || impactEyeOwned) {
          const eyeLevel = (id: string) => { const index = indices.get(id); return index === undefined ? 0 : model.getParameterValueByIndex(index); };
          const strongest = (read: (id: string) => number) => specialEyeIds.reduce<{id:string|null;level:number}>((best, id) => read(id) > best.level ? {id,level:read(id)} : best, {id:null,level:0});
          const base = strongest(eyeLevel);
          if (!impactEyeOwned) { impactEyeOwned = true; impactEyeStyle = base.id; impactEyeLevel = base.level; }
          const desired = hasImpactEyes ? strongest(id => (impactOverlay.get(id) ?? 0) * impactWeight) : base;
          // Separate eye drawings must not crossfade over one another. Fade the
          // current style out first, then raise the replacement in a short lane.
          if (impactEyeStyle !== desired.id) {
            impactEyeLevel = Math.max(0, impactEyeLevel - dt / 0.09);
            if (!impactEyeLevel) impactEyeStyle = desired.id;
          } else impactEyeLevel += Math.sign(desired.level - impactEyeLevel) * Math.min(Math.abs(desired.level - impactEyeLevel), dt / 0.12);
          for (const id of specialEyeIds) { const index = indices.get(id); if (index !== undefined) model.setParameterValueByIndex(index, id === impactEyeStyle ? impactEyeLevel : 0); }
          if (!hasImpactEyes && impactEyeStyle === desired.id && Math.abs(impactEyeLevel - desired.level) < .001) impactEyeOwned = false;
        }
        // When the author's chest hand switches back to the default hand halfway
        // through closing, keep that default arm at the same authored angle.
        // These are upstream rig controls; the right arm keeps its normal layers.
        if (cuddleHandWeight > 0) for (const [toId, fromId] of [['Param36', 'Param62'], ['Param39', 'Param59'], ['Param41', 'Param60'], ['Param42', 'Param61']]) {
          const to = indices.get(toId), from = indices.get(fromId);
          if (to === undefined || from === undefined) continue;
          const current = model.getParameterValueByIndex(to), mirrored = model.getParameterValueByIndex(from), p = parameters[to];
          model.setParameterValueByIndex(to, Math.max(p.min, Math.min(p.max, current + (mirrored - current) * cuddleHandWeight)));
        }
        updateChestSprings(dt);
        physics?.evaluate(model, dt);
        for (let side = 0; side < 2; side++) {
          if (!earImpulse[side]) continue;
          for (let segment = 1; segment <= 3; segment++) {
            const index = indices.get(`${side === 0 ? 'L' : 'R'}Ear${segment}`); if (index === undefined) continue;
            const p = parameters[index], value = model.getParameterValueByIndex(index) + earImpulse[side] * [1, 0.65, 0.35][segment - 1];
            model.setParameterValueByIndex(index, Math.max(p.min, Math.min(p.max, value)));
          }
        }
        model.update();
        const restoreBasinShadow = adjustBasinShadow();
        const mirroredArm = prepareMirroredArm();
        try {
        const aspect = canvas.width / canvas.height;
        const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
        const pixelsPerUnit = placement ? Math.min(placement.referenceHeight! / height, placement.referenceWidth! / width) * 0.94 * placement.scale : 0;
        const sy = placement ? 2 * pixelsPerUnit / Math.max(1, canvas.clientHeight) : Math.min(2 / height, 2 * aspect / width) * 0.94 * viewScale;
        const sx = placement ? 2 * pixelsPerUnit / Math.max(1, canvas.clientWidth) : sy / aspect;
        const offsetX = placement ? placement.centerX * 2 / Math.max(1, canvas.clientWidth) - 1 : viewX;
        const offsetY = placement ? 1 - placement.centerY * 2 / Math.max(1, canvas.clientHeight) : viewY;
        const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
        matrix.setMatrix(new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, -centerX * sx + offsetX, -centerY * sy + offsetY, 0, 1]));
        if (elapsed - regionUpdatedAt >= 0.1) {
          updateInteractionRegions(sx, sy, -centerX * sx + offsetX, -centerY * sy + offsetY);
          regionUpdatedAt = elapsed;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        // The SDK owns mask FBO/state changes. Clear the entire transparent
        // default target explicitly, even if its previous saved state differed.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        renderer.setMvpMatrix(matrix);
        renderer.setRenderState(null, [0, 0, canvas.width, canvas.height]);
        const restorePupils = scalePupils();
        const restoreHandOrder = raiseThinkingHand();
        try { mirroredArm.drawModel(); } finally { restoreHandOrder(); restorePupils(); }
        } finally { mirroredArm.restore(); restoreBasinShadow(); }
        const renderMs = performance.now() - renderStarted;
        frames++; totalRenderMs += renderMs; maxRenderMs = Math.max(maxRenderMs, renderMs);
        if (renderActive) requestId = requestAnimationFrame(frame);
      } catch (error) { cancelAnimationFrame(requestId); options.onError?.(error instanceof Error ? error : new Error(String(error))); }
    };
    options.onReady?.(handle);
    if (renderActive) requestId = requestAnimationFrame(frame);
    return handle;
  } catch (error) {
    dispose();
    const detail = error instanceof Error ? error : new Error(String(error));
    options.onError?.(detail);
    throw detail;
  }
}
