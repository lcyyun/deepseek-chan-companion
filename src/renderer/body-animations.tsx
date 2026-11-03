import React from 'react';
import { api } from './api';
import { BODY_ANIMATION_PRESETS } from '../shared/behavior.mjs';

const icons: Record<string, string> = { explain: '☝', think: '✧', reassure: '☁', happy: '♪', shy: '♡', listen: '◌' };
const groups = [
  { title: '连续讲述', ids: ['talk'] },
  { title: '左右手势', ids: ['chest-left', 'chest-right', 'chest-both', 'pointer-left', 'pointer-right'] },
  { title: '情境动作', ids: ['explain', 'think', 'reassure', 'happy', 'shy', 'listen'] },
];

/** Face previews and body previews have separate lifetimes and stop controls. */
export function BodyAnimationPreviews({ onError }: { onError: (message: string) => void }) {
  const send = (command: object) => api('/api/command', command).catch(error => onError(error.message));
  return <div className="body-animation-previews">
    <div className="section-intro"><h2>肢体动画</h2><p>选一段连续讲述，或单独播放左右手势。左右以画面为准，表情可在「小表情」中另选。</p></div>
    {groups.map(group => <section key={group.title} className="body-animation-group"><h3 className="reaction-heading">{group.title}</h3>
    <div className="action-grid">{BODY_ANIMATION_PRESETS.filter(preset => group.ids.includes(preset.id)).map(preset => <button className="action-card" data-body-animation={preset.id} key={preset.id}
      onClick={() => send({ type: 'body', animation: preset.id, intensity: .8, durationMs: preset.durationMs })}>
      <span className="action-icon" aria-hidden="true">{icons[preset.id] ?? (preset.id.startsWith('chest') ? '♡' : '☝')}</span><strong>{preset.title}</strong><small>{preset.description}</small>
    </button>)}</div></section>)}
    <div className="button-row"><button data-body-stop onClick={() => send({ type: 'body', active: false })}>结束肢体预览</button></div>
    <p className="hint">连续讲述包含轻柔的手指强调与停顿，说话时随语音持续。预览不会替换当前表情；摸头或敲盆时优先回应你的触碰。</p>
  </div>;
}
