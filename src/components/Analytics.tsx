'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { PostHog } from 'posthog-js';
import { configureReplay, replayOptions } from './posthog-replay';
import { replayPolicy } from './posthog-replay-policy';
import { pageInternal } from '@/lib/ads-conversion';
import { POSTHOG_HOST, POSTHOG_KEY, POSTHOG_UI_HOST } from '@/lib/telemetry';

/* POSTHOG IS FETCHED AFTER HYDRATION, NEVER BUNDLED INTO THE CRITICAL PATH.
 *
 * posthog-js is about 290 KB raw. As a static top level import every visitor would download and
 * parse the whole SDK before the page could run, to send a pageview that does not fire until after
 * mount anyway.
 *
 * NOTHING MAY BE DROPPED ON THE WAY. The import cannot simply be moved behind a flag that races
 * the first pageview. init() returns the one promise
 * every caller awaits. The pageview effect awaits it before capturing, so the first pageview of
 * a visit waits for the fetch instead of racing a flag. capture() awaits it too, so a click
 * during the fetch is sent when the fetch lands.
 *
 * The one real cost: an exception thrown before the SDK arrives is not captured. Error tracking
 * starts at hydration now rather than at parse. */
let posthog: PostHog | null = null;
// useSearchParams() hands the pageview effect a new object for a URL that has not changed, so
// one view was captured twice: 56 of the apex's 380 clean pageviews in 14 days (2026-11-13).
let lastPageviewUrl = '';
let replay: ReturnType<typeof configureReplay> | undefined;
let ready: Promise<boolean> | null = null;

// PostHog, only when the build sets a key (src/lib/telemetry.ts). A self-hosted build sends nothing.
// It talks to the PostHog host directly; there is no /ingest reverse proxy.

// Every event carries this as the `app` property.
const APP_SLUG = 'aircheck';

// Local and preview hosts report as "dev", which the dashboards leave out.
function appSlugFromHost(host: string): string {
  const bare = host.split(':')[0].toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost') || /^[\d.]+$/.test(bare) || bare.endsWith('.vercel.app')) return 'dev';
  return APP_SLUG;
}

let initialized = false;
let purchaseFired = false;
let checkoutHooked = false;

/** Fetch and start the SDK, once. Every caller awaits this same promise. */
function init(): Promise<boolean> {
  if (typeof window === 'undefined' || !POSTHOG_KEY) return Promise.resolve(false);
  if (ready) return ready;
  ready = import('posthog-js').then(({ default: ph }) => {
    posthog = ph;
    start(ph);
    return true;
  }).catch(() => false);
  return ready;
}

/** Capture an event, awaiting the SDK. An event fired while the SDK is in flight is sent when
 * the fetch lands instead of being dropped. */
// Exported so a product's own controls can send their events through the same queue.
export function capture(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  void init().then((ok) => {
    if (!ok || !posthog) return;
    try { posthog.capture(event, props); } catch {}
  });
}

