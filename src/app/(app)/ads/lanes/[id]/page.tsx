import { notFound } from 'next/navigation';
import { studioFor } from '@/server/viewer';
import { adsAsQueue } from '@/server/sources/ads';
import { loadLanes } from '@/server/sources/lanes';
import { TodayView } from '@/components/TodayView';

export const dynamic = 'force-dynamic';

/* One ad platform's creative, in the same review as everything else. */
export default async function AdLane({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await studioFor();
  const lanes = loadLanes(s.cfg.adLanes);
  if (!lanes.some((l) => l.id === id)) notFound();
  /* Every creative goes in; the view filters to this one. That keeps the sidebar's counts whole. */
  return (
    <TodayView ads initialLane={id} items={adsAsQueue(s.ads)} lanes={lanes} tz={s.cfg.timezone}
      day={s.day} today={s.today} days={[]} agents={s.agents} defaultAgent={s.defaultAgent}
      scopeCounts={{ social: s.queue.length, ads: s.ads.length, email: s.emails.length }} />
  );
}
