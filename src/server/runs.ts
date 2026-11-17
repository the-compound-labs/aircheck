import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expand, readJson, type Config } from './config';
import { mediaKind, ref } from './media';
import type { AdCreative, Lane, Product, QueueItem, Run, RunAction, RunOutput } from './types';

/* PREVIEW RUNS. A run is one headless agent (Codex or Claude) asked to build ONE example post for a
 * lane, the way that lane really builds it, without publishing anything. Each run owns a folder:
 *
 *   <dataDir>/runs/<id>/run.json    status and the finished output
 *                       prompt.md   exactly what the agent was told
 *                       agent.log   its stdout and stderr
 *                       out/        everything it made, and out/post.json
 *
 * The agent starts with that folder as its working directory. With Codex in workspace-write it can
 * read the lane's pipeline anywhere but write only there, with no network, so a preview cannot post.
 * A comment on a finished run starts a new run that revises it (parent = the old run).
 * State lives on disk, so a run survives a dev-server restart: a run whose process is gone is
 * finished from what it left in out/. */

const runsDir = (cfg: Config) => path.join(cfg.dataDir, 'runs');
const runDir = (cfg: Config, id: string) => path.join(runsDir(cfg), id.replace(/[^a-z0-9-]/gi, ''));
const outDir = (cfg: Config, id: string) => path.join(runDir(cfg, id), 'out');

function save(cfg: Config, run: Run) {
  const f = path.join(runDir(cfg, run.id), 'run.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(run, null, 2));
  fs.renameSync(f + '.tmp', f);
}

const alive = (pid?: number) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/* What the agent left behind: out/post.json if it wrote one, otherwise every media file in out/. */
export function collectOutput(dir: string): RunOutput | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const post = readJson<{ kind?: string; text?: string; thread?: string[]; media?: (string | { path: string })[]; notes?: string }>(path.join(dir, 'post.json'));
  const resolve = (m: string) => (path.isAbsolute(m) ? m : path.join(dir, m));
  if (post) {
    const media = (post.media || []).map((m) => resolve(typeof m === 'string' ? m : m.path)).filter((m) => fs.existsSync(m)).map(ref);
    return { kind: post.kind, text: post.text, thread: post.thread, media, notes: post.notes };
  }
  const files = fs.readdirSync(dir).filter((n) => mediaKind(n) !== 'other' && n !== 'post.json').sort();
  return files.length ? { media: files.map((n) => ref(path.join(dir, n))) } : undefined;
}

function finish(cfg: Config, run: Run, exitCode: number | null, error?: string): Run {
  if (run.status !== 'running') return run;
  const output = collectOutput(outDir(cfg, run.id));
  const ok = !!output && (!!output.text || output.media.length > 0 || !!output.thread?.length);
  const next: Run = {
    ...run, exitCode, finishedAt: new Date().toISOString(), output,
    status: ok ? 'done' : 'failed',
    error: ok ? undefined : error || (exitCode ? `The agent exited with code ${exitCode} and left no post.` : 'The agent finished without writing out/post.json.'),
  };
  save(cfg, next);
  return next;
}

/* A running run whose process is gone, or that has outlived the timeout, is finished now. */
function reconcile(cfg: Config, run: Run): Run {
  if (run.status !== 'running') return run;
  const age = Date.now() - Date.parse(run.createdAt);
  if (age > cfg.agents.timeoutMinutes * 60000) {
    if (alive(run.pid)) { try { process.kill(-run.pid!, 'SIGTERM'); } catch { /* already gone */ } }
    return finish(cfg, run, null, `Stopped after ${cfg.agents.timeoutMinutes} minutes.`);
  }
  if (!alive(run.pid)) return finish(cfg, run, null);
  return run;
}

/* A run records where its files were when it finished. Rename or move the data dir and every one of those absolute paths goes
 * stale while the files themselves are fine, sitting in the run's own out/ folder. So a recorded
 * path that is gone is re-resolved against the run's current home before anyone is told it is
 * missing. The run folder is the truth; the path inside it is only a note of where it once was. */
function rehome(cfg: Config, run: Run): Run {
  const media = run.output?.media;
  if (!media?.length) return run;
  const out = outDir(cfg, run.id);
  let moved = false;
  const next = media.map((m) => {
    if (m.src === 'url' || fs.existsSync(m.path)) return m;
    /* Keep whatever the file sat under inside out/ — a carousel keeps its own subfolder — and
     * fall back to the bare name for a path that was not shaped that way. */
    const under = m.path.split(`${path.sep}out${path.sep}`).slice(1).join(`${path.sep}out${path.sep}`);
    for (const rel of [under, path.basename(m.path)]) {
      if (!rel) continue;
      const here = path.join(out, rel);
      if (fs.existsSync(here)) { moved = true; return { ...m, path: here }; }
    }
    return m;
  });
  return moved ? { ...run, output: { ...run.output!, media: next } } : run;
}

