import fs from 'node:fs';
import path from 'node:path';
import type { AdStatus, MediaRef, QueueStatus } from './types';
import { mediaKind } from './media';

/* THE MANIFEST. One JSON file per queued post. This is the whole contract between Aircheck and
 * whatever queued the post: an agent through the MCP server, or a cron job someone wired by hand
 * from the docs. Both write the same file, and nothing downstream can tell them apart.
 *
 *   <queue>/<YYYY-MM-DD>/<anything>.json
 *
 * The one rule that shapes everything else: a media entry is a SOURCE, not just a path. Aircheck
 * never holds media. A local source is served back to the browser by the local bridge; a URL is
 * loaded by the browser straight from wherever its owner keeps it. Either way the bytes never
 * pass through us, so this module resolves references and never reads image data.
 *
 * An ad creative is the SAME object with an `ad` block. Its presence is the only discriminator:
 * no `ad` is a post (Social, grouped by send hour, locked by the send rule); an `ad` is a creative
 * (Ads, grouped by run, locked by the approval rule). Each has its own status ladder, and a word
 * from the other ladder is a problem, said plainly, rather than a silent fallback. */

export type MediaSource = string | { path?: string; url?: string; alt?: string };

/** What makes a manifest an ad creative. `product` is what it is about; the rest is optional. */
export type AdBlock = {
  product: string;
  /** The placement it is cut for: carousel-feed, still-square, video-portrait-15s, search-text... */
  format?: string;
  /** The production run it belongs to. Creatives are grouped by it. */
  run?: string;
  /** A person signed off. Repair may only replace a creative that is not approved. */
  approved?: boolean;
  /** The recipe or script that built it, so Repair can re-run the real pipeline. */
  recipe?: string;
};

/** What makes a manifest an email. `subject` is required; the message is `html`, a source like a
 *  media entry (a path on this machine or a URL), and/or `text`. */
export type EmailBlock = {
  subject: string;
  from?: string;
  /** Addresses, or the name of the list it goes to. */
  to?: string | string[];
  replyTo?: string;
  preheader?: string;
  html?: MediaSource;
  text?: string;
};

export type Manifest = {
  lane: string;
  at?: string;
  kind?: string;
  title?: string;
  text?: string;
  media?: MediaSource[];
  status?: QueueStatus | AdStatus;
  ad?: AdBlock;
  email?: EmailBlock;
  postUrl?: string;
  url?: string;
  meta?: Record<string, unknown>;
};

