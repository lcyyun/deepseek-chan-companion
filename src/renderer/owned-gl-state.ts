/** State ownership for a canvas used exclusively by the pinned Cubism renderer.
 *
 * This is NOT suitable for a context shared with Pixi/Three/other painters, or
 * a caller-owned FBO. Such callers must retain the SDK save/restore path.
 * No GL query, flush or finish is performed by this helper.
 */
export interface OwnedGlStateStats {
  rendererCount: number; frameBegins: number; saveCalls: number; restoreCalls: number;
  bypassedSaves: number; bypassedRestores: number; ready: boolean; disposed: boolean;
}
type Attachment = {
  renderer: any; save: Function; restore: Function;
  saveDescriptor?: PropertyDescriptor; restoreDescriptor?: PropertyDescriptor;
  saveWrapper: Function; restoreWrapper: Function; decisions: boolean[];
};
const requiredMethods = ['bindFramebuffer','viewport','disable','enable','colorMask','blendEquationSeparate',
  'blendFuncSeparate','activeTexture','bindTexture','bindBuffer','useProgram','frontFace','cullFace','disableVertexAttribArray'];
const requiredEnums = ['FRAMEBUFFER','SCISSOR_TEST','STENCIL_TEST','DEPTH_TEST','CULL_FACE','BLEND','FUNC_ADD',
  'ONE','ONE_MINUS_SRC_ALPHA','TEXTURE0','TEXTURE1','TEXTURE_2D','ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','CCW','BACK'];
function writableMethod(object: any, key: string) {
  for (let current = object; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current,key);
    if (descriptor) return 'value' in descriptor && descriptor.writable === true
      && (current === object || Object.isExtensible(object));
  }
  return false;
}
function restoreMethod(target: any, key: string, installed: Function, descriptor?: PropertyDescriptor) {
  // A later decorator owns the property. Its captured helper becomes a legacy
  // delegate after dispose; never overwrite an unrelated owner's replacement.
  if (target[key] !== installed) return;
  if (descriptor) Object.defineProperty(target,key,descriptor);
  else delete target[key];
}

export function createOwnedGlState(gl: WebGLRenderingContext, options: { preserveExternalState?: boolean } = {}) {
  const attachments = new Map<any,Attachment>();
  const viewport: [number,number,number,number] = [0,0,0,0];
  const counters = { frameBegins:0, saveCalls:0, restoreCalls:0, bypassedSaves:0, bypassedRestores:0 };
  let ready = false, disposed = false;
  const compatible = !!gl && requiredMethods.every(key=>typeof (gl as any)[key]==='function')
    && requiredEnums.every(key=>Number.isFinite((gl as any)[key]));
  function attach(renderer: any): { enabled: boolean; reason: string | null } {
    if (disposed) return { enabled:false, reason:'disposed' };
    if (options.preserveExternalState) return { enabled:false, reason:'external-state-preserved' };
    if (attachments.has(renderer)) return { enabled:true, reason:null };
    // The private profile shape pins this optimization to the audited SDK
    // contract. Unknown renderers keep their original methods unchanged.
    if (!compatible || renderer?.gl!==gl || renderer?._rendererProfile?.gl!==gl
      || !['saveProfile','restoreProfile','drawModel','doDrawModel','preDraw','setRenderState'].every(key=>typeof renderer?.[key]==='function')
      || !['save','restore'].every(key=>typeof renderer._rendererProfile[key]==='function')
      || !writableMethod(renderer,'saveProfile') || !writableMethod(renderer,'restoreProfile'))
      return { enabled:false, reason:'unsupported-renderer' };
    const state: Attachment = { renderer, save:renderer.saveProfile, restore:renderer.restoreProfile,
      saveDescriptor:Object.getOwnPropertyDescriptor(renderer,'saveProfile'),
      restoreDescriptor:Object.getOwnPropertyDescriptor(renderer,'restoreProfile'),
      saveWrapper:null!, restoreWrapper:null!, decisions:[] };
    state.saveWrapper = function(this:any,...args:any[]) {
      if (this!==renderer || disposed) return state.save.apply(this,args);
      counters.saveCalls++;
      const bypass = ready && args.length===0;
      state.decisions.push(bypass);
      if (bypass) { counters.bypassedSaves++; return; }
      try { return state.save.apply(this,args); }
      catch (error) { state.decisions.pop(); throw error; }
    };
    state.restoreWrapper = function(this:any,...args:any[]) {
      if (this!==renderer || disposed) return state.restore.apply(this,args);
      counters.restoreCalls++;
      const bypass = state.decisions.pop()===true;
      if (bypass) { counters.bypassedRestores++; return; }
      return state.restore.apply(this,args);
    };
    try {
      renderer.saveProfile=state.saveWrapper; renderer.restoreProfile=state.restoreWrapper;
      if(renderer.saveProfile!==state.saveWrapper||renderer.restoreProfile!==state.restoreWrapper)throw Error('Profile methods cannot be replaced');
    } catch {
      restoreMethod(renderer,'restoreProfile',state.restoreWrapper,state.restoreDescriptor);
      restoreMethod(renderer,'saveProfile',state.saveWrapper,state.saveDescriptor);
      return { enabled:false, reason:'unsupported-renderer' };
    }
    attachments.set(renderer,state);
    if(ready)renderer.setRenderState(null,viewport);
    return { enabled:true, reason:null };
  }
  return {
    attach,
    /** Once per frame, before any primary/mirror drawing and before host clear.
     * Does not clear pixels, regenerate masks or touch geometry/textures.
     * The host retains its single transparent COLOR_BUFFER_BIT clear.
     */
    beginFrame(width:number,height:number) {
      ready=false;
      if(disposed||options.preserveExternalState||!compatible||!attachments.size)return false;
      if(![width,height].every(value=>Number.isInteger(value)&&value>0&&value<=0x7fffffff))throw new RangeError('Invalid default-framebuffer dimensions');
      if(typeof gl.isContextLost==='function'&&gl.isContextLost())throw Error('WebGL context is lost');
      // Recover cleanly after an aborted previous model draw. No external
      // painter's state exists to restore in the owned-context contract.
      for(const state of attachments.values())state.decisions.length=0;
      viewport[2]=width;viewport[3]=height;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);
      gl.disable(gl.SCISSOR_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);
      gl.colorMask(true,true,true,true);
      gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(null);
      // The pinned shader uses two attributes; the SDK profile also covers
      // locations 0..3. All WebGL implementations guarantee these locations.
      for(let index=0;index<4;index++)gl.disableVertexAttribArray(index);
      gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,null);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
      for(const state of attachments.values())state.renderer.setRenderState(null,viewport);
      counters.frameBegins++;ready=true;return true;
    },
    stats():OwnedGlStateStats { return { ...counters,rendererCount:attachments.size,ready,disposed }; },
    dispose() {
      if(disposed)return;disposed=true;ready=false;
      for(const state of attachments.values()){
        restoreMethod(state.renderer,'restoreProfile',state.restoreWrapper,state.restoreDescriptor);
        restoreMethod(state.renderer,'saveProfile',state.saveWrapper,state.saveDescriptor);
        state.decisions.length=0;
      }
      attachments.clear();
    },
  };
}
