// Contract tests for ad creative: the two ad sources (a renderer's own catalog, and the one manifest
// with an `ad` block), the approval lock that decides whether
// Repair may replace a creative, and the ad prompt's hard limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { loadAds, adLockOf, adProducts } = await import('../src/server/sources/ads.ts');
const { buildAdPrompt } = await import('../src/server/runs.ts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-ads-'));

/** A render's output folder, the shape ads/media writes: catalog.json beside its files. */
function catalogRun(product, run, catalog, files = []) {
  const dir = path.join(tmp, 'store', product, run);
  fs.mkdirSync(path.join(dir, 'carousel-square'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'png');
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog));
  return dir;
}

test('ad-catalog reads one creative per asset, resolves its files and reports missing ones', () => {
  catalogRun('widget', 'review-2026-11-02', {
    schema: 1, product: 'widget', createdAt: '2026-11-02T16:06:55.055Z', stage: 'format-review', userApproved: false,
    copySource: { file: 'copy/widget.json' },
    assets: [
      { id: 'deck-square', kind: 'carousel', format: 'carousel-square', title: 'Calendars together', files: [{ file: 'carousel-square/01.png' }, { file: 'carousel-square/02.png' }] },
      { id: 'search-text', kind: 'text', format: 'search-text', title: 'Responsive Search text ad', files: [] },
      { id: 'still', kind: 'image', format: 'still-feed', files: [{ file: 'carousel-square/gone.png' }] },
    ],
  }, ['carousel-square/01.png', 'carousel-square/02.png']);

  const ads = loadAds([{ source: 'ad-catalog', dir: path.join(tmp, 'store') }]);
  assert.equal(ads.length, 3);

  const deck = ads.find((c) => c.assetId === 'deck-square');
  assert.equal(deck.id, 'widget/review-2026-11-02/deck-square');
  assert.equal(deck.product, 'widget');
  assert.equal(deck.kind, 'carousel');
  assert.equal(deck.media.length, 2);
  assert.equal(deck.recipe, 'copy/widget.json');
  // stage says review and nobody has approved it, so it is reviewable and replaceable
  assert.equal(deck.status, 'review');
  assert.equal(deck.approved, false);
  assert.equal(deck.lock, '');

  // a text ad carries no media and is still listed, because a person still reviews it
  assert.equal(ads.find((c) => c.assetId === 'search-text').media.length, 0);

  // a file the catalog names but that is not on disk is reported, never silently dropped
  const still = ads.find((c) => c.assetId === 'still');
  assert.equal(still.media.length, 0);
  assert.equal(still.missing.length, 1);
});

test('an approved, live or archived creative is locked against Replace', () => {
  const base = { product: 'p', run: 'r', assetId: 'a', kind: 'image', format: 'still', media: [], source: 'ad-catalog', origin: { kind: 'ad-catalog', path: '/x/catalog.json' } };
  assert.equal(adLockOf({ ...base, id: '1', status: 'draft', approved: false }), '');
  assert.equal(adLockOf({ ...base, id: '2', status: 'review', approved: false }), '');
  assert.match(adLockOf({ ...base, id: '3', status: 'approved', approved: true }), /Approved/);
  // an approval flag wins even when the stage still says review
  assert.match(adLockOf({ ...base, id: '4', status: 'review', approved: true }), /Approved/);
  assert.match(adLockOf({ ...base, id: '5', status: 'live', approved: false }), /Live/);
  assert.match(adLockOf({ ...base, id: '6', status: 'archived', approved: false }), /Archived/);
  // a producer Aircheck cannot write back to may be previewed but never replaced
  assert.match(adLockOf({ ...base, id: '7', status: 'draft', approved: false, origin: { kind: 'other' } }), /does not support Replace/);
});

test('a catalog a person has approved comes back approved and locked', () => {
  catalogRun('brandwire', 'live-2026-11-04', {
    schema: 1, product: 'brandwire', stage: 'fanout', userApproved: true,
    assets: [{ id: 'still', kind: 'image', format: 'still-square', files: [{ file: 'a.png' }] }],
  }, ['a.png']);
  const ads = loadAds([{ source: 'ad-catalog', dir: path.join(tmp, 'store') }]).filter((c) => c.product === 'brandwire');
  assert.equal(ads.length, 1);
  assert.equal(ads[0].approved, true);
  assert.equal(ads[0].status, 'approved');
  assert.match(ads[0].lock, /Approved/);
});

