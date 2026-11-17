'use client';

import { useEffect, useState } from 'react';
import { MACHINE_EVENT } from './MachineButton';

/* YOUR COMPUTER, SAID OUT LOUD. aircheck.dev holds only JSON: every image, every preview and every
 * Fix comes from the Aircheck server on the user's own computer. When that computer is not
 * answering, the page says so, instead of drawing broken images and dead buttons:
 *   - a local image that fails becomes a card saying where it lives and how to load it,
 *   - the button under the logo (MachineButton) says whether the computer is connected.
 * When the computer comes back, the images are retried. */

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const card = (what: 'image' | 'video', file = '') => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1250" viewBox="0 0 1000 1250"><rect width="1000" height="1250" fill="#f4f4f5"/><g fill="none" stroke="#a1a1aa" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" transform="translate(380 430)"><rect x="0" y="0" width="240" height="160" rx="18"/><path d="M80 230h80M120 160v70"/></g><text x="500" y="760" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="40" font-weight="600" fill="#3f3f46">This ${what} is on your computer</text><text x="500" y="820" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="30" fill="#71717a">${esc(file.slice(0, 48)) || 'It shows again the moment that computer wakes'}</text></svg>`,
);
const PLACEHOLDER = card('image');
const VIDEO_PLACEHOLDER = card('video');

export function MachineStatus({ bridge }: { bridge: string }) {
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const ok = await fetch(`${bridge}/health`, { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
      if (!live) return;
      setUp(ok);
      (window as Window & { __aircheckMachine?: boolean }).__aircheckMachine = ok;
      window.dispatchEvent(new CustomEvent(MACHINE_EVENT, { detail: ok }));
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { live = false; clearInterval(id); };
  }, [bridge]);

  /* An image from this computer that fails shows where it lives instead of a broken icon. Images
   * that failed before this ran are swept up whenever the computer is found missing. */
  useEffect(() => {
    const fallback = (img: HTMLImageElement) => {
      if (!img.src.startsWith(bridge)) return;
      img.dataset.machineSrc = img.src;
      const file = decodeURIComponent((img.src.split('p=')[1] || '').split('&')[0]).split('/').pop() || '';
      img.src = file ? card('image', file) : PLACEHOLDER;
    };
    /* A video keeps its source, so it plays the moment the computer is back; the card is its poster. */
    const fallbackVideo = (v: HTMLVideoElement) => {
      if (!v.src.startsWith(bridge) || v.dataset.machineVideo) return;
      v.dataset.machineVideo = '1';
      v.poster = VIDEO_PLACEHOLDER;
    };
    const onError = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === 'IMG') fallback(t as HTMLImageElement);
      if (t?.tagName === 'VIDEO') fallbackVideo(t as HTMLVideoElement);
    };
    document.addEventListener('error', onError, true);
    if (up === false) {
      document.querySelectorAll<HTMLImageElement>('img').forEach((img) => { if (img.complete && img.naturalWidth === 0) fallback(img); });
      document.querySelectorAll<HTMLVideoElement>('video').forEach((v) => { if (v.error || v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) fallbackVideo(v); });
    }
    return () => document.removeEventListener('error', onError, true);
  }, [bridge, up]);

  /* Back online: every image that fell back is asked for again. */
  useEffect(() => {
    if (!up) return;
    document.querySelectorAll<HTMLImageElement>('img[data-machine-src]').forEach((img) => {
      const src = img.dataset.machineSrc!;
      delete img.dataset.machineSrc;
      img.src = src;
    });
    document.querySelectorAll<HTMLVideoElement>('video[data-machine-video]').forEach((v) => {
      delete v.dataset.machineVideo;
      v.removeAttribute('poster');
      v.load();
    });
  }, [up]);

  /* The state is shown by MachineButton under the logo; this component only watches. */
  return null;
}
