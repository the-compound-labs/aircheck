import './compound-lockup.css';
import './reader.css';
import { GitHubStars } from '@/components/GitHubStars';
import { CONTRIBUTING, DISCUSSIONS, ISSUES, REPO, SPONSOR } from '@/lib/project';

/* THE SITE CHROME, 2026-11-15 redesign.
 * Every reader page (docs, about, contact, privacy, terms, the guide) opens on a short band of the
 * landing's dusk plate with the landing's nav on it and a light serif title; the body below stays
 * white. reader.css draws all of it. The landing has its own, taller hero and imports none of this
 * page chrome, only the Lockup. */

/* The Compound Labs mark the lockup paints through a mask, so it takes the text colour. */
export const LOCKUP_MARK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjMzLjIgMjIuNzcgMTczLjYgMTkwLjU3IiB3aWR0aD0iMTczLjYiIGhlaWdodD0iMTkwLjU3Ij48Zz48cGF0aCBkPSJNMTMwLjM5IDI1Ljc3TDE5MS40MSA2MVEyMDEuOCA2NyAxOTEuNDEgNzNMMTc2LjI5IDgxLjczUTE2NS45IDg3LjczIDE1NS41MSA4MS43M0wxMzAuMzkgNjcuMjNRMTIwIDYxLjIzIDEwOS42MSA2Ny4yM0w4NC40OSA4MS43M1E3NC4xIDg3LjczIDYzLjcxIDgxLjczTDQ4LjU5IDczUTM4LjIgNjcgNDguNTkgNjFMMTA5LjYxIDI1Ljc3UTEyMCAxOS43NyAxMzAuMzkgMjUuNzdaIiBmaWxsPSIjMTUxNzFhIj48L3BhdGg+PHBhdGggZD0iTTIwNi44IDg3LjY2TDIwNi44IDE1OC4xMVEyMDYuOCAxNzAuMTEgMTk2LjQxIDE3Ni4xMUwxMzUuMzkgMjExLjM0UTEyNSAyMTcuMzQgMTI1IDIwNS4zNEwxMjUgMTg3Ljg5UTEyNSAxNzUuODkgMTM1LjM5IDE2OS44OUwxNjAuNTEgMTU1LjM5UTE3MC45IDE0OS4zOSAxNzAuOSAxMzcuMzlMMTcwLjkgMTA4LjM5UTE3MC45IDk2LjM5IDE4MS4yOSA5MC4zOUwxOTYuNDEgODEuNjZRMjA2LjggNzUuNjYgMjA2LjggODcuNjZaIiBmaWxsPSIjMTUxNzFhIj48L3BhdGg+PHBhdGggZD0iTTQzLjU5IDgxLjY2TDU4LjcxIDkwLjM5UTY5LjEgOTYuMzkgNjkuMSAxMDguMzlMNjkuMSAxMzcuMzlRNjkuMSAxNDkuMzkgNzkuNDkgMTU1LjM5TDEwNC42MSAxNjkuODlRMTE1IDE3NS44OSAxMTUgMTg3Ljg5TDExNSAyMDUuMzRRMTE1IDIxNy4zNCAxMDQuNjEgMjExLjM0TDQzLjU5IDE3Ni4xMVEzMy4yIDE3MC4xMSAzMy4yIDE1OC4xMUwzMy4yIDg3LjY2UTMzLjIgNzUuNjYgNDMuNTkgODEuNjZaIiBmaWxsPSIjMTUxNzFhIj48L3BhdGg+PHBhdGggZD0iTTExNSA4Ny42NkwxMTUgMTA1LjExUTExNSAxMTcuMTEgMTA0LjYxIDEyMy4xMUw4OS40OSAxMzEuODRRNzkuMSAxMzcuODQgNzkuMSAxMjUuODRMNzkuMSAxMDguMzlRNzkuMSA5Ni4zOSA4OS40OSA5MC4zOUwxMDQuNjEgODEuNjZRMTE1IDc1LjY2IDExNSA4Ny42NloiIGZpbGw9IiMxNTE3MWEiPjwvcGF0aD48cGF0aCBkPSJNMTM1LjM5IDgxLjY2TDE1MC41MSA5MC4zOVExNjAuOSA5Ni4zOSAxNjAuOSAxMDguMzlMMTYwLjkgMTI1Ljg0UTE2MC45IDEzNy44NCAxNTAuNTEgMTMxLjg0TDEzNS4zOSAxMjMuMTFRMTI1IDExNy4xMSAxMjUgMTA1LjExTDEyNSA4Ny42NlExMjUgNzUuNjYgMTM1LjM5IDgxLjY2WiIgZmlsbD0iIzE1MTcxYSI+PC9wYXRoPjxwYXRoIGQ9Ik0xMzAuMzkgMTMxLjc3TDE0NS41MSAxNDAuNVExNTUuOSAxNDYuNSAxNDUuNTEgMTUyLjVMMTMwLjM5IDE2MS4yM1ExMjAgMTY3LjIzIDEwOS42MSAxNjEuMjNMOTQuNDkgMTUyLjVRODQuMSAxNDYuNSA5NC40OSAxNDAuNUwxMDkuNjEgMTMxLjc3UTEyMCAxMjUuNzcgMTMwLjM5IDEzMS43N1oiIGZpbGw9IiMxNTE3MWEiPjwvcGF0aD48L2c+PC9zdmc+';

