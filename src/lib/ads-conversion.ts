/* GOOGLE ADS MEASUREMENT, THE BROWSER HALF. 
 *
 * Off unless the build sets the ids (src/lib/telemetry.ts). Where it is set, it is on by default:
 * unless the visitor unticked the control (the aircheck_ads=no cookie) or the browser sends Do Not
 * Track or Global Privacy Control, and only on the one host the build names, gtag loads with ad data
 * redaction on, ad personalization off, analytics storage denied, the page location cut to the site
 * root (plus a well-formed gclid on the landing, so the ad click can be attributed) and no referrer
 * or title. The one conversion is sent only with an event id the server handed out for a brand-new
 * account (src/server/ads-conversion.ts), marked as attempted before it is sent and never retried. */

import { ADS_HOST, GOOGLE_ADS, META_PIXEL, REDDIT_PIXEL, X_EVENT, X_PIXEL } from './telemetry';

/* Every id comes from the build (src/lib/telemetry.ts). With none set, nothing below ever loads. */
export { ADS_HOST, META_PIXEL, X_PIXEL, X_EVENT, REDDIT_PIXEL };
export const ADS_SEND_TO = GOOGLE_ADS;
export const ADS_TAG = ADS_SEND_TO.split('/')[0];
export const ADS_CHOICE = 'aircheck_ads';
/* Set by the server with a new account's receipt and cleared with it (src/server/ads-conversion.ts).
 * Its value is always 1. The receipt itself is HttpOnly, so this is how the page knows one is waiting. */
export const ADS_PENDING = 'aircheck_ads_pending';
const ROOT = `https://${ADS_HOST}/`;
/* The landing (served at "/"), Today ("/" signed in, where a password sign-up lands),
 * the account page (where a Google sign-up lands) and the privacy page. */
export const ADS_PATHS = new Set(['/', '/privacy', '/account']);
/* The server marks a page internal (the operator's own addresses) in <meta name="aircheck-internal">
 * (src/server/internal-traffic.mjs, added by worker/index.mjs). An internal page loads no ad tag, sets
 * no ad cookie and sends no page view or conversion. Read once and kept, so it outlives a re-rendered head. */
export const INTERNAL_META = 'aircheck-internal';
let marked = false;
export function pageInternal(doc: { querySelector: (sel: string) => unknown } | undefined = typeof document === 'undefined' ? undefined : document) {
  if (marked) return true;
  try { marked = (doc?.querySelector(`meta[name="${INTERNAL_META}"]`) as { content?: string } | null)?.content === '1'; } catch { /* No document: not marked. */ }
  return marked;
}
const EVENT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const YEAR = 31536000;

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; push: unknown; loaded: boolean; version: string; disablePushState?: boolean };
type Twq = ((...args: unknown[]) => void) & { exe?: (...a: unknown[]) => void; queue: unknown[]; version: string };
type Rdt = ((...args: unknown[]) => void) & { sendEvent?: (...a: unknown[]) => void; callQueue: unknown[] };
export type AdsEnv = {
  location: { href: string; hostname: string; pathname: string; protocol: string };
  navigator: { doNotTrack?: string | null; globalPrivacyControl?: boolean };
  getCookie: () => string;
  setCookie: (c: string) => void;
  win: { dataLayer?: unknown[]; gtag?: Gtag; fbq?: Fbq; _fbq?: Fbq; twq?: Twq; rdt?: Rdt };
  loadScript: (src: string) => void;
  fetch: typeof fetch;
  /** Whether the server marked this page internal. Absent means no. */
  internal?: () => boolean;
};

