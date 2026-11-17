'use client';

import { useEffect, useState } from 'react';
import type { QueueItem } from '@/server/types';
import { mediaUrl } from './ui';
import { quickChecks, RULES, type Check } from './checks';

/* The checks themselves are plain functions in ./checks, so server pages (Lanes) can run them too.
 * This file adds the one that needs the browser: the image's shape, read once it loads. */
export { quickChecks, RULES, tileFlag, isClean, type Check } from './checks';

/** Every check, including the image's shape, which needs the first image loaded. */
export function useChecks(item: QueueItem, platform: string): Check[] {
  const [dims, setDims] = useState<{ key: string; w: number; h: number } | null>(null);
  const first = item.media.find((m) => m.kind === 'image');
  const key = first ? mediaUrl(first) : '';
  useEffect(() => {
    if (!key || !RULES[platform]?.ratio) return;
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setDims({ key, w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = key;
    return () => { live = false; };
  }, [key, platform]);
  const out = quickChecks(item, platform);
  const r = RULES[platform];
  if (r?.ratio && dims && dims.key === key && dims.w && dims.h) {
    const q = dims.w / dims.h;
    const ok = q >= r.ratio[0] - 0.01 && q <= r.ratio[1] + 0.01;
    out.splice(1, 0, { id: 'ratio', label: 'Image ratio', ok, detail: `${dims.w}×${dims.h}`, fix: ok ? undefined : `Recut the images to ${r.ratioLabel} for ${r.name}` });
  }
  return out;
}
