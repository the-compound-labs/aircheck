'use client';

import { machineFetch, useMachine, OFFLINE } from '@/lib/machine';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdCreative, QueueItem, Run, RunAction } from '@/server/types';
import { ago, since } from '@/lib/ui';
import { Car } from './Car';

export type Mode = Exclude<RunAction, 'preview'>;

export const LABEL: Record<Mode, string> = { example: 'Example', feedback: 'Feedback', repair: 'Repair' };
const NOTE: Record<Mode, string> = {
  example: 'Runs the pipeline that made this post again, for a fresh one. Shown here only.',
  feedback: 'Revises this post from your comment. Shown here only.',
  repair: 'Rebuilds this post through its pipeline. You choose whether it replaces the queued one.',
};
const AD_NOTE: Record<Mode, string> = {
  example: 'Runs the pipeline that made this creative again, for a fresh one. Shown here only.',
  feedback: 'Revises this creative from your comment. Shown here only.',
  repair: 'Rebuilds this creative through its pipeline. You choose whether it replaces the draft.',
};
export const agentName = (a: string) => (a === 'codex' ? 'Codex' : a === 'claude' ? 'Claude' : a);

/** The runs on one post or creative, read from wherever runs live (this app locally, the machine
 *  on aircheck.dev). On the sample day the runs are handed in and nothing is fetched. */
export function useItemRuns(item: QueueItem, ad: AdCreative | undefined, demoRuns?: Run[]) {
  const [runs, setRuns] = useState<Run[]>(demoRuns || []);
  const { machine } = useMachine();
  const load = useCallback(async () => {
    if (demoRuns) return;
    const r = await machineFetch(
      ad ? `/api/runs?ad=${encodeURIComponent(ad.id)}` : `/api/runs?day=${encodeURIComponent(item.day || '')}&item=${encodeURIComponent(item.id)}`,
      { cache: 'no-store' },
    ).then((x) => x.json()).catch(() => null);
    if (r?.runs) setRuns(r.runs);
  }, [ad, item.day, item.id, demoRuns]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load, machine]);
  return { runs, load };
}

/* THE FIX LOOP of an opened post, the redesign's revised-run card and the "ask for a change" box.
 * A run always builds a candidate beside the original; only a repair offers Replace ("Use
 * revision"), and Replace keeps a backup for Undo. Progress is read from what the agent has
 * actually written to its folder. The card renders where `slot` says: "card" in the post's flow,
 * "compose" pinned under it, so one component owns the run and both halves stay in step. */
