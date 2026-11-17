'use client';

import { useState, useSyncExternalStore } from 'react';

/* Phone only (2026-11-15): Aircheck runs on a computer, and about 95% of ad visitors are on a phone.
 * A toast at the bottom of /demo offers to email the setup guide. Never inside the landing's window,
 * and gone for the tab once closed. After a send it stays, showing the confirmation, until closed.
 * Copy written by Codex. */
const TITLE = "Aircheck runs on your computer.";
const PLACEHOLDER = "Your email";
const BUTTON = "Email me the setup link";
const CLOSE = "Close";
const INVALID = "Enter a valid email address.";
const ERROR = "We could not send the email. Try again.";
const SENT = "We sent the link. Open the email on your computer.";
const KEY = 'aircheck-setup-link';

const noop = () => () => {};
function phoneTab() {
  if (window.parent !== window || !window.matchMedia('(max-width: 760px)').matches) return false;
  try { return !sessionStorage.getItem(KEY); } catch { return true; }
}

export function SetupLinkToast() {
  const eligible = useSyncExternalStore(noop, phoneTab, () => false);
  const [closed, setClosed] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ busy?: boolean; sent?: boolean; msg?: string }>({});
  if (!eligible || closed) return null;
  const close = () => { setClosed(true); try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) { setState({ msg: INVALID }); return; }
    setState({ busy: true });
    try {
      const r = await fetch('/api/setup-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: v }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ERROR);
      setState({ sent: true, msg: d.message || SENT });
    } catch (err) {
      setState({ msg: (err as Error).message || ERROR });
    }
  };
  return (
    <div className="ac-toast ac-slt" role="dialog" aria-label={TITLE}>
      <div className="ac-slt-h">
        <b>{TITLE}</b>
        <button type="button" className="ac-ib" aria-label={CLOSE} onClick={close}><i className="ph ph-x"></i></button>
      </div>
      {state.sent ? null : (
        <form className="ac-slt-f" onSubmit={send} noValidate>
          <input type="email" name="email" autoComplete="email" inputMode="email" required placeholder={PLACEHOLDER} aria-label={PLACEHOLDER}
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="ac-btn pri" disabled={state.busy}>{BUTTON}</button>
        </form>
      )}
      {state.msg ? <p className="ac-slt-m" role="status" aria-live="polite">{state.msg}</p> : null}
    </div>
  );
}
