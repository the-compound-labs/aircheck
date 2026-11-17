// Contract tests for the portable pieces: the folder queue, the media allowlist and run output
// collection. Runs with node --test against the TypeScript sources via --experimental-strip-types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { loadQueue, queueReadAt } = await import('../src/server/sources/queue.ts');
const { allowed } = await import('../src/server/media.ts');
const { collectOutput, buildPrompt } = await import('../src/server/runs.ts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-'));

test('folder queue reads a day, resolves relative media and drops missing files', () => {
  const day = path.join(tmp, 'q', '2026-11-06');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, 'a.png'), 'x');
  fs.writeFileSync(path.join(day, 'post.json'), JSON.stringify({ lane: 'brand-x', at: '2026-11-06T15:00:00Z', text: 'hi', media: ['a.png', 'gone.png'], status: 'sent', postUrl: 'https://x.com/p/1' }));
  fs.writeFileSync(path.join(day, 'nolane.json'), JSON.stringify({ text: 'ignored' }));
  const all = loadQueue([{ source: 'folder', dir: path.join(tmp, 'q') }], '2026-11-06');
  /* A manifest with no lane is not silently skipped any more: it comes back as a failed post
   * carrying its own errors, so a typo in a job is visible instead of quietly emptying the day. */
  const broken = all.filter((i) => i.status === 'failed' && i.id.endsWith('nolane.json'));
  assert.equal(broken.length, 1);
  assert.match(broken[0].text, /"lane" is required/);
  const items = all.filter((i) => i.id.endsWith('post.json'));
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'sent');
  assert.equal(items[0].kind, 'image');
  assert.deepEqual(items[0].media.map((m) => path.basename(m.path)), ['a.png']);
  assert.equal(loadQueue([{ source: 'folder', dir: path.join(tmp, 'q') }], '2026-11-07').length, 0);
});

test('a queue source a plugin names is read through it, and Replace is open only where a plugin replaces', async () => {
  const { registerPlugin, clearPlugins } = await import('../src/server/plugins.ts');
  const day = '2026-11-15';
  registerPlugin({
    queue: { planner: { load: (cfg, d) => [
      { id: `${d}:a`, lane: 'brand-x', at: '2999-01-01T00:00:00Z', kind: 'text', text: cfg.dir, media: [], status: 'queued', source: 'planner', origin: { kind: 'planner-row', path: '/p/plan.json' } },
      { id: `${d}:b`, lane: 'brand-x', at: '2999-01-01T00:00:00Z', kind: 'text', media: [], status: 'queued', source: 'planner', origin: { kind: 'other' } },
    ], readAt: () => '2026-11-15T04:30:00.000Z' } },
    replace: { 'planner-row': { replace() {}, undo() {} } },
  });
  try {
    const items = loadQueue([{ source: 'planner', dir: '/plans' }], day);
    assert.equal(items.find((i) => i.id.endsWith(':a')).text, '/plans');
    assert.equal(items.find((i) => i.id.endsWith(':a')).lock, '');
    assert.match(items.find((i) => i.id.endsWith(':b')).lock, /does not support Replace/);
    assert.equal(queueReadAt([{ source: 'planner', dir: '/plans' }], day), '2026-11-15T04:30:00.000Z');
  } finally { clearPlugins(); }
  assert.throws(() => loadQueue([{ source: 'planner', dir: '/plans' }], day), /Unknown queue source/);
});

test('media allowlist refuses paths outside the roots, including through ..', () => {
  const root = path.join(tmp, 'media');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'ok.png'), 'x');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'x');
  assert.ok(allowed(path.join(root, 'ok.png'), [root]));
  assert.equal(allowed(path.join(root, '..', 'secret.txt'), [root]), null);
  assert.equal(allowed('/etc/hosts', [root]), null);
});

test('run output prefers post.json and falls back to media files', () => {
  const out = path.join(tmp, 'run', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'slide-2.png'), 'x');
  fs.writeFileSync(path.join(out, 'slide-1.png'), 'x');
  assert.deepEqual(collectOutput(out).media.map((m) => path.basename(m.path)), ['slide-1.png', 'slide-2.png']);
  fs.writeFileSync(path.join(out, 'post.json'), JSON.stringify({ kind: 'carousel', text: 'copy', media: ['slide-2.png', 'missing.png'] }));
  const o = collectOutput(out);
  assert.equal(o.text, 'copy');
  assert.deepEqual(o.media.map((m) => path.basename(m.path)), ['slide-2.png']);
});

test('the prompt names the hard limits and the output contract', () => {
  const p = buildPrompt({ lane: { id: 'l', name: 'L', platform: 'x', formats: [] }, out: '/r/out' });
  assert.match(p, /Never post, send, publish/);
  assert.match(p, /\/r\/out\/post\.json/);
  assert.match(buildPrompt({ lane: { id: 'l', name: 'L', platform: 'x', formats: [] }, out: '/r/out', rules: ['Use the house voice.'] }), /5\. Use the house voice\.\n6\. Finish by writing/);
});
