import { NextResponse } from 'next/server';
import { loadConfig } from '@/server/config';
import { loadAds } from '@/server/sources/ads';

export const dynamic = 'force-dynamic';

/* Every ad creative a pipeline has built, newest first. ?product=<slug> narrows it. */
export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const cfg = loadConfig();
  const product = q.get('product');
  const ads = loadAds(cfg.ads).filter((c) => !product || c.product === product);
  return NextResponse.json({ ads });
}