/** "Built by Compound Labs": the lab's mark and name in the lab's own face, in the text colour. */
export function Lockup() {
  return (
    <span className="by">Built by <span className="compound-lockup lk" data-compound-lockup="1"><i className="gm" style={{ ['--m' as string]: `url("${LOCKUP_MARK}")` }}></i><span>Compound Labs</span></span></span>
  );
}

/** The mark and the wordmark, linking home. */
export function Brand({ href = '/' }: { href?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <a className="ac-brand" href={href} aria-label="Aircheck home"><img src="/aircheck-mark.svg" alt="" width={28} height={28} /><span>Aircheck</span></a>
  );
}

/** The nav both the landing and the reader pages carry, on the dusk. `local` links stay on the landing. */
export function SiteNav({ local = false }: { local?: boolean }) {
  /* Off the landing the anchors point at /home: on aircheck.dev "/" is Today for anyone signed in
   * (review item 15). */
  const p = local ? '' : '/home';
  return (
    <nav className="ac-nav" aria-label="Main">
      <Brand href={local ? '#top' : '/'} />
      <div className="ac-links">
        <a href={`${p}#today`}>Today</a>
        <a href={`${p}#fix`}>Fix a post</a>
        <a href={`${p}#wire`}>Wire your jobs</a>
        <a href={`${p}#faq`}>Questions</a>
        <a href="/docs">Docs</a>
        <a href="/docs/self-host">Self-host</a>
      </div>
      <div className="ac-navr">
        <GitHubStars />
        <a className="ac-btn ac-btn-light ac-btn-sm" href="/?signin=1">Connect Aircheck</a>
      </div>
    </nav>
  );
}

/** The short dusk band a reader page opens with: the nav, then the page's title and a line. */
export function SiteHeader({ title, lede }: { title: string; lede?: React.ReactNode }) {
  return (
    <header className="rd-head">
      <SiteNav />
      <div className="rd-title"><h1>{title}</h1>{lede ? <p>{lede}</p> : null}</div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="rd-foot"><div className="rd-w">
      <Brand />
      <nav aria-label="Footer"><a href="/docs">Docs</a><a href="/docs/self-host">Self-host</a><a href={REPO}>Source code</a><a href={ISSUES}>Report a bug</a><a href={CONTRIBUTING}>Contribute</a><a href={DISCUSSIONS}>Discussions</a>{SPONSOR ? <a href={SPONSOR}>Sponsor</a> : null}<a href="/guides/preview-agent-queued-social-posts">Guide</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></nav>
      <p><Lockup /><span>Compound Labs, an independent product R&D lab, makes Aircheck.</span></p>
    </div></footer>
  );
}
