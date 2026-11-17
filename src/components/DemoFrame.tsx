'use client';

import { useEffect } from 'react';

/* /demo inside the landing's window. A link opens its real place in the whole tab, not inside the
 * window, and the wheel scrolls the landing around the window rather than the panes in it (the
 * reviewed mock did the same, app.html line 564). Opened on its own, /demo behaves as the app. */
export function DemoFrame({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (window.parent === window) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); window.parent.postMessage({ aircheckWheel: [e.deltaX, e.deltaY] }, window.location.origin); };
    window.addEventListener('wheel', wheel, { passive: false });
    /* In the landing's window the fix loop is the point (review item 9): scroll the opened post so the
     * revised run sits whole above the composer instead of under it. */
    const fit = () => {
      const b = document.querySelector('.ac-post-b') as HTMLElement | null;
      const run = document.querySelector('.ac-post-b .ac-run') as HTMLElement | null;
      const comp = document.querySelector('.ac-post-b .ac-compose') as HTMLElement | null;
      if (!b || !run) return;
      const top = run.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop;
      b.scrollTop = Math.max(0, top + run.offsetHeight - (b.clientHeight - (comp?.offsetHeight || 0)) + 12);
    };
    const t = [300, 900, 1800].map((ms) => setTimeout(fit, ms));
    return () => { window.removeEventListener('wheel', wheel); t.forEach(clearTimeout); };
  }, []);
  const leave = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a || window.parent === window || a.target === '_blank') return;
    e.preventDefault();
    (window.top || window).location.href = a.href;
  };
  return <div style={{ display: 'contents' }} onClickCapture={leave}>{children}</div>;
}
