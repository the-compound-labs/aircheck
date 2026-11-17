import { NextResponse } from 'next/server';
import { loadConfig, today } from '@/server/config';
import { accountOf, store, tokens } from '@/server/account';

export const dynamic = 'force-dynamic';

/* WHERE SETUP IS. The connect checklist asks this every few seconds: the machines that have
 * checked in with a token, and how many posts have reached the account today. Two of the four
 * lines; the other two (the server and its config) come from the machine's own bridge. */
export async function GET(req: Request) {
  const cfg = loadConfig();
  const account = await accountOf(cfg, req);
  if (!account) return NextResponse.json({ error: 'No account.' }, { status: 401 });
  const day = today(cfg.timezone);
  const [list, posts] = await Promise.all([tokens(cfg).list(account), store(cfg).list(account, day)]);
  return NextResponse.json({ day, tokens: list, posts: posts.length });
}
