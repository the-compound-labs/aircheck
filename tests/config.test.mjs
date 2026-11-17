// A fresh install with no config anywhere still runs, on the MCP server's default queue folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('with no config file, the app reads ~/.aircheck/queue and serves media from ~/.aircheck', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aircheck-home-')));
  const env = { ...process.env, HOME: home };
  delete env.AIRCHECK_CONFIG; delete env.AIRCHECK_DB;
  const probe = `const { loadConfig, configPath } = await import(${JSON.stringify(new URL('../src/server/config.ts', import.meta.url).href)});
    const c = loadConfig(); console.log(JSON.stringify({ file: configPath(), queue: c.queue, roots: c.mediaRoots, agents: Object.keys(c.agents.commands), plugins: c.plugins }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', new URL('./ts-resolve.mjs', import.meta.url).pathname, '--input-type=module', '-e', probe], { env, cwd: home, encoding: 'utf8' }));
  assert.equal(out.file, path.join(home, 'aircheck.config.json'));
  assert.deepEqual(out.queue, [{ source: 'folder', dir: '~/.aircheck/queue' }]);
  assert.deepEqual(out.roots, [path.join(home, '.aircheck')]);
  assert.deepEqual(out.agents, ['claude', 'codex']);
  assert.deepEqual(out.plugins, []);
});
