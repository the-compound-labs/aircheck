// Optional Google Ads measurement: the server's one-time receipt and the browser's consent gate.
// Nothing here talks to Google; the browser half runs against a fake window that records gtag calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const S = await import('../src/server/ads-conversion.ts');
const C = await import('../src/lib/ads-conversion.ts');
const { Users } = await import('../src/server/auth.ts');

const ORIGIN = 'https://aircheck.dev';
const value = (setCookie) => setCookie.slice(setCookie.indexOf('=') + 1).split(';')[0];
const req = (cookie, extra = {}, method = 'POST') => new Request(`${ORIGIN}/api/ads-conversion`, { method, headers: { origin: ORIGIN, cookie, ...extra }, body: method === 'POST' ? '{}' : undefined });

test('the receipt is encrypted, short-lived, bound to one account and claimable only with consent', async () => {
  const now = Date.now();
  const cookie = await S.issueAdsReceipt('private-user', { now });
  assert.doesNotMatch(cookie, /private-user/);
  assert.match(cookie, /^aircheck_ads_result=.+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  const v = value(cookie);
  const event = await S.claimAdsReceipt(v, 'private-user', { allowed: true, now });
  assert.match(event, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await S.claimAdsReceipt(v, 'private-user', { allowed: false, now }), null);
  assert.equal(await S.claimAdsReceipt(v, 'private-user', { allowed: true, now: now + S.ADS_RECEIPT_MS }), null);
  assert.equal(await S.claimAdsReceipt(v, 'other-user', { allowed: true, now }), null);
  assert.equal(await S.claimAdsReceipt(v.slice(0, -2) + 'AA', 'private-user', { allowed: true, now }), null);
  assert.equal(await S.claimAdsReceipt('', 'private-user', { allowed: true, now }), null);
  // two receipts never share an event id
  assert.notEqual(event, await S.claimAdsReceipt(value(await S.issueAdsReceipt('private-user', { now })), 'private-user', { allowed: true, now }));
});

test('a receipt is issued only for a newly created account that did not opt out, with no DNT or GPC', async () => {
  const signup = (cookie, extra = {}) => new Request(`${ORIGIN}/api/auth`, { method: 'POST', headers: { cookie, ...extra } });
  const got = async (r, created) => { const h = new Headers(); await S.receiptForNewAccount(r, h, 'u1', created); return h.getSetCookie(); };
  assert.equal((await got(signup('aircheck_ads=yes'), true)).length, 2, 'the receipt and its marker');
  assert.equal((await got(signup('aircheck_ads=yes'), false)).length, 0, 'a returning sign-in gets nothing');
  assert.equal((await got(signup('aircheck_ads=no'), true)).length, 0);
  assert.equal((await got(signup(''), true)).length, 2, 'no choice cookie means on');
  assert.equal((await got(signup('aircheck_ads=yes', { dnt: '1' }), true)).length, 0);
  assert.equal((await got(signup('aircheck_ads=yes', { 'sec-gpc': '1' }), true)).length, 0);
});

test('Google sign-in reports created only for the call that inserted the account', () => {
  const U = new Users(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-ads-')), 'users.json'));
  const first = U.createOAuth('New@Example.com');
  assert.equal(first.created, true);
  const again = U.createOAuth('new@example.com');
  assert.equal(again.created, false);
  assert.equal(again.user.id, first.user.id);
});

test('the claim route is same-origin, signed-in, consented, clears the receipt and returns only the event id', async () => {
  const receipt = 'aircheck_ads_result=' + value(await S.issueAdsReceipt('u1'));
  const viewer = async (r) => (r.headers.get('cookie') || '').includes('aircheck_session=ok') ? 'u1' : null;
  assert.equal((await S.handleAdsClaim(req(`aircheck_ads=yes; ${receipt}`), viewer)).status, 401);
  assert.equal((await S.handleAdsClaim(req(`aircheck_session=ok; aircheck_ads=yes; ${receipt}`, { origin: 'https://foreign.invalid' }), viewer)).status, 403);
  assert.equal((await S.handleAdsClaim(req(`aircheck_session=ok; aircheck_ads=yes; ${receipt}`, {}, 'GET'), viewer)).status, 405);
  assert.equal((await S.handleAdsClaim(req(`aircheck_session=ok; aircheck_ads=yes; ${receipt}`, { origin: '' }), viewer)).status, 403, 'no Origin, no claim');
  assert.equal((await S.handleAdsClaim(req(`aircheck_session=ok; aircheck_ads=yes; ${receipt}`, { origin: 'null' }), viewer)).status, 403);
  const ok = await S.handleAdsClaim(req(`aircheck_session=ok; aircheck_ads=yes; ${receipt}`), viewer);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /^aircheck_ads_result=; Max-Age=0/);
  const body = await ok.json();
  assert.deepEqual(Object.keys(body), ['event']);
  assert.match(body.event, /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(body), /u1/);
  for (const extra of [{ dnt: '1' }, { 'sec-gpc': '1' }]) {
    assert.equal((await (await S.handleAdsClaim(req(`aircheck_session=ok; aircheck_ads=yes; ${receipt}`, extra), viewer)).json()).event, null);
  }
  assert.equal((await (await S.handleAdsClaim(req(`aircheck_session=ok; aircheck_ads=no; ${receipt}`), viewer)).json()).event, null);
  assert.equal((await (await S.handleAdsClaim(req('aircheck_session=ok; aircheck_ads=yes'), viewer)).json()).event, null);
  assert.match((await (await S.handleAdsClaim(req(`aircheck_session=ok; ${receipt}`), viewer)).json()).event, /^[0-9a-f-]{36}$/, 'no choice cookie means on');
});

/* A fake browser: a cookie jar, a recorded dataLayer, a recorded script loader and a fake server. */
function browser({ href = 'https://aircheck.dev/', dnt = null, gpc = false, cookie = '', event = '7c9e6679-7425-40de-944b-e07fc1f90ae7', status = 200, pending = true } = {}) {
  const u = new URL(href);
  const jar = new Map(cookie ? cookie.split(';').map((s) => s.trim().split('=')) : []);
  // A new account's browser: the server set the marker beside the receipt, and clears both when it answers.
  if (pending) jar.set('aircheck_ads_pending', '1');
  const scripts = [], calls = [], win = {};
  const env = {
    location: { href, hostname: u.hostname, pathname: u.pathname, protocol: u.protocol },
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc },
    getCookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    setCookie: (c) => { const [kv, ...attrs] = c.split(';'); const [k, v] = kv.split('='); if (attrs.some((a) => a.trim() === 'Max-Age=0')) jar.delete(k.trim()); else jar.set(k.trim(), v); },
    win,
    loadScript: (src) => scripts.push(src),
    fetch: async (p, init) => { calls.push({ p, init }); jar.delete('aircheck_ads_pending'); return new Response(JSON.stringify({ event }), { status }); },
  };
  const conversions = () => (win.dataLayer || []).map((a) => [...a]).filter((a) => a[0] === 'event' && a[1] === 'conversion');
  return { ads: C.createAds(env), env, jar, scripts, calls, win, conversions };
}

