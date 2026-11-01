import React, { useEffect, useRef, useState } from 'react';
import { events } from './api';
import './orbit-toggle.css';

type Hold = { id: number; session: string; x: number; y: number; lastX: number; lastY: number; dragging: boolean };

/** Screen coordinates stay stable while the small native window moves under us. */
export function OrbitToggle() {
  const [state, setState] = useState('idle'), [dragging, setDragging] = useState(false), [error, setError] = useState('');
  const held = useRef<Hold | null>(null), button = useRef<HTMLButtonElement>(null), epoch = useRef(0);
  function send(action: string, value?: unknown) {
    return window.companion?.control(action, value).catch((e: any) => { setError(String(e?.message || e)); });
  }
  function move(point: { screenX: number; screenY: number }) {
    const hold = held.current;
    if (!hold) return;
    if (!hold.dragging && Math.hypot(point.screenX - hold.x, point.screenY - hold.y) >= 5) {
      hold.dragging = true; setDragging(true);
    }
    if (hold.dragging && (point.screenX !== hold.lastX || point.screenY !== hold.lastY)) {
      send('toggle-drag', { phase: 'move', id: hold.session, x: point.screenX, y: point.screenY });
      hold.lastX = point.screenX; hold.lastY = point.screenY;
    }
  }
  function end(openChat = false) {
    const hold = held.current; if (!hold) return;
    const turn = epoch.current;
    held.current = null; setDragging(false);
    if (button.current?.hasPointerCapture(hold.id)) button.current.releasePointerCapture(hold.id);
    // Native polling can observe a drag before Chromium emits pointermove.
    // Wait for its result before deciding that this was a click.
    void send('toggle-drag', { phase: 'end', id: hold.session, cancelled: !openChat })?.then((result: any) => {
      if (openChat && epoch.current === turn && !hold.dragging && result && !result.moved && !result.cancelled) send('toggle-chat');
    });
  }
  useEffect(() => {
    const off = events(e => {
      if (e.type === 'state') {
        const next = typeof e.state === 'string' ? e.state : e.state?.avatarState || e.state?.state;
        if (next) setState(next);
      }
      if (e.type === 'command' && e.command?.type === 'state') setState(e.command.state);
    });
    const offDesktop = window.companion?.onEvent(event => {
      if (event.type === 'toggle-drag-state' && held.current?.session === event.id && event.moved) {
        held.current.dragging = true; setDragging(true);
      }
      if (event.type === 'toggle-drag-end' && held.current?.session === event.id) {
        held.current.dragging ||= event.moved;
        end(!event.cancelled);
      }
    });
    const cancel = () => { epoch.current++; end(); }, visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', visibility);
    return () => { cancel(); off(); offDesktop?.(); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <button ref={button} type="button" className={`orbit-switch ${state}${dragging ? ' orbit-dragging' : ''}`}
    title={error || '轻点聊天 · 拖动悬浮球 · 右键菜单可退出 · Ctrl+Alt+Space'} aria-label="打开便携聊天窗口，可拖动位置，右键打开桌宠菜单"
    onPointerDown={e => {
      if (e.button !== 0 || held.current) return;
      e.preventDefault(); setError('');
      epoch.current++;
      held.current = { id: e.pointerId, session: crypto.randomUUID(), x: e.screenX, y: e.screenY, lastX: e.screenX, lastY: e.screenY, dragging: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      send('toggle-drag', { phase: 'start', id: held.current.session, x: e.screenX, y: e.screenY });
    }}
    onPointerMove={e => { if (held.current?.id === e.pointerId) { if (e.buttons === 0) end(); else move(e); } }}
    onPointerUp={e => { if (held.current?.id === e.pointerId) { move(e); end(true); } }}
    onPointerCancel={() => end()} onLostPointerCapture={() => end()}
    onClick={e => { e.preventDefault(); if (e.detail === 0) send('toggle-chat'); }}
    onContextMenu={e => { e.preventDefault(); epoch.current++; end(); setError(''); send('toggle-menu'); }}
    onDragStart={e => e.preventDefault()}>
    <img className="orbit-logo" width="38" height="30" src="/icons/deepseek.svg" alt="DeepSeek" draggable={false}/>
    <span className="switch-dot"/>
  </button>;
}
