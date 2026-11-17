import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { loadConfig } from '@/server/config';
import { allowed, TYPES } from '@/server/media';

export const dynamic = 'force-dynamic';

/* Serves one local media file named by absolute path (?p=), only from a configured media root or
 * the data dir. Honors Range so videos seek. */
export function GET(req: Request) {
  const cfg = loadConfig();
  const p = new URL(req.url).searchParams.get('p') || '';
  const file = path.isAbsolute(p) ? allowed(p, [...cfg.mediaRoots, cfg.dataDir]) : null;
  if (!file) return new Response('Not found', { status: 404 });
  const stat = fs.statSync(file);
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=60' };
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) } });
  }
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, 'Content-Length': String(stat.size) } });
}
