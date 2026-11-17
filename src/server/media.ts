import fs from 'node:fs';
import path from 'node:path';
import type { MediaRef } from './types';

/* Local media. The browser asks for /api/media?p=<absolute path>; the server answers only for files
 * under a configured media root or the data dir, after resolving symlinks, so the endpoint can never
 * read the rest of the disk. */

const KINDS: Record<string, MediaRef['kind']> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image', '.svg': 'image',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video',
  '.pdf': 'doc', '.md': 'doc', '.txt': 'doc', '.html': 'doc',
};

export const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/plain; charset=utf-8',
};

export const mediaKind = (p: string): MediaRef['kind'] => KINDS[path.extname(p).toLowerCase()] || 'other';
export const ref = (p: string): MediaRef => ({ path: p, kind: mediaKind(p) });

export function allowed(file: string, roots: string[]): string | null {
  let real: string;
  try { real = fs.realpathSync(file); } catch { return null; }
  for (const r of roots) {
    let root: string;
    try { root = fs.realpathSync(r); } catch { continue; }
    if (real === root || real.startsWith(root + path.sep)) return real;
  }
  return null;
}
