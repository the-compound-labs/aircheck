'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Lane, QueueItem, Run } from '@/server/types';
import { machineFetch } from '@/lib/machine';
import { mediaUrl, since } from '@/lib/ui';
import { LaneTile } from './LaneTile';
import { OpenedCreative } from './TodayView';
import { agentName } from './Actions';

type Col = 'review' | 'changes' | 'approved' | 'replaced' | 'archived';
const COLS: { id: Col; label: string }[] = [
  { id: 'review', label: 'Needs review' },
  { id: 'changes', label: 'Changes asked' },
  { id: 'approved', label: 'Approved' },
  { id: 'replaced', label: 'Replaced' },
];

/* THE ADS BOARD (2026-11-15 redesign, App · Ads, after Torque's kanban): every
 * creative the ad pipeline built, in the column of where its review stands. A creative with a
 * repair that replaced it is Replaced; one signed off (approved or live) is Approved; one with a
 * run that asked for a change is Changes asked, carrying that comment and the way to Repair it;
 * everything else Needs review. Archived creative gets its own column only when there is some.
 * Clicking a card opens it in a drawer with the same panel Today opens a post in. */
/* Where the ad pipeline has this creative, from arm.mjs's newest receipt (sources/ads.ts): armed is
 * on air, so it alone takes the red dot. */
type Arm = { state: 'armed' | 'ended' | 'paused'; at: string; until?: string; budgetUsd?: number; platform?: string };
const armOf = (i: QueueItem) => (i.ad?.meta?.arm as Arm | undefined);
const day = (iso?: string) => (iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)) : '');
export function armLabel(a: Arm) {
  return a.state === 'armed' ? `Armed${a.until ? ` until ${day(a.until)}` : ''}` : a.state === 'paused' ? `Paused ${day(a.at)}` : `Ended ${day(a.until || a.at)}`;
}
export function ArmChip({ a }: { a?: Arm }) {
  if (!a) return null;
  return <span className={`ac-arm ${a.state}`}>{armLabel(a)}{a.budgetUsd ? <span className="num"> · ${a.budgetUsd}</span> : null}</span>;
}

