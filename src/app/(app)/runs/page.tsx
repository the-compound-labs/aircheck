import { studioFor } from '@/server/viewer';
import { listRuns } from '@/server/runs';
import { hostedDb } from '@/server/db';
import { runTargets } from '@/server/run-targets';
import { Frame } from '@/components/Frame';
import { RunsView } from '@/components/RunsView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Runs · Aircheck', robots: { index: false, follow: false } };

/* Every run on this machine: previews of a lane, and example, feedback and repair runs on a post.
 * On aircheck.dev runs live on the machine, so the browser reads them from it. */
export default async function Runs({ searchParams }: { searchParams: Promise<{ build?: string }> }) {
  const { build } = await searchParams;
  const s = await studioFor();
  const runs = hostedDb() ? [] : listRuns(s.cfg).filter((r) => !r.ad);
  const running = runs.filter((r) => r.status === 'running').length;
  return (
    <Frame mode="previews" lanes={s.lanes} title="Runs"
      sub={runs.length ? `Previews and repairs on this machine · ${runs.length} so far${running ? `, ${running} running` : ''}` : 'Previews and repairs on this machine'}>
      <RunsView runs={runs} lanes={s.lanes} products={s.products} agents={s.agents} defaultAgent={s.defaultAgent} targets={await runTargets(runs, [])} build={build} />
    </Frame>
  );
}
