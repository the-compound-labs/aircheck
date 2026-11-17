/* node --test mcp/*.test.mjs
 *
 * What these cover is what would actually hurt: a manifest the app cannot read back, a send that
 * eats a field, and a bridge that hands out a file it was never allowed to see. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { start } from './bridge.mjs';
import { checkPost, configure, findManifest, listQueue, markSent, policyFor, queuePost, repair, repairStatus } from './server.mjs';
import { testPost } from './bridge.mjs';
import { allowed, dayOf, loadConfig, manifestProblems, serialize } from './lib.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aircheck-mcp-'));
const dirs = {
  data: path.join(tmp, 'data'),
  queue: path.join(tmp, 'data', 'queue'),
  media: path.join(tmp, 'media'),
  outside: path.join(tmp, 'outside'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

const configFile = path.join(tmp, 'aircheck.config.json');
fs.writeFileSync(configFile, JSON.stringify({
  dataDir: dirs.data,
  timezone: 'UTC',
  queue: [{ source: 'folder', dir: dirs.queue }],
  mediaRoots: [dirs.media],
  agents: { default: 'claude', timeoutMinutes: 1, commands: {} },
}, null, 2) + '\n');

const cfg = loadConfig(configFile);

fs.writeFileSync(path.join(dirs.media, 'slide-1.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
fs.writeFileSync(path.join(dirs.media, 'clip.mp4'), Buffer.from('0123456789abcdef'));
fs.writeFileSync(path.join(dirs.outside, 'secret.png'), 'not yours');

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* gone */ } });

describe('queue_post', () => {
  it('writes a manifest that round-trips through the app\'s own reader', () => {
    const r = queuePost(cfg, {
      lane: 'brand-x',
      at: '2026-11-07T15:30:00Z',
      kind: 'carousel',
      title: 'A title',
      text: 'Post copy exactly as it will go out',
      media: [path.join(dirs.media, 'slide-1.png'), 'slide-2.png'],
      url: 'https://example.com/thing',
      meta: { owner: 'test' },
      id: 'round-trip',
    });
    assert.equal(r.ok, true);
    assert.equal(r.id, 'round-trip');
    assert.equal(r.day, '2026-11-07');
    assert.equal(r.path, path.join(dirs.queue, '2026-11-07', 'round-trip.json'));

    const text = fs.readFileSync(r.path, 'utf8');
    // The format the app reads: 2-space indent, trailing newline, the manifest key order.
    assert.ok(text.endsWith('}\n'));
    assert.ok(text.includes('\n  "lane": "brand-x",'));
    const parsed = JSON.parse(text);
    assert.deepEqual(Object.keys(parsed), ['lane', 'at', 'kind', 'title', 'text', 'media', 'status', 'postUrl', 'url', 'meta']);
    assert.deepEqual(manifestProblems(parsed, r.path), []);
    assert.equal(serialize(parsed), text, 're-serializing must be a no-op');
    assert.equal(parsed.status, 'queued');
    assert.equal(parsed.postUrl, null);
  });

  it('puts the post in the day its send time falls on, in the configured timezone', () => {
    const r = queuePost(cfg, { lane: 'brand-x', at: '2026-03-01T02:00:00Z', id: 'tz' });
    assert.equal(r.day, dayOf('2026-03-01T02:00:00Z', 'UTC'));
    assert.equal(r.day, '2026-03-01');
    const ny = loadConfig(configFile);
    ny.timezone = 'America/New_York';
    const r2 = queuePost(ny, { lane: 'brand-x', at: '2026-03-01T02:00:00Z', id: 'tz-ny' });
    assert.equal(r2.day, '2026-02-28');
  });

  it('sanitizes the id into the filename', () => {
    const r = queuePost(cfg, { lane: 'brand-x', at: '2026-11-07T10:00:00Z', id: '../../escape me' });
    // an id is a file name, never a path: separators and dot runs cannot survive it
    assert.equal(path.basename(r.path), 'escape-me.json');
    assert.ok(!path.basename(r.path).includes('..'));
    assert.equal(path.dirname(r.path), path.join(dirs.queue, '2026-11-07'));
  });

  it('returns the problems instead of writing a bad file', () => {
    const before = fs.readdirSync(path.join(dirs.queue, '2026-11-07')).length;
    const r = queuePost(cfg, { lane: '  ', at: 'not a time', status: 'nope', media: [{}], id: 'bad' });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('"lane" is required')));
    assert.ok(r.problems.some((p) => p.includes('ISO 8601')));
    assert.ok(r.problems.some((p) => p.includes('queued, sent, held or failed')));
    assert.ok(r.problems.some((p) => p.includes('media[0] needs a "path" or a "url"')));
    assert.equal(fs.existsSync(path.join(dirs.queue, '2026-11-07', 'bad.json')), false);
    assert.equal(fs.readdirSync(path.join(dirs.queue, '2026-11-07')).length, before);
  });
});

