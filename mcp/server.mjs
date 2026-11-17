#!/usr/bin/env node
/* THE AIRCHECK MCP SERVER.
 *
 * Runs on the user's machine. It is the only thing that does. A hosted page can show you what is
 * queued, but it cannot read your disk and it cannot re-run your pipeline — so the agent that
 * queued the post reports it through here, and the bytes stay where they were made.
 *
 *   queue_post   write one manifest for a post the agent just queued
 *   mark_sent    rewrite status and postUrl after a send, preserving the rest of the file
 *   list_queue   read a day back, with media resolved and missing files named
 *   configure    read the setup, PROPOSE the wiring, write only on apply: true
 *   repair       start a re-run of one post's own pipeline locally, in a scratch folder
 *   repair_status  how that run is doing, and its result once it is done
 *
 * It also starts the local media bridge (mcp/bridge.mjs), which is how the hosted shell gets a
 * preview of a file it is not allowed to hold.
 *
 * Nothing here posts. Nothing here edits a user's posting job. `repair` runs an agent that is told
 * in so many words never to publish and never to write outside its own run folder. */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { start as startBridge } from './bridge.mjs';
import {
  DEFAULT_ORIGINS, configCandidates, dayOf, expand, findConfig, inferKind, loadConfig,
  manifestPath, manifestProblems, newId, queueDir, queueDirs, readJson, resolveMedia, serialize, today,
} from './lib.mjs';

/* Published as aircheck-mcp, its own package.json sits beside this file. */
const pkg = readJson(fileURLToPath(new URL('./package.json', import.meta.url))) || {};

/* ----------------------------------------------------------------- queue_post */

export function queuePost(cfg, a) {
  /* A creative is the same manifest with an `ad` block. It has no permalink, so it carries no
   * postUrl, and it starts as a draft rather than queued. */
  const ad = a.ad !== undefined;
  const manifest = {
    lane: a.lane, at: a.at, kind: a.kind, title: a.title, text: a.text,
    media: a.media, status: a.status || (ad ? 'draft' : 'queued'), ad: a.ad, email: a.email,
    postUrl: ad ? a.postUrl : a.postUrl === undefined ? null : a.postUrl,
    url: a.url, meta: a.meta,
  };
  // Validate BEFORE writing. A bad manifest on disk is worse than no manifest: the app skips it
  // silently and the person sees a post that is simply not there.
  const problems = manifestProblems(manifest);
  if (problems.length) return { ok: false, problems };

  const queue = a.queue ? expand(a.queue) : queueDir(cfg);
  const day = a.day || dayOf(a.at, cfg.timezone);
  const id = a.id || newId(a.lane, a.at);
  const file = manifestPath(queue, day, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(manifest));
  return { ok: true, path: file, id: path.basename(file, '.json'), day, queue };
}

/* ------------------------------------------------------------------ mark_sent */

/** Every manifest in the queue, newest day first. Used to find a post by id alone. */
function allManifests(cfg) {
  const out = [];
  for (const queue of queueDirs(cfg)) {
    let days = [];
    try { days = fs.readdirSync(queue).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(); } catch { continue; }
    for (const day of days) {
      let files = [];
      try { files = fs.readdirSync(path.join(queue, day)).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const f of files.sort()) out.push({ queue, day, id: path.basename(f, '.json'), path: path.join(queue, day, f) });
    }
  }
  return out;
}

export function findManifest(cfg, { id, path: p, day }) {
  if (p) { const f = expand(p); return fs.existsSync(f) ? { path: f, id: path.basename(f, '.json'), day: path.basename(path.dirname(f)) } : null; }
  if (!id) return null;
  const want = String(id).replace(/[^a-z0-9._-]/gi, '-');
  const all = allManifests(cfg);
  if (day) return all.find((m) => m.day === day && m.id === want) || null;
  return all.find((m) => m.id === want) || null;
}

export function markSent(cfg, a) {
  const found = findManifest(cfg, a);
  if (!found) return { ok: false, problems: [a.path ? `No manifest at ${a.path}` : `No manifest with id "${a.id}" in ${queueDirs(cfg).join(', ')}`] };
  const raw = readJson(found.path);
  if (!raw) return { ok: false, problems: [`${path.basename(found.path)}: not readable JSON`] };

  // Read, patch, re-serialize. Every other field survives: the agent that queued the post owns
  // them, and a send is allowed to change exactly two things.
  // A creative that went out went LIVE; it has no "sent" on its ladder.
  const next = { ...raw, status: a.status || (raw.ad !== undefined ? 'live' : 'sent') };
  if (a.postUrl !== undefined) next.postUrl = a.postUrl;
  else if (next.postUrl === undefined && raw.ad === undefined) next.postUrl = null;

  const problems = manifestProblems(next, found.path);
  if (problems.length) return { ok: false, problems };
  fs.writeFileSync(found.path, serialize(next));
  return { ok: true, path: found.path, id: found.id, day: found.day, status: next.status, postUrl: next.postUrl ?? null };
}

/* ----------------------------------------------------------------------- sync */

/* The account on aircheck.dev holds a copy of every manifest this server writes, so the signed-in
 * site shows the day. Only the JSON goes up: media entries stay references to files on this
 * machine. Without a token nothing leaves the machine. A failed sync never undoes the local write;
 * it is reported in the result so the agent can say so. */
