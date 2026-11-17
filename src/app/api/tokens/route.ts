import { NextResponse } from 'next/server';
import { loadConfig } from '@/server/config';
import { accountOf, tokens } from '@/server/account';

export const dynamic = 'force-dynamic';

/* The tokens a machine uses to sync manifests to an account. The plain value is returned exactly
 * once, at issue; only its hash is kept, so a leak of the store is not a leak of anyone's token. */

export async function GET(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  if (!account) return NextResponse.json({ error: 'No account.' }, { status: 401 });
  return NextResponse.json({ account, tokens: await tokens(cfg).list(account) });
}

export async function POST(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  if (!account) return NextResponse.json({ error: 'No account.' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { label?: string };
  const { token, record } = await tokens(cfg).issue(account, typeof body.label === 'string' ? body.label.slice(0, 80) : undefined);
  const { hash: _h, ...shown } = record;
  return NextResponse.json({ token, record: shown, note: 'Copy this now. It is not shown again.' }, { status: 201 });
}

export async function DELETE(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  if (!account) return NextResponse.json({ error: 'No account.' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const hash = q.get('hash');
  if (hash) { await tokens(cfg).revoke(hash); return NextResponse.json({ revoked: hash }); }
  /* The listing never carries hashes, so the page revokes by the moment a token was issued. */
  const createdAt = q.get('createdAt');
  if (!createdAt) return NextResponse.json({ error: 'Which token? Pass ?createdAt= or ?hash=.' }, { status: 400 });
  const n = await tokens(cfg).revokeBy(account, createdAt);
  return NextResponse.json({ revoked: n });
}
