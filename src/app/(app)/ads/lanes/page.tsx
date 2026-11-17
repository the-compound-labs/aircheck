import { studioFor } from '@/server/viewer';
import { adsAsQueue } from '@/server/sources/ads';
import { loadLanes } from '@/server/sources/lanes';
import { Frame } from '@/components/Frame';
import { LaneCards } from '@/components/LaneCards';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ad platforms · Aircheck', robots: { index: false, follow: false } };

/* The ad platforms, and what each is carrying. */
export default async function AdLanes() {
  const s = await studioFor();
  const lanes = loadLanes(s.cfg.adLanes);
  const items = adsAsQueue(s.ads);
  const live = lanes.filter((l) => items.some((i) => i.lane === l.id)).length;
  return (
    <Frame mode="lanes" scope="ads" lanes={lanes} title="Platforms"
      sub={`${lanes.length} platforms, ${live} carrying creative`}>
      <LaneCards lanes={lanes} items={items} base="/ads" noun="creative" tz={s.cfg.timezone} />
    </Frame>
  );
}
