// Internal traffic: the operator's own addresses load no ad tag and never get or claim a conversion receipt.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AIRCHECK_ADS_KEY = 'fixture-ads-key-not-a-secret';
// Fixture ids: measurement is off unless a build sets these (src/lib/telemetry.ts).
Object.assign(process.env, {
  NEXT_PUBLIC_AIRCHECK_ADS_HOST: 'aircheck.dev',
  NEXT_PUBLIC_AIRCHECK_GOOGLE_ADS: 'AW-100000001/fixture-label',
  NEXT_PUBLIC_AIRCHECK_META_PIXEL: '100000000000002',
  NEXT_PUBLIC_AIRCHECK_X_PIXEL: 'fx001',
  NEXT_PUBLIC_AIRCHECK_X_EVENT: 'tw-fx001-fixture',
  NEXT_PUBLIC_AIRCHECK_REDDIT_PIXEL: 'a2_fixture',
});
// Documentation addresses (RFC 5737, RFC 3849), never real ones.
process.env.AIRCHECK_INTERNAL_ADDRESSES = JSON.stringify({ ips: ['192.0.2.227'], prefixes: ['2001:db8:1900:84af'] });
const I = await import('../src/server/internal-traffic.mjs');
const S = await import('../src/server/ads-conversion.ts');
const C = await import('../src/lib/ads-conversion.ts');

const ORIGIN = 'https://aircheck.dev';
const OURS = '192.0.2.227', OURS6 = '2001:db8:1900:84af:284a:e45b:7d6e:7010', STRANGER = '203.0.113.9';
const value = (setCookie) => setCookie.slice(setCookie.indexOf('=') + 1).split(';')[0];

test('only the listed addresses are internal', () => {
  assert.equal(I.internalAddress(OURS), true);
  assert.equal(I.internalAddress(`::ffff:${OURS}`), true);
  assert.equal(I.internalAddress(OURS6.toUpperCase()), true);
  for (const ip of [STRANGER, '192.0.2.22', '192.0.2.2270', '2001:db8:1900:84a::1', '2001:db8:1900:84af', '', null, undefined]) assert.equal(I.internalAddress(ip), false, String(ip));
  assert.equal(I.internalRequest(new Headers({ 'cf-connecting-ip': OURS })), true);
  // A header a client can send itself is never read.
  assert.equal(I.internalRequest(new Headers({ 'x-forwarded-for': OURS, 'x-real-ip': OURS })), false);
});

test('only a successful HTML page served to an internal GET is marked', () => {
  const req = (ip, method = 'GET') => new Request(`${ORIGIN}/`, { method, headers: { 'cf-connecting-ip': ip } });
  const html = (status = 200) => new Response(status === 200 ? '<html><head></head></html>' : null, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  assert.equal(I.marksPage(req(OURS), html()), true);
  assert.equal(I.marksPage(req(STRANGER), html()), false);
  assert.equal(I.marksPage(req(OURS, 'POST'), html()), false);
  assert.equal(I.marksPage(req(OURS), html(302)), false);
  assert.equal(I.marksPage(req(OURS), new Response('{}', { headers: { 'content-type': 'application/json' } })), false);
  const page = html();
  assert.equal(I.markInternal(req(STRANGER), page), page, 'a stranger gets the same answer object back');
  assert.equal(I.INTERNAL_TAG, `<meta name="${C.INTERNAL_META}" content="1">`);
});

test('an internal request is never issued a receipt and can never claim one', async () => {
  const signup = (ip) => new Request(`${ORIGIN}/api/auth`, { method: 'POST', headers: { origin: ORIGIN, 'cf-connecting-ip': ip } });
  const issued = async (ip) => { const h = new Headers(); await S.receiptForNewAccount(signup(ip), h, 'u1', true); return h.get('set-cookie'); };
  assert.match(await issued(STRANGER), /^aircheck_ads_result=/);
  assert.equal(await issued(OURS), null);
  const receipt = `aircheck_ads_result=${value(await S.issueAdsReceipt('u1'))}`;
  const claim = (ip) => S.handleAdsClaim(new Request(`${ORIGIN}/api/ads-conversion`, { method: 'POST', headers: { origin: ORIGIN, cookie: `aircheck_session=ok; ${receipt}`, 'cf-connecting-ip': ip }, body: '{}' }), async () => 'u1');
  const ours = await claim(OURS);
  assert.equal(ours.status, 200);
  assert.equal((await ours.json()).event, null);
  assert.match(ours.headers.get('set-cookie'), /^aircheck_ads_result=; Max-Age=0/);
});

function browser({ internal }) {
  const scripts = [], calls = [], win = {};
  const env = {
    location: { href: `${ORIGIN}/?gclid=abc`, hostname: 'aircheck.dev', pathname: '/', protocol: 'https:' },
    navigator: {},
    // A new account's browser: the marker the server sets beside the receipt.
    getCookie: () => 'aircheck_ads_pending=1', setCookie: () => {}, win,
    loadScript: (src) => scripts.push(src),
    fetch: async (p) => { calls.push(p); return new Response(JSON.stringify({ event: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })); },
    internal: () => internal,
  };
  return { ads: C.createAds(env), scripts, calls, win };
}

test('an internal page loads no ad tag and asks for no conversion', async () => {
  const ours = browser({ internal: true });
  assert.equal(ours.ads.tag(), false);
  assert.equal(ours.ads.pixel(), false);
  await ours.ads.claim();
  assert.deepEqual(ours.scripts, []);
  assert.deepEqual(ours.calls, []);
  assert.deepEqual(Object.keys(ours.win), []);

  const stranger = browser({ internal: false });
  await stranger.ads.claim();
  assert.equal(stranger.scripts.length, 4, 'Google, Meta, X and Reddit');
  assert.deepEqual(stranger.calls, ['/api/ads-conversion']);
});

test('the page mark is read from the server meta, once, and kept', () => {
  const none = { querySelector: () => null };
  assert.equal(C.pageInternal(none), false);
  assert.equal(C.pageInternal({ querySelector: (sel) => (sel === 'meta[name="aircheck-internal"]' ? { content: '1' } : null) }), true);
  assert.equal(C.pageInternal(none), true, 'kept after the head is re-rendered');
});

test('an internal page request loses its cache validators; a stranger\'s request is passed as it is', () => {
  const req = (ip, extra = {}) => new Request('https://aircheck.dev/', { headers: { 'cf-connecting-ip': ip, 'if-none-match': '"abc"', 'if-modified-since': 'Wed, 11 Nov 2026 00:00:00 GMT', ...extra } });
  const ours = I.unconditional(req(OURS));
  assert.equal(ours.headers.has('if-none-match'), false);
  assert.equal(ours.headers.has('if-modified-since'), false);
  assert.equal(ours.headers.get('cf-connecting-ip'), OURS);
  const theirs = req('203.0.113.9');
  assert.equal(I.unconditional(theirs), theirs);
  assert.equal(I.unconditional(theirs).headers.get('if-none-match'), '"abc"');
});
