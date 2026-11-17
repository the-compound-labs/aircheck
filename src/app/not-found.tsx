import type { Metadata } from 'next';
import '@phosphor-icons/web/regular';
import './(site)/reader.css';
import { SiteFooter, SiteHeader } from './(site)/chrome';
import { COPY } from './(site)/copy';

export const metadata: Metadata = { title: 'Not found · Aircheck', robots: { index: false, follow: false } };

/* NOT FOUND (review 2026-11-16, item 10): the reader page's dusk band with the mark and the nav, a
 * serif line, and the two places a visitor or a signed-in reader is looking for. Copy by Codex. */
export default function NotFound() {
  return (
    <>
      <SiteHeader title={COPY.rd2_nf_title} lede={COPY.rd2_nf_lede} />
      <main className="rd-main nf2">
        <div className="nf2-links">
          <a className="nf2-a" href="/"><i className="ph ph-tray" aria-hidden="true"></i><span><b>Today</b><small>/</small></span></a>
          <a className="nf2-a" href="/docs"><i className="ph ph-book-open" aria-hidden="true"></i><span><b>Docs</b><small>/docs</small></span></a>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
