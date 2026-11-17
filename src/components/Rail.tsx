/* THE RAIL. The redesign's dark icon column (2026-11-15 redesign, App · Today): the
 * on-air mark, the places, and the account at the foot. Every place is a plain link, so the rail
 * renders on the server. On a phone it turns into a tab bar along the bottom edge. */

export type Place = 'today' | 'lanes' | 'runs' | 'ads' | 'email' | 'account';

const PLACES: { id: Exclude<Place, 'account'>; label: string; icon: string; href: string }[] = [
  { id: 'today', label: 'Today', icon: 'ph-tray', href: '/' },
  { id: 'lanes', label: 'Lanes', icon: 'ph-stack', href: '/lanes' },
  { id: 'ads', label: 'Ads', icon: 'ph-megaphone', href: '/ads' },
  { id: 'email', label: 'Email', icon: 'ph-envelope-simple', href: '/email' },
  { id: 'runs', label: 'Runs', icon: 'ph-play-circle', href: '/runs' },
];

export function Rail({ place, badges }: { place: Place; badges?: Partial<Record<Place, number>> }) {
  return (
    <nav className="ac-rail" aria-label="Aircheck">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <a className="ac-rail-mark" href="/" aria-label="Aircheck, Today"><img src="/aircheck-mark.svg" alt="" width={30} height={30} /></a>
      <div className="ac-rail-places">
        {PLACES.map((p) => (
          <a key={p.id} href={p.href} className={`ac-rail-i${place === p.id ? ' on' : ''}`} aria-current={place === p.id ? 'page' : undefined} aria-label={p.label} data-tip={p.label}>
            <i className={`ph${place === p.id ? '-fill' : ''} ${p.icon}`} aria-hidden></i>
            <span className="ac-rail-l">{p.label}</span>
            {badges?.[p.id] ? <span className="ac-rail-b num" aria-label={`${badges[p.id]} need you`}>{badges[p.id]}</span> : null}
          </a>
        ))}
      </div>
      <a href="/account" className={`ac-rail-i ac-rail-acct${place === 'account' ? ' on' : ''}`} aria-current={place === 'account' ? 'page' : undefined} aria-label="Account" data-tip="Account">
        <i className={`ph${place === 'account' ? '-fill' : ''} ph-user-circle`} aria-hidden></i>
        <span className="ac-rail-l">Account</span>
      </a>
    </nav>
  );
}