export function getRun(cfg: Config, id: string): Run | null {
  const run = readJson<Run>(path.join(runDir(cfg, id), 'run.json'));
  return run ? rehome(cfg, reconcile(cfg, run)) : null;
}

export function listRunsFor(cfg: Config, day: string, id: string): Run[] {
  return listRuns(cfg).filter((r) => r.target?.day === day && r.target.id === id);
}

export function saveRun(cfg: Config, run: Run) { save(cfg, run); }
export function runOutDir(cfg: Config, id: string) { return outDir(cfg, id); }
export function runFolder(cfg: Config, id: string) { return runDir(cfg, id); }

export function listRuns(cfg: Config, lane?: string): Run[] {
  let ids: string[] = [];
  try { ids = fs.readdirSync(runsDir(cfg)); } catch { return []; }
  return ids
    .map((id) => getRun(cfg, id))
    .filter((r): r is Run => !!r && (!lane || r.lane === lane))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Files the agent has written to out/ so far, newest last. */
export function runFiles(cfg: Config, id: string): string[] {
  const dir = outDir(cfg, id);
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).map((n) => path.join(dir, n))
      .filter((f) => fs.statSync(f).isFile()).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  } catch { return []; }
}

/** When each file in out/ was last written, ms since epoch, for the run's step timings. */
export function runFileTimes(cfg: Config, id: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of runFiles(cfg, id)) { try { out[f] = Math.round(fs.statSync(f).mtimeMs); } catch { /* gone */ } }
  return out;
}

export function runLog(cfg: Config, id: string, max = 20000): string {
  try {
    const f = path.join(runDir(cfg, id), 'agent.log');
    const size = fs.statSync(f).size;
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(Math.min(size, max));
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - max));
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

export function buildPrompt(o: { lane: Lane; format?: string; product?: Product; request?: string; out: string; workspace?: string; parent?: Run; comment?: string; action?: RunAction; item?: QueueItem; rules?: string[] }) {
  const f = o.lane.formats.find((x) => x.id === o.format);
  const L: string[] = [];
  L.push(`You are building a PREVIEW of one social post so a person can see how it will look before anything goes live. Nothing you make is published.`);
  L.push('');
  L.push(`## The lane`);
  L.push(`- id: ${o.lane.id}`);
  L.push(`- name: ${o.lane.name}`);
  L.push(`- platform: ${o.lane.platform}${o.lane.handle ? `, account ${o.lane.handle}` : ''}`);
  if (o.lane.voice) L.push(`- voice: ${o.lane.voice}`);
  if (o.lane.brief) L.push(`- what it posts: ${o.lane.brief}`);
  if (f) L.push(`- format to preview: ${f.label}${f.note ? ` (${f.note})` : ''}${f.module ? `, built by ${f.module}` : ''}`);
  else if (o.lane.formats.length) L.push(`- formats this lane runs: ${o.lane.formats.map((x) => x.label).join('; ')}. Pick the one that best fits the request.`);
  if (o.product) {
    L.push('');
    L.push(`## The product this post is about`);
    L.push(`- ${o.product.name}${o.product.url ? `, ${o.product.url}` : ''}${o.product.repository ? `, source at ${o.product.repository}` : ''}`);
  }
  if (o.item) {
    const it = o.item;
    const verb = o.action === 'repair'
      ? 'REPAIR this queued post. Rebuild it through the pipeline that made it and fix what is wrong. Keep the same format, slide count, aspect and voice unless the person asks otherwise. If files are missing, rebuild exactly those.'
      : o.action === 'feedback'
        ? 'REVISE this queued post from the person\'s comment. Change only what the comment asks; keep everything else the same.'
        : 'Make a fresh EXAMPLE of this post: run the pipeline that made it again, with the same inputs, for a new take.';
    L.push('');
    L.push(`## The queued post you are working from`);
    L.push(verb);
    L.push(`- id: ${it.id}, day ${it.day}, sends ${it.at || 'unscheduled'}, format ${it.kind}`);
    if (it.meta && Object.keys(it.meta).length) L.push(`- producer details: ${JSON.stringify(it.meta)}`);
    if (it.url) L.push(`- links to: ${it.url}`);
    if (it.media.length) { L.push(`- its files, in order (read them, never edit them):`); for (const m of it.media) L.push(`  - ${m.path}`); }
    if (it.missing?.length) { L.push(`- files the producer names that are NOT on disk:`); for (const m of it.missing) L.push(`  - ${m}`); }
    if (it.text) { L.push(`- its copy, exactly:`); L.push('```'); L.push(it.text); L.push('```'); }
    if (o.action === 'repair' && it.meta && 'deck' in it.meta) L.push(`- If the post carries a PDF document (LinkedIn carousels do), also write the slides as one PDF named deck.pdf in the output folder.`);
  }
  if (o.request) { L.push(''); L.push(o.item ? `## What the person said` : `## What the person asked for`); L.push(o.request); }
  if (o.parent) {
    L.push('');
    L.push(`## This is a revision`);
    L.push(`The previous version is in ${path.join(path.dirname(o.out), '..', o.parent.id, 'out')} (its post.json and media). The person commented:`);
    L.push(`> ${(o.comment || '').replace(/\n/g, '\n> ')}`);
    L.push(`Make a new version that does what the comment asks. Keep everything the comment does not mention the same. Copy and re-render files from the previous version as needed; never edit the previous version's folder.`);
  }
  L.push('');
  L.push(`## How to work`);
  L.push(`1. Learn how this lane really builds this kind of post before you make anything. Read these first:`);
  for (const r of o.lane.references || []) L.push(`   - ${r}`);
  if (o.workspace) L.push(`   The lane pipelines live under ${o.workspace}. Use the lane's own renderers, templates, voice docs and copy rules. Do not invent a look the lane does not have.`);
  L.push(`2. Run renderers and generators only in a dry, preview or local mode. If a step can only run live, fake that one step and say so in notes.`);
  L.push(`3. Hard limits. Never post, send, publish, schedule, upload or arm anything. Never touch ARMED flags, posted.json, cadence, state, ledger, queue or plan files. Never call a paid API. Never open a browser session that is signed in to a social account. Write files only inside ${o.out}.`);
  L.push(`4. Put every finished file in ${o.out}, at the size and aspect the platform shows it.`);
  let n = 5;
  for (const r of o.rules || []) L.push(`${n++}. ${r}`);
  L.push(`${n}. Finish by writing ${path.join(o.out, 'post.json')}:`);
  L.push('```json');
  L.push(`{ "kind": "carousel | image | video | text | thread | article", "text": "the post copy exactly as it would go out", "thread": ["only for threads: each post in order"], "media": ["file names in ${o.out}, in display order"], "notes": "one or two lines: which pipeline you used and anything that differs from a real run" }`);
  L.push('```');
  return L.join('\n');
}

