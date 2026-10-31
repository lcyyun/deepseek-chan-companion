import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Option { id: string; title: string; icon: string }
interface Props { value: string; options: readonly Option[]; onChange: (value: string) => void }

/** Render inside the client viewport; native select popups can escape Electron's window. */
export function ExpressionSelect({ value, options, onChange }: Props) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 240, maxHeight: 288, direction: 'down' });
  const selected = options.findIndex(option => option.id === value);
  const option = options[Math.max(0, selected)];
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); };
  const show = () => { setActive(Math.max(0, selected)); setOpen(true); };
  const choose = (index: number) => { if (options[index]) onChange(options[index].id); close(true); };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
      const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight, margin = 8, gap = 5;
      if (anchor.bottom <= margin || anchor.top >= height - margin) { close(); return; }
      const below = Math.max(0, height - margin - anchor.bottom - gap), above = Math.max(0, anchor.top - margin - gap);
      const direction = below >= 288 || below >= above ? 'down' : 'up';
      const maxHeight = Math.min(288, direction === 'down' ? below : above);
      const menuWidth = Math.min(Math.max(240, anchor.width), Math.max(0, width - margin * 2));
      setPosition({ width: menuWidth, maxHeight, direction,
        left: Math.max(margin, Math.min(anchor.left, width - margin - menuWidth)),
        top: direction === 'down' ? Math.min(height - margin - maxHeight, anchor.bottom + gap) : Math.max(margin, anchor.top - gap - maxHeight),
      });
    };
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close(); };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place(); };
    const blur = () => close(), visibility = () => { if (document.hidden) close(); };
    place(); window.addEventListener('resize', place); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility); document.addEventListener('scroll', scroll, true); document.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('scroll', scroll, true); document.removeEventListener('pointerdown', outside, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const row = menu.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`);
    const list = menu.current;
    if (row && list) {
      if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [open, active, position.maxHeight]);
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open ? choose(active) : show(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) show(); else setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (open && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1);
    }
  }
  return <div className="expression-select">
    <span id={`${id}-label`}>当前表情</span>
    <button ref={trigger} type="button" role="combobox" aria-label="选择微调表情" aria-labelledby={`${id}-label ${id}-value`} aria-controls={`${id}-list`} aria-haspopup="listbox" aria-expanded={open} aria-activedescendant={open ? `${id}-option-${active}` : undefined} className="expression-select-trigger" onClick={() => open ? close() : show()} onKeyDown={keyDown}>
      <span id={`${id}-value`}>{option?.title}</span><span className="expression-select-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={menu} id={`${id}-list`} role="listbox" aria-label="表情列表" className="expression-select-menu" data-direction={position.direction} style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }} onPointerDown={event => { if ((event.target as Element).closest('[role=option]')) event.preventDefault(); }}>
      {options.map((item, index) => <div key={item.id} id={`${id}-option-${index}`} role="option" aria-selected={item.id === value} data-option-index={index} data-option-value={item.id} className={'expression-select-option' + (active === index ? ' active' : '')} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span aria-hidden="true">{item.icon}</span><span>{item.title}</span>{item.id === value && <span className="expression-select-check" aria-hidden="true">✓</span>}
      </div>)}
    </div>, document.body)}
  </div>;
}
