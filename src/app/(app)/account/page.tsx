import { redirect } from 'next/navigation';
import { loadConfig } from '@/server/config';
import { users } from '@/server/auth';
import { studioFor, viewer } from '@/server/viewer';
import { Frame } from '@/components/Frame';
import { AccountView } from '@/components/AccountView';
import { LaneLogos } from '@/components/LaneLogos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account · Aircheck', robots: { index: false, follow: false } };

/* The account, inside the app like every other page: the sidebar stays, so the way back to Today
 * and the lanes is where it always is. */
export default async function Account() {
  const id = await viewer();
  const user = id ? await users(loadConfig()).byId(id) : null;
  if (!user) redirect('/home?signin=1');
  const s = await studioFor();
  return (
    <Frame mode="account" lanes={s.lanes} title="Account" sub="Your sign-in, the machines that sync to it, and how Aircheck shows your lanes.">
      <AccountView email={user.email}><LaneLogos lanes={s.lanes} /></AccountView>
    </Frame>
  );
}