export function AdsBoard({ items, lanes, runs: initial, agents, defaultAgent, tz, sample }: {
  items: QueueItem[]; lanes: Lane[]; runs: Run[]; agents: string[]; defaultAgent: string; tz: string; sample?: boolean;
}) {
  const [runs, setRuns] = useState<Run[]>(initial);
  const [view, setView] = useState<'board' | 'table'>('board');
  const [fmt, setFmt] = useState('');
  const [prod, setProd] = useState('');
  const [arm, setArm] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [ratio, setRatio] = useState<Record<string, string>>({});
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await machineFetch('/api/runs', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (r?.runs) setRuns((r.runs as Run[]).filter((x) => x.ad));
    }, 0);
    return () => clearTimeout(t);
  }, [open]);
  const byLane = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const laneOf = (id: string): Lane => byLane.get(id) || { id, name: id, platform: 'other', formats: [] };
  const runsOf = (i: QueueItem) => runs.filter((r) => r.ad?.id === i.ad!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const colOf = (i: QueueItem): Col => {
    const rs = runsOf(i);
    if (rs.some((r) => r.replaced)) return 'replaced';
    const a = i.ad!;
    if (a.approved || a.status === 'approved' || a.status === 'live') return 'approved';
    if (a.status === 'archived') return 'archived';
    if (rs.some((r) => (r.action === 'feedback' || r.action === 'repair') && (r.comment || r.request))) return 'changes';
    return 'review';
  };
  const formats = [...new Set(items.map((i) => i.ad!.format))].sort();
  const products = [...new Set(items.map((i) => i.ad!.product))].sort();
  const arms = [...new Set(items.map((i) => armOf(i)?.state).filter(Boolean))] as string[];
  const shown = items.filter((i) => (!fmt || i.ad!.format === fmt) && (!prod || i.ad!.product === prod) && (!arm || armOf(i)?.state === arm));
  const cols = COLS.concat(shown.some((i) => colOf(i) === 'archived') ? [{ id: 'archived', label: 'Archived' }] : []);
  const cur = items.find((i) => i.id === open);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);

  const line = (i: QueueItem, c: Col) => {
    const rs = runsOf(i);
    const a = i.ad!;
    if (c === 'changes') { const r = rs.find((x) => x.comment || x.request); return `“${r?.comment || r?.request}”`; }
    if (c === 'replaced') { const r = rs.find((x) => x.replaced); return r?.replaced ? `Replaced by a repair ${since(r.replaced.at)}.` : 'Replaced by a repair.'; }
    if (c === 'approved') return a.status === 'live' ? 'Approved and live.' : 'Approved.';
    if (c === 'archived') return 'Archived.';
    if (a.missing?.length) return `${a.missing.length} ${a.missing.length === 1 ? 'file is' : 'files are'} missing.`;
    return a.createdAt ? `Built ${since(a.createdAt)} by the ad pipeline.` : `Built by ${a.recipe || 'the ad pipeline'}.`;
  };
  const thumb = (i: QueueItem) => {
    const m = i.media.find((x) => x.kind === 'image') || i.media.find((x) => x.kind === 'video');
    const onDims = (w: number, h: number) => {
      if (!w || !h) return;
      const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
      const d = g(w, h);
      const r = `${w / d}:${h / d}`;
      setRatio((o) => (o[i.id] ? o : { ...o, [i.id]: r.length > 6 ? `${(w / h).toFixed(2)}:1` : r }));
    };
    return (
      <span className="ac-card-m">
        {!m ? <span className="ac-th-t"><i className="ph ph-text-aa"></i></span> : m.kind === 'video' && typeof i.ad?.meta?.poster === 'string'
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={mediaUrl(i.ad.meta.poster as string)} alt="" loading="lazy" />
          : m.kind === 'video'
          ? <video src={`${mediaUrl(m)}#t=1`} muted preload="metadata" playsInline onLoadedMetadata={(e) => onDims(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={mediaUrl(m)} alt="" loading="lazy" ref={(el) => { if (el?.complete && el.naturalWidth && !ratio[i.id]) setTimeout(() => onDims(el.naturalWidth, el.naturalHeight), 0); }} onLoad={(e) => onDims(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />}
        {ratio[i.id] ? <span className="ac-card-r num">{ratio[i.id]}</span> : null}
      </span>
    );
  };
  const card = (i: QueueItem) => {
    const c = colOf(i);
    const l = laneOf(i.lane);
    const r = runsOf(i)[0];
    return (
      <li key={i.id}>
        <button type="button" className={`ac-card${c === 'changes' ? ' bad' : ''}${open === i.id ? ' on' : ''}`} onClick={() => setOpen(i.id)} aria-haspopup="dialog">
          {thumb(i)}
          <span className="ac-card-b"><b>{i.title || i.ad!.format}</b><p>{l.name} · {i.ad!.format}{i.ad!.product ? ` · ${i.ad!.product}` : ''}</p><p>{line(i, c)}</p></span>
          <span className="ac-card-f">
            {c === 'changes' ? <span className="ac-chip bad"><i className="ph-bold ph-wrench"></i>Repair</span>
              : r ? <span>{r.agent === 'codex' || r.agent === 'claude' ? <AgentMark a={r.agent} /> : null} {agentName(r.agent)}</span>
              : <span>{i.ad!.product}</span>}
            {armOf(i) ? <ArmChip a={armOf(i)} /> : <span className="mono">{i.ad!.run}</span>}
          </span>
        </button>
      </li>
    );
  };

  /* No creative yet (review item 33): the board still shows its four columns, each with a ghost
   * card, and a way to see a sample board. */
  if (!items.length) {
    return (
      <>
        <div className="ac-bar">
          <p className="ac-muted" style={{ margin: 0, fontSize: 13 }}>Point the ads source in your config at the folder your renderer writes to, and every creative it builds shows up here.</p>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <a className="ac-btn" href="/docs#ads"><i className="ph ph-book-open"></i>How ad creative is read</a>
            <a className="ac-btn pri" href="/ads?sample=1"><i className="ph ph-eye"></i>See a sample board</a>
          </span>
        </div>
        <div className="ac-board">
          {COLS.map((col) => (
            <section key={col.id} className="ac-col" aria-label={col.label}>
              <h2 className="ac-col-h">{col.label}<span className="ac-chip num">0</span></h2>
              <div className="ac-col-ghost" aria-hidden><i></i><b></b><b></b></div>
            </section>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="ac-bar">
        {formats.length > 1 ? (
          <label className="ac-pill">Placement is <b>{fmt || 'any'}</b><i className="ph ph-caret-down" aria-hidden></i>
            <select value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Placement">
              <option value="">any</option>
              {formats.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        ) : null}
        {products.length > 1 ? (
          <label className="ac-pill">Product is <b>{prod || 'any'}</b><i className="ph ph-caret-down" aria-hidden></i>
            <select value={prod} onChange={(e) => setProd(e.target.value)} aria-label="Product">
              <option value="">any</option>
              {products.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        ) : null}
        {arms.length ? (
          <label className="ac-pill">Arm state is <b>{arm || 'any'}</b><i className="ph ph-caret-down" aria-hidden></i>
            <select value={arm} onChange={(e) => setArm(e.target.value)} aria-label="Arm state">
              <option value="">any</option>
              {arms.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        ) : null}
        {sample ? <a className="ac-link" href="/ads"><i className="ph ph-x"></i>Leave the sample</a> : null}
        <span className="ac-seg" role="radiogroup" aria-label="View" style={{ marginLeft: 'auto' }}>
          <button type="button" role="radio" aria-checked={view === 'board'} className={view === 'board' ? 'on' : undefined} onClick={() => setView('board')}><i className="ph ph-kanban"></i>Board</button>
          <button type="button" role="radio" aria-checked={view === 'table'} className={view === 'table' ? 'on' : undefined} onClick={() => setView('table')}><i className="ph ph-rows"></i>Table</button>
        </span>
      </div>
      {view === 'board' ? (
        <div className="ac-board" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(${cols.length > 4 ? 220 : 250}px, 1fr))` }}>
          {cols.map((col) => {
            const list = shown.filter((i) => colOf(i) === col.id);
            return (
              <section key={col.id} className={`ac-col${list.length > 6 ? ' dense' : ''}`} aria-label={col.label}>
                <h2 className="ac-col-h">{col.label}<span className={`ac-chip num${col.id === 'changes' && list.length ? ' bad' : ''}`}>{list.length}</span></h2>
                {list.length ? <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>{list.map(card)}</ul>
                  : <p className="ac-col-e">{col.id === 'changes' ? 'No changes asked' : col.id === 'replaced' ? 'Nothing replaced yet' : col.id === 'approved' ? 'Nothing approved yet' : 'Nothing waiting'}</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <table className="ac-table">
          <thead><tr><th>Creative</th><th>Platform</th><th>Where it is</th><th className="hide-s">Arm state</th><th className="hide-s">Built</th></tr></thead>
          <tbody>
            {shown.map((i) => {
              const c = colOf(i);
              const l = laneOf(i.lane);
              return (
                <tr key={i.id} className={open === i.id ? 'on' : undefined} onClick={() => setOpen(i.id)}>
                  <td><span className="ac-rn"><button type="button" onClick={(e) => { e.stopPropagation(); setOpen(i.id); }}>{i.title || i.ad!.format}</button><small>{i.ad!.product} · {i.ad!.format}</small></span></td>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><LaneTile l={l} />{l.name}</span></td>
                  <td><span className={`ac-chip ${c === 'changes' ? 'bad' : c === 'approved' ? 'ok' : c === 'review' ? 'warn' : ''}`}>{cols.find((x) => x.id === c)?.label}</span></td>
                  <td className="hide-s">{armOf(i) ? <ArmChip a={armOf(i)} /> : <span className="mono">{i.ad!.run}</span>}</td>
                  <td className="hide-s num">{i.ad!.createdAt ? since(i.ad!.createdAt) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {cur ? (
        <>
          <div className="ac-drawer-back" onClick={() => setOpen(null)} aria-hidden></div>
          <div className="ac-drawer wide" role="dialog" aria-modal="true" aria-label={`${cur.ad!.format} · ${laneOf(cur.lane).name}`}>
            <button type="button" className="ac-ib ac-drawer-x" aria-label="Close" onClick={() => setOpen(null)}><i className="ph ph-x"></i></button>
            <OpenedCreative item={cur} lane={laneOf(cur.lane)} tz={tz} agents={agents} defaultAgent={defaultAgent} onBack={() => setOpen(null)} />
          </div>
        </>
      ) : null}
    </>
  );
}

/* The agent's own mark, small, beside its name. */
function AgentMark({ a }: { a: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/${a === 'codex' ? 'openai' : 'claude'}.svg`} alt="" width={12} height={12} style={{ verticalAlign: -2 }} />;
}
