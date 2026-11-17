// Contract tests for the manifest — the whole agreement between Aircheck and whatever queued a
// post — and for the account store, which holds manifests and never media.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { manifestProblems, resolveSource, resolveMedia, serialize, manifestPath, dayOf, inferKind } = await import('../src/server/manifest.ts');
const { LocalStore, Tokens } = await import('../src/server/account.ts');
const { loadQueue } = await import('../src/server/sources/queue.ts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-man-'));

test('a manifest needs a lane, and says what else is wrong in a person\'s words', () => {
  assert.deepEqual(manifestProblems({ lane: 'brand-x' }), []);
  assert.match(manifestProblems({})[0], /"lane" is required/);
  assert.match(manifestProblems('nope')[0], /not a JSON object/);
  assert.match(manifestProblems({ lane: 'x', at: 'tuesday' })[0], /ISO 8601/);
  assert.match(manifestProblems({ lane: 'x', status: 'posted' })[0], /queued, sent, held or failed/);
  assert.match(manifestProblems({ lane: 'x', media: 'a.png' })[0], /must be a list/);
  assert.match(manifestProblems({ lane: 'x', media: [{ alt: 'no source' }] })[0], /needs a "path" or a "url"/);
  // the file name leads the message, so a person knows which job to fix
  assert.match(manifestProblems({}, '/q/2026-11-07/post-03.json')[0], /^post-03\.json: /);
});