describe('queue_post with an `ad` block', () => {
  it('writes the same manifest, as a creative: draft by default, no postUrl', () => {
    const r = queuePost(cfg, { lane: 'meta', text: 'Maple oat latte is back.', media: ['slide-1.png', 'https://cdn.you.com/slide-2.png'], ad: { product: 'harbor-coffee', format: 'carousel-feed', run: 'review-2026-11-07' }, id: 'latte', day: '2026-11-07' });
    assert.equal(r.ok, true);
    const m = JSON.parse(fs.readFileSync(r.path, 'utf8'));
    assert.deepEqual(Object.keys(m), ['lane', 'text', 'media', 'status', 'ad']);
    assert.equal(m.status, 'draft');
    assert.deepEqual(m.ad, { product: 'harbor-coffee', format: 'carousel-feed', run: 'review-2026-11-07' });
    // the app's validator agrees with the server's
    assert.deepEqual(manifestProblems(m), []);
  });

  it('refuses a status from the other ladder and writes nothing', () => {
    const r = queuePost(cfg, { lane: 'meta', status: 'queued', ad: { product: 'p' }, id: 'wrongladder', day: '2026-11-07' });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('"queued", which is a post\'s status')));
    assert.equal(fs.existsSync(path.join(dirs.queue, '2026-11-07', 'wrongladder.json')), false);
  });

  it('mark_sent takes a creative live, not sent, and keeps the block', () => {
    queuePost(cfg, { lane: 'meta', status: 'approved', ad: { product: 'p', approved: true }, id: 'goeslive', day: '2026-11-07' });
    const r = markSent(cfg, { id: 'goeslive' });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'live');
    const m = JSON.parse(fs.readFileSync(r.path, 'utf8'));
    assert.equal(m.ad.approved, true);
    assert.equal('postUrl' in m, false);
    // and "sent" is refused on a creative, with the reason
    const bad = markSent(cfg, { id: 'goeslive', status: 'sent' });
    assert.equal(bad.ok, false);
    assert.match(bad.problems[0], /post's status/);
  });
});

describe('mark_sent', () => {
  it('rewrites status and postUrl and preserves every other field byte-faithfully', () => {
    const q = queuePost(cfg, {
      lane: 'brand-linkedin', at: '2026-11-07T18:00:00Z', kind: 'carousel', title: 'Keep me',
      text: 'Copy with "quotes" and a\nnewline', media: ['a.png', { path: 'b.png', alt: 'the second slide' }],
      url: 'https://example.com', meta: { deck: true, topics: ['one', 'two'] }, id: 'sendme',
    });
    const before = JSON.parse(fs.readFileSync(q.path, 'utf8'));

    const r = markSent(cfg, { id: 'sendme', postUrl: 'https://linkedin.com/feed/update/123' });
    assert.equal(r.ok, true);
    assert.equal(r.path, q.path);
    assert.equal(r.status, 'sent');

    const after_ = JSON.parse(fs.readFileSync(q.path, 'utf8'));
    assert.equal(after_.status, 'sent');
    assert.equal(after_.postUrl, 'https://linkedin.com/feed/update/123');
    for (const k of ['lane', 'at', 'kind', 'title', 'text', 'media', 'url', 'meta']) {
      assert.deepEqual(after_[k], before[k], `${k} must survive a send untouched`);
    }
    assert.deepEqual(Object.keys(after_), Object.keys(before), 'key order must not move');
    assert.equal(serialize(after_), fs.readFileSync(q.path, 'utf8'));
  });

  it('takes a path as well as an id, and carries a non-default status', () => {
    const q = queuePost(cfg, { lane: 'brand-x', at: '2026-11-07T19:00:00Z', text: 'nope', id: 'heldme' });
    const r = markSent(cfg, { path: q.path, status: 'failed' });
    assert.equal(r.ok, true);
    const m = JSON.parse(fs.readFileSync(q.path, 'utf8'));
    assert.equal(m.status, 'failed');
    assert.equal(m.text, 'nope');
  });

  it('refuses a manifest it cannot find, and writes nothing', () => {
    const r = markSent(cfg, { id: 'no-such-post' });
    assert.equal(r.ok, false);
    assert.ok(r.problems[0].includes('no-such-post'));
    assert.equal(findManifest(cfg, { id: 'no-such-post' }), null);
  });
});

