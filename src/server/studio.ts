import { loadConfig, today } from './config';
import { loadLanes } from './sources/lanes';
import { loadProducts } from './sources/products';
import { loadQueue, loadAccountQueue, loadAccountAds, queueDays, queueReadAt } from './sources/queue';
import { adLockOf, loadAds } from './sources/ads';
import { loadLogos, withLogos } from './lane-logos';
import type { Lane, Platform, QueueItem } from './types';
import { withReviews } from './review';

/* Everything a page needs in one read.
 *
 * The queue comes from whichever source this install is set up for. An account reads the manifests
 * that synced to it — that is the hosted path, and the one the MCP server feeds. Without an
 * account it reads them straight off disk, which is the same manifests a folder away. Media is a
 * reference either way: Aircheck resolves it and never holds it. */
export async function studioAsync(day?: string, account?: string | null) {
  const s = studio(day);
  /* Whoever is signed in owns the day. An install with no sign-in falls back to the single
   * configured account, which is the local case. */
  const id = account || s.cfg.account?.id;
  if (!id) return s;
  const [fromAccount, adsFromAccount] = await Promise.all([loadAccountQueue(s.cfg, id, s.day), loadAccountAds(s.cfg, id, s.day)]);
  /* The account is authoritative when it has the day; disk is the fallback so a machine that has
   * not synced yet still shows its own queue. Creatives that synced join the ones on disk; the same
   * creative read both ways is shown once. */
  const seen = new Set(s.ads.map((c) => c.id));
  const ads = [...s.ads, ...adsFromAccount.filter((c) => !seen.has(c.id)).map((c) => ({ ...c, lock: adLockOf(c) }))];
  /* A lane the account's posts name but no local config describes (always the case on aircheck.dev)
   * is drawn from the posts themselves: the platform a manifest's meta names, else the one its
   * lane id names (brand-x, brand-instagram), else Other. */
  const known = new Set(s.lanes.map((l) => l.id));
  /* Only posts make lanes. Email senders are drawn on the Email pages by senders(), from the emails. */
  const extra = [...new Map(fromAccount.filter((i) => !i.email && !known.has(i.lane)).map((i) => [i.lane, laneFrom(i)])).values()];
  const all = fromAccount.length ? fromAccount : [...s.queue, ...s.emails];
  /* The email template registry has no day: it lives under the key "templates", on disk and in the
   * account, and the account's copy wins where both have one. */
  const fromAccountTpl = (await loadAccountQueue(s.cfg, id, TEMPLATES)).filter((i) => i.email);
  const tplIds = new Set(fromAccountTpl.map((t) => t.id));
  const templates = [...fromAccountTpl, ...s.templates.filter((t) => !tplIds.has(t.id))];
  const logos = await loadLogos(s.cfg, id);
  return { ...s, ...split(withReviews(s.cfg, all)), templates, lanes: withLogos([...s.lanes, ...extra], logos), ads };
}

const PLATFORM_WORDS: [RegExp, Platform][] = [
  [/(^|[-_])(x|twitter)$/, 'x'], [/linkedin|(^|[-_])li$/, 'linkedin'], [/bluesky|bsky/, 'bluesky'], [/threads/, 'threads'],
  [/instagram|(^|[-_])ig$/, 'instagram'], [/facebook|(^|[-_])fb$/, 'facebook'], [/youtube|(^|[-_])yt$/, 'youtube'],
  [/tiktok/, 'tiktok'], [/peerlist/, 'peerlist'], [/reddit/, 'reddit'], [/hackernews|(^|[-_])hn$/, 'hackernews'],
  [/substack/, 'substack'], [/pinterest/, 'pinterest'],
];

/** The key the email template registry lives under, in place of a day. */
export const TEMPLATES = 'templates';

/* Posts are Social and emails are Email: one queue, two reviews, split by the `email` block. */
const split = (all: QueueItem[]) => ({ queue: all.filter((i) => !i.email), emails: all.filter((i) => i.email) });

function laneFrom(item: QueueItem): Lane {
  if (item.email) return { id: item.lane, name: item.lane, platform: 'email', formats: [] };
  const named = String((item.meta as { platform?: string } | undefined)?.platform || '').toLowerCase();
  const id = item.lane.toLowerCase();
  const platform = (PLATFORM_WORDS.find(([re]) => re.test(named))?.[1]) || (PLATFORM_WORDS.find(([re]) => re.test(id))?.[1]) || ('other' as Platform);
  return { id: item.lane, name: item.lane, platform, formats: [] };
}

export function studio(day?: string) {
  const cfg = loadConfig();
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today(cfg.timezone);
  return {
    cfg,
    day: d,
    today: today(cfg.timezone),
    lanes: loadLanes(cfg.lanes),
    products: loadProducts(cfg.products),
    ...split(withReviews(cfg, loadQueue(cfg.queue, d))),
    templates: loadQueue(cfg.queue, TEMPLATES).filter((i) => i.email),
    ads: loadAds(cfg.ads),
    days: queueDays(cfg.queue),
    readAt: queueReadAt(cfg.queue, d),
    agents: Object.keys(cfg.agents.commands),
    defaultAgent: cfg.agents.default,
  };
}

/** The day before `day`, as YYYY-MM-DD. */
const dayBefore = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

/* THE LAST SEVEN DAYS, per lane: how many posts each lane queued on each day, oldest first, read
 * from the same place Today reads (the account when one is signed in, else disk). The Lanes page
 * draws it as seven small bars. Emails are not posts and are left out. */
export async function laneWeek(day: string, account?: string | null): Promise<{ days: string[]; counts: Record<string, number[]> }> {
  const cfg = loadConfig();
  const id = account || cfg.account?.id;
  const days = Array.from({ length: 7 }, (_, k) => dayBefore(day, 6 - k));
  const per = await Promise.all(days.map(async (d) => {
    const remote = id ? await loadAccountQueue(cfg, id, d).catch(() => [] as QueueItem[]) : [];
    return (remote.length ? remote : loadQueue(cfg.queue, d)).filter((i) => !i.email);
  }));
  const counts: Record<string, number[]> = {};
  per.forEach((items, k) => { for (const i of items) { (counts[i.lane] ||= Array(7).fill(0))[k] += 1; } });
  return { days, counts };
}
