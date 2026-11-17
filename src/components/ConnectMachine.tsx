'use client';

import { useCallback, useEffect, useState } from 'react';

/* CONNECT YOUR MACHINE. The hosted account is empty until a machine runs the MCP server with a
 * token for it. Two steps: add Aircheck to the agent you use (the token is made for you and is
 * already in the command), then ask that agent to finish setup. Underneath, a checklist reads four
 * real signals and ticks each one as it happens: the token checked in, the server answers on this
 * machine, its config exists, and a post reached the account. A test post makes the last one
 * happen on demand.
 *
 * It opens by itself for a signed-in account with no machine yet (once per browser session, so
 * "Finish later" is not "never"), and from anywhere that dispatches `aircheck:connect`. Signed out,
 * /api/setup answers 401 and it renders nothing. */

const OPEN = 'aircheck:connect';
const LATER = 'aircheck.connect.later';
const ISSUED = 'aircheck.connect.issued';

export const openConnect = () => window.dispatchEvent(new Event(OPEN));

type Tok = { label?: string; createdAt: string; lastUsedAt?: string };
type Setup = { tokens: Tok[]; posts: number };
type Health = { ok: boolean; config?: boolean };
type Client = 'claude' | 'codex' | 'cursor' | 'vscode' | 'desktop' | 'json';

const CONFIG = '~/.aircheck/aircheck.config.json';
const CLIENTS: { id: Client; label: string; img?: string; icon?: string }[] = [
  { id: 'claude', label: 'Claude Code', img: '/claude.svg' },
  { id: 'codex', label: 'Codex', img: '/openai.svg' },
  { id: 'cursor', label: 'Cursor', icon: 'ph-cursor' },
  { id: 'desktop', label: 'Claude Desktop', img: '/claude.svg' },
  { id: 'vscode', label: 'VS Code', icon: 'ph-code' },
  { id: 'json', label: 'Other (JSON)', icon: 'ph-brackets-curly' },
];

const entry = (token: string) => ({ command: 'npx', args: ['-y', 'aircheck-mcp@latest'], env: { AIRCHECK_TOKEN: token, AIRCHECK_CONFIG: CONFIG } });
const json = (token: string) => JSON.stringify({ mcpServers: { aircheck: entry(token) } }, null, 2);

