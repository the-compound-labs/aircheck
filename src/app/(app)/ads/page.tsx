import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { studioAsync } from '@/server/studio';
import { loadConfig } from '@/server/config';
import { COOKIE, sessions } from '@/server/auth';
import { hostedDb } from '@/server/db';
import { adsAsQueue } from '@/server/sources/ads';
import { loadLanes } from '@/server/sources/lanes';
import { listRuns } from '@/server/runs';
import { Frame } from '@/components/Frame';
import { AdsBoard } from '@/components/AdsBoard';
import { DEMO_ADS } from '@/lib/demo-day';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ads · Aircheck', robots: { index: false, follow: false } };

/* Ads: the creative an ad pipeline built, on a board by where its review stands. The signed-in
 * account's synced creatives join the ones on disk; on aircheck.dev they are the only ones. Runs
 * live on the machine there, so the board reads them again from the browser. */
export default async function Ads({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const sample = (await searchParams).sample === '1';
  const jar = await cookies();
  const signedIn = await sessions(loadConfig()).user(jar.get(COOKIE)?.value);
  if (!signedIn && hostedDb()) redirect('/home?signin=1');
  const s = await studioAsync(undefined, signedIn);
  const items = adsAsQueue(sample ? DEMO_ADS : s.ads);
  const waiting = items.filter((i) => !i.ad!.approved && (i.ad!.status === 'draft' || i.ad!.status === 'review')).length;
  return (
    <Frame mode="board" scope="ads" title="Ads" wide
      sub={sample ? 'A sample board: Harbor Coffee’s creative, so you can see how review works. Your own creative replaces it.' : items.length ? `${items.length} ${items.length === 1 ? 'creative' : 'creatives'} from your ad pipeline · ${waiting} waiting on a decision` : 'Creative your ad pipeline builds, waiting for a decision'}>
      <AdsBoard sample={sample} items={items} lanes={loadLanes(s.cfg.adLanes)} runs={hostedDb() ? [] : listRuns(s.cfg).filter((r) => r.ad)} agents={s.agents} defaultAgent={s.defaultAgent} tz={s.cfg.timezone} />
    </Frame>
  );
}
