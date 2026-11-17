/* MEASUREMENT IS OFF UNLESS THE BUILD TURNS IT ON.
 *
 * A copy of Aircheck you build yourself sends nothing to anyone: no product analytics, no ad pixel,
 * no conversion. Each piece is switched on only by setting its id when the app is built (these are
 * NEXT_PUBLIC_ variables, so Next writes them into the bundle at build time). The official
 * aircheck.dev build sets them; a self-hosted build leaves them empty.
 *
 *   NEXT_PUBLIC_AIRCHECK_POSTHOG_KEY     PostHog project key: page views, sign-up and sign-in events
 *   NEXT_PUBLIC_AIRCHECK_POSTHOG_HOST    PostHog ingest host (default https://us.i.posthog.com)
 *   NEXT_PUBLIC_AIRCHECK_ADS_HOST        the one host ad measurement may run on, e.g. aircheck.dev
 *   NEXT_PUBLIC_AIRCHECK_GOOGLE_ADS      Google Ads conversion, "AW-<id>/<label>"
 *   NEXT_PUBLIC_AIRCHECK_META_PIXEL      Meta pixel and Conversions API dataset id
 *   NEXT_PUBLIC_AIRCHECK_X_PIXEL         X pixel id, and NEXT_PUBLIC_AIRCHECK_X_EVENT its sign-up event
 *   NEXT_PUBLIC_AIRCHECK_REDDIT_PIXEL    Reddit pixel id
 *
 * Ad measurement needs ADS_HOST and runs only on that host, and only where the visitor has not
 * opted out or sent Do Not Track or Global Privacy Control (src/lib/ads-conversion.ts). */

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_AIRCHECK_POSTHOG_KEY || '';
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_AIRCHECK_POSTHOG_HOST || 'https://us.i.posthog.com';
export const POSTHOG_UI_HOST = POSTHOG_HOST.replace('.i.posthog.com', '.posthog.com');

export const ADS_HOST = process.env.NEXT_PUBLIC_AIRCHECK_ADS_HOST || '';
export const GOOGLE_ADS = process.env.NEXT_PUBLIC_AIRCHECK_GOOGLE_ADS || '';
export const META_PIXEL = process.env.NEXT_PUBLIC_AIRCHECK_META_PIXEL || '';
export const X_PIXEL = process.env.NEXT_PUBLIC_AIRCHECK_X_PIXEL || '';
export const X_EVENT = process.env.NEXT_PUBLIC_AIRCHECK_X_EVENT || '';
export const REDDIT_PIXEL = process.env.NEXT_PUBLIC_AIRCHECK_REDDIT_PIXEL || '';

export const analyticsOn = () => !!POSTHOG_KEY;
export const adsOn = () => !!ADS_HOST && !!GOOGLE_ADS;
