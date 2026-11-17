/* Aircheck MCP — the pieces the server and the bridge share.
 *
 * This file is a deliberate MIRROR, not an import. The MCP server runs under plain node on a
 * stranger's machine, started by Claude Code or Codex from a config entry; it cannot depend on the
 * Next.js app's TypeScript, its build, or even on the repo being present. So the manifest format
 * (src/server/manifest.ts), the media allow-list (src/server/media.ts) and the config shape
 * (src/server/config.ts) are reimplemented here byte-for-byte.
 *
 * If you change one side, change the other. The app reads the files this writes. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ---------------------------------------------------------------- config */

export const expand = (p) =>
  p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;

/** Where the config is: AIRCHECK_CONFIG, else aircheck.config.json beside the cwd. */
export function configPath() {
  return expand(process.env.AIRCHECK_CONFIG || path.join(process.cwd(), 'aircheck.config.json'));
}

/* The places a config can plausibly be, in the order worth trying. `configure` reports which one
 * it found, or that it found none; nothing here guesses a setup into existence. */
export function configCandidates() {
  const here = process.cwd();
  const list = [
    process.env.AIRCHECK_CONFIG && expand(process.env.AIRCHECK_CONFIG),
    path.join(here, 'aircheck.config.json'),
    path.join(os.homedir(), '.aircheck', 'aircheck.config.json'),
    path.join(os.homedir(), '.config', 'aircheck', 'aircheck.config.json'),
    path.join(os.homedir(), 'aircheck.config.json'),
  ].filter(Boolean);
  return [...new Set(list)];
}

export function findConfig() {
  for (const f of configCandidates()) if (fs.existsSync(f)) return f;
  return null;
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The config as the app reads it, with the same defaults. `file` overrides the lookup. */
export function loadConfig(file) {
  const from = file || findConfig() || configPath();
  const raw = readJson(from) || {};
  const agents = raw.agents || { default: 'claude', timeoutMinutes: 20, commands: {} };
  const dataDir = expand(raw.dataDir || '~/.aircheck');
  return {
    file: from,
    exists: fs.existsSync(from),
    dataDir,
    timezone: raw.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    queue: (raw.queue || []).map((q) => (q && q.dir ? { ...q, dir: expand(q.dir) } : q)),
    mediaRoots: (raw.mediaRoots || []).map(expand),
    bridge: {
      port: Number(process.env.AIRCHECK_BRIDGE_PORT || (raw.bridge && raw.bridge.port) || 3327),
      host: process.env.AIRCHECK_BRIDGE_HOST || (raw.bridge && raw.bridge.host) || '127.0.0.1',
      origins: originsFrom(raw),
    },
    agents: {
      default: agents.default || 'claude',
      timeoutMinutes: agents.timeoutMinutes || 20,
      workspace: agents.workspace ? expand(agents.workspace) : undefined,
      commands: agents.commands || {},
    },
  };
}

/* CORS for the bridge. The hosted shell is the only page that has any business asking localhost
 * for a file, so the list is short and closed: the production origin and the local dev server. */
export const DEFAULT_ORIGINS = ['https://aircheck.dev', 'http://localhost:3326'];

function originsFrom(raw) {
  const env = (process.env.AIRCHECK_BRIDGE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;
  const fromConfig = (raw.bridge && raw.bridge.origins) || [];
  return fromConfig.length ? fromConfig : DEFAULT_ORIGINS;
}

/** The queue folders a setup writes into. A setup with no folder queue still has the default one. */
export function queueDirs(cfg) {
  /* Only a folder source is Aircheck's to write into. Another source (a day-plan) belongs to the
   * pipeline that writes it, and a manifest dropped there would land in that pipeline's files. */
  const dirs = (cfg.queue || []).filter((q) => q && q.dir && (q.source || 'folder') === 'folder').map((q) => q.dir);
  return dirs.length ? dirs : [path.join(cfg.dataDir, 'queue')];
}

export const queueDir = (cfg) => queueDirs(cfg)[0];

/** Everything the bridge may serve: the configured media roots, plus the data dir. */
export const mediaRootsOf = (cfg) => [...(cfg.mediaRoots || []), cfg.dataDir];

/* ------------------------------------------------------- media (src/server/media.ts) */

const KINDS = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image', '.svg': 'image',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video',
  '.pdf': 'doc', '.md': 'doc', '.txt': 'doc', '.html': 'doc',
};

export const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/plain; charset=utf-8',
};

