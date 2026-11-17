'use client';

import { useEffect } from 'react';

/* The landing's motion, in one place:
 *  - [data-reveal] blocks rise in once as they reach the screen;
 *  - [data-fill] statements light word by word as they cross the screen, each word stepping from
 *    a dim ink to its final tone (two tones: the lead in white, the tail in grey).
 * This is the fallback for browsers without scroll-driven animations; landing.css does it in CSS
 * everywhere else.
 * With reduced motion, or before this runs, everything is already in its final state: the page's
 * inline script adds .lp-js only when motion is allowed. */
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains('lp-js')) return;
    /* Scroll-driven CSS does all of this where the browser has it (landing.css). */
    if (typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()')) return;
    const reveal = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveal.forEach((el) => io.observe(el));

    const fills = [...document.querySelectorAll<HTMLElement>('[data-fill]')].map((el) => ({ el, words: [...el.querySelectorAll<HTMLElement>('.fw')] }));
    let raf = 0;
    const paint = () => {
      raf = 0;
      const vh = window.innerHeight;
      for (const { el, words } of fills) {
        const r = el.getBoundingClientRect();
        /* 0 when the statement's top reaches 85% of the screen, 1 when its bottom passes 45% */
        const start = vh * 0.85, end = vh * 0.45;
        const p = Math.min(1, Math.max(0, (start - r.top) / (start - end + r.height)));
        const lit = Math.round(p * words.length);
        words.forEach((w, i) => w.classList.toggle('on', i < lit));
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint); };
    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