test('nothing loads and nothing is requested after opting out', async () => {
  const b = browser({ href: 'https://aircheck.dev/?gclid=abc', cookie: 'aircheck_ads=no' });
  await b.ads.claim();
  assert.equal(b.ads.allowed(), false);
  assert.deepEqual(b.scripts, []);
  assert.deepEqual(b.calls, []);
  assert.equal(b.win.dataLayer, undefined);
});

test('Do Not Track and Global Privacy Control block the tag', async () => {
  for (const opts of [{ dnt: '1' }, { gpc: true }]) {
    const b = browser({ ...opts, cookie: 'aircheck_ads=yes' });
    assert.equal(b.ads.blocked(), true);
    assert.equal(b.ads.choose(true), false);
    assert.equal(b.jar.get('aircheck_ads'), 'no');
    await b.ads.claim();
    assert.deepEqual(b.scripts, []);
    assert.deepEqual(b.calls, []);
  }
});

test('only aircheck.dev and only the measured pages load the tag', async () => {
  for (const href of ['http://localhost:3326/', 'https://aircheck.example.com/', 'https://aircheck.dev/lanes', 'https://aircheck.dev/docs']) {
    const b = browser({ href, cookie: 'aircheck_ads=yes' });
    await b.ads.claim();
    assert.deepEqual(b.scripts, [], href);
    assert.deepEqual(b.calls, [], href);
  }
});

