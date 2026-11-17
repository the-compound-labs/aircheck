import { expand, readJson, type SourceConfig } from '../config';
import { helpers, pluginFor } from '../plugins';
import type { Lane, Platform } from '../types';

/* LANE SOURCES.
 *   static             lanes listed in the config itself (items: Lane[]).
 *   ad-accounts        one lane per ad platform, with the account named in an accounts file
 *                      when there is one. An ad lane is an ad account on a platform, exactly as a social
 *                      lane is a social account on one. Whether a platform is armed to serve is
 *                      not Aircheck's business — it does not read arm flags for social lanes
 *                      either; it reviews what was built, and something else decides what runs. */

const PLATFORMS = new Set<Platform>(['x', 'linkedin', 'bluesky', 'threads', 'instagram', 'facebook', 'youtube', 'tiktok', 'peerlist', 'reddit', 'hackernews', 'substack', 'pinterest', 'google', 'microsoft']);
const asPlatform = (p: unknown): Platform => (PLATFORMS.has(p as Platform) ? (p as Platform) : 'other');

const PLATFORM_NAME: Record<string, string> = {
  x: 'X', linkedin: 'LinkedIn', bluesky: 'Bluesky', threads: 'Threads', instagram: 'Instagram', facebook: 'Facebook',
  youtube: 'YouTube', tiktok: 'TikTok', peerlist: 'Peerlist', reddit: 'Reddit', hackernews: 'Hacker News', substack: 'Substack', pinterest: 'Pinterest',
};
export const platformName = (p: string) => PLATFORM_NAME[p] || p;

const titleCase = (id: string) => id.split(/[-_]/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');

/* The ad platforms, and the placements each one takes. The format a renderer cut a creative for
 * is what assigns it to a lane, so this table is the mapping, and a catalog that names its own
 * platform overrides it. */
export const AD_PLATFORMS: { id: string; name: string; platform: Platform; formats: string[] }[] = [
  { id: 'google-search', name: 'Google Search', platform: 'google', formats: ['search-text'] },
  { id: 'youtube', name: 'YouTube', platform: 'youtube', formats: ['video-landscape-6s', 'video-landscape-15s', 'video-landscape-30s', 'video-long-landscape'] },
  { id: 'meta', name: 'Meta', platform: 'facebook', formats: ['carousel-square', 'carousel-feed', 'still-square', 'still-feed', 'video-portrait-15s', 'video-portrait-30s'] },
  { id: 'x', name: 'X', platform: 'x', formats: [] },
  { id: 'microsoft', name: 'Microsoft', platform: 'microsoft', formats: [] },
  { id: 'reddit', name: 'Reddit', platform: 'reddit', formats: [] },
  { id: 'linkedin-ads', name: 'LinkedIn', platform: 'linkedin', formats: ['document'] },
];

/** Which ad lane a creative belongs to: what it says, else the placement it was cut for. */
export function adLaneOf(format: string, named?: string): string {
  if (named) return named;
  return AD_PLATFORMS.find((p) => p.formats.includes(format))?.id || 'unassigned';
}

type AdAccounts = { bindings?: Record<string, string>; google?: { name?: string }; meta?: { businessName?: string } };

function adAccounts(cfg: SourceConfig): Lane[] {
  const file = expand(String(cfg.accounts || ''));
  const acct = readJson<AdAccounts>(file) || {};
  const who: Record<string, string | undefined> = {
    'google-search': acct.bindings?.googleCustomerId && `${acct.google?.name || 'Google Ads'} · ${acct.bindings.googleCustomerId}`,
    youtube: acct.bindings?.googleCustomerId && `${acct.google?.name || 'Google Ads'} · ${acct.bindings.googleCustomerId}`,
    meta: acct.bindings?.metaAdAccountId && `${acct.meta?.businessName || 'Meta'} · ${acct.bindings.metaAdAccountId}`,
  };
  /* A platform with specs but no account on file is still a lane: its creative exists and wants
   * reviewing. The handle simply says nothing rather than inventing an account. */
  return AD_PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    platform: p.platform,
    handle: who[p.id],
    brief: p.formats.length ? `Ad creative cut for ${p.formats.join(', ')}.` : 'Ad creative for this platform.',
    formats: [],
  }));
}

export function loadLanes(cfg: SourceConfig): Lane[] {
  if (cfg.source === 'ad-accounts') return adAccounts(cfg);
  if (cfg.source === 'static') {
    return ((cfg.items as Lane[]) || []).map((l) => ({ ...l, platform: asPlatform(l.platform), formats: (l.formats || []).map((f) => (typeof f === 'string' ? { id: f, label: titleCase(f) } : f)) }));
  }
  const plugin = pluginFor('lanes', cfg.source);
  if (plugin) return plugin(cfg, helpers());
  throw new Error(`Unknown lane source '${cfg.source}'`);
}
