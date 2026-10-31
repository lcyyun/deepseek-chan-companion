import React, { useEffect, useRef, useState } from 'react';
import { api, credentials, events } from './api';
import { ExpressionSelect } from './expression-select';
import { EXPRESSION_PRESETS } from '../shared/expressions.mjs';
import { EXPRESSION_TUNING_LIMITS, sanitizeExpressionTuning } from '../shared/expression-tuning.mjs';
import { sanitizeModelTuning, type ModelTuning, type ModelTuningUpdate } from '../shared/model-tuning.mjs';

type TuningKey = keyof typeof EXPRESSION_TUNING_LIMITS;
const FIELDS: { key: TuningKey; title: string; low: string; high: string }[] = [
  { key: 'intensity', title: '这个表情的幅度', low: '轻一点', high: '明显一些' },
  { key: 'smile', title: '嘴角', low: '向下', high: '上扬' },
  { key: 'eyeOpen', title: '眼睛开合', low: '收一点', high: '睁大些' },
  { key: 'brow', title: '眉毛高低', low: '低一点', high: '高一点' },
  { key: 'mouthOpen', title: '嘴巴开合', low: '合拢', high: '张开' },
  { key: 'blush', title: '脸红', low: '淡一点', high: '浓一点' },
];
const percent = (value: number, signed = false) => `${signed && value > 0 ? '+' : ''}${Math.round(value * 100)}%`;

