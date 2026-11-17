import fs from 'node:fs';
import path from 'node:path';
import { expand, readJson, type SourceConfig } from '../config';
import { helpers, pluginFor } from '../plugins';
import { ref } from '../media';
import { inferKind, isAd, manifestProblems, resolveMedia, type AdBlock, type Manifest } from '../manifest';
import type { AdCreative, AdKind, AdStatus, QueueItem } from '../types';
import { adLaneOf } from './lanes';

/* AD MEDIA SOURCES: the creative an ad pipeline has built, with its files.
 *   ad-catalog  <dir>/<product>/<run>/catalog.json, the manifest a render writes. One creative per
 *               asset in that catalog.
 *   ad-folder   <dir>/*.json and <dir>/<YYYY-MM-DD>/*.json. The portable contract: the SAME manifest
 *               a post is, with an `ad` block. Any renderer that drops one there shows up. A file
 *               without `ad` is a post and is skipped here. Schema in docs/aircheck-spec.md.
 *
 * Any other source name comes from a plugin (see ../plugins.ts). A plugin's creative may carry its
 * own `lock`, which wins over the one worked out here.
 *
 * A creative is reviewed, not scheduled. It has no send time; it has a stage and an approval, and
 * Repair may replace it only while nobody has approved it yet. */

const KINDS = new Set<AdKind>(['carousel', 'image', 'video', 'document', 'text']);
const asKind = (k: unknown): AdKind => (KINDS.has(k as AdKind) ? (k as AdKind) : 'image');

function exists(p?: string) { return !!p && fs.existsSync(p); }

/* The producer's own words for where a creative is, mapped onto the ladder the UI draws. A catalog
 * that says a person approved it is approved whatever its stage says. */
function statusOf(stage: unknown, approved: boolean, raw?: unknown): AdStatus {
  if (raw === 'live' || raw === 'archived' || raw === 'approved' || raw === 'review' || raw === 'draft') return raw;
  if (approved) return 'approved';
  const s = String(stage || '');
  if (/live|launched|serving/i.test(s)) return 'live';
  if (/archiv|retired/i.test(s)) return 'archived';
  if (/review/i.test(s)) return 'review';
  return 'draft';
}

type CatalogAsset = { id?: string; kind?: string; format?: string; title?: string; text?: string; files?: { file?: string }[] };
type Catalog = {
  product?: string;
  createdAt?: string;
  stage?: string;
  userApproved?: boolean;
  status?: string;
  revision?: string | null;
  fanout?: boolean;
  assets?: CatalogAsset[];
  copySource?: { file?: string };
};

function catalogDir(dir: string, product: string, run: string, source: string): AdCreative[] {
  const home = path.join(dir, product, run);
  const file = path.join(home, 'catalog.json');
  const cat = readJson<Catalog>(file);
  if (!cat?.assets?.length) return [];
  const approved = cat.userApproved === true;
  const out: AdCreative[] = [];
  for (const a of cat.assets) {
    if (!a?.id) continue;
    /* A catalog names its files relative to its own folder. A text ad names none; it is still a
     * creative a person reviews, so it is listed with its copy and no media. */
    const named = (a.files || []).map((f) => f?.file).filter((f): f is string => !!f).map((f) => (path.isAbsolute(f) ? f : path.join(home, f)));
    const present = named.filter(exists);
    const missing = named.filter((f) => !exists(f));
    out.push({
      id: `${product}/${run}/${a.id}`,
      product: cat.product || product,
      run,
      assetId: a.id,
      kind: asKind(a.kind),
      format: a.format || String(a.kind || 'image'),
      title: a.title,
      text: a.text,
      media: present.map(ref),
      status: statusOf(cat.stage, approved, cat.status),
      stage: cat.stage,
      approved,
      ...(missing.length ? { missing } : {}),
      source,
      origin: { kind: 'ad-catalog', path: file, dir: home },
      recipe: cat.copySource?.file,
      createdAt: cat.createdAt,
      meta: { revision: cat.revision ?? undefined, fanout: cat.fanout, files: named.length },
    });
  }
  return out;
}

function adCatalog(cfg: SourceConfig): AdCreative[] {
  const dir = expand(String(cfg.dir));
  let products: string[] = [];
  try { products = fs.readdirSync(dir).filter((p) => !p.startsWith('.')); } catch { return []; }
  const only = Array.isArray(cfg.products) ? new Set((cfg.products as string[]).map(String)) : null;
  const out: AdCreative[] = [];
  for (const product of products) {
    if (only && !only.has(product)) continue;
    let runs: string[] = [];
    try { runs = fs.readdirSync(path.join(dir, product)).filter((r) => !r.startsWith('.')); } catch { continue; }
    for (const run of runs) out.push(...catalogDir(dir, product, run, 'ad-catalog'));
  }
  return out;
}

/* AN AD MANIFEST: the same file a post is, with an `ad` block. This turns one into a creative.
 * Shared by the folder (read off disk) and the account (read from what synced). Media resolves by
 * the manifest rules: a relative path against the file's folder, a URL left for the browser. */
