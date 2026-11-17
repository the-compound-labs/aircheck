/* THE LOCAL MEDIA BRIDGE.
 *
 * A hosted HTTPS page cannot read file:// — browsers forbid it outright. It can load
 * http://localhost, which browsers treat as a secure origin, so this is not mixed content. That
 * one fact is the whole reason this process exists: it is how aircheck.dev shows you
 * a slide that never left your disk.
 *
 *   GET /media?p=<absolute path>
 *
 * It serves a file only when src/server/media.ts's allow-list would: resolve symlinks, then
 * require the real file to sit inside a configured mediaRoot or the dataDir. `..` cannot escape,
 * because realpath flattened it before the check; a symlink pointing out of a root resolves to its
 * target and fails. Everything else is a 403 with no information in it.
 *
 * Range is supported because a video has to scrub. CORS is scoped to the Aircheck origins and
 * nothing else; a page on any other origin gets no header and the browser drops the response.
 *
 * Run it:        node mcp/bridge.mjs
 * Or import it:  import { start } from './bridge.mjs'; const b = await start();
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DEFAULT_ORIGINS, TYPES, allowed, findConfig, loadConfig, mediaRootsOf } from './lib.mjs';

/* THE MACHINE'S API, for aircheck.dev. Previews, Fix / Example / Feedback, revising a run, Replace
 * and Undo all need this machine: its pipelines, its agents, its files. The hosted page calls them
 * here, on the same paths the local app serves (/api/runs..., /api/studio), and this runs the very
 * same code: mcp/local-api.mjs is src/server/local-api.ts, bundled. Loaded on first use, so the
 * media path never pays for it. */
let api;
const localApi = async () => (api ||= import('./local-api.mjs'));

