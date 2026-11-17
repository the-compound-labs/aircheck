import type { Metadata } from 'next';
import { TodayView } from '@/components/TodayView';
import { DemoFrame } from '@/components/DemoFrame';
import { SetupLinkToast } from '@/components/SetupLinkToast';
import { DEMO_DAY, DEMO_ITEMS, DEMO_LANES, DEMO_NOW, DEMO_READ_AT, DEMO_RUNS, DEMO_SELECTED, DEMO_TZ } from '@/lib/demo-day';

export const metadata: Metadata = { title: 'Aircheck', robots: { index: false, follow: false } };

/* The real Today view on a sample day, with no account and no database: the window on the landing
 * (src/app/(site)/home) embeds this at 1440x900. Links and runs leave the window for the real
 * place (DemoFrame, Actions). */
export default function Demo() {
  return (
    <DemoFrame>
      <TodayView items={DEMO_ITEMS} lanes={DEMO_LANES} tz={DEMO_TZ} day={DEMO_DAY} today={DEMO_DAY} days={[DEMO_DAY]}
        readAt={DEMO_READ_AT} agents={['codex', 'claude']} defaultAgent="codex" initialSel={DEMO_SELECTED} clockAt={DEMO_NOW} demo demoRuns={DEMO_RUNS} />
      <SetupLinkToast />
    </DemoFrame>
  );
}
