import './legal.css';
import { SiteFooter, SiteHeader } from './chrome';

/* /privacy, /terms, /contact and /about share one page shape: the short dusk band with the page's
 * title, the text at reading width, the way back and the footer. Only the title and the text differ. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader title={title} />
      <main className="rd-main">
        {children}
        <a className="back" href="/"><i aria-hidden="true">←</i>Back to Aircheck</a>
      </main>
      <SiteFooter />
    </>
  );
}

export const legalMeta = (name: string, path: string) => ({
  title: `${name} · Aircheck`,
  description: `${name} for Aircheck, the local studio that shows every post your agents queued for today.`,
  alternates: { canonical: `https://aircheck.dev/${path}` },
  robots: { index: true, follow: true },
});