test('ad-folder reads the ONE manifest: a post with an `ad` block is a creative', () => {
  const dir = path.join(tmp, 'folder');
  fs.mkdirSync(path.join(dir, '2026-11-07'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'slide-1.png'), 'png');
  fs.writeFileSync(path.join(dir, 'latte.json'), JSON.stringify({
    lane: 'meta', text: 'Maple oat latte is back.', media: ['slide-1.png', 'https://cdn.you.com/slide-2.png', 'gone.png'], status: 'review',
    ad: { product: 'harbor-coffee', format: 'carousel-feed', run: 'review-2026-11-07', approved: false },
  }));
  // a post in the same folder is Social's, not a creative
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify({ lane: 'brand-x', text: 'a post', status: 'queued' }));
  // a dated folder is read too, so the ad source can point at the queue itself; no run means the day
  fs.writeFileSync(path.join(dir, '2026-11-07', 'still.json'), JSON.stringify({ lane: 'meta', media: ['https://cdn.you.com/a.png'], ad: { product: 'harbor-coffee', approved: true } }));
  // a creative whose status is a post's word is shown with its problem, never dropped
  fs.writeFileSync(path.join(dir, 'typo.json'), JSON.stringify({ lane: 'meta', status: 'queued', ad: { product: 'harbor-coffee' } }));

  const ads = loadAds([{ source: 'ad-folder', dir }]);
  assert.equal(ads.length, 3);

  const latte = ads.find((c) => c.assetId === 'latte');
  assert.equal(latte.id, 'harbor-coffee/review-2026-11-07/latte');
  assert.equal(latte.lane, 'meta');
  assert.equal(latte.product, 'harbor-coffee');
  assert.equal(latte.run, 'review-2026-11-07');
  assert.equal(latte.format, 'carousel-feed');
  assert.equal(latte.kind, 'carousel');
  assert.equal(latte.status, 'review');
  assert.equal(latte.approved, false);
  // a local path resolves against the file's folder; a URL is the owner's and loads from there
  assert.deepEqual(latte.media.map((m) => m.src), ['local', 'url']);
  assert.equal(latte.media[1].path, 'https://cdn.you.com/slide-2.png');
  assert.deepEqual(latte.missing.map((m) => path.basename(m)), ['gone.png']);
  assert.equal(latte.lock, '');

  const still = ads.find((c) => c.assetId === 'still');
  assert.equal(still.run, '2026-11-07');
  assert.equal(still.format, 'image');
  assert.equal(still.status, 'approved');
  assert.match(still.lock, /Approved/);

  const typo = ads.find((c) => c.assetId === 'typo');
  assert.equal(typo.title, 'This manifest is not valid');
  assert.match(typo.text, /"status" is "queued", which is a post's status/);
  assert.match(typo.lock, /not valid/);
});

test('the queue skips a creative, so one folder can hold both and neither scope shows the other', async () => {
  const { loadQueue } = await import('../src/server/sources/queue.ts');
  const q = path.join(tmp, 'shared');
  fs.mkdirSync(path.join(q, '2026-11-07'), { recursive: true });
  fs.writeFileSync(path.join(q, '2026-11-07', 'post.json'), JSON.stringify({ lane: 'brand-x', at: '2026-11-07T15:00:00Z', text: 'p' }));
  fs.writeFileSync(path.join(q, '2026-11-07', 'ad.json'), JSON.stringify({ lane: 'meta', ad: { product: 'w' } }));
  assert.deepEqual(loadQueue([{ source: 'folder', dir: q }], '2026-11-07').map((i) => i.id), ['2026-11-07:post.json']);
  assert.deepEqual(loadAds([{ source: 'ad-folder', dir: q }]).map((c) => c.id), ['w/2026-11-07/ad']);
});

test('a creative row takes the lane its manifest names', async () => {
  const { adsAsQueue } = await import('../src/server/sources/ads.ts');
  const ads = loadAds([{ source: 'ad-folder', dir: path.join(tmp, 'folder') }]);
  assert.equal(adsAsQueue(ads).find((r) => r.id.endsWith('/latte')).lane, 'meta');
});

test('products are counted for the filter, approved separately', () => {
  const ads = loadAds([{ source: 'ad-catalog', dir: path.join(tmp, 'store') }]);
  const by = adProducts(ads);
  assert.deepEqual(by.map((p) => p.product), ['brandwire', 'widget']);
  assert.equal(by.find((p) => p.product === 'brandwire').approved, 1);
  assert.equal(by.find((p) => p.product === 'widget').approved, 0);
});

test('the ad prompt names the hard limits, the placement and the copy route', () => {
  const ad = {
    id: 'widget/r/deck', product: 'widget', run: 'r', assetId: 'deck', kind: 'carousel', format: 'carousel-square',
    title: 'Calendars together', media: [{ path: '/m/01.png', kind: 'image' }], status: 'review', approved: false,
    source: 'ad-catalog', origin: { kind: 'ad-catalog', path: '/m/catalog.json', dir: '/m' }, recipe: 'copy/widget.json',
  };
  const p = buildAdPrompt({ ad, out: '/out', adWorkspace: '/ops/ads', action: 'repair', rules: ['Ad copy goes through the house copy tool.'] });
  assert.match(p, /AD CREATIVE/);
  assert.match(p, /REPAIR this creative/);
  assert.match(p, /carousel-square/);
  assert.match(p, /\/m\/01\.png/);
  assert.match(p, /copy\/widget\.json/);
  // money and identity limits the social prompt does not carry
  assert.match(p, /Never upload, publish, launch, arm or schedule an ad/);
  assert.match(p, /budget/);
  assert.match(p, /5\. Ad copy goes through the house copy tool\./);
  assert.match(p, /6\. Finish by writing/);
  assert.match(p, /real logo and its real fonts/);
  assert.match(p, /Write files only inside \/out/);
});

test('an ad source a plugin names is read through the plugin, and its own lock wins', async () => {
  const { registerPlugin, clearPlugins } = await import('../src/server/plugins.ts');
  const base = { product: 'p', run: 'r', kind: 'image', format: 'still-square', media: [], status: 'approved', approved: true, origin: { kind: 'other' } };
  registerPlugin({ ads: { 'my-pipeline': (cfg) => [{ ...base, id: 'p/r/a', assetId: 'a', source: 'my-pipeline', lock: `read from ${cfg.dir}` }, { ...base, id: 'p/r/b', assetId: 'b', source: 'my-pipeline' }] } });
  try {
    const list = loadAds([{ source: 'my-pipeline', dir: '/pipe' }]);
    assert.equal(list.find((c) => c.assetId === 'a').lock, 'read from /pipe');
    assert.match(list.find((c) => c.assetId === 'b').lock, /Approved/);
  } finally { clearPlugins(); }
  assert.throws(() => loadAds([{ source: 'my-pipeline', dir: '/pipe' }]), /Unknown ad source/);
});
