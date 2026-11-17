'use client';

import { useEffect, useState } from 'react';
import type { Lane, QueueItem, Review, ReviewState } from '@/server/types';
import { clock, mediaUrl, platform } from '@/lib/ui';
import { RULES, useChecks } from '@/lib/preflight';
import { Ring } from './TodayView';

/* THE REVIEW PIECES of the details pane: the gate (Approve, Hold, Changes), the post drawn the way
 * its platform will show it, and the platform's checks. */

export type Decide = (ids: string[], state: ReviewState | null, note?: string) => Promise<string | null>;

export function Gate({ item, review, decide }: { item: QueueItem; review?: Review | null; decide: Decide }) {
  const [asking, setAsking] = useState(review?.state === 'changes');
  const [note, setNote] = useState(review?.state === 'changes' ? review.note || '' : '');
  const [hold, setHold] = useState<'' | 'menu' | 'note'>('');
  const [holdNote, setHoldNote] = useState('');
  const [err, setErr] = useState('');
  const state = review?.state;
  const go = async (s: ReviewState | null, n?: string) => {
    setErr('');
    const e = await decide([item.id], s, n);
    if (e) setErr(e); else { setHold(''); if (s !== 'changes') setAsking(false); }
  };
  /* Approve and Hold carry their keys on the button (review item 3), and Hold opens a small menu
   * (item 47): hold until you approve it, or hold with a note the posting job reads back from
   * check_post. Aircheck never moves a post to another slot; the job owns its schedule. */
  return (
    <div className="ac-gate">
      <div className="ac-gate-r">
        <button type="button" className={`ac-btn${state === 'approved' ? ' on' : ' pri'}`} aria-pressed={state === 'approved'} onClick={() => go(state === 'approved' ? null : 'approved')}>
          <i className="ph-bold ph-check"></i>{state === 'approved' ? 'Approved' : 'Approve'}<kbd>A</kbd>
        </button>
        <span className="ac-gate-hold">
          <button type="button" className="ac-btn" aria-pressed={state === 'held'} aria-haspopup="menu" aria-expanded={!!hold}
            onClick={() => (state === 'held' ? go(null) : setHold(hold ? '' : 'menu'))}>
            <i className="ph ph-pause"></i>{state === 'held' ? 'Held' : 'Hold'}<kbd>H</kbd>
          </button>
          {hold ? (
            <div className="ac-pop" role="menu">
              {hold === 'menu' ? <>
                <button type="button" role="menuitem" onClick={() => go('held')}><i className="ph ph-pause"></i><span><b>Hold until I approve</b><small>The job skips it until you press Approve.</small></span></button>
                <button type="button" role="menuitem" onClick={() => setHold('note')}><i className="ph ph-note-pencil"></i><span><b>Hold with a note</b><small>The job reads the note when it checks this post.</small></span></button>
              </> : (
                <div className="ac-pop-n">
                  <textarea rows={2} autoFocus value={holdNote} placeholder="Why it is held" onChange={(e) => setHoldNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && holdNote.trim()) go('held', holdNote.trim()); if (e.key === 'Escape') setHold(''); }} />
                  <button type="button" className="ac-btn pri" disabled={!holdNote.trim()} onClick={() => go('held', holdNote.trim())}>Hold</button>
                </div>
              )}
            </div>
          ) : null}
        </span>
        <button type="button" className="ac-btn" aria-pressed={state === 'changes' || asking} onClick={() => setAsking(!asking)}>
          <i className="ph ph-chat-circle-text"></i>Changes
        </button>
      </div>
      {asking ? (
        <div className="ac-gate-ask">
          <textarea rows={2} value={note} placeholder="What should change?" autoFocus
            onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && note.trim()) go('changes', note.trim()); }} />
          <button type="button" className="ac-btn pri" disabled={!note.trim()} onClick={() => go('changes', note.trim())}>Send back</button>
        </div>
      ) : null}
      {err ? <p className="ac-err" role="alert"><i className="ph ph-warning-circle"></i>{err}</p> : null}
      <p className="ac-gate-k">Approve and Hold move on to the next post that needs you.</p>
    </div>
  );
}

/* The post as its platform shows it: the account, the image cut to the feed's frame, and the caption
 * folded where the platform folds it. */
