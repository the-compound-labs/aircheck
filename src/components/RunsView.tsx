'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lane, MediaRef, Product, Run } from '@/server/types';
import { machineFetch, useMachine } from '@/lib/machine';
import { ago, since } from '@/lib/ui';
import { LaneTile } from './LaneTile';
import { Car } from './Car';
import { PostView } from './PostView';
import { LaneStudio } from './LaneStudio';
import { agentName } from './Actions';

/** What a run acted on, read by the page: the queued post (by day:id) or the creative (by ad id). */
export type Target = { title: string; text?: string; media: MediaRef[]; day?: string; id: string; ad?: boolean };

type Seg = 'all' | 'running' | 'done' | 'failed';
const KIND: Record<string, string> = { preview: 'Preview', example: 'Example', feedback: 'Feedback', repair: 'Repair' };
/* One neutral chip for the four kinds of one thing (review item 23); colour stays with status. */
const KICON: Record<string, string> = { preview: 'ph-sparkle', example: 'ph-shuffle', feedback: 'ph-chat-circle-text', repair: 'ph-wrench' };

/* BEFORE AND AFTER BY LINE (review item 29): changed lines with two lines of context, the rest folded
 * into "N unchanged lines", and within a changed line the cut and the new words marked. */
type Op = { t: 'eq' | 'del' | 'ins' | 'chg'; a?: string; b?: string };
function lineOps(a: string, b: string): Op[] {
  const A = a.split('\n'), B = b.split('\n');
  if (A.length * B.length > 250000) return [{ t: 'chg', a, b }];
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const raw: Op[] = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { raw.push({ t: 'eq', a: A[i], b: B[j] }); i++; j++; }
    else if (j < B.length && (i >= A.length || L[i][j + 1] >= L[i + 1][j])) { raw.push({ t: 'ins', b: B[j] }); j++; }
    else { raw.push({ t: 'del', a: A[i] }); i++; }
  }
  /* A cut line followed by a written one is one changed line. */
  const out: Op[] = [];
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].t === 'del' && raw[k + 1]?.t === 'ins') { out.push({ t: 'chg', a: raw[k].a, b: raw[k + 1].b }); k++; }
    else if (raw[k].t === 'ins' && raw[k + 1]?.t === 'del') { out.push({ t: 'chg', a: raw[k + 1].a, b: raw[k].b }); k++; }
    else out.push(raw[k]);
  }
  return out;
}
function LineDiff({ before, after, labels }: { before: string; after: string; labels: [string, string] }) {
  const [mode, setMode] = useState<'split' | 'inline'>('split');
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const ops = lineOps(before, after);
  const near = (k: number) => ops.slice(Math.max(0, k - 2), k + 3).some((o) => o.t !== 'eq');
  type Row = { k: number; op: Op } | { fold: number; n: number };
  const rows: Row[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t === 'eq' && !near(k) && !open[k]) {
      let e = k; while (e + 1 < ops.length && ops[e + 1].t === 'eq' && !near(e + 1)) e++;
      rows.push({ fold: k, n: e - k + 1 }); k = e; continue;
    }
    rows.push({ k, op: ops[k] });
  }
  const changed = ops.filter((o) => o.t !== 'eq').length;
  const cell = (o: Op, side: 'a' | 'b') => {
    if (o.t === 'chg') { const d = diff(o.a || '', o.b || ''); return <p>{side === 'a' ? d.was : d.now}</p>; }
    const t = side === 'a' ? o.a : o.b;
    if (t === undefined) return <p className="none" aria-hidden> </p>;
    return <p>{o.t === 'del' ? <del>{t}</del> : o.t === 'ins' ? <ins>{t}</ins> : t || ' '}</p>;
  };
  return (
    <div className="ac-ld">
      <div className="ac-ld-h">
        <span>{changed ? `${changed} ${changed === 1 ? 'line' : 'lines'} changed` : 'No change to the copy'}</span>
        <span className="ac-seg" role="radiogroup" aria-label="Diff view">
          <button type="button" role="radio" aria-checked={mode === 'split'} className={mode === 'split' ? 'on' : undefined} onClick={() => setMode('split')}><i className="ph ph-columns"></i>Side by side</button>
          <button type="button" role="radio" aria-checked={mode === 'inline'} className={mode === 'inline' ? 'on' : undefined} onClick={() => setMode('inline')}><i className="ph ph-rows"></i>Inline</button>
        </span>
      </div>
      <div className={`ac-ld-b ${mode}`}>
        {mode === 'split' ? <div className="ac-ld-r head"><small>{labels[0]}</small><small>{labels[1]}</small></div> : null}
        {rows.map((r) => 'fold' in r ? (
          <button key={`f${r.fold}`} type="button" className="ac-ld-fold" onClick={() => setOpen((o) => { const n = { ...o }; for (let x = r.fold; x < r.fold + r.n; x++) n[x] = true; return n; })}>
            <i className="ph ph-arrows-out-line-vertical"></i>{r.n} unchanged {r.n === 1 ? 'line' : 'lines'}
          </button>
        ) : mode === 'split' ? (
          <div key={r.k} className={`ac-ld-r ${r.op.t}`}>{cell(r.op, 'a')}{cell(r.op, 'b')}</div>
        ) : r.op.t === 'chg' ? (
          <div key={r.k} className="ac-ld-i chg">{cell(r.op, 'a')}{cell(r.op, 'b')}</div>
        ) : (
          <div key={r.k} className={`ac-ld-i ${r.op.t}`}>{cell(r.op, r.op.t === 'ins' ? 'b' : 'a')}</div>
        ))}
      </div>
    </div>
  );
}

