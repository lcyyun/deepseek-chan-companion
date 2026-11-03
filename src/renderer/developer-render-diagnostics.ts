/** Installed only by developer builds; ordinary builds create no sampler. */
export function attachDeveloperRenderDiagnostics({getRuntime, getBootstrap, getState, getIntent}: {
  getRuntime: () => any; getBootstrap: () => any; getState: () => string; getIntent: () => string | undefined;
}) {
  const off=window.companion?.onEvent(event=>{
    if(event.type!=='start-gpu-timing'||event.renderGeneration!==(getBootstrap().renderGeneration??0))return;
    const status=getRuntime()?.startGpuTiming(event.durationMs)||{supported:false,active:false,reason:'not-ready'};
    window.companion?.control('gpu-timing-status',{...status,requestId:event.requestId,renderGeneration:event.renderGeneration}).catch(()=>{});
  });
  const session=crypto.randomUUID();
  const timer=setInterval(()=>{
    const stats=getRuntime()?.getPerformanceStats?.();if(!stats)return;
    const bootstrap=getBootstrap();
    window.companion?.control('render-sample',{...stats,sampledAtMs:performance.now(),session,
      renderGeneration:bootstrap.renderGeneration??0,renderQualityMode:bootstrap.renderQuality?.mode,
      renderQualityEffective:bootstrap.renderQuality?.effective,state:getState(),intent:getIntent(),
      documentVisibility:document.visibilityState,focused:document.hasFocus()}).catch(()=>{});
  },2000);
  return()=>{clearInterval(timer);off?.();};
}
