import React from 'react';
import { api } from './api';
import { BODY_ANIMATION_PRESETS } from '../shared/behavior.mjs';

const icons: Record<string, string> = { explain: '☝', think: '✧', reassure: '☁', happy: '♪', shy: '♡', listen: '◌' };

/** Face previews and body previews have separate lifetimes and stop controls. */
export function BodyAnimationPreviews({ onError }: { onError: (message: string) => void }) {
  const send = (command: object) => api('/api/command', command).catch(error => onError(error.message));
  return <div className="body-animation-previews">
    <div className="section-intro"><h2>肢体动画</h2><p>单独检查手势、视线和身体配合。可以搭配「小表情」自由预览。</p></div>
    <div className="action-grid">{BODY_ANIMATION_PRESETS.map(preset => <button className="action-card" data-body-animation={preset.id} key={preset.id}
      onClick={() => send({ type: 'body', animation: preset.id, intensity: .8, durationMs: preset.durationMs })}>
      <span className="action-icon" aria-hidden="true">{icons[preset.id]}</span><strong>{preset.title}</strong><small>{preset.description}</small>
    </button>)}</div>
    <div className="button-row"><button data-body-stop onClick={() => send({ type: 'body', active: false })}>结束肢体预览</button></div>
    <p className="hint">每组包含起势、停留和收尾；不会替换当前表情。摸头或敲盆时优先回应你的触碰。</p>
  </div>;
}
