import { loadConfig } from '@/server/config';
import { cookieHeader, sessions, users } from '@/server/auth';
import { PKCE_COOKIE, clearPkce, finishGoogle } from '@/server/oauth';
import { sendMail } from '@/server/mail';
import { welcomeMail } from '@/server/mail-template';
import { receiptForNewAccount } from '@/server/ads-conversion';
import { trackAuth } from '@/server/track';

export const dynamic = 'force-dynamic';

const cookieOf = (req: Request, name: string) => {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
};

/* Google comes back here with a code. Trade it for the verified email, find or make the Aircheck
 * account for that email, and open the session. A new account lands on /account to connect a
 * machine; a returning one lands on its day. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (msg: string) => new Response(null, {
    status: 302,
    headers: { location: `/?signin=1&error=${encodeURIComponent(msg)}`, 'set-cookie': clearPkce() },
  });
  const code = url.searchParams.get('code');
  const verifier = cookieOf(req, PKCE_COOKIE);
  if (!code) return fail(url.searchParams.get('error_description') || 'Google sign-in was cancelled.');
  if (!verifier) return fail('That sign-in expired. Try again.');

  const got = await finishGoogle(code, verifier);
  if ('error' in got) return fail(got.error);

  const cfg = loadConfig();
  const U = users(cfg);
  const existing = await U.find(got.email);
  const made = existing ? { user: existing, created: false } : await U.createOAuth(got.email);
  const user = made.user;
  if (made.created) await sendMail(user.email, welcomeMail());
  const s = await sessions(cfg).open(user.id);
  const headers = new Headers({ location: made.created ? '/account' : '/' });
  headers.append('set-cookie', cookieHeader(s.token, url.protocol === 'https:'));
  headers.append('set-cookie', clearPkce());
  /* Only the insert that made the account can carry an ads receipt, and only unless the visitor opted out. */
  await receiptForNewAccount(req, headers, user.id, made.created);
  await trackAuth(req, made.created ? 'signup_completed' : 'signin_completed', user.id, 'google');
  return new Response(null, { status: 302, headers });
}