/* THE AD PROMPT. A creative is reviewed, not scheduled, so the agent is told about a product and a
 * placement instead of a lane and a send time. The hard limits are the same, with one more: ad
 * media is what money is spent against, so the agent may not touch a campaign, budget or upload. */
export function buildAdPrompt(o: { ad: AdCreative; request?: string; out: string; adWorkspace?: string; parent?: Run; comment?: string; action?: RunAction; rules?: string[] }) {
  const c = o.ad;
  const L: string[] = [];
  L.push(`You are building a PREVIEW of one AD CREATIVE so a person can see it before it is put behind money. Nothing you make is uploaded, launched or spent against.`);
  L.push('');
  L.push(`## The creative you are working from`);
  const verb = o.action === 'repair'
    ? 'REPAIR this creative. Rebuild it through the pipeline that made it and fix what is wrong. Keep the same product, placement, slide count and aspect unless the person asks otherwise. If files are missing, rebuild exactly those.'
    : o.action === 'feedback'
      ? 'REVISE this creative from the person\'s comment. Change only what the comment asks; keep everything else the same.'
      : 'Make a fresh EXAMPLE of this creative: run the pipeline that made it again, with the same inputs, for a new take.';
  L.push(verb);
  L.push(`- id: ${c.id}`);
  L.push(`- product: ${c.product}`);
  L.push(`- placement: ${c.format} (${c.kind})`);
  L.push(`- where it is: ${c.status}${c.stage ? `, the producer calls this stage "${c.stage}"` : ''}`);
  if (c.title) L.push(`- its title: ${c.title}`);
  if (c.recipe) L.push(`- the recipe that built it: ${c.recipe}`);
  if (c.origin?.dir) L.push(`- the production run it came from: ${c.origin.dir}`);
  if (c.meta && Object.keys(c.meta).length) L.push(`- producer details: ${JSON.stringify(c.meta)}`);
  if (c.media.length) { L.push(`- its files, in order (read them, never edit them):`); for (const m of c.media) L.push(`  - ${m.path}`); }
  if (c.missing?.length) { L.push(`- files the producer names that are NOT on disk:`); for (const m of c.missing) L.push(`  - ${m}`); }
  if (c.text) { L.push(`- its copy, exactly:`); L.push('```'); L.push(c.text); L.push('```'); }
  if (o.request) { L.push(''); L.push(`## What the person said`); L.push(o.request); }
  if (o.parent) {
    L.push('');
    L.push(`## This is a revision`);
    L.push(`The previous version is in ${path.join(path.dirname(o.out), '..', o.parent.id, 'out')} (its post.json and media). The person commented:`);
    L.push(`> ${(o.comment || '').replace(/\n/g, '\n> ')}`);
    L.push(`Make a new version that does what the comment asks. Keep everything the comment does not mention the same. Never edit the previous version's folder.`);
  }
  L.push('');
  L.push(`## How to work`);
  L.push(`1. Learn how this product's ad media is really built before you make anything.`);
  if (o.adWorkspace) L.push(`   The ad pipelines live under ${o.adWorkspace}. Use the real renderer, the product's own registry theme, its real logo and its real fonts. Do not invent a look the product does not have, and never type out a placeholder wordmark or substitute a stand-in font.`);
  if (c.recipe) L.push(`   Start from the recipe above and the manifests beside it in the production run.`);
  L.push(`2. Run renderers and generators only in a dry, preview or local mode. If a step can only run live, fake that one step and say so in notes.`);
  L.push(`3. Hard limits. Never upload, publish, launch, arm or schedule an ad. Never touch a campaign, ad set, budget, bid, billing or any advertising account. Never change the producer's own catalog, manifest or receipts. Never call a paid API. Write files only inside ${o.out}.`);
  L.push(`4. Put every finished file in ${o.out}, at the exact size and aspect the placement uses.`);
  let n = 5;
  for (const r of o.rules || []) L.push(`${n++}. ${r}`);
  L.push(`${n}. Finish by writing ${path.join(o.out, 'post.json')}:`);
  L.push('```json');
  L.push(`{ "kind": "${c.kind}", "text": "the ad copy exactly as it would run", "media": ["file names in ${o.out}, in display order"], "notes": "one or two lines: which pipeline you used and anything that differs from a real run" }`);
  L.push('```');
  return L.join('\n');
}

