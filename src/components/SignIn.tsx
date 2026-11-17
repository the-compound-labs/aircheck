'use client';

import { useEffect, useRef, useState } from 'react';
import './signin.css';
import { capture } from './Analytics';

/* Signing in, as a dialog over whatever page asked for it. On a machine with no account yet this
 * makes the first one instead of asking for credentials that cannot exist. On aircheck.dev it also
 * sends a reset link and takes the new password from one; nothing is verified by mail. `onClose` makes it dismissable (over the landing);
 * without it the dialog stays, because there is nothing behind it to go back to. */
type Mode = 'login' | 'signup' | 'forgot' | 'reset';

export function SignIn({ empty, google = false, error = '', onClose, start, token = '', canReset = false }: {
  empty: boolean; google?: boolean; error?: string; onClose?: () => void;
  /** Open on a given screen: 'reset' when a reset link brought you here. */
  start?: Mode;
  /** The reset link's token. */
  token?: string;
  /** Offer "Forgot your password?" (aircheck.dev; a local install has no mail). */
  canReset?: boolean;
}) {
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const [mode, setMode] = useState<Mode>(start || (empty ? 'signup' : 'login'));
  /* Focus (review item 20): the first field takes focus when the dialog opens or changes screen,
   * Tab stays inside the dialog, and the page behind gets its scroll back on close. */
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const y = window.scrollY;
    const prev = document.activeElement as HTMLElement | null;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); window.scrollTo(0, y); prev?.focus?.({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => (box.current?.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true }), 30);
    return () => clearTimeout(t);
  }, [mode]);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error);
  /* Funnel: the dialog opened, which screen, and any error it arrived with (a failed Google return). */
  useEffect(() => { capture('signin_opened', { mode: start || (empty ? 'signup' : 'login'), error: error || undefined }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    if (mode === 'signup' || mode === 'login') capture('signin_submitted', { mode, method: 'password' });
    const r = await fetch('/api/auth', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: mode, email, password, token }),
    }).then((x) => x.json()).catch((x) => ({ error: String(x) }));
    setBusy(false);
    if (r.error) { capture('signin_failed', { mode, error: String(r.error).slice(0, 120) }); return setErr(r.error); }
    if (mode === 'forgot') { setSent(true); return; }
    /* A full load: on aircheck.dev "/" is the landing or Today depending on the session cookie,
     * which only the next request carries. A new account lands on Today, where the connect steps open. */
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/';
  }

  return (
    <div className="si-back" onMouseDown={(e) => { if (onClose && e.target === e.currentTarget) onClose(); }}>
      <form ref={box} className="si" role="dialog" aria-modal="true" aria-labelledby="si-t" onSubmit={submit}>
        {onClose ? <button className="si-x" type="button" aria-label="Close" onClick={onClose}><i className="ph ph-x"></i></button> : null}
        <h1 id="si-t">{mode === 'signup' ? 'Make your account' : mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Sign in'}</h1>
        <p className="sub">
          {mode === 'signup'
            ? 'Your account holds the manifests that describe your posts. It never holds your media.'
            : mode === 'forgot' ? "Enter the email on your account and we'll send a link to choose a new password."
            : mode === 'reset' ? "Use at least 8 characters. You'll be signed in when it's saved."
            : 'Your queue follows your account.'}
        </p>
        {mode === 'forgot' || mode === 'reset' ? (
          <>
            {mode === 'forgot' && sent ? <p className="sent"><i className="ph ph-envelope-simple"></i>If an account uses that address, we sent a link. The link works once for one hour.</p> : (
              <>
                {mode === 'forgot'
                  ? <label>Email<input type="email" value={email} autoComplete="username" required onChange={(e) => setEmail(e.target.value)} /></label>
                  : <label>New password<input type="password" value={password} required minLength={8} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} /></label>}
                {err ? <p className="err">{err}</p> : null}
                <button className="si-btn si-pri" type="submit" disabled={busy}>{busy ? 'One moment…' : mode === 'forgot' ? 'Send the link' : 'Save and sign in'}</button>
              </>
            )}
            <button type="button" className="alt" onClick={() => { setErr(''); setSent(false); setMode('login'); }}>Back to sign in</button>
          </>
        ) : <>
        {google ? (
          <>
            <a className="si-btn si-google" href="/api/auth/google" onClick={() => capture('signin_submitted', { mode, method: 'google' })}><i className="ph ph-google-logo"></i>Continue with Google</a>
            <div className="or"><span>or</span></div>
          </>
        ) : null}
        <label>Email
          <input type="email" value={email} autoComplete="username" required onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" value={password} required minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err ? <p className="err">{err}</p> : null}
        <button className="si-btn si-pri" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Make the account' : 'Sign in'}
        </button>
        {!empty ? (
          <div className="alts">
            <button type="button" className="alt" onClick={() => { setErr(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>
              {mode === 'login' ? 'Make an account instead' : 'I already have an account'}
            </button>
            {canReset && mode === 'login' ? <button type="button" className="alt" onClick={() => { setErr(''); setMode('forgot'); }}>Forgot your password?</button> : null}
          </div>
        ) : null}
        <p className="fine">{canReset ? 'Aircheck emails you only to welcome you and to reset your password.' : 'Aircheck never emails you. There is no verification link to wait for.'}</p>
        </>}
      </form>
    </div>
  );
}
