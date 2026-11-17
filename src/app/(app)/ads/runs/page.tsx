import { studioFor } from '@/server/viewer';
import { listRuns } from '@/server/runs';
import { hostedDb } from '@/server/db';
import { loadLanes } from '@/server/sources/lanes';
import { runTargets } from '@/server/run-targets';
import { Frame } from '@/components/Frame';
import { RunsView } from '@/components/RunsView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ad runs · Aircheck', robots: { index: false, follow: false } };

/* Every run an agent made on a creative, newest first. */
export default async function AdRuns() {
  const s = await studioFor();
  const runs = hostedDb() ? [] : listRuns(s.cfg).filter((r) => r.ad);
  return (
    <Frame mode="previews" scope="ads" lanes={loadLanes(s.cfg.adLanes)} title="Ads"
      sub={runs.length ? `${runs.length} runs on ad creative, newest first` : 'Open a creative in Ads and run Example, Feedback or Repair. The run shows up here.'}>
      <RunsView scope="ads" runs={runs} lanes={loadLanes(s.cfg.adLanes)} products={s.products} agents={s.agents} defaultAgent={s.defaultAgent} targets={await runTargets([], s.ads)} />
    </Frame>
  );
}
