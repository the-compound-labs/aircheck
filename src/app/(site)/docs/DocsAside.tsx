'use client';

import { useEffect, useState } from 'react';
import '@phosphor-icons/web/regular';
import { COPY } from '../copy';

/* THE DOCS' RIGHT RAIL (review 2026-11-16, item 43, after Helicone's and Langfuse's docs): at 1280
 * and wider, "On this page" lists the headings of the section you are reading, and a button copies the
 * whole page as text for your agent, since the reader is often an agent. Narrower, only the button
 * shows, above the text. */
export function DocsAside() {
  const [heads, setHeads] = useState<{ id: string; text: string; lvl: number }[]>([]);
  const [cur, setCur] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.dc-main h2[id], .dc-main h3[id]')];
    const all = els.map((e) => ({ id: e.id, text: e.textContent || '', lvl: e.tagName === 'H2' ? 2 : 3 }));
    const pick = () => {
      let best = all[0]?.id || '';
      for (const e of els) if (e.getBoundingClientRect().top - 140 <= 0) best = e.id;
      setCur(best);
      const k = all.findIndex((h) => h.id === best);
      let s = k; while (s > 0 && all[s].lvl !== 2) s--;
      let e = s + 1; while (e < all.length && all[e].lvl !== 2) e++;
      setHeads(all.slice(Math.max(0, s), e));
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    return () => window.removeEventListener('scroll', pick);
  }, []);
  const copy = () => {
    const main = document.querySelector('.dc-main') as HTMLElement | null;
    if (!main) return;
    navigator.clipboard?.writeText(`# Aircheck docs\n${window.location.origin}/docs\n\n${main.innerText}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2400); });
  };
  return (
    <aside className="dc-aside" aria-label="On this page">
      <button type="button" className="dc-copy" onClick={copy}><i className={`ph ${copied ? 'ph-check' : 'ph-copy'}`} aria-hidden="true"></i>{copied ? COPY.rd2_docs_copied : COPY.rd2_docs_copy}</button>
      {heads.length ? (
        <nav className="dc-toc">
          <span className="dn-l">On this page</span>
          {heads.map((h) => <a key={h.id} href={`#${h.id}`} className={h.lvl === 3 ? 'l3' : undefined} aria-current={cur === h.id ? 'location' : undefined}>{h.text}</a>)}
        </nav>
      ) : null}
    </aside>
  );
}

type Tab = { id: string; label: string; img?: string; cap: string; code: React.ReactNode };
/** The MCP block in tabs, one per client (item 43). */
export function ClientTabs({ tabs }: { tabs: Tab[] }) {
  const [on, setOn] = useState(tabs[0].id);
  const t = tabs.find((x) => x.id === on) || tabs[0];
  return (
    <div className="dc-tabs">
      <div className="dc-tabs-h" role="tablist" aria-label="MCP client">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === on} className={x.id === on ? 'on' : undefined} onClick={() => setOn(x.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {x.img ? <img src={x.img} alt="" width={14} height={14} /> : null}{x.label}
          </button>
        ))}
      </div>
      <figure className="code" role="tabpanel"><div className="cap">{t.cap}</div><pre>{t.code}</pre></figure>
    </div>
  );
}