function install(client: Client, token: string): { text: string; link?: { href: string; label: string }; note?: string } {
  switch (client) {
    case 'claude': return { text: `claude mcp add aircheck -s user -e AIRCHECK_TOKEN=${token} -e AIRCHECK_CONFIG=${CONFIG} -- npx -y aircheck-mcp@latest` };
    case 'codex': return { text: `codex mcp add aircheck --env AIRCHECK_TOKEN=${token} --env AIRCHECK_CONFIG=${CONFIG} -- npx -y aircheck-mcp@latest` };
    case 'cursor': return {
      text: json(token),
      link: { href: `cursor://anysphere.cursor-deeplink/mcp/install?name=aircheck&config=${encodeURIComponent(btoa(JSON.stringify(entry(token))))}`, label: 'Add to Cursor' },
      note: 'Or paste this into ~/.cursor/mcp.json.',
    };
    case 'vscode': return {
      text: json(token),
      link: { href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'aircheck', ...entry(token) }))}`, label: 'Add to VS Code' },
      note: 'Or add it under "servers" in your VS Code mcp.json.',
    };
    case 'desktop': return { text: json(token), note: 'Paste into claude_desktop_config.json (Settings, Developer, Edit Config), then restart Claude Desktop.' };
    default: return { text: json(token), note: 'Any MCP client takes this entry.' };
  }
}

const PROMPT = 'Set up Aircheck on this machine. Call the aircheck `configure` tool, show me the proposed config and the change each posting job needs, and apply only what I approve. From then on, queue every post you make with `queue_post`, and call `check_post` right before you send one.';

/* What to call this machine: the browser knows the platform, not the name. */
function machineName() {
  const p = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '').toLowerCase();
  return p.includes('mac') ? 'this Mac' : p.includes('win') ? 'this PC' : p.includes('linux') ? 'this Linux machine' : 'this machine';
}
const hhmm = (iso: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export function ConnectMachine({ bridge }: { bridge: string }) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<{ token: string; label: string; createdAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<Client>('claude');
  const [copied, setCopied] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [testing, setTesting] = useState<'' | 'sending' | 'sent' | string>('');

  const readSetup = useCallback(async (): Promise<Setup | null> => {
    const r = await fetch('/api/setup', { cache: 'no-store' }).catch(() => null);
    if (!r || !r.ok) return null;
    return r.json().catch(() => null);
  }, []);

  const issue = useCallback(async () => {
    setBusy(true);
    const label = machineName();
    const r = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) })
      .then((x) => x.json()).catch(() => null) as { token?: string; record?: { createdAt: string } } | null;
    setBusy(false);
    if (!r?.token) return;
    const next = { token: r.token, label, createdAt: r.record?.createdAt || new Date().toISOString() };
    setIssued(next);
    /* Kept for this tab only, so reopening the dialog shows the same command and checklist. */
    try { sessionStorage.setItem(ISSUED, JSON.stringify(next)); } catch { /* blocked */ }
    window.dispatchEvent(new Event('aircheck:tokens'));
  }, []);

  /* First visit: an account with no machine opens straight into this. */
  useEffect(() => {
    let later = false;
    try { later = sessionStorage.getItem(LATER) === '1'; } catch { /* blocked */ }
    const t = setTimeout(async () => {
      try { const s = sessionStorage.getItem(ISSUED); if (s) setIssued(JSON.parse(s)); } catch { /* blocked */ }
      if (later) return;
      const s = await readSetup();
      if (s && s.tokens.length === 0) setOpen(true);
    }, 0);
    const show = () => setOpen(true);
    window.addEventListener(OPEN, show);
    return () => { clearTimeout(t); window.removeEventListener(OPEN, show); };
  }, [readSetup]);

  /* The token is made for you the first time the dialog opens in this tab. */
  useEffect(() => {
    if (!open || issued || busy) return;
    const t = setTimeout(issue, 0);
    return () => clearTimeout(t);
  }, [open, issued, busy, issue]);

  /* The four signals, polled while the dialog is open. */
  useEffect(() => {
    if (!open) return;
    let live = true;
    const tick = async () => {
      const h = await fetch(`${bridge}/health`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Health | null;
      const s = await readSetup();
      if (!live) return;
      setHealth(h);
      if (s) setSetup(s);
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => { live = false; clearInterval(id); };
  }, [open, bridge, readSetup]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });

  function close() {
    try { sessionStorage.setItem(LATER, '1'); } catch { /* blocked */ }
    setOpen(false);
  }

  const copy = (what: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1600); });
  };

  async function testPost() {
    setTesting('sending');
    const r = await fetch(`${bridge}/api/test-post`, { method: 'POST' }).then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string } | null;
    setTesting(r?.ok ? 'sent' : r?.error || 'The test post did not go out.');
  }

  if (!open) return null;

  const mine = setup?.tokens.find((t) => issued && t.createdAt === issued.createdAt);
  const anyUsed = setup?.tokens.filter((t) => t.lastUsedAt).sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))[0];
  const used = mine?.lastUsedAt ? mine : anyUsed;
  const steps = [
    { ok: !!used, on: <><b>Token used</b> · {used?.label || 'your machine'} checked in at {used?.lastUsedAt ? hhmm(used.lastUsedAt) : ''}</>, off: 'Waiting for your agent to start the Aircheck server', tag: 'step 1' },
    { ok: !!health?.ok, on: <><b>Server running</b> · images can load from this computer</>, off: 'Server not answering on this computer yet', tag: 'bridge' },
    { ok: !!health?.config, on: <><b>Config written</b> · your agent found your posting jobs</>, off: 'Waiting for your agent to write the config', tag: 'step 2' },
    { ok: (setup?.posts || 0) > 0, on: <><b>First post arrived</b> · it is on Today</>, off: 'First post arrives', tag: 'test' },
  ];
  const firstOpen = steps.findIndex((s) => !s.ok);
  const done = firstOpen === -1;
  const inst = issued ? install(client, issued.token) : null;

  const machineIcon = machineName() === 'this PC' ? 'ph-desktop-tower' : machineName() === 'this Mac' ? 'ph-laptop' : 'ph-desktop';
  const stepNow = !steps[0].ok ? 1 : !steps[2].ok ? 2 : 3;
  return (
    <div className="ob" role="dialog" aria-modal="true" aria-labelledby="cm-t">
      <div className="ob-l">
        <div className="ob-prog" aria-label={`Step ${stepNow} of 3`}>
          {[1, 2, 3].map((n) => <i key={n} className={n < stepNow || done ? 'ok' : n === stepNow ? 'on' : undefined}></i>)}
          <span>Step {done ? 3 : stepNow} of 3</span>
        </div>
        <div><h1 id="cm-t">Connect your machine.</h1><p className="ob-sub">Two minutes. Your images stay on this computer. aircheck.dev only keeps the JSON.</p></div>

        <section className="ob-step">
          <h2><span className={`n${steps[0].ok ? ' ok' : ''}`}>{steps[0].ok ? <i className="ph-bold ph-check"></i> : 1}</span>Add Aircheck to the agent you use</h2>
          <div className="ob-tabs" role="tablist" aria-label="Your agent">
            {CLIENTS.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={client === c.id} className={client === c.id ? 'on' : ''} onClick={() => setClient(c.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.img ? <img src={c.img} alt="" /> : <i className={`ph ${c.icon}`}></i>}{c.label}
              </button>
            ))}
          </div>
          {inst ? (
            <>
              {inst.link ? <a className="ac-btn pri" href={inst.link.href} style={{ alignSelf: 'flex-start' }}><i className="ph ph-download-simple"></i>{inst.link.label}</a> : null}
              <div className="ob-cmd">
                <code>{inst.text}</code>
                <button className="ac-ib" type="button" aria-label={copied === 'cmd' ? 'Copied' : 'Copy the command'} onClick={() => copy('cmd', inst.text)}><i className={`ph ${copied === 'cmd' ? 'ph-check' : 'ph-copy'}`}></i></button>
              </div>
              <p className="ob-warn"><i className="ph ph-lock-simple"></i>Copy this now. It is not shown again.</p>
              {inst.note ? <p className="ob-note">{inst.note}</p> : null}
              <p className="ob-note"><i className="ph ph-key"></i>Token named <b>{issued!.label}</b>, made for you. Lost it? <button type="button" onClick={issue} disabled={busy}>{busy ? 'Making…' : 'Make a new one'}</button></p>
            </>
          ) : <p className="ob-note"><span className="ac-spin"></span>Making your token…</p>}
        </section>

        <section className="ob-step">
          <h2><span className={`n${steps[2].ok ? ' ok' : ''}`}>{steps[2].ok ? <i className="ph-bold ph-check"></i> : 2}</span>Open a new session and paste this</h2>
          <div className="ob-cmd">
            <p>{PROMPT}</p>
            <button className="ac-ib" type="button" aria-label={copied === 'prompt' ? 'Copied' : 'Copy the prompt'} onClick={() => copy('prompt', PROMPT)}><i className={`ph ${copied === 'prompt' ? 'ph-check' : 'ph-copy'}`}></i></button>
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <button className={`ac-btn${done ? ' pri' : ''}`} type="button" onClick={close}>{done ? 'Done' : 'Finish later'}</button>
        </div>
      </div>

      <div className="ob-r">
        <button className="ac-ib ob-x" type="button" aria-label="Close" onClick={close}><i className="ph ph-x"></i></button>
        <div className="ob-card">
          <div className="ob-link" aria-hidden>
            <span className="ob-node"><i className={`ph ${machineIcon}`}></i></span>
            <span className={`ob-wire${health?.ok ? ' ok' : ''}`}></span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="ob-node"><img src="/aircheck-mark.svg" alt="" /></span>
          </div>
          <h2>{done ? 'Your first post arrived' : 'Waiting for the first post'}</h2>
          <p>{done ? 'It is on Today, with its media loading from this computer.' : 'Queue a post from any lane. It appears on Today when it arrives.'}</p>
          <ul className="ob-chk" aria-live="polite">
            {steps.map((st, n) => (
              <li key={n} className={st.ok ? 'ok' : n === firstOpen ? 'wait' : 'todo'}>
                <span>{st.ok ? <i className="ph-bold ph-check"></i> : n === firstOpen ? <span className="ac-spin"></span> : <i className="ph ph-circle"></i>}</span>
                <span>{st.ok ? st.on : st.off}</span>
                {n === 3 && !st.ok
                  ? <button className="ac-btn" type="button" disabled={!health?.ok || testing === 'sending'} title={health?.ok ? undefined : 'Needs the server running'} onClick={testPost}>
                      <i className="ph ph-paper-plane-tilt"></i>{testing === 'sending' ? 'Sending…' : testing === 'sent' ? 'Sent' : 'Send a test post'}
                    </button>
                  : null}
              </li>
            ))}
          </ul>
          {testing && testing !== 'sending' && testing !== 'sent' ? <p className="ac-err" style={{ color: '#ff9aa1' }}>{testing}</p> : null}
          <div className="ob-acts">
            <a className="ac-btn" href="/docs#manifest"><i className="ph ph-book-open"></i>How to queue a post</a>
            {done ? <a className="ac-btn pri" href="/">Open Today</a> : null}
          </div>
          {done ? null : <button type="button" className="ob-skip" onClick={close}>Skip and go to Today</button>}
        </div>
        {!health?.ok ? <div className="ob-toast" role="status"><i className="ph ph-browsers"></i>Chrome may ask to reach your local network. Choose Allow.</div> : null}
      </div>
    </div>
  );
}
