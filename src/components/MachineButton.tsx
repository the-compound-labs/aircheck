'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { openConnect } from './ConnectMachine';
import { machineBase } from '@/lib/ui';

/* THE COMPUTER'S STATE, UNDER THE LOGO. On aircheck.dev every image, preview and Fix comes from
 * the user's own computer. MachineStatus polls the bridge and announces each answer on the
 * `aircheck:machine` window event; this only listens.
 *   - never connected: the plush Connect button that opens the connect steps.
 *   - connected: the same slot goes quiet and says so.
 *   - connected before, not answering now: a card naming the machine and when it was last seen,
 *     with the one fix (keep the server running after the session closes), and a dark toast that
 *     explains the page once instead of a warning on every tile.
 * Locally (no bridge) it renders nothing. */

export const MACHINE_EVENT = 'aircheck:machine';
type W = Window & { __aircheckMachine?: boolean };
type Tok = { label?: string; lastUsedAt?: string };

const subscribe = (cb: () => void) => { window.addEventListener(MACHINE_EVENT, cb); return () => window.removeEventListener(MACHINE_EVENT, cb); };
const read = (): boolean | null => (machineBase() ? ((window as W).__aircheckMachine ?? null) : null);

const KEEP = 'Call the aircheck `keep_running` tool, so Aircheck keeps serving my images after this session closes.';
const HIDE = 'aircheck.offline.toast';

function since(iso?: string) {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function MachineButton() {
  const up = useSyncExternalStore(subscribe, read, () => null);
  const [last, setLast] = useState<Tok | null>(null);
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(false);

  /* Which machine this account last heard from, read once the computer is found missing. */
  useEffect(() => {
    if (up !== false) return;
    let live = true;
    fetch('/api/setup', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((s: { tokens?: Tok[] } | null) => {
      if (!live || !s?.tokens) return;
      const seen = s.tokens.filter((t) => t.lastUsedAt).sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))[0];
      setLast(seen || null);
    }).catch(() => {});
    setTimeout(() => { try { if (live) setHidden(sessionStorage.getItem(HIDE) === '1'); } catch { /* blocked */ } }, 0);
    return () => { live = false; };
  }, [up]);

  if (up === null) return null;
  if (up) {
    return (
      <div className="ac-machine live" role="status" title="Your computer is connected">
        <span className="ac-machine-i"><i className="ph ph-plugs-connected"></i></span>
        <span className="ac-machine-t"><b>Connected</b><small>Images and fixes come from your computer</small></span>
        <i className="ph-bold ph-check"></i>
      </div>
    );
  }
  if (!last) {
    return (
      <button type="button" className="ac-machine off" onClick={openConnect} title="Connect your computer">
        <span className="ac-machine-i"><i className="ph ph-plugs"></i></span>
        <span className="ac-machine-t"><b>Connect your computer</b><small>Aircheck runs fixes there</small></span>
        <i className="ph ph-arrow-right"></i>
      </button>
    );
  }
  const name = last.label || 'your computer';
  const keep = () => navigator.clipboard?.writeText(KEEP).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2400); });
  return (
    <>
      <div className="ac-machine sleep" role="status">
        <span className="ac-machine-h"><span className="d" aria-hidden></span><b>{name} is offline</b></span>
        <small>Last seen {since(last.lastUsedAt)}. Posts still sync. Images and fixes wait for it.</small>
        <button className="ac-btn pri" type="button" onClick={keep} title="Copies a line to paste into Claude Code or Codex on that computer">
          <i className={`ph ${copied ? 'ph-check' : 'ph-power'}`}></i>{copied ? 'Copied. Paste it there' : 'Keep it running'}
        </button>
        <button type="button" className="ac-link" onClick={openConnect}>Connect another machine</button>
      </div>
      {hidden ? null : (
        <div className="ac-toast" role="status">
          <i className="ph ph-moon"></i>
          <span>Images are on {name}, which is asleep. Text, times and checks below are current.</span>
          <button className="ac-btn" type="button" onClick={openConnect}>How to wake it</button>
          <button className="ac-ib" type="button" aria-label="Dismiss" onClick={() => { setHidden(true); try { sessionStorage.setItem(HIDE, '1'); } catch { /* blocked */ } }}><i className="ph ph-x"></i></button>
        </div>
      )}
    </>
  );
}
