import type { MediaRef } from '@/server/types';

/* Client-safe helpers shared by every view. */

/* Glyph and colour per platform, as riff 4 draws them (riffs.html P table). */
export const PLATFORM: Record<string, { label: string; icon: string; color: string }> = {
  x: { label: 'X', icon: 'ph-x-logo', color: '#18181b' },
  linkedin: { label: 'LinkedIn', icon: 'ph-linkedin-logo', color: '#0a66c2' },
  bluesky: { label: 'Bluesky', icon: 'ph-butterfly', color: '#1185fe' },
  threads: { label: 'Threads', icon: 'ph-threads-logo', color: '#18181b' },
  instagram: { label: 'Instagram', icon: 'ph-instagram-logo', color: '#e1306c' },
  facebook: { label: 'Facebook', icon: 'ph-facebook-logo', color: '#1877f2' },
  youtube: { label: 'YouTube', icon: 'ph-youtube-logo', color: '#ff0033' },
  tiktok: { label: 'TikTok', icon: 'ph-tiktok-logo', color: '#18181b' },
  peerlist: { label: 'Peerlist', icon: 'ph-users-three', color: '#00aa45' },
  reddit: { label: 'Reddit', icon: 'ph-reddit-logo', color: '#ff4500' },
  hackernews: { label: 'Hacker News', icon: 'ph-newspaper', color: '#ff6600' },
  substack: { label: 'Substack', icon: 'ph-envelope-simple', color: '#ff6719' },
  pinterest: { label: 'Pinterest', icon: 'ph-pinterest-logo', color: '#e60023' },
  google: { label: 'Google', icon: 'ph-google-logo', color: '#4285f4' },
  microsoft: { label: 'Microsoft', icon: 'ph-windows-logo', color: '#0078d4' },
  email: { label: 'Email', icon: 'ph-envelope-simple', color: '#e11d2a' },
  other: { label: 'Other', icon: 'ph-globe-simple', color: '#71717a' },
};
export const platform = (p: string) => PLATFORM[p] || PLATFORM.other;

/* Where the browser actually fetches a media reference. A URL is the owner's own storage and is
 * loaded straight from it — Aircheck never proxies media. Anything else is a file on the machine
 * that queued it: locally the app serves it through /api/media from an allow-listed root; on
 * aircheck.dev the browser asks the media bridge the user's MCP server runs, by a direct URL. */
export const BRIDGE = 'http://127.0.0.1:3327';
const bridge = (): string => (typeof window === 'undefined'
  ? (process.env.AIRCHECK_DB === 'supabase' ? BRIDGE : '')
  : ((window as unknown as { __AIRCHECK_BRIDGE?: string }).__AIRCHECK_BRIDGE || ''));
/** Where this machine's own API is: the bridge on aircheck.dev, the app itself locally. */
export const machineBase = (): string => bridge();
const localUrl = (p: string) => { const b = bridge(); return b ? `${b}/media?p=${encodeURIComponent(p)}` : `/api/media?p=${encodeURIComponent(p)}`; };
export const mediaUrl = (p: string | MediaRef) => {
  if (typeof p !== 'string') return p.src === 'url' ? p.path : localUrl(p.path);
  return /^https?:\/\//i.test(p) ? p : localUrl(p);
};

export function clock(iso: string | undefined, tz: string) {
  if (!iso) return 'Unscheduled';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function longDay(day: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
}

/* Fractional hour of the day (0-24) of an instant, in the timezone. */
export function hourOf(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const h = Number(parts.find((x) => x.type === 'hour')?.value || 0);
  const m = Number(parts.find((x) => x.type === 'minute')?.value || 0);
  return h + m / 60;
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

export const KIND_LABEL: Record<string, string> = { email: 'Email',
  reelcarousel: 'Carousel', carousel: 'Carousel', image: 'Image', video: 'Video', text: 'Text', thread: 'Thread',
  story: 'Story', longform: 'Long-form', roundup: 'Roundup', article: 'Article', post: 'Post',
};
export const kindLabel = (k?: string) => (k ? KIND_LABEL[k] || k[0].toUpperCase() + k.slice(1) : 'Post');

/* "Compound Labs · Bluesky" -> "Bluesky", "Founder · Threads" -> "Founder Threads": the short lane
 * name riff 4 puts under a ring and on a tile. */
export const shortLane = (n: string) => n.replace('Compound Labs · ', '').replace('Compound Labs ', '').replace('Founder · ', 'Founder ');

export function clockShort(iso: string | undefined, tz: string) {
  return clock(iso, tz).replace(/\s?[AP]M$/, '');
}

/** How long ago something finished, the way a person says it: "just now", "4 min", "2 h", "3 d". */
export function since(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
