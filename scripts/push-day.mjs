#!/usr/bin/env node
/* PUSH A DAY TO AN ACCOUNT. For a setup whose posts and creatives come from a source the MCP server
 * does not write (a day-plan, an ad catalog), this reads the day the way the local app already
 * does and pushes it to the account as manifests: JSON only. Media stay where they are; a local
 * file goes up as its path, for the browser to fetch from the media bridge on this machine.
 *
 *   AIRCHECK_TOKEN=ac_... node scripts/push-day.mjs [--day YYYY-MM-DD] [--from http://localhost:3326] [--to https://aircheck.dev]
 *
 * --from is a running local Aircheck (npm run dev) reading this machine's config. */
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg('--from', 'http://localhost:3326').replace(/\/$/, '');
const TO = arg('--to', process.env.AIRCHECK_URL || 'https://aircheck.dev').replace(/\/$/, '');
const TOKEN = process.env.AIRCHECK_TOKEN;
if (!TOKEN) { console.error('Set AIRCHECK_TOKEN (issue one on /account).'); process.exit(1); }

const get = async (p) => { const r = await fetch(FROM + p); if (!r.ok) throw new Error(`${FROM}${p} answered ${r.status}`); return r.json(); };
const q = await get(`/api/queue${arg('--day') ? `?day=${arg('--day')}` : ''}`);
const day = q.day;
const { ads = [] } = await get('/api/ads');

const safeId = (s) => String(s).replace(/[^a-z0-9._-]/gi, '-').slice(0, 120);
const ref = (m) => (m.alt ? { [m.src === 'url' ? 'url' : 'path']: m.path, alt: m.alt } : m.path);
/* meta is the producer's own detail; keep it only while it stays small. */
const small = (meta) => (meta && JSON.stringify(meta).length < 4000 ? meta : undefined);
const POST = new Set(['queued', 'sent', 'held', 'failed']);

const rows = [];
for (const it of q.items || []) {
  rows.push({
    id: safeId(String(it.id).replace(/^\d{4}-\d{2}-\d{2}:/, '').replace(/\.json$/, '')),
    day,
    origin: it.origin?.path,
    manifest: {
      lane: it.lane, at: it.at, kind: it.kind, title: it.title, text: it.text,
      media: (it.media || []).map(ref), status: POST.has(it.status) ? it.status : 'queued',
      postUrl: it.postUrl ?? null, url: it.url, meta: small(it.meta),
      ...(it.email ? { email: { ...it.email, html: it.email.html ? (it.email.html.src === 'url' ? { url: it.email.html.path } : it.email.html.path) : undefined } } : {}),
    },
  });
}
for (const c of ads) {
  rows.push({
    id: safeId(`ad-${c.id}`),
    day,
    origin: c.origin?.path,
    manifest: {
      lane: c.lane || c.format, at: c.createdAt, kind: c.kind, title: c.title, text: c.text,
      media: (c.media || []).map(ref), status: c.status,
      ad: { product: c.product, format: c.format, run: c.run, approved: !!c.approved, recipe: c.recipe },
      meta: small(c.meta),
    },
  });
}

let saved = 0; const rejected = [];
for (let i = 0; i < rows.length; i += 100) {
  const r = await fetch(`${TO}/api/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ manifests: rows.slice(i, i + 100) }),
  });
  const body = await r.json().catch(() => ({}));
  saved += body.saved || 0;
  rejected.push(...(body.rejected || []));
  if (!r.ok && !body.saved) console.error(`${TO}/api/sync answered ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
}
console.log(JSON.stringify({ day, posts: (q.items || []).length, creatives: ads.length, saved, rejected: rejected.length, firstRejected: rejected.slice(0, 3) }, null, 2));