export const mediaKind = (p) => KINDS[path.extname(p).toLowerCase()] || 'other';

/* THE ALLOW-LIST. Resolve symlinks on both sides, then require the real file to be the real root
 * or to sit under it. `..` cannot escape, because realpath has already flattened it, and a symlink
 * pointing out of a root resolves to its target and fails the prefix test. Returns the real path
 * to serve, or null — and null is the only answer a caller may act on. */
export function allowed(file, roots) {
  let real;
  try { real = fs.realpathSync(file); } catch { return null; }
  for (const r of roots) {
    let root;
    try { root = fs.realpathSync(r); } catch { continue; }
    if (real === root || real.startsWith(root + path.sep)) return real;
  }
  return null;
}

/* ---------------------------------------------- manifest (src/server/manifest.ts) */

export const POST_STATUSES = ['queued', 'sent', 'held', 'failed'];
export const AD_STATUSES = ['draft', 'review', 'approved', 'live', 'archived'];
const list = (xs) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/** Is this manifest an ad creative? The `ad` key alone decides, valid or not. */
export const isAd = (raw) => !!raw && typeof raw === 'object' && raw.ad !== undefined;

/** Is this manifest an email? The `email` key alone decides. An email keeps a post's statuses. */
export const isEmail = (raw) => !!raw && typeof raw === 'object' && raw.email !== undefined;

function emailProblems(e, where) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return [`${where}"email" must be an object with at least a "subject", or be left out for a post`];
  const out = [];
  if (typeof e.subject !== 'string' || !e.subject.trim()) out.push(`${where}"email.subject" is required and must be the subject line`);
  for (const k of ['from', 'replyTo', 'preheader', 'text']) if (e[k] !== undefined && typeof e[k] !== 'string') out.push(`${where}"email.${k}" must be a string, or be left out`);
  if (e.to !== undefined && typeof e.to !== 'string' && !(Array.isArray(e.to) && e.to.every((t) => typeof t === 'string'))) out.push(`${where}"email.to" must be an address, a list name, or a list of them`);
  if (e.html !== undefined) {
    const h = e.html;
    if (typeof h === 'string' ? !h.trim() : !h || typeof h !== 'object' || (!h.path && !h.url)) out.push(`${where}"email.html" must be the path or URL of the rendered message`);
  }
  if (e.html === undefined && e.text === undefined) out.push(`${where}"email" needs the message: "html" (a path or URL) or "text"`);
  return out;
}

function statusProblem(m, where) {
  if (m.status === undefined) return null;
  const ad = isAd(m);
  const mine = ad ? AD_STATUSES : POST_STATUSES;
  const other = ad ? POST_STATUSES : AD_STATUSES;
  if (mine.includes(m.status)) return null;
  if (other.includes(m.status)) {
    return ad
      ? `${where}"status" is "${m.status}", which is a post's status, but this manifest has an "ad" block. A creative's status is ${list(AD_STATUSES)}. Remove the "ad" block if this is a post`
      : `${where}"status" is "${m.status}", which is an ad creative's status, but this manifest has no "ad" block. A post's status is ${list(POST_STATUSES)}. Add an "ad" block with a "product" if this is a creative`;
  }
  return `${where}"status" must be one of ${list(mine)}${ad ? ' for an ad creative' : ''}`;
}

