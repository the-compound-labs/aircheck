import type { Metadata } from 'next';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/bold';
import '@phosphor-icons/web/fill';
import '../aircheck.css';
import '../app.css';
import '../shell.css';
import { BRIDGE } from '@/lib/ui';
import { ConnectMachine } from '@/components/ConnectMachine';
import { MachineStatus } from '@/components/MachineStatus';

export const metadata: Metadata = {
  title: 'Aircheck',
  description: 'Every post your agents queued today, with its media, and a way to fix any of them before it goes out.',

  robots: { index: false, follow: false },
};

/* The app: Today, lanes, ads, previews, sign-in and the account, drawn by the reviewed riff's
 * styles (aircheck.css) and the app's own (app.css). The document and the fonts are the root's. */
/* On aircheck.dev a local media file is fetched from the user's own media bridge, by a direct URL:
 * a redirect to 127.0.0.1 gets auto-upgraded to https by the browser and fails. The server decides
 * from its runtime setting; this line hands the browser the same answer so both renders agree. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const bridge = process.env.AIRCHECK_DB === 'supabase' ? BRIDGE : '';
  return (
    <>
      {bridge ? <script dangerouslySetInnerHTML={{ __html: `window.__AIRCHECK_BRIDGE=${JSON.stringify(bridge)}` }} /> : null}
      {children}
      {bridge ? <ConnectMachine bridge={bridge} /> : null}
      {bridge ? <MachineStatus bridge={bridge} /> : null}
    </>
  );
}
