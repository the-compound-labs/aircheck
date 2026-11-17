import { loadConfig, today } from './config';
import { cancelRun, getRun, listRuns, listRunsFor, runFiles, runFileTimes, runLog, startRun } from './runs';
import { replaceWithRun, undoReplace } from './replace';
import { replaceAdWithRun, undoAdReplace } from './ad-replace';
import { loadLanes } from './sources/lanes';
import { loadProducts } from './sources/products';
import { loadQueue } from './sources/queue';
import { loadAds } from './sources/ads';
import type { AdCreative, QueueItem, Run, RunAction } from './types';

/* THE MACHINE'S OWN API. Everything that has to happen on the machine holding the pipelines:
 * previews, Fix / Example / Feedback on a post or a creative, revising a run, and swapping a run's
 * output in or back out. The local app serves it at /api/runs and /api/studio; on aircheck.dev the
 * browser calls the same paths on the media bridge, which the MCP server runs on this machine, from
 * a bundle of this file (mcp/local-api.mjs, built by scripts/build-mcp-local.mjs). One source, so
 * the two never drift.
 *
 * `changed` names a queued post or creative that a call rewrote on disk, so the bridge can sync it
 * to the account. */

export type ApiResult = { status: number; body: unknown; changed?: { day: string; id: string } | { ad: string } };

const ok = (body: unknown, extra: Partial<ApiResult> = {}): ApiResult => ({ status: 200, body, ...extra });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });
const ACTIONS: RunAction[] = ['preview', 'example', 'feedback', 'repair'];

/* A post as aircheck.dev names it ("<day>:<synced id>") or as this machine does. The synced id is
 * the local one with its day prefix off and unsafe characters dashed, so both resolve here. */
function findItem(cfg: ReturnType<typeof loadConfig>, day: string, id: string): QueueItem | undefined {
  const items = loadQueue(cfg.queue, day);
  return items.find((i) => i.id === id) || items.find((i) => `${day}:${postRow(i, day).id}` === id);
}

export async function localApi(method: string, pathname: string, query: URLSearchParams, body: Record<string, unknown> = {}): Promise<ApiResult> {
  const cfg = loadConfig();
  const parts = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);

  /* What this machine can run: its lanes with their formats, its products, its agents. */
  if (parts[0] === 'studio' && method === 'GET') {
    return ok({ lanes: loadLanes(cfg.lanes), products: loadProducts(cfg.products), agents: Object.keys(cfg.agents.commands), defaultAgent: cfg.agents.default });
  }
  if (parts[0] !== 'runs') return err(404, 'No such endpoint.');

  if (parts.length === 1 && method === 'GET') {
    if (query.get('ad')) return ok({ runs: listRuns(cfg).filter((r) => r.ad?.id === query.get('ad')) });
    if (query.get('day') && query.get('item')) {
      const day = query.get('day')!;
      const local = findItem(cfg, day, query.get('item')!)?.id || query.get('item')!;
      return ok({ runs: listRunsFor(cfg, day, local) });
    }
    return ok({ runs: listRuns(cfg, query.get('lane') || undefined) });
  }

  if (parts.length === 1 && method === 'POST') {
    const action: RunAction = ACTIONS.includes(body.action as RunAction) ? body.action as RunAction : 'preview';
    const agent = typeof body.agent === 'string' ? body.agent : undefined;
    if (agent && !cfg.agents.commands[agent]) return err(400, `Unknown agent '${agent}'.`);
    const request = typeof body.request === 'string' ? body.request.trim().slice(0, 4000) || undefined : undefined;
    const lanes = loadLanes(cfg.lanes);
    try {
      if (action !== 'preview' && body.ad) {
        const ad = loadAds(cfg.ads).find((c) => c.id === body.ad);
        if (!ad) return err(400, 'That creative is not in the ad media store on this machine.');
        if (action === 'feedback' && !request) return err(400, 'Write what should change.');
        const lane = { id: `ads:${ad.product}`, name: `${ad.product} ads`, platform: 'other' as const, formats: [] };
        return ok({ run: startRun(cfg, { lane, action, ad, request, agent }) });
      }
      if (action !== 'preview') {
        const item = findItem(cfg, String(body.day || ''), String(body.item || ''));
        if (!item) return err(400, 'That post is not in the queue for that day on this machine.');
        if (action === 'feedback' && !request) return err(400, 'Write what should change.');
        const lane = lanes.find((l) => l.id === item.lane) || { id: item.lane, name: item.lane, platform: 'other' as const, formats: [] };
        return ok({ run: startRun(cfg, { lane, action, item, request, agent }) });
      }
      const lane = lanes.find((l) => l.id === body.lane);
      if (!lane) return err(400, `Unknown lane '${body.lane}'.`);
      const product = body.product ? loadProducts(cfg.products).find((p) => p.id === body.product) : undefined;
      return ok({ run: startRun(cfg, { lane, format: (body.format as string) || undefined, product, request, agent }) });
    } catch (e) {
      return err(500, (e as Error).message);
    }
  }

  const id = parts[1];
  const run = getRun(cfg, id);
  if (!run) return err(404, 'No such run.');

  if (parts.length === 2 && method === 'GET') return ok({ run, log: runLog(cfg, id, 6000), files: runFiles(cfg, id), stamps: runFileTimes(cfg, id) });
  if (parts.length === 2 && method === 'DELETE') return ok({ run: cancelRun(cfg, id) });

  if (parts[2] === 'revise' && method === 'POST') {
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 4000) : '';
    if (!comment) return err(400, 'Write what should change.');
    const lane = loadLanes(cfg.lanes).find((l) => l.id === run.lane) || (run.target || run.ad ? { id: run.lane, name: run.lane, platform: 'other' as const, formats: [] } : undefined);
    if (!lane) return err(400, `Lane '${run.lane}' is no longer configured.`);
    const product = run.product ? loadProducts(cfg.products).find((p) => p.id === run.product) : undefined;
    const item = run.target ? loadQueue(cfg.queue, run.target.day).find((i) => i.id === run.target!.id) : undefined;
    const ad = run.ad ? loadAds(cfg.ads).find((c) => c.id === run.ad!.id) : undefined;
    if (run.ad && !ad) return err(400, 'That creative is no longer in the ad media store.');
    const agent = typeof body.agent === 'string' ? body.agent : run.agent;
    return ok({ run: startRun(cfg, { lane, format: run.format, product, request: run.request, agent, parent: run, comment, action: run.action === 'preview' ? undefined : run.action, item, ad }) });
  }

  if ((parts[2] === 'replace' || parts[2] === 'undo') && method === 'POST') {
    try {
      const next: Run = parts[2] === 'replace'
        ? (run.ad ? replaceAdWithRun(cfg, id) : replaceWithRun(cfg, id))
        : (run.ad ? undoAdReplace(cfg, id) : undoReplace(cfg, id));
      return ok({ run: next }, { changed: run.ad ? { ad: run.ad.id } : run.target ? { day: run.target.day, id: run.target.id } : undefined });
    } catch (e) {
      return err(409, (e as Error).message);
    }
  }

  return err(405, 'Not here.');
}

