'use client';

import { useEffect, useRef, useState } from 'react';

export type DocGroup = { label: string; items: { id: string; label: string }[] };

/* The docs' grouped sidebar. On a wide screen it sits beside the text and marks the section you are
 * reading; on a phone it folds into one sticky "On this page" menu above the text. */
export function DocsNav({ groups }: { groups: DocGroup[] }) {
  const ids = groups.flatMap((g) => g.items.map((i) => i.id));
  const [cur, setCur] = useState(ids[0]);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const pick = () => {
      const line = 120;
      let best = els[0]?.id;
      for (const el of els) if (el.getBoundingClientRect().top - line <= 0) best = el.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) best = els[els.length - 1]?.id;
      if (best) setCur(best);
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('resize', pick);
    return () => { window.removeEventListener('scroll', pick); window.removeEventListener('resize', pick); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const label = groups.flatMap((g) => g.items).find((i) => i.id === cur)?.label;
  const list = (close?: boolean) => groups.map((g) => (
    <div className="dn-g" key={g.label}>
      <span className="dn-l">{g.label}</span>
      {g.items.map((i) => (
        <a key={i.id} href={`#${i.id}`} aria-current={cur === i.id ? 'location' : undefined}
          onClick={close ? () => { if (menu.current) menu.current.open = false; } : undefined}>{i.label}</a>
      ))}
    </div>
  ));
  return (
    <>
      <nav className="dn" aria-label="Docs sections">{list()}</nav>
      <details className="dn-m" ref={menu}>
        <summary><span>On this page</span><b>{label}</b><i aria-hidden="true"></i></summary>
        <div className="dn-mb">{list(true)}</div>
      </details>
    </>
  );
}
