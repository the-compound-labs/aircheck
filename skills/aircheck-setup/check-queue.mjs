#!/usr/bin/env node
/* check-queue.mjs — READ-ONLY verification for the aircheck-setup skill.
 *
 * Reads the folder queue the way Aircheck's own loader does (src/server/sources/queue.ts) and
 * reports what the UI will show, including the three failures that are silent in the app:
 *   1. a file with no `lane` is skipped entirely,
 *   2. media that is not on disk is dropped, so the post renders with no image,
 *   3. media outside every `mediaRoots` entry (and dataDir) is refused by /api/media, so the
 *      post renders with a broken image.
 *
 * It starts nothing and writes nothing.
 *
 *   node skills/aircheck-setup/check-queue.mjs                 # today, in the config timezone
 *   node skills/aircheck-setup/check-queue.mjs --day 2026-11-06
 *   node skills/aircheck-setup/check-queue.mjs --all
 *   node skills/aircheck-setup/check-queue.mjs --config ~/other/aircheck.config.json
 *
 * Exit code 1 if any file in the day is unusable.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const expand = (p) => (p === '~' ? HOME : p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p);

const STATUSES = new Set(['queued', 'sent', 'failed', 'held']);
const configFile = expand(arg('--config') || process.env.AIRCHECK_CONFIG || path.join(process.cwd(), 'aircheck.config.json'));

let cfg;
try { cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (e) {
  console.error(`Config unreadable at ${configFile}: ${e.message}`);
  process.exit(1);
}

const dataDir = expand(cfg.dataDir || '~/.aircheck');
const roots = [...new Set([...(cfg.mediaRoots || []).map(expand), dataDir])];
const tz = cfg.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const folders = (cfg.queue || []).filter((q) => q.source === 'folder').map((q) => expand(String(q.dir)));
if (!folders.length) {
  console.error('No { "source": "folder" } entry in config.queue — nothing for this check to read.');
  process.exit(1);
}

const underRoot = (file) => {
  let real;
  try { real = fs.realpathSync(file); } catch { return false; }
  for (const r of roots) {
    let root;
    try { root = fs.realpathSync(r); } catch { continue; }
    if (real === root || real.startsWith(root + path.sep)) return true;
  }
  return false;
};

function days(dir) {
  if (args.includes('--all')) {
    try { return fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(); } catch { return []; }
  }
  return [arg('--day') || todayStr];
}

let bad = 0;
let ok = 0;

for (const dir of folders) {
  console.log(`\n# queue folder: ${dir}`);
  if (!fs.existsSync(dir)) { console.log('  folder does not exist yet. The job creates <dir>/<YYYY-MM-DD>/ on its first post.'); continue; }
  for (const day of days(dir)) {
    const dayDir = path.join(dir, day);
    let names = [];
    try { names = fs.readdirSync(dayDir).filter((n) => n.endsWith('.json')); } catch {
      console.log(`  ${day}: no folder. Aircheck will show nothing for this day from this source.`);
      continue;
    }
    console.log(`  ${day}: ${names.length} file(s)`);
    for (const n of names) {
      const file = path.join(dayDir, n);
      const problems = [];
      const notes = [];
      let it;
      try { it = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { problems.push(`invalid JSON (${e.message})`); }
      if (it && typeof it === 'object') {
        if (!it.lane || typeof it.lane !== 'string') problems.push('no "lane" — Aircheck SKIPS this file');
        if (it.status !== undefined && !STATUSES.has(it.status)) problems.push(`status "${it.status}" is not queued|sent|failed|held (Aircheck falls back to queued)`);
        if (it.status === undefined) notes.push('no "status" — read as queued');
        if (it.at === undefined) notes.push('no "at" — sorts last and shows no time');
        else if (Number.isNaN(Date.parse(it.at))) problems.push(`"at" is not a parseable timestamp: ${it.at}`);
        if (it.media !== undefined && !Array.isArray(it.media)) problems.push('"media" must be an array');
        if (it.status === 'sent' && !it.postUrl) notes.push('sent with no postUrl — the timeline cannot link to the post');
        if (it.text === undefined && !(it.media || []).length) notes.push('no text and no media — the card will be empty');
        for (const m of Array.isArray(it.media) ? it.media : []) {
          const rel = typeof m === 'string' ? m : m?.path;
          if (!rel) { problems.push('a media entry is neither a string nor { path }'); continue; }
          const abs = path.isAbsolute(rel) ? rel : path.join(dayDir, rel);
          if (!fs.existsSync(abs)) problems.push(`media missing on disk, will be dropped: ${abs}`);
          else if (!underRoot(abs)) problems.push(`media outside mediaRoots, /api/media will refuse it: ${abs}`);
        }
      }
      if (problems.length) {
        bad++;
        console.log(`    ✗ ${n}`);
        for (const p of problems) console.log(`        ${p}`);
      } else {
        ok++;
        const kind = it.kind || ((it.media || []).length > 1 ? 'carousel' : (it.media || []).length ? 'image' : 'text');
        console.log(`    ✓ ${n}  lane=${it.lane} kind=${kind} status=${it.status || 'queued'} media=${(it.media || []).length}`);
      }
      for (const nt of notes) console.log(`        note: ${nt}`);
    }
  }
}

console.log(`\n${ok} file(s) parse, ${bad} unusable.`);
console.log(`media roots in force: ${roots.join(', ')}`);
if (!bad) console.log('Run `npm run dev` and open http://localhost:3326 to see the day.');
process.exit(bad ? 1 : 0);
