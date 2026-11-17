import { NextResponse } from 'next/server';
import { loadConfig } from '@/server/config';
import { accountOf } from '@/server/account';
import { hostedDb } from '@/server/db';
import { getReview, setReview, REVIEW_STATES } from '@/server/review';
import type { ReviewState } from '@/server/types';

export const dynamic = 'force-dynamic';

/* THE REVIEW GATE, over HTTP. The page records a decision; the posting job reads it back through
 * the MCP server's check_post right before it sends. A browser proves itself with its session, a
 * machine with its bearer token, the same as /api/sync.
 *
 *   GET  /api/review?day=YYYY-MM-DD&id=<id>                    one post's decision, or pending
 *   POST /api/review { day, id | ids: [...], state, note? }    record it; state null clears it */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function who(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  /* A disk-only install has no account and still reviews, into its data folder. */
  return { cfg, account, allowed: !!account || !hostedDb() };
}

export async function GET(req: Request) {
  const { cfg, account, allowed } = await who(req);
  if (!allowed) return NextResponse.json({ error: 'No account.' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const day = q.get('day') || ''; const id = q.get('id') || '';
  if (!DAY.test(day) || !id) return NextResponse.json({ error: 'Pass ?day=YYYY-MM-DD&id=<post id>.' }, { status: 400 });
  const review = await getReview(cfg, account, day, id);
  return NextResponse.json({ day, id, review: review || null, decision: review?.state || 'pending' });
}

export async function POST(req: Request) {
  const { cfg, account, allowed } = await who(req);
  if (!allowed) return NextResponse.json({ error: 'No account.' }, { status: 401 });
  const b = await req.json().catch(() => null) as { day?: string; id?: string; ids?: string[]; state?: ReviewState | null; note?: string } | null;
  if (!b || !DAY.test(b.day || '')) return NextResponse.json({ error: 'Send { day, id, state }.' }, { status: 400 });
  const state = b.state ?? null;
  if (state !== null && !REVIEW_STATES.includes(state)) return NextResponse.json({ error: `state must be ${REVIEW_STATES.join(', ')} or null.` }, { status: 400 });
  if (state === 'changes' && !b.note?.trim()) return NextResponse.json({ error: 'Say what should change.' }, { status: 400 });
  const ids = (Array.isArray(b.ids) ? b.ids : b.id ? [b.id] : []).filter((x) => typeof x === 'string' && x).slice(0, 200);
  if (!ids.length) return NextResponse.json({ error: 'Which post? Send id or ids.' }, { status: 400 });
  const out: Record<string, unknown> = {};
  for (const id of ids) out[id] = await setReview(cfg, account, b.day!, id, state, b.note?.trim(), account || undefined);
  return NextResponse.json({ day: b.day, reviews: out });
}
