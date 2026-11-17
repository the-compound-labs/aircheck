import { studioFor } from '@/server/viewer';
import { senders } from '@/server/senders';
import { Frame } from '@/components/Frame';
import { LaneCards } from '@/components/LaneCards';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Senders · Aircheck', robots: { index: false, follow: false } };

/* Every sender with mail queued today, and what each is carrying. */
export default async function EmailLanes() {
  const s = await studioFor();
  const lanes = senders(s.lanes, s.emails);
  return (
    <Frame mode="lanes" scope="email" lanes={lanes} title="Senders" sub={`${lanes.length} ${lanes.length === 1 ? 'sender' : 'senders'} with email queued today`}>
      <LaneCards lanes={lanes} items={s.emails} base="/email" noun="email today" tz={s.cfg.timezone} />
    </Frame>
  );
}