export function Actions({ item, ad, agents: pageAgents, defaultAgent: pageDefault, demo, runs, reload, active, setActive, clockAt }: {
  item: QueueItem; ad?: AdCreative; agents: string[]; defaultAgent: string; demo?: boolean; clockAt?: number;
  runs: Run[]; reload: () => void; active: string | null; setActive: (id: string | null) => void;
}) {
  const router = useRouter();
  /* On aircheck.dev the agents are the machine's, and so is every run. */
  const { machine, hosted, checked } = useMachine();
  const offline = hosted && checked && !machine && !demo;
  const agents = machine?.agents || pageAgents;
  const defaultAgent = machine?.defaultAgent || pageDefault;
  const [mode, setMode] = useState<Mode>('feedback');
  const [run, setRun] = useState<Run | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [again, setAgain] = useState('');
  const [chosenAgent, setAgent] = useState('');
  const agent = chosenAgent || defaultAgent;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [compare, setCompare] = useState(true);
  const [anchor, setAnchor] = useState<{ label: string; about: string } | null>(null);
  useEffect(() => {
    const f = (e: Event) => {
      const a = (e as CustomEvent).detail as { label: string; about: string };
      setAnchor(a); setMode((m) => (m === 'example' ? 'feedback' : m));
      setTimeout(() => (document.querySelector('.ac-compose textarea') as HTMLTextAreaElement | null)?.focus(), 30);
    };
    window.addEventListener('aircheck:anchor', f);
    return () => window.removeEventListener('aircheck:anchor', f);
  }, []);
  const withAnchor = (t: string) => (anchor ? `${anchor.about}: ${t}` : t);

  const isAd = !!ad;
  const notes = isAd ? AD_NOTE : NOTE;
  const noun = isAd ? 'creative' : item.email ? 'email' : 'post';
  const body = (action: Mode, request: string) => (isAd ? { action, ad: ad!.id, request, agent } : { action, day: item.day, item: item.id, request, agent });
  const missing = isAd ? ad!.missing : item.missing;

  /* A part's Fix opens Repair with what to fix already written, and puts the cursor in the box. */
  useEffect(() => {
    const f = (e: Event) => {
      setErr(''); setActive(null); setRun(null); setMode('repair'); setText(String((e as CustomEvent).detail || ''));
      setTimeout(() => (document.querySelector('.ac-compose textarea') as HTMLTextAreaElement | null)?.focus(), 30);
    };
    window.addEventListener('aircheck:fix', f);
    return () => window.removeEventListener('aircheck:fix', f);
  }, [setActive]);

  /* Open the live run, if there is one, the moment the runs arrive. */
  useEffect(() => {
    if (active) return;
    const live = runs.find((x) => x.status === 'running');
    if (live) { const t = setTimeout(() => setActive(live.id), 0); return () => clearTimeout(t); }
  }, [runs, active, setActive]);

  /* follow the active run: on the sample day it is one of the runs handed in; otherwise polled. */
  useEffect(() => {
    if (!active) { const t = setTimeout(() => setRun(null), 0); return () => clearTimeout(t); }
    if (demo) { const t = setTimeout(() => setRun(runs.find((r) => r.id === active) || null), 0); return () => clearTimeout(t); }
    let stop = false;
    const tick = async () => {
      const r = await machineFetch(`/api/runs/${active}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (stop || !r?.run) return;
      setRun(r.run); setFiles(r.files || []); setNow(Date.now());
      if (r.run.status === 'running') setTimeout(tick, 2500);
      else reload();
    };
    tick();
    return () => { stop = true; };
  }, [active, reload, demo, runs]);

  const repairOff = isAd ? (ad!.lock || '') : item.status === 'sent' ? 'Already sent. Repair is off for sent posts.' : '';

  async function start() {
    /* On the sample day a run needs your own pipeline, so it goes to sign in, in the whole tab. */
    if (demo) { (window.top || window).location.href = '/?signin=1'; return; }
    if (mode === 'feedback' && !text.trim()) return;
    setBusy(true); setErr('');
    const r = await machineFetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(mode, withAnchor(text))) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) return setErr(r.error);
    setText(''); setAnchor(null); setFiles([]); setRun(r.run); setActive(r.run.id); reload();
  }
  async function revise() {
    if (demo) { (window.top || window).location.href = '/?signin=1'; return; }
    if (!run || !again.trim()) return;
    setBusy(true); setErr('');
    const r = await machineFetch(`/api/runs/${run.id}/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comment: again, agent }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) return setErr(r.error);
    setAgain(''); setFiles([]); setRun(r.run); setActive(r.run.id); reload();
  }
  async function swap(kind: 'replace' | 'undo') {
    if (demo) { (window.top || window).location.href = '/?signin=1'; return; }
    if (!run) return;
    setBusy(true); setErr('');
    const r = await machineFetch(`/api/runs/${run.id}/${kind}`, { method: 'POST' }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) return setErr(r.error);
    setRun(r.run); reload(); router.refresh();
  }
  async function stopRun() { if (run && !demo) { await machineFetch(`/api/runs/${run.id}`, { method: 'DELETE' }); setActive(null); reload(); } }
  const close = () => { setActive(null); setErr(''); };

  const runMode = (run?.action as Mode) || 'example';
  const said = run?.comment || run?.request;
  const head = run ? (
    <div className="ac-run-h">
      <i className={`ph ${runMode === 'repair' ? 'ph-wrench' : runMode === 'feedback' ? 'ph-chat-circle-text' : 'ph-sparkle'}`} aria-hidden></i>
      <b>{run.parent || run.comment ? 'Revised run' : LABEL[runMode] === 'Example' ? 'Example run' : `${LABEL[runMode]} run`}</b>
      <span className="ac-run-who">{agentName(run.agent)}</span>
      {runMode === 'repair' ? <span className="ac-chip ok-soft">{run.replaced ? 'Replaced' : 'Can replace'}</span> : <span className="ac-chip">Shown only</span>}
      <span className="ac-run-t num">{run.status === 'running' ? ago(run.createdAt, now) : since(run.finishedAt || run.createdAt, clockAt)}</span>
      <button type="button" className="ac-x" aria-label="Close this run" onClick={close}><i className="ph ph-x"></i></button>
    </div>
  ) : null;

  let card: React.ReactNode = null;
  if (run) {
    if (run.status === 'running') {
      const made = files.filter((f) => !f.endsWith('.json'));
      const S = [
        { t: `Started ${agentName(run.agent)}`, done: true },
        { t: `Reading the pipeline that made this ${noun}`, done: made.length > 0 },
        { t: made.length ? `Made ${made.length} ${made.length === 1 ? 'file' : 'files'}` : 'Rendering', done: files.some((f) => f.endsWith('post.json')) },
        { t: 'post.json', done: false },
      ];
      const k = S.findIndex((s) => !s.done);
      card = (
        <section className="ac-run live" aria-live="polite">{head}
          {said ? <p className="ac-run-said">“{said}”</p> : null}
          <ol className="ac-steps">{S.map((s, n) => <li key={n} className={n < k ? 'ok' : n === k ? 'on' : undefined}>{n < k ? <i className="ph-bold ph-check"></i> : n === k ? <span className="ac-spin" aria-hidden></span> : <i className="ph ph-circle"></i>}<span className={s.t === 'post.json' ? 'mono' : undefined}>{s.t}</span></li>)}</ol>
          <div className="ac-run-f"><button type="button" className="ac-btn" onClick={stopRun}><i className="ph ph-stop"></i>Stop</button></div>
        </section>
      );
    } else if (run.status === 'done' && run.output) {
      const after = run.output;
      const lock = isAd ? ad!.lock : item.lock;
      const beforeText = ((isAd ? ad!.text : item.text) || (isAd ? ad!.title : item.title) || '');
      const afterText = after.text || after.thread?.join('\n\n') || '';
      card = run.replaced ? (
        <section className="ac-run done">{head}
          <p className="ac-run-ok"><i className="ph-fill ph-check-circle"></i>The queued {noun} now uses this version. The old copy and files are backed up beside it, and it still sends on schedule.</p>
          <div className="ac-run-f"><button type="button" className="ac-btn" disabled={busy} onClick={() => swap('undo')}><i className="ph ph-arrow-counter-clockwise"></i>Undo</button><button type="button" className="ac-btn" onClick={close}>Done</button></div>
        </section>
      ) : (
        <section className="ac-run done">{head}
          {said ? <p className="ac-run-said">“{said}”</p> : null}
          {after.notes ? <p className="ac-run-note">{after.notes}</p> : !compare ? <p className="ac-run-note">{afterText.split('\n')[0]}</p> : null}
          {compare ? (
            <div className="ac-cmp">
              <figure><figcaption>{runMode === 'example' ? (isAd ? 'Current draft' : 'Queued') : 'Before'}</figcaption><Car media={isAd ? ad!.media : item.media} /><p>{beforeText.split('\n')[0]}</p></figure>
              <figure className="new"><figcaption>{runMode === 'example' ? 'New example' : 'After'}{run.finishedAt ? <span className="num"> · took {ago(run.createdAt, Date.parse(run.finishedAt))}</span> : null}</figcaption><Car media={after.media} /><p>{afterText.split('\n')[0]}</p></figure>
            </div>
          ) : null}
          <div className="ac-run-f">
            {runMode === 'repair' ? (lock ? <span className="ac-lock"><i className="ph ph-lock-simple"></i>{lock}</span> : <button type="button" className="ac-btn pri" disabled={busy} onClick={() => swap('replace')}><i className="ph-bold ph-check"></i>Use revision</button>) : null}
            <button type="button" className="ac-btn" aria-pressed={compare} onClick={() => setCompare(!compare)}><i className="ph ph-columns"></i>Compare</button>
            <button type="button" className="ac-btn" onClick={close}>Discard</button>
          </div>
          <div className="ac-again">
            <textarea rows={1} value={again} aria-label="Comment to revise again" placeholder="Comment to revise again…" onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) revise(); }} />
            <button type="button" className="ac-btn" disabled={busy || !again.trim()} onClick={revise}><i className="ph ph-arrow-clockwise"></i>Revise</button>
          </div>
        </section>
      );
    } else {
      card = (
        <section className="ac-run bad">{head}
          <p className="ac-run-err">{run.status === 'cancelled' ? 'Stopped.' : run.error || 'The run finished without a post.'}</p>
          <div className="ac-run-f"><button type="button" className="ac-btn" onClick={() => { setMode(runMode); setText(run.comment || run.request || ''); close(); }}><i className="ph ph-arrow-clockwise"></i>Try again</button></div>
        </section>
      );
    }
  }

  const can = (m: Mode) => !(m === 'repair' && repairOff);
  const placeholder = mode === 'feedback' ? `Ask for a change to this ${noun}…` : mode === 'repair' ? 'What is wrong with it? (optional)' : 'Anything specific? (optional)';
  return (
    <>
      {card}
      {offline ? <p className="ac-off"><i className="ph ph-desktop"></i>{OFFLINE}</p> : null}
      <div className="ac-compose">
        {err ? <p className="ac-err" role="alert"><i className="ph ph-warning-circle"></i>{err}</p> : null}
        <div className="ac-compose-box">
          {anchor ? <p className="ac-anchor"><i className="ph ph-quotes" aria-hidden></i><span>On {anchor.label}</span><button type="button" className="ac-x" aria-label="Comment on the whole post" onClick={() => setAnchor(null)}><i className="ph ph-x"></i></button></p> : null}
          <textarea rows={2} value={text} aria-label={placeholder} placeholder={placeholder}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }} />
          <div className="ac-compose-row">
            <span className="ac-seg" role="radiogroup" aria-label="What the run does">
              {(['feedback', 'repair', 'example'] as Mode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : undefined} disabled={!can(m)} title={!can(m) ? repairOff : notes[m]}
                  onClick={() => { setMode(m); if (m === 'repair' && !text && missing?.length) setText(`Rebuild the ${missing.length} missing ${missing.length === 1 ? 'file' : 'files'}`); }}>
                  {LABEL[m]}
                </button>
              ))}
            </span>
            {agents.length > 1 ? (
              <span className="ac-seg ac-agents" role="radiogroup" aria-label="Agent">{agents.map((a) => (
                <button type="button" role="radio" aria-checked={agent === a} aria-label={agentName(a)} title={agentName(a)} key={a} className={agent === a ? 'on' : undefined} onClick={() => setAgent(a)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a === 'codex' || a === 'claude' ? <img src={`/${a === 'codex' ? 'openai' : 'claude'}.svg`} alt="" /> : agentName(a)}
                </button>
              ))}</span>
            ) : null}
            <button type="button" className="ac-btn pri ac-go" disabled={busy || offline || !can(mode) || (mode === 'feedback' && !text.trim())} onClick={start}>
              {busy ? <span className="ac-spin w" aria-hidden></span> : <i className={`ph-bold ${mode === 'repair' ? 'ph-wrench' : mode === 'feedback' ? 'ph-arrow-up' : 'ph-sparkle'}`}></i>}
              {busy ? 'Starting…' : mode === 'repair' ? 'Repair' : mode === 'feedback' ? 'Send' : 'Render'}
            </button>
          </div>
        </div>
        <p className="ac-compose-note">{mode === 'repair' && repairOff ? repairOff : notes[mode]}{hosted ? ' It runs on your computer.' : ''} <kbd>⌘</kbd><kbd>↵</kbd></p>
      </div>
    </>
  );
}

/** Earlier runs on one post, for the details pane. */
export function RunHistory({ runs, active, setActive, clockAt }: { runs: Run[]; active: string | null; setActive: (id: string | null) => void; clockAt?: number }) {
  if (!runs.length) return null;
  return (
    <ul className="ac-hist">
      {runs.slice(0, 6).map((r) => (
        <li key={r.id}>
          <button type="button" className={r.id === active ? 'on' : undefined} aria-pressed={r.id === active} onClick={() => setActive(r.id === active ? null : r.id)}>
            <i className={`ph ${r.action === 'repair' ? 'ph-wrench' : r.action === 'feedback' ? 'ph-chat-circle-text' : 'ph-sparkle'}`} aria-hidden></i>
            <span>{LABEL[(r.action as Mode) || 'example']}{r.replaced ? ' · replaced' : ''}</span>
            <small className={`s-${r.status}`}>{r.status === 'cancelled' ? 'stopped' : r.status}</small>
            <small className="num">{since(r.createdAt, clockAt)}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}
