// Contract tests for signing in and for the hosted store: who an account is, and that moving to a
// hosted store is a change of transport and not of format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { Users, Sessions, cookieHeader, clearCookie, cookieFrom, COOKIE } = await import('../src/server/auth.ts');
const { HttpStore, LocalStore } = await import('../src/server/account.ts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-auth-'));

test('an account is an email and a password, and the password is never stored', () => {
  const file = path.join(tmp, 'users.json');
  const U = new Users(file);
  const u = U.create('Someone@Example.com ', 'a-long-enough-password');
  assert.equal(u.email, 'someone@example.com');          // normalised
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('a-long-enough-password'));    // only the derived key is written
  assert.ok(u.hash.length > 64 && u.salt.length === 32);

  assert.ok(U.verify('someone@example.com', 'a-long-enough-password'));
  assert.equal(U.verify('someone@example.com', 'wrong-password-here'), null);
  // an unknown address answers exactly like a wrong password, so this cannot enumerate accounts
  assert.equal(U.verify('nobody@example.com', 'a-long-enough-password'), null);
  // the same address twice is one account
  assert.throws(() => U.create('SOMEONE@example.com', 'another-password'), /already an account/);
  assert.throws(() => U.create('not-an-email', 'a-long-enough-password'), /not an email/);
  assert.throws(() => U.create('new@example.com', 'short'), /at least 8/);
});

test('a password can be changed, and the old one stops working', () => {
  const U = new Users(path.join(tmp, 'users2.json'));
  const u = U.create('a@b.co', 'first-password-x');
  U.setPassword(u.id, 'second-password-x');
  assert.equal(U.verify('a@b.co', 'first-password-x'), null);
  assert.ok(U.verify('a@b.co', 'second-password-x'));
});

test('a session names its user, and closing it ends that', () => {
  const S = new Sessions(path.join(tmp, 'sessions.json'));
  const s = S.open('user-1');
  assert.equal(S.user(s.token), 'user-1');
  assert.equal(S.user('made-up'), null);
  assert.equal(S.user(undefined), null);
  S.close(s.token);
  assert.equal(S.user(s.token), null);
});

test('an expired session is not a session', () => {
  const file = path.join(tmp, 'expired.json');
  fs.writeFileSync(file, JSON.stringify([
    { token: 'stale', user: 'u', createdAt: '2020-01-01T00:00:00Z', expiresAt: '2020-02-01T00:00:00Z' },
  ]));
  assert.equal(new Sessions(file).user('stale'), null);
});

test('the session cookie cannot be read by script, and is only secure over https', () => {
  const set = cookieHeader('abc', true);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  assert.ok(!cookieHeader('abc', false).includes('Secure'));   // plain http, local
  assert.match(clearCookie(), /Max-Age=0/);

  const req = new Request('http://x.test', { headers: { cookie: `other=1; ${COOKIE}=tok-value; z=2` } });
  assert.equal(cookieFrom(req), 'tok-value');
  assert.equal(cookieFrom(new Request('http://x.test')), undefined);
});

test('the hosted store speaks the same four calls, and sends JSON only', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method || 'GET', auth: init?.headers?.authorization, body: init?.body });
    return new Response(JSON.stringify({ manifests: [{ id: 'p1', day: '2026-11-09', manifest: { lane: 'brand-x' }, updatedAt: 'now' }] }), { status: 200 });
  };
  try {
    const s = new HttpStore('https://aircheck.dev/', 'ac_test');
    const rows = await s.list('me', '2026-11-09');
    assert.equal(rows.length, 1);
    assert.equal(seen[0].auth, 'Bearer ac_test');
    assert.match(seen[0].url, /\/api\/sync\?day=2026-11-09$/);   // no double slash from the base

    await s.put('me', { id: 'p2', day: '2026-11-09', manifest: { lane: 'brand-x', media: ['https://cdn.test/a.png'] }, updatedAt: '' });
    const sent = JSON.parse(seen[1].body);
    // a media entry crosses the wire as a reference; there is no upload and no field for one
    assert.deepEqual(sent.manifests[0].manifest.media, ['https://cdn.test/a.png']);
    assert.ok(!JSON.stringify(sent).includes('base64'));

    // a bad manifest never reaches the network
    const before = seen.length;
    await assert.rejects(() => s.put('me', { id: 'x', day: '2026-11-09', manifest: {}, updatedAt: '' }), /lane/);
    assert.equal(seen.length, before);
  } finally { globalThis.fetch = real; }
});

test('a hosted store failure says what the server said', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('no such account', { status: 401 });
  try {
    await assert.rejects(() => new HttpStore('https://x.test', 't').list('me', '2026-11-09'), /401.*no such account/s);
  } finally { globalThis.fetch = real; }
});

