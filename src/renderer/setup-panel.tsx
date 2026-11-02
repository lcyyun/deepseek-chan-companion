import { useEffect, useId, useRef, useState } from 'react';
import './connection-panel.css';

type DshSession = { id: string; updatedAt?: number; cwd?: string };
type DshStatus = {
  cli?: string; home?: string; port?: number; open?: number[]; occupiedPorts?: number[];
  running?: boolean; homeExists?: boolean; hostVerified?: boolean;
  bridgeConnected?: boolean; chatAvailable?: boolean;
  toolsReady?: boolean | null; nativeToolsReady?: boolean | null; mcpReachable?: boolean;
  recoverySupported?: boolean; recoveryStatus?: string;
  connectionState?: 'configure_needed'|'reconnecting'|'ready'|'occupied'|'start_available'|'start_failed'|'upgrade_required';
  message?: string; canReconnect?: boolean; canStartConfigured?: boolean; requiresSetup?: boolean; installationValid?: boolean;
  sessions?: DshSession[]; mode?: 'new'|'existing'|''; savedSessionId?: string;
  patchPath?: string; launcherPath?: string; logPath?: string;
};
const control = (action: string, data?: any) => window.companion?.control(action, data);
function dateLabel(value?: number) { if(!value)return '';try{return new Date(value).toLocaleString();}catch{return '';} }

