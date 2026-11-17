#!/usr/bin/env node
/* Start the MCP server over stdio the way a client does, list its tools and read today's queue, then
 * exit. Uses a throwaway data folder and no account. Exit 1 if anything is missing.
 *   node scripts/mcp-smoke.mjs [path/to/server.mjs] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aircheck-smoke-'));
const cfg = path.join(home, 'aircheck.config.json');
fs.writeFileSync(cfg, JSON.stringify({ dataDir: home, queue: [{ source: 'folder', dir: path.join(home, 'queue') }], mediaRoots: [home] }));
const env = { ...process.env, AIRCHECK_CONFIG: cfg, AIRCHECK_BRIDGE: 'off', AIRCHECK_TOKEN: '' };
const child = spawn(process.execPath, [server], { env, stdio: ['pipe', 'pipe', 'inherit'] });
const want = new Map();
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); want.get(m.id)?.(m); } catch { /* not a message */ }
  }
});
const call = (id, method, params = {}) => new Promise((resolve) => { want.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const timer = setTimeout(() => { console.error('mcp smoke: timed out'); child.kill(); process.exit(1); }, 20000);

const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const tools = (await call(2, 'tools/list')).result?.tools?.map((t) => t.name) || [];
const queue = await call(3, 'tools/call', { name: 'list_queue', arguments: {} });
clearTimeout(timer);
child.kill();
const text = queue.result?.content?.[0]?.text || '';
const ok = init.result?.serverInfo && tools.includes('queue_post') && tools.includes('list_queue') && /"count":\s*0/.test(text);
console.log(JSON.stringify({ server: init.result?.serverInfo, tools, listQueue: text.slice(0, 200) }));
process.exit(ok ? 0 : 1);
