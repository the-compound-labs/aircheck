import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadConfig } from './config';
import { COOKIE, sessions } from './auth';
import { hostedDb } from './db';
import { studioAsync } from './studio';

/* The signed-in account for a page, and the studio read as that account. On aircheck.dev nobody
 * signed in has nothing to see, so the page sends them to the sign-in dialog; a local install has no sign-in
 * and reads its own config. */
export async function viewer(): Promise<string | null> {
  const jar = await cookies();
  const id = await sessions(loadConfig()).user(jar.get(COOKIE)?.value);
  if (!id && hostedDb()) redirect('/home?signin=1');
  return id;
}

export async function studioFor(day?: string) {
  return studioAsync(day, await viewer());
}