export function PostPreview({ item, lane, tz }: { item: QueueItem; lane: Lane; tz: string }) {
  const rule = RULES[lane.platform];
  const pl = platform(lane.platform);
  const vis = item.media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const [i, setI] = useState(0);
  const m = vis[i];
  const text = item.text || item.title || '';
  const fold = rule?.fold;
  const [open, setOpen] = useState(false);
  const cut = fold && !open && text.length > fold ? text.slice(0, fold).replace(/\s+\S*$/, '') : '';
  const handle = (lane.handle || lane.name).replace(/^@/, '');
  return (
    <div className="pv5">
      <div className="h"><Ring p={lane.platform} logo={lane.logo} /><b>{handle}</b><span className="num">{clock(item.at, tz)}</span></div>
      {m ? (
        <div className="m" style={{ aspectRatio: rule?.frame || '4 / 5' }}>
          {m.kind === 'video'
            ? <video src={mediaUrl(m)} controls preload="metadata" playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={mediaUrl(m)} alt={m.alt || ''} draggable={false} />}
          {vis.length > 1 ? <span className="ct num">{i + 1}/{vis.length}</span> : null}
          {vis.length > 1 && i > 0 ? <button type="button" className="ar p" aria-label="Previous slide" onClick={() => setI(i - 1)}><i className="ph-bold ph-caret-left"></i></button> : null}
          {vis.length > 1 && i < vis.length - 1 ? <button type="button" className="ar n" aria-label="Next slide" onClick={() => setI(i + 1)}><i className="ph-bold ph-caret-right"></i></button> : null}
        </div>
      ) : null}
      {text ? <div className="t"><b>{handle}</b> {cut ? <>{cut}… <button type="button" className="more" onClick={() => setOpen(true)}>more</button></> : text}</div> : null}
      <div className="f"><span><i className="ph ph-heart"></i>Like</span><span><i className="ph ph-chat-circle"></i>Comment</span><span><i className="ph ph-share-fat"></i>Share</span><i className={`ph ${pl.icon} pl`}></i></div>
    </div>
  );
}

export function Checks({ item, lane }: { item: QueueItem; lane: Lane }) {
  const checks = useChecks(item, lane.platform);
  if (!checks.length) return null;
  const pass = checks.filter((c) => c.ok).length;
  const fix = (text: string) => window.dispatchEvent(new CustomEvent('aircheck:fix', { detail: text }));
  return (
    <section className="pre5" aria-label={`Checks for ${RULES[lane.platform]?.name || 'this post'}`}>
      <div className="h"><b>Checks for {RULES[lane.platform]?.name || platform(lane.platform).label}</b><span className="num">{pass} of {checks.length} pass</span></div>
      {checks.map((c) => (
        <div key={c.id} className={`r ${c.ok ? 'ok' : 'bad'}`}>
          <i className={`ph-fill ${c.ok ? 'ph-check-circle' : 'ph-warning-circle'}`}></i>{c.label}
          {!c.ok && c.fix && item.status !== 'sent'
            ? <button type="button" className="m fx" onClick={() => fix(c.fix!)}>Fix →</button>
            : <span className="m num">{c.detail}</span>}
        </div>
      ))}
    </section>
  );
}

/** The view switch over the post: its raw media, the platform preview, or the text alone. */
export type View = 'media' | 'preview' | 'text';
export function ViewSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="seg view5" role="tablist">
      {(['media', 'preview', 'text'] as View[]).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : undefined} onClick={() => setView(v)}>
          {v === 'media' ? 'Media' : v === 'preview' ? 'Preview' : 'Text'}
        </button>
      ))}
    </div>
  );
}

/** Remember the chosen view across posts, for this browser. */
export function useView(): [View, (v: View) => void] {
  const [view, set] = useState<View>('preview');
  useEffect(() => {
    const t = setTimeout(() => { try { const v = localStorage.getItem('aircheck.view') as View | null; if (v === 'media' || v === 'preview' || v === 'text') set(v); } catch { /* blocked */ } }, 0);
    return () => clearTimeout(t);
  }, []);
  return [view, (v: View) => { set(v); try { localStorage.setItem('aircheck.view', v); } catch { /* blocked */ } }];
}
