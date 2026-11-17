import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadAds, adLockOf } from './sources/ads';
import { getRun, saveRun } from './runs';
import type { Config } from './config';
import type { AdCreative, Run } from './types';

/* REPLACE, FOR AD CREATIVE. The same contract as replacing a queued post: a finished repair run's
 * output takes the place of the draft, the old version is saved first, and Undo puts it back.
 *
 * The difference is what may be swapped. A creative nobody has signed off on is a draft, and a
 * draft is the only thing Aircheck will touch: adLockOf refuses an approved, live or archived one,
 * because those can be running behind money. The producer's own catalog is rewritten in place with
 * recomputed hashes and byte counts, so the manifest still describes the files that are actually
 * on disk; approval flags and stage are never changed, so a swap can never promote a creative. */

const VISUAL = /\.(png|jpe?g|webp|gif|avif|mp4|mov|webm|m4v|pdf)$/i;
const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function atomicWrite(file: string, text: string) {
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
}

type CatalogFile = { file?: string; sha256?: string; bytes?: number };
type Catalog = { assets?: { id?: string; files?: CatalogFile[]; text?: string }[] };

export function findAd(cfg: Config, run: Run): AdCreative {
  const id = run.ad?.id;
  if (!id) throw new Error('This run is not about an ad creative.');
  const ad = loadAds(cfg.ads).find((c) => c.id === id);
  if (!ad) throw new Error('That creative is no longer in the ad media store.');
  return ad;
}

export function replaceAdWithRun(cfg: Config, runId: string): Run {
  const run = getRun(cfg, runId);
  if (!run) throw new Error('No such run.');
  if (run.action !== 'repair') throw new Error('Only a repair run can replace a creative.');
  if (run.status !== 'done' || !run.output) throw new Error('The run has not finished with a creative.');
  if (run.replaced) throw new Error('This run already replaced the creative.');
  const ad = findAd(cfg, run);
  const lock = adLockOf(ad);
  if (lock) throw new Error(lock);

  const out = run.output;
  const made = out.media.filter((m) => VISUAL.test(m.path)).map((m) => m.path);
  if (!made.length && !out.text) throw new Error('The run produced no copy and no media to replace with.');

  const home = path.join(ad.origin!.dir || path.dirname(ad.origin!.path!), 'aircheck', runId);
  fs.mkdirSync(home, { recursive: true });
  const backup = path.join(home, 'backup.json');

  if (ad.origin!.kind === 'ad-catalog') {
    const file = ad.origin!.path!;
    const raw = fs.readFileSync(file, 'utf8');
    const cat = JSON.parse(raw) as Catalog;
    const asset = cat.assets?.find((a) => a.id === ad.assetId);
    if (!asset) throw new Error('That asset is gone from catalog.json.');
    const before = asset.files?.length || 0;
    if (before && made.length !== before)
      throw new Error(`This placement has ${before} ${before === 1 ? 'file' : 'files'} and the repair made ${made.length}. Ask the repair for the same count before replacing.`);

    fs.writeFileSync(backup, JSON.stringify({ kind: 'ad-catalog', file, raw, assetId: ad.assetId }, null, 1));
    /* Each file keeps the name the catalog already gives it, so nothing else that reads the
     * manifest has to learn a new path. The old bytes are saved beside the backup first. */
    const next: CatalogFile[] = [];
    (asset.files || []).forEach((f, i) => {
      const rel = f.file!;
      const dest = path.isAbsolute(rel) ? rel : path.join(ad.origin!.dir!, rel);
      if (fs.existsSync(dest)) fs.copyFileSync(dest, path.join(home, `old-${path.basename(dest)}`));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(made[i], dest);
      const bytes = fs.readFileSync(dest);
      next.push({ file: rel, sha256: sha256(bytes), bytes: bytes.length });
    });
    if (next.length) asset.files = next;
    if (out.text) asset.text = out.text;
    atomicWrite(file, JSON.stringify(cat, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  } else {
    const file = ad.origin!.path!;
    const raw = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(backup, JSON.stringify({ kind: 'ad-folder', file, raw }, null, 1));
    const rec = JSON.parse(raw);
    if (out.text) rec.text = out.text;
    if (made.length) {
      rec.media = made.map((f) => {
        const to = path.join(home, path.basename(f));
        fs.copyFileSync(f, to);
        return to;
      });
    }
    atomicWrite(file, JSON.stringify(rec, null, 2) + '\n');
  }

  const saved: Run = { ...run, replaced: { at: new Date().toISOString(), backup } };
  saveRun(cfg, saved);
  return saved;
}

export function undoAdReplace(cfg: Config, runId: string): Run {
  const run = getRun(cfg, runId);
  if (!run?.replaced) throw new Error('This run did not replace anything.');
  const ad = findAd(cfg, run);
  const lock = adLockOf(ad);
  if (lock) throw new Error(lock.replace('Repair cannot replace', 'Undo cannot restore'));
  const b = JSON.parse(fs.readFileSync(run.replaced.backup, 'utf8')) as { kind: string; file: string; raw: string; assetId?: string };
  if (!b?.raw) throw new Error('The backup is missing, so Undo cannot run.');

  if (b.kind === 'ad-catalog') {
    const cat = JSON.parse(b.raw) as Catalog;
    const asset = cat.assets?.find((a) => a.id === b.assetId);
    const home = path.dirname(run.replaced.backup);
    for (const f of asset?.files || []) {
      const dest = path.isAbsolute(f.file!) ? f.file! : path.join(ad.origin!.dir!, f.file!);
      const old = path.join(home, `old-${path.basename(dest)}`);
      if (fs.existsSync(old)) fs.copyFileSync(old, dest);
    }
  }
  atomicWrite(b.file, b.raw);
  const saved: Run = { ...run, replaced: undefined };
  saveRun(cfg, saved);
  return saved;
}