test('both stores answer the same shape, so swapping one for the other changes nothing above', async () => {
  const local = new LocalStore(path.join(tmp, 'swap'));
  const rec = { id: 'p1', day: '2026-11-09', manifest: { lane: 'brand-x', text: 'hi' }, updatedAt: '' };
  const saved = await local.put('me', rec);
  assert.deepEqual(Object.keys(saved).sort(), ['day', 'id', 'manifest', 'updatedAt']);
  const got = await local.list('me', '2026-11-09');
  assert.deepEqual(Object.keys(got[0]).sort(), ['day', 'id', 'manifest', 'updatedAt']);
});

const { deleteAccount, Tokens } = await import('../src/server/account.ts');

const manifestOf = (id) => ({ id, day: '2026-11-12', updatedAt: '', manifest: { lane: 'founder-x', at: '2026-11-12T10:00:00-05:00', text: 'a post', media: [] } });

test('deleting a local account removes its row, sessions, tokens and manifests, and nobody else\'s', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-delete-'));
  const cfg = { dataDir: root };
  const U = new Users(path.join(root, 'users.json')), S = new Sessions(path.join(root, 'sessions.json')), T = new Tokens(path.join(root, 'tokens.json')), M = new LocalStore(root);
  const gone = U.create('gone@example.com', 'a-long-enough-password'), kept = U.create('kept@example.com', 'a-long-enough-password');
  const goneSession = S.open(gone.id), keptSession = S.open(kept.id);
  const goneToken = T.issue(gone.id, 'laptop'), keptToken = T.issue(kept.id, 'studio');
  await M.put(gone.id, manifestOf('one')); await M.put(kept.id, manifestOf('two'));

  assert.equal(await deleteAccount(cfg, gone.id), true);
  assert.equal(U.byId(gone.id), null);
  assert.equal(U.verify('gone@example.com', 'a-long-enough-password'), null, 'the password signs in to nothing');
  assert.equal(S.user(goneSession.token), null, 'every session of the account is ended');
  assert.equal(T.verify(goneToken.token), null, 'a machine token of the account stops working');
  assert.deepEqual(await M.list(gone.id, '2026-11-12'), []);
  assert.equal(fs.existsSync(path.join(root, 'accounts', gone.id)), false);

  assert.ok(U.byId(kept.id));
  assert.equal(S.user(keptSession.token), kept.id);
  assert.equal(T.verify(keptToken.token), kept.id);
  assert.equal((await M.list(kept.id, '2026-11-12')).length, 1);

  assert.equal(await deleteAccount(cfg, gone.id), false, 'a second delete finds nothing');
  assert.equal(await deleteAccount(cfg, ''), false);
  assert.equal(await deleteAccount(cfg, '..'), false, 'an id that is not an account removes no folder');
  assert.equal((await M.list(kept.id, '2026-11-12')).length, 1);
  // The same address can make a new, empty account afterwards.
  assert.notEqual(U.create('gone@example.com', 'a-long-enough-password').id, gone.id);
});

test('deleting a hosted account is one exact delete of its own aircheck_users row', async () => {
  const real = globalThis.fetch, before = { ...process.env }, calls = [];
  Object.assign(process.env, { AIRCHECK_DB: 'supabase', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_URL: 'https://db.example' });
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init.method, prefer: init.headers.prefer, auth: init.headers.authorization }); return new Response(JSON.stringify(String(url).includes('abc123') ? [{ id: 'abc123' }] : []), { status: 200 }); };
  try {
    assert.equal(await deleteAccount({ dataDir: tmp }, 'abc123'), true);
    assert.deepEqual(calls, [{ url: 'https://db.example/rest/v1/aircheck_users?id=eq.abc123&select=id', method: 'DELETE', prefer: 'return=representation', auth: 'Bearer service' }],
      'one request, on aircheck_users only, filtered to the one id: the shared sign-in tables are never addressed');
    assert.equal(await deleteAccount({ dataDir: tmp }, 'nobody'), false);
    assert.equal(calls.length, 2);
    assert.equal(await deleteAccount({ dataDir: tmp }, ''), false, 'an empty id sends no request: an unfiltered delete is impossible');
    assert.equal(calls.length, 2);
    await deleteAccount({ dataDir: tmp }, 'a&id=neq.x');
    assert.equal(calls[2].url, 'https://db.example/rest/v1/aircheck_users?id=eq.a%26id%3Dneq.x&select=id', 'the id cannot widen the filter');
  } finally {
    globalThis.fetch = real;
    for (const k of ['AIRCHECK_DB', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
  }
});
