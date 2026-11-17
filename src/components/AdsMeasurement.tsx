'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ADS_PATHS, ads, pageInternal } from '@/lib/ads-conversion';
import './ads-choice.css';

/* Google Ads, Meta, X and Reddit measurement (src/lib/ads-conversion.ts), only in a build that sets
 * their ids (src/lib/telemetry.ts), and then on by default.
 * <AdsClaim /> sits in the root layout and, on a measured page unless opted out, loads the tags and
 * asks once for a new account's event id. <AdsChoice /> is the opt-out control on /privacy and
 * /account. */

/* Read the server's internal mark as the script loads, before React touches the head. */
if (typeof document !== 'undefined') pageInternal();

export const ADS_COPY = {
  label: 'Google, Meta, X and Reddit ad measurement',
  desc: 'Advertising cookies connect a Google, Meta, X or Reddit ad visit with a new Aircheck account. Google, Meta, X and Reddit receive the conversion and a random one-time receipt, never your email, account ID, posts or media.',
  link: 'Measurement controls',
  blocked: "Your browser's Do Not Track or Global Privacy Control setting keeps this off.",
};

/* Beside the control on /account (review item 13): it is on by default, consent-gated by the
 * browser, and the visitor can turn it off here. */
export const ADS_NOTE = "Ad measurement runs by default. Your browser's Do Not Track or Global Privacy Control setting turns measurement off. You can also turn measurement off here.";

export function AdsClaim() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || !ADS_PATHS.has(pathname)) return;
    const a = ads();
    if (a.allowed()) void a.claim();
  }, [pathname]);
  return null;
}

export function AdsChoice() {
  /* Decided after mount: the server cannot read DNT/GPC or the URL the landing was asked under. */
  const [state, setState] = useState<{ on: boolean; blocked: boolean } | null>(null);
  useEffect(() => {
    const a = ads();
    const t = setTimeout(() => setState({ on: a.allowed(), blocked: a.blocked() }), 0);
    return () => clearTimeout(t);
  }, []);
  if (!state) return null;
  return (
    <div className="ads-choice" data-ads-control="">
      <label>
        <input type="checkbox" checked={state.on} disabled={state.blocked}
          onChange={(e) => setState({ ...state, on: ads().choose(e.target.checked) })} />
        <span>{ADS_COPY.label}</span>
      </label>
      <p>{state.blocked ? ADS_COPY.blocked : ADS_COPY.desc} {state.blocked ? <a href="/privacy#ads">{ADS_COPY.link}</a> : null}</p>
    </div>
  );
}
