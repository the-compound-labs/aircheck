import type { Metadata } from 'next';
import { LegalPage, legalMeta } from '../LegalPage';
import { AdsChoice } from '@/components/AdsMeasurement';

export const metadata: Metadata = legalMeta('Privacy', 'privacy');

export default function Privacy() {
  return (
    <LegalPage title="Privacy">
      <p>Aircheck runs the review in your browser, and your own machine runs the work. Your account stores one small JSON file per queued post with the lane, time, copy, status, and reference to each media file. It never stores your media. Your images and video stay on your machine or in storage you already own. Your browser loads them from there, so they never pass through us. The headless agent that Aircheck starts runs locally on your own subscription, writes only inside its run folder, and has no network.</p>
      <h2 id="self-hosted">Self-hosted copies</h2>
      <p>Aircheck is open source. A copy you build and run yourself sends no analytics or ad measurement to Compound Labs or anyone else because those IDs exist only in the aircheck.dev build. A self-hosted copy stores accounts and manifests in the database you connect it to. This policy covers aircheck.dev and the aircheck-mcp server.</p>
      <section className="ads-section">
      <h2 id="ads">Google, Meta, X and Reddit ad measurement</h2>
      <p>Google Ads measurement is on by default. Google uses advertising cookies to connect an ad visit with a new Aircheck account that our server confirmed. Aircheck sends Google a conversion action and a random, one-time receipt. Google uses the receipt to avoid duplicate counts. Aircheck never sends your email, account ID, manifests, post copy, media or machine details. Personalized advertising stays off. Google receives normal connection metadata when its script runs.</p>
      <p>If you turn measurement off, Aircheck stores that choice in the <code>aircheck_ads</code> cookie for one year. Aircheck deletes the ad platforms&apos; cookies in this browser. A new account can create an encrypted, account-bound receipt cookie, <code>aircheck_ads_result</code>, that lasts up to 10 minutes. The account also sets <code>aircheck_ads_pending</code> for the same 10 minutes. Its value is always 1. The cookie tells the page that a receipt is waiting. Aircheck clears both cookies as soon as your signed-in browser claims the receipt. None of these cookies contains readable account data. Google may set its own advertising attribution cookies. You can turn measurement off below or on your account page. Turning measurement off does not remove counts Google already received. Do Not Track and Global Privacy Control keep measurement off. Measurement runs only on aircheck.dev.</p>
      <p>Unless you turn measurement off, Meta&apos;s pixel loads on the landing, sign-in, account and privacy pages. Meta&apos;s pixel records a page view on those pages. A new account sends Meta the same conversion from our server. A new account sends Meta the same random receipt from our server. The browser sends Meta the same conversion when the pixel loads. The browser sends Meta the same random receipt when the pixel loads. Meta uses these values to count the account once. The server copy carries only that conversion, the site address https://aircheck.dev/, your IP address, your browser&apos;s user agent and Meta&apos;s own browser cookies. Meta never receives your email, account ID, manifests, post copy, media, machine details or any hashed customer data. Meta may set its own cookies, <code>_fbp</code> and <code>_fbc</code>. Turning measurement off deletes those cookies.</p>
      <p>Unless you turn measurement off, X&apos;s and Reddit&apos;s pixels load on the same pages as Meta&apos;s. Each pixel records a page view. A new account sends each pixel one fixed sign-up event with no parameters. X receives no email, account ID, manifests, post copy, media, machine details or customer data. Reddit receives no email, account ID, manifests, post copy, media, machine details or customer data. X may set <code>_twclid</code>. Reddit may set <code>_rdt_uuid</code> and <code>_rdt_cid</code>. Turning measurement off deletes those cookies.</p>
      <AdsChoice />
      </section>
    </LegalPage>
  );
}
