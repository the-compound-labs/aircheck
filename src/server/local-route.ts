import { NextResponse } from 'next/server';
import { localApi } from './local-api';

/* The local app's /api/runs and /api/studio are src/server/local-api.ts as it stands; on
 * aircheck.dev the same calls go to this machine's bridge instead. */
export async function handle(req: Request) {
  const url = new URL(req.url);
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await req.json().catch(() => ({})) : {};
  const r = await localApi(req.method, url.pathname, url.searchParams, body);
  return NextResponse.json(r.body, { status: r.status });
}