/* After a Replace or Undo rewrote a post or creative on disk, the account gets the new copy. */
async function syncRows(rows, env = process.env) {
  if (!rows.length || !env.AIRCHECK_TOKEN) return;
  const base = (env.AIRCHECK_URL || 'https://aircheck.dev').replace(/\/$/, '');
  await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AIRCHECK_TOKEN}` },
    body: JSON.stringify({ manifests: rows }),
  }).catch(() => {});
}

/* THE TEST POST. One sample post, sent from this machine to the account with this machine's token,
 * so the connect checklist can show a post arriving without waiting for a real job. Its image is a
 * URL on aircheck.dev, so it draws whether or not any media root is configured yet. */
export async function testPost(timezone = 'UTC', env = process.env, fetchFn = globalThis.fetch) {
  if (!env.AIRCHECK_TOKEN) return { ok: false, error: 'This machine has no AIRCHECK_TOKEN, so nothing can reach your account.' };
  const base = (env.AIRCHECK_URL || 'https://aircheck.dev').replace(/\/$/, '');
  const at = new Date(Date.now() + 15 * 60_000).toISOString();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(at));
  const manifest = {
    lane: 'aircheck-test', at, kind: 'image', title: 'Aircheck test post',
    text: 'This test post comes from your machine. You can approve it, hold it, or leave it. Nothing will be published.',
    media: [`${base}/landing-assets/sample-media/post.png`], status: 'queued', postUrl: null,
    meta: { platform: 'instagram', test: true },
  };
  try {
    const r = await fetchFn(`${base}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AIRCHECK_TOKEN}` },
      body: JSON.stringify({ manifests: [{ id: `aircheck-test-${Date.now()}`, day, manifest }] }),
    });
    if (!r.ok) return { ok: false, error: `aircheck.dev answered ${r.status}.` };
    return { ok: true, day };
  } catch (e) {
    return { ok: false, error: `Could not reach ${base}: ${e && e.message ? e.message : e}` };
  }
}

const readBody = (req) => new Promise((resolve) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > 65536) { req.destroy(); resolve({}); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { resolve({}); } });
  req.on('error', () => resolve({}));
});

async function serveApi(req, res, url, timezone) {
  const { localApi: run, changedRows } = await localApi();
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
  const r = await run(req.method, url.pathname, url.searchParams, body);
  if (r.changed) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    await syncRows(changedRows(r.changed, today));
  }
  res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(r.body));
}

const typeOf = (p) => TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';

/** The one Range form that matters: bytes=a-b, bytes=a-, bytes=-n. Anything else is unsatisfiable. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start, end;
  if (a === '') { const n = Number(b); if (!n) return 'invalid'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(a); end = b === '' ? size - 1 : Math.min(Number(b), size - 1); }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

function cors(res, origin, origins) {
  // Only an exact match gets a header. No wildcard: a wildcard would let any page on the internet
  // read every file under the user's media roots.
  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
  /* Chrome asks before a public page reaches a loopback address. Only an allowed origin is told yes. */
  if (origin && origins.includes(origin)) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  res.setHeader('Access-Control-Max-Age', '600');
}

const fail = (res, code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg + '\n'); };

export function handler({ roots, origins, timezone = 'UTC', info = {} }) {
  return function onRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    cors(res, req.headers.origin, origins);

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    /* The API starts agents and rewrites queued posts, so it answers only a page on an allowed
     * origin. Checked on the request itself, not left to CORS: a form post from another site
     * would reach this port, and CORS only hides the answer. */
    if (url.pathname.startsWith('/api/')) {
      if (!req.headers.origin || !origins.includes(req.headers.origin)) return fail(res, 403, 'Only Aircheck may call this.');
      if (url.pathname === '/api/test-post' && req.method === 'POST') {
        testPost(timezone).then((r) => { res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(r)); });
        return;
      }
      serveApi(req, res, url, timezone).catch((e) => { if (!res.headersSent) fail(res, 500, e && e.message ? e.message : String(e)); });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Only GET and HEAD.');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, roots, origins, ...info, config: !!findConfig() }) + '\n');
      return;
    }
    if (url.pathname !== '/media') return fail(res, 404, 'The bridge serves GET /media?p=<absolute path>.');

    const p = url.searchParams.get('p');
    if (!p) return fail(res, 400, 'Pass the file as ?p=<absolute path>.');

    // The allow-list is the only gate, and it answers before anything is opened.
    const real = allowed(p, roots);
    if (!real) return fail(res, 403, 'Not in an allowed media root.');

    let stat;
    try { stat = fs.statSync(real); } catch { return fail(res, 404, 'Gone.'); }
    if (!stat.isFile()) return fail(res, 403, 'Not a file.');

    const head = {
      'Content-Type': typeOf(real),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${path.basename(real).replace(/"/g, '')}"`,
    };

    const range = parseRange(req.headers.range, stat.size);
    if (range === 'invalid') {
      res.writeHead(416, { ...head, 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    if (range) {
      const len = range.end - range.start + 1;
      res.writeHead(206, { ...head, 'Content-Length': String(len), 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(real, { start: range.start, end: range.end }).on('error', () => res.destroy()).pipe(res);
      return;
    }

    res.writeHead(200, { ...head, 'Content-Length': String(stat.size) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
  };
}

/** Start the bridge. Returns { server, port, url, roots, origins, close }. */
export function start(opts = {}) {
  const cfg = opts.config || loadConfig(opts.configFile);
  const roots = (opts.roots || mediaRootsOf(cfg)).filter(Boolean);
  const origins = opts.origins || cfg.bridge.origins || DEFAULT_ORIGINS;
  const host = opts.host || cfg.bridge.host || '127.0.0.1';
  const port = opts.port !== undefined ? opts.port : cfg.bridge.port;

  /* The bundled API reads the config the way the app does, from AIRCHECK_CONFIG. Point it at the
   * file this server found, so both read the same one. */
  if (!process.env.AIRCHECK_CONFIG) { const f = opts.configFile || findConfig(); if (f) process.env.AIRCHECK_CONFIG = f; }
  const server = http.createServer(handler({ roots, origins, timezone: cfg.timezone, info: { version: opts.version, standing: !!opts.standing } }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const bound = server.address().port;
      resolve({
        server, port: bound, host, roots, origins,
        url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${bound}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await start();
  process.stderr.write(`aircheck bridge on ${b.url}/media?p=<path>\n  roots: ${b.roots.join(', ') || '(none configured)'}\n  cors:  ${b.origins.join(', ')}\n`);
}
