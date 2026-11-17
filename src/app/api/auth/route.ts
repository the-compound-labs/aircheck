import { NextResponse } from 'next/server';
import { loadConfig } from '@/server/config';
import { clearCookie, cookieFrom, cookieHeader, sessions, users } from '@/server/auth';
import { DbResets, hostedDb } from '@/server/db';
import { sendMail } from '@/server/mail';
import { resetMail, welcomeMail } from '@/server/mail-template';
import { receiptForNewAccount } from '@/server/ads-conversion';
import { deleteAccount } from '@/server/account';
import { trackAuth } from '@/server/track';

export const dynamic = 'force-dynamic';

/* Signing in. POST { action: signup | login | logout | forgot | reset | delete, email, password, token, confirm }.
 *
 * Aircheck mails you twice at most: a welcome when the account is made, and a reset link when you
 * ask for one. Nothing is verified by mail, so nothing waits on it. */

const secure = (req: Request) => new URL(req.url).protocol === 'https:';

export async function GET(req: Request) {
  const cfg = loadConfig();
  const id = await sessions(cfg).user(cookieFrom(req));
  const user = id ? await users(cfg).byId(id) : null;
  return NextResponse.json({
    signedIn: !!user,
    account: user ? { id: user.id, email: user.email } : null,
    /* The first run has nobody yet, so the page can offer to make the account rather than ask for
     * one that cannot exist. */
    empty: (await users(cfg).count()) === 0,
  });
}

export async function POST(req: Request) {
  const cfg = loadConfig();
  const body = await req.json().catch(() => ({})) as { action?: string; email?: string; password?: string; token?: string; confirm?: boolean };
  const U = users(cfg);
  const S = sessions(cfg);

  if (body.action === 'logout') {
    const t = cookieFrom(req);
    if (t) await S.close(t);
    return NextResponse.json({ signedIn: false }, { headers: { 'set-cookie': clearCookie() } });
  }

  /* Delete the signed-in account and everything stored for it. Only a browser session proves who is
   * asking: a machine token cannot delete the account it syncs to. */
  if (body.action === 'delete') {
    if (body.confirm !== true) return NextResponse.json({ error: 'Send { "action": "delete", "confirm": true } to delete your account.' }, { status: 400 });
    const id = await S.user(cookieFrom(req));
    if (!id) return NextResponse.json({ error: 'No account.' }, { status: 401 });
    if (!(await deleteAccount(cfg, id))) return NextResponse.json({ error: 'No account.' }, { status: 404 });
    return NextResponse.json({ deleted: true, signedIn: false }, { headers: { 'set-cookie': clearCookie() } });
  }

  /* A reset link, by email. The answer is the same whether or not the address has an account, so
   * this cannot be used to find out who has one. */
  if (body.action === 'forgot') {
    if (!hostedDb()) return NextResponse.json({ error: 'Password reset is on aircheck.dev. A local install has no mail.' }, { status: 400 });
    const u = await Promise.resolve(U.find(String(body.email || ''))).catch(() => null);
    if (u) {
      const token = await new DbResets().create(u.id);
      await sendMail(u.email, resetMail(`${new URL(req.url).origin}/reset?token=${encodeURIComponent(token)}`));
    }
    return NextResponse.json({ sent: true });
  }

  /* The new password, from a reset link: set it, and sign in. */
  if (body.action === 'reset') {
    if (!hostedDb()) return NextResponse.json({ error: 'Password reset is on aircheck.dev.' }, { status: 400 });
    const id = await new DbResets().use(String(body.token || ''));
    if (!id) return NextResponse.json({ error: 'That link has expired or was already used. Ask for a new link.' }, { status: 400 });
    try { await U.setPassword(id, String(body.password || '')); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
    const s = await S.open(id);
    return NextResponse.json({ signedIn: true }, { headers: { 'set-cookie': cookieHeader(s.token, secure(req)) } });
  }

  const email = String(body.email || '');
  const password = String(body.password || '');
  if (!email || !password) return NextResponse.json({ error: 'An email and a password, please.' }, { status: 400 });

  try {
    const user = body.action === 'signup' ? await U.create(email, password) : await U.verify(email, password);
    if (!user) return NextResponse.json({ error: 'That email and password do not match an account.' }, { status: 401 });
    const s = await S.open(user.id);
    if (body.action === 'signup') await sendMail(user.email, welcomeMail());
    const headers = new Headers({ 'set-cookie': cookieHeader(s.token, secure(req)) });
    /* U.create throws on an existing address, so reaching here on signup means a new account. */
    await receiptForNewAccount(req, headers, user.id, body.action === 'signup');
    await trackAuth(req, body.action === 'signup' ? 'signup_completed' : 'signin_completed', user.id, 'password');
    return NextResponse.json({ signedIn: true, account: { id: user.id, email: user.email } }, { headers });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
