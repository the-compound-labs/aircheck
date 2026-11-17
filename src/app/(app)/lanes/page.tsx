import { studioFor } from '@/server/viewer';
import { listRuns } from '@/server/runs';
import { laneWeek } from '@/server/studio';
import { quickChecks } from '@/lib/checks';
import { Frame } from '@/components/Frame';
import { LaneCards } from '@/components/LaneCards';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lanes · Aircheck', robots: { index: false, follow: false } };

export default async function Lanes() {
  const s = await studioFor();
  const week = await laneWeek(s.today, s.cfg.account?.id);
  const platformOf = new Map(s.lanes.map((l) => [l.id, l.platform]));
  const broken = new Set(s.queue.filter((i) => i.status !== 'sent' && quickChecks(i, platformOf.get(i.lane) || 'other').some((c) => !c.ok)).map((i) => i.lane)).size;
  return (
    <Frame mode="lanes" lanes={s.lanes} title="Lanes"
      sub={`${s.lanes.length} ${s.lanes.length === 1 ? 'lane' : 'lanes'} · ${s.queue.length} ${s.queue.length === 1 ? 'post' : 'posts'} queued today${broken ? ` · ${broken} ${broken === 1 ? 'needs' : 'need'} a fix` : ''}`}
      right={<a className="ac-btn pri" href="/docs#config"><i className="ph-bold ph-plus"></i>Wire a lane</a>}>
      <LaneCards lanes={s.lanes} items={s.queue} runs={listRuns(s.cfg)} noun="post today" week={week} tz={s.cfg.timezone} />
    </Frame>
  );
}
