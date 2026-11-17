'use client';

import { Rail } from '@/components/Rail';

/* A page that could not read its data says so, says what to try, and keeps the way around. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ac-shell">
      <Rail place="today" />
      <main className="ac-page" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="ac-empty" role="alert">
          <span className="ac-empty-i"><i className="ph ph-plugs"></i></span>
          <b>This page could not load</b>
          <p>Aircheck could not read what this page shows. Your posts and runs are where they were. Try again, or go back to Today.</p>
          {error.digest ? <p className="mono" style={{ fontSize: 11.5, color: 'var(--faint)' }}>{error.digest}</p> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ac-btn pri" onClick={reset}><i className="ph ph-arrow-clockwise"></i>Try again</button>
            <a className="ac-btn" href="/">Open Today</a>
          </div>
        </div>
      </main>
    </div>
  );
}
