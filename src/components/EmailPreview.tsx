'use client';

import { useEffect, useRef, useState } from 'react';
import type { QueueItem } from '@/server/types';
import { mediaUrl } from '@/lib/ui';

/* AN EMAIL, AS ITS READER SEES IT. The inbox line first (from, subject, preheader), then the
 * message rendered at desktop or phone width, or its plain-text part. The HTML is fetched from
 * wherever the manifest points (the machine that queued it, or a URL) and drawn in a sandboxed
 * frame: no scripts, nothing it can reach on this page, and its links open in a new tab. */

type Mode = 'desktop' | 'mobile' | 'text';

function useHtml(email: NonNullable<QueueItem['email']>) {
  const [state, setState] = useState<{ html?: string; url?: string; failed?: boolean }>({});
  useEffect(() => {
    const h = email.html;
    if (!h) return;
    let live = true;
    const src = mediaUrl(h as never);
    fetch(src, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((html) => { if (live) setState({ html }); })
      /* A URL on someone else's host may refuse a read from this page; it can still be shown. */
      .catch(() => { if (live) setState(h.src === 'url' ? { url: src } : { failed: true }); });
    return () => { live = false; };
  }, [email.html]);
  return state;
}

const BASE = '<base target="_blank">';
const withBase = (html: string) => (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BASE) : BASE + html);

/* An email is laid out for a 600-odd pixel column. Drawn in a narrower pane it would scroll
 * sideways, so it is laid out at its own width and scaled down to fit, the way an inbox's
 * reading pane shows it. */
export function Fit({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className="em-fit" style={{ height: height * scale }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>{children}</div>
    </div>
  );
}

export function EmailPreview({ email }: { email: NonNullable<QueueItem['email']> }) {
  const [mode, setMode] = useState<Mode>(email.html ? 'desktop' : 'text');
  const [big, setBig] = useState(false);
  const got = useHtml(email);
  const from = email.from || 'No sender set';
  const initial = (from.replace(/^["']/, '').match(/[A-Za-z0-9]/)?.[0] || '@').toUpperCase();

  const frame = (w: number | '100%', h: number) => (got.html !== undefined
    ? <iframe title={email.subject} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={withBase(got.html)} style={{ width: w, height: h }} />
    : got.url ? <iframe title={email.subject} sandbox="allow-popups allow-popups-to-escape-sandbox" src={got.url} style={{ width: w, height: h }} />
    : got.failed ? <div className="em-gone"><i className="ph ph-desktop"></i><p>The message is on your computer. Open Claude Code or Codex there to load it.</p></div>
    : <div className="em-gone"><i className="ph ph-circle-notch"></i><p>Loading the message…</p></div>);

  return (
    <div className="em">
      <div className="em-head">
        <span className="em-av">{initial}</span>
        <div className="em-meta">
          <div className="em-from"><b>{from}</b>{email.to?.length ? <span>to {email.to.join(', ')}</span> : null}</div>
          <div className="em-subj">{email.subject}</div>
          {email.preheader ? <div className="em-pre">{email.preheader}</div> : null}
        </div>
      </div>
      <div className="em-bar">
        <div className="em-seg" role="tablist">
          {email.html ? <button type="button" role="tab" aria-selected={mode === 'desktop'} className={mode === 'desktop' ? 'on' : ''} onClick={() => setMode('desktop')}><i className="ph ph-desktop"></i>Desktop</button> : null}
          {email.html ? <button type="button" role="tab" aria-selected={mode === 'mobile'} className={mode === 'mobile' ? 'on' : ''} onClick={() => setMode('mobile')}><i className="ph ph-device-mobile"></i>Phone</button> : null}
          <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}><i className="ph ph-text-aa"></i>Text</button>
        </div>
        {email.html && mode !== 'text' ? <button type="button" className="em-big" onClick={() => setBig(true)} title="Open full size"><i className="ph ph-arrows-out-simple"></i></button> : null}
      </div>
      <div className={`em-body m-${mode}`}>
        {mode === 'text'
          ? <pre className="em-text">{email.text || 'This email has no plain-text part. Most inboxes show the HTML; some readers and filters only see this part.'}</pre>
          : mode === 'mobile' ? <div className="em-phone">{frame(375, 640)}</div>
          : <Fit width={680} height={900}>{frame(680, 900)}</Fit>}
      </div>
      {big ? (
        <div className="em-full" onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(false); }}>
          <div className="em-full-in">
            <button type="button" className="em-x" aria-label="Close" onClick={() => setBig(false)}><i className="ph ph-x"></i></button>
            {mode === 'mobile' ? <div className="em-phone">{frame(375, 760)}</div> : frame(760, 820)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* The top of an email as a card's picture: the message laid out at its own width and scaled to the
 * card, read only when the card scrolls into view, with nothing in it clickable. */
export function EmailThumb({ email }: { email: NonNullable<QueueItem['email']> }) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => { io.disconnect(); ro.disconnect(); };
  }, []);
  return (
    <div ref={box} className="em-thumb">
      {seen && size.w ? <ThumbFrame email={email} w={size.w} h={size.h} /> : null}
    </div>
  );
}

function ThumbFrame({ email, w, h }: { email: NonNullable<QueueItem['email']>; w: number; h: number }) {
  const got = useHtml(email);
  const W = 640, scale = w / W;
  if (got.html === undefined && !got.url) return null;
  return (
    <div style={{ width: W, height: h / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
      {got.html !== undefined
        ? <iframe title="" tabIndex={-1} aria-hidden sandbox="" srcDoc={got.html} style={{ width: W, height: h / scale, border: 0, pointerEvents: 'none', display: 'block', background: '#fff' }} />
        : <iframe title="" tabIndex={-1} aria-hidden sandbox="" src={got.url} style={{ width: W, height: h / scale, border: 0, pointerEvents: 'none', display: 'block', background: '#fff' }} />}
    </div>
  );
}
