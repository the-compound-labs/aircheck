// The setup link a phone visitor emails to themself from /demo (2026-11-15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { admit } from '../worker/admission.mjs';
import { setupLinkMail } from '../src/server/mail-template.ts';

const req = (path, method = 'POST') => new Request(`https://aircheck.dev${path}`, { method, headers: { 'cf-connecting-ip': '203.0.113.4' } });
const limiter = (ok) => ({ calls: 0, keys: [], async limit({ key }) { this.calls++; this.keys.push(key); return { success: ok }; } });
const env = (ip, all) => ({ SETUP_LINK_LIMIT: limiter(ip), SETUP_LINK_GLOBAL: limiter(all), DATABASE_CLIENT_LIMIT: limiter(true) });

test('setup-link sends are limited per client and overall before the route', async () => {
  const perClient = env(false, true);
  assert.equal((await admit(req('/api/setup-link'), perClient, '/api/setup-link')).status, 429);
  assert.deepEqual(perClient.SETUP_LINK_LIMIT.keys, ['203.0.113.4']);
  const overall = env(true, false);
  assert.equal((await admit(req('/api/setup-link'), overall, '/api/setup-link')).status, 429);
  assert.deepEqual(overall.SETUP_LINK_GLOBAL.keys, ['all']);
  assert.equal(await admit(req('/api/setup-link'), env(true, true), '/api/setup-link'), null);
});

test('a missing setup-link limiter refuses instead of sending unmetered', async () => {
  assert.equal((await admit(req('/api/setup-link'), { DATABASE_CLIENT_LIMIT: limiter(true) }, '/api/setup-link')).status, 429);
});

test('the setup email links to the guide on aircheck.dev', () => {
  const m = setupLinkMail();
  assert.ok(m.subject);
  assert.match(m.html, /https:\/\/aircheck\.dev\/docs/);
  assert.match(m.text, /aircheck\.dev\/docs/);
});
