'use client';

import { useCallback, useEffect, useState } from 'react';
import { openConnect } from './ConnectMachine';
import { AdsChoice, ADS_NOTE } from './AdsMeasurement';

type Row = { account: string; label?: string; createdAt: string; lastUsedAt?: string };

/* THE ACCOUNT PAGE. Two things live here: who you are, and the tokens a machine uses to sync
 * manifests to you. A token is shown once, at issue, and never again — so the panel keeps it on
 * screen until it is dismissed, inside the config block it actually belongs in. */
export function AccountView({ email, children }: { email: string; children?: React.ReactNode }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [fresh, setFresh] = useState<string>('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/tokens', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    if (r?.tokens) setRows(r.tokens);
  }, []);
  /* Deferred by a tick, the way Actions does it: a setState straight out of an effect body
   * cascades a render. */
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);
  /* The connect modal issues tokens too; it says so when it closes. */
  useEffect(() => { window.addEventListener('aircheck:tokens', load); return () => window.removeEventListener('aircheck:tokens', load); }, [load]);

  async function issue() {
    setBusy(true);
    const r = await fetch('/api/tokens', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: label || 'this machine' }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.token) { setFresh(r.token); setLabel(''); load(); }
  }

  async function revoke(createdAt: string) {
    /* The list never carries hashes, so a row is revoked by asking the server for the one it
     * issued at that moment. */
    await fetch(`/api/tokens?createdAt=${encodeURIComponent(createdAt)}`, { method: 'DELETE' });
    load();
  }

  async function signOut() {
    await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    /* A full load, not router.push: the worker serves the landing at "/" only to a real request. */
    window.location.assign('/');
  }

  /* Deleting asks twice: the first press only opens the question. */
  const [ask, setAsk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  async function deleteAccount() {
    setDeleting(true); setDeleteError(false);
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', confirm: true }) })
      .then((x) => x.json()).catch(() => null);
    if (r?.deleted) { window.location.assign('/'); return; }
    setDeleting(false); setDeleteError(true);
  }

  const block = `{
  "mcpServers": {
    "aircheck": {
      "command": "npx",
      "args": ["-y", "aircheck-mcp"],
      "env": {
        "AIRCHECK_TOKEN": "${fresh || '<your token>'}"
      }
    }
  }
}`;

  const copy = (what: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1600); });
  };

  /* SETTINGS ROWS (review 2026-11-16, items 12 and 44, after the dashboards settings reference):
   * the label and its one line on the left, the control on the right, on the page grid. On a phone
   * each row stacks, and a lane logo's input and Save sit under the lane's name. */
  return (
    <div className="ac-set">
      <section className="ac-set-s" aria-labelledby="set-acct">
        <div className="ac-set-l"><h2 id="set-acct">Account</h2><p>Your account holds one small JSON file per queued post. It never holds your media: your images and video stay on your machine, or in storage you own, and your browser loads them from there.</p></div>
        <div className="ac-set-c">
          <div className="ac-set-row"><span className="ac-set-k">Email</span><span className="ac-set-v">{email}</span></div>
          <div className="ac-set-row"><span className="ac-set-k">Session</span><button className="ac-btn" type="button" onClick={signOut}><i className="ph ph-sign-out"></i>Sign out</button></div>
        </div>
      </section>

      <section className="ac-set-s" aria-labelledby="set-mach">
        <div className="ac-set-l"><h2 id="set-mach">Machines</h2><p>A token lets the MCP server on a machine sync its manifests to this account.</p></div>
        <div className="ac-set-c">
          <div className="ac-set-issue">
            <input value={label} aria-label="Machine name" placeholder="What is this machine? (laptop, studio mac…)" onChange={(e) => setLabel(e.target.value)} />
            <button className="ac-btn pri" type="button" onClick={issue} disabled={busy}><i className="ph-bold ph-key"></i>{busy ? 'Issuing…' : 'Issue a token'}</button>
            <button className="ac-btn" type="button" onClick={openConnect}><i className="ph ph-plugs"></i>Connect a machine</button>
          </div>
          {fresh ? (
            <div className="ac-set-fresh" role="status">
              <b><i className="ph-fill ph-warning-circle"></i>Copy this now. It is not shown again.</b>
              <pre>{block}</pre>
              <div className="ac-set-acts">
                <button className="ac-btn" type="button" onClick={() => copy('block', block)}><i className="ph ph-copy"></i>{copied === 'block' ? 'Copied' : 'Copy the config'}</button>
                <button className="ac-btn" type="button" onClick={() => copy('token', fresh)}><i className="ph ph-key"></i>{copied === 'token' ? 'Copied' : 'Copy just the token'}</button>
                <button className="ac-btn" type="button" onClick={() => setFresh('')}>Done</button>
              </div>
              <p className="ac-set-fine">Paste it into <code>~/.claude.json</code> under <code>mcpServers</code>, or the same three keys in <code>~/.codex/config.toml</code>.</p>
            </div>
          ) : null}
          {rows.length ? (
            <table className="ac-table ac-set-t">
              <thead><tr><th>Machine</th><th>Issued</th><th>Last used</th><th><span className="sr">Revoke</span></th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.createdAt}>
                    <td><span className="ac-set-m"><i className="ph ph-desktop"></i>{t.label || 'unnamed'}</span></td>
                    <td className="mono">{t.createdAt.slice(0, 10)}</td>
                    <td className="mono">{t.lastUsedAt ? t.lastUsedAt.slice(0, 10) : 'never'}</td>
                    <td><button className="ac-link" type="button" onClick={() => revoke(t.createdAt)}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="ac-set-fine">No machines connected yet.</p>}
        </div>
      </section>

      {children}

      <section className="ac-set-s" aria-labelledby="set-ads">
        <div className="ac-set-l"><h2 id="set-ads">Ad measurement</h2><p>{ADS_NOTE}</p></div>
        <div className="ac-set-c"><AdsChoice /></div>
      </section>

      <section className="ac-set-s danger" data-account-delete aria-labelledby="set-del">
        <div className="ac-set-l"><h2 id="set-del">Delete account</h2><p>Deleting your account removes your sign-in, your connected machine tokens and every queued post file Aircheck stores for you. Your media and the files on your machine are not touched. This cannot be undone.</p></div>
        <div className="ac-set-c">
          {ask ? (
            <div className="ac-set-confirm">
              <p role="alert">Delete this account and everything Aircheck stores for it?</p>
              <div className="ac-set-acts">
                <button className="ac-btn danger" type="button" data-account-delete-confirm onClick={deleteAccount} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, delete my account'}</button>
                <button className="ac-btn" type="button" onClick={() => { setAsk(false); setDeleteError(false); }} disabled={deleting}>Keep my account</button>
              </div>
              {deleteError ? <p className="ac-set-fine" role="alert">The account was not deleted. Try again.</p> : null}
            </div>
          ) : <button className="ac-btn" type="button" data-account-delete-open onClick={() => setAsk(true)}><i className="ph ph-trash"></i>Delete account</button>}
        </div>
      </section>
    </div>
  );
}