test('on by default: granted ad storage, root location, one conversion with the server event, never retried', async () => {
  const b = browser({ href: 'https://aircheck.dev/?gclid=Cj0_abc-1&utm_source=google&email=x@y.z' });
  assert.equal(b.ads.allowed(), true);
  assert.equal(b.jar.has('aircheck_ads'), false);
  await b.ads.claim();
  await b.ads.claim();
  assert.deepEqual(b.scripts, ['https://www.googletagmanager.com/gtag/js?id=AW-100000001']);
  const layer = b.win.dataLayer.map((a) => [...a]);
  assert.deepEqual(layer[0], ['consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', analytics_storage: 'denied', ad_personalization: 'denied' }]);
  assert.ok(layer.some((a) => a[0] === 'set' && a[1] === 'ads_data_redaction' && a[2] === true));
  assert.ok(layer.some((a) => a[0] === 'set' && a[1] === 'allow_ad_personalization_signals' && a[2] === false));
  const config = layer.find((a) => a[0] === 'config');
  assert.equal(config[2].page_location, 'https://aircheck.dev/?gclid=Cj0_abc-1');
  assert.equal(config[2].send_page_view, false);
  const conv = b.conversions();
  assert.equal(conv.length, 1);
  assert.deepEqual(conv[0][2], { send_to: 'AW-100000001/fixture-label', value: 0, currency: 'USD', transaction_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', page_location: 'https://aircheck.dev/', page_referrer: '', page_title: 'Aircheck', allow_ad_personalization_signals: false });
  assert.doesNotMatch(JSON.stringify(layer), /x@y\.z|utm_source/);
});

test('no conversion without a server event, or with a malformed one, or when the claim fails', async () => {
  for (const opts of [{ event: null }, { event: 'u1' }, { status: 401 }]) {
    const b = browser({ ...opts, cookie: 'aircheck_ads=yes' });
    await b.ads.claim();
    assert.equal(b.calls.length, 1);
    assert.equal(b.conversions().length, 0);
  }
});

test('a gclid is dropped off the landing, when repeated, or when malformed', () => {
  assert.equal(browser({ href: 'https://aircheck.dev/account?gclid=abc' }).ads.safeLocation(), 'https://aircheck.dev/');
  assert.equal(browser({ href: 'https://aircheck.dev/?gclid=a&gclid=b' }).ads.safeLocation(), 'https://aircheck.dev/');
  assert.equal(browser({ href: 'https://aircheck.dev/?gclid=<x>' }).ads.safeLocation(), 'https://aircheck.dev/');
});

test('turning it off denies consent and clears the Google attribution cookies', () => {
  const b = browser({ cookie: 'aircheck_ads=yes; _gcl_aw=GCL.1.abc; _gcl_au=1.1.2' });
  b.ads.tag();
  assert.equal(b.ads.choose(false), false);
  assert.equal(b.jar.get('aircheck_ads'), 'no');
  assert.equal(b.jar.has('_gcl_aw'), false);
  assert.equal(b.jar.has('_gcl_au'), false);
  const last = [...b.win.dataLayer.at(-1)];
  assert.deepEqual(last.slice(0, 2), ['consent', 'update']);
  assert.equal(last[2].ad_storage, 'denied');
});

test('the landing carries no opt-in control', () => {
  const home = fs.readFileSync(new URL('../src/app/(site)/home/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /AdsChoice/);
  assert.equal('fromGoogleAd' in browser({}).ads, false);
});

test('Meta: the pixel loads with Google unless opted out, on a measured page with no query beyond ad tags', async () => {
  const before = browser({ href: 'https://aircheck.dev/?utm_source=fb&fbclid=x', cookie: 'aircheck_ads=no' });
  await before.ads.claim();
  assert.equal(before.win.fbq, undefined);
  const b = browser({ href: 'https://aircheck.dev/account' });
  b.ads.choose(true);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(b.scripts.includes('https://connect.facebook.net/en_US/fbevents.js'));
  const q = b.win.fbq.queue.map((a) => [...a]);
  assert.deepEqual(q.slice(0, 3), [['set', 'autoConfig', false, C.META_PIXEL], ['init', C.META_PIXEL], ['track', 'PageView']]);
  assert.deepEqual(q.at(-1), ['trackCustom', 'account_created', {}, { eventID: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }], 'the pixel copy carries the server event id');
  const tagged = browser({ href: 'https://aircheck.dev/?email=x@y.z', cookie: 'aircheck_ads=yes' });
  await tagged.ads.claim();
  assert.equal(tagged.win.fbq, undefined, 'any other query keeps the pixel off');
  b.jar.set('_fbp', 'fb.1.1700000000000.1');
  b.ads.choose(false);
  assert.deepEqual(b.win.fbq.queue.map((a) => [...a]).at(-1), ['consent', 'revoke']);
  assert.equal(b.jar.has('_fbp'), false);
});

test('Meta: the claim sends the same event id to the Conversions API with no customer data', async () => {
  const receipt = 'aircheck_ads_result=' + value(await S.issueAdsReceipt('u1'));
  const viewer = async () => 'u1';
  const original = globalThis.fetch, sent = [];
  globalThis.fetch = async (u, o) => { sent.push({ u: String(u), data: JSON.parse(o.body.get('data'))[0] }); return new Response('{}'); };
  process.env.META_CAPI_TOKEN = 'fixture';
  try {
    const { event } = await (await S.handleAdsClaim(req(`aircheck_ads=yes; _fbp=fb.1.1700000000000.9; ${receipt}`, { 'user-agent': 'UA', 'cf-connecting-ip': '192.0.2.1' }), viewer)).json();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].u, 'https://graph.facebook.com/v24.0/100000000000002/events');
    assert.deepEqual(sent[0].data, { event_name: 'account_created', event_time: sent[0].data.event_time, event_id: event, action_source: 'website', event_source_url: 'https://aircheck.dev/', user_data: { client_ip_address: '192.0.2.1', client_user_agent: 'UA', fbp: 'fb.1.1700000000000.9' } });
    await S.handleAdsClaim(req(`aircheck_ads=no; ${receipt}`, { 'user-agent': 'UA' }), viewer);
    assert.equal(sent.length, 1, 'opted out, no Meta event');
  } finally { globalThis.fetch = original; delete process.env.META_CAPI_TOKEN; }
});

test('X and Reddit: the pixels load with Google on the same pages as Meta and send one Sign up each', async () => {
  const before = browser({ href: 'https://aircheck.dev/?utm_source=x', cookie: 'aircheck_ads=no' });
  await before.ads.claim();
  assert.equal(before.win.twq, undefined); assert.equal(before.win.rdt, undefined);
  const b = browser({ href: 'https://aircheck.dev/account' });
  b.ads.choose(true);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(b.scripts.includes('https://static.ads-twitter.com/uwt.js')); assert.ok(b.scripts.includes('https://www.redditstatic.com/ads/pixel.js'));
  assert.deepEqual(b.win.twq.queue.map((a) => [...a]), [['config', 'fx001'], ['event', 'tw-fx001-fixture', {}]]);
  assert.deepEqual(b.win.rdt.callQueue.map((a) => [...a]), [['init', 'a2_fixture'], ['track', 'PageVisit'], ['track', 'SignUp']]);
  const tagged = browser({ href: 'https://aircheck.dev/?email=x@y.z', cookie: 'aircheck_ads=yes' });
  await tagged.ads.claim();
  assert.equal(tagged.win.twq, undefined); assert.equal(tagged.win.rdt, undefined);
});

test('a visit with nothing to claim loads the tags and sends no claim request', async () => {
  // Signed out, or signed in with no new account: the server set no marker.
  for (const href of ['https://aircheck.dev/', 'https://aircheck.dev/privacy', 'https://aircheck.dev/account']) {
    const b = browser({ href, pending: false });
    await b.ads.claim();
    await b.ads.claim();
    assert.deepEqual(b.calls, [], `${href} asks the server for nothing`);
    assert.ok(b.scripts.includes('https://www.googletagmanager.com/gtag/js?id=AW-100000001') && b.scripts.includes('https://connect.facebook.net/en_US/fbevents.js'), 'the page view tags still load');
    assert.deepEqual(b.conversions(), []);
  }
  // Any value but the server's 1 is not the marker.
  const odd = browser({ pending: false, cookie: 'aircheck_ads_pending=0' });
  await odd.ads.claim();
  assert.deepEqual(odd.calls, []);
});

test('a new account is claimed exactly once: the marker arrives with the receipt and leaves with it', async () => {
  // The server half: one response carries both cookies, with the same lifetime and path.
  const headers = new Headers();
  await S.receiptForNewAccount(new Request('https://aircheck.dev/api/auth', { method: 'POST' }), headers, 'u1', true);
  const set = headers.getSetCookie();
  assert.equal(set.length, 2);
  assert.match(set[0], /^aircheck_ads_result=.+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(set[1], 'aircheck_ads_pending=1; Max-Age=600; Path=/; SameSite=Lax; Secure', 'readable by the page, no data in it');
  const none = new Headers();
  await S.receiptForNewAccount(new Request('https://aircheck.dev/api/auth', { method: 'POST' }), none, 'u1', false);
  await S.receiptForNewAccount(new Request('https://aircheck.dev/api/auth', { method: 'POST', headers: { cookie: 'aircheck_ads=no' } }), none, 'u1', true);
  assert.deepEqual(none.getSetCookie(), [], 'no receipt, no marker');
  // Every answer of the claim route clears both, so the marker never outlives the receipt.
  const receipt = set[0].split(';')[0];
  for (const [cookie, viewer, status] of [[`aircheck_session=ok; ${receipt}`, async () => 'u1', 200], ['', async () => null, 401]]) {
    const r = await S.handleAdsClaim(new Request('https://aircheck.dev/api/ads-conversion', { method: 'POST', headers: { origin: 'https://aircheck.dev', cookie } }), viewer);
    assert.equal(r.status, status);
    assert.deepEqual(r.headers.getSetCookie().map((c) => c.split(';').slice(0, 2).join(';')), ['aircheck_ads_result=; Max-Age=0', 'aircheck_ads_pending=; Max-Age=0']);
  }
  // The browser half: with the marker the claim goes out once and the conversion is sent; then nothing more.
  const b = browser();
  await b.ads.claim();
  await b.ads.claim();
  assert.equal(b.calls.length, 1);
  assert.equal(b.conversions().length, 1);
  assert.equal(b.jar.has('aircheck_ads_pending'), false);
});

test('with no ids set, a build loads no tag, no pixel and sends no event', async () => {
  const { execFileSync } = await import('node:child_process');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NEXT_PUBLIC_AIRCHECK_')));
  const probe = `const C = await import(${JSON.stringify(new URL('../src/lib/ads-conversion.ts', import.meta.url).href)});
    const T = await import(${JSON.stringify(new URL('../src/lib/telemetry.ts', import.meta.url).href)});
    const M = await import(${JSON.stringify(new URL('../src/server/meta-capi.mjs', import.meta.url).href)});
    const scripts = [];
    const a = C.createAds({ location: new URL('https://aircheck.dev/'), navigator: {}, getCookie: () => '', setCookie() {}, win: {}, loadScript: (s) => scripts.push(s), fetch: async () => { throw new Error('fetched'); } });
    await a.claim();
    console.log(JSON.stringify({ scripts, tag: a.tag(), pixel: a.pixel(), analytics: T.analyticsOn(), ads: T.adsOn(), meta: await M.sendMetaEvent({ event_name: 'x' }, { token: 't' }) }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', new URL('./ts-resolve.mjs', import.meta.url).pathname, '--input-type=module', '-e', probe], { env, encoding: 'utf8' }));
  assert.deepEqual(out, { scripts: [], tag: false, pixel: false, analytics: false, ads: false, meta: 'no-dataset' });
});