/* THE RUN AS STEPS (review item 40, after Langfuse's trace tree): started, read the pipeline, wrote
 * files, manifest ready, each with how long it took and the files it touched, folded by default. The
 * times come from the run and from when each file in its out/ folder was written. */
function Steps({ run, files, stamps, now }: { run: Run; files: string[]; stamps: Record<string, number>; now: number }) {
  const t0 = Date.parse(run.createdAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const made = files.filter((f) => !f.endsWith('.json'));
  const manifest = files.find((f) => f.endsWith('post.json'));
  const first = made.length ? Math.min(...made.map((f) => stamps[f] || end)) : undefined;
  const last = made.length ? Math.max(...made.map((f) => stamps[f] || end)) : undefined;
  const mt = manifest ? stamps[manifest] : undefined;
  const dur = (a?: number, b?: number) => (a !== undefined && b !== undefined && b >= a ? ago(new Date(a).toISOString(), b) : '—');
  const failed = run.status === 'failed' || run.status === 'cancelled';
  const S: { t: string; d: string; state: 'ok' | 'on' | 'todo' | 'wn'; files?: string[] }[] = [
    { t: `Started ${agentName(run.agent)}`, d: '0s', state: 'ok' },
    { t: 'Read the pipeline', d: dur(t0, first ?? (run.status === 'running' ? undefined : end)), state: first || run.status !== 'running' ? 'ok' : 'on' },
    { t: made.length ? `Wrote ${made.length} ${made.length === 1 ? 'file' : 'files'}` : 'Wrote files', d: dur(first, last), state: made.length ? 'ok' : run.status === 'running' && first ? 'on' : failed ? 'wn' : 'todo', files: made },
    { t: 'Manifest ready', d: dur(last ?? t0, mt), state: manifest ? 'ok' : failed ? 'wn' : run.status === 'running' ? 'todo' : 'todo', files: manifest ? [manifest] : [] },
    { t: run.status === 'running' ? 'Running' : run.status === 'done' ? 'Finished' : run.status === 'cancelled' ? 'Stopped' : 'Failed', d: dur(t0, end), state: run.status === 'done' ? 'ok' : run.status === 'running' ? 'on' : 'wn' },
  ];
  return (
    <ol className="ac-tree">
      {S.map((x, k) => (
        <li key={k} className={x.state}>
          <details>
            <summary>
              <span className="ac-tree-i" aria-hidden>{x.state === 'ok' ? <i className="ph-bold ph-check"></i> : x.state === 'on' ? <span className="ac-spin"></span> : x.state === 'wn' ? <i className="ph-bold ph-exclamation-mark"></i> : null}</span>
              <span className="ac-tree-t">{x.t}</span>
              <span className="mono ac-tree-d">{x.d}</span>
            </summary>
            {x.files?.length ? <ul className="mono">{x.files.map((f) => <li key={f}>{f.split('/').pop()}</li>)}</ul> : <p className="mono">{k === 0 ? `${run.lane}/${run.id}` : 'No files for this step.'}</p>}
          </details>
        </li>
      ))}
    </ol>
  );
}

/* A word-level diff of two copies: what was cut and what was written, for the drawer's before
 * and after. Longest common subsequence over words; long copies skip the marking. */
function diff(a: string, b: string): { was: React.ReactNode[]; now: React.ReactNode[] } {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  if (A.length * B.length > 600000) return { was: [a], now: [b] };
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const was: React.ReactNode[] = [], now: React.ReactNode[] = [];
  let i = 0, j = 0, k = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { was.push(A[i]); now.push(B[j]); i++; j++; }
    else if (j < B.length && (i >= A.length || L[i][j + 1] >= L[i + 1][j])) { now.push(/^\s+$/.test(B[j]) ? B[j] : <ins key={`i${k++}`}>{B[j]}</ins>); j++; }
    else { was.push(/^\s+$/.test(A[i]) ? A[i] : <del key={`d${k++}`}>{A[i]}</del>); i++; }
  }
  return { was, now };
}