describe('list_queue', () => {
  it('returns a day as structured data, with media resolved and missing files named', () => {
    const day = '2026-11-09';
    const dir = path.join(dirs.queue, day);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'one.json'), serialize({
      lane: 'brand-x', at: `${day}T09:00:00Z`, text: 'first',
      media: [path.join(dirs.media, 'slide-1.png'), path.join(dirs.media, 'gone.png'), 'https://cdn.example.com/x.png'],
    }));
    fs.writeFileSync(path.join(dir, 'two.json'), serialize({ lane: 'brand-x', at: `${day}T08:00:00Z`, text: 'earlier' }));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ "at": "2026-11-09T07:00:00Z" }\n');

    const r = listQueue(cfg, { day });
    assert.equal(r.day, day);
    assert.equal(r.count, 2);
    assert.deepEqual(r.items.map((i) => i.id), ['two', 'one'], 'sorted by send time');

    const one = r.items.find((i) => i.id === 'one');
    assert.equal(one.kind, 'carousel');
    assert.deepEqual(one.media.map((m) => m.path), [path.join(dirs.media, 'slide-1.png'), 'https://cdn.example.com/x.png']);
    assert.deepEqual(one.media.map((m) => m.src), ['local', 'url']);
    assert.deepEqual(one.missing, [path.join(dirs.media, 'gone.png')]);
    assert.equal(r.items.find((i) => i.id === 'two').kind, 'text');
    assert.ok(r.problems.some((p) => p.includes('broken.json') && p.includes('"lane" is required')));
  });

  it('defaults to today and returns an empty day rather than inventing one', () => {
    const r = listQueue(cfg, {});
    assert.equal(r.day, dayOf(undefined, 'UTC'));
    assert.ok(Array.isArray(r.items));
  });
});