export function DshConnectPanel({ compact = false }: { compact?: boolean }) {
  const [status,setStatus]=useState<DshStatus|null>(null),[mode,setMode]=useState<'new'|'existing'|''>('');
  const [sessionId,setSessionId]=useState(''),[prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[copied,setCopied]=useState(false),[setupOpen,setSetupOpen]=useState(false),[diagnosticsOpen,setDiagnosticsOpen]=useState(false);
  const mounted=useRef(true), busyRef=useRef(false), draftDirty=useRef(false), requestSequence=useRef(0);
  const refreshPending=useRef<Promise<void>|null>(null),copyTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const modeGroup=useId();
  function receive(value:DshStatus) {
    if(!mounted.current||!value)return;
    setStatus(value);
    if(!draftDirty.current){
      setMode(value.mode==='existing'||value.mode==='new'?value.mode:'');
      setSessionId(value.savedSessionId||'');
    }
  }
  function refresh(manual=false):Promise<void> {
    if(refreshPending.current)return refreshPending.current;
    const request=++requestSequence.current;
    const pending=(async()=>{
      try{const value=await control('dsh-status') as DshStatus;if(mounted.current&&request===requestSequence.current){receive(value);if(manual)setError('');}}
      catch(e:any){if(mounted.current&&request===requestSequence.current)setError(e?.message||String(e));}
    })();
    refreshPending.current=pending;
    void pending.finally(()=>{if(refreshPending.current===pending)refreshPending.current=null;});
    return pending;
  }
  useEffect(()=>{
    mounted.current=true;void refresh();
    const timer=setInterval(()=>{if(!busyRef.current)void refresh();},5000);
    return()=>{mounted.current=false;requestSequence.current++;clearInterval(timer);clearTimeout(copyTimer.current);};
  },[]);
  function beginAction(){if(busyRef.current)return false;busyRef.current=true;requestSequence.current++;setBusy(true);setError('');return true;}
  function endAction(){busyRef.current=false;if(mounted.current)setBusy(false);}
  async function connect(start=false){
    if(start?!status?.canStartConfigured:!status?.canReconnect)return;
    if(!beginAction())return;
    try{
      const result=await control('dsh-connect',{start}) as DshStatus & {ok?:boolean};
      if(result)receive(result);
      // Refresh is read-only, never another connection or launch attempt.
      await refreshPending.current;
      if(mounted.current)await refresh();
    }catch(e:any){if(mounted.current)setError(e?.message||String(e));}
    finally{endAction();}
  }
  function editMode(value:'new'|'existing'){draftDirty.current=true;setMode(value);setPrompt('');setCopied(false);}
  function editSession(value:string){draftDirty.current=true;setSessionId(value);setPrompt('');setCopied(false);}
  async function generatePrompt(){
    if(!canGenerate||!beginAction())return;
    setCopied(false);
    try{
      const result=await control('dsh-prompt',{mode,sessionId:sessionId.trim()}) as any;
      if(!result?.prompt)throw Error('没有生成接入提示词。');
      if(mounted.current){setPrompt(String(result.prompt));draftDirty.current=false;await refreshPending.current;await refresh();}
    }catch(e:any){if(mounted.current)setError(e?.message||String(e));}
    finally{endAction();}
  }
  async function copyPrompt(){
    try{await control('copy-text',prompt);}
    catch{try{await navigator.clipboard.writeText(prompt);}catch{setError('复制失败，请手动选择文本框内容。');return;}}
    if(mounted.current){setCopied(true);clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>{if(mounted.current)setCopied(false);},1800);}
  }
  const connected=status?.bridgeConnected===true;
  const canGenerate=!!status?.cli&&!!status.homeExists&&!!mode&&(mode!=='existing'||!!sessionId.trim());
  const legacy=connected&&(status?.connectionState==='upgrade_required'||status?.recoveryStatus==='upgrade-required');
  const hostText=status?.hostVerified?'已确认实例':connected?'桥已连接，实例待确认':status?.running?'正在启动':status?.occupiedPorts?.length?'端口已占用，实例未确认':status?.cli?'未运行':'未找到';
  const toolsText=status?.toolsReady===true?'已确认可用':legacy?'待确认 · 需要升级桥':status?.nativeToolsReady===false?'DSH 中尚未发现角色工具':status?.mcpReachable?'MCP 可达，DSH 注册待确认':'待确认';
  const message=status?.message||(legacy?'聊天已连接，首次升级需重新加载桥插件。':status?.connectionState==='occupied'?'发现尚未确认的实例，请先检查接入配置。':connected?'聊天桥已连接，正在确认角色工具。':'首次接入请完成一次配置；之后直接连接即可。');

  return <div className={'dsh-panel'+(compact?' compact':'')} data-connection-state={status?.connectionState||'loading'}>
    <div className="dsh-heading"><strong>连接 DeepSeek Harness</strong><button className="text-button" data-dsh-action="diagnostics" disabled={busy} onClick={()=>{setDiagnosticsOpen(value=>!value);void refresh(true);}}>诊断</button></div>
    <p className="hint">已配置后可直接连接。桌宠重启会自动恢复，不需要每次重新发送接入提示词。</p>
    <div className="dsh-status-grid dsh-connection-status" aria-label="DSH 连接详情">
      <span>DSH 实例</span><b data-dsh-status="host">{status?hostText:'正在检查…'}</b>
      <span>聊天桥</span><b data-dsh-status="chat">{status?.chatAvailable?'已连接，可对话':connected?'已连接，尚未就绪':'未连接'}</b>
      <span>角色工具</span><b data-dsh-status="tools">{toolsText}</b>
    </div>
    <p className={`hint dsh-connection-message${status?.connectionState==='ready'?' ok':''}`} role="status">{message}</p>
    <div className="button-row dsh-main-actions">
      <button className="primary" data-dsh-action="connect" disabled={busy||!status?.canReconnect} onClick={()=>connect(false)}>{busy?'处理中…':connected?'重新连接':'连接'}</button>
      {status?.canStartConfigured&&<button data-dsh-action="start" disabled={busy} onClick={()=>connect(true)}>启动已配置的 DSH</button>}
      <button data-dsh-action="setup" disabled={busy} onClick={()=>setSetupOpen(value=>!value)}>{setupOpen?'收起配置':legacy?'升级接入':status?.requiresSetup?'首次配置':'接入配置'}</button>
      {connected&&<button data-dsh-action="open" disabled={busy} onClick={()=>control('dsh-open')?.catch((e:any)=>setError(e?.message||String(e)))}>打开 DSH</button>}
    </div>
    {status?.canStartConfigured&&<p className="hint">只启动已登记的实例，不会结束正在工作的 DSH。</p>}
    {diagnosticsOpen&&<div className="dsh-diagnostics" data-dsh-diagnostics>
      <div className="dsh-status-grid"><span>连接状态</span><b>{status?.connectionState||'检查中'}</b><span>DSH_HOME</span><b>{status?.home||'未检测到'}</b><span>端口</span><b>{status?.port||'未登记'}</b><span>配置登记</span><b>{status?.installationValid?'已验证':'待配置或需检查'}</b>{status?.occupiedPorts?.length?<><span>占用端口</span><b>{status.occupiedPorts.join('、')}</b></>:null}{status?.logPath?<><span>日志位置</span><b>{status.logPath}</b></>:null}</div>
      <button className="text-button" disabled={busy} onClick={()=>void refresh(true)}>重新检查状态</button>
    </div>}
    {setupOpen&&<div className="dsh-initial-setup" data-dsh-setup>
      <p className="hint">首次安装、改变 A/B 会话或升级桥插件时使用。普通重连不会改动这里的选择。</p>
      {!status?.cli&&<p className="hint warn">没有找到 DSH CLI。请先安装 DeepSeek Harness。</p>}
      {status?.cli&&!status.homeExists&&<p className="hint warn">没有找到 DSH_HOME：{status.home}</p>}
      <div className="dsh-mode" role="radiogroup" aria-label="选择会话模式">
        <label className={mode==='existing'?'selected':''}><input type="radio" name={modeGroup} value="existing" disabled={busy} checked={mode==='existing'} onChange={()=>editMode('existing')}/><span className="dsh-mode-badge">A</span><span className="dsh-mode-copy"><strong>接到已有会话</strong><small>继承该会话的人格和上下文；需要选择具体会话。</small></span></label>
        <label className={mode==='new'?'selected':''}><input type="radio" name={modeGroup} value="new" disabled={busy} checked={mode==='new'} onChange={()=>editMode('new')}/><span className="dsh-mode-badge">B</span><span className="dsh-mode-copy"><strong>独立桌宠会话</strong><small>首次创建并保存，之后复用，不重复新建。</small></span></label>
      </div>
      {mode==='existing'&&<div className="dsh-session-picker"><label>已有会话 ID<input data-dsh-session disabled={busy} value={sessionId} onChange={e=>editSession(e.target.value)} placeholder="session-..."/></label>{!!status?.sessions?.length&&<div className="dsh-session-list">{status.sessions.map(session=><button key={session.id} disabled={busy} className={sessionId===session.id?'selected':''} onClick={()=>editSession(session.id)}><span>{session.id}</span><small>{dateLabel(session.updatedAt)}</small></button>)}</div>}{!status?.sessions?.length&&<p className="hint">没有读到会话列表，可以直接粘贴会话 ID。</p>}</div>}
      <div className="button-row"><button data-dsh-action="generate" className="primary" disabled={busy||!canGenerate} onClick={generatePrompt}>{prompt?'重新生成配置与提示词':'准备配置与接入提示词'}</button></div>
      {prompt&&<div className="dsh-prompt"><p className="hint">将此提示词交给 DSH 完成首次安装或排错。已有配置的日常使用只需连接；确实需要重新加载插件时，提示词会说明。</p><textarea aria-label="DSH 接入提示词" readOnly value={prompt} rows={9} onFocus={e=>e.currentTarget.select()}/><div className="button-row"><button onClick={copyPrompt}>{copied?'已复制':'复制提示词'}</button></div></div>}
    </div>}
    {error&&<p className="dsh-error" role="alert">{error}</p>}
  </div>;
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [modelRoot, setModelRoot] = useState('');
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    control('diagnostics').then((value: any) => setModelRoot(value?.modelRoot || '')).catch(() => {});
  }, []);

  async function chooseModel() {
    setBusy(true); setError('');
    try {
      const folder = await control('choose-model');
      if (folder) setModelRoot(String(folder));
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true);
    try { await control('setup-complete'); onDone(); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return <div className="setup-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <div className="setup-card">
      <div className="setup-kicker">第一次见面</div>
      <h2 id="setup-title">先把大肥鱼安顿好</h2>
      <p className="hint">模型留在本机。只需要选一次，之后双击就能打开。</p>
      <div className="setup-step">
        <div className="setup-step-head"><span className={step >= 1 ? 'active' : ''}>1</span><strong>选择模型</strong></div>
        <p className="hint">{modelRoot ? `已选择：${modelRoot}` : '还没有选择模型文件夹。'}</p>
        <div className="button-row"><button className="primary" disabled={busy} onClick={chooseModel}>{busy ? '选择中…' : modelRoot ? '重新选择模型' : '选择模型文件夹'}</button>{modelRoot && <button onClick={() => setStep(2)}>下一步</button>}</div>
      </div>
      <div className="setup-step">
        <div className="setup-step-head"><span className={step >= 2 ? 'active' : ''}>2</span><strong>连接对话</strong></div>
        <p className="hint">已有 DSH 配置可直接连接；首次使用再完成一次接入配置。也可以稍后选择其他对话来源。</p>
        <DshConnectPanel compact />
      </div>
      {error && <p className="dsh-error">{error}</p>}
      <div className="setup-actions"><button disabled={busy} onClick={finish}>稍后设置</button><button className="primary" disabled={busy || !modelRoot} onClick={finish}>{busy ? '保存中…' : '完成'}</button></div>
      <p className="hint">之后可以在“设置 → 对话来源”里重新选择，不会删除模型或会话。</p>
    </div>
  </div>;
}
