// The bridge's machine API: only an allowed origin may start a run or read one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './bridge.mjs';

test('the machine API answers an allowed origin and refuses any other, or none', async () => {
  const b = await start({ port: 0, roots: [], origins: ['https://aircheck.dev'], config: { bridge: {}, timezone: 'UTC' } });
  try {
    const call = (origin, init = {}) => fetch(`${b.url}/api/runs`, { ...init, headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' } });
    assert.equal((await call('https://evil.example')).status, 403);
    assert.equal((await call(null)).status, 403);
    assert.equal((await call('https://evil.example', { method: 'POST', body: '{}' })).status, 403);
    const pre = await fetch(`${b.url}/api/runs`, { method: 'OPTIONS', headers: { origin: 'https://aircheck.dev', 'access-control-request-private-network': 'true' } });
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  } finally { await b.close(); }
});
