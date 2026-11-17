'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Lane } from '@/server/types';
import { platform } from '@/lib/ui';
import { MachineButton } from './MachineButton';
import { LaneTile } from './LaneTile';

/* The ring already shows the platform, so a row drops a trailing " · <Platform>" from the lane name —
 * but only when what is left is unique. One account on four platforms would otherwise read as four
 * identical rows, told apart by a 16px icon alone, so those keep the platform as a quieter tail. */
const stripped = (l: Lane) => {
  const suffix = ` · ${platform(l.platform).label}`;
  return l.name.endsWith(suffix) ? l.name.slice(0, -suffix.length) : l.name;
};
function laneLabel(l: Lane, all: Lane[]) {
  const name = stripped(l);
  if (name === l.name || all.filter((o) => stripped(o) === name).length < 2) return <span className="lnn">{name}</span>;
  /* The platform is what tells these rows apart, so the name gives way first when space runs out. */
  return <span className="lnn two"><span className="lnm">{name}</span><span className="lnp">· {platform(l.platform).label}</span></span>;
}

type Scope = 'social' | 'ads' | 'email';
const SCOPES: Record<Scope, { label: string; icon: string; href: string }> = {
  social: { label: 'Social', icon: 'ph-chats-circle', href: '/' },
  ads: { label: 'Ads', icon: 'ph-megaphone', href: '/ads' },
  email: { label: 'Email', icon: 'ph-envelope-simple', href: '/email' },
};

/* The sidebar, riff 4's .side: mark, search, nav, lanes with today's counts, key hints. */
export function Side({ mode, lanes, counts, laneId, search, onSearch, scope = 'social', scopeCounts, moves, waiting, account }: {
  mode: 'today' | 'lanes' | 'previews' | 'account';
  /** Social, Ads or Email. The same places exist in each; the switcher decides which tree. */
  scope?: Scope;
  /** Today's count in each scope, for the switcher, when the page knows them. */
  scopeCounts?: Partial<Record<Scope, number>>;
  lanes: Lane[];
  counts?: Record<string, number>;
  laneId?: string;
  search?: string;
  onSearch?: (q: string) => void;
  previews?: number;
  /** True only where J/K and the arrows are actually wired, so the hint never promises what the
   *  page cannot do. Search is listed everywhere because this component owns it. */
  moves?: boolean;
  /** Posts on this page still waiting on a person. The current scope's count reads this instead. */
  waiting?: number;
  /** Every lane is one account: the section is named for it and the rows by platform alone. */
  account?: string;
}) {
  const box = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.current?.focus(); } };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  const base = SCOPES[scope].href === '/' ? '' : SCOPES[scope].href;
  return (
    <aside className="side">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="brand"><span className="wn">Aircheck</span><img src="/aircheck-mark.svg" alt="" /></div>
      <MachineButton />
      {/* Social, Ads and Email are the same places over different work, so the scope switches
          and the nav below it stays put. Three names do not fit side by side in the sidebar, so the
          switcher is one row that opens to all of them. */}
      {/* Three places, always in view: Social, Ads and Email, each with today's count. Each one is
          that day's review; previews are built from the button on it, not a place of their own. */}
      <nav className="nav">
        {(Object.keys(SCOPES) as Scope[]).map((k) => {
          const n = scopeCounts?.[k] ?? (k === scope ? total : undefined);
          const w = k === scope && waiting ? waiting : 0;
          return (
            <a key={k} className={k === scope && mode !== 'account' ? 'on' : undefined} href={SCOPES[k].href}>
              <i className={`ph ${SCOPES[k].icon}`}></i>{SCOPES[k].label}{w ? <span className="c rev5">{w} to review</span> : n ? <span className="c">{n}</span> : null}
            </a>
          );
        })}
      </nav>
      {/* "Lanes" was both a tab and this header. One of them, with the way through on it.
          A page with no lanes to list does not draw the section at all. */}
      {lanes.length ? (account
        ? <div className="sect acct5"><span>{account}</span></div>
        : <div className="sect"><span>{scope === 'ads' ? 'Platforms' : scope === 'email' ? 'Senders' : 'Lanes'}</span><span className="c num">{lanes.length}</span></div>) : null}
      <div className="lns">
      {lanes.map((l) => (
        /* Clicking the one you are already on takes the filter off, the way the rings do. */
        <a key={l.id} href={laneId === l.id ? base || '/' : `${base}/lanes/${l.id}`} className={`ln${laneId === l.id ? ' on' : ''}`} title={laneId === l.id ? `Show all ${scope === 'ads' ? 'platforms' : scope === 'email' ? 'senders' : 'lanes'}` : l.handle || l.name}>
          <LaneTile l={l} />
          {account ? <span className="lnn">{platform(l.platform).label}</span> : laneLabel(l, lanes)}<span className="c num">{counts?.[l.id] || ''}</span>
        </a>
      ))}
      </div>
      <label className="search foot">
        <i className="ph ph-magnifying-glass"></i>
        <input ref={box} value={search ?? ''} placeholder="Search or jump" aria-label="Search posts"
          onChange={(e) => onSearch?.(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !onSearch) router.push(`/?q=${encodeURIComponent(e.currentTarget.value)}`); if (e.key === 'Escape') { onSearch?.(''); e.currentTarget.blur(); } }} />
        <kbd>⌘K</kbd>
      </label>
      <a className={`ln acctln${mode === 'account' ? ' on' : ''}`} href="/account"><i className="ph ph-user-circle"></i><span className="lnn">Account</span></a>
      <div className="keys">{moves && waiting !== undefined ? <><kbd>A</kbd> approve, <kbd>H</kbd> hold<br /></> : null}{moves ? <><kbd>↑</kbd> <kbd>↓</kbd> move, <kbd>←</kbd> <kbd>→</kbd> slides<br /></> : null}<kbd>⌘</kbd> <kbd>K</kbd> search</div>
    </aside>
  );
}
