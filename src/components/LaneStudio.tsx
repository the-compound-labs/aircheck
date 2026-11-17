'use client';

import { machineFetch, useMachine, OFFLINE } from '@/lib/machine';

import { Select } from './Select';

import { useCallback, useEffect, useState } from 'react';
import type { Lane, Product, Run } from '@/server/types';
import { ago, mediaUrl, platform } from '@/lib/ui';
import { PostView } from './PostView';

/* THE PREVIEW STUDIO for one lane, or for every lane when `lanes` has more than one. The form starts a
 * headless agent run; each run is a card that shows the agent working, then the post it made. A comment
 * on a finished card starts a revision, which appears above it linked to its parent. */
export function LaneStudio({ lanes: pageLanes, products: pageProducts, agents: pageAgents, defaultAgent: pageDefault, initialRuns, fixedLane, formOnly, onStarted }: {
  lanes: Lane[]; products: Product[]; agents: string[]; defaultAgent: string; initialRuns: Run[]; fixedLane?: string;
  /** Only the form, for the Runs page's drawer; a started run is handed to onStarted. */
  formOnly?: boolean; onStarted?: (r: Run) => void;
}) {
  /* On aircheck.dev the lanes a preview can run, the products and the agents are the machine's:
   * the server knows only what was synced. */
  const { machine, hosted, checked } = useMachine();
  const offline = hosted && checked && !machine;
  const lanes = machine ? (fixedLane ? machine.lanes.filter((l) => l.id === fixedLane) : machine.lanes.filter((l) => l.formats.length)) : pageLanes;
  const products = machine?.products || pageProducts;
  const agents = machine?.agents || pageAgents;
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [chosenLane, setLaneId] = useState('');
  const laneId = chosenLane || fixedLane || lanes[0]?.id || '';
  const lane = lanes.find((l) => l.id === laneId);
  const [format, setFormat] = useState('');
  const [chosenProduct, setProduct] = useState<string | null>(null);
  const product = chosenProduct ?? products[0]?.id ?? '';
  const [chosenAgent, setAgent] = useState('');
  const agent = chosenAgent || machine?.defaultAgent || pageDefault;
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const r = await machineFetch(`/api/runs${fixedLane ? `?lane=${encodeURIComponent(fixedLane)}` : ''}`, { cache: 'no-store' }).then((x) => x.json()).then((x) => (x?.runs ? { runs: (x.runs as Run[]).filter((r) => !r.target) } : x)).catch(() => null);
    if (r?.runs) setRuns(r.runs);
  }, [fixedLane]);
  /* The runs live on the machine, so a hosted page asks it once the machine has answered. */
  useEffect(() => { if (!machine) return; const t = setTimeout(refresh, 0); return () => clearTimeout(t); }, [machine, refresh]);
  const running = runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [running, refresh]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await machineFetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lane: laneId, format, product, agent, request }) }).then((x) => x.json()).catch((x) => ({ error: String(x) }));
    setBusy(false);
    if (r.error) return setError(r.error);
    setRequest('');
    setRuns((rs) => [r.run, ...rs]);
    onStarted?.(r.run);
  }

  return (
    <div className="studio">
      <form className="card form" onSubmit={start}>
        <h2><i className="ph ph-sparkle"></i>Build a preview</h2>
        {!fixedLane ? (
          <label>Lane
            <Select label="Lane" value={laneId} onChange={(v) => { setLaneId(v); setFormat(''); }}
              options={lanes.map((l) => ({ value: l.id, label: l.name }))} />
          </label>
        ) : null}
        {lane?.formats.length ? (
          <label>Format
            <Select label="Format" value={format} onChange={setFormat}
              options={[{ value: '', label: 'Let the agent pick' }, ...lane.formats.map((f) => ({ value: f.id, label: f.label, note: f.note }))]} />
          </label>
        ) : null}
        {format && lane ? <p className="hint">{lane.formats.find((f) => f.id === format)?.note}</p> : null}
        <label>About
          <Select label="About" value={product} onChange={setProduct}
            options={[{ value: '', label: 'No product' }, ...products.map((p) => ({ value: p.id, label: p.name }))]} />
        </label>
        <label>Ask for anything specific
          <textarea rows={4} value={request} onChange={(e) => setRequest(e.target.value)} placeholder="A five-slide carousel on the new search, dark covers" />
        </label>
        <label>Agent
          {/* The agent is a product, so it is named with its own mark. */}
          <span className="seg agents">{agents.map((a) => (
            <button type="button" key={a} className={agent === a ? 'on' : undefined} onClick={() => setAgent(a)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a === 'codex' || a === 'claude' ? <img src={`/${a === 'codex' ? 'openai' : 'claude'}.svg`} alt="" /> : null}
              {a === 'codex' ? 'Codex' : a === 'claude' ? 'Claude' : a}
            </button>
          ))}</span>
        </label>
        {error ? <p className="err">{error}</p> : null}
        {offline ? <p className="machine-off"><i className="ph ph-desktop"></i>{OFFLINE}</p> : null}
        <button className="btn pri" disabled={busy || !laneId || offline}><i className="ph ph-play"></i>{busy ? 'Starting…' : 'Build preview'}</button>
        <p className="hint">The agent reads this lane&apos;s real pipeline and builds one post in its own folder. It can&apos;t post anything. Most runs take a few minutes.{hosted ? ' It runs on your computer, not on aircheck.dev.' : ''}</p>
      </form>

      {formOnly ? null : <section className="runs">
        {runs.length === 0 ? <div className="empty"><i className="ph ph-sparkle"></i><p>No previews yet. Build one and it will show up here once the agent finishes.</p></div> : null}
        {runs.map((r) => <RunCard key={r.id} run={r} lane={lanes.find((l) => l.id === r.lane)} product={products.find((p) => p.id === r.product)} onChange={refresh} onNew={(n) => setRuns((rs) => [n, ...rs])} />)}
      </section>}
    </div>
  );
}

