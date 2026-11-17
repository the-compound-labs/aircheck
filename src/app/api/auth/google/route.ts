import { googleEnabled, pkceCookie, startGoogle } from '@/server/oauth';

export const dynamic = 'force-dynamic';

/* Start "Continue with Google": remember the PKCE verifier in a short-lived cookie and send the
 * browser to the shared auth project. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleEnabled()) return Response.redirect(new URL('/?signin=1&error=google', url.origin).toString(), 302);
  const { url: to, verifier } = startGoogle(url.origin);
  return new Response(null, { status: 302, headers: { location: to, 'set-cookie': pkceCookie(verifier, url.protocol === 'https:') } });
}
