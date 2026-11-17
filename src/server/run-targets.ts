import type { AdCreative, QueueItem, Run } from './types';
import type { Target } from '@/components/RunsView';
import { studioFor } from './viewer';

/* WHAT EACH RUN ACTED ON, for the Runs drawer's before and after: the queued post by day and id,
 * read the way Today reads that day, and the creative by its id. Only the days the runs name are
 * read, the latest fourteen at most. */
export async function runTargets(runs: Run[], ads: AdCreative[]): Promise<Record<string, Target>> {
  const out: Record<string, Target> = {};
  const days = [...new Set(runs.filter((r) => r.target).map((r) => r.target!.day))].sort().reverse().slice(0, 14);
  const read = await Promise.all(days.map((d) => studioFor(d).then((s) => [...s.queue, ...s.emails]).catch(() => [] as QueueItem[])));
  days.forEach((d, k) => {
    for (const i of read[k]) out[`${d}:${i.id}`] = { id: i.id, day: d, title: i.email?.subject || i.title || (i.text || '').split('\n').find((t) => t.trim()) || i.kind, text: i.text, media: i.media };
  });
  for (const a of ads) out[`ad:${a.id}`] = { id: a.id, ad: true, title: a.title || a.format, text: a.text, media: a.media };
  return out;
}