/* ------------------------------------------------------------------ sync rows */

/* The account copy of a queued post or a creative, the same shape scripts/push-day.mjs sends, so
 * a Replace made from aircheck.dev shows there at once. */
const safeId = (s: string) => String(s).replace(/[^a-z0-9._-]/gi, '-').slice(0, 120);
type Ref = { path: string; src?: string; alt?: string } | string;
const ref = (m: Ref) => (typeof m === 'string' ? m : m.alt ? { [m.src === 'url' ? 'url' : 'path']: m.path, alt: m.alt } : m.path);
const small = (meta: unknown) => (meta && JSON.stringify(meta).length < 4000 ? meta : undefined);
const POST = new Set(['queued', 'sent', 'held', 'failed']);

export function postRow(it: QueueItem, day: string) {
  return {
    id: safeId(String(it.id).replace(/^\d{4}-\d{2}-\d{2}:/, '').replace(/\.json$/, '')), day, origin: it.origin?.path,
    manifest: {
      lane: it.lane, at: it.at, kind: it.kind, title: it.title, text: it.text,
      media: ((it.media || []) as Ref[]).map(ref), status: POST.has(it.status) ? it.status : 'queued',
      postUrl: it.postUrl ?? null, url: it.url, meta: small(it.meta),
      ...(it.email ? { email: { subject: it.email.subject, from: it.email.from, to: it.email.to, replyTo: it.email.replyTo, preheader: it.email.preheader, text: it.email.text, html: it.email.html ? (it.email.html.src === 'url' ? { url: it.email.html.path } : it.email.html.path) : undefined } } : {}),
    },
  };
}

export function adRow(c: AdCreative, day: string) {
  return {
    id: safeId(`ad-${c.id}`), day, origin: c.origin?.path,
    manifest: {
      lane: c.lane || c.format, at: c.createdAt, kind: c.kind, title: c.title, text: c.text,
      media: ((c.media || []) as Ref[]).map(ref), status: c.status,
      ad: { product: c.product, format: c.format, run: c.run, approved: !!c.approved, recipe: c.recipe },
      meta: small(c.meta),
    },
  };
}

/** Every post and ad creative this machine's sources hold for a day, as account rows. This is what
 *  `aircheck-mcp push` sends, for jobs that write their own plans instead of calling queue_post. */
export function dayRows(day?: string) {
  const cfg = loadConfig();
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today(cfg.timezone);
  return { day: d, rows: [...loadQueue(cfg.queue, d).map((i) => postRow(i, d)), ...loadAds(cfg.ads).map((c) => adRow(c, d))] };
}

/** The rows to re-sync after a call changed something on disk, or none. */
export function changedRows(changed: ApiResult['changed'], today: string) {
  if (!changed) return [];
  const cfg = loadConfig();
  if ('ad' in changed) {
    const c = loadAds(cfg.ads).find((x) => x.id === changed.ad);
    return c ? [adRow(c, today)] : [];
  }
  const it = loadQueue(cfg.queue, changed.day).find((x) => x.id === changed.id);
  return it ? [postRow(it, changed.day)] : [];
}
