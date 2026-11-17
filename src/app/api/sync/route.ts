import { NextResponse } from 'next/server';
import { loadConfig, today } from '@/server/config';
import { accountOf, store } from '@/server/account';
import { dayOf, manifestProblems, type Manifest } from '@/server/manifest';
import { keepReview } from '@/server/review';

export const dynamic = 'force-dynamic';

/* SYNC. The one endpoint a machine pushes manifests to, authenticated with a token the web UI
 * issued. It takes JSON and only JSON: there is no upload here and there never will be, because
 * media stays where its owner put it and the browser fetches it from there.
 *
 *   GET  /api/sync?day=YYYY-MM-DD        what the account holds for a day
 *   POST /api/sync { manifests: [...] }  push manifests; each is validated before it is stored */

type Incoming = { id?: string; day?: string; origin?: string; manifest?: Manifest };

export async function GET(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  if (!account) return NextResponse.json({ error: 'No account. Send a bearer token.' }, { status: 401 });
  const day = new URL(req.url).searchParams.get('day') || today(cfg.timezone);
  return NextResponse.json({ account, day, manifests: await store(cfg).list(account, day) });
}

export async function POST(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  if (!account) return NextResponse.json({ error: 'No account. Send a bearer token.' }, { status: 401 });

  const body = await req.json().catch(() => null) as { manifests?: Incoming[] } | null;
  const rows = body?.manifests;
  if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: 'Send { manifests: [...] }.' }, { status: 400 });

  const s = store(cfg);
  const saved: string[] = [];
  const rejected: { id?: string; problems: string[] }[] = [];
  for (const row of rows.slice(0, 500)) {
    const problems = manifestProblems(row?.manifest);
    if (problems.length || !row.manifest) { rejected.push({ id: row?.id, problems }); continue; }
    const day = row.day || dayOf(row.manifest.at, cfg.timezone);
    const id = row.id || `${day}-${saved.length}`;
    /* A decision made on the page belongs to the account; a re-push from the machine keeps it. */
    const stored = await s.get(account, day, id);
    const manifest = keepReview(row.manifest, stored?.manifest);
    const rec = await s.put(account, { id, day, manifest, origin: row.origin, updatedAt: '' });
    saved.push(`${rec.day}/${rec.id}`);
  }
  /* A bad manifest is reported, not swallowed: the job that wrote it is the thing to fix. */
  return NextResponse.json({ saved: saved.length, ids: saved, rejected }, { status: rejected.length && !saved.length ? 400 : 200 });
}
