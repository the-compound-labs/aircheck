#!/usr/bin/env node
/* scan-setup.mjs — READ-ONLY discovery for the aircheck-setup skill.
 *
 * Finds the jobs on this machine that could be posting to social platforms, and where each one
 * writes its output, so the skill can propose an aircheck.config.json and one patch per job.
 *
 * It reads. It never writes a file, never starts a job, never touches the network.
 *
 *   node skills/aircheck-setup/scan-setup.mjs
 *   node skills/aircheck-setup/scan-setup.mjs --json
 *   node skills/aircheck-setup/scan-setup.mjs --root ~/work --root ~/side   # extra code roots
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
/* More code roots: --root <dir> (repeatable), or AIRCHECK_SCAN_ROOTS, colon-separated. */
const extraRoots = [...args.flatMap((a, i) => (a === '--root' && args[i + 1] ? [args[i + 1]] : [])), ...(process.env.AIRCHECK_SCAN_ROOTS || '').split(':').filter(Boolean)];
const expand = (p) => (p === '~' ? HOME : p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p);

const DEFAULT_ROOTS = ['~/code', '~/src', '~/projects', '~/Projects', '~/Developer', '~/dev', '~/repos', '~/work'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.venv', 'venv', 'dist', 'build', 'out', 'coverage', '__pycache__', '.cache', 'vendor', 'Pods', '.terraform', 'target', 'design-reviews', 'public', 'docs', 'fixtures', '__tests__', 'test', 'tests']);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.bash', '.zsh', '.rb', '.go']);
/* A job runs something. A data file or a React component that merely mentions a platform does not. */
const RUNS_SOMETHING = /\bfetch\(|axios|requests\.(?:post|put)|http\.request|urllib|curl\s|execFileSync?|execSync|spawnSync?|subprocess|child_process|process\.argv|sys\.argv|__main__|^#!/m;

/* A file "posts" if it talks to a platform's publish surface or clearly drives a browser to post. */
const POST_SIGNALS = [
  [/api\.(?:twitter|x)\.com\/2\/tweets|\/1\.1\/statuses\/update|TwitterApi|tweepy\.|create_tweet|\.tweet\(/i, 'x'],
  [/api\.linkedin\.com\/(?:v2|rest)\/(?:ugcPosts|posts|assets|images|videos)|ugcPosts|\/rest\/posts\b/i, 'linkedin'],
  [/com\.atproto\.repo\.createRecord|app\.bsky\.feed\.post|agent\.post\(/i, 'bluesky'],
  [/graph\.(?:facebook|instagram)\.com\/[^"'`\s]*\/(?:media|media_publish|feed|photos|videos)/i, 'instagram/facebook'],
  [/graph\.threads\.net\/[^"'`\s]*\/threads/i, 'threads'],
  [/\/api\/v1\/statuses/i, 'mastodon'],
  [/googleapis\.com\/upload\/youtube|youtube\/v3\/videos\?[^"'`]*uploadType|videos\(\)\.insert|videos\.insert/i, 'youtube'],
  [/open-?api\.tiktok\.com\/[^"'`\s]*(?:publish|post)/i, 'tiktok'],
  [/oauth\.reddit\.com\/api\/submit|\/api\/submit\b|praw\.Reddit|subreddit\.submit/i, 'reddit'],
  [/peerlist\.io\/[^"'`\s]*\/(?:post|scroll)/i, 'peerlist'],
  [/(?:publishPost|postToPlatform|sendPost|publish_post|post_now|createPost|postCarousel|postThread)\s*\(/, 'generic publish call'],
];

/* A browser driver alone is not enough. It must drive a platform's own site, act on the page, and
 * talk about posting — otherwise every screenshot and test script in the tree looks like a poster. */
const BROWSER = /playwright|puppeteer|selenium|chromedriver/i;
const BROWSER_HOST = /(?:x\.com|twitter\.com|linkedin\.com|bsky\.app|instagram\.com|threads\.(?:net|com)|reddit\.com|tiktok\.com|facebook\.com|peerlist\.io|substack\.com)/i;
const BROWSER_ACTION = /\.(?:click|press|type|fill|selectOption|setInputFiles|keyboard)\s*\(|send_keys\(/i;
const POST_WORDS = /\b(?:post|publish|tweet|compose|caption)\b/i;

/* Only path-shaped strings: a slash, no spaces. Post copy in a data file is not an output path. */
const MEDIA_HINT = /(?:["'`])(\.{0,2}[~/\w.-]*\/[\w./-]*(?:out|output|media|assets|render|screenshot|export|slide|card|queue)[\w./-]*)(?:["'`])/gi;
const FILE_HINT = /(?:["'`])([~.\w/-]*\/?[\w.-]+\.(?:png|jpe?g|webp|gif|mp4|mov|pdf))(?:["'`])/gi;

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const lines = (text) => text.split('\n');

function walk(root, depth = 0, acc = []) {
  if (depth > 5 || acc.length > 20000) return acc;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1, acc); }
    else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) acc.push(full);
  }
  return acc;
}

/** Why this file looks like a poster, with the line that says so. */
function postEvidence(file) {
  const text = read(file);
  if (!text || text.length > 400_000) return null;
  if (!RUNS_SOMETHING.test(text)) return null;
  if (text.includes('POST_SIGNALS')) return null;                   // this scanner, or a copy of it
  const code = (l) => !!l && !/^\s*(?:\/\/|#|\*|\/\*)/.test(l);
  const hits = [];
  for (const [re, platform] of POST_SIGNALS) {
    const ls = lines(text);
    for (let i = 0; i < ls.length; i++) {
      if (code(ls[i]) && re.test(ls[i])) { hits.push({ platform, line: i + 1, text: ls[i].trim().slice(0, 160) }); break; }
    }
  }
  if (!hits.length && BROWSER.test(text) && BROWSER_ACTION.test(text) && POST_WORDS.test(text)) {
    const ls = lines(text);
    const i = ls.findIndex((l) => code(l) && BROWSER_HOST.test(l));
    if (i < 0) return null;
    const host = ls[i].match(BROWSER_HOST)?.[0] || 'unknown site';
    hits.push({ platform: `browser-driven (${host})`, line: i + 1, text: ls[i].trim().slice(0, 160) });
  }
  if (!hits.length) return null;
  /* Where it writes. Directory-ish strings first, then concrete media filenames. */
  const outputs = new Set();
  for (const re of [MEDIA_HINT, FILE_HINT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && outputs.size < 12) {
      const v = m[1].trim();
      if (v && !v.includes('://') && !v.startsWith('@') && v.length < 180) outputs.add(v);
    }
  }
  const writesFiles = /writeFileSync|writeFile\(|fs\.promises\.writeFile|open\([^)]*['"]w|\.save\(|mkdirSync|savefig/.test(text);
  return { file, hits, outputs: [...outputs], writesFiles };
}

/* ---- 1. cron ---- */
function cron() {
  let raw = '';
  try { raw = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return []; }
  return lines(raw)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => ({ kind: 'cron', entry: l, command: l.replace(/^(\S+\s+){5}/, '') }));
}

/* ---- 2. launchd ---- */
function launchd() {
  const out = [];
  for (const dir of [path.join(HOME, 'Library', 'LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons']) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.plist')); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      let plist = null;
      try { plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* unreadable or binary oddity */ }
      const argv = plist?.ProgramArguments || (plist?.Program ? [plist.Program] : []);
      out.push({
        kind: 'launchd',
        label: plist?.Label || n.replace(/\.plist$/, ''),
        plist: file,
        argv,
        schedule: plist?.StartInterval ? `every ${plist.StartInterval}s` : plist?.StartCalendarInterval ? JSON.stringify(plist.StartCalendarInterval) : plist?.RunAtLoad ? 'at load' : 'unknown',
        stdout: plist?.StandardOutPath,
        workingDirectory: plist?.WorkingDirectory,
      });
    }
  }
  return out;
}

/* ---- 3. Airflow DAGs ---- */
function airflow(roots) {
  const dirs = new Set();
  for (const d of [process.env.AIRFLOW_HOME && path.join(process.env.AIRFLOW_HOME, 'dags'), path.join(HOME, 'airflow', 'dags')].filter(Boolean)) dirs.add(d);
  for (const r of roots) {
    for (const cand of [path.join(r, 'dags'), path.join(r, 'airflow', 'dags')]) if (fs.existsSync(cand)) dirs.add(cand);
    let subs = [];
    try { subs = fs.readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name)).map((e) => path.join(r, e.name, 'dags')); } catch { /* root absent */ }
    for (const s of subs) if (fs.existsSync(s)) dirs.add(s);
  }
  const out = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.py')); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      const text = read(file);
      if (!/DAG\(|@dag\b/.test(text)) continue;
      const ids = [...text.matchAll(/dag_id\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
      const tasks = [...text.matchAll(/task_id\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
      const sched = text.match(/schedule(?:_interval)?\s*=\s*([^,\n]+)/)?.[1]?.trim();
      out.push({ kind: 'airflow', file, dagIds: ids, tasks, schedule: sched, posts: !!postEvidence(file) });
    }
  }
  return out;
}

/* ---- 4. posting scripts and agent loops ---- */
function scripts(roots) {
  const found = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const f of walk(r)) {
      const ev = postEvidence(f);
      if (ev) found.push(ev);
      if (found.length > 400) break;
    }
  }
  return found;
}

const roots = [...new Set([...extraRoots, ...DEFAULT_ROOTS].map(expand))].filter((r) => fs.existsSync(r));
const report = { home: HOME, roots, cron: cron(), launchd: launchd(), airflow: airflow(roots), posters: scripts(roots) };

/* Which of the scheduled jobs point at a file that looks like a poster. */
const posterPaths = new Set(report.posters.map((p) => p.file));
const refersToPoster = (s) => [...posterPaths].filter((p) => s.includes(p) || s.includes(path.basename(p)));
for (const c of report.cron) c.posterMatches = refersToPoster(c.entry);
for (const l of report.launchd) l.posterMatches = refersToPoster((l.argv || []).join(' '));

if (asJson) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); } else {

const say = (s = '') => console.log(s);
say('# Aircheck setup scan (read-only)');
say(`roots searched: ${roots.join(', ') || '(none found)'}`);
say();

say(`## cron (${report.cron.length})`);
for (const c of report.cron) say(`- ${c.entry}${c.posterMatches.length ? `\n    posts: ${c.posterMatches.join(', ')}` : ''}`);
if (!report.cron.length) say('- no crontab entries for this user');
say();

const interesting = report.launchd.filter((l) => l.posterMatches.length || /social|post|tweet|linkedin|bsky|publish|wire|lane/i.test(l.label));
say(`## launchd (${report.launchd.length} plists, ${interesting.length} look posting-related)`);
for (const l of interesting) {
  say(`- ${l.label}  [${l.schedule}]`);
  say(`    plist: ${l.plist}`);
  if (l.argv?.length) say(`    argv:  ${l.argv.join(' ')}`);
  if (l.posterMatches.length) say(`    posts: ${l.posterMatches.join(', ')}`);
}
if (!interesting.length) say('- nothing matched; run with --json to see all plists');
say();

say(`## Airflow DAGs (${report.airflow.length})`);
for (const d of report.airflow) say(`- ${d.dagIds.join(', ') || path.basename(d.file)}  [${d.schedule || 'schedule unknown'}]${d.posts ? '  (posts)' : ''}\n    ${d.file}\n    tasks: ${d.tasks.slice(0, 12).join(', ')}`);
if (!report.airflow.length) say('- none found');
say();

say(`## scripts that look like they post (${report.posters.length})`);
const shown = report.posters.filter((p) => p.hits.some((h) => h.platform !== 'browser-driven (unknown platform)')).concat(report.posters.filter((p) => p.hits.every((h) => h.platform === 'browser-driven (unknown platform)'))).slice(0, 40);
for (const p of shown) {
  say(`- ${p.file}`);
  for (const h of p.hits) say(`    ${h.platform} @ line ${h.line}: ${h.text}`);
  if (p.outputs.length) say(`    writes near: ${p.outputs.slice(0, 8).join(', ')}`);
  if (!p.writesFiles) say('    no file writes seen — it may post text only (media: [])');
}
if (!report.posters.length) say('- none found. Ask where the posting job lives, or pass --root <dir>.');
else if (report.posters.length > shown.length) say(`- … ${report.posters.length - shown.length} more; --json for all. Narrow with --root <the one repo that posts>.`);
say();
say('Nothing was changed. Next: propose aircheck.config.json and one patch per job, show the diff, and ask.');
}
