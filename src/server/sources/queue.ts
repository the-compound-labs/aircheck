import fs from 'node:fs';
import path from 'node:path';
import { expand, readJson, type Config, type SourceConfig } from '../config';
import { helpers, pluginFor } from '../plugins';
import { store } from '../account';
import { hostedDb } from '../db';
import { inferKind, isAd, manifestProblems, resolveMedia, resolveSource, type EmailBlock, type Manifest } from '../manifest';
import { adFromManifest } from './ads';
import type { AdCreative, QueueItem, QueueStatus } from '../types';

/* QUEUE SOURCES: what is planned for a day, with its media.
 *   folder   <dir>/<YYYY-MM-DD>/*.json, one file per post. The portable contract: any agent, cron
 *            or Airflow task that drops a file there shows up. Schema in README.
 * Any other source name comes from a plugin (see ../plugins.ts), for a planner that keeps its own
 * files and that you would rather read as they are than export to the folder. */

/* THE MANIFEST FOLDER. One JSON file per post, the whole contract with whoever queued it — the MCP
 * server, or a job someone wired by hand from the docs. Both write the same file.
 *
 * Media is resolved, not read: a local file comes back as a path the browser asks the media
 * endpoint for, a URL comes back untouched for the browser to load from its owner's storage. A
 * local file the manifest names but that is not on disk is reported as missing, never dropped,
 * because a post whose slides are gone is the thing a person opens Aircheck to catch. */
/* An email's message, resolved the way media is: a path for the bridge or a URL, never read. */
export function emailOf(e: EmailBlock | undefined, dir: string, onDisk = true): QueueItem['email'] {
  if (!e) return undefined;
  const html = e.html ? resolveSource(e.html, dir, onDisk) : null;
  return {
    subject: e.subject, from: e.from, replyTo: e.replyTo, preheader: e.preheader, text: e.text,
    to: e.to === undefined ? undefined : Array.isArray(e.to) ? e.to : [e.to],
    ...(html ? { html } : {}),
  };
}

/* An email is a queued item whose "copy" is its subject and preheader, so every list, search and
 * card that reads title and text reads an email without knowing it is one. */
const emailFields = (m: Manifest, dir: string, onDisk = true) => (m.email ? {
  email: emailOf(m.email, dir, onDisk), kind: 'email', title: m.title || m.email.subject, text: m.text || m.email.preheader || m.email.text?.slice(0, 280),
} : {});

function folder(cfg: SourceConfig, day: string): QueueItem[] {
  const dir = path.join(expand(String(cfg.dir)), day);
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out: QueueItem[] = [];
  for (const n of names) {
    const file = path.join(dir, n);
    const raw = readJson<Manifest>(file);
    /* A manifest with an `ad` block is a creative, reviewed in Ads by the ad-folder source. The
     * block alone decides, so one folder can hold both and neither scope shows the other's. */
    if (isAd(raw)) continue;
    /* A manifest that does not parse is surfaced as a failed post carrying its own errors, so a
     * typo in a job shows up in the UI instead of silently emptying the day. */
    const problems = manifestProblems(raw, file);
    if (problems.length) {
      if (!raw || typeof raw !== 'object') continue;
      out.push({
        id: `${day}:${n}`, lane: (raw as Manifest).lane || 'unassigned', kind: 'text',
        title: 'This manifest is not valid', text: problems.join('\n'), media: [], status: 'failed',
        source: 'folder', origin: { kind: 'folder', path: file }, meta: { problems },
      });
      continue;
    }
    const it = raw as Manifest;
    const { media, missing } = resolveMedia(it.media, dir);
    out.push({
      id: `${day}:${n}`, lane: it.lane, at: it.at, kind: inferKind(it, media.length),
      title: it.title, text: it.text, url: it.url, media, status: (it.status as QueueStatus) || 'queued',
      postUrl: it.postUrl, source: 'folder', origin: { kind: 'folder', path: file },
      ...(missing.length ? { missing } : {}), meta: it.meta, ...emailFields(it, dir),
    });
  }
  return out;
}

/* Replace is refused on a post that is sent, held, or due within this many minutes: the sender
 * may be reading its files. */
