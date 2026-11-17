'use client';

import { useEffect, useState } from 'react';
import '@phosphor-icons/web/bold';
import { REPO, REPO_SLUG } from '@/lib/project';

/* The repository link with its live star count, read once per page from GitHub's public API in the
 * visitor's browser. No count (offline, rate-limited) leaves the link without one. */
export function GitHubStars({ className = '' }: { className?: string }) {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch(`https://api.github.com/repos/${REPO_SLUG}`, { signal: c.signal, headers: { accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j.stargazers_count === 'number') setStars(j.stargazers_count); })
      .catch(() => {});
    return () => c.abort();
  }, []);
  return (
    <a className={`gh-stars ${className}`} href={REPO} aria-label={stars === null ? 'Aircheck on GitHub' : `Aircheck on GitHub, ${stars} stars`}>
      <i className="ph-bold ph-github-logo" aria-hidden="true"></i>
      <span>Star</span>
      {stars !== null ? <b className="num">{new Intl.NumberFormat('en-US', { notation: stars >= 10000 ? 'compact' : 'standard' }).format(stars)}</b> : null}
    </a>
  );
}
