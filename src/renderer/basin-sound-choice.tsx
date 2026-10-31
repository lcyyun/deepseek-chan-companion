import React, { useEffect, useRef, useState } from 'react';
import { credentials, events } from './api';
import { BasinSound } from './basin-audio';
import { sanitizeModelTuning } from '../shared/model-tuning.mjs';

export function BasinSoundChoice({ onError }: { onError: (message: string) => void }) {
  const [tuning, setTuning] = useState(() => sanitizeModelTuning((credentials() as any).modelTuning));
  const player = useRef(new BasinSound());
  useEffect(() => {
    let mounted = true;
    const apply = (value: unknown) => { if (mounted) setTuning(sanitizeModelTuning(value)); };
    window.companion?.control('diagnostics').then((value: any) => { if (value?.modelTuning) apply(value.modelTuning); });
    const off = window.companion?.onEvent(event => { if (event.type === 'model-tuning') apply(event.tuning); });
    const offCommands = events(event => { if (event.type === 'command' && ['stop', 'reset'].includes(event.command?.type || event.data?.type)) player.current.stop(); });
    const visibility = () => { if (document.hidden) player.current.stop(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted = false; off?.(); offCommands(); document.removeEventListener('visibilitychange', visibility); player.current.destroy(); };
  }, []);
  useEffect(() => { player.current.setVolume(tuning.knockVolume); player.current.setSound(tuning.knockSound); }, [tuning.knockVolume, tuning.knockSound]);
  async function choose(knockSound: 'basin' | 'pipe') {
    try { const result = await window.companion?.control('model-tuning', { knockSound }); if (result) setTuning(sanitizeModelTuning(result)); }
    catch (error: any) { onError(error.message || String(error)); }
  }
  return <div className="basin-sound-choice">
    <div className="basin-sound-heading"><strong>敲击音效</strong><button onClick={() => player.current.play().catch(error => onError(error.message || String(error)))}>试听</button></div>
    <div className="basin-sound-options" role="group" aria-label="敲击音效">
      <button data-knock-sound="basin" aria-pressed={tuning.knockSound === 'basin'} onClick={() => choose('basin')}>金属敲盆</button>
      <button data-knock-sound="pipe" aria-pressed={tuning.knockSound === 'pipe'} onClick={() => choose('pipe')}>钢管掉落</button>
    </div>
    <p className="hint">切换后自动记住，音量由“敲盆音量”控制。</p>
  </div>;
}
