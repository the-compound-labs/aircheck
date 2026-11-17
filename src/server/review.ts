import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config';
import { store } from './account';
import type { QueueItem, Review, ReviewState } from './types';

/* THE REVIEW GATE. A person's decision on one queued post: approved, held, or sent back with a
 * note. The posting job asks for it right before it sends (the MCP `check_post` tool), so the
 * decision has to live where that job can read it:
 *
 *   - a post that synced to an account carries it in its stored manifest, as meta.review. A later
 *     sync from the machine keeps it (see keepReview), so re-pushing a day never wipes a decision.
 *   - a post read straight off disk, with no account copy, keeps it beside the data folder, in
 *     <dataDir>/reviews/<day>/<id>.json.
 *
 * Ad creatives have their own ladder (draft → approved → live) and are not reviewed here. */

export const REVIEW_STATES: readonly ReviewState[] = ['approved', 'held', 'changes'];

const safe = (s: string) => s.replace(/[^a-z0-9._-]/gi, '-');
/** "<day>:<id>" is how the page names an account post; the store keys it by the bare id. */
export const bareId = (id: string) => id.replace(/^\d{4}-\d{2}-\d{2}:/, '');

function isReview(v: unknown): v is Review {
  return !!v && typeof v === 'object' && REVIEW_STATES.includes((v as Review).state) && typeof (v as Review).at === 'string';
}

/** The decision a stored manifest carries, if any. */
export function reviewFromMeta(meta: unknown): Review | undefined {
  const r = (meta as { review?: unknown } | undefined)?.review;
  return isReview(r) ? r : undefined;
}

/** True when a post still needs a person: queued, not an ad, and nobody has decided yet. */
export const needsReview = (i: QueueItem) => !i.ad && i.status === 'queued' && !i.review && i.day !== 'templates';

/* ------------------------------------------------------------- side files */

const sideFile = (cfg: Config, day: string, id: string) => path.join(cfg.dataDir, 'reviews', safe(day), `${safe(bareId(id))}.json`);

function readSide(cfg: Config, day: string, id: string): Review | undefined {
  try { const r = JSON.parse(fs.readFileSync(sideFile(cfg, day, id), 'utf8')); return isReview(r) ? r : undefined; } catch { return undefined; }
}

function writeSide(cfg: Config, day: string, id: string, r: Review | null) {
  const f = sideFile(cfg, day, id);
  if (!r) { try { fs.unlinkSync(f); } catch { /* none */ } return; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(r, null, 2) + '\n');
  fs.renameSync(f + '.tmp', f);
}

/* ------------------------------------------------------------- read/write */

/** Every item with its decision attached: the account copy's, else the side file's. */
export function withReviews(cfg: Config, items: QueueItem[]): QueueItem[] {
  return items.map((i) => {
    const r = reviewFromMeta(i.meta) || (i.day ? readSide(cfg, i.day, i.id) : undefined);
    return r ? { ...i, review: r } : i;
  });
}

/** One post's decision. `account` is null for a disk-only install. */
export async function getReview(cfg: Config, account: string | null, day: string, id: string): Promise<Review | undefined> {
  if (account) {
    const rec = await store(cfg).get(account, day, bareId(id));
    if (rec) return reviewFromMeta(rec.manifest.meta);
  }
  return readSide(cfg, day, id);
}

/** Record a decision, or clear it with state null. Returns the decision as stored. */
export async function setReview(cfg: Config, account: string | null, day: string, id: string, state: ReviewState | null, note?: string, by?: string): Promise<Review | null> {
  const r: Review | null = state ? { state, at: new Date().toISOString(), ...(note ? { note: note.slice(0, 2000) } : {}), ...(by ? { by } : {}) } : null;
  if (account) {
    const s = store(cfg);
    const rec = await s.get(account, day, bareId(id));
    if (rec) {
      const meta = { ...(rec.manifest.meta || {}) } as Record<string, unknown>;
      if (r) meta.review = r; else delete meta.review;
      await s.put(account, { ...rec, manifest: { ...rec.manifest, meta } });
      return r;
    }
  }
  writeSide(cfg, day, id, r);
  return r;
}

/** A sync replaces the stored manifest; the decision on it is the account's, not the machine's,
 *  so an incoming copy without one keeps the stored one. */
export function keepReview<M extends { meta?: Record<string, unknown> }>(incoming: M, stored: M | undefined): M {
  const had = reviewFromMeta(stored?.meta);
  if (!had || reviewFromMeta(incoming.meta)) return incoming;
  return { ...incoming, meta: { ...(incoming.meta || {}), review: had } };
}

/** What the posting job should do: the decision, and whether to send. A lane on `review` sends only
 *  once approved; a lane on `auto` (the default) sends unless held or sent back. */
export function decision(r: Review | undefined, policy: 'auto' | 'review') {
  const state = r?.state || 'pending';
  const send = state === 'approved' || (state === 'pending' && policy === 'auto');
  return { decision: state, send, policy, ...(r?.note ? { note: r.note } : {}), ...(r?.at ? { at: r.at } : {}) };
}
