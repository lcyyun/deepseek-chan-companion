/** Dedicated-context mesh uploads for the pinned Cubism Web renderer.
 * Draw order, masks and shaders remain in the SDK. Unknown layouts/calls use
 * the legacy path. Vertex data is revalidated after in-frame mirror changes.
 */
export interface MeshBufferCacheStats {
  uploads: number; skips: number; bytes: number; bufferCount: number;
  rendererCount: number; legacyCalls: number; vertexUploads: number;
  uvUploads: number; indexUploads: number; disposed: boolean;
}
type Kind = 'vertex' | 'uv' | 'index';
type View = Float32Array | Uint16Array;
type Bits = Uint32Array | Uint16Array;
type Upload = { kind: Kind; buffer: WebGLBuffer; valid: boolean; epoch: number; snapshot: Bits | null;
  sourceBits: Bits | null; sourceBuffer: ArrayBufferLike | null; sourceOffset: number; sourceLength: number; sourceFloat: boolean };
type Entry = { vertex: Upload; uv: Upload; index: Upload; buffers: Record<Kind, WebGLBuffer>; expectedVertex: View; expectedUv: View; expectedIndex: View };
type Attachment = { renderer: any; enabled: boolean; reason: string | null; entries: Map<number, Entry>; originalBuffers: any;
  originalMesh: Function; originalModel: Function; meshWrapper: Function; modelWrapper: Function; meshOwn: boolean; modelOwn: boolean };
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const kinds: Kind[] = ['vertex', 'uv', 'index'];
function mutableDataProperty(object: any, key: string) {
  for (let current = object; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return 'value' in descriptor && descriptor.writable === true;
  }
  return false;
}
const view = (value: any): value is View => ArrayBuffer.isView(value) && (value instanceof Float32Array || value instanceof Uint16Array) && value.length > 0;
const sameView = (a: any, b: View) => a === b || view(a) && a.constructor === b.constructor && a.buffer === b.buffer && a.byteOffset === b.byteOffset && a.byteLength === b.byteLength;
function sourceBits(upload: Upload, data: View): Bits {
  const floating = data instanceof Float32Array;
  if (!upload.sourceBits || upload.sourceBuffer !== data.buffer || upload.sourceOffset !== data.byteOffset || upload.sourceLength !== data.length || upload.sourceFloat !== floating) {
    // Rebind only when the model's source storage changes. Integer comparison
    // preserves Float32 NaN payloads and signed zero without Object.is per value.
    upload.sourceBits = floating ? new Uint32Array(data.buffer, data.byteOffset, data.length) : data;
    upload.sourceBuffer = data.buffer; upload.sourceOffset = data.byteOffset;
    upload.sourceLength = data.length; upload.sourceFloat = floating;
  }
  return upload.sourceBits;
}
function equalContents(a: Bits, b: Bits | null) {
  if (!b || a.BYTES_PER_ELEMENT !== b.BYTES_PER_ELEMENT || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function createMeshBufferCache(gl: WebGLRenderingContext, model: any) {
  const attachments = new Map<any, Attachment>(), ownedUploads = new Map<WebGLBuffer, Upload>();
  const counters = { uploads: 0, skips: 0, bytes: 0, bufferCount: 0, legacyCalls: 0, vertexUploads: 0, uvUploads: 0, indexUploads: 0 };
  let epoch = 0, disposed = false, active: Entry | null = null, depth = 0;
  let boundArray: WebGLBuffer | null | undefined, boundElement: WebGLBuffer | null | undefined;
  let previousData: any, previousBind: any, dataOwn = false, bindOwn = false;
  const modelCompatible = model && ['getDrawableCount', 'getDrawableVertices', 'getDrawableVertexUvs', 'getDrawableVertexIndices'].every(key => typeof model[key] === 'function');

  function bufferData(target: number, data: any, usage: number) {
    const bound = target === gl.ARRAY_BUFFER ? boundArray : target === gl.ELEMENT_ARRAY_BUFFER ? boundElement : undefined;
    const upload = bound ? ownedUploads.get(bound) : undefined;
    let expected: View | undefined;
    if (active && upload && arguments.length === 3) {
      if (upload === active.vertex && target === gl.ARRAY_BUFFER) expected = active.expectedVertex;
      else if (upload === active.uv && target === gl.ARRAY_BUFFER) expected = active.expectedUv;
      else if (upload === active.index && target === gl.ELEMENT_ARRAY_BUFFER) expected = active.expectedIndex;
    }
    if (!expected || !sameView(data, expected)) {
      // An unknown write to an owned buffer invalidates its cached contents.
      // Forward every unknown overload, buffer, array/view and target unchanged.
      if (upload) upload.valid = false;
      return previousData.apply(gl, arguments);
    }
    const bits = sourceBits(upload!, data);
    if (upload!.valid && (upload!.kind !== 'vertex' || upload!.epoch === epoch) && equalContents(bits, upload!.snapshot)) {
      counters.skips++; return;
    }
    upload!.valid = false;
    previousData.call(gl, target, data, usage); // Keep SDK bufferData orphaning semantics.
    if (!upload!.snapshot || upload!.snapshot.BYTES_PER_ELEMENT !== bits.BYTES_PER_ELEMENT || upload!.snapshot.length !== bits.length) upload!.snapshot = bits.slice();
    else upload!.snapshot.set(bits);
    upload!.epoch = epoch; upload!.valid = true;
    counters.uploads++; counters.bytes += data.byteLength;
    if (upload!.kind === 'vertex') counters.vertexUploads++;
    else if (upload!.kind === 'uv') counters.uvUploads++;
    else counters.indexUploads++;
  }
  function bindBuffer(target: number, buffer: WebGLBuffer | null) {
    if (arguments.length === 2) previousBind.call(gl, target, buffer);
    else previousBind.apply(gl, arguments);
    if (target === gl.ARRAY_BUFFER) boundArray = buffer;
    else if (target === gl.ELEMENT_ARRAY_BUFFER) boundElement = buffer;
  }
  function restoreProperty(object: any, key: string, value: any, wasOwn: boolean, installed: any) {
    if (object[key] !== installed) return;
    if (wasOwn) object[key] = value;
    else delete object[key];
  }
  function enterScope() {
    if (depth) { depth++; return true; }
    previousData = gl.bufferData; previousBind = gl.bindBuffer;
    dataOwn = own(gl, 'bufferData'); bindOwn = own(gl, 'bindBuffer');
    boundArray = boundElement = undefined;
    try {
      (gl as any).bufferData = bufferData; (gl as any).bindBuffer = bindBuffer;
      if (gl.bufferData !== bufferData || gl.bindBuffer !== bindBuffer) throw Error('WebGL method interception unavailable');
      depth = 1; return true;
    } catch {
      restoreProperty(gl, 'bindBuffer', previousBind, bindOwn, bindBuffer);
      restoreProperty(gl, 'bufferData', previousData, dataOwn, bufferData);
      return false;
    }
  }
  function leaveScope() {
    if (--depth) return;
    restoreProperty(gl, 'bindBuffer', previousBind, bindOwn, bindBuffer);
    restoreProperty(gl, 'bufferData', previousData, dataOwn, bufferData);
    active = null; boundArray = boundElement = undefined;
  }
  function releaseEntries(state: Attachment) {
    for (const entry of state.entries.values()) for (const kind of kinds) {
      const upload = entry[kind];
      if (ownedUploads.delete(upload.buffer)) { try { gl.deleteBuffer(upload.buffer); } catch {} counters.bufferCount--; }
    }
    state.entries.clear();
  }
  function entryFor(state: Attachment, index: number, vertex: View, uv: View, indices: View) {
    let entry = state.entries.get(index);
    if (!entry) {
      const buffers: WebGLBuffer[] = [];
      try {
        for (let i = 0; i < 3; i++) { const buffer = gl.createBuffer(); if (!buffer) throw Error('Buffer allocation failed'); buffers.push(buffer); }
      } catch {
        for (const buffer of buffers) try { gl.deleteBuffer(buffer); } catch {}
        state.enabled = false; state.reason = 'buffer-allocation'; releaseEntries(state); return null;
      }
      const make = (kind: Kind, i: number): Upload => ({ kind, buffer: buffers[i], valid: false, epoch: -1, snapshot: null,
        sourceBits: null, sourceBuffer: null, sourceOffset: 0, sourceLength: 0, sourceFloat: false });
      entry = { vertex: make('vertex', 0), uv: make('uv', 1), index: make('index', 2),
        buffers: { vertex: buffers[0], uv: buffers[1], index: buffers[2] }, expectedVertex: vertex, expectedUv: uv, expectedIndex: indices };
      for (const kind of kinds) ownedUploads.set(entry[kind].buffer, entry[kind]);
      state.entries.set(index, entry); counters.bufferCount += 3;
    }
    entry.expectedVertex = vertex; entry.expectedUv = uv; entry.expectedIndex = indices;
    return entry;
  }
  function legacy(state: Attachment, receiver: any, args: IArguments) {
    counters.legacyCalls++; const before = active; active = null;
    try { return state.originalMesh.apply(receiver, args); } finally { active = before; }
  }
  function attach(renderer: any): { enabled: boolean; reason: string | null } {
    if (attachments.has(renderer)) { const state = attachments.get(renderer)!; return { enabled: state.enabled && !disposed, reason: state.reason }; }
    const buffers = renderer?._bufferData;
    if (disposed || !modelCompatible || renderer?.gl !== gl || typeof renderer?.drawMeshWebGL !== 'function' || typeof renderer?.drawModel !== 'function'
        || !buffers || !kinds.every(key => key in buffers) || !mutableDataProperty(renderer, '_bufferData')
        || !['drawMeshWebGL', 'drawModel'].every(key => mutableDataProperty(renderer, key))
        || !['bufferData', 'bindBuffer'].every(key => mutableDataProperty(gl, key))
        || !['bufferData', 'bindBuffer', 'createBuffer', 'deleteBuffer'].every(key => typeof (gl as any)?.[key] === 'function')) return { enabled: false, reason: 'unsupported-renderer' };
    const state: Attachment = { renderer, enabled: true, reason: null, entries: new Map(), originalBuffers: buffers,
      originalMesh: renderer.drawMeshWebGL, originalModel: renderer.drawModel, meshWrapper: null!, modelWrapper: null!,
      meshOwn: own(renderer, 'drawMeshWebGL'), modelOwn: own(renderer, 'drawModel') };
    state.meshWrapper = function(this: any, drawModel: any, index: number) {
      if (!state.enabled || disposed || this !== renderer || drawModel !== model || arguments.length !== 2 || !Number.isInteger(index) || index < 0 || index >= model.getDrawableCount()) return legacy(state, this, arguments);
      const vertex = model.getDrawableVertices(index), uv = model.getDrawableVertexUvs(index), indices = model.getDrawableVertexIndices(index);
      if (!view(vertex) || !view(uv) || !view(indices)) return legacy(state, this, arguments);
      const entered = depth === 0;
      if (entered && !enterScope()) return legacy(state, this, arguments);
      const before = active, previousBuffers = renderer._bufferData;
      try {
        const entry = entryFor(state, index, vertex, uv, indices);
        if (!entry) return legacy(state, this, arguments);
        active = entry; renderer._bufferData = entry.buffers;
        return state.originalMesh.call(this, drawModel, index);
      } finally {
        renderer._bufferData = previousBuffers; active = before;
        if (entered) leaveScope();
      }
    };
    state.modelWrapper = function(this: any) {
      if (!state.enabled || disposed || this !== renderer) return state.originalModel.apply(this, arguments);
      if (!enterScope()) { state.enabled = false; state.reason = 'unsupported-context'; return state.originalModel.apply(this, arguments); }
      try { return state.originalModel.apply(this, arguments); } finally { leaveScope(); }
    };
    try {
      renderer.drawMeshWebGL = state.meshWrapper; renderer.drawModel = state.modelWrapper;
      if (renderer.drawMeshWebGL !== state.meshWrapper || renderer.drawModel !== state.modelWrapper) throw Error('Renderer methods are not writable');
    } catch {
      restoreProperty(renderer, 'drawMeshWebGL', state.originalMesh, state.meshOwn, state.meshWrapper);
      restoreProperty(renderer, 'drawModel', state.originalModel, state.modelOwn, state.modelWrapper);
      return { enabled: false, reason: 'unsupported-renderer' };
    }
    attachments.set(renderer, state); return { enabled: true, reason: null };
  }
  return {
    attach,
    beginFrame() { if (!disposed) epoch++; },
    stats(): MeshBufferCacheStats { return { ...counters, rendererCount: Array.from(attachments.values()).filter(state => state.enabled).length, disposed }; },
    dispose() {
      if (disposed) return; disposed = true;
      for (const state of attachments.values()) {
        restoreProperty(state.renderer, 'drawMeshWebGL', state.originalMesh, state.meshOwn, state.meshWrapper);
        restoreProperty(state.renderer, 'drawModel', state.originalModel, state.modelOwn, state.modelWrapper);
        // drawMesh restores this in finally; do not overwrite a new external owner.
        if (state.entries.size && Array.from(state.entries.values()).some(entry => state.renderer._bufferData === entry.buffers)) state.renderer._bufferData = state.originalBuffers;
        releaseEntries(state);
      }
      attachments.clear();
    },
  };
}
