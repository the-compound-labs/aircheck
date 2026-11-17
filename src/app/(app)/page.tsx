import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hostedDb } from '@/server/db';
import { studioAsync } from '@/server/studio';
import { loadConfig } from '@/server/config';
import { COOKIE, sessions } from '@/server/auth';
import { TodayView } from '@/components/TodayView';

export const dynamic = 'force-dynamic';

export default async function Today({ searchParams }: { searchParams: Promise<{ day?: string; q?: string; post?: string; lane?: string }> }) {
  const sp = await searchParams;
  const jar = await cookies();
  const signedIn = await sessions(loadConfig()).user(jar.get(COOKIE)?.value);
  /* On aircheck.dev the day belongs to whoever is signed in; nobody signed in has no day. */
  if (!signedIn && hostedDb()) redirect('/home?signin=1');
  const s = await studioAsync(sp.day, signedIn);
  return (
    <TodayView items={s.queue} lanes={s.lanes} tz={s.cfg.timezone} day={s.day} today={s.today} days={s.days}
      readAt={s.readAt} agents={s.agents} defaultAgent={s.defaultAgent} initialQ={sp.q} initialSel={sp.post} initialLane={sp.lane}
      scopeCounts={{ social: s.queue.length, ads: s.ads.length, email: s.emails.length }} />
  );
}