function start(posthog: PostHog) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: POSTHOG_UI_HOST,
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    person_profiles: 'identified_only',
    disable_session_recording: true, // Starts only after bounded trusted-interaction admission.
    session_recording: replayOptions(replayPolicy),
    enable_recording_console_log: false,
    capture_exceptions: true,
    // Error-tracking noise gate. PostHog's weekly digest was 363 exceptions of which 333 were
    // two browser artifacts no code here can fix - Outlook's SafeLink wrapper ("Object Not
    // Found Matching Id:N, MethodName:update") and the benign ResizeObserver loop notice - and
    // the rest were a dev server's compile errors on localhost. All three drown out real
    // crashes, so they are dropped here, before the request leaves the page.
    //
    // *** IT READS THE WHOLE EVENT. `$exception_values` IS NOT A CLIENT PROPERTY. (2026-08-24)
    //
    // This gate shipped 2026-08-17 testing `event.properties.$exception_values`, and it dropped
    // NOTHING in the week everyone believed it was working. posthog-js sends `$exception_list`
    // (plus `$exception_message` and `$exception_type`); `$exception_values` is a column PostHog
    // MATERIALISES SERVER-SIDE out of that list, so client-side it is `undefined`,
    // `JSON.stringify(undefined ?? EMPTY)` is a pair of quotes, and neither regex ever matched.
    // The 2026-08-23 digest carried 243 SafeLink rejections - its highest count ever - straight
    // through a filter nobody doubted. A gate keyed to a property that does not exist yet fails
    // OPEN and still reads as armed, which is why this now matches against the serialised event
    // instead of one hand-picked key.
    //
    // *** AND IT DROPS EXCEPTIONS THROWN BY DECLARED BOTS. Lightpanda - the open-source headless
    // browser AI agents drive - threw 4,860 exceptions in three days in August 2026 across sites
    // using this code: 86% of that week's digest and the whole 1461% spike. They were React #418
    // hydration mismatches and "Illegal invocation", both artifacts of an incomplete web-API
    // surface rather than defects in this code. crawl-guard now 410s that agent on the URL
    // shapes it was enumerating, and it deliberately still reads content pages - being indexed
    // is the point of a directory. What a crawler must not do is author the error digest.
    // The names are spelled out rather than matched on a bare /bot/, which hits real phones
    // (CUBOT), and this list is a deliberate copy: this file is generated standalone into repos
    // that have no src/lib/crawl-guard to import from.
    before_send: (event) => {
      if (event?.event === '$snapshot' && !replay?.canSend()) return null;
      if (!event || event.event !== '$exception') return event;
      try {
        const host = window.location.host.split(':')[0].toLowerCase();
        if (host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.endsWith('.vercel.app')) return null;
        const ua = navigator.userAgent || '';
        if (navigator.webdriver) return null;
        if (/lightpanda|headlesschrome|phantomjs|puppeteer|playwright|python-requests|node-fetch|scrapy|curl\/|wget\/|googlebot|bingbot|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-user|perplexitybot|bytespider|amazonbot|applebot|ccbot|petalbot|yandexbot|baiduspider|duckduckbot|semrushbot|ahrefsbot|mj12bot|dotbot|slurp|facebookexternalhit|meta-externalagent/i.test(ua)) return null;
        // The serialised event, not one key: `$exception_list` holds the message client-side
        // today and the shape has already moved once. Matching the blob survives the next move.
        const blob = JSON.stringify(event.properties ?? {});
        if (/Object Not Found Matching Id:\d+/.test(blob)) return null;
        if (/ResizeObserver loop/.test(blob)) return null;
      } catch {
        // a noise gate must never be the thing that breaks a page
      }
      return event;
    },
  });
  initialized = true;
  replay = configureReplay(posthog, replayPolicy, POSTHOG_KEY, POSTHOG_HOST);
  try {
    const slug = appSlugFromHost(window.location.host);
    posthog.register({ app: slug });
    // A page the server marked internal (the operator's own addresses) labels every event it sends.
    if (pageInternal()) posthog.register({ internal: true });
    posthog.group('app', slug, { name: slug });
  } catch {
    // a missing app label must never throw
  }
}

/* THE LISTENERS ARE INSTALLED AT MOUNT, NOT INSIDE posthog.init().
 *
 * They used to run inside init(). With the SDK fetched after hydration that would leave them
 * unregistered until the fetch landed, so a click in that window would not be counted. They
 * capture through the queue above, which sends the event when the SDK arrives. */
function hookListeners() {
  if (typeof document === 'undefined') return;
  // Funnel top: any pricing "buy" click ([data-checkout-tier]) -> checkout_started.
  //
  // ⛔ THE SELECTOR IS THE ATTRIBUTE, NOT THE TAG. (widened 2026-08-02)
  //
  // It used to be `a[data-checkout-tier]`, which silently required every checkout control to be
  // an anchor. Plenty of them cannot be: a checkout that has to POST (to create a
  // run, to price a tier server-side, to attach a scan) is a <button>, and a retired product shipped one
  // carrying `data-checkout-tier` faithfully while never matching this listener once. So
  // `checkout_started` had NEVER FIRED there, and the funnel-depth report read it as a
  // product nobody had ever tried to pay for. That is not a missing metric, it is a metric that
  // reads as a business fact and is not one.
  //
  // Dropping the `a` makes the data attribute the contract, which is the thing a component
  // author can actually be asked to remember. `closest` still walks up from the click target, so
  // an icon or a <span> inside the control matches too.
  if (!checkoutHooked) {
    checkoutHooked = true;
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement)?.closest?.('[data-checkout-tier]') as HTMLElement | null;
      if (el) {
        try { capture('checkout_started', { tier: el.getAttribute('data-checkout-tier') }); } catch {}
      }
    });
  }
}