export function createAds(env: AdsEnv) {
  let loaded = false;
  let busy = false;
  const attempted = new Set<string>();

  const jar = () => Object.fromEntries(env.getCookie().split(';').map((s) => { const [k, ...v] = s.trim().split('='); return [k, v.join('=')]; }));
  const blocked = () => env.navigator.doNotTrack === '1' || env.navigator.globalPrivacyControl === true;
  const allowed = () => !blocked() && jar()[ADS_CHOICE] !== 'no';
  const production = () => !!ADS_HOST && !!ADS_TAG && env.location.hostname === ADS_HOST && !env.internal?.();
  const secure = () => (env.location.protocol === 'https:' ? '; Secure' : '');

  /** The site root, plus the ad click id on the landing. Never a path, query or fragment otherwise. */
  function safeLocation() {
    const url = new URL(ROOT);
    const input = new URL(env.location.href).searchParams;
    const click = input.get('gclid');
    if (env.location.pathname === '/' && input.getAll('gclid').length === 1 && /^[A-Za-z0-9_-]{1,256}$/.test(click || '')) url.searchParams.set('gclid', click!);
    return url.href;
  }

  /** Load gtag, once, only when allowed on the measured host on one of the measured pages. */
  function tag() {
    if (!allowed() || !production() || !ADS_PATHS.has(env.location.pathname)) return false;
    if (loaded) return true;
    loaded = true;
    const w = env.win;
    w.dataLayer ||= [];
    // gtag reads `arguments`, not an array; this is the shape Google's snippet uses.
    // eslint-disable-next-line prefer-rest-params
    w.gtag = function gtag() { w.dataLayer!.push(arguments); };
    const g = w.gtag;
    const page = { page_location: safeLocation(), page_referrer: '', page_title: 'Aircheck' };
    g('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', analytics_storage: 'denied', ad_personalization: 'denied' });
    g('set', 'ads_data_redaction', true);
    g('set', 'url_passthrough', false);
    g('set', 'allow_ad_personalization_signals', false);
    g('set', 'page_location', page.page_location);
    g('set', 'page_referrer', '');
    g('set', 'page_title', 'Aircheck');
    g('js', new Date());
    g('config', ADS_TAG, { send_page_view: false, allow_ad_personalization_signals: false, ...page });
    env.loadScript(`https://www.googletagmanager.com/gtag/js?id=${ADS_TAG}`);
    return true;
  }

  /** Meta's pixel reports the page address as it is, so it loads only on the measured pages with no
   * query beyond ad tags. PageView only: no automatic events and no advanced matching. */
  function pixelPage() {
    return ADS_PATHS.has(env.location.pathname) && [...new URL(env.location.href).searchParams.keys()].every((k) => /^(utm_(source|medium|campaign|content|term)|fbclid|gclid|twclid|rdt_cid)$/.test(k));
  }
  function pixel() {
    if (!allowed() || !production() || !pixelPage()) return false;
    const w = env.win;
    if (X_PIXEL) xPixel();
    if (REDDIT_PIXEL) redditPixel();
    if (!META_PIXEL) return true;
    if (w.fbq) { w.fbq('consent', 'grant'); return true; }
    // The shape of Meta's own base code: a queue the downloaded script drains.
    const fbq = ((...args: unknown[]) => { if (fbq.callMethod) fbq.callMethod(...args); else fbq.queue.push(args); }) as Fbq;
    fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
    fbq.disablePushState = true; // No automatic PageView on client-side navigation.
    w.fbq = w._fbq = fbq;
    fbq('set', 'autoConfig', false, META_PIXEL);
    fbq('init', META_PIXEL);
    fbq('track', 'PageView');
    env.loadScript('https://connect.facebook.net/en_US/fbevents.js');
    return true;
  }
  /** X's pixel, loaded only from pixel(), behind the same gate. Page view only, no customer data. */
  function xPixel() {
    const w = env.win;
    if (w.twq) return;
    // The shape of X's own base code: a queue the downloaded script drains.
    const twq = ((...args: unknown[]) => { if (twq.exe) twq.exe(...args); else twq.queue.push(args); }) as Twq;
    twq.version = '1.1'; twq.queue = [];
    w.twq = twq;
    twq('config', X_PIXEL);
    env.loadScript('https://static.ads-twitter.com/uwt.js');
  }
  /** Reddit's pixel, loaded only from pixel(), behind the same gate. PageVisit only, no advanced matching. */
  function redditPixel() {
    const w = env.win;
    if (w.rdt) return;
    // The shape of Reddit's own base code: a queue the downloaded script drains.
    const rdt = ((...args: unknown[]) => { if (rdt.sendEvent) rdt.sendEvent(...args); else rdt.callQueue.push(args); }) as Rdt;
    rdt.callQueue = [];
    w.rdt = rdt;
    rdt('init', REDDIT_PIXEL);
    rdt('track', 'PageVisit');
    env.loadScript('https://www.redditstatic.com/ads/pixel.js');
  }

  /** Ask the server for a new account's event id and, if there is one, send the one conversion.
   * The tags load either way. The request goes out only while the server's marker says a receipt is
   * waiting: a signed-out visitor, or an account with nothing to claim, sends none. */
  async function claim() {
    if (busy || !tag()) return;
    pixel();
    if (jar()[ADS_PENDING] !== '1') return;
    busy = true;
    try {
      const r = await env.fetch('/api/ads-conversion', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}', referrerPolicy: 'no-referrer' });
      if (!r.ok) return;
      const { event } = await r.json() as { event?: string | null };
      if (!allowed() || !event || !EVENT.test(event) || attempted.has(event)) return;
      attempted.add(event); // Mark before send: an uncertain delivery is never retried.
      env.win.gtag!('event', 'conversion', { send_to: ADS_SEND_TO, value: 0, currency: 'USD', transaction_id: event, page_location: ROOT, page_referrer: '', page_title: 'Aircheck', allow_ad_personalization_signals: false });
      // The server already sent this id to Meta's Conversions API; the pixel copy deduplicates against it.
      if (pixelPage() && env.win.fbq) env.win.fbq('trackCustom', 'account_created', {}, { eventID: event });
      if (pixelPage() && env.win.twq && X_EVENT) env.win.twq('event', X_EVENT, {});
      if (pixelPage() && env.win.rdt) env.win.rdt('track', 'SignUp');
    } catch { /* Optional measurement never interrupts the product. */ }
    finally { busy = false; }
  }

  /** The visitor's yes or no, kept a year. No clears the ad platforms' attribution cookies too. */
  function choose(yes: boolean) {
    const on = yes && !blocked();
    env.setCookie(`${ADS_CHOICE}=${on ? 'yes' : 'no'}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure()}`);
    if (!on) {
      env.win.gtag?.('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', analytics_storage: 'denied', ad_personalization: 'denied' });
      env.win.fbq?.('consent', 'revoke');
      for (const name of ['_gcl_aw', '_gcl_au', '_gcl_gs', '_gcl_dc', '_fbp', '_fbc', '_twclid', '_rdt_uuid', '_rdt_cid']) {
        env.setCookie(`${name}=; Path=/; Max-Age=0${secure()}`);
        if (production()) env.setCookie(`${name}=; Path=/; Domain=.${ADS_HOST}; Max-Age=0${secure()}`);
      }
    } else void claim();
    return allowed();
  }

  return { blocked, allowed, production, safeLocation, tag, pixel, pixelPage, claim, choose };
}

let shared: ReturnType<typeof createAds> | null = null;
/** The page's one instance, over the real browser. */
export function ads() {
  if (shared) return shared;
  shared = createAds({
    location: window.location,
    navigator: navigator as AdsEnv['navigator'],
    getCookie: () => document.cookie,
    setCookie: (c) => { document.cookie = c; },
    win: window as unknown as AdsEnv['win'],
    loadScript: (src) => { const s = document.createElement('script'); s.async = true; s.src = src; document.head.append(s); },
    fetch: (...a) => window.fetch(...a),
    internal: () => pageInternal(),
  });
  return shared;
}
