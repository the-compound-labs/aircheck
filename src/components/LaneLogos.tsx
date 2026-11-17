'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lane } from '@/server/types';
import { LaneTile } from './LaneTile';

/* LANE LOGOS. Each lane can wear its own logo instead of the platform glyph: an absolute path on
 * this machine (served by the media bridge) or an https URL. Only the reference is saved. */
export function LaneLogos({ lanes }: { lanes: Lane[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(lanes.map((l) => [l.id, l.logo || ''])));
  const [state, setState] = useState<Record<string, string>>({});

  async function save(lane: string, logo: string) {
    setState((s) => ({ ...s, [lane]: 'Saving…' }));
    const r = await fetch('/api/lanes/logo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lane, logo }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => ({})) })).catch(() => null);
    setState((s) => ({ ...s, [lane]: r?.ok ? 'Saved' : r?.body?.error || 'Could not save' }));
    if (r?.ok) router.refresh();
  }

  if (!lanes.length) return null;
  return (
    <section className="ac-set-s" aria-labelledby="set-logos">
      <div className="ac-set-l"><h2 id="set-logos">Lane logos</h2><p>Give a lane its own logo. Use an absolute path on this machine or an https URL. Leave it empty to show the platform icon.</p></div>
      <ul className="ac-set-c ac-logos">
        {lanes.map((l) => {
          const v = draft[l.id] ?? '';
          return (
            <li key={l.id}>
              <span className="ac-logos-n"><LaneTile l={{ platform: l.platform, logo: v.trim() || undefined }} size="md" /><b>{l.name}</b></span>
              <span className="ac-logos-f">
                <input value={v} aria-label={`Logo for ${l.name}`} placeholder="/Users/you/brand/logo.svg or https://…"
                  onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(l.id, v); }} />
                <button className="ac-btn" type="button" onClick={() => save(l.id, v)} disabled={(l.logo || '') === v.trim()}>Save</button>
              </span>
              {state[l.id] ? <small className="ac-set-fine">{state[l.id]}</small> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