function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => { hookListeners(); }, []);

  /* How long a page was open and how far it was scrolled, sent once when the page is left. A
   * pageview alone cannot tell a reader from a load: on 2026-11-13 this app recorded no leave
   * event at all, so no visitor could be shown to have stayed. Same shape as the apex and @gent. */
  useEffect(() => {
    if (!pathname) return;
    const started = performance.now();
    const leftPath = window.location.pathname;
    let left = false;
    let deepest = 0;
    const scroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      deepest = Math.max(deepest, total > 0 ? Math.min(100, Math.round(window.scrollY / total * 100)) : 100);
    };
    const leave = () => {
      if (left) return;
      left = true;
      capture('$pageleave', {
        $pathname: leftPath,
        $current_url: window.location.origin + leftPath,
        observed_end: document.visibilityState === 'hidden' ? 'hidden' : 'navigation',
        duration_seconds: Math.round((performance.now() - started) / 1000),
        scroll_depth: deepest,
      });
    };
    const visibility = () => { if (document.visibilityState === 'hidden') leave(); };
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      leave();
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [pathname]);

  useEffect(() => {
    if (!pathname) return;
    let cancelled = false;
    /* The pageview AWAITS the SDK rather than testing a flag. With a static import
     * `initialized` was already true by the time this ran. With a fetch it is not, and an
     * early return here would silently drop the first pageview of every visit. */
    void init().then((ok) => {
      if (!ok || cancelled || !posthog) return;

        // First-touch UTM attribution. It rides on every later event (incl. checkout/purchase).
        const utm: Record<string, string> = {};
        for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
          const v = searchParams?.get(k);
          if (v) utm[k] = v;
        }
        if (Object.keys(utm).length) {
          posthog.register_once(utm);
          posthog.setPersonProperties(undefined, utm);
        }

        let url = window.location.origin + pathname;
        const qs = searchParams?.toString();
        if (qs) url += `?${qs}`;
        if (url !== lastPageviewUrl) {
          lastPageviewUrl = url;
          posthog.capture('$pageview', { $current_url: url, $host: window.location.host });
        }

        /* Purchase: Stripe checkout success returns to /?paid=1 (api/checkout success_url).
         * Fire once per load so a refresh can't double-count.
         *
         * ⛔ `?paid=1` IS A TYPEABLE STRING, SO THIS EVENT IS NOT EVIDENCE ON ITS OWN. (2026-08-20)
         *
         * Anyone who loads `<host>/?paid=1` mints a `purchase_completed` with no Stripe object behind
         * it, and `purchase_completed` is the deepest rung of the funnel-depth report. That
         * is a metric which reads as a business fact and can be authored by a stranger with an address
         * bar: the same class of defect as the `checkout_started` selector that never matched, and
         * the reason that comment above exists.
         *
         * It is NOT fixed by tightening the condition here, because `?paid=1` is what every shipped
         * `api/checkout` success_url currently sends back; requiring anything stronger today would
         * silently zero real revenue. So the event still fires, and instead it now
         * CARRIES ITS OWN PROVENANCE:
         *
         *   verified: 'session'  a Stripe-generated `cs_...` id came back; it is unguessable, so this is
         *                        evidence a checkout really happened
         *   verified: 'flag'     a bare `?paid=1` is forgeable, and must be treated as a hint
         *
         * Read `purchase_completed` with `verified = 'session'` when the number has to be true. The
         * real close is `success_url` carrying `{CHECKOUT_SESSION_ID}` on every product, then a
         * server-side retrieve before this fires; until every checkout route does that, the property
         * is what keeps the funnel honest instead of confidently wrong. */
        const sessionId = searchParams?.get('session_id') ?? '';
        const paidFlag = searchParams?.get('paid') === '1';
        if (!purchaseFired && (paidFlag || sessionId)) {
          purchaseFired = true;
          posthog.capture('purchase_completed', {
            app: appSlugFromHost(window.location.host),
            verified: /^cs_[A-Za-z0-9_]+$/.test(sessionId) ? 'session' : 'flag',
          });
        }
    });
    return () => { cancelled = true; };
  }, [pathname, searchParams]);

  return null;
}

export default function Analytics() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
