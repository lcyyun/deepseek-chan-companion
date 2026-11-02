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
};

const control = (action: string, data?: any) => window.companion?.control(action, data);

function dateLabel(value?: number) {
  if (!value) return '';
  try { return new Date(value).toLocaleString(); } catch { return ''; }
}

export function DshConnectPanel({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [mode, setMode] = useState<'new' | 'existing' | ''>('');
  const [sessionId, setSessionId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const value = await control('dsh-status') as DshStatus;
      setStatus(value);
      if (value.mode === 'existing' || value.mode === 'new') setMode(value.mode);
      if (value.savedSessionId) setSessionId(value.savedSessionId);
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, []);

  async function generatePrompt() {
    setBusy(true); setError(''); setCopied(false);
    try {
      const value = await control('dsh-prompt', { mode, sessionId: sessionId.trim() }) as any;
      setPrompt(String(value?.prompt || ''));
      if (!value?.prompt) setError('没有生成接入提示词。');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    try {
      await control('copy-text', prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); }
      catch { setError('复制失败，请手动选择文本框内容。'); }
    }
  }

  const connected = status?.bridgeConnected === true;
  const canGenerate = !!status?.cli && !!status?.homeExists && !!mode && (mode !== 'existing' || !!sessionId.trim());

  return <div className={'dsh-panel' + (compact ? ' compact' : '')}>
    <div className="dsh-heading"><strong>连接 DeepSeek Harness</strong><button className="text-button" disabled={busy} onClick={refresh}>刷新状态</button></div>
    <p className="hint">不自动启动 DSH。把生成的一段提示词交给你的 DSH 智能体，让它完成桥接。</p>
    <div className="dsh-status-grid">
      <span>DSH</span><b>{status?.running ? '正在运行' : status?.cli ? '未运行' : '未找到'}</b>
      <span>聊天桥</span><b>{connected ? '已连接' : '未连接'}</b>
      <span>DSH_HOME</span><b title={status?.home}>{status?.home || '未检测到'}</b>
    </div>
    {!status?.cli && <p className="hint warn">没有找到 DSH CLI。请先安装 DeepSeek Harness。</p>}
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
    {!connected && <div className="button-row">
      <button className="primary" disabled={busy || !canGenerate} onClick={generatePrompt}>{busy ? '生成中…' : prompt ? '重新生成提示词' : '生成接入提示词'}</button>
    </div>}
    {connected && <div className="button-row"><button onClick={() => control('dsh-open').catch((e: any) => setError(e?.message || String(e)))}>打开 DSH</button></div>}
    {prompt && <div className="dsh-prompt">
      <p className="hint">把下面这段完整复制给你的 DSH 智能体。它完成后会提示你重启 DSH。</p>
      <textarea readOnly value={prompt} rows={9} onFocus={e => e.currentTarget.select()} />
      <div className="button-row"><button className="primary" onClick={copyPrompt}>{copied ? '已复制' : '复制提示词'}</button></div>
    </div>}
    {error && <p className="dsh-error">{error}</p>}
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
        <p className="hint">可以现在生成 DSH 接入提示词，也可以稍后在设置里选择 API / Codex。</p>
        <DshConnectPanel compact />
      </div>
      {error && <p className="dsh-error">{error}</p>}
      <div className="setup-actions"><button disabled={busy} onClick={finish}>稍后设置</button><button className="primary" disabled={busy || !modelRoot} onClick={finish}>{busy ? '保存中…' : '完成'}</button></div>
      <p className="hint">之后可以在“设置 → 对话来源”里重新选择，不会删除模型或会话。</p>
    </div>
  </div>;
}