test('an ad creative is the same manifest with an `ad` block, and its status is checked against it', () => {
  const ad = { lane: 'meta', text: 'Maple oat latte is back.', media: ['slide-1.png'], status: 'review', ad: { product: 'harbor-coffee', format: 'carousel-feed', run: 'r1', approved: false } };
  assert.deepEqual(manifestProblems(ad), []);
  // each ladder belongs to its shape, and the message names both ways out
  const postWord = manifestProblems({ ...ad, status: 'queued' });
  assert.equal(postWord.length, 1);
  assert.match(postWord[0], /"queued", which is a post's status, but this manifest has an "ad" block/);
  assert.match(postWord[0], /draft, review, approved, live or archived/);
  const adWord = manifestProblems({ lane: 'brand-x', status: 'approved' });
  assert.match(adWord[0], /"approved", which is an ad creative's status, but this manifest has no "ad" block/);
  assert.match(adWord[0], /Add an "ad" block with a "product"/);
  assert.match(manifestProblems({ ...ad, status: 'paused' })[0], /draft, review, approved, live or archived for an ad creative/);
  // the block itself
  assert.match(manifestProblems({ lane: 'meta', ad: {} })[0], /"ad.product" is required/);
  assert.match(manifestProblems({ lane: 'meta', ad: 'yes' })[0], /"ad" must be an object/);
  assert.match(manifestProblems({ lane: 'meta', ad: { product: 'p', approved: 'yes' } })[0], /"ad.approved" must be true or false/);
  assert.match(manifestProblems({ ad: { product: 'p' } })[0], /ad platform or account/);
  // `at` stays optional; a creative normally has none
  assert.deepEqual(manifestProblems({ lane: 'meta', ad: { product: 'p' } }), []);
  // serialize keeps the block, after status, and a creative defaults to draft
  const out = JSON.parse(serialize({ lane: 'meta', ad: { product: 'p' } }));
  assert.deepEqual(Object.keys(out), ['lane', 'status', 'ad']);
  assert.equal(out.status, 'draft');
});

test('a media entry is a source: a URL is the owner\'s, a path is local', () => {
  const dir = path.join(tmp, 'q', '2026-11-07');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.png'), 'png');

  const url = resolveSource('https://cdn.example.com/slide.png', dir);
  assert.equal(url.src, 'url');
  assert.equal(url.kind, 'image');
  // taken at its word: checking it would mean fetching someone else's media from our server
  assert.equal(url.missing, undefined);
  assert.equal(url.path, 'https://cdn.example.com/slide.png');

  const rel = resolveSource('a.png', dir);
  assert.equal(rel.src, 'local');
  assert.equal(rel.path, path.join(dir, 'a.png'));
  assert.equal(rel.missing, false);

  assert.equal(resolveSource('/nope/gone.png', dir).missing, true);
  assert.equal(resolveSource({ url: 'https://x.test/v.mp4', alt: 'a clip' }, dir).alt, 'a clip');
  assert.equal(resolveSource({ url: 'https://x.test/v.mp4' }, dir).kind, 'video');
  assert.equal(resolveSource('', dir), null);
});

test('a local file that is gone is reported, never dropped', () => {
  const dir = path.join(tmp, 'q', '2026-11-07');
  const { media, missing } = resolveMedia(['a.png', 'gone.png', 'https://cdn.example.com/s.png'], dir);
  assert.equal(media.length, 2);
  assert.deepEqual(missing.map((m) => path.basename(m)), ['gone.png']);
});

test('the queue reads manifests, resolves their media and surfaces a broken one', () => {
  const dir = path.join(tmp, 'q2', '2026-11-07');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.png'), 'png');
  fs.writeFileSync(path.join(dir, 'ok.json'), serialize({
    lane: 'brand-x', at: '2026-11-07T15:00:00Z', text: 'hi',
    media: ['a.png', { url: 'https://cdn.example.com/two.png' }], status: 'queued',
  }));
  fs.writeFileSync(path.join(dir, 'broken.json'), JSON.stringify({ at: 'whenever' }));

  const items = loadQueue([{ source: 'folder', dir: path.join(tmp, 'q2') }], '2026-11-07');
  const ok = items.find((i) => i.id.endsWith('ok.json'));
  assert.equal(ok.lane, 'brand-x');
  assert.equal(ok.kind, 'carousel');
  assert.equal(ok.media.length, 2);
  assert.equal(ok.media[0].src, 'local');
  assert.equal(ok.media[1].src, 'url');

  // a manifest that does not validate becomes a failed post carrying its own errors, so a typo in
  // a job shows up in the UI instead of silently emptying the day
  const bad = items.find((i) => i.id.endsWith('broken.json'));
  assert.equal(bad.status, 'failed');
  assert.match(bad.text, /"lane" is required/);
});

test('serialize round-trips and keeps a stable shape', () => {
  const m = { lane: 'brand-x', at: '2026-11-07T15:00:00Z', text: 'hi', media: ['a.png'] };
  const text = serialize(m);
  assert.ok(text.endsWith('\n'));
  const back = JSON.parse(text);
  assert.equal(back.status, 'queued');      // defaulted on the way out
  assert.equal(back.postUrl, undefined);    // absent fields are not written as null
  assert.deepEqual(back.media, ['a.png']);
  assert.deepEqual(manifestProblems(back), []);
});

test('a manifest has one home, and its day comes from its send time', () => {
  // an id is a file name, never a path: separators and dot runs cannot survive it
  const p = manifestPath('/q', '2026-11-07', 'post 1/../x');
  assert.equal(p, path.join('/q', '2026-11-07', 'post-1---x.json'));
  assert.equal(path.dirname(p), path.join('/q', '2026-11-07'));
  assert.ok(!path.basename(p).includes('..'));
  assert.equal(manifestPath('/q', '2026-11-07', '../../etc/passwd'), path.join('/q', '2026-11-07', 'etc-passwd.json'));
  assert.equal(dayOf('2026-11-07T15:00:00Z', 'UTC'), '2026-11-07');
  // the day is the lane's, not UTC's: 00:30 UTC is still the previous evening in New York
  assert.equal(dayOf('2026-11-08T00:30:00Z', 'America/New_York'), '2026-11-07');
  assert.equal(inferKind({}, 3), 'carousel');
  assert.equal(inferKind({}, 1), 'image');
  assert.equal(inferKind({}, 0), 'text');
  assert.equal(inferKind({ kind: 'thread' }, 0), 'thread');
});

test('the account store holds manifests, and refuses one that is not valid', async () => {
  const s = new LocalStore(path.join(tmp, 'acct'));
  await s.put('me', { id: 'p1', day: '2026-11-07', manifest: { lane: 'brand-x', at: '2026-11-07T15:00:00Z', text: 'hi' }, updatedAt: '' });
  await s.put('me', { id: 'p2', day: '2026-11-07', manifest: { lane: 'brand-li', at: '2026-11-07T09:00:00Z' }, updatedAt: '' });
  const rows = await s.list('me', '2026-11-07');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].manifest.lane, 'brand-li');     // ordered by send time
  assert.ok(rows[0].updatedAt);
  assert.equal((await s.get('me', '2026-11-07', 'p1')).manifest.text, 'hi');

  // one account never sees another's
  assert.equal((await s.list('someone-else', '2026-11-07')).length, 0);

  await assert.rejects(() => s.put('me', { id: 'bad', day: '2026-11-07', manifest: { at: 'x' }, updatedAt: '' }), /lane/);
  await s.remove('me', '2026-11-07', 'p1');
  assert.equal((await s.list('me', '2026-11-07')).length, 1);
});

test('a token proves an account, is stored only as a hash, and can be revoked', () => {
  const t = new Tokens(path.join(tmp, 'tokens.json'));
  const { token, record } = t.issue('me', 'laptop');
  assert.match(token, /^ac_/);
  // the plain token is never written down
  assert.ok(!fs.readFileSync(path.join(tmp, 'tokens.json'), 'utf8').includes(token));
  assert.equal(t.verify(token), 'me');
  assert.equal(t.verify('ac_nonsense'), null);
  assert.equal(t.verify(''), null);
  assert.equal(t.list('me')[0].label, 'laptop');
  assert.equal(t.list('me')[0].hash, undefined);
  t.revoke(record.hash);
  assert.equal(t.verify(token), null);
});

test('a hosted read takes local paths at their word: the files are on the machine that queued them', () => {
  const gone = '/nowhere/on/this/server/slide-1.png';
  assert.deepEqual(resolveMedia([gone], '/').missing, [gone], 'on the queuing machine a missing file is reported');
  const hosted = resolveMedia([gone], '/', false);
  assert.equal(hosted.missing.length, 0);
  assert.equal(hosted.media[0].path, gone);
  assert.equal(hosted.media[0].src, 'local');
});
