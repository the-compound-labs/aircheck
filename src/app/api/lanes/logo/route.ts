import { NextResponse } from 'next/server';
import { loadConfig } from '@/server/config';
import { accountOf } from '@/server/account';
import { setLogo } from '@/server/lane-logos';

export const dynamic = 'force-dynamic';

/* A lane's logo: POST { lane, logo } with a path on this machine or a URL, or an empty logo to go
 * back to the platform glyph. Only the reference is stored; the image stays where it is. */
export async function POST(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  if (!account) return NextResponse.json({ error: 'No account.' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { lane?: unknown; logo?: unknown };
  if (typeof body.lane !== 'string' || !body.lane.trim()) return NextResponse.json({ error: 'Which lane? Send { lane, logo }.' }, { status: 400 });
  const logo = typeof body.logo === 'string' ? body.logo.slice(0, 2000) : '';
  if (logo.trim() && !/^(https?:\/\/|\/)/i.test(logo.trim())) return NextResponse.json({ error: 'A logo is an absolute path on this machine or an https URL.' }, { status: 400 });
  await setLogo(cfg, account, body.lane.trim(), logo);
  return NextResponse.json({ lane: body.lane.trim(), logo: logo.trim() || null });
}