export function startRun(cfg: Config, o: { lane: Lane; format?: string; product?: Product; request?: string; agent?: string; parent?: Run; comment?: string; action?: RunAction; item?: QueueItem; ad?: AdCreative }): Run {
  const agent = o.agent || cfg.agents.default;
  const template = cfg.agents.commands[agent];
  if (!template?.length) throw new Error(`No command configured for agent '${agent}'.`);
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = runDir(cfg, id);
  const out = outDir(cfg, id);
  fs.mkdirSync(out, { recursive: true });
  const prompt = o.ad
    ? buildAdPrompt({ ad: o.ad, request: o.request, out, adWorkspace: cfg.agents.adWorkspace, parent: o.parent, comment: o.comment, action: o.action, rules: cfg.agents.adRules })
    : buildPrompt({ ...o, out, workspace: cfg.agents.workspace, rules: cfg.agents.rules });
  fs.writeFileSync(path.join(dir, 'prompt.md'), prompt);

  const workspace = (o.ad ? cfg.agents.adWorkspace : cfg.agents.workspace) || dir;
  const vars: Record<string, string> = { prompt, workspace, out };
  const fill = (s: string) => s.replace(/\{(prompt|workspace|out)\}/g, (_, k: string) => vars[k]);
  const [cmd, ...args] = template.map(fill);
  const log = fs.openSync(path.join(dir, 'agent.log'), 'a');
  const run: Run = {
    id, lane: o.lane.id, format: o.format, product: o.product?.id, agent, request: o.request,
    action: o.action || 'preview', target: o.item?.day ? { day: o.item.day, id: o.item.id } : undefined,
    ad: o.ad ? { id: o.ad.id, product: o.ad.product } : undefined,
    comment: o.comment, parent: o.parent?.id, status: 'running', createdAt: new Date().toISOString(),
  };
  const child = spawn(expand(cmd), args, {
    cwd: dir,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, CODEX_PROFILE: 'agent', AIRCHECK_RUN: id, AIRCHECK_OUT: out },
  });
  fs.closeSync(log);
  run.pid = child.pid;
  save(cfg, run);
  child.on('error', (e) => { const r = readJson<Run>(path.join(dir, 'run.json')); if (r) finish(cfg, r, 127, `Could not start ${cmd}: ${e.message}`); });
  child.on('exit', (code) => { const r = readJson<Run>(path.join(dir, 'run.json')); if (r) finish(cfg, r, code); });
  child.unref();
  return run;
}

export function cancelRun(cfg: Config, id: string): Run | null {
  const run = readJson<Run>(path.join(runDir(cfg, id), 'run.json'));
  if (!run || run.status !== 'running') return run;
  if (alive(run.pid)) { try { process.kill(-run.pid!, 'SIGTERM'); } catch { /* already gone */ } }
  const next: Run = { ...run, status: 'cancelled', finishedAt: new Date().toISOString(), output: collectOutput(outDir(cfg, id)) };
  save(cfg, next);
  return next;
}
