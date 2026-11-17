import { loadConfig } from '@/server/config';
import { cookieFrom, sessions } from '@/server/auth';
import { handleAdsClaim } from '@/server/ads-conversion';

export const dynamic = 'force-dynamic';

/* The signed-in browser trades its one-time ads receipt for the random event id (src/server/ads-conversion.ts). */
export function POST(req: Request) {
  return handleAdsClaim(req, async (r) => sessions(loadConfig()).user(cookieFrom(r)));
}
