'use client';

import { useEffect, useId, useRef, useState } from 'react';

/* A select drawn by us. The native control paints its own menu from the operating system, which
 * ignores the product's type, colour and radius entirely — so a page that is otherwise ours ends
 * up with a Mac dropdown in the middle of it.
 *
 * It keeps the keyboard contract of the real thing, because that is the part people actually rely
 * on: arrows move, Home and End jump, Enter and Space choose, Escape closes and returns focus,
 * typing jumps to a matching option. It is a button plus a listbox, labelled as one. */

export type Option = { value: string; label: string; note?: string };

export function Select({ value, options, onChange, label, placeholder }: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ s: '', t: 0 });
  const id = useId();

  const current = options.find((o) => o.value === value);
  const shown = current?.label || placeholder || 'Choose';

  /* Opening lands on whatever is chosen, decided here rather than in an effect: a setState out of
   * an effect body cascades a render. */
  const show = () => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i < 0 ? 0 : i);
    setOpen(true);
  };

  /* Clicking anywhere else closes it, the way a real menu behaves. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[data-active="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const choose = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); btn.current?.focus(); };

  /* Typing jumps to the next option starting with what was typed, within a second. */
  function jump(key: string) {
    const now = Date.now();
    typed.current.s = now - typed.current.t < 1000 ? typed.current.s + key : key;
    typed.current.t = now;
    const q = typed.current.s.toLowerCase();
    const from = active + (typed.current.s.length === 1 ? 1 : 0);
    const order = [...options.slice(from), ...options.slice(0, from)];
    const hit = order.find((o) => o.label.toLowerCase().startsWith(q));
    if (hit) setActive(options.indexOf(hit));
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); show(); return;
    }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((n) => Math.min(n + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((n) => Math.max(n - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) jump(e.key);
  }

  return (
    <div className={`sel${open ? ' open' : ''}`} ref={box}>
      <button
        type="button" ref={btn} className="selb" onKeyDown={onKey} onClick={() => (open ? setOpen(false) : show())}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label} id={`${id}-b`}
      >
        <span className="selv">{shown}</span>
        <i className="ph ph-caret-down" aria-hidden></i>
      </button>
      {open ? (
        <div className="selm" role="listbox" ref={list} aria-labelledby={`${id}-b`} tabIndex={-1}>
          {options.map((o, i) => (
            <div
              key={o.value} role="option" aria-selected={o.value === value} data-active={i === active ? '1' : '0'}
              className={`selo${i === active ? ' on' : ''}${o.value === value ? ' is' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(i); }}
            >
              <span>{o.label}{o.note ? <small>{o.note}</small> : null}</span>
              {o.value === value ? <i className="ph-bold ph-check" aria-hidden></i> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
