import { studioFor } from '@/server/viewer';
import { senders } from '@/server/senders';
import { TodayView } from '@/components/TodayView';

export const dynamic = 'force-dynamic';

/* Email is the same day as Today, over the messages your jobs queued: one line each, the message
 * drawn as its reader will see it, and the same Example, Feedback and Repair. */
export default async function Email({ searchParams }: { searchParams: Promise<{ day?: string; q?: string }> }) {
  const sp = await searchParams;
  const s = await studioFor(sp.day);
  const lanes = senders(s.lanes, [...s.emails, ...s.templates]);
  return (
    <TodayView email items={s.emails} templates={s.templates} lanes={lanes} tz={s.cfg.timezone} day={s.day} today={s.today} days={s.days}
      readAt={s.readAt} agents={s.agents} defaultAgent={s.defaultAgent} initialQ={sp.q}
      scopeCounts={{ social: s.queue.length, ads: s.ads.length, email: s.emails.length }} />
  );
}