export const LOCK_MINUTES = 6;
export function lockOf(it: QueueItem, now = Date.now()): string {
  if (it.status === 'sent') return 'Already sent. Repair cannot replace a sent post.';
  if (it.status === 'held') return 'Held by the sender for review. Repair cannot replace it.';
  if (it.origin?.kind !== 'folder' && !pluginFor('replace', it.origin?.kind || '')) return 'This producer does not support Replace yet. Repair shows the fix only.';
  if (it.at && Date.parse(it.at) - now < LOCK_MINUTES * 60000) return Date.parse(it.at) <= now ? 'Due now. The sender may be sending it.' : `Sends in under ${LOCK_MINUTES} minutes. Replace is locked.`;
  return '';
}

export function loadQueue(sources: SourceConfig[], day: string): QueueItem[] {
  const all: QueueItem[] = [];
  for (const s of sources) {
    if (s.source === 'folder') { all.push(...folder(s, day)); continue; }
    const plugin = pluginFor('queue', s.source);
    if (!plugin) throw new Error(`Unknown queue source '${s.source}'`);
    all.push(...plugin.load(s, day, helpers()));
  }
  for (const it of all) { it.day = day; it.lock = lockOf(it); }
  return all.sort((a, b) => (a.at || '9').localeCompare(b.at || '9'));
}

/** Days that have anything queued, newest first (for the day picker). */
export function queueDays(sources: SourceConfig[]): string[] {
  const days = new Set<string>();
  for (const s of sources) {
    try { for (const d of fs.readdirSync(expand(String(s.dir)))) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days.add(d); } catch { /* source dir absent */ }
  }
  return [...days].sort().reverse();
}

/** When each source last changed for the day: the "Day plan read" line. */
export function queueReadAt(sources: SourceConfig[], day: string): string | undefined {
  let t = 0;
  for (const s of sources) {
    const own = s.source === 'folder' ? undefined : pluginFor('queue', s.source)?.readAt;
    if (own) { const at = own(s, day, helpers()); if (at) t = Math.max(t, Date.parse(at)); continue; }
    try { t = Math.max(t, fs.statSync(path.join(expand(String(s.dir)), day)).mtimeMs); } catch { /* source absent */ }
  }
  return t ? new Date(t).toISOString() : undefined;
}

/* THE ACCOUNT SOURCE. The same manifests, read from the account instead of off disk — this is what
 * the hosted site reads. Media references come through untouched: a URL stays a URL for the browser
 * to load from its owner's storage, and a local path stays a path for the media bridge on the
 * machine that queued it. Aircheck holds neither. */
export async function loadAccountQueue(cfg: Config, account: string, day: string): Promise<QueueItem[]> {
  const rows = await store(cfg).list(account, day);
  const out: QueueItem[] = [];
  for (const rec of rows) {
    const m = rec.manifest;
    if (isAd(m)) continue;
    const dir = rec.origin ? path.dirname(rec.origin) : '';
    const { media, missing } = resolveMedia(m.media, dir, !hostedDb());
    out.push({
      id: `${rec.day}:${rec.id}`, lane: m.lane, at: m.at, kind: inferKind(m, media.length),
      title: m.title, text: m.text, url: m.url, media, status: (m.status as QueueStatus) || 'queued', postUrl: m.postUrl,
      source: 'account', day: rec.day,
      origin: rec.origin ? { kind: 'folder', path: rec.origin } : { kind: 'other' },
      ...(missing.length ? { missing } : {}), meta: m.meta, ...emailFields(m, dir, !hostedDb()),
    });
  }
  return out;
}

/** The day's ad creatives that synced to the account: the same manifests, with an `ad` block. */
export async function loadAccountAds(cfg: Config, account: string, day: string): Promise<AdCreative[]> {
  const rows = await store(cfg).list(account, day);
  return rows.filter((rec) => isAd(rec.manifest)).map((rec) => adFromManifest(rec.manifest, {
    file: rec.origin, dir: rec.origin ? path.dirname(rec.origin) : '', name: rec.id, source: 'account', day: rec.day, createdAt: rec.updatedAt, onDisk: !hostedDb(),
  }));
}
