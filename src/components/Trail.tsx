'use client';

import type { QueueItem, Review, Run } from '@/server/types';
import { ago, clock } from '@/lib/ui';
import { agentName } from './Actions';

/* THE ACTIVITY TRAIL of one post (review 2026-11-16, item 38, after Later's approval bubbles and
 * Langfuse's inline comments): what you asked, the run it started on your machine, what the agent
 * changed, and whether the revision was used, oldest first. It answers "what did the agent change
 * while I was not looking" without opening Runs. */
type Ev = { at: string; who: string; me?: boolean; tone?: 'ok' | 'wn'; text: React.ReactNode; extra?: string };

const KIND: Record<string, string> = { preview: 'Preview', example: 'Example', feedback: 'Revised', repair: 'Repair' };

export function trailOf(runs: Run[], review: Review | undefined, item: QueueItem, tz: string, clockAt?: number): Ev[] {
  const ev: Ev[] = [];
  for (const r of [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const asked = r.comment || r.request;
    const agent = agentName(r.agent);
    if (asked) ev.push({ at: r.createdAt, who: 'You', me: true, text: <>“{asked}”</> });
    ev.push({ at: r.createdAt, who: agent, text: `${KIND[r.action || 'preview'] || 'A'} run started on this machine` });
    if (r.status === 'running') ev.push({ at: r.createdAt, who: agent, text: `Working, ${ago(r.createdAt, clockAt ?? Date.now())} so far` });
    else if (r.status === 'done' && r.finishedAt) ev.push({ at: r.finishedAt, who: agent, text: r.output?.notes || 'Made a new version beside the queued one.', extra: `took ${ago(r.createdAt, Date.parse(r.finishedAt))}` });
    else if (r.status === 'failed') ev.push({ at: r.finishedAt || r.createdAt, who: agent, tone: 'wn', text: r.error || 'The run finished without a post.' });
    else if (r.status === 'cancelled') ev.push({ at: r.finishedAt || r.createdAt, who: 'You', me: true, text: 'Stopped the run.' });
    if (r.replaced) ev.push({ at: r.replaced.at, who: 'You', me: true, tone: 'ok', text: `Used the revision.${item.at ? ` Queued for ${clock(item.at, tz)}.` : ''}` });
  }
  if (review) ev.push({ at: review.at, who: 'You', me: true, tone: review.state === 'approved' ? 'ok' : undefined, text: review.state === 'approved' ? 'Approved this post.' : review.state === 'held' ? <>Held this post.{review.note ? <> “{review.note}”</> : null}</> : <>Asked for changes: “{review.note}”</> });
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

export function Trail({ runs, review, item, tz, clockAt }: { runs: Run[]; review?: Review; item: QueueItem; tz: string; clockAt?: number }) {
  const ev = trailOf(runs, review, item, tz, clockAt);
  if (!ev.length) return null;
  const last = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const waiting = last && last.status === 'done' && last.action === 'repair' && !last.replaced;
  return (
    <section className="ac-trail" aria-label="Activity">
      <h3>Activity</h3>
      <ol>
        {ev.map((e, k) => (
          <li key={k} className={e.tone}>
            <span className={`ac-trail-who${e.me ? ' me' : ''}`}>{e.who}</span>
            <span className="ac-trail-t">{e.text}</span>
            <small className="mono">{clock(e.at, tz)}{e.extra ? ` · ${e.extra}` : ''}</small>
          </li>
        ))}
        {waiting ? <li className="wait"><span className="ac-trail-who me">You</span><span className="ac-trail-t">Use the revision or discard it. The queued post is unchanged until you do.</span><small className="mono">now</small></li> : null}
      </ol>
    </section>
  );
}
