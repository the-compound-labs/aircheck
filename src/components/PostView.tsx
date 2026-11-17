'use client';

import { useRef, useState } from 'react';
import type { MediaRef } from '@/server/types';
import { mediaUrl, platform } from '@/lib/ui';

/* One post as its audience would meet it: the account line, the copy, then the media (a swipeable
 * strip for a carousel, a player for video, the text of a document). Used for queued posts and for
 * preview runs alike. */
export function PostView({ lane, handle, platformId, text, thread, media, compact }: {
  lane: string; handle?: string; platformId: string; text?: string; thread?: string[]; media: MediaRef[]; compact?: boolean;
}) {
  const p = platform(platformId);
  const posts = thread?.length ? thread : text ? [text] : [];
  return (
    <article className={`post${compact ? ' compact' : ''}`}>
      <header className="phd">
        <span className="pa" aria-hidden>{lane.replace(/[^A-Za-z]/g, '').slice(0, 1)}</span>
        <span className="who"><b>{lane}</b>{handle ? <small>{handle}</small> : null}</span>
        <i className={`ph ${p.icon} pl`} title={p.label}></i>
      </header>
      {posts.map((t, i) => <p key={i} className={`copy${thread?.length ? ' th' : ''}`}>{compact ? t.slice(0, 280) + (t.length > 280 ? '…' : '') : t}</p>)}
      {media.length ? <Media media={media} compact={compact} /> : null}
    </article>
  );
}

/* Every slide sits in one scroll-snap track: swipe on a phone, two-finger scroll on a trackpad, or
 * use the arrows and dots. Controls stop the click so a card never opens when you only meant to page. */
function Media({ media, compact }: { media: MediaRef[]; compact?: boolean }) {
  const [i, setI] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const visual = media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const docs = media.filter((m) => m.kind === 'doc');
  const go = (n: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const t = track.current;
    if (!t) return;
    const k = Math.max(0, Math.min(visual.length - 1, n));
    t.scrollTo({ left: k * t.clientWidth, behavior: 'smooth' });
  };
  const onScroll = () => { const t = track.current; if (t) setI(Math.round(t.scrollLeft / Math.max(1, t.clientWidth))); };
  const multi = visual.length > 1;
  return (
    <>
      {visual.length ? (
        <div className="mstrip" onClick={multi ? (e) => { if ((e.target as HTMLElement).closest('.mctl')) e.stopPropagation(); } : undefined}>
          <div ref={track} className="mtrack" onScroll={multi ? onScroll : undefined}>
            {visual.map((m, n) => <Item key={m.path} m={m} eager={n < 2} />)}
          </div>
          {multi ? (
            <>
              <span className="mcount">{i + 1}/{visual.length}</span>
              <button type="button" className="mctl marr prev" aria-label="Previous slide" disabled={i === 0} onClick={(e) => go(i - 1, e)}><i className="ph-bold ph-caret-left"></i></button>
              <button type="button" className="mctl marr next" aria-label="Next slide" disabled={i === visual.length - 1} onClick={(e) => go(i + 1, e)}><i className="ph-bold ph-caret-right"></i></button>
              <div className={`mnav2${compact ? ' over' : ''}`}>
                {visual.map((m, n) => <button key={m.path} type="button" className={`mctl${n === i ? ' on' : ''}`} aria-label={`Slide ${n + 1}`} onClick={(e) => go(n, e)} />)}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {!compact && docs.map((d) => <a key={d.path} className="doc" href={mediaUrl(d)} target="_blank" rel="noreferrer"><i className="ph ph-file-text"></i>{d.path.split('/').pop()}</a>)}
    </>
  );
}

function Item({ m, eager }: { m: MediaRef; eager?: boolean }) {
  if (m.kind === 'video') return <video src={mediaUrl(m)} controls preload="metadata" playsInline />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaUrl(m)} alt="" loading={eager ? 'eager' : 'lazy'} draggable={false} />;
}
