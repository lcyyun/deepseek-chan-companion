import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './settings-select.css';

export interface SettingsSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}
interface Props {
  id: string;
  label: string;
  value: string;
  options: readonly SettingsSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Client-side popup: native select surfaces may be clipped or lose focus in transparent windows. */
export function SettingsSelect({ id, label, value, options, onChange, disabled = false }: Props) {
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 240, maxHeight: 320, direction: 'down' });
  const selected = options.findIndex(option => option.value === value);
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); };
  const show = () => {
    if (disabled) return;
    setActive(selected >= 0 && !options[selected].disabled ? selected : enabled[0] ?? -1);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled || disabled) return;
    onChange(option.value); close(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    if (disabled) { close(); return; }
    const place = () => {
      const button = trigger.current, list = menu.current;
      if (!button || !list) return;
      const anchor = button.getBoundingClientRect();
      const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
      const margin = 8, gap = 5;
      if (anchor.bottom <= margin || anchor.top >= height - margin || anchor.right <= margin || anchor.left >= width - margin) { close(); return; }
      // A scrolled-away anchor can still be inside the viewport but hidden under
      // the settings panel's sticky/header area. Do not leave its popup floating.
      for (let parent = button.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (anchor.bottom <= box.top || anchor.top >= box.bottom)) { close(); return; }
      }
      const below = Math.max(0, height - margin - anchor.bottom - gap), above = Math.max(0, anchor.top - margin - gap);
      const wanted = Math.min(320, list.scrollHeight + 2);
      const direction = below >= wanted || below >= above ? 'down' : 'up';
      const maxHeight = Math.min(wanted, direction === 'down' ? below : above);
      const menuWidth = Math.min(Math.max(240, anchor.width), Math.max(0, width - margin * 2));
      const next = { width: menuWidth, maxHeight, direction,
        left: Math.max(margin, Math.min(anchor.left, width - margin - menuWidth)),
        top: direction === 'down' ? anchor.bottom + gap : Math.max(margin, anchor.top - gap - maxHeight),
      };
      setPosition(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close();
    };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place(); };
    const blur = () => close(), visibility = () => { if (document.hidden) close(); };
    place();
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place); window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility); document.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside, true);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true);
    };
  }, [open, disabled, options]);

  useLayoutEffect(() => {
    if (!open) return;
    if (active < 0 || !options[active] || options[active].disabled) {
      const first = options.findIndex(option => !option.disabled);
      if (active !== first) setActive(first);
      return;
    }
    const row = menu.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`), list = menu.current;
    if (row && list) {
      if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [open, active, options, position.maxHeight]);

  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open ? choose(active) : show(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) show();
      else {
        const current = enabled.indexOf(active), step = event.key === 'ArrowDown' ? 1 : -1;
        setActive(enabled[Math.max(0, Math.min(enabled.length - 1, current + step))] ?? -1);
      }
    } else if (open && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); setActive((event.key === 'Home' ? enabled[0] : enabled.at(-1)) ?? -1);
    }
  }

  return <div className="settings-select" data-settings-select={id}>
    <label id={`${id}-label`} htmlFor={id}>{label}</label>
    <button id={id} ref={trigger} type="button" role="combobox" disabled={disabled}
      aria-labelledby={`${id}-label`} aria-controls={`${id}-list`} aria-haspopup="listbox"
      aria-expanded={open} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
      className="settings-select-trigger" data-value={value} onClick={() => open ? close() : show()} onKeyDown={keyDown}>
      <span>{options[selected]?.label || '请选择'}</span><span className="settings-select-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div id={`${id}-list`} ref={menu} role="listbox" aria-labelledby={`${id}-label`}
      className="settings-select-menu" data-settings-menu={id} data-direction={position.direction}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
      onPointerDown={event => { if ((event.target as Element).closest('[role=option]')) event.preventDefault(); }}>
      {options.map((option, index) => <div id={`${id}-option-${index}`} key={option.value} role="option"
        aria-selected={value === option.value} aria-disabled={option.disabled || undefined}
        className={`settings-select-option${active === index ? ' active' : ''}${option.disabled ? ' unavailable' : ''}`}
        data-option-index={index} data-option-value={option.value}
        onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        <span className="settings-select-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        {option.value === value && <span className="settings-select-check" aria-hidden="true">✓</span>}
      </div>)}
    </div>, document.body)}
  </div>;
}
