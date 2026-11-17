'use client';

import { usePathname } from 'next/navigation';
import { Rail, type Place } from '@/components/Rail';

/* While a page reads its day: the rail where it always is, on the place being opened, and the panes
 * as quiet shapes, so nothing moves when the page arrives. */
export default function Loading() {
  const p = usePathname() || '/';
  const place: Place = p.startsWith('/lanes') ? 'lanes' : p.startsWith('/runs') ? 'runs' : p.startsWith('/ads') ? 'ads' : p.startsWith('/email') ? 'email' : p.startsWith('/account') ? 'account' : 'today';
  return (
    <div className="ac-shell ac-loading" aria-busy="true" aria-label="Loading">
      <Rail place={place} />
      <div className="ac-loading-b">
        <div className="ac-skel" style={{ width: 180, height: 34 }}></div>
        <div className="ac-skel" style={{ width: 280, height: 14, marginTop: 12 }}></div>
        <div className="ac-loading-g">
          {Array.from({ length: 6 }, (_, k) => (
            <div key={k} className="ac-loading-r">
              <div className="ac-skel" style={{ width: 46, height: 46, borderRadius: 10 }}></div>
              <div style={{ flex: 1 }}><div className="ac-skel" style={{ width: `${70 - k * 6}%`, height: 13 }}></div><div className="ac-skel" style={{ width: '38%', height: 11, marginTop: 8 }}></div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
