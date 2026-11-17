import type { Lane } from '@/server/types';
import { Rail, type Place } from './Rail';

type Scope = 'social' | 'ads' | 'email';
type Mode = 'lanes' | 'previews' | 'account';

/* The sub-places of each tree. Social has Today, Lanes and Runs on the rail; Ads and Email keep
 * their own lanes and runs one tab away. */
const TABS: Record<Exclude<Scope, 'social'>, { href: string; label: string; mode: Mode | 'board' }[]> = {
  ads: [{ href: '/ads', label: 'Board', mode: 'board' }, { href: '/ads/lanes', label: 'Platforms', mode: 'lanes' }, { href: '/ads/runs', label: 'Runs', mode: 'previews' }],
  email: [{ href: '/email', label: 'Inbox', mode: 'board' }, { href: '/email/lanes', label: 'Senders', mode: 'lanes' }, { href: '/email/runs', label: 'Runs', mode: 'previews' }],
};

const placeOf = (mode: Mode | 'board', scope: Scope): Place => (mode === 'account' ? 'account' : scope === 'ads' ? 'ads' : scope === 'email' ? 'email' : mode === 'lanes' ? 'lanes' : 'runs');
const CRUMB: Record<Scope, string> = { social: '', ads: 'Ads', email: 'Email' };

export function ScopeTabs({ scope, mode }: { scope: Exclude<Scope, 'social'>; mode: Mode | 'board' }) {
  return (
    <nav className="ac-tabs" aria-label={scope === 'ads' ? 'Ads' : 'Email'}>
      {TABS[scope].map((t) => <a key={t.href} href={t.href} className={t.mode === mode ? 'on' : undefined} aria-current={t.mode === mode ? 'page' : undefined}>{t.label}</a>)}
    </nav>
  );
}

/* Lanes, Runs, the Ads board, Account: the rail, a thin bar that says where you are, the page's
 * serif title with its one-line summary and its actions, then the page. */
export function Frame({ mode, scope = 'social', title, sub, right, crumbs, children, wide }: {
  mode: Mode | 'board'; scope?: Scope; lanes?: Lane[]; laneId?: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode;
  /** Extra crumbs after the place, e.g. a lane's name. */
  crumbs?: React.ReactNode; children: React.ReactNode; wide?: boolean;
}) {
  const place = placeOf(mode, scope);
  const placeName = mode === 'account' ? 'Account' : scope !== 'social' ? CRUMB[scope] : mode === 'lanes' ? 'Lanes' : 'Runs';
  return (
    <div className="ac-shell">
      <Rail place={place} />
      <main className={`ac-page${wide ? ' wide' : ''}`}>
        <div className="ac-crumbs">
          <a href="/">Aircheck</a><i className="ph ph-caret-right" aria-hidden></i>
          {crumbs ? <><a href={scope === 'ads' ? '/ads' : scope === 'email' ? '/email' : mode === 'lanes' ? '/lanes' : '/runs'}>{placeName}</a><i className="ph ph-caret-right" aria-hidden></i>{crumbs}</> : <b>{placeName}</b>}
        </div>
        <header className="ac-head">
          <div className="ac-head-t">
            <h1>{title}</h1>
            {sub ? <p>{sub}</p> : null}
          </div>
          {right ? <div className="ac-head-r">{right}</div> : null}
        </header>
        {scope !== 'social' && mode !== 'account' ? <ScopeTabs scope={scope} mode={mode} /> : null}
        <div className="ac-body">{children}</div>
      </main>
    </div>
  );
}
