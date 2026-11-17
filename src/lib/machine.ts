'use client';

import { useEffect, useState } from 'react';
import type { Lane, Product } from '@/server/types';
import { machineBase } from './ui';

/* THE MACHINE. On aircheck.dev, anything that needs the user's own computer (a preview, Fix, a
 * revision, Replace, Undo, and the images themselves) goes to the Aircheck MCP server running on
 * that computer, on 127.0.0.1. Locally the app is already on that computer, and these are its own
 * /api routes. */

export const OFFLINE = 'Aircheck runs on your computer. Open a Claude Code or Codex session there to start the Aircheck server, then try again.';

/** fetch, against this machine. A machine that does not answer becomes a 503 with a plain reason,
 *  so every caller's `.then(x => x.json())` shows a sentence instead of "Failed to fetch". */
export async function machineFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${machineBase()}${path}`, init);
  } catch {
    return new Response(JSON.stringify({ error: OFFLINE, offline: true }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
}

export type Machine = { lanes: Lane[]; products: Product[]; agents: string[]; defaultAgent: string };
let studio: Promise<Machine | null> | null = null;

/** What this machine can run, asked once per page. null while asking, or when hosted and the
 *  machine does not answer; locally the page's own props already have it. */
export function useMachine(): { machine: Machine | null; hosted: boolean; checked: boolean } {
  const hosted = !!machineBase();
  const [state, setState] = useState<{ machine: Machine | null; checked: boolean }>({ machine: null, checked: !hosted });
  useEffect(() => {
    if (!hosted) return;
    studio ||= machineFetch('/api/studio', { cache: 'no-store' }).then((r) => (r.ok ? r.json() as Promise<Machine> : null)).catch(() => null);
    let live = true;
    studio.then((m) => { if (live) setState({ machine: m, checked: true }); if (!m) studio = null; });
    return () => { live = false; };
  }, [hosted]);
  return { ...state, hosted };
}
