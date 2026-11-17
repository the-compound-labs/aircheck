'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { MediaRef } from '@/server/types';
import { mediaUrl } from '@/lib/ui';

export type CarHandle = { step: (d: number) => void };

/* riff 4's .car: every slide in one scroll-snap track, a counter, arrows on hover, dots. Videos play
 * inline. With no visual media it says so, the way the riff does. */
export const Car = forwardRef<CarHandle, { media: MediaRef[]; className?: string; empty?: string }>(function Car({ media, className, empty }, ref) {
  const tr = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const vis = media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const go = (n: number) => { const t = tr.current; if (t) t.scrollTo({ left: Math.max(0, Math.min(vis.length - 1, n)) * t.clientWidth, behavior: 'smooth' }); };
  useImperativeHandle(ref, () => ({ step: (d: number) => go(i + d) }));
  if (!vis.length) {
    return (
      <div className={`car ${className || ''}`} style={{ display: 'grid', placeItems: 'center', color: '#71717a', fontSize: 12.5 }}>
        <span><i className="ph ph-image-broken" style={{ fontSize: 22, display: 'block', textAlign: 'center', marginBottom: 4 }}></i>{empty || 'No media in the plan'}</span>
      </div>
    );
  }
  return (
    <div className={`car ${className || ''}`}>
      <div className="tr" ref={tr} onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {vis.map((m) => m.kind === 'video'
          ? <video key={m.path} src={mediaUrl(m)} controls preload="metadata" playsInline style={{ flex: '0 0 100%', width: '100%', height: '100%', objectFit: 'contain', scrollSnapAlign: 'start' }} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={m.path} src={mediaUrl(m)} alt="" draggable={false} />)}
      </div>
      {vis.length > 1 ? (
        <>
          <span className="ct num">{i + 1}/{vis.length}</span>
          <button type="button" className="ar p" aria-label="Previous slide" disabled={i === 0} onClick={(e) => { e.stopPropagation(); go(i - 1); }}><i className="ph-bold ph-caret-left"></i></button>
          <button type="button" className="ar n" aria-label="Next slide" disabled={i === vis.length - 1} onClick={(e) => { e.stopPropagation(); go(i + 1); }}><i className="ph-bold ph-caret-right"></i></button>
          <div className="dt">{vis.map((m, n) => <i key={m.path} className={n === i ? 'on' : undefined}></i>)}</div>
        </>
      ) : null}
    </div>
  );
});
