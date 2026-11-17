import type { MediaRef, QueueItem } from '@/server/types';

/* PREFLIGHT. What a platform would reject or quietly spoil, checked before the post goes out:
 * the caption against the platform's limit, how many files it takes, alt text, links that will not
 * be clickable, and the image's shape against what the feed shows. Limits are each platform's
 * published caps; a platform not listed gets the generic checks only. */

type Rule = { name: string; chars?: number; files?: number; ratio?: [number, number]; ratioLabel?: string; alt?: boolean; deadLinks?: boolean; fold?: number; frame?: string };

export const RULES: Record<string, Rule> = {
  instagram: { name: 'Instagram', chars: 2200, files: 20, ratio: [0.8, 1.91], ratioLabel: '4:5 to 1.91:1', alt: true, deadLinks: true, fold: 125, frame: '4 / 5' },
  facebook: { name: 'Facebook', chars: 63206, files: 30, alt: true, fold: 240, frame: '4 / 5' },
  threads: { name: 'Threads', chars: 500, files: 20, alt: true, frame: '4 / 5' },
  x: { name: 'X', chars: 280, files: 4, alt: true, frame: '16 / 9' },
  bluesky: { name: 'Bluesky', chars: 300, files: 4, alt: true, frame: '16 / 9' },
  linkedin: { name: 'LinkedIn', chars: 3000, files: 20, alt: true, fold: 210, frame: '4 / 5' },
  tiktok: { name: 'TikTok', chars: 2200, files: 35, ratio: [0.5, 0.6], ratioLabel: '9:16', deadLinks: true, fold: 100, frame: '9 / 16' },
  pinterest: { name: 'Pinterest', chars: 500, files: 5, ratio: [0.6, 0.8], ratioLabel: '2:3', alt: true, fold: 100, frame: '2 / 3' },
  youtube: { name: 'YouTube', chars: 5000, fold: 100, frame: '16 / 9' },
};

export type Check = { id: string; label: string; ok: boolean; detail: string; fix?: string };

const visual = (m: MediaRef) => m.kind === 'image' || m.kind === 'video';
const fmt = (n: number) => n.toLocaleString('en-US');

/** The checks that need nothing but the post itself. */
export function quickChecks(item: QueueItem, platform: string): Check[] {
  const r = RULES[platform];
  const out: Check[] = [];
  const text = item.text || '';
  const files = item.media.filter(visual);
  if (item.missing?.length) out.push({ id: 'files', label: `${item.missing.length} ${item.missing.length === 1 ? 'file is' : 'files are'} missing`, ok: false, detail: 'gone', fix: `Rebuild the ${item.missing.length} missing ${item.missing.length === 1 ? 'file' : 'files'}` });
  if (!r) return out;
  if (r.chars) {
    const n = [...text].length;
    out.push({ id: 'chars', label: 'Caption length', ok: n <= r.chars, detail: `${fmt(n)} / ${fmt(r.chars)}`, fix: n > r.chars ? `Shorten the caption to ${fmt(r.chars)} characters or fewer for ${r.name}` : undefined });
  }
  if (r.files && files.length > r.files) out.push({ id: 'count', label: `${r.name} takes ${r.files} files at most`, ok: false, detail: `${files.length}`, fix: `Cut the post to ${r.files} files for ${r.name}` });
  if (r.alt) {
    const bare = item.media.findIndex((m) => m.kind === 'image' && !m.alt);
    if (bare >= 0) out.push({ id: 'alt', label: `Alt text missing on slide ${bare + 1}`, ok: false, detail: '', fix: 'Write alt text for every image' });
    else if (files.some((m) => m.kind === 'image')) out.push({ id: 'alt', label: 'Alt text', ok: true, detail: 'every image' });
  }
  if (r.deadLinks) {
    const link = /https?:\/\/\S+/.test(text);
    out.push({ id: 'link', label: `Links in the caption are not clickable on ${r.name}`, ok: !link, detail: link ? 'has a link' : 'none', fix: link ? `Move the link out of the caption; ${r.name} does not make it clickable` : undefined });
  }
  return out;
}

/** The first problem worth a flag on a tile, or none. */
export function tileFlag(item: QueueItem, platform: string): string | null {
  if (item.status === 'sent') return null;
  const bad = quickChecks(item, platform).find((c) => !c.ok);
  if (!bad) return null;
  return bad.id === 'files' ? 'Files' : bad.id === 'alt' ? 'Alt text' : bad.id === 'chars' ? 'Too long' : bad.id === 'link' ? 'Link' : 'Files';
}

/** Clean means a person could approve it without opening it. */
export const isClean = (item: QueueItem, platform: string) => quickChecks(item, platform).every((c) => c.ok);