export const POST_STATUSES: readonly QueueStatus[] = ['queued', 'sent', 'held', 'failed'];
export const AD_STATUSES: readonly AdStatus[] = ['draft', 'review', 'approved', 'live', 'archived'];
const list = (xs: readonly string[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/** Is this manifest an ad creative? The `ad` key alone decides, valid or not. */
export const isAd = (raw: unknown): boolean => !!raw && typeof raw === 'object' && 'ad' in (raw as object) && (raw as { ad?: unknown }).ad !== undefined;

/** Is this manifest an email? The `email` key alone decides. An email keeps a post's statuses. */
export const isEmail = (raw: unknown): boolean => !!raw && typeof raw === 'object' && (raw as { email?: unknown }).email !== undefined;

function emailProblems(e: unknown, where: string): string[] {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return [`${where}"email" must be an object with at least a "subject", or be left out for a post`];
  const x = e as Record<string, unknown>;
  const out: string[] = [];
  if (typeof x.subject !== 'string' || !x.subject.trim()) out.push(`${where}"email.subject" is required and must be the subject line`);
  for (const k of ['from', 'replyTo', 'preheader', 'text'] as const) if (x[k] !== undefined && typeof x[k] !== 'string') out.push(`${where}"email.${k}" must be a string, or be left out`);
  if (x.to !== undefined && typeof x.to !== 'string' && !(Array.isArray(x.to) && x.to.every((t) => typeof t === 'string'))) out.push(`${where}"email.to" must be an address, a list name, or a list of them`);
  if (x.html !== undefined) {
    const h = x.html as MediaSource;
    if (typeof h === 'string' ? !h.trim() : !h || typeof h !== 'object' || (!h.path && !h.url)) out.push(`${where}"email.html" must be the path or URL of the rendered message`);
  }
  if (x.html === undefined && x.text === undefined) out.push(`${where}"email" needs the message: "html" (a path or URL) or "text"`);
  return out;
}

/* The status word, checked against the shape it sits on. A word from the other ladder gets a
 * message that names both ways out, because that is the mistake people actually make. */
function statusProblem(m: Record<string, unknown>, where: string): string | null {
  if (m.status === undefined) return null;
  const ad = isAd(m);
  const mine: readonly string[] = ad ? AD_STATUSES : POST_STATUSES;
  const other: readonly string[] = ad ? POST_STATUSES : AD_STATUSES;
  if (mine.includes(m.status as string)) return null;
  if (other.includes(m.status as string)) {
    return ad
      ? `${where}"status" is "${m.status}", which is a post's status, but this manifest has an "ad" block. A creative's status is ${list(AD_STATUSES)}. Remove the "ad" block if this is a post`
      : `${where}"status" is "${m.status}", which is an ad creative's status, but this manifest has no "ad" block. A post's status is ${list(POST_STATUSES)}. Add an "ad" block with a "product" if this is a creative`;
  }
  return `${where}"status" must be one of ${list(mine)}${ad ? ' for an ad creative' : ''}`;
}

function adProblems(ad: unknown, where: string): string[] {
  if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return [`${where}"ad" must be an object with at least a "product", or be left out for a post`];
  const a = ad as Record<string, unknown>;
  const out: string[] = [];
  if (typeof a.product !== 'string' || !a.product.trim()) out.push(`${where}"ad.product" is required and must name what the creative is about`);
  for (const k of ['format', 'run', 'recipe'] as const) if (a[k] !== undefined && (typeof a[k] !== 'string' || !(a[k] as string).trim())) out.push(`${where}"ad.${k}" must be a non-empty string, or be left out`);
  if (a.approved !== undefined && typeof a.approved !== 'boolean') out.push(`${where}"ad.approved" must be true or false`);
  return out;
}
const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** Everything wrong with a manifest, in the words a person fixing it needs. Empty means valid. */
export function manifestProblems(raw: unknown, file?: string): string[] {
  const where = file ? `${path.basename(file)}: ` : '';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [`${where}not a JSON object`];
  const m = raw as Record<string, unknown>;
  const out: string[] = [];
  if (typeof m.lane !== 'string' || !m.lane.trim()) out.push(isAd(m) ? `${where}"lane" is required and must name the ad platform or account this creative runs on` : `${where}"lane" is required and must name the lane this goes out on`);
  if (m.at !== undefined && (typeof m.at !== 'string' || Number.isNaN(Date.parse(m.at)))) out.push(`${where}"at" must be an ISO 8601 time, or be left out for an unscheduled post`);
  const status = statusProblem(m, where);
  if (status) out.push(status);
  if (isAd(m)) out.push(...adProblems(m.ad, where));
  if (isEmail(m)) {
    if (isAd(m)) out.push(`${where}a manifest is an ad creative or an email, not both`);
    out.push(...emailProblems(m.email, where));
  }
  if (m.media !== undefined && !Array.isArray(m.media)) out.push(`${where}"media" must be a list`);
  else for (const [i, entry] of (m.media as MediaSource[] | undefined || []).entries()) {
    if (typeof entry === 'string') { if (!entry.trim()) out.push(`${where}media[${i}] is empty`); continue; }
    if (!entry || typeof entry !== 'object') { out.push(`${where}media[${i}] must be a path, a URL or an object`); continue; }
    if (!entry.path && !entry.url) out.push(`${where}media[${i}] needs a "path" or a "url"`);
  }
  if (m.text !== undefined && typeof m.text !== 'string') out.push(`${where}"text" must be the post copy as a string`);
  if (m.status === 'sent' && m.postUrl !== undefined && m.postUrl !== null && typeof m.postUrl !== 'string') out.push(`${where}"postUrl" must be the permalink as a string`);
  return out;
}

export const isManifest = (raw: unknown): raw is Manifest => manifestProblems(raw).length === 0;

/* A media entry resolved to something the browser can actually fetch.
 *   local  an absolute path on the machine that queued the post. The browser asks the local
 *          bridge (or this app's own /api/media) for it; the allow-list decides.
 *   url    the owner's own storage. The browser loads it directly and we are not involved. */
export type Resolved = MediaRef & { src: 'local' | 'url'; alt?: string; missing?: boolean };

/** Resolve one entry against the folder its manifest sits in. Relative paths are relative to it. */
export function resolveSource(entry: MediaSource, dir: string, onDisk = true): Resolved | null {
  const o = typeof entry === 'string' ? { path: entry } : entry;
  const raw = (o.url || o.path || '').trim();
  if (!raw) return null;
  if (isUrl(raw)) return { path: raw, kind: mediaKind(new URL(raw).pathname), src: 'url', alt: o.alt };
  const abs = path.isAbsolute(raw) ? raw : path.join(dir, raw);
  return { path: abs, kind: mediaKind(abs), src: 'local', alt: o.alt, missing: onDisk ? !fs.existsSync(abs) : false };
}

/* Resolve a manifest's media. A local file that is not on disk is REPORTED, never dropped: a post
 * whose slides are gone is exactly what a person opens Aircheck to find out. A URL is taken at its
 * word, because checking it would mean fetching someone else's media from our server. */
/* onDisk=false is the hosted read: the files are on the machine that queued the post, not this
 * server, so a local path is taken at its word and the browser asks that machine's bridge for it. */
export function resolveMedia(media: MediaSource[] | undefined, dir: string, onDisk = true): { media: Resolved[]; missing: string[] } {
  const all = (media || []).map((e) => resolveSource(e, dir, onDisk)).filter((r): r is Resolved => !!r);
  return { media: all.filter((r) => !r.missing), missing: all.filter((r) => r.missing).map((r) => r.path) };
}

/** What a post is, when the manifest does not say: from how much media it carries. */
export const inferKind = (m: Manifest, n: number) => m.kind || (n > 1 ? 'carousel' : n === 1 ? 'image' : 'text');

/** The manifest as the MCP server and the docs write it: stable key order, trailing newline. */
export function serialize(m: Manifest): string {
  const ordered: Manifest = {
    lane: m.lane, at: m.at, kind: m.kind, title: m.title, text: m.text,
    media: m.media, status: m.status || (m.ad ? 'draft' : 'queued'), ad: m.ad, email: m.email, postUrl: m.postUrl, url: m.url, meta: m.meta,
  };
  const clean = Object.fromEntries(Object.entries(ordered).filter(([, v]) => v !== undefined));
  return JSON.stringify(clean, null, 2) + '\n';
}

/** <queue>/<YYYY-MM-DD>/<id>.json — the one place a manifest ever lives. */
export const manifestPath = (queue: string, day: string, id: string) =>
  path.join(queue, day, `${id.replace(/[^a-z0-9._-]/gi, '-').replace(/\.{2,}/g, '-').replace(/^[.-]+/, '') || 'post'}.json`);

/** The day a post belongs to, in the lane's timezone, from its send time. */
export function dayOf(at: string | undefined, tz: string) {
  const d = at ? new Date(at) : new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
