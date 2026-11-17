'use client';

import { useState } from 'react';

/* THE HERO'S INSTALL ROW: one tab per MCP client over one command, with the client's own install
 * link where it has one. No token: a local install needs no account, and the server writes its
 * manifests to ~/.aircheck/queue. The connect dialog on /account adds the token for a hosted account. */
type Client = { id: string; label: string; img?: string; icon?: string; code: string; link?: { href: string; label: string } };

const ENTRY = { command: 'npx', args: ['-y', 'aircheck-mcp@latest'] };
const JSON_ENTRY = JSON.stringify({ mcpServers: { aircheck: ENTRY } });

const CLIENTS: Client[] = [
  { id: 'claude', label: 'Claude Code', img: '/claude.svg', code: 'claude mcp add aircheck -s user -- npx -y aircheck-mcp@latest' },
  { id: 'codex', label: 'Codex', img: '/openai.svg', code: 'codex mcp add aircheck -- npx -y aircheck-mcp@latest' },
  {
    id: 'cursor', label: 'Cursor', icon: 'ph-cursor', code: JSON_ENTRY,
    link: { href: `cursor://anysphere.cursor-deeplink/mcp/install?name=aircheck&config=${typeof btoa === 'function' ? encodeURIComponent(btoa(JSON.stringify(ENTRY))) : ''}`, label: 'Add to Cursor' },
  },
  { id: 'vscode', label: 'VS Code', icon: 'ph-code', code: JSON_ENTRY, link: { href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'aircheck', ...ENTRY }))}`, label: 'Add to VS Code' } },
  { id: 'desktop', label: 'Claude Desktop', img: '/claude.svg', code: JSON_ENTRY },
];

export function InstallMcp({ label, note }: { label: string; note: string }) {
  const [on, setOn] = useState(CLIENTS[0].id);
  const [copied, setCopied] = useState(false);
  const c = CLIENTS.find((x) => x.id === on) || CLIENTS[0];
  const copy = () => {
    navigator.clipboard?.writeText(c.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  };
  return (
    <div className="install" aria-label={label}>
      <p className="install-h">{label}</p>
      <div className="install-tabs" role="tablist" aria-label="MCP client">
        {CLIENTS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === on} className={x.id === on ? 'on' : undefined} onClick={() => { setOn(x.id); setCopied(false); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {x.img ? <img src={x.img} alt="" width={14} height={14} /> : <i className={`ph-bold ${x.icon}`} aria-hidden="true"></i>}{x.label}
          </button>
        ))}
      </div>
      <div className="install-cmd" role="tabpanel">
        <code><span className="pr" aria-hidden="true">{c.code.startsWith('{') ? '' : '$ '}</span>{c.code}</code>
        <button type="button" className="cp" onClick={copy} aria-label="Copy">{copied ? <i className="ph-bold ph-check" aria-hidden="true"></i> : <i className="ph ph-copy" aria-hidden="true"></i>}</button>
      </div>
      <p className="install-note">{c.link ? <a href={c.link.href}>{c.link.label}<i className="ph-bold ph-arrow-up-right" aria-hidden="true"></i></a> : null}<span>{note}</span></p>
    </div>
  );
}
