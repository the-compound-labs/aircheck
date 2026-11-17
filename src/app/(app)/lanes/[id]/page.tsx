import { notFound } from 'next/navigation';
import { studioFor } from '@/server/viewer';
import { TodayView } from '@/components/TodayView';

export const dynamic = 'force-dynamic';

/* One lane: its posts today, in the same review as Today, filtered to it. Building a preview is
 * Previews' job, so a lane is never a second copy of that form. Every post goes in and the view
 * filters, which keeps the sidebar's counts whole. */
export default async function LanePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string }> }) {
  const { id } = await params;
  const s = await studioFor((await searchParams).day);
  if (!s.lanes.some((l) => l.id === id)) notFound();
  return (
    <TodayView initialLane={id} items={s.queue} lanes={s.lanes} tz={s.cfg.timezone} day={s.day} today={s.today} days={s.days}
      readAt={s.readAt} agents={s.agents} defaultAgent={s.defaultAgent}
      scopeCounts={{ social: s.queue.length, ads: s.ads.length, email: s.emails.length }} />
  );
}
