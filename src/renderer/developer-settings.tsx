import { useEffect, useRef, useState } from 'react';
import { SettingsSelect } from './settings-select';

export function DeveloperPerformanceSettings({diagnostics,setDiagnostics,setResult,onError}: {
  diagnostics:any;setDiagnostics:(value:any)=>void;setResult:(value:string)=>void;onError:(value:string)=>void;
}) {
  const [qualityChanging,setQualityChanging]=useState(false);
  const [gpuCapturing,setGpuCapturing]=useState(false),[gpuMessage,setGpuMessage]=useState('');
  const gpuNoticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(gpuNoticeTimer.current);};},[]);
  async function chooseQuality(mode:string){setQualityChanging(true);try{const profile=await window.companion?.control('render-quality',mode);setDiagnostics((d:any)=>({...d,renderQuality:profile}));setResult('画质设置已保存，模型正在重新加载。');}catch(e:any){onError(e.message);}finally{if(mounted.current)setQualityChanging(false);}}
  async function captureGpu(){
    setGpuCapturing(true);setGpuMessage('正在确认 GPU 计时支持…');clearTimeout(gpuNoticeTimer.current);
    try{
      const status:any=await window.companion?.control('start-gpu-timing');
      if(!mounted.current)return;
      if(!status?.active){setGpuCapturing(false);setGpuMessage(status?.reason==='unsupported'?'当前驱动不支持 GPU 计时，仍可复制普通性能诊断。':'GPU 计时未能开始，请保持模型显示后重试。');return;}
      setGpuMessage('已开始采集。请在 15 秒内播放卡顿的动作，保持模型显示。');
      gpuNoticeTimer.current=setTimeout(()=>{setGpuCapturing(false);setGpuMessage('现在可以复制性能诊断，查看 GPU 用时和采集状态。');},20000);
    }catch(e:any){if(mounted.current){setGpuCapturing(false);setGpuMessage(e.message||'采集未能开始。');}}
  }
  return <details className="settings-group" data-developer-performance><summary>性能与画质</summary>
    <SettingsSelect id="render-quality" label="渲染模式" value={diagnostics?.renderQuality?.mode||'auto'} onChange={chooseQuality} disabled={qualityChanging||!window.companion} options={[
      {value:'auto',label:'自动',description:'按内存选择档位，用于兼容性对照'},
      {value:'balanced',label:'均衡 · 对照档',description:'60 帧，较低贴图和画布预算'},
      {value:'economy',label:'省资源 · 对照档',description:'30 帧，进一步降低画布与贴图占用'},
      {value:'quality',label:'高清',description:'60 帧，用户版固定使用的画质'},
    ]}/>
    <p className="hint">当前：{diagnostics?.renderQuality?.label||'均衡'}。隐藏桌宠时暂停渲染，显示后恢复。切换模式会重新加载模型并停止当前表演，选择后自动保存。</p>
    <label className="check-row"><input type="checkbox" checked={diagnostics?.renderQuality?.cacheMeshBuffers===true} disabled={qualityChanging||!window.companion} onChange={async e=>{setQualityChanging(true);try{const profile=await window.companion?.control('render-buffer-cache',e.target.checked);setDiagnostics((d:any)=>({...d,renderQuality:profile}));setResult('绘制设置已保存，模型正在重新加载。');}catch(error:any){onError(error.message);}finally{if(mounted.current)setQualityChanging(false);}}}/>GPU 数据复用（实验）</label>
    <p className="hint">减少重复上传，可能增加 CPU 和内存开销。默认关闭，可在卡顿场景对照；切换时重新加载模型。</p>
    <label className="check-row"><input type="checkbox" checked={diagnostics?.renderQuality?.preserveGlState===true} disabled={qualityChanging||!window.companion} onChange={async e=>{setQualityChanging(true);try{const profile=await window.companion?.control('render-state-snapshots',e.target.checked);setDiagnostics((d:any)=>({...d,renderQuality:profile}));setResult('绘制状态设置已保存，模型正在重新加载。');}catch(error:any){onError(error.message);}finally{if(mounted.current)setQualityChanging(false);}}}/>保留 SDK 状态快照（兼容对照）</label>
    <p className="hint">默认关闭，由桌宠直接管理画布状态，减少同步查询。如需对照旧路径可勾选；切换后请等模型重新加载。</p>
    <div className="button-row"><button disabled={!window.companion} onClick={async()=>{try{const report:any=await window.companion?.control('copy-performance');setResult(report?.available?'性能诊断已复制，请把内容发给排查问题的智能体。':'尚未收到模型渲染数据；诊断已复制，请等模型显示后再试。');}catch(e:any){onError(e.message);}}}>复制性能诊断</button></div>
    <p className="hint">复现卡顿后复制，可查看实际渲染设备和帧间隔。不包含聊天、密钥或模型路径。</p>
    <button disabled={!window.companion||qualityChanging||gpuCapturing} onClick={captureGpu}>{gpuCapturing?'等待诊断结果…':'采集 GPU 用时（15 秒）'}</button>
    <p className="hint">仅排查卡顿时使用。默认不采集；隐藏或重载模型会提前停止。结束后稍等几秒，再复制性能诊断。它测量模型绘制的 GPU 用时，不包含桌面合成与显示延迟。</p>
    {gpuMessage&&<p className="hint" role="status" data-gpu-timing-status>{gpuMessage}</p>}
  </details>;
}

export function DeveloperChestPreviews({onError}:{onError:(value:string)=>void}) {
  return <><h3 className="reaction-heading">点击反应预览</h3><div className="action-grid">{[
    {stage:1,title:'惊慌后害羞',sub:'吓一跳，再慢慢红了脸',icon:'😳'},
    {stage:2,title:'哼，不理你',sub:'红脸嗔怒，别过头去',icon:'😤'},
    {stage:3,title:'不许再闹啦',sub:'轻轻皱眉，认真责怪',icon:'😠'},
    {stage:4,title:'心动一下',sub:'被哄好啦，呼吸轻轻起伏',icon:'💕'},
  ].map(item=><button className="action-card" key={item.stage} data-chest-preview={item.stage} onClick={()=>window.companion?.control('chest-reaction',item.stage).catch(e=>onError(e.message))}><span className="action-icon">{item.icon}</span><strong>{item.title}</strong><small>{item.sub}</small></button>)}</div></>;
}