export async function syncManifest(result, { fetchFn = globalThis.fetch, env = process.env } = {}) {
  const token = env.AIRCHECK_TOKEN;
  if (!token) return { synced: false, reason: 'no AIRCHECK_TOKEN, so the manifest stayed on this machine' };
  const base = (env.AIRCHECK_URL || 'https://aircheck.dev').replace(/\/$/, '');
  const manifest = readJson(result.path);
  if (!manifest) return { synced: false, reason: `${result.path} is not readable JSON` };
  try {
    const r = await fetchFn(`${base}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ manifests: [{ id: result.id, day: result.day, origin: result.path, manifest }] }),
    });
    if (!r.ok) return { synced: false, reason: `aircheck.dev answered ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { synced: true };
  } catch (e) {
    return { synced: false, reason: `could not reach ${base}: ${e && e.message ? e.message : e}` };
  }
}

async function synced(result) {
  if (!result?.ok) return result;
  return { ...result, ...(await syncManifest(result)) };
}

/* ----------------------------------------------------------------------- push */

/* PUSH A DAY. queue_post syncs as it writes, but many setups already have jobs that write their own
 * plan files (a day plan, an ad catalog) and never call it. This reads every source in the config for
 * a day, the way the app does, and sends the whole day to the account as manifests: JSON only, media
 * stay references. Re-pushing is safe: a manifest is keyed by its day and id, so a later push
 * overwrites the earlier copy and a status that changed to sent goes up with it.
 * Run on a schedule with `npx -y aircheck-mcp push`, or call the push_day tool. */
export async function pushDay({ day, fetchFn = globalThis.fetch, env = process.env } = {}) {
  const token = env.AIRCHECK_TOKEN;
  if (!token) return { ok: false, problems: ['Set AIRCHECK_TOKEN. Issue one on https://aircheck.dev/account.'] };
  const base = (env.AIRCHECK_URL || 'https://aircheck.dev').replace(/\/$/, '');
  /* The bundled reader looks only at AIRCHECK_CONFIG or the working folder; give it the same file
   * the server itself would find. */
  if (!process.env.AIRCHECK_CONFIG) { const f = findConfig(); if (f) process.env.AIRCHECK_CONFIG = f; }
  const { dayRows } = await import('./local-api.mjs');
  const { day: d, rows } = dayRows(day);
  let saved = 0; const rejected = [];
  for (let i = 0; i < rows.length; i += 100) {
    let r;
    try {
      r = await fetchFn(`${base}/api/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ manifests: rows.slice(i, i + 100) }),
      });
    } catch (e) { return { ok: false, day: d, saved, problems: [`could not reach ${base}: ${e && e.message ? e.message : e}`] }; }
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) return { ok: false, day: d, saved, problems: ['aircheck.dev did not accept AIRCHECK_TOKEN. Issue a new one on your account page.'] };
    saved += body.saved || 0;
    rejected.push(...(body.rejected || []));
  }
  return { ok: rejected.length === 0, day: d, found: rows.length, saved, rejected };
}

/* ----------------------------------------------------------------- list_queue */

export function listQueue(cfg, a = {}) {
  const day = a.day || today(cfg.timezone);
  const items = [];
  const problems = [];
  for (const queue of queueDirs(cfg)) {
    const dir = path.join(queue, day);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      const raw = readJson(file);
      const bad = manifestProblems(raw, file);
      if (bad.length) { problems.push(...bad); continue; }
      const { media, missing } = resolveMedia(raw.media, dir);
      items.push({
        id: path.basename(f, '.json'), path: file, day, lane: raw.lane, at: raw.at,
        kind: inferKind(raw, (raw.media || []).length), title: raw.title, text: raw.text,
        status: raw.status || (raw.ad !== undefined ? 'draft' : 'queued'), postUrl: raw.postUrl ?? null, url: raw.url, meta: raw.meta,
        ...(raw.ad !== undefined ? { ad: raw.ad } : {}), media, missing,
      });
    }
  }
  items.sort((x, y) => String(x.at || '~').localeCompare(String(y.at || '~')) || x.id.localeCompare(y.id));
  return { day, queues: queueDirs(cfg), count: items.length, items, problems };
}

/* ------------------------------------------------------------------ configure */

/* Reading the setup is read-only and must never hang the MCP connection, so every probe is a
 * short, bounded spawnSync whose failure is simply "nothing found". */
const sh = (cmd, args) => {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000 });
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : '';
  } catch { return ''; }
};

function cronJobs() {
  const out = sh('crontab', ['-l']);
  return out.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !/^[A-Z_]+=/.test(l))
    .map((line) => {
      const m = /^(@\w+|(?:\S+\s+){5})(.*)$/.exec(line);
      return { kind: 'cron', schedule: m ? m[1].trim() : '', command: m ? m[2].trim() : line, line };
    });
}

function launchdJobs() {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.plist')); } catch { return []; }
  const jobs = [];
  for (const f of files.sort()) {
    const file = path.join(dir, f);
    const json = sh('plutil', ['-convert', 'json', '-o', '-', file]);
    let p = null;
    try { p = JSON.parse(json); } catch { /* not convertible */ }
    if (!p) { jobs.push({ kind: 'launchd', plist: file, label: f.replace(/\.plist$/, ''), unreadable: true }); continue; }
    jobs.push({
      kind: 'launchd', plist: file, label: p.Label || f.replace(/\.plist$/, ''),
      command: (p.ProgramArguments || []).join(' ') || p.Program || '',
      schedule: p.StartCalendarInterval ? JSON.stringify(p.StartCalendarInterval) : p.StartInterval ? `every ${p.StartInterval}s` : '',
      log: p.StandardOutPath,
    });
  }
  return jobs;
}

function airflowDags(roots) {
  const dirs = [
    process.env.AIRFLOW_HOME && path.join(expand(process.env.AIRFLOW_HOME), 'dags'),
    path.join(os.homedir(), 'airflow', 'dags'),
    ...roots.map((r) => path.join(expand(r), 'dags')),
  ].filter(Boolean);
  const out = [];
  for (const dir of [...new Set(dirs)]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.py')); } catch { continue; }
    for (const f of files.sort()) {
      const src = (() => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } })();
      const id = /dag_id\s*=\s*["']([^"']+)["']/.exec(src);
      const schedule = /schedule(?:_interval)?\s*=\s*["']([^"']+)["']/.exec(src);
      out.push({ kind: 'airflow', file: path.join(dir, f), dagId: id ? id[1] : path.basename(f, '.py'), schedule: schedule ? schedule[1] : '' });
    }
  }
  return out;
}

const PROPOSED_CHANGE = [
  'Write one JSON manifest per post into <queue>/<YYYY-MM-DD>/<id>.json at the moment the post is BUILT,',
  'not when it is sent — that is the point: the queue shows what goes out today, before it goes out.',
  'Then, after the send, rewrite the same file with status "sent" and the permalink in postUrl.',
  'With this MCP server connected that is two tool calls — queue_post, then mark_sent — and the job',
  'itself does not change at all. Without it, the job writes the file directly (same format).',
].join(' ');

export function configure(cfg, a = {}) {
  /* The config the SERVER is already using is the config we are talking about. Never re-discover
   * one here: a tool call carrying its own config must not be able to rewrite a different file
   * than the one it was handed. */
  const found = cfg.exists ? cfg.file : null;
  const target = a.configFile ? expand(a.configFile) : found || cfg.file || path.join(expand('~/.aircheck'), 'aircheck.config.json');
  const roots = (a.roots || []).map(expand);
  const jobs = [...cronJobs(), ...launchdJobs(), ...airflowDags(roots)];

  const queue = a.queue ? expand(a.queue) : found ? queueDir(cfg) : path.join(expand('~/.aircheck'), 'queue');
  const proposed = {
    dataDir: '~/.aircheck',
    timezone: a.timezone || cfg.timezone,
    queue: [{ source: 'folder', dir: queue.replace(os.homedir(), '~') }],
    mediaRoots: a.mediaRoots && a.mediaRoots.length ? a.mediaRoots : ['~/.aircheck'],
    bridge: { port: cfg.bridge.port, origins: cfg.bridge.origins },
    agents: {
      default: cfg.agents.default || 'claude',
      timeoutMinutes: cfg.agents.timeoutMinutes || 20,
      commands: Object.keys(cfg.agents.commands || {}).length ? cfg.agents.commands : {
        claude: ['claude', '-p', '{prompt}', '--permission-mode', 'acceptEdits', '--add-dir', '{workspace}'],
        codex: ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '{prompt}'],
      },
    },
  };

  /* The existing config is the BASE when there is one: a proposal must never silently drop a lane,
   * a media root, a queue source or an agent command someone already wired. Everything the current
   * file has survives unless this call was given something better for that key. */
  const current = found ? readJson(found) || {} : null;
  const merged = current ? {
    ...current,
    timezone: proposed.timezone,
    queue: a.queue ? proposed.queue : current.queue || proposed.queue,
    mediaRoots: a.mediaRoots && a.mediaRoots.length
      ? [...new Set([...(current.mediaRoots || []), ...a.mediaRoots])]
      : current.mediaRoots || proposed.mediaRoots,
    bridge: { ...proposed.bridge, ...(current.bridge || {}) },
    agents: { ...proposed.agents, ...(current.agents || {}), commands: { ...proposed.agents.commands, ...((current.agents || {}).commands || {}) } },
  } : proposed;

  const result = {
    config: found
      ? { found: true, path: found, writeTo: target }
      : { found: false, searched: configCandidates(), writeTo: target },
    proposedConfig: merged,
    proposedConfigJson: JSON.stringify(merged, null, 2) + '\n',
    jobs: jobs.map((j) => ({ ...j, change: PROPOSED_CHANGE })),
    jobCount: jobs.length,
    bridge: { origins: cfg.bridge.origins, defaultOrigins: DEFAULT_ORIGINS, port: cfg.bridge.port },
    applied: false,
    notes: [
      'This is a PROPOSAL. Nothing has been written.',
      'Show the user the config and each job change, ask about each one separately, and only then call configure again with apply: true.',
      'apply: true writes the CONFIG FILE and nothing else. It never edits, reformats or reschedules a posting job — those files post to real accounts, and a broken one posts wrong or posts twice.',
      'Never run a posting job to test the wiring. Never crontab, launchctl load/unload or trigger a DAG. Scheduling is the user\'s.',
      'lanes[].id must equal the lane value a job writes, or the post shows up unattached.',
      'Every directory a job writes media into must be in mediaRoots, or the bridge refuses it and the post renders with a broken image. Symlinks are resolved, so list the real path.',
    ],
  };

  if (!a.apply) return result;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(merged, null, 2) + '\n');
  return { ...result, applied: true, wrote: target, notes: [`Wrote ${target}. No posting job was touched.`, ...result.notes.slice(2)] };
}

/* --------------------------------------------------------------------- repair */

/* THE REPAIR PROMPT. The limits are src/server/runs.ts buildPrompt's, word for word, because they
 * are the reason a repair is safe to run at all: the agent may read the whole pipeline and may
 * write only into its own run folder, and it may not publish anything, ever. */
export function buildRepairPrompt(o) {
  const L = [];
  L.push(`You are building a PREVIEW of one social post so a person can see how it will look before anything goes live. Nothing you make is published.`);
  L.push('');
  L.push(`## The queued post you are working from`);
  L.push(`REPAIR this queued post. Rebuild it through the pipeline that made it and fix what is wrong. Keep the same format, slide count, aspect and voice unless the person asks otherwise. If files are missing, rebuild exactly those.`);
  const it = o.item;
  L.push(`- id: ${it.id}, day ${it.day}, sends ${it.at || 'unscheduled'}, format ${it.kind}`);
  L.push(`- lane: ${it.lane}`);
  L.push(`- its manifest: ${it.path}`);
  if (it.meta && Object.keys(it.meta).length) L.push(`- producer details: ${JSON.stringify(it.meta)}`);
  if (it.url) L.push(`- links to: ${it.url}`);
  if (it.media.length) { L.push(`- its files, in order (read them, never edit them):`); for (const m of it.media) L.push(`  - ${m.path}`); }
  if (it.missing?.length) { L.push(`- files the producer names that are NOT on disk:`); for (const m of it.missing) L.push(`  - ${m}`); }
  if (it.text) { L.push(`- its copy, exactly:`); L.push('```'); L.push(it.text); L.push('```'); }
  if (o.request) { L.push(''); L.push(`## What the person said`); L.push(o.request); }
  L.push('');
  L.push(`## How to work`);
  L.push(`1. Learn how this lane really builds this kind of post before you make anything.`);
  if (o.workspace) L.push(`   The lane pipelines live under ${o.workspace}. Use the lane's own renderers, templates, voice docs and copy rules. Do not invent a look the lane does not have.`);
  L.push(`2. Run renderers and generators only in a dry, preview or local mode. If a step can only run live, fake that one step and say so in notes.`);
  L.push(`3. Hard limits. Never post, send, publish, schedule, upload or arm anything. Never touch ARMED flags, posted.json, cadence, state, ledger, queue or plan files. Never call a paid API. Never open a browser session that is signed in to a social account. Write files only inside ${o.out}.`);
  L.push(`4. Put every finished file in ${o.out}, at the size and aspect the platform shows it.`);
  L.push(`5. Finish by writing ${path.join(o.out, 'post.json')}:`);
  L.push('```json');
  L.push(`{ "kind": "carousel | image | video | text | thread | article", "text": "the post copy exactly as it would go out", "thread": ["only for threads: each post in order"], "media": ["file names in ${o.out}, in display order"], "notes": "one or two lines: which pipeline you used and anything that differs from a real run" }`);
  L.push('```');
  return L.join('\n');
}

function collectOutput(dir) {
  if (!fs.existsSync(dir)) return undefined;
  const post = readJson(path.join(dir, 'post.json'));
  const resolve = (m) => (path.isAbsolute(m) ? m : path.join(dir, m));
  if (post) {
    const media = (post.media || []).map((m) => resolve(typeof m === 'string' ? m : m.path)).filter((m) => fs.existsSync(m));
    return { kind: post.kind, text: post.text, thread: post.thread, media, notes: post.notes };
  }
  let files = [];
  try { files = fs.readdirSync(dir).filter((n) => n !== 'post.json' && !n.startsWith('.')).sort(); } catch { return undefined; }
  return files.length ? { media: files.map((n) => path.join(dir, n)) } : undefined;
}

const tail = (file, max = 20000) => {
  try { const s = fs.readFileSync(file, 'utf8'); return s.length > max ? s.slice(-max) : s; } catch { return ''; }
};

export async function repair(cfg, a) {
  const found = findManifest(cfg, a);
  if (!found) return { ok: false, problems: [a.path ? `No manifest at ${a.path}` : `No manifest with id "${a.id}" in ${queueDirs(cfg).join(', ')}`] };
  const raw = readJson(found.path);
  const bad = manifestProblems(raw, found.path);
  if (bad.length) return { ok: false, problems: bad };

  const agent = a.agent || cfg.agents.default;
  const template = cfg.agents.commands[agent];
  if (!template || !template.length) {
    return { ok: false, problems: [`No command configured for agent '${agent}'. Add it to agents.commands in ${cfg.file}.`] };
  }

  const { media, missing } = resolveMedia(raw.media, path.dirname(found.path));
  const item = {
    id: found.id, day: found.day, path: found.path, lane: raw.lane, at: raw.at,
    kind: inferKind(raw, (raw.media || []).length), text: raw.text, url: raw.url, meta: raw.meta, media, missing,
  };

  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;
  const dir = path.join(cfg.dataDir, 'runs', id);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });

  const prompt = buildRepairPrompt({ item, request: a.request, out, workspace: cfg.agents.workspace });
  fs.writeFileSync(path.join(dir, 'prompt.md'), prompt);

  const workspace = cfg.agents.workspace || dir;
  const vars = { prompt, workspace, out };
  const [cmd, ...args] = template.map((s) => s.replace(/\{(prompt|workspace|out)\}/g, (_, k) => vars[k]));
  const logFile = path.join(dir, 'agent.log');
  const log = fs.openSync(logFile, 'a');
  const timeoutMs = (a.timeoutMinutes || cfg.agents.timeoutMinutes || 20) * 60000;

  /* The run is STARTED, not awaited. An MCP call that blocks for twenty minutes holds the agent's
   * whole conversation open while a renderer works, so repair returns a handle and repair_status
   * reports on it — the same fire-and-forget shape the app's own startRun has. `wait` is there for
   * a caller that genuinely wants to block on a short one. */
  const child = spawn(expand(cmd), args, {
    cwd: dir, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, AIRCHECK_RUN: id, AIRCHECK_OUT: out },
  });
  fs.closeSync(log);

  const run = {
    id, dir, out, agent, prompt: path.join(dir, 'prompt.md'), log: logFile,
    target: { id: found.id, day: found.day, path: found.path },
    pid: child.pid, status: 'running', startedAt: new Date().toISOString(), timeoutMs,
  };
  child.on('error', (e) => saveRun({ ...readRun(dir), status: 'failed', error: `Could not start ${cmd}: ${e.message}`, exitCode: 127 }, dir));
  saveRun(run, dir);
  child.unref();

  if (a.wait) {
    const deadline = Date.now() + Math.min(timeoutMs, (a.waitSeconds || 120) * 1000);
    while (Date.now() < deadline) {
      const s = repairStatus(cfg, { run: id });
      if (s.status !== 'running') return s;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return {
    ok: true, started: true, run: id, runFolder: dir, out, prompt: run.prompt, agent,
    target: run.target, status: 'running',
    note: 'The agent is running. Call repair_status with this run id for the result. Nothing is published and the queued manifest is unchanged.',
  };
}

const runFile = (dir) => path.join(dir, 'run.json');
const readRun = (dir) => readJson(runFile(dir)) || {};
function saveRun(run, dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(runFile(dir) + '.tmp', JSON.stringify(run, null, 2) + '\n');
  fs.renameSync(runFile(dir) + '.tmp', runFile(dir));
}
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/* What a repair left behind. A run whose process is gone is finished from what is in out/, so a
 * result survives this server being restarted mid-render. */
export function repairStatus(cfg, a) {
  const id = String(a.run || '').replace(/[^a-z0-9-]/gi, '');
  const dir = path.join(cfg.dataDir, 'runs', id);
  const run = readRun(dir);
  if (!run.id) return { ok: false, problems: [`No repair run "${a.run}" under ${path.join(cfg.dataDir, 'runs')}`] };
  if (run.status === 'running') {
    const over = Date.now() - Date.parse(run.startedAt) > run.timeoutMs;
    if (alive(run.pid) && !over) {
      const made = (() => { try { return fs.readdirSync(run.out).filter((n) => !n.startsWith('.')); } catch { return []; } })();
      return { ok: true, status: 'running', run: id, runFolder: dir, out: run.out, filesSoFar: made, log: tail(run.log) };
    }
    if (over && alive(run.pid)) { try { process.kill(-run.pid, 'SIGTERM'); } catch { /* already gone */ } }
    const output = collectOutput(run.out);
    const ok = !!output && (!!output.text || (output.media || []).length > 0 || !!(output.thread || []).length);
    const next = {
      ...run, status: ok ? 'done' : 'failed', finishedAt: new Date().toISOString(), output,
      error: ok ? undefined : over ? `Stopped after ${run.timeoutMs / 60000} minutes.` : 'The agent finished without writing out/post.json.',
    };
    saveRun(next, dir);
    return { ...next, ok, log: tail(run.log), note: NOTE };
  }
  return { ...run, ok: run.status === 'done', log: tail(run.log), note: NOTE };
}

const NOTE = 'Nothing was published and the queued manifest was not changed. The repaired files are in the run folder; replace the post from the Aircheck UI, or by hand.';

/* ----------------------------------------------------------------- check_post */

/* THE REVIEW GATE. A person approves, holds or sends back a post on aircheck.dev; the job that posts
 * asks here right before it sends. The lane's policy decides what "nobody has looked yet" means:
 * `auto` (the default) sends it, `review` waits for an approval. Set it in the config:
 *   "review": { "default": "auto", "lanes": { "brand-x": "review" } } */
export function policyFor(cfg, lane) {
  const raw = readJson(cfg.file) || {};
  const p = (raw.review && raw.review.lanes && raw.review.lanes[lane]) || (raw.review && raw.review.default) || 'auto';
  return p === 'review' ? 'review' : 'auto';
}

export async function checkPost(cfg, a, { fetchFn = globalThis.fetch, env = process.env } = {}) {
  const found = findManifest(cfg, a);
  const raw = found ? readJson(found.path) : null;
  const day = found ? found.day : a.day;
  const id = found ? found.id : a.id && String(a.id).replace(/[^a-z0-9._-]/gi, '-');
  if (!day || !id) return { ok: false, send: false, problems: [`No manifest with id "${a.id || a.path}". Pass the id and day queue_post returned.`] };
  const lane = raw ? raw.lane : a.lane;
  const policy = policyFor(cfg, lane);
  let review = null;
  if (env.AIRCHECK_TOKEN) {
    const base = (env.AIRCHECK_URL || 'https://aircheck.dev').replace(/\/$/, '');
    try {
      const r = await fetchFn(`${base}/api/review?day=${encodeURIComponent(day)}&id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${env.AIRCHECK_TOKEN}` } });
      if (!r.ok) throw new Error(`aircheck.dev answered ${r.status}`);
      review = (await r.json()).review || null;
    } catch (e) {
      /* Unreachable: an auto lane carries on, a review lane does not send what nobody approved. */
      return { ok: false, id, day, lane, policy, decision: 'unknown', send: policy === 'auto', problems: [`Could not read the decision: ${e && e.message ? e.message : e}`] };
    }
  } else {
    review = readJson(path.join(cfg.dataDir, 'reviews', day.replace(/[^a-z0-9._-]/gi, '-'), `${id}.json`));
  }
  const decision = review && review.state ? review.state : 'pending';
  const send = decision === 'approved' || (decision === 'pending' && policy === 'auto');
  return { ok: true, id, day, lane, policy, decision, send, ...(review && review.note ? { note: review.note } : {}) };
}

/* ------------------------------------------------------------- keep running */

/* The bridge lives as long as the agent session that started it, so images on aircheck.dev go dark
 * when that session closes. `aircheck-mcp keep-running` installs a login item that runs the bridge
 * on its own (`aircheck-mcp serve`), with this shell's token and config; `stop-running` removes it. */
const LABEL = 'dev.aircheck.bridge';
const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const xml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function keepRunning(env = process.env) {
  if (process.platform !== 'darwin') {
    return { ok: false, problems: ['keep-running sets up a macOS login item. On Linux, run `npx -y aircheck-mcp serve` from a systemd user service or your session startup.'] };
  }
  const vars = { AIRCHECK_TOKEN: env.AIRCHECK_TOKEN, AIRCHECK_CONFIG: env.AIRCHECK_CONFIG || findConfig() || undefined, AIRCHECK_URL: env.AIRCHECK_URL };
  const envXml = Object.entries(vars).filter(([, v]) => v).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('');
  const log = path.join(os.homedir(), '.aircheck', 'bridge.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.writeFileSync(plistPath(), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>-lc</string><string>exec npx -y aircheck-mcp@latest serve</string></array>
<key>EnvironmentVariables</key><dict>${envXml}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardErrorPath</key><string>${xml(log)}</string><key>StandardOutPath</key><string>${xml(log)}</string>
</dict></plist>
`);
  const uid = process.getuid ? process.getuid() : '';
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath()], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, problems: [`launchctl could not load ${plistPath()}: ${(r.stderr || '').trim()}`] };
  return { ok: true, plist: plistPath(), log, note: 'Aircheck now runs at login. Images on aircheck.dev load whether or not an agent session is open.' };
}

export function stopRunning() {
  if (process.platform !== 'darwin') return { ok: true, note: 'Nothing to remove on this platform.' };
  const uid = process.getuid ? process.getuid() : '';
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  try { fs.unlinkSync(plistPath()); } catch { /* not installed */ }
  return { ok: true, note: 'Removed. The bridge now runs only while an agent session is open.' };
}

/* The account learns a machine is set up the moment its server starts, not at its first post. */
export async function checkIn(env = process.env, fetchFn = globalThis.fetch) {
  if (!env.AIRCHECK_TOKEN) return;
  const base = (env.AIRCHECK_URL || 'https://aircheck.dev').replace(/\/$/, '');
  await fetchFn(`${base}/api/sync?day=${today(loadConfig().timezone)}`, { headers: { authorization: `Bearer ${env.AIRCHECK_TOKEN}` } }).catch(() => {});
}

/* ----------------------------------------------------------------- the server */

const MEDIA_DESC = 'Ordered media sources. A string is a relative path (against the manifest folder), an absolute path, or an https URL. An object is { path | url, alt }.';

const TOOLS = [
  {
    name: 'queue_post',
    description: 'Write one Aircheck manifest for a post you just queued, or an ad creative you just rendered, into <queue>/<YYYY-MM-DD>/<id>.json. The day comes from `at` in the configured timezone (today when absent). Pass `ad` to make it an ad creative: same manifest, reviewed in Ads instead of Social. Pass `email` to make it an email: reviewed in Email, with its rendered message drawn as the reader sees it. Validates first and returns the problems rather than writing a bad file. Call this when the post or creative is BUILT, not when it is sent.',
    inputSchema: {
      type: 'object',
      properties: {
        lane: { type: 'string', description: 'Which account/lane this goes out on. Must match the lane id configured in Aircheck.' },
        at: { type: 'string', description: 'When it sends, ISO 8601. Leave out for an unscheduled post.' },
        kind: { type: 'string', description: 'text, image, carousel, video, thread or article. Inferred from media when absent.' },
        title: { type: 'string' },
        text: { type: 'string', description: 'The copy, exactly as it will post. Not a summary.' },
        media: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object' }] }, description: MEDIA_DESC },
        url: { type: 'string', description: 'The link the post points at.' },
        meta: { type: 'object', description: 'Anything producer-specific worth keeping with the post.' },
        status: { type: 'string', enum: ['queued', 'sent', 'held', 'failed', 'draft', 'review', 'approved', 'live', 'archived'], description: 'A post: queued, sent, held or failed (default queued). An ad creative: draft, review, approved, live or archived (default draft). A word from the other ladder is refused.' },
        ad: {
          type: 'object',
          description: 'Present only for an ad creative. Its presence is what makes the manifest a creative. `lane` is then the ad platform or account.',
          properties: {
            product: { type: 'string', description: 'What the creative is about. Required.' },
            format: { type: 'string', description: 'The placement it is cut for: carousel-feed, still-square, video-portrait-15s, search-text...' },
            run: { type: 'string', description: 'The production run it belongs to. Creatives are grouped by run.' },
            approved: { type: 'boolean', description: 'A person signed off. Repair will not replace an approved creative.' },
            recipe: { type: 'string', description: 'The recipe or script that built it, so Repair can re-run it.' },
          },
          required: ['product'],
        },
        email: {
          type: 'object',
          description: 'Present only for an email (a newsletter, a product email, a sequence step). Its presence is what makes the manifest an email. `lane` is then the sender or list. `at` is when it sends.',
          properties: {
            subject: { type: 'string', description: 'The subject line. Required.' },
            from: { type: 'string', description: 'The From header, e.g. "Acme <hello@acme.example>".' },
            to: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Recipient addresses, or the name of the list it goes to.' },
            replyTo: { type: 'string' },
            preheader: { type: 'string', description: 'The preview line an inbox shows after the subject.' },
            html: { anyOf: [{ type: 'string' }, { type: 'object' }], description: 'The rendered HTML message: an absolute path on this machine (served by the bridge, so it must sit in a mediaRoot) or a URL. Write the file first.' },
            text: { type: 'string', description: 'The plain-text part.' },
          },
          required: ['subject'],
        },
        id: { type: 'string', description: 'The manifest filename. Generated from the lane and the time when absent.' },
        day: { type: 'string', description: 'Override the YYYY-MM-DD folder. Normally leave this to `at`.' },
      },
      required: ['lane'],
    },
  },
  {
    name: 'mark_sent',
    description: 'After a send, rewrite one manifest: status (default "sent") and postUrl. Every other field is preserved exactly — the file is read, patched and re-serialized.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The manifest id (its filename without .json).' },
        path: { type: 'string', description: 'The manifest file, instead of an id.' },
        day: { type: 'string', description: 'Narrow an id to one YYYY-MM-DD folder.' },
        postUrl: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'The permalink the platform returned.' },
        status: { type: 'string', enum: ['queued', 'sent', 'held', 'failed', 'draft', 'review', 'approved', 'live', 'archived'], description: 'Defaults to sent for a post and live for an ad creative. Must fit the manifest: a post takes queued, sent, held or failed; a creative takes draft, review, approved, live or archived.' },
      },
    },
  },
  {
    name: 'push_day',
    description: "Send a whole day to the Aircheck account: every post and ad creative the config's sources hold for that day, read from disk the way the app reads it. Use it when jobs write their own plan files instead of calling queue_post. Safe to repeat; a later push overwrites the earlier copy. Needs AIRCHECK_TOKEN. Defaults to today in the configured timezone.",
    inputSchema: {
      type: 'object',
      properties: { day: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' } },
    },
  },
  {
    name: 'list_queue',
    description: "Read a day's queue back: every manifest, with its media resolved to absolute paths or URLs, and any local file the manifest names that is not on disk. Defaults to today in the configured timezone.",
    inputSchema: {
      type: 'object',
      properties: { day: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' } },
    },
  },
  {
    name: 'configure',
    description: 'Read the setup and PROPOSE the wiring: where the config is (or exactly what to write when there is none), the posting jobs visible on this machine (cron, launchd, Airflow), a proposed aircheck.config.json, and the change each job needs. It WRITES NOTHING unless apply: true, and even then only the config file — never a posting job. Show the proposal, ask about each change separately, then apply.',
    inputSchema: {
      type: 'object',
      properties: {
        apply: { type: 'boolean', description: 'Write the config file. Only after the user has approved that exact config.' },
        configFile: { type: 'string', description: 'Where to write the config when none exists.' },
        queue: { type: 'string', description: 'Propose this queue folder.' },
        mediaRoots: { type: 'array', items: { type: 'string' }, description: 'Every folder the jobs write media into. Real paths, not symlinks.' },
        timezone: { type: 'string' },
        roots: { type: 'array', items: { type: 'string' }, description: 'Extra code roots to look for Airflow dags under.' },
      },
    },
  },
  {
    name: 'repair',
    description: "Re-run one queued post's own pipeline locally and return the result. Spawns the configured headless agent in a fresh run folder under dataDir/runs/, told in so many words never to post, publish, schedule, upload or arm anything, and to write only inside that folder. The queued manifest is not changed. Returns the run folder and the agent's output.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The manifest id to repair.' },
        path: { type: 'string', description: 'The manifest file, instead of an id.' },
        day: { type: 'string', description: 'Narrow an id to one YYYY-MM-DD folder.' },
        request: { type: 'string', description: "What is wrong, in the person's own words." },
        agent: { type: 'string', description: 'Which agents.commands entry to run. Defaults to agents.default.' },
        timeoutMinutes: { type: 'number' },
        wait: { type: 'boolean', description: 'Block until the agent finishes, instead of returning a run id to poll. Only for a repair you expect to be quick.' },
        waitSeconds: { type: 'number', description: 'How long to block when wait is set. Default 120.' },
      },
    },
  },
  {
    name: 'check_post',
    description: 'Call this RIGHT BEFORE you send a queued post. Returns the decision a person made on aircheck.dev (approved, held, changes, or pending) and `send`: true means post it, false means do not. When the decision is "changes", `note` says what to fix: fix it, queue the new version with queue_post, and do not send this one. The lane\'s policy in the config ("review": {"default": "auto" | "review", "lanes": {...}}) decides whether a post nobody looked at is sent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The manifest id queue_post returned.' },
        path: { type: 'string', description: 'The manifest file, instead of an id.' },
        day: { type: 'string', description: 'The YYYY-MM-DD it is queued on. Needed when the manifest is not on this machine.' },
      },
    },
  },
  {
    name: 'keep_running',
    description: 'Install a macOS login item that runs the Aircheck media bridge on its own, with this server\'s token and config, so images and fixes on aircheck.dev keep working after this agent session closes. Pass stop: true to remove it.',
    inputSchema: { type: 'object', properties: { stop: { type: 'boolean', description: 'Remove the login item instead.' } } },
  },
  {
    name: 'repair_status',
    description: 'How a repair run is doing, and its result once it is done. A run whose process is gone is finished from what it left behind, so a result survives a restart.',
    inputSchema: {
      type: 'object',
      required: ['run'],
      properties: { run: { type: 'string', description: 'The run id repair returned.' } },
    },
  },
];

const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }], structuredContent: v, isError: v && v.ok === false });

export function createServer() {
  const server = new Server(
    { name: 'aircheck', version: pkg.version || '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const a = req.params.arguments || {};
    // Re-read the config on every call, so an edit applies without a restart — the same contract
    // the app's own loadConfig() keeps.
    const cfg = loadConfig();
    try {
      switch (req.params.name) {
        case 'queue_post': return json(await synced(queuePost(cfg, a)));
        case 'mark_sent': return json(await synced(markSent(cfg, a)));
        case 'list_queue': return json(listQueue(cfg, a));
        case 'configure': return json(configure(cfg, a));
        case 'repair': return json(await repair(cfg, a));
        case 'repair_status': return json(repairStatus(cfg, a));
        case 'push_day': return json(await pushDay({ day: a.day }));
        case 'check_post': return json(await checkPost(cfg, a));
        case 'keep_running': return json(a.stop ? stopRunning() : keepRunning());
        default: return json({ ok: false, problems: [`Unknown tool "${req.params.name}".`] });
      }
    } catch (e) {
      return json({ ok: false, problems: [e && e.message ? e.message : String(e)] });
    }
  });
  return server;
}

async function main() {
  /* `aircheck-mcp push [--day YYYY-MM-DD] [--tomorrow]`: send a day and exit, for a schedule. */
  const cmd = process.argv[2];
  if (cmd === 'keep-running' || cmd === 'stop-running') {
    const r = cmd === 'keep-running' ? keepRunning() : stopRunning();
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(r.ok ? 0 : 1);
  }
  /* `aircheck-mcp serve`: the bridge alone, with no agent session, for the login item. */
  if (cmd === 'serve') {
    const b = await startBridge({ version: pkg.version, standing: true });
    process.stderr.write(`aircheck: standing bridge on ${b.url} (roots: ${b.roots.join(', ') || 'none'})\n`);
    await checkIn();
    return;
  }
  if (process.argv[2] === 'push') {
    const at = process.argv.indexOf('--day');
    const days = at > 0 ? [process.argv[at + 1]] : [undefined];
    if (process.argv.includes('--tomorrow')) {
      const { day } = (await import('./local-api.mjs')).dayRows();
      const t = new Date(`${day}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
      days.push(t.toISOString().slice(0, 10));
    }
    let failed = false;
    for (const d of days) {
      const r = await pushDay({ day: d });
      process.stdout.write(JSON.stringify(r) + '\n');
      if (!r.ok) failed = true;
    }
    process.exit(failed ? 1 : 0);
  }
  // The bridge comes up with the server: the hosted shell needs it to show a single image, and a
  // user who wired the MCP entry has already said yes to exactly this process.
  if (process.env.AIRCHECK_BRIDGE !== 'off') {
    try {
      const b = await startBridge({ version: pkg.version });
      process.stderr.write(`aircheck: media bridge on ${b.url} (roots: ${b.roots.join(', ') || 'none'})\n`);
    } catch (e) {
      process.stderr.write(`aircheck: media bridge did not start: ${e.message}\n`);
    }
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
  checkIn();
  /* The session that started this server is gone when its stdin closes. The bridge would keep the
   * process alive on its own, holding the port with an old copy, so leave with the session. */
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stderr.write('aircheck: MCP server ready on stdio\n');
}

/* Run directly, or through the npx bin link, whose argv[1] is a symlink to this file. */
const invoked = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invoked) await main();
