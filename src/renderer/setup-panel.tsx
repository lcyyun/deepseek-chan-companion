import { useEffect, useState } from 'react';

type DshSession = { id: string; updatedAt?: number; cwd?: string };
type DshStatus = {
  cli?: string;
  home?: string;
  port?: number;
  open?: number[];
  running?: boolean;
  homeExists?: boolean;
  bridgeConnected?: boolean;
  chatAvailable?: boolean;
  sessions?: DshSession[];
  mode?: 'new' | 'existing' | '';
  savedSessionId?: string;
  logPath?: string;
  patchPath?: string;
};

const control = (action: string, data?: any) => window.companion?.control(action, data);

function dateLabel(value?: number) {
  if (!value) return '';
  try { return new Date(value).toLocaleString(); } catch { return ''; }
}

export function DshConnectPanel({ onConnected, compact = false }: { onConnected?: () => void; compact?: boolean }) {
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [mode, setMode] = useState<'new' | 'existing' | ''>('');
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [warning, setWarning] = useState(false);
  const [countdown, setCountdown] = useState(3);

  async function refresh() {
    try {
      const value = await control('dsh-status') as DshStatus;
      setStatus(value);
      if (value.mode === 'existing' || value.mode === 'new') setMode(value.mode);
      else if (!value.savedSessionId) setMode('');
      if (value.savedSessionId) setSessionId(value.savedSessionId);
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!warning) return;
    setCountdown(3);
    const timer = setInterval(() => setCountdown(value => {
      if (value <= 1) { clearInterval(timer); return 0; }
      return value - 1;
    }), 1000);
    return () => clearInterval(timer);
  }, [warning]);

  async function connect() {
    setBusy(true); setError(''); setResult('');
    try {
      const value = await control('dsh-connect', { mode, sessionId: sessionId.trim() }) as any;
      if (value?.requiresManualStop || value?.requiresRestart) {
        setWarning(true);
        setResult('DSH 正在运行，需要你手动退出后才能连接。');
      } else if (value?.connected) {
        setWarning(false);
        setResult(value.alreadyConnected ? 'DSH 已经连接。' : `已连接 DSH${value.port ? ` · 端口 ${value.port}` : ''}。`);
        await refresh();
        onConnected?.();
      } else {
        setResult('DSH 连接没有返回结果。');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.bridgeConnected === true;
  const canConnect = !!status?.cli && !!status?.homeExists && !connected;

  return <div className={'dsh-panel' + (compact ? ' compact' : '')}>
    <div className="dsh-heading"><strong>连接 DeepSeek Harness</strong><button className="text-button" disabled={busy} onClick={refresh}>刷新状态</button></div>
    <p className="hint">使用同一个 DSH_HOME 和现有 profile，不新建独立实例。连接前会先检查当前 DSH 是否正在运行。</p>
    <div className="dsh-status-grid">
      <span>DSH</span><b>{status?.running ? '正在运行' : status?.cli ? '未运行' : '未找到'}</b>
      <span>聊天桥</span><b>{connected ? '已连接' : status?.chatAvailable ? '已就绪' : '未连接'}</b>
      <span>DSH_HOME</span><b title={status?.home}>{status?.home || '未检测到'}</b>
    </div>
    {!status?.cli && <p className="hint warn">没有找到 DSH CLI。请先安装 DeepSeek Harness，或在高级设置中填写 DSH 路径。</p>}
    {status?.cli && !status.homeExists && <p className="hint warn">没有找到 DSH_HOME：{status.home}</p>}
    {connected && <p className="hint ok">皮套已经接到当前 DSH。可以直接聊天，或点“打开 DSH”查看会话。</p>}
    {!connected && <div className="dsh-mode" role="radiogroup" aria-label="选择会话模式">
      <label className={mode === 'existing' ? 'selected' : ''}>
        <input type="radio" name="dsh-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} />
        <span className="dsh-mode-badge">A</span>
        <span className="dsh-mode-copy"><strong>接到已有会话</strong><small>继承该会话的人格和上下文；需要选择具体会话。</small></span>
      </label>
      <label className={mode === 'new' ? 'selected' : ''}>
        <input type="radio" name="dsh-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
        <span className="dsh-mode-badge">B</span>
        <span className="dsh-mode-copy"><strong>新建独立桌宠会话</strong><small>不继承当前聊天上下文；会话 ID 会自动保存。</small></span>
      </label>
    </div>}
    {!connected && mode === 'existing' && <div className="dsh-session-picker">
      <label>已有会话 ID<input value={sessionId} onChange={e => setSessionId(e.target.value)} placeholder="session-..." /></label>
      {!!status?.sessions?.length && <div className="dsh-session-list">{status.sessions.map(session => <button key={session.id} className={sessionId === session.id ? 'selected' : ''} onClick={() => setSessionId(session.id)}><span>{session.id}</span><small>{dateLabel(session.updatedAt)}</small></button>)}</div>}
      {!status?.sessions?.length && <p className="hint">没有读到会话列表，可以直接粘贴会话 ID。</p>}
    </div>}
    <div className="button-row">
      {!connected && <button className="primary" disabled={busy || !canConnect || !mode || (mode === 'existing' && !sessionId.trim())} onClick={() => connect()}>{busy ? '连接中…' : mode ? '连接 DSH' : '先选择会话模式'}</button>}
      {connected && <button className="primary" onClick={() => control('dsh-open').catch((e: any) => setError(e?.message || String(e)))}>打开 DSH</button>}
    </div>
    {result && <p className={'dsh-result ' + (connected ? 'ok' : '')}>{result}</p>}
    {error && <p className="dsh-error">{error}</p>}
    {!!status?.logPath && <p className="hint">日志：{status.logPath}</p>}
    {warning && <div className="dsh-warning" role="dialog" aria-modal="true" aria-labelledby="dsh-warning-title">
      <div className="dsh-warning-card">
        <h3 id="dsh-warning-title">DSH 正在运行</h3>
        <p>大肥鱼不会关闭 DSH。请先在 DSH 中完成任务并保存，然后手动退出 DSH；退出后再点“连接 DSH”即可自动连接。</p>
        <p className="dsh-countdown">倒计时：{countdown} 秒</p>
        <div className="button-row">
          <button className="danger" disabled={countdown > 0} onClick={() => { setWarning(false); setResult('请手动退出 DSH，然后点“连接 DSH”重试。'); }}>{countdown > 0 ? `请先完成任务（${countdown}）` : '我已知晓，去手动停止'}</button>
          <button onClick={() => { setWarning(false); setResult('已取消。'); }}>取消</button>
        </div>
      </div>
    </div>}
  </div>;
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [modelRoot, setModelRoot] = useState('');
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

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
        <p className="hint">连接本机 DSH，或者稍后在设置里选择 API / Codex。连接 DSH 不会新建独立实例。</p>
        <DshConnectPanel compact onConnected={() => setConnected(true)} />
        {connected && <p className="hint ok">DSH 已连接。点“完成”开始使用。</p>}
      </div>
      {error && <p className="dsh-error">{error}</p>}
      <div className="setup-actions"><button disabled={busy} onClick={finish}>稍后设置</button><button className="primary" disabled={busy || !modelRoot} onClick={finish}>{busy ? '保存中…' : '完成'}</button></div>
      <p className="hint">之后可以在“设置 → 对话来源”里重新选择，不会删除模型或会话。</p>
    </div>
  </div>;
}