export function RunCard({ run, lane, product, onChange, onNew }: { run: Run; lane?: Lane; product?: Product; onChange: () => void; onNew: (r: Run) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (run.status !== 'running' && !showLog) return;
    const tick = async () => {
      setNow(Date.now());
      const r = await machineFetch(`/api/runs/${run.id}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (r?.log !== undefined) setLog(r.log);
      if (Array.isArray(r?.files)) setFiles(r.files);
    };
    tick();
    if (run.status !== 'running') return;
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [run.id, run.status, showLog]);

  async function revise(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setSending(true); setErr('');
    const r = await machineFetch(`/api/runs/${run.id}/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comment }) }).then((x) => x.json()).catch((x) => ({ error: String(x) }));
    setSending(false);
    if (r.error) return setErr(r.error);
    setComment('');
    onNew(r.run);
  }
  async function stop() { await machineFetch(`/api/runs/${run.id}`, { method: 'DELETE' }); onChange(); }

  const p = platform(lane?.platform || 'other');
  const fmt = lane?.formats.find((f) => f.id === run.format)?.label;
  const tail = log.trim().split('\n').slice(-6).join('\n');
  return (
    <article className={`card run r-${run.status}`}>
      <header className="rh">
        <i className={`ph ${p.icon}`}></i>
        <b>{lane?.name || run.lane}</b>
        <span className="muted">{[fmt, product?.name].filter(Boolean).join(' · ') || 'Agent’s pick'}</span>
        <span className={`st s-${run.status}`}>{run.status === 'running' ? <><span className="spin" />{ago(run.createdAt, now)}</> : run.status}</span>
      </header>
      {run.comment ? <p className="ask"><i className="ph ph-arrow-bend-down-right"></i>Revision: “{run.comment}”</p> : run.request ? <p className="ask"><i className="ph ph-chat-text"></i>“{run.request}”</p> : null}

      {run.status === 'running' ? (
        <div className="working">
          {files.some((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)) ? (
            <div className="sofar">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {files.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).map((f) => <img key={f} src={mediaUrl(f)} alt="" />)}
            </div>
          ) : <div className="shimmer" aria-hidden />}
          <p className="hint">{files.length ? `Made so far: ${files.map((f) => f.split('/').pop()).join(', ')}` : `${run.agent === 'codex' ? 'Codex' : run.agent} is reading the lane's pipeline. Files appear here as it writes them.`}</p>
          {tail ? <pre className="log">{tail}</pre> : null}
          <button type="button" className="btn sm" onClick={stop}><i className="ph ph-stop"></i>Stop</button>
        </div>
      ) : null}

      {run.output && (run.output.text || run.output.media.length || run.output.thread?.length) ? (
        <PostView lane={lane?.name || run.lane} handle={lane?.handle} platformId={lane?.platform || 'other'} text={run.output.text} thread={run.output.thread} media={run.output.media} />
      ) : null}
      {run.output?.notes ? <p className="notes"><i className="ph ph-info"></i>{run.output.notes}</p> : null}
      {run.error ? <p className="err">{run.error}</p> : null}

      {run.status !== 'running' ? (
        <>
          <form className="revise" onSubmit={revise}>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={run.status === 'done' ? 'What should change?' : 'Try again with…'}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
            <button className="btn pri" disabled={sending || !comment.trim()}><i className="ph ph-arrow-clockwise"></i>{sending ? 'Starting…' : 'Revise'}</button>
          </form>
          {err ? <p className="err">{err}</p> : null}
          <footer className="rf">
            <span>{run.agent} · {new Date(run.createdAt).toLocaleString()}{run.finishedAt ? ` · took ${ago(run.createdAt, Date.parse(run.finishedAt))}` : ''}</span>
            <button type="button" className="lnk" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide log' : 'Agent log'}</button>
          </footer>
          {showLog ? <pre className="log full">{log || '(empty)'}</pre> : null}
        </>
      ) : null}
    </article>
  );
}
