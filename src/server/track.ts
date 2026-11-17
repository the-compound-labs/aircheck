/* SIGN-UP AND SIGN-IN EVENTS, THE SERVER HALF.
 *
 * The account routes know for certain when an account was made or a session opened, and an ad
 * blocker cannot drop a request the server sends. So `signup_completed` and `signin_completed` are
 * sent from here to PostHog's public capture endpoint with the same project key the page uses (no
 * personal key, nothing billed beyond the event).
 *
 * The event joins the visitor's own browsing (their ad click, UTM tags, pages) through the
 * distinct id posthog-js keeps in its first-party cookie. With no cookie it falls back to the
 * account id. The email never leaves this side. */
import { internalRequest } from './internal-traffic.mjs';
import { POSTHOG_HOST, POSTHOG_KEY } from '../lib/telemetry';

/* Off unless the build sets a PostHog key (src/lib/telemetry.ts). */
const KEY = POSTHOG_KEY;
const CAPTURE = `${POSTHOG_HOST}/i/v0/e/`;
const COOKIE = `ph_${KEY}_posthog`;

function visitorId(req: Request): string {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== COOKIE) continue;
    try { return String(JSON.parse(decodeURIComponent(v.join('='))).distinct_id || ''); } catch { return ''; }
  }
  return '';
}

export type AuthEvent = 'signup_completed' | 'signin_completed';

/** Record an account event. Never throws and never holds the answer longer than 1.5 s. */
export async function trackAuth(req: Request, event: AuthEvent, accountId: string, method: 'password' | 'google') {
  if (!KEY) return;
  const host = new URL(req.url).hostname;
  if (host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host)) return;
  const visitor = visitorId(req);
  const properties: Record<string, unknown> = {
    app: 'aircheck', method, account_id: accountId, $host: host, source: 'server',
    $set: { app: 'aircheck', aircheck_account: accountId },
  };
  if (internalRequest(req.headers)) properties.internal = true;
  /* Joins the anonymous visitor to the account id, so a later sign-in from another device lands on the same person. */
  if (visitor && visitor !== accountId) properties.$anon_distinct_id = visitor;
  try {
    await fetch(CAPTURE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event: visitor ? '$identify' : event,
        distinct_id: accountId,
        properties,
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (visitor) {
      await fetch(CAPTURE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: KEY, event, distinct_id: accountId, properties: { ...properties, $anon_distinct_id: undefined } }),
        signal: AbortSignal.timeout(1500),
      });
    }
  } catch {}
}
