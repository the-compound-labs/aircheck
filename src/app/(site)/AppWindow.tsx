'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

/* The window on the landing: the real app at 1440x900, scaled to the frame's width, with the
 * frame's height following. The wheel over the window scrolls the page around it; /demo hands it up
 * (DemoFrame). Before this runs, the frame already holds the 1440:900 shape, so nothing below it
 * moves. `lazy` waits until the window is near the screen, for a second copy lower on the page. */
export function AppWindow({ src, lazy = false, title = 'Aircheck Today on a sample day', w = 1440, h = 900 }: { src: string; lazy?: boolean; title?: string; w?: number; h?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const b = box.current, f = frame.current;
    if (!b || !f) return;
    const fit = () => { const s = b.clientWidth / w; f.style.transform = `scale(${s})`; b.style.height = `${h * s}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [w, h]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data && e.data.aircheckWheel;
      if (Array.isArray(d)) window.scrollBy(0, Number(d[1]) || 0);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return (
    <div className="app" ref={box} style={{ aspectRatio: `${w} / ${h}` }}>
      <iframe ref={frame} src={src} scrolling="no" tabIndex={-1} title={title} loading={lazy ? 'lazy' : undefined} style={{ width: w, height: h }} />
    </div>
  );
}
