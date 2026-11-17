// Regression tests for the database contract: the bounded read fetch
// every PostgREST call in src/server/db.ts goes through, and the Worker's admission in front of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseFetch } from '../src/server/database-overload.mjs';
import { admit } from '../worker/admission.mjs';

const url = 'https://database.invalid/rest/v1/aircheck_manifests';

test('reads each reach the database; no response cache', async () => {
  let calls = 0;
  const read = createDatabaseFetch({ fetchFn: async () => { calls++; return new Response('[]'); } });
  await read(url); await read(url);
  assert.equal(calls, 2);
});

test('concurrency overflow is shed at once, not queued', async () => {
  let calls = 0, release;
  const read = createDatabaseFetch({ maxConcurrent: 1, fetchFn: async () => { calls++; return new Promise((r) => { release = r; }); } });
  const pending = read(url);
  assert.equal((await read(url)).status, 503);
  assert.equal(calls, 1);
  release(new Response('[]')); await pending;
});

test('three gateway failures open the circuit; one probe after the cooldown', async () => {
  let calls = 0, clock = 0, release;
  const read = createDatabaseFetch({ now: () => clock, fetchFn: async () => { calls++; if (calls < 4) return new Response('', { status: 503 }); return new Promise((r) => { release = r; }); } });
  for (let i = 0; i < 3; i++) await read(url);
  assert.equal((await read(url)).status, 503); assert.equal(calls, 3);
  clock = 15_001; const probe = read(url);
  assert.equal((await read(url)).status, 503); assert.equal(calls, 4);
  release(new Response('[]')); await probe;
});

test('writes go straight through an open read circuit (sign-up, sessions, manifest upserts)', async () => {
  let calls = 0;
  const read = createDatabaseFetch({ threshold: 1, fetchFn: async () => { calls++; return new Response('', { status: 503 }); } });
  await read(url); await read(url); assert.equal(calls, 1);
  await read(url, { method: 'POST' }); await read(url, { method: 'PATCH' }); await read(url, { method: 'DELETE' });
  assert.equal(calls, 4);
});

test('an oversized read is refused and cancelled', async () => {
  let aborted = false;
  const read = createDatabaseFetch({ maxBodyBytes: 2, fetchFn: async (_, init) => { init.signal.addEventListener('abort', () => { aborted = true; }); return new Response('oversized'); } });
  await assert.rejects(read(url), /bounded read size/);
  assert.equal(aborted, true);
});

test('a hung read hits the deadline', async () => {
  const read = createDatabaseFetch({ timeoutMs: 5, fetchFn: async (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })) });
  await assert.rejects(read(url), /deadline/);
});

const req = (path, method = 'GET') => new Request(`https://aircheck.dev${path}`, { method, headers: { 'cf-connecting-ip': '203.0.113.4' } });
const limiter = (ok) => ({ calls: 0, async limit() { this.calls++; return { success: ok }; } });

test('sign-in attempts are limited per client before the database', async () => {
  const env = { AUTH_LIMIT: limiter(false), DATABASE_CLIENT_LIMIT: limiter(true) };
  const r = await admit(req('/api/auth', 'POST'), env, '/api/auth');
  assert.equal(r.status, 429); assert.equal(env.AUTH_LIMIT.calls, 1);
});

test('account reads are limited per client; static build files are not', async () => {
  const env = { AUTH_LIMIT: limiter(true), DATABASE_CLIENT_LIMIT: limiter(false) };
  assert.equal((await admit(req('/api/sync'), env, '/api/sync')).status, 429);
  assert.equal(await admit(req('/_next/static/x.js'), env, '/_next/static/x.js'), null);
  const open = { AUTH_LIMIT: limiter(true), DATABASE_CLIENT_LIMIT: limiter(true) };
  assert.equal(await admit(req('/api/sync'), open, '/api/sync'), null);
});

test('a missing limiter binding refuses instead of passing traffic unmetered', async () => {
  assert.equal((await admit(req('/api/sync'), {}, '/api/sync')).status, 429);
  assert.equal((await admit(req('/api/auth', 'POST'), {}, '/api/auth')).status, 429);
});
