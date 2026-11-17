/* GOOGLE ADS MEASUREMENT, THE SERVER HALF.
 *
 * On by default. A visitor who did not opt out (aircheck_ads=no, set only by the browser control in
 * src/lib/ads-conversion.ts) and whose browser sends neither Do Not Track nor Global Privacy Control
 * gets one receipt when the server has just CREATED their account: a password sign-up that inserted
 * a row, or a Google sign-in that inserted a row. A returning sign-in never gets one.
 *
 * The receipt is an HttpOnly cookie, encrypted (AES-GCM) and bound to the account, holding a random
 * one-time event id and a 10 minute expiry. The signed-in browser trades it at POST
 * /api/ads-conversion for that event id alone; the route clears the cookie in the same answer, so a
 * second claim finds nothing. The event id becomes the conversion's transaction_id. The account id,
 * the email and every manifest stay on this side. */

import { metaEvent, sendMetaEvent } from './meta-capi.mjs';
import { internalRequest } from './internal-traffic.mjs';

export const ADS_CHOICE = 'aircheck_ads';
export const ADS_RECEIPT = 'aircheck_ads_result';
export const ADS_RECEIPT_MS = 10 * 60_000;
const KIND = 'new-account';
const EVENT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

/* The receipt key, derived from a server-only secret. aircheck.dev has SUPABASE_SERVICE_ROLE_KEY;
 * AIRCHECK_ADS_KEY overrides it. With neither, no receipt is ever issued. */
const secret = () => process.env.AIRCHECK_ADS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
async function key(raw: string) {
  const base = await crypto.subtle.importKey('raw', enc.encode(raw), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('aircheck-ads-receipt'), info: enc.encode('v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

const cookieOf = (req: Request, name: string) => {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
};

/** Measurement is allowed for this request: not opted out, neither DNT nor GPC, and not one of the
 * operator's own addresses (src/server/internal-traffic.mjs), which never gets or claims a receipt. */
export function adsAllowed(req: Request) {
  return !internalRequest(req.headers) && cookieOf(req, ADS_CHOICE) !== 'no' && req.headers.get('dnt') !== '1' && req.headers.get('sec-gpc') !== '1';
}

const receiptCookie = (value: string, age: number, secure: boolean) =>
  `${ADS_RECEIPT}=${value}; Max-Age=${age}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
export const clearAdsReceipt = (secure: boolean) => receiptCookie('', 0, secure);

/* The receipt is HttpOnly, so the page cannot see whether one is waiting. This second cookie is set
 * and cleared with it and says only that: its value is always 1. The page asks for the event id only
 * while it is there, so a visit with nothing to claim sends no request. It proves nothing: the server
 * still decides from the session and the receipt alone. */
export const ADS_PENDING = 'aircheck_ads_pending';
export const pendingCookie = (on: boolean, secure: boolean) =>
  `${ADS_PENDING}=${on ? '1' : ''}; Max-Age=${on ? ADS_RECEIPT_MS / 1000 : 0}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;

/** The Set-Cookie for a brand-new account's receipt, or null when there is no key. */
export async function issueAdsReceipt(userId: string, { now = Date.now(), secure = true } = {}): Promise<string | null> {
  const raw = secret();
  if (!raw || !userId) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = JSON.stringify({ kind: KIND, user: userId, event: crypto.randomUUID(), expires: now + ADS_RECEIPT_MS });
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(raw), enc.encode(body)));
  return receiptCookie(`${b64(iv)}.${b64(sealed)}`, ADS_RECEIPT_MS / 1000, secure);
}

/** The event id inside a valid receipt for this account, or null. Only that id leaves here. */
export async function claimAdsReceipt(value: string, userId: string, { allowed, now = Date.now() }: { allowed: boolean; now?: number }): Promise<string | null> {
  const raw = secret();
  if (!allowed || !raw || !userId || typeof value !== 'string' || !value || value.length > 2048) return null;
  try {
    const [iv, sealed] = value.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(raw), unb64(sealed));
    const r = JSON.parse(dec.decode(plain)) as { kind?: string; user?: string; event?: string; expires?: number };
    const fresh = Number.isFinite(r.expires) && r.expires! > now && r.expires! <= now + ADS_RECEIPT_MS;
    return r.kind === KIND && r.user === userId && fresh && EVENT.test(r.event || '') ? r.event! : null;
  } catch { return null; }
}

/** Append a receipt to a response's headers when the account was just created and the visitor opted in. */
export async function receiptForNewAccount(req: Request, headers: Headers, userId: string, created: boolean) {
  if (!created || !adsAllowed(req)) return;
  const secure = new URL(req.url).protocol === 'https:';
  const c = await issueAdsReceipt(userId, { secure }).catch(() => null);
  if (c) { headers.append('set-cookie', c); headers.append('set-cookie', pendingCookie(true, secure)); }
}

/* POST /api/ads-conversion. Same origin only, signed in only. Always clears the receipt and its marker; answers
 * { event } and nothing else. `viewer` resolves the session to an account id. */
export async function handleAdsClaim(req: Request, viewer: (req: Request) => Promise<string | null>): Promise<Response> {
  const url = new URL(req.url);
  const secure = url.protocol === 'https:';
  const json = (status: number, body: unknown) => {
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    headers.append('set-cookie', clearAdsReceipt(secure));
    headers.append('set-cookie', pendingCookie(false, secure));
    return new Response(JSON.stringify(body), { status, headers });
  };
  if (req.method !== 'POST') return json(405, { error: 'POST only.' });
  /* A browser cannot forge Origin. It must name this host: the request URL's (the Worker) or the
   * Host header's (a Node server behind a proxy, whose req.url carries its own listen address). */
  const origin = req.headers.get('origin') || '';
  const originHost = /^https?:\/\//.test(origin) ? new URL(origin).host : '';
  if (!originHost || (originHost !== url.host && originHost !== req.headers.get('host'))) return json(403, { error: 'Same origin only.' });
  const user = await viewer(req).catch(() => null);
  if (!user) return json(401, { error: 'Sign in first.' });
  const event = await claimAdsReceipt(cookieOf(req, ADS_RECEIPT), user, { allowed: adsAllowed(req) });
  // The same one-event id goes to Meta's Conversions API; the browser pixel copy deduplicates against it.
  if (event) await sendMetaEvent(metaEvent({ name: 'account_created', id: event, sourceUrl: 'https://aircheck.dev/', ip: req.headers.get('cf-connecting-ip') || '', userAgent: req.headers.get('user-agent') || '', fbp: cookieOf(req, '_fbp'), fbc: cookieOf(req, '_fbc') }));
  return json(200, { event });
}