describe('configure', () => {
  it('writes nothing without apply: true', () => {
    const snap = () => fs.readFileSync(configFile, 'utf8');
    const before = snap();
    const r = configure({ ...cfg }, {});
    assert.equal(r.applied, false);
    assert.equal(r.wrote, undefined);
    assert.ok(r.proposedConfig, 'it proposes a config');
    assert.ok(r.proposedConfigJson.endsWith('\n'));
    assert.ok(Array.isArray(r.jobs), 'it lists the jobs it can see');
    assert.ok(r.notes.some((n) => n.includes('Nothing has been written')));
    assert.ok(r.notes.some((n) => /never edits.*posting job/i.test(n)));
    assert.equal(snap(), before, 'the config file is untouched');

    // And it never proposes to touch a job: every job carries a described change, not an edit.
    for (const j of r.jobs) assert.equal(typeof j.change, 'string');
  });

  it('names exactly where it would write when there is no config', () => {
    const nowhere = path.join(tmp, 'nope', 'aircheck.config.json');
    const r = configure({ ...cfg, file: nowhere, exists: false }, { configFile: nowhere });
    assert.equal(r.config.found, false);
    assert.equal(r.config.writeTo, nowhere);
    assert.ok(Array.isArray(r.config.searched) && r.config.searched.length);
    assert.ok(r.proposedConfigJson.includes('"queue"'));
    assert.equal(r.applied, false);
    assert.equal(fs.existsSync(nowhere), false);
  });

  it('writes only the config file it was pointed at, and nothing else', () => {
    const target = path.join(tmp, 'applied', 'aircheck.config.json');
    const own = fs.readFileSync(configFile, 'utf8');
    const repoConfig = path.join(process.cwd(), 'aircheck.config.json');
    const repoBefore = fs.existsSync(repoConfig) ? fs.readFileSync(repoConfig, 'utf8') : null;

    const r = configure({ ...cfg }, { apply: true, configFile: target, queue: dirs.queue, mediaRoots: [dirs.media] });
    assert.equal(r.applied, true);
    assert.equal(r.wrote, target, 'an explicit configFile wins over anything it discovered');
    const written = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.ok(Array.isArray(written.queue));
    assert.ok(written.agents.commands);
    assert.ok(written.mediaRoots.includes(dirs.media));

    // The regression that matters: apply must never reach a config it was not pointed at.
    assert.equal(fs.readFileSync(configFile, 'utf8'), own, 'the config the server is using is untouched');
    if (repoBefore !== null) assert.equal(fs.readFileSync(repoConfig, 'utf8'), repoBefore, "the repo's own config is untouched");
  });

  it('keeps every key the existing config already had', () => {
    const base = path.join(tmp, 'merge.json');
    fs.writeFileSync(base, JSON.stringify({
      lanes: { source: 'compound-accounts', accounts: '~/a.json' },
      ads: [{ source: 'ad-catalog', dir: '~/ads' }],
      mediaRoots: ['~/keep-me'],
      agents: { default: 'codex', timeoutMinutes: 25, workspace: '~/w', commands: { codex: ['my-agent', '{prompt}'] } },
    }, null, 2) + '\n');
    const r = configure(loadConfig(base), { apply: true, mediaRoots: [dirs.media] });
    assert.equal(r.wrote, base);
    const written = JSON.parse(fs.readFileSync(base, 'utf8'));
    assert.deepEqual(written.lanes, { source: 'compound-accounts', accounts: '~/a.json' });
    assert.deepEqual(written.ads, [{ source: 'ad-catalog', dir: '~/ads' }]);
    assert.ok(written.mediaRoots.includes('~/keep-me'), 'an existing media root is never dropped');
    assert.ok(written.mediaRoots.includes(dirs.media));
    assert.equal(written.agents.default, 'codex');
    assert.equal(written.agents.workspace, '~/w');
    assert.deepEqual(written.agents.commands.codex, ['my-agent', '{prompt}']);
  });
});