/* RUNS (2026-11-15 redesign, App · Runs, after Axon's table and drawer): every
 * preview, example, feedback and repair on this machine in one table, counted by state, and the
 * selected run in a drawer: what was asked, the queued copy beside the revision with the cut and
 * the new words marked, the agent's log under the boundary every run works in, and Use revision,
 * Open on Today and Discard. Build a preview opens the lane form in the same drawer. */
export function RunsView({ runs: initial, lanes, products, agents, defaultAgent, targets, scope = 'social', build }: {
  runs: Run[]; lanes: Lane[]; products: Product[]; agents: string[]; defaultAgent: string;
  targets: Record<string, Target>; scope?: 'social' | 'ads' | 'email';
  /** A lane to open the preview form on, from a lane card's Preview a post. */
  build?: string;
}) {
  const { machine } = useMachine();
  const [runs, setRuns] = useState<Run[]>(initial);
  const [seg, setSeg] = useState<Seg>('all');
  const [lane, setLane] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [building, setBuilding] = useState(!!build && lanes.some((l) => l.id === build && l.formats.length));
  const keep = useCallback((r: Run) => (scope === 'ads' ? !!r.ad : scope === 'email' ? !!r.target && lanes.some((l) => l.id === r.lane) : !r.ad), [scope, lanes]);
  const refresh = useCallback(async () => {
    const r = await machineFetch('/api/runs', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    if (r?.runs) setRuns((r.runs as Run[]).filter(keep));
  }, [keep]);
  useEffect(() => { const t = setTimeout(refresh, 0); return () => clearTimeout(t); }, [refresh, machine]);
  const live = runs.some((r) => r.status === 'running');
  useEffect(() => { if (!live) return; const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [live, refresh]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setBuilding(false); } };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const byLane = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const laneOf = (id: string): Lane => byLane.get(id) || { id, name: id, platform: 'other', formats: [] };
  const segOf = (r: Run): Seg => (r.status === 'running' ? 'running' : r.status === 'done' ? 'done' : 'failed');
  const inLane = runs.filter((r) => !lane || r.lane === lane);
  const shown = inLane.filter((r) => seg === 'all' || segOf(r) === seg).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const n = (s: Seg) => inLane.filter((r) => s === 'all' || segOf(r) === s).length;
  const targetOf = (r: Run): Target | undefined => (r.target ? targets[`${r.target.day}:${r.target.id}`] : r.ad ? targets[`ad:${r.ad.id}`] : undefined);
  const titleOf = (r: Run) => targetOf(r)?.title || (r.format ? laneOf(r.lane).formats.find((f) => f.id === r.format)?.label : '') || (r.product ? products.find((p) => p.id === r.product)?.name : '') || 'Agent’s pick';
  const cur = runs.find((r) => r.id === open);
  const lanesWithRuns = [...new Set(runs.map((r) => r.lane))];

  const status = (r: Run) => r.status === 'running' ? <span className="ac-chip warn"><span className="ac-spin" style={{ width: 10, height: 10, borderWidth: 1.5 }} aria-hidden></span>Running</span>
    : r.replaced ? <span className="ac-chip ok">Replaced</span>
    : r.status === 'done' ? <span className="ac-chip ok-soft">{r.action === 'repair' && r.target ? 'Ready' : 'Done'}</span>
    : r.status === 'cancelled' ? <span className="ac-chip">Stopped</span>
    : <span className="ac-chip bad">Failed</span>;

  return (
    <>
      <div className="ac-bar">
        <span className="ac-seg" role="radiogroup" aria-label="Runs by state">
          {(['all', 'running', 'done', 'failed'] as Seg[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={seg === s} className={seg === s ? 'on' : undefined} onClick={() => setSeg(s)}>
              {s === 'all' ? 'All' : s === 'running' ? 'Running' : s === 'done' ? 'Done' : 'Failed'} <span className="num" style={{ color: 'var(--faint)' }}>{n(s)}</span>
            </button>
          ))}
        </span>
        {lanesWithRuns.length > 1 ? (
          <label className="ac-pill">Lane is <b>{lane ? laneOf(lane).name : 'any'}</b><i className="ph ph-caret-down" aria-hidden></i>
            <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="Lane">
              <option value="">any</option>
              {lanesWithRuns.map((id) => <option key={id} value={id}>{laneOf(id).name}</option>)}
            </select>
          </label>
        ) : null}
        {scope === 'social' ? <button type="button" className="ac-btn pri" style={{ marginLeft: 'auto' }} onClick={() => { setOpen(null); setBuilding(true); }}><i className="ph-bold ph-play"></i>Build a preview</button> : null}
      </div>

      {shown.length ? (
        <table className="ac-table">
          <thead><tr><th>Run</th><th className="hide-s">Lane</th><th>Kind</th><th>Status</th><th className="hide-s">Started</th><th className="hide-s">Took</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const l = laneOf(r.lane);
              return (
                <tr key={r.id} className={open === r.id ? 'on' : undefined} onClick={() => { setBuilding(false); setOpen(r.id); }}>
                  <td><span className="ac-rn"><button type="button" onClick={(e) => { e.stopPropagation(); setBuilding(false); setOpen(r.id); }}>{titleOf(r)}</button><small>{l.name} · {agentName(r.agent)}</small></span></td>
                  <td className="hide-s"><LaneTile l={l} size="md" /></td>
                  <td><span className="ac-chip kind"><i className={`ph ${KICON[r.action || 'preview']}`} aria-hidden></i>{KIND[r.action || 'preview']}</span></td>
                  <td>{status(r)}</td>
                  <td className="hide-s num">{since(r.createdAt)}</td>
                  <td className="hide-s num">{r.finishedAt ? ago(r.createdAt, Date.parse(r.finishedAt)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="ac-empty">
          <span className="ac-empty-i"><i className={`ph ${runs.length ? 'ph-funnel-simple' : 'ph-play-circle'}`}></i></span>
          <b>{runs.length ? 'No run matches' : 'No runs yet'}</b>
          <p>{runs.length ? 'Every other run is still here.' : scope === 'social' ? 'Build a preview and a headless agent runs a lane’s own pipeline for one post. Example, Feedback and Repair on a post show up here too.' : 'Example, Feedback and Repair on an item show up here.'}</p>
          {runs.length ? <button type="button" className="ac-btn" onClick={() => { setSeg('all'); setLane(''); }}><i className="ph ph-arrow-counter-clockwise"></i>Show every run</button>
            : scope === 'social' ? <button type="button" className="ac-btn pri" onClick={() => setBuilding(true)}><i className="ph-bold ph-play"></i>Build a preview</button> : null}
        </div>
      )}

      {cur ? <RunDrawer key={cur.id} run={cur} lane={laneOf(cur.lane)} title={titleOf(cur)} target={targetOf(cur)} agents={agents} defaultAgent={defaultAgent} status={status(cur)}
        onClose={() => setOpen(null)} onChange={refresh} onNew={(r) => { setRuns((rs) => [r, ...rs]); setOpen(r.id); }} /> : null}
      {building ? (
        <>
          <div className="ac-drawer-back" onClick={() => setBuilding(false)} aria-hidden></div>
          <div className="ac-drawer" role="dialog" aria-modal="true" aria-label="Build a preview">
            <div className="ac-drawer-h"><div><h2>Build a preview</h2><p>{build && byLane.has(build) ? `For ${laneOf(build).name}. ` : ''}One sample post from a lane&apos;s own pipeline, made on your machine.</p></div><button type="button" className="ac-ib" aria-label="Close" onClick={() => setBuilding(false)}><i className="ph ph-x"></i></button></div>
            <div className="ac-drawer-b ac-build">
              <LaneStudio formOnly fixedLane={build && lanes.some((l) => l.id === build) ? build : undefined} lanes={lanes.filter((l) => l.formats.length)} products={products} agents={agents} defaultAgent={defaultAgent} initialRuns={[]}
                onStarted={(r) => { setRuns((rs) => [r, ...rs]); setBuilding(false); setOpen(r.id); }} />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function RunDrawer({ run, lane, title, target, status, onClose, onChange, onNew }: {
  run: Run; lane: Lane; title: string; target?: Target; agents: string[]; defaultAgent: string; status: React.ReactNode;
  onClose: () => void; onChange: () => void; onNew: (r: Run) => void;
}) {
  const [log, setLog] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [stamps, setStamps] = useState<Record<string, number>>({});
  const [polledAt, setPolledAt] = useState(() => Date.parse(run.finishedAt || run.createdAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [comment, setComment] = useState('');
  const [cur, setCur] = useState<Run>(run);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await machineFetch(`/api/runs/${run.id}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (stop || !r) return;
      if (r.run) setCur(r.run);
      if (typeof r.log === 'string') setLog(r.log);
      if (Array.isArray(r.files)) setFiles(r.files);
      if (r.stamps && typeof r.stamps === 'object') setStamps(r.stamps);
      setPolledAt(Date.now());
      if (r.run?.status === 'running') setTimeout(tick, 3000); else onChange();
    };
    tick();
    return () => { stop = true; };
  }, [run.id, onChange]);
  const post = async (path: string, body?: unknown) => {
    setBusy(true); setErr('');
    const r = await machineFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) { setErr(r.error); return null; }
    return r;
  };
  const replace = async (kind: 'replace' | 'undo') => { const r = await post(`/api/runs/${cur.id}/${kind}`); if (r?.run) { setCur(r.run); onChange(); } };
  const revise = async () => { if (!comment.trim()) return; const r = await post(`/api/runs/${cur.id}/revise`, { comment }); if (r?.run) { setComment(''); onNew(r.run); } };
  const stop = async () => { await machineFetch(`/api/runs/${cur.id}`, { method: 'DELETE' }); onChange(); };
  const out = cur.output;
  const after = out?.text || out?.thread?.join('\n\n') || '';
  const before = target?.text || '';
  const said = cur.comment || cur.request;
  const made = files.filter((f) => !f.endsWith('.json'));
  const tail = log.trim().split('\n').filter(Boolean).slice(-10);
  const canUse = cur.action === 'repair' && !!(cur.target || cur.ad) && cur.status === 'done' && !!out && !cur.replaced;
  const todayHref = cur.target ? `/?day=${cur.target.day}&post=${encodeURIComponent(cur.target.id)}` : cur.ad ? '/ads' : `/lanes/${cur.lane}`;
  return (
    <>
      <div className="ac-drawer-back" onClick={onClose} aria-hidden></div>
      <div className="ac-drawer" role="dialog" aria-modal="true" aria-label={`${lane.name} · ${title}`}>
        <div className="ac-drawer-h">
          <LaneTile l={lane} size="lg" />
          <div><h2>{title}{status}</h2><p>{lane.name}</p><p>{KIND[cur.action || 'preview']} · {agentName(cur.agent)} · {since(cur.createdAt)}</p><p className="mono ac-drawer-id">{cur.id}</p></div>
          <button type="button" className="ac-ib" aria-label="Close" onClick={onClose}><i className="ph ph-x"></i></button>
        </div>
        <div className="ac-drawer-b">
          {said ? <div className="ac-said"><small><i className="ph ph-chat-text"></i>{cur.comment ? 'Your comment' : 'What was asked'}</small>“{said}”</div> : null}
          {before && after ? (
            <section>
              <h3>Before and after</h3>
              <LineDiff before={before} after={after} labels={cur.action === 'example' ? ['Queued', 'New example'] : ['Before', 'After']} />
            </section>
          ) : null}
          {target || out?.media.length ? (
            <section>
              <h3>Media</h3>
              <div className="ac-cmp">
                <figure><figcaption>{cur.action === 'example' ? 'Queued' : 'Before'}</figcaption>{target?.media.length ? <Car media={target.media} /> : <p className="ac-cmp-none">{target ? 'The queued post has no media.' : 'Nothing was queued before this preview.'}</p>}</figure>
                <figure className="new"><figcaption>{target ? (cur.action === 'example' ? 'New example' : 'After') : 'Made'}</figcaption>{out?.media.length ? <Car media={out.media} /> : <p className="ac-cmp-none">{cur.status === 'running' ? 'Still working.' : 'No media in this run.'}</p>}</figure>
              </div>
            </section>
          ) : null}
          {!target && out && (out.text || out.thread?.length) ? <section><h3>The post</h3><PostView lane={lane.name} handle={lane.handle} platformId={lane.platform} text={out.text} thread={out.thread} media={[]} compact /></section> : null}
          {out?.notes ? <p className="ac-run-note" style={{ fontSize: 13.5 }}>{out.notes}</p> : null}
          {cur.error ? <p className="ac-err"><i className="ph ph-warning-circle"></i>{cur.error}</p> : null}
          <section>
            <h3>Steps</h3>
            <Steps run={cur} files={files} stamps={stamps} now={polledAt} />
          </section>
          <section>
            <h3>Log</h3>
            <pre className="ac-log" aria-label="The agent's log">
              <span className="b">run · {cur.lane}/{cur.id}</span>{'\n'}
              <span className="b">→ no network · writes only to its run folder, runs/{cur.id}/out/</span>{'\n'}
              {tail.map((t, k) => <span key={k}>{t}{'\n'}</span>)}
              {made.length ? <span className="ok">✓ made {made.map((f) => f.split('/').pop()).join(', ')}{'\n'}</span> : null}
              {cur.status === 'running' ? <span className="on">● {agentName(cur.agent)} is working</span>
                : cur.replaced ? <span className="ok">✓ replaced the queued {cur.ad ? 'creative' : 'post'}</span>
                : canUse ? <span className="on">● waiting for your approval</span>
                : cur.status === 'done' ? <span className="ok">✓ done</span>
                : <span className="on">● {cur.status === 'cancelled' ? 'stopped' : 'failed'}</span>}
            </pre>
          </section>
          {cur.status !== 'running' ? (
            <div className="ac-again">
              <textarea rows={1} value={comment} aria-label="Comment to revise" placeholder={cur.status === 'done' ? 'What should change?' : 'Try again with…'} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) revise(); }} />
              <button type="button" className="ac-btn" disabled={busy || !comment.trim()} onClick={revise}><i className="ph ph-arrow-clockwise"></i>Revise</button>
            </div>
          ) : null}
          {err ? <p className="ac-err" role="alert"><i className="ph ph-warning-circle"></i>{err}</p> : null}
        </div>
        <div className="ac-drawer-f">
          {cur.status === 'running' ? <button type="button" className="ac-btn" onClick={stop}><i className="ph ph-stop"></i>Stop</button> : <button type="button" className="ac-btn" onClick={onClose}>Discard</button>}
          {cur.target || cur.ad ? <a className="ac-btn" href={todayHref}>{cur.ad ? 'Open on Ads' : 'Open on Today'}</a> : <a className="ac-btn" href={`/lanes/${cur.lane}`}>Open the lane</a>}
          {cur.replaced ? <button type="button" className="ac-btn" disabled={busy} onClick={() => replace('undo')}><i className="ph ph-arrow-counter-clockwise"></i>Undo</button>
            : canUse ? <button type="button" className="ac-btn pri" disabled={busy} onClick={() => replace('replace')}><i className="ph-bold ph-check"></i>Use revision</button> : null}
        </div>
      </div>
    </>
  );
}