export function adFromManifest(m: Manifest, o: { file?: string; dir: string; name: string; source: string; day?: string; createdAt?: string; problems?: string[]; onDisk?: boolean }): AdCreative {
  const block: Partial<AdBlock> = m.ad && typeof m.ad === 'object' ? m.ad : {};
  const product = typeof block.product === 'string' && block.product.trim() ? block.product : 'unassigned';
  const { media, missing } = o.problems?.length ? { media: [], missing: [] } : resolveMedia(m.media, o.dir, o.onDisk ?? true);
  const assetId = o.name.replace(/\.json$/, '');
  const run = block.run || o.day || 'folder';
  const approved = block.approved === true;
  const kind = asKind(inferKind(m, media.length));
  return {
    id: `${product}/${run}/${assetId}`,
    lane: typeof m.lane === 'string' && m.lane.trim() ? m.lane : undefined,
    product,
    run,
    assetId,
    kind,
    format: block.format || kind,
    title: o.problems?.length ? 'This manifest is not valid' : m.title,
    text: o.problems?.length ? o.problems.join('\n') : m.text,
    media,
    status: statusOf(undefined, approved, m.status),
    approved,
    ...(missing.length ? { missing } : {}),
    source: o.source,
    origin: o.file ? { kind: 'ad-folder', path: o.file, dir: o.dir } : { kind: 'other' },
    recipe: block.recipe,
    createdAt: m.at || o.createdAt,
    meta: { ...(m.meta || {}), ...(o.problems?.length ? { problems: o.problems } : {}) },
  };
}

/* The folder: the same manifests the queue reads, told apart by the `ad` block alone. It reads
 * <dir>/*.json and <dir>/<YYYY-MM-DD>/*.json, so it can point at its own folder or at the queue
 * itself. A file with no `ad` is a post and belongs to Social, so it is left alone here. A file
 * WITH one that does not validate is still shown, carrying its problems, so a typo in a renderer
 * is visible instead of quietly emptying the review. */
function adFolder(cfg: SourceConfig): AdCreative[] {
  const root = expand(String(cfg.dir));
  const dirs: { dir: string; day?: string }[] = [{ dir: root }];
  try { for (const d of fs.readdirSync(root)) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dirs.push({ dir: path.join(root, d), day: d }); } catch { return []; }
  const out: AdCreative[] = [];
  for (const { dir, day } of dirs) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      const raw = readJson<Manifest>(file);
      if (!isAd(raw)) continue;
      const problems = manifestProblems(raw, file);
      let createdAt: string | undefined;
      try { createdAt = fs.statSync(file).mtime.toISOString(); } catch { /* gone mid-read */ }
      out.push(adFromManifest(raw as Manifest, { file, dir, name: n, source: 'ad-folder', day, createdAt, problems }));
    }
  }
  return out;
}

/* Replace is refused once a person has signed off: an approved or live creative may be running
 * behind money, and a draft is the only thing Aircheck is allowed to swap under a renderer. */
export function adLockOf(c: AdCreative): string {
  if (Array.isArray(c.meta?.problems) && c.meta.problems.length) return 'This manifest is not valid. Fix it before Repair can replace it.';
  if (c.approved || c.status === 'approved') return 'Approved. Repair cannot replace an approved creative.';
  if (c.status === 'live') return 'Live. Repair cannot replace a creative that is already running.';
  if (c.status === 'archived') return 'Archived. Repair cannot replace a retired creative.';
  if (c.origin?.kind !== 'ad-catalog' && c.origin?.kind !== 'ad-folder') return 'This producer does not support Replace yet. Repair shows the fix only.';
  return '';
}

export function loadAds(sources: SourceConfig[]): AdCreative[] {
  const all: AdCreative[] = [];
  for (const s of sources || []) {
    if (s.source === 'ad-catalog') all.push(...adCatalog(s));
    else if (s.source === 'ad-folder') all.push(...adFolder(s));
    else {
      const plugin = pluginFor('ads', s.source);
      if (!plugin) throw new Error(`Unknown ad source '${s.source}'`);
      all.push(...plugin(s, helpers()));
    }
  }
  const seen = new Set<string>();
  return all
    .filter((c) => (seen.has(c.id) ? false : seen.add(c.id)))
    .map((c) => ({ ...c, lock: c.lock ?? adLockOf(c) }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.product.localeCompare(b.product) || a.assetId.localeCompare(b.assetId));
}

/** Every product that has ad media, with how many creatives each has. */
export function adProducts(ads: AdCreative[]): { product: string; count: number; approved: number }[] {
  const by = new Map<string, { product: string; count: number; approved: number }>();
  for (const c of ads) {
    const e = by.get(c.product) || { product: c.product, count: 0, approved: 0 };
    e.count += 1;
    if (c.approved) e.approved += 1;
    by.set(c.product, e);
  }
  return [...by.values()].sort((a, b) => a.product.localeCompare(b.product));
}

/* AD CREATIVE AS A QUEUE ROW. Reviewing a creative is the same job as reviewing a post — media,
 * a pane, and the three actions — so it goes through the same view rather than a parallel one.
 * What differs travels on the row itself: no send time, the product in place of the lane, and the
 * creative under `ad` so the pane can show its ladder and honour its lock. */
export function adsAsQueue(ads: AdCreative[]): QueueItem[] {
  return ads.map((c) => ({
    id: c.id,
    /* The lane is the ad platform the creative was cut for, the way a post's lane is the account
     * it goes out on. The product is what it is about, and filters separately. */
    lane: c.lane || adLaneOf(c.format, typeof c.meta?.platform === 'string' ? c.meta.platform : undefined),
    kind: c.kind,
    title: c.title || c.assetId,
    text: c.text,
    media: c.media,
    /* The ladder is the creative's own; `status` here only drives the generic 'sent' styling, and
     * a creative is never sent. */
    status: 'queued' as const,
    source: c.source,
    origin: { kind: 'other' as const, path: c.origin?.path },
    ...(c.missing?.length ? { missing: c.missing } : {}),
    lock: c.lock,
    meta: c.meta,
    ad: c,
  }));
}
