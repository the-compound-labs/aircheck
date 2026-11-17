import crypto from 'node:crypto';

/* SIGNING IN WITH GOOGLE. Aircheck uses the Google sign-in the rest of the Compound Labs products
 * already share: Supabase Auth on the same project, with the Google provider on. The browser goes
 * to Supabase, Supabase to Google, and back to /api/auth/callback with a one-time code. The server
 * trades that code (PKCE, so it is useless to anyone without the verifier cookie) for the verified
 * email, then opens an ordinary Aircheck session for the account with that email. Nothing about
 * the Supabase session is kept: Aircheck's own session cookie is the only one. */

export const PKCE_COOKIE = 'aircheck_pkce';

const base = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const anon = () => process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const b64url = (b: Buffer) => b.toString('base64url');

/** Google sign-in is offered where the server can reach the shared auth project. */
export const googleEnabled = () => !!base() && !!anon();

export function startGoogle(origin: string) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    provider: 'google',
    redirect_to: `${origin}/api/auth/callback`,
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  return { url: `${base()}/auth/v1/authorize?${q}`, verifier };
}

/** The verified email for a returned code, or an error message. */
export async function finishGoogle(code: string, verifier: string): Promise<{ email: string } | { error: string }> {
  const r = await fetch(`${base()}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { apikey: anon(), 'content-type': 'application/json' },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const body = await r.json().catch(() => null) as { user?: { email?: string; email_confirmed_at?: string | null }; error_description?: string; msg?: string } | null;
  if (!r.ok || !body?.user?.email) return { error: body?.error_description || body?.msg || `Google sign-in failed (${r.status}).` };
  if (!body.user.email_confirmed_at) return { error: 'Google did not confirm that email address.' };
  return { email: body.user.email };
}

export function pkceCookie(verifier: string, secure: boolean) {
  return `${PKCE_COOKIE}=${verifier}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`;
}
export const clearPkce = () => `${PKCE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
