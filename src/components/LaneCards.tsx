'use client';

import { useState } from 'react';
import type { Lane, QueueItem, Run } from '@/server/types';
import { quickChecks } from '@/lib/preflight';
import { clock, platform } from '@/lib/ui';
import { LaneTile } from './LaneTile';

type Status = 'any' | 'fix' | 'queued' | 'sent' | 'quiet';
const STATUS: Record<Status, string> = { any: 'any', fix: 'needs a fix', queued: 'queued', sent: 'all sent', quiet: 'quiet today' };

/* THE LANE CARDS (2026-11-15 redesign, App · Lanes, after Crewline's skill cards):
 * a strip with the day's send times and where the lane stands, the lane with its processes, the
 * broken post with its Fix right on the card, and the last seven days as seven small bars. Shared
 * by Social lanes, ad platforms and email senders. */
export function LaneCards({ lanes, items, runs = [], base = '', noun = 'post', week, tz = 'UTC' }: {
  lanes: Lane[];
  items: QueueItem[];
  runs?: Run[];
  /** '' for the social tree, '/ads' or '/email' for the others. */
  base?: string;
  noun?: string;
  /** Posts per lane over the last seven days, oldest first. */
  week?: { days: string[]; counts: Record<string, number[]> };
  tz?: string;
}) {
  const [status, setStatus] = useState<Status>('any');
  const [plat, setPlat] = useState('any');
  const one = noun.split(' ')[0];
  const many = one.endsWith('s') ? one : `${one}s`;
  const at = (i: QueueItem) => (i.at ? Date.parse(i.at) : Infinity);
  const info = (l: Lane) => {
    const own = items.filter((i) => i.lane === l.id).sort((a, b) => at(a) - at(b));
    const broken = own.find((i) => i.status !== 'sent' && (i.ad ? i.ad.missing?.length : quickChecks(i, l.platform).some((c) => !c.ok)));
    const sent = own.filter((i) => i.status === 'sent');
    const next = own.find((i) => i.status === 'queued');
    const st: Status = broken ? 'fix' : !own.length ? 'quiet' : sent.length === own.length ? 'sent' : 'queued';
    return { own, broken, sent, next, st };
  };
  const plats = [...new Set(lanes.map((l) => l.platform))];
  const [showQuiet, setShowQuiet] = useState(false);
  const matched = lanes.filter((l) => (status === 'any' || info(l).st === status) && (plat === 'any' || l.platform === plat));
  /* The order a reviewer can use (review item 30): lanes that need a fix, then by the next send time,
   * then the ones already done; quiet lanes fold into one row of logos unless asked for. */
  const nextAt = (l: Lane) => { const i = info(l); return i.broken ? -1 : i.next?.at ? Date.parse(i.next.at) : i.own.length ? 8.64e15 : 9e15; };
  const busy = matched.filter((l) => info(l).st !== 'quiet').sort((a, b) => nextAt(a) - nextAt(b));
  const quiet = matched.filter((l) => info(l).st === 'quiet');
  const fold = status !== 'quiet' && quiet.length > 2 && busy.length > 0 && !showQuiet;
  const shown = fold ? busy : [...busy, ...quiet];
  return (
    <>
      <div className="ac-bar" role="group" aria-label="Filter lanes">
        <label className="ac-pill">Status is <b>{STATUS[status]}</b><i className="ph ph-caret-down" aria-hidden></i>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
            {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
          </select>
        </label>
        {plats.length > 1 ? (
          <label className="ac-pill">Platform is <b>{plat === 'any' ? 'any' : platform(plat).label}</b><i className="ph ph-caret-down" aria-hidden></i>
            <select value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Platform">
              <option value="any">any</option>
              {plats.map((p) => <option key={p} value={p}>{platform(p).label}</option>)}
            </select>
          </label>
        ) : null}
        {status !== 'any' || plat !== 'any' ? <button type="button" className="ac-link" onClick={() => { setStatus('any'); setPlat('any'); }}><i className="ph ph-x"></i>Clear</button> : null}
      </div>
      {!matched.length ? (
        <div className="ac-empty">
          <span className="ac-empty-i"><i className={`ph ${lanes.length ? 'ph-funnel-simple' : 'ph-stack'}`}></i></span>
          <b>{lanes.length ? 'No lane matches these filters' : base === '/ads' ? 'No ad platforms yet' : base === '/email' ? 'No senders yet' : 'No lanes yet'}</b>
          <p>{lanes.length ? 'Every other lane is still here.' : 'A lane appears as soon as a manifest names it, or when your config lists it.'}</p>
          {lanes.length ? <button type="button" className="ac-btn" onClick={() => { setStatus('any'); setPlat('any'); }}><i className="ph ph-arrow-counter-clockwise"></i>Show every lane</button>
            : <a className="ac-btn" href="/docs#config"><i className="ph ph-book-open"></i>How lanes are set up</a>}
        </div>
      ) : (
        <section className="ac-lanes-g">
          {shown.map((l, k) => {
            const { own, broken, sent, next, st } = info(l);
            const times = own.filter((i) => i.at).map((i) => clock(i.at, tz));
            const bars = week?.counts[l.id] || Array(7).fill(0);
            const max = Math.max(1, ...bars);
            const mine = runs.filter((r) => r.lane === l.id).length;
            const href = `${base}/lanes/${l.id}`;
            const fixHref = base ? href : `/?post=${encodeURIComponent(broken?.id || '')}`;
            const bad = broken ? (broken.ad?.missing?.length ? `${broken.ad.missing.length} files missing` : quickChecks(broken, l.platform).find((c) => !c.ok)?.label) : '';
            return (
              <article key={l.id} className={`ac-lane${broken ? ' bad' : ''}`} style={{ animation: `ac-in .4s ${Math.min(k, 8) * 40}ms both` }}>
                <div className="ac-lane-s">
                  <i className="ph ph-clock" aria-hidden></i>
                  <span className="num">{times.length ? `Today · ${times.slice(0, 3).join(', ')}${times.length > 3 ? ` +${times.length - 3}` : ''}` : `No ${many} queued today`}</span>
                  {st === 'fix' ? <span className="ac-chip bad"><span className="ac-dot" aria-hidden></span>Needs a fix</span>
                    : st === 'sent' ? <span className="ac-chip ok">Sent {sent.at(-1)?.at ? clock(sent.at(-1)!.at, tz) : ''}</span>
                    : st === 'queued' ? <span className="ac-chip">{next?.at ? `Next ${clock(next.at, tz)}` : 'Queued'}</span>
                    : <span className="ac-chip">Quiet</span>}
                </div>
                <div className="ac-lane-m">
                  <a className="ac-lane-n" href={href}>
                    <LaneTile l={l} size="lg" />
                    <span><b>{l.name}</b><small>{l.handle || platform(l.platform).label}</small></span>
                  </a>
                  {l.brief ? <p className="ac-lane-brief">{l.brief}</p> : null}
                  <div className="ac-procs" aria-label="Processes">
                    {l.formats.length ? l.formats.slice(0, 5).map((f) => <span key={f.id} title={f.note}>{f.label}</span>) : <span>{own.length ? `${own.length} ${own.length === 1 ? one : many} today` : 'No posting process'}</span>}
                    {l.formats.length > 5 ? <span>+{l.formats.length - 5}</span> : null}
                  </div>
                  {broken ? (
                    <div className="ac-lane-fix">
                      <span><b>{bad}</b><small>{broken.title || broken.email?.subject || (broken.text || '').split('\n')[0]}{broken.at ? ` · ${clock(broken.at, tz)}` : ''}</small></span>
                      <a className="ac-btn bad" href={fixHref}>Fix<i className="ph ph-arrow-right"></i></a>
                    </div>
                  ) : null}
                </div>
                <div className="ac-lane-f">
                  {week ? <>
                    <span>{base === '/ads' ? 'Creative' : base === '/email' ? 'Email' : 'Posts'}, last 7 days</span>
                    <span className="ac-bars" role="img" aria-label={week.days.map((d, n) => `${d}: ${bars[n]}`).join(', ')}>
                      {bars.map((v, n) => <i key={n} className={`${v ? '' : 'z'}${n === 6 ? ' t' : ''}`} style={{ height: v ? `${Math.max(18, (v / max) * 100)}%` : undefined, animationDelay: `${n * 30}ms` }} title={`${week.days[n]}: ${v}`}></i>)}
                    </span>
                  </> : <span className="num">{own.length ? `${own.length} ${own.length === 1 ? one : many} today` : `No ${many} today`}{mine ? ` · ${mine} ${mine === 1 ? 'preview' : 'previews'}` : ''}</span>}
                  {!base && l.formats.length ? <a className="ac-btn" href={`/runs?build=${encodeURIComponent(l.id)}`}><i className="ph ph-sparkle"></i>Preview a post</a> : <a className="ac-btn" href={href}>Open</a>}
                </div>
              </article>
            );
          })}
        </section>
      )}
      {fold && matched.length ? (
        <button type="button" className="ac-quiet" onClick={() => setShowQuiet(true)} aria-expanded="false">
          <span className="ac-quiet-l">{quiet.slice(0, 12).map((l) => <LaneTile key={l.id} l={l} size="md" />)}</span>
          <span><b>{quiet.length} quiet lanes</b><small>Nothing queued today. Show them</small></span>
          <i className="ph ph-caret-down"></i>
        </button>
      ) : null}
    </>
  );
}
