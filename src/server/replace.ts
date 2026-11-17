import fs from 'node:fs';
import path from 'node:path';
import { readJson, type Config } from './config';
import { pluginFor } from './plugins';
import { getRun, runFolder, saveRun } from './runs';
import { loadQueue, lockOf } from './sources/queue';
import type { QueueItem, Run } from './types';

/* REPAIR → REPLACE. Swaps a finished repair run's output into the queued post it repaired, and back.
 *
 * The agent never writes to the queue. Aircheck does, here, only on a person's click:
 *   - the post must not be sent, held, or due within the lock window (lockOf);
 *   - the new files are copied next to the folder file, never into the run folder the sender would
 *     then depend on;
 *   - the old file is saved first, and Undo puts it back;
 *   - the file is rewritten whole, atomically (temp file + rename).
 * A row a plugin's source wrote is swapped by that plugin's `replace` entry for its origin kind,
 * under whatever lock its sender uses (see plugins.ts). */

const VISUAL = /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/i;

function findItem(cfg: Config, run: Run): QueueItem {
  if (!run.target) throw new Error('This run is not tied to a queued post.');
  const item = loadQueue(cfg.queue, run.target.day).find((i) => i.id === run.target!.id);
  if (!item) throw new Error('The queued post is no longer in the queue for that day.');
  return item;
}

function atomicWrite(file: string, body: string) {
  const tmp = `${file}.aircheck-${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

export function replaceWithRun(cfg: Config, runId: string): Run {
  const run = getRun(cfg, runId);
  if (!run) throw new Error('No such run.');
  if (run.action !== 'repair') throw new Error('Only a repair run can replace a queued post.');
  if (run.status !== 'done' || !run.output) throw new Error('The run has not finished with a post.');
  if (run.replaced) throw new Error('This run already replaced the post.');
  const item = findItem(cfg, run);
  const lock = lockOf(item);
  if (lock) throw new Error(lock);

  const out = run.output;
  const visual = out.media.filter((m) => VISUAL.test(m.path)).map((m) => m.path);
  const pdf = out.media.find((m) => /\.pdf$/i.test(m.path))?.path || (fs.existsSync(path.join(runFolder(cfg, runId), 'out', 'deck.pdf')) ? path.join(runFolder(cfg, runId), 'out', 'deck.pdf') : undefined);
  if (!visual.length && !out.text) throw new Error('The run produced no copy and no media to replace with.');

  const home = path.join(path.dirname(item.origin!.path!), 'aircheck', runId);
  fs.mkdirSync(home, { recursive: true });
  const copy = (f: string) => { const to = path.join(home, path.basename(f)); fs.copyFileSync(f, to); return to; };
  const backup = path.join(home, 'backup.json');

  const kind = item.origin!.kind;
  if (kind === 'folder') {
    const file = item.origin!.path!;
    const raw = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(backup, JSON.stringify({ kind: 'folder', file, raw }, null, 1));
    const post = JSON.parse(raw);
    if (out.text) post.text = out.text;
    if (visual.length) post.media = visual.map(copy);
    atomicWrite(file, JSON.stringify(post, null, 2) + '\n');
  } else {
    const plugin = pluginFor('replace', kind);
    if (!plugin) throw new Error('This producer does not support Replace yet. Repair shows the fix only.');
    plugin.replace({ item, visual, pdf, text: out.text, copy, backup, atomicWrite });
  }

  const next: Run = { ...run, replaced: { at: new Date().toISOString(), backup } };
  saveRun(cfg, next);
  return next;
}

export function undoReplace(cfg: Config, runId: string): Run {
  const run = getRun(cfg, runId);
  if (!run?.replaced) throw new Error('This run has not replaced anything.');
  const item = findItem(cfg, run);
  const lock = lockOf(item);
  if (lock) throw new Error(lock.replace('Replace', 'Undo'));
  const b = readJson<Record<string, unknown> & { kind: string; file?: string; raw?: string }>(run.replaced.backup);
  if (!b) throw new Error('The backup is missing, so Undo cannot run.');
  if (b.kind === 'folder') {
    atomicWrite(b.file!, b.raw!);
  } else {
    const plugin = pluginFor('replace', b.kind);
    if (!plugin) throw new Error(`No plugin restores a '${b.kind}' backup, so Undo cannot run.`);
    plugin.undo({ item, backup: b, atomicWrite });
  }
  const next: Run = { ...run, replaced: undefined };
  saveRun(cfg, next);
  return next;
}