export function ExpressionPanel({ onError }: { onError: (message: string) => void }) {
  const [tuning, setTuning] = useState<ModelTuning>(() => sanitizeModelTuning((credentials() as any).modelTuning));
  const current = useRef(tuning), request = useRef(0), selectedRef = useRef('happy');
  const [selected, setSelected] = useState('happy'), [group, setGroup] = useState('全部'), [previewing, setPreviewing] = useState(false);
  const previewId = useRef<string | null>(null), previewEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const renew = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), editor = useRef<HTMLDivElement>(null), mounted = useRef(true);
  const preset = EXPRESSION_PRESETS.find(item => item.id === selected) || EXPRESSION_PRESETS[0];
  const local = sanitizeExpressionTuning(tuning.expressionOverrides?.[selected]);
  const groups = ['全部', '趣味表情', ...new Set(EXPRESSION_PRESETS.map(item => item.group))];
  function apply(value: unknown, replace = false) { current.current = sanitizeModelTuning(value, replace ? undefined : current.current); setTuning(current.current); }
  function finishPreview() { clearTimeout(previewEnd.current); clearTimeout(renew.current); previewId.current = null; if (mounted.current) setPreviewing(false); }
  async function preview(id = selectedRef.current) {
    clearTimeout(renew.current); clearTimeout(previewEnd.current);
    const commandId = crypto.randomUUID(); previewId.current = commandId; setPreviewing(true);
    previewEnd.current = setTimeout(() => { if (previewId.current === commandId) finishPreview(); }, 20000);
    try { await api('/api/command', { id: commandId, type: 'perform', intent: 'neutral', emotion: id, gesture: 'none', intensity: 1, durationMs: 20000 }); }
    catch (error: any) { if (previewId.current === commandId) finishPreview(); onError(error.message || String(error)); }
  }
  function select(id: string, revealEditor = false) {
    selectedRef.current = id; setSelected(id); void preview(id);
    if (revealEditor) requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  async function change(value: ModelTuningUpdate) {
    const turn = ++request.current; apply(value);
    // The running preview receives setTuning immediately; one delayed command
    // renews its 20-second lifetime after a slider gesture finishes.
    clearTimeout(renew.current); renew.current = setTimeout(() => { if (mounted.current) void preview(); }, 200);
    try {
      const result: any = await window.companion?.control('model-tuning', value);
      if (mounted.current && turn === request.current && result) apply(result.tuning || result.modelTuning || result, true);
    } catch (error: any) { onError(error.message || String(error)); }
  }
  useEffect(() => {
    mounted.current = true;
    window.companion?.control('diagnostics').then((value: any) => { if (mounted.current && request.current === 0 && value?.modelTuning) apply(value.modelTuning, true); });
    const offDesktop = window.companion?.onEvent(event => { if (event.type === 'model-tuning') apply(event.tuning, true); });
    const off = events(event => {
      if (event.type === 'command' && event.command?.id !== previewId.current) finishPreview();
      if (event.type === 'chat-progress' || event.type === 'chat' || event.type === 'reply') finishPreview();
      if (event.type === 'state' && (event.state?.avatarState === 'thinking' || event.state === 'thinking')) finishPreview();
    });
    return () => { mounted.current = false; finishPreview(); offDesktop?.(); off(); };
  }, []);
  return <section className="panel-scroll expression-panel">
    <div className="section-intro"><h2>小表情</h2><p>轻点预览 20 秒。选择喜欢的表情，再微调成你的样子。</p></div>
    <label className="tuning-control expression-global"><span className="tuning-title"><strong>整体表情幅度</strong><output>{percent(tuning.expressionIntensity)}</output></span><span className="tuning-description">同时影响所有表情，保留各自的微调。</span><input data-expression-global type="range" aria-label="整体表情幅度" min="0" max="1.5" step=".01" value={tuning.expressionIntensity} onChange={event => change({ expressionIntensity: Number(event.target.value) })} /><span className="tuning-scale"><span>0%</span><span>150%</span></span></label>
    <div className="expression-groups" aria-label="表情分组">{groups.map(name => <button key={name} aria-pressed={group === name} onClick={() => setGroup(name)}>{name}</button>)}</div>
    <div className="expression-grid">{EXPRESSION_PRESETS.filter(item => group === '全部' || item.group === group || group === '趣味表情' && (item.specialEyes || ['key1','key2','key9','key13'].some(key => item.parameters[key] > 0))).map(item => <button key={item.id} data-expression={item.id} className="expression-card" aria-pressed={selected === item.id} onClick={() => select(item.id, true)}><span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong>{(item.specialEyes || item.parameters.key2 > 0 || item.parameters.key9 > 0 || item.parameters.key13 > 0 || item.parameters.key1 > 0) && <em>{item.specialEyes ? '眼型' : item.parameters.key2 > 0 ? '泪滴' : item.parameters.key9 > 0 ? '兔牙' : item.parameters.key13 > 0 ? '汗滴' : '脸影'}</em>}<small>{item.description}</small></button>)}</div>
    <div ref={editor} className="expression-editor">
      <div className="expression-editor-heading"><div><h3>微调这个表情</h3><p>{previewing ? '正在预览 · 调节后续预览 20 秒' : '选择或调节，即可在桌宠上预览'}</p></div><button onClick={() => preview()}>预览</button></div>
      <ExpressionSelect value={selected} options={EXPRESSION_PRESETS} onChange={select}/>
      {selected === 'smug' && <p className="expression-note">这款表情使用固定的三角嘴，嘴角和开合变化较小；眉眼与脸红仍可微调。</p>}
      <div className="expression-adjustments">{FIELDS.map(({ key, title, low, high }) => <label className="tuning-control" key={key}><span className="tuning-title"><strong>{title}</strong><output>{percent(local[key], key !== 'intensity')}</output></span><input data-expression-tuning={key} type="range" aria-label={`${preset.title}·${title}`} min={EXPRESSION_TUNING_LIMITS[key].min} max={EXPRESSION_TUNING_LIMITS[key].max} step=".01" value={local[key]} onChange={event => change({ expressionOverrides: { [selected]: { [key]: Number(event.target.value) } } })} /><span className="tuning-scale"><span>{low}</span><span>{high}</span></span></label>)}</div>
      <div className="button-row expression-tools"><button onClick={() => change({ expressionOverrides: { [selected]: null } })}>重置这个表情</button><button onClick={() => change({ expressionOverrides: null })}>重置全部微调</button><button disabled={!previewing} onClick={() => { finishPreview(); api('/api/stop', {}).catch(error => onError(error.message)); }}>结束预览</button></div>
      <p className="hint">微调自动保存。表情预览不附带手势；说话时口型继续跟随语音。</p>
    </div>
  </section>;
}
