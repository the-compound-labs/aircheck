import { studioFor } from '@/server/viewer';
import { senders } from '@/server/senders';
import { listRuns } from '@/server/runs';
import { hostedDb } from '@/server/db';
import { runTargets } from '@/server/run-targets';
import { Frame } from '@/components/Frame';
import { RunsView } from '@/components/RunsView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Email runs · Aircheck', robots: { index: false, follow: false } };

/* Every run an agent made on a queued email, newest first. */
export default async function EmailRuns() {
  const s = await studioFor();
  const lanes = senders(s.lanes, s.emails);
  const ids = new Set(lanes.map((l) => l.id));
  const runs = hostedDb() ? [] : listRuns(s.cfg).filter((r) => r.target && ids.has(r.lane));
  return (
    <Frame mode="previews" scope="email" lanes={lanes} title="Email"
      sub={runs.length ? `${runs.length} runs on queued email, newest first` : 'Open an email and run Example, Feedback or Repair. The run shows up here.'}>
      <RunsView scope="email" runs={runs} lanes={lanes} products={s.products} agents={s.agents} defaultAgent={s.defaultAgent} targets={await runTargets(runs, [])} />
    </Frame>
  );
}
