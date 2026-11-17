import type { Config } from './config';
import { store } from './account';
import type { Lane } from './types';

/* LANE LOGOS. A lane can wear its own logo in place of the platform glyph: a path on the machine
 * (served by the media bridge, like any other local media) or a URL. Set in the app, kept in the
 * account as one small manifest per lane under a reserved key instead of a day, the way the email
 * template registry is. Like everything else in the account it is a reference, never the image. */

/** The key lane logos live under, in place of a day. */
export const LANE_LOGOS = 'lane-logos';

export async function loadLogos(cfg: Config, account: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of await store(cfg).list(account, LANE_LOGOS)) {
    const logo = (r.manifest.meta as { logo?: unknown } | undefined)?.logo;
    if (typeof logo === 'string' && logo.trim()) out[r.manifest.lane] = logo.trim();
  }
  return out;
}

/** Set a lane's logo, or clear it with an empty value. */
export async function setLogo(cfg: Config, account: string, lane: string, logo: string) {
  const s = store(cfg);
  const id = lane.replace(/[^a-z0-9._-]/gi, '-').slice(0, 120);
  if (!logo.trim()) return s.remove(account, LANE_LOGOS, id);
  await s.put(account, { id, day: LANE_LOGOS, manifest: { lane, kind: 'lane-logo', status: 'held', meta: { logo: logo.trim() } }, updatedAt: '' });
}

/** The account's logo wins over one the config gave the lane. */
export const withLogos = (lanes: Lane[], logos: Record<string, string>): Lane[] =>
  lanes.map((l) => (logos[l.id] ? { ...l, logo: logos[l.id] } : l));
