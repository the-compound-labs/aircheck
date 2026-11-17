import { notFound } from 'next/navigation';
import { studioFor } from '@/server/viewer';
import { senders } from '@/server/senders';
import { TodayView } from '@/components/TodayView';

export const dynamic = 'force-dynamic';

/* One sender's mail today: Email, filtered to it. */
export default async function EmailLane({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string }> }) {
  const { id } = await params;
  const s = await studioFor((await searchParams).day);
  const lanes = senders(s.lanes, [...s.emails, ...s.templates]);
  if (!lanes.some((l) => l.id === id)) notFound();
  return (
    <TodayView email items={s.emails} templates={s.templates} lanes={lanes} tz={s.cfg.timezone} day={s.day} today={s.today} days={s.days}
      agents={s.agents} defaultAgent={s.defaultAgent} initialLane={id}
      scopeCounts={{ social: s.queue.length, ads: s.ads.length, email: s.emails.length }} />
  );
}