describe('the bridge', () => {
  let bridge;
  const origins = ['https://aircheck.dev', 'http://localhost:3326'];

  before(async () => { bridge = await start({ config: cfg, port: 0, origins }); });
  after(async () => { await bridge.close(); });

  const get = (p, init) => fetch(`${bridge.url}${p}`, init);

  it('serves a file inside a media root, with the right content type', async () => {
    const res = await get(`/media?p=${encodeURIComponent(path.join(dirs.media, 'slide-1.png'))}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal((await res.arrayBuffer()).byteLength, 8);

    const vid = await get(`/media?p=${encodeURIComponent(path.join(dirs.media, 'clip.mp4'))}`);
    assert.equal(vid.headers.get('content-type'), 'video/mp4');
    await vid.arrayBuffer();
  });

  it('refuses a path outside the roots', async () => {
    const res = await get(`/media?p=${encodeURIComponent(path.join(dirs.outside, 'secret.png'))}`);
    assert.equal(res.status, 403);
    assert.ok(!(await res.text()).includes('not yours'));
  });

  it('refuses an escape through ..', async () => {
    const sneaky = path.join(dirs.media, '..', 'outside', 'secret.png');
    assert.equal(allowed(sneaky, [dirs.media]), null);
    const res = await get(`/media?p=${encodeURIComponent(sneaky)}`);
    assert.equal(res.status, 403);
  });

  it('refuses a symlink that points out of the roots', async () => {
    const link = path.join(dirs.media, 'leak.png');
    try { fs.symlinkSync(path.join(dirs.outside, 'secret.png'), link); } catch { /* already there */ }
    assert.equal(allowed(link, [dirs.media]), null, 'symlinks resolve before the root check');
    const res = await get(`/media?p=${encodeURIComponent(link)}`);
    assert.equal(res.status, 403);
    assert.ok(!(await res.text()).includes('not yours'));
  });

  it('refuses a path that does not exist, and a missing p', async () => {
    assert.equal((await get(`/media?p=${encodeURIComponent(path.join(dirs.media, 'nothing.png'))}`)).status, 403);
    assert.equal((await get('/media')).status, 400);
  });

  it('sets CORS for an Aircheck origin and for nobody else', async () => {
    const ok = await get(`/media?p=${encodeURIComponent(path.join(dirs.media, 'slide-1.png'))}`, { headers: { Origin: origins[0] } });
    assert.equal(ok.headers.get('access-control-allow-origin'), origins[0]);
    assert.equal(ok.headers.get('vary'), 'Origin');
    await ok.arrayBuffer();

    const local = await get(`/media?p=${encodeURIComponent(path.join(dirs.media, 'slide-1.png'))}`, { headers: { Origin: 'http://localhost:3326' } });
    assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:3326');
    await local.arrayBuffer();

    const evil = await get(`/media?p=${encodeURIComponent(path.join(dirs.media, 'slide-1.png'))}`, { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null, 'no wildcard, ever');
    await evil.arrayBuffer();
  });

  it('answers an OPTIONS preflight', async () => {
    const res = await get('/media', {
      method: 'OPTIONS',
      headers: { Origin: origins[0], 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), origins[0]);
    assert.match(res.headers.get('access-control-allow-methods'), /GET/);
    assert.match(res.headers.get('access-control-allow-headers').toLowerCase(), /range/);
  });

  it('supports Range, so video scrubs', async () => {
    const p = `/media?p=${encodeURIComponent(path.join(dirs.media, 'clip.mp4'))}`;
    const res = await get(p, { headers: { Range: 'bytes=4-7' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 4-7/16');
    assert.equal(res.headers.get('content-length'), '4');
    assert.equal(await res.text(), '4567');

    const open = await get(p, { headers: { Range: 'bytes=8-' } });
    assert.equal(open.status, 206);
    assert.equal(await open.text(), '89abcdef');

    const suffix = await get(p, { headers: { Range: 'bytes=-4' } });
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), 'cdef');

    const bad = await get(p, { headers: { Range: 'bytes=99-200' } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get('content-range'), 'bytes */16');
    await bad.arrayBuffer();
  });

  it('serves nothing but /media', async () => {
    assert.equal((await get('/')).status, 404);
    assert.equal((await get('/etc/passwd')).status, 404);
  });
});

describe('the MCP server itself', () => {
  it('lists exactly the tools the spec names, over stdio', () => {
    const req = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    const input = [
      req(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      req(2, 'tools/list', {}),
    ].join('');
    const r = spawnSync(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
      input, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, AIRCHECK_CONFIG: configFile, AIRCHECK_BRIDGE: 'off' },
    });
    const lines = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const list = lines.find((l) => l.id === 2);
    assert.ok(list, `no tools/list reply. stderr: ${r.stderr}`);
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(),
      ['check_post', 'configure', 'keep_running', 'list_queue', 'mark_sent', 'push_day', 'queue_post', 'repair', 'repair_status']);
    for (const t of list.result.tools) {
      assert.ok(t.description.length > 40, `${t.name} needs a real description`);
      assert.equal(t.inputSchema.type, 'object');
    }
  });

  it('writes a manifest through a tools/call, and marks it sent through another', () => {
    const req = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    const input = [
      req(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      req(2, 'tools/call', { name: 'queue_post', arguments: { lane: 'brand-x', at: '2026-11-10T12:00:00Z', text: 'over the wire', id: 'wire' } }),
      req(3, 'tools/call', { name: 'mark_sent', arguments: { id: 'wire', postUrl: 'https://x.com/i/status/9' } }),
      req(4, 'tools/call', { name: 'list_queue', arguments: { day: '2026-11-10' } }),
    ].join('');
    const r = spawnSync(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
      input, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, AIRCHECK_CONFIG: configFile, AIRCHECK_BRIDGE: 'off' },
    });
    const by = {};
    for (const l of r.stdout.split('\n').filter(Boolean).map((x) => JSON.parse(x))) by[l.id] = l;
    assert.equal(by[2].result.structuredContent.ok, true, r.stderr);
    assert.equal(by[3].result.structuredContent.status, 'sent');
    const listed = by[4].result.structuredContent.items.find((i) => i.id === 'wire');
    assert.equal(listed.postUrl, 'https://x.com/i/status/9');
    assert.equal(listed.text, 'over the wire');
  });

  it('refuses a repair when no agent command is configured, and starts nothing', () => {
    const req = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    const input = [
      req(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      req(2, 'tools/call', { name: 'repair', arguments: { id: 'round-trip' } }),
    ].join('');
    const r = spawnSync(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
      input, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, AIRCHECK_CONFIG: configFile, AIRCHECK_BRIDGE: 'off' },
    });
    const reply = r.stdout.split('\n').filter(Boolean).map((x) => JSON.parse(x)).find((l) => l.id === 2);
    assert.equal(reply.result.structuredContent.ok, false, r.stderr);
    assert.match(reply.result.structuredContent.problems[0], /No command configured/);
    assert.equal(fs.existsSync(path.join(dirs.data, 'runs')), false, 'no run folder for a refused repair');
  });
});

describe('the repair prompt', () => {
  it('carries the app\'s hard limits, word for word', async () => {
    const { buildRepairPrompt } = await import('./server.mjs');
    const out = path.join(dirs.data, 'runs', 'x', 'out');
    const p = buildRepairPrompt({
      item: { id: 'a', day: '2026-11-07', path: '/q/a.json', lane: 'brand-x', at: null, kind: 'carousel', media: [], missing: ['/m/gone.png'], text: 'copy' },
      request: 'slide 3 is blank', out, workspace: '/code/social',
    });
    assert.ok(p.includes('Nothing you make is published.'));
    assert.ok(p.includes('REPAIR this queued post.'));
    assert.ok(p.includes(`3. Hard limits. Never post, send, publish, schedule, upload or arm anything. Never touch ARMED flags, posted.json, cadence, state, ledger, queue or plan files. Never call a paid API. Never open a browser session that is signed in to a social account. Write files only inside ${out}.`));
    assert.ok(p.includes('slide 3 is blank'));
    assert.ok(p.includes('/m/gone.png'));
    assert.ok(p.includes(path.join(out, 'post.json')));
  });
});

describe('repair starts rather than blocks', () => {
  /* The point of the change: an MCP call must not hold an agent's conversation open while a
   * renderer works. repair hands back a run id straight away and repair_status reports on it. */
  const stubFile = path.join(tmp, 'repair-cfg.json');
  fs.writeFileSync(stubFile, JSON.stringify({
    dataDir: path.join(tmp, 'repair-data'),
    timezone: 'UTC',
    queue: [{ source: 'folder', dir: path.join(tmp, 'repair-queue') }],
    mediaRoots: [dirs.media],
    agents: {
      default: 'stub', timeoutMinutes: 5,
      // writes post.json after a beat, so the first status is genuinely 'running'
      commands: { stub: ['node', '-e', "setTimeout(()=>require('fs').writeFileSync(process.env.AIRCHECK_OUT+'/post.json', JSON.stringify({kind:'text',text:'repaired',media:[]})),400)"] },
    },
  }, null, 2) + '\n');
  const stubCfg = loadConfig(stubFile);

  it('returns a run id immediately, then reports the result', async () => {
    queuePost(stubCfg, { lane: 'brand-x', at: '2026-11-07T10:00:00Z', text: 'before', id: 'fix-me' });

    const started = await repair(stubCfg, { id: 'fix-me', request: 'make it better' });
    assert.equal(started.started, true);
    assert.equal(started.status, 'running');
    assert.ok(started.run, 'a run id comes back');
    assert.equal(started.output, undefined, 'no result yet — it did not block');

    const deadline = Date.now() + 15000;
    let final = repairStatus(stubCfg, { run: started.run });
    while (Date.now() < deadline && final.status === 'running') {
      await new Promise((r) => setTimeout(r, 200));
      final = repairStatus(stubCfg, { run: started.run });
    }
    assert.equal(final.status, 'done');
    assert.equal(final.ok, true);
    assert.equal(final.output.text, 'repaired');
    // the queued manifest is untouched: a repair proposes, it never replaces
    assert.equal(JSON.parse(fs.readFileSync(started.target.path, 'utf8')).text, 'before');
  });

  it('reports a run it does not know, instead of inventing one', () => {
    const r = repairStatus(stubCfg, { run: 'no-such-run' });
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /No repair run/);
  });
});

describe('push sends a whole day', () => {
  it('reads every source for the day and posts it to the account, without a token sends nothing', async () => {
    const day = '2026-03-04';
    fs.mkdirSync(path.join(dirs.queue, day), { recursive: true });
    fs.writeFileSync(path.join(dirs.queue, day, 'a.json'), JSON.stringify({ lane: 'brand-x', at: `${day}T15:00:00Z`, text: 'hi' }));
    const { pushDay } = await import('./server.mjs');
    const prev = process.env.AIRCHECK_CONFIG;
    process.env.AIRCHECK_CONFIG = configFile;
    try {
      const none = await pushDay({ day, env: {} });
      assert.equal(none.ok, false);
      const calls = [];
      const fetchFn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ saved: 1, rejected: [] })); };
      const r = await pushDay({ day, fetchFn, env: { AIRCHECK_TOKEN: 'ac_test', AIRCHECK_URL: 'https://example.test' } });
      assert.equal(r.ok, true);
      assert.equal(r.found, 1);
      assert.equal(calls[0].url, 'https://example.test/api/sync');
      assert.equal(calls[0].body.manifests[0].day, day);
      assert.equal(calls[0].body.manifests[0].manifest.lane, 'brand-x');
    } finally {
      if (prev === undefined) delete process.env.AIRCHECK_CONFIG; else process.env.AIRCHECK_CONFIG = prev;
    }
  });
});

describe('check_post, the review gate', () => {
  const noToken = { env: {} };
  it('sends an undecided post on an auto lane, and not on a review lane', async () => {
    const q = queuePost(cfg, { lane: 'brand-x', at: '2026-11-14T15:00:00Z', id: 'gate-auto' });
    const r = await checkPost(cfg, { id: q.id, day: q.day }, noToken);
    assert.equal(r.decision, 'pending'); assert.equal(r.policy, 'auto'); assert.equal(r.send, true);
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    fs.writeFileSync(configFile, JSON.stringify({ ...raw, review: { default: 'auto', lanes: { 'brand-x': 'review' } } }));
    try {
      assert.equal(policyFor(cfg, 'brand-x'), 'review');
      const r2 = await checkPost(cfg, { id: q.id, day: q.day }, noToken);
      assert.equal(r2.send, false);
    } finally { fs.writeFileSync(configFile, JSON.stringify(raw)); }
  });

  it('reads a decision from the data folder without a token, and the account with one', async () => {
    const q = queuePost(cfg, { lane: 'brand-x', at: '2026-11-14T16:00:00Z', id: 'gate-held' });
    fs.mkdirSync(path.join(dirs.data, 'reviews', q.day), { recursive: true });
    fs.writeFileSync(path.join(dirs.data, 'reviews', q.day, `${q.id}.json`), JSON.stringify({ state: 'held', at: '2026-11-14T12:00:00Z' }));
    const local = await checkPost(cfg, { id: q.id, day: q.day }, noToken);
    assert.equal(local.decision, 'held'); assert.equal(local.send, false);
    let asked = '';
    const fetchFn = async (url) => { asked = url; return { ok: true, json: async () => ({ review: { state: 'changes', note: 'shorter', at: 'x' } }) }; };
    const remote = await checkPost(cfg, { id: q.id, day: q.day }, { env: { AIRCHECK_TOKEN: 't', AIRCHECK_URL: 'https://example.test' }, fetchFn });
    assert.match(asked, /^https:\/\/example\.test\/api\/review\?day=2026-11-14&id=gate-held$/);
    assert.equal(remote.decision, 'changes'); assert.equal(remote.note, 'shorter'); assert.equal(remote.send, false);
  });

  it('fails closed on a review lane when the account cannot be reached', async () => {
    const fetchFn = async () => { throw new Error('offline'); };
    const r = await checkPost(cfg, { id: 'anything', day: '2026-11-14', lane: 'x' }, { env: { AIRCHECK_TOKEN: 't' }, fetchFn });
    assert.equal(r.ok, false); assert.equal(r.send, true, 'an auto lane carries on');
  });
});

describe('the test post', () => {
  it('needs a token, and sends one manifest with a URL image', async () => {
    assert.equal((await testPost('UTC', {})).ok, false);
    let body;
    const r = await testPost('UTC', { AIRCHECK_TOKEN: 't', AIRCHECK_URL: 'https://example.test' }, async (_u, init) => { body = JSON.parse(init.body); return { ok: true }; });
    assert.equal(r.ok, true);
    const m = body.manifests[0].manifest;
    assert.equal(manifestProblems(m).length, 0);
    assert.match(m.media[0], /^https:\/\/example\.test\/landing-assets\//);
    assert.equal(m.meta.test, true);
  });
});