function adProblems(ad, where) {
  if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return [`${where}"ad" must be an object with at least a "product", or be left out for a post`];
  const out = [];
  if (typeof ad.product !== 'string' || !ad.product.trim()) out.push(`${where}"ad.product" is required and must name what the creative is about`);
  for (const k of ['format', 'run', 'recipe']) if (ad[k] !== undefined && (typeof ad[k] !== 'string' || !ad[k].trim())) out.push(`${where}"ad.${k}" must be a non-empty string, or be left out`);
  if (ad.approved !== undefined && typeof ad.approved !== 'boolean') out.push(`${where}"ad.approved" must be true or false`);
  return out;
}
const isUrl = (s) => /^https?:\/\//i.test(s);

/** Everything wrong with a manifest, in the words a person fixing it needs. Empty means valid. */
export function manifestProblems(raw, file) {
  const where = file ? `${path.basename(file)}: ` : '';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [`${where}not a JSON object`];
  const m = raw;
  const out = [];
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
  else for (const [i, entry] of (m.media || []).entries()) {
    if (typeof entry === 'string') { if (!entry.trim()) out.push(`${where}media[${i}] is empty`); continue; }
    if (!entry || typeof entry !== 'object') { out.push(`${where}media[${i}] must be a path, a URL or an object`); continue; }
    if (!entry.path && !entry.url) out.push(`${where}media[${i}] needs a "path" or a "url"`);
  }
  if (m.text !== undefined && typeof m.text !== 'string') out.push(`${where}"text" must be the post copy as a string`);
  if (m.status === 'sent' && m.postUrl !== undefined && m.postUrl !== null && typeof m.postUrl !== 'string') out.push(`${where}"postUrl" must be the permalink as a string`);
  return out;
}

/** Resolve one entry against the folder its manifest sits in. Relative paths are relative to it. */
export function resolveSource(entry, dir) {
  const o = typeof entry === 'string' ? { path: entry } : entry;
  const raw = ((o && (o.url || o.path)) || '').trim();
  if (!raw) return null;
  if (isUrl(raw)) return { path: raw, kind: mediaKind(new URL(raw).pathname), src: 'url', alt: o.alt };
  const abs = path.isAbsolute(raw) ? raw : path.join(dir, raw);
  return { path: abs, kind: mediaKind(abs), src: 'local', alt: o.alt, missing: !fs.existsSync(abs) };
}

export function resolveMedia(media, dir) {
  const all = (media || []).map((e) => resolveSource(e, dir)).filter(Boolean);
  return { media: all.filter((r) => !r.missing), missing: all.filter((r) => r.missing).map((r) => r.path) };
}

export const inferKind = (m, n) => m.kind || (n > 1 ? 'carousel' : n === 1 ? 'image' : 'text');

/** The manifest as the MCP server and the docs write it: stable key order, trailing newline. */
export function serialize(m) {
  const ordered = {
    lane: m.lane, at: m.at, kind: m.kind, title: m.title, text: m.text,
    media: m.media, status: m.status || (m.ad ? 'draft' : 'queued'), ad: m.ad, email: m.email, postUrl: m.postUrl, url: m.url, meta: m.meta,
  };
  const clean = Object.fromEntries(Object.entries(ordered).filter(([, v]) => v !== undefined));
  return JSON.stringify(clean, null, 2) + '\n';
}

/** <queue>/<YYYY-MM-DD>/<id>.json — the one place a manifest ever lives. */
export const manifestPath = (queue, day, id) =>
  path.join(queue, day, `${String(id).replace(/[^a-z0-9._-]/gi, '-').replace(/\.{2,}/g, '-').replace(/^[.-]+/, '') || 'post'}.json`);

/** The day a post belongs to, in the lane's timezone, from its send time. */
export function dayOf(at, tz) {
  const d = at ? new Date(at) : new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const today = (tz) => dayOf(undefined, tz);

/** An id nobody has to think about: the lane, the minute, and enough randomness to not collide. */
export function newId(lane, at) {
  const d = at ? new Date(at) : new Date();
  const stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${String(lane || 'post').replace(/[^a-z0-9._-]/gi, '-')}-${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}
