'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lane, MediaRef, QueueItem, Review, ReviewState, Run } from '@/server/types';
import { isClean, quickChecks, RULES, useChecks, type Check } from '@/lib/preflight';
import { Gate, PostPreview, type Decide } from './Review';
import { clock, hourOf, kindLabel, longDay, mediaUrl, platform, shortLane } from '@/lib/ui';
import { Rail } from './Rail';
import { LaneTile } from './LaneTile';
import { MachineButton } from './MachineButton';
import { Car, type CarHandle } from './Car';
import { Actions, RunHistory, useItemRuns } from './Actions';
import { EmailPreview, EmailThumb } from './EmailPreview';
import { machineFetch } from '@/lib/machine';
import { Trail } from './Trail';
import { ArmChip } from './AdsBoard';

type ArmMeta = { state: 'armed' | 'ended' | 'paused'; at: string; until?: string; budgetUsd?: number; campaign?: string; receipt: string };
const armOfAd = (a: { meta?: Record<string, unknown> }) => a.meta?.arm as ArmMeta | undefined;

/* Where a creative sits on its review ladder, in the one place that draws it. */
const LADDER_LABEL: Record<string, string> = { draft: 'Draft', review: 'In review', approved: 'Approved', live: 'Live', archived: 'Archived' };

/* TODAY, the redesign's four panes (2026-11-15 redesign, App · Today, after the social
 * inbox in dashboards #13): status filters and lanes, the day's posts with their media, the post
 * opened part by part with the broken part flagged and the revised run inline, and the details
 * pane with the status ladder and the manifest.
 *
 * ONE REVIEW VIEW. Posts, emails and one ad platform's creative are the same job — look at the
 * media, fix it before it goes out — so they share this. `ads` turns off what only a scheduled
 * post has (send times, day paging); `email` draws the message instead of media. */

type Bucket = 'fix' | 'review' | 'queued' | 'held' | 'sent' | 'approved' | 'archived';
const BUCKET: Record<Bucket, { label: string; icon: string }> = {
  fix: { label: 'Needs a fix', icon: 'ph-wrench' },
  review: { label: 'Needs your OK', icon: 'ph-hand-palm' },
  queued: { label: 'Queued', icon: 'ph-clock' },
  held: { label: 'Held', icon: 'ph-pause' },
  sent: { label: 'Sent', icon: 'ph-check-circle' },
  approved: { label: 'Approved', icon: 'ph-seal-check' },
  archived: { label: 'Archived', icon: 'ph-archive' },
};

/** The first thing wrong with a post that a person should fix before it goes out, or null. */
function fixOf(i: QueueItem, p: string, review?: Review): { label: string; fix?: string } | null {
  if (i.ad) return i.ad.missing?.length ? { label: `${i.ad.missing.length} ${i.ad.missing.length === 1 ? 'file is' : 'files are'} missing`, fix: `Rebuild the ${i.ad.missing.length} missing files` } : null;
  if (i.status === 'sent' || i.day === 'templates') return null;
  if (i.status === 'failed') return { label: (i.meta?.problems as string[] | undefined)?.[0] || 'The manifest did not validate' };
  if (review?.state === 'changes') return { label: review.note ? `Changes asked: “${review.note}”` : 'Changes asked' };
  const bad = quickChecks(i, p).find((c) => !c.ok);
  return bad ? { label: bad.label, fix: bad.fix } : null;
}

/* A title a machine made ("top5:2026-11-13-agent-orchestration-recut"): a colon, an ISO date or a
 * run of hyphenated words with no space. The caption's first line reads better, and the slug moves to
 * the meta line in mono (review 2026-11-16, item 17). */
const SLUG = /^(?=\S*(?::|\d{4}-\d{2}-\d{2}|\w+-\w+-\w+))\S+$/;
export function titleParts(i: QueueItem): { title: string; slug?: string } {
  const first = (i.text || '').split('\n').map((s) => s.trim()).find(Boolean);
  const t = i.email?.subject || i.title || '';
  if (t && SLUG.test(t) && first) return { title: first, slug: t };
  return { title: t || first || kindLabel(i.kind) };
}

/** Who built a post, from what the manifest says: its owner job or agent, and where it was read. */
export function draftedBy(i: QueueItem): string {
  const m = i.meta || {};
  const who = [m.agent, m.by, m.owner].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const from = i.source === 'day-plan' ? 'day plan' : i.source === 'folder' ? 'queue folder' : i.source === 'account' ? 'synced' : '';
  return [who, from].filter(Boolean).join(' · ');
}

const minsTo = (iso: string | undefined, now: number | null) => (iso && now !== null ? Math.round((Date.parse(iso) - now) / 60000) : null);
export const airsIn = (m: number) => (m <= 0 ? 'Airs now' : m < 60 ? `Airs in ${m} min` : `Airs in ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());

export function TodayView({ items, lanes, tz, day, today, days, agents, defaultAgent, initialQ, ads, email, templates = [], initialLane, initialSel, clockAt, demo, demoRuns }: {
  items: QueueItem[]; lanes: Lane[]; tz: string; day: string; today: string; days: string[]; readAt?: string;
  agents: string[]; defaultAgent: string; initialQ?: string; ads?: boolean; initialLane?: string;
  /** Emails instead of posts: the same day, sending times and actions, with the message drawn. */
  email?: boolean;
  /** Email only: every template the products send, shown under the day's sends. */
  templates?: QueueItem[];
  /** Today's count in Social, Ads and Email. */
  scopeCounts?: { social?: number; ads?: number; email?: number };
  /** The post the view opens on. Defaults to the first that needs a person. */
  initialSel?: string;
  /** A fixed clock (ms since epoch) instead of the live one, for the sample day on /demo. */
  clockAt?: number;
  /** The sample day on /demo: actions open their panes but a run asks you to sign in. */
  demo?: boolean;
  /** The sample day's runs, by post id. */
  demoRuns?: Record<string, Run[]>;
}) {
  const noun = ads ? 'creative' : email ? 'email' : 'post';
  const nouns = ads ? 'creatives' : email ? 'emails' : 'posts';
  const byId = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const laneOf = (id: string): Lane => byId.get(id) || { id, name: id, platform: 'other', formats: [] };
  const [lane, setLane] = useState<string | null>(initialLane || null);
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [q, setQ] = useState(initialQ || '');
  const [now, setNow] = useState<number | null>(clockAt ?? null);
  const [open, setOpen] = useState(!!initialSel && !demo);
  const car = useRef<CarHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  /* Decisions made on this page, ahead of the server's copy: an id maps to its new decision, or
   * null once cleared. */
  const [decided, setDecided] = useState<Record<string, Review | null>>({});
  const reviewOf = (i: QueueItem): Review | undefined => (i.id in decided ? decided[i.id] || undefined : i.review);
  const reviewable = (i: QueueItem) => !ads && i.day !== 'templates' && i.status === 'queued';
  const pending = (i: QueueItem) => reviewable(i) && !reviewOf(i);
  const bucketOf = (i: QueueItem): Bucket => {
    const l = laneOf(i.lane);
    if (ads) return i.ad!.missing?.length ? 'fix' : i.ad!.status === 'archived' ? 'archived' : i.ad!.approved || i.ad!.status === 'approved' || i.ad!.status === 'live' ? 'approved' : 'review';
    if (i.status === 'sent') return 'sent';
    if (fixOf(i, l.platform, reviewOf(i))) return 'fix';
    if (i.status === 'held' || reviewOf(i)?.state === 'held') return 'held';
    if (pending(i)) return 'review';
    return 'queued';
  };
  const decide: Decide = async (ids, state, note) => {
    const before = Object.fromEntries(ids.map((id) => [id, id in decided ? decided[id] : undefined]));
    const at = state ? { state, at: new Date().toISOString(), ...(note ? { note } : {}) } : null;
    setDecided((d) => ({ ...d, ...Object.fromEntries(ids.map((id) => [id, at])) }));
    /* The sample day has no account behind it: the decision lives on this page only. */
    if (demo) return null;
    const day0 = items.find((i) => i.id === ids[0])?.day || day;
    const r = await fetch('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day: day0, ids, state, note }) })
      .then(async (x) => (x.ok ? null : ((await x.json().catch(() => ({}))) as { error?: string }).error || `Could not save (${x.status}).`))
      .catch(() => 'Could not reach Aircheck.');
    if (r) setDecided((d) => { const n = { ...d }; for (const [id, v] of Object.entries(before)) { if (v === undefined) delete n[id]; else n[id] = v; } return n; });
    return r;
  };
  useEffect(() => {
    if (clockAt !== undefined) return;
    const t0 = setTimeout(() => setNow(Date.now()), 0); const t = setInterval(() => setNow(Date.now()), 30000); return () => { clearTimeout(t0); clearInterval(t); };
  }, [clockAt]);
  /* When every lane is one account ("Harbor Coffee · Instagram", "Harbor Coffee · X"...), the
   * account says nothing on a row, so only the part after it is shown there. */
  const account = lanes.length > 1 ? `${lanes[0].name.split(' · ')[0]} · ` : '';
  const oneAccount = !!account && lanes.every((l) => l.name.startsWith(account) && l.name.length > account.length);
  const short = (n: string) => (oneAccount && n.startsWith(account) ? n.slice(account.length) : shortLane(n));

  const counts: Record<string, number> = {};
  for (const i of items) counts[i.lane] = (counts[i.lane] || 0) + 1;
  const laneIds = lanes.filter((l) => counts[l.id]).map((l) => l.id).concat([...new Set(items.map((i) => i.lane))].filter((id) => !byId.has(id)));
  const needle = q.trim().toLowerCase();
  const matches = (i: QueueItem) => !needle || `${laneOf(i.lane).name} ${i.title || ''} ${i.text || ''} ${i.kind} ${i.email?.subject || ''}`.toLowerCase().includes(needle);
  const inLane = items.filter((i) => (!lane || i.lane === lane) && matches(i));
  const shown = inLane.filter((i) => !bucket || bucketOf(i) === bucket);
  const tshown = templates.filter((i) => (!lane || i.lane === lane) && matches(i) && !bucket);
  const isToday = day === today;
  const at = (i: QueueItem) => (i.at ? Date.parse(i.at) : Infinity);
  const byTime = (a: QueueItem, b: QueueItem) => at(a) - at(b);

  /* The list's order is the order of attention: what is broken, what waits on you, then the rest
   * of the day by send time, then what already went. */
  const ORDER: Bucket[] = ads ? ['fix', 'review', 'approved', 'archived'] : ['fix', 'review', 'queued', 'held', 'sent'];
  const groups = ORDER.map((b) => ({ b, list: shown.filter((i) => bucketOf(i) === b).sort(byTime) })).filter((g) => g.list.length);
  const flat = groups.flatMap((g) => g.list).concat(tshown);
  const [sel, setSel] = useState<string | null>(() => initialSel || null);
  const cur = flat.find((i) => i.id === sel) || flat[0];
  const pick = (id: string) => { setSel(id); setOpen(true); };

  /* APPROVE AND NEXT (review item 28): after a decision on the opened post, the selection moves on to
   * the next post that still waits on a person, the way an annotation queue's "Complete + next" does. */
  const nextPending = (fromId: string) => {
    const n = flat.findIndex((i) => i.id === fromId);
    const rest = [...flat.slice(n + 1), ...flat.slice(0, Math.max(0, n))];
    return rest.find((i) => i.id !== fromId && (pending(i) || bucketOf(i) === 'fix') && i.status !== 'sent');
  };
  const decideNext: Decide = async (ids, state, note) => {
    const r = await decide(ids, state, note);
    if (!r && state && ids.length === 1 && (state === 'approved' || state === 'held')) { const nx = nextPending(ids[0]); if (nx) setSel(nx.id); }
    return r;
  };

  /* ↑/↓ (and j/k) move, a approves, h holds, ←/→ page the slides, / searches, Esc closes on a phone. */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus(); return; }
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      const n = flat.findIndex((i) => i.id === cur?.id);
      if ((e.key === 'j' || e.key === 'ArrowDown') && n < flat.length - 1) setSel(flat[n + 1].id);
      else if ((e.key === 'k' || e.key === 'ArrowUp') && n > 0) setSel(flat[n - 1].id);
      else if ((e.key === 'a' || e.key === 'h') && !e.metaKey && !e.ctrlKey && cur && reviewable(cur)) {
        const want: ReviewState = e.key === 'a' ? 'approved' : 'held';
        if (reviewOf(cur)?.state === want) decide([cur.id], null); else decideNext([cur.id], want);
      }
      else if (e.key === 'ArrowRight') car.current?.step(1);
      else if (e.key === 'ArrowLeft') car.current?.step(-1);
      else if (e.key === '/') search.current?.focus();
      else if (e.key === 'Escape' && open) setOpen(false);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  /* Keep the selected row in view as the keys move it. */
  /* Scrolls only the list, never the page around it: inside the landing's window, scrollIntoView
   * would scroll the landing too (review item 20's 122px jump). */
  useEffect(() => {
    const r = document.querySelector('.ac-row.sel') as HTMLElement | null;
    const box = r?.closest('.ac-list-b') as HTMLElement | null;
    if (!r || !box) return;
    const a = r.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (a.top < b.top + 30) box.scrollTop -= b.top + 30 - a.top;
    else if (a.bottom > b.bottom) box.scrollTop += a.bottom - b.bottom;
  }, [cur?.id]);

  const goDay = (d?: string) => { if (d) { const p = window.location.pathname; window.location.href = d === today ? p : `${p}?day=${d}`; } };
  const allDays = [...new Set([today, ...days])].sort().reverse();
  const di = allDays.indexOf(day);
  const nb = (b: Bucket) => inLane.filter((i) => bucketOf(i) === b).length;
  const sentN = inLane.filter((i) => i.status === 'sent').length;
  /* The one live thing on the page: the next post to air, today only. */
  const nextUp = isToday ? inLane.filter((i) => i.status === 'queued' && i.at && now !== null && Date.parse(i.at) > now && bucketOf(i) !== 'held').sort(byTime)[0] : undefined;
  const nextMin = nextUp ? minsTo(nextUp.at, now) : null;
  const fixN = nb('fix');
  const pageTitle = ads ? 'Ads' : email ? 'Email' : isToday ? 'Today' : 'Day';
  useEffect(() => {
    const where = lane ? laneOf(lane).name : pageTitle;
    document.title = `${where}${fixN ? ` (${fixN} to fix)` : ''} · Aircheck`;
  });

  /* The send-time strip: whole hours around the day's sends, a tick per post, and now. */
  const timed = ads ? [] : inLane.filter((i) => i.at);
  const hours = timed.map((i) => hourOf(i.at!, tz));
  const lo = Math.floor(Math.min(...hours, 9));
  const hi = Math.max(lo + 2, Math.ceil(Math.max(...hours, lo + 1) + 0.25));
  const pct = (h: number) => `${((h - lo) / (hi - lo)) * 100}%`;
  const nowH = now !== null && isToday ? hourOf(new Date(now).toISOString(), tz) : null;
  const hourName = (h: number) => (h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`);
  const step = Math.max(1, Math.ceil((hi - lo) / 6));
  /* Posts that share a minute share one dot, with their count; the dot takes the most urgent state. */
  const RANK: Bucket[] = ['fix', 'review', 'queued', 'held', 'sent'];
  const clusters = (() => {
    const by = new Map<string, QueueItem[]>();
    for (const x of [...timed].sort(byTime)) { const k = clock(x.at, tz); by.set(k, [...(by.get(k) || []), x]); }
    return [...by.entries()].map(([key, list]) => ({ key, list, h: hourOf(list[0].at!, tz), b: RANK.find((r) => list.some((x) => bucketOf(x) === r)) || 'queued' }));
  })();

  const status = (x: QueueItem) => {
    const b = bucketOf(x);
    if (ads) return <span className={`ac-chip ${b === 'fix' ? 'bad' : b === 'approved' ? 'ok' : b === 'archived' ? '' : 'warn'}`}>{b === 'fix' ? 'Files missing' : LADDER_LABEL[x.ad!.status]}</span>;
    if (x.day === 'templates') return <span className="ac-chip">Template</span>;
    if (b === 'fix') return <span className="ac-chip bad">Fix</span>;
    if (x.id === nextUp?.id && nextMin !== null) return <span className="ac-chip air">On air next</span>;
    if (b === 'sent') return <span className="ac-chip ok">Sent</span>;
    if (b === 'held') return <span className="ac-chip">Held</span>;
    if (b === 'review') return <span className="ac-chip warn">Review</span>;
    if (reviewOf(x)?.state === 'approved') return <span className="ac-chip ok-soft">Approved</span>;
    return <span className="ac-chip">Queued</span>;
  };

  const row = (x: QueueItem) => {
    const l = laneOf(x.lane);
    const img = x.media.find((m) => m.kind === 'image');
    const vid = !img ? x.media.find((m) => m.kind === 'video') : undefined;
    const n = x.media.filter((m) => m.kind === 'image' || m.kind === 'video').length;
    const { title, slug } = titleParts(x);
    const by = ads || email ? '' : draftedBy(x);
    return (
      <li key={x.id}>
        <button type="button" className={`ac-row${x.id === cur?.id ? ' sel' : ''}${x.id === nextUp?.id ? ' next' : ''}`} aria-current={x.id === cur?.id ? 'true' : undefined} onClick={() => pick(x.id)}>
          <span className="ac-th">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img ? <img src={mediaUrl(img)} alt="" loading="lazy" />
              // eslint-disable-next-line @next/next/no-img-element
              : vid && typeof x.ad?.meta?.poster === 'string' ? <img src={mediaUrl(x.ad.meta.poster as string)} alt="" loading="lazy" />
              : vid ? <video src={`${mediaUrl(vid)}#t=1`} muted preload="metadata" playsInline />
              : x.email?.html ? <EmailThumb email={x.email} />
              : <span className={`ac-th-t${x.missing?.length ? ' miss' : ''}`}><i className={`ph ${x.missing?.length ? 'ph-image-broken' : x.kind === 'video' ? 'ph-film-strip' : x.email ? 'ph-envelope-simple' : 'ph-text-aa'}`}></i></span>}
            {n > 1 ? <span className="ac-th-n num">{n}</span> : null}
            {x.email ? null : <span className="ac-th-b"><LaneTile l={l} /></span>}
          </span>
          <span className="ac-row-t">
            <b>{title}</b>
            <small>{ads ? x.ad!.format : x.day === 'templates' ? l.name : <>{short(l.name)} · <span className="mono">{x.at ? clock(x.at, tz) : 'Unscheduled'}</span>{slug ? <> · <span className="mono">{slug}</span></> : null}{by && !slug ? <span className="ac-by">{by}</span> : null}</>}</small>
          </span>
          {status(x)}
        </button>
      </li>
    );
  };

  const filterBtn = (b: Bucket | null, label: string, icon: string, n: number) => (
    <button type="button" key={label} className={`ac-f${bucket === b ? ' on' : ''}`} aria-pressed={bucket === b} onClick={() => setBucket(bucket === b || b === null ? null : b)}>
      <i className={`ph ${icon}`} aria-hidden></i><span className="ac-f-l">{label}</span>
      <span className={`ac-f-n num${b === 'fix' && n ? ' bad' : b === 'review' && n ? ' warn' : ''}`}>{n}</span>
    </button>
  );
  const filters = [
    filterBtn(null, ads ? 'All creative' : email ? 'All email' : 'All posts', ads ? 'ph-megaphone' : email ? 'ph-envelope-simple' : 'ph-tray', inLane.length),
    ...ORDER.map((b) => filterBtn(b, b === 'review' && ads ? 'Needs review' : BUCKET[b].label, BUCKET[b].icon, nb(b))),
  ];
  const place = ads ? 'ads' : email ? 'email' : 'today';
  const title = pageTitle;

  return (
    <div className={`ac-shell ac-today${open ? ' open' : ''}`}>
      <Rail place={place} badges={!ads && !email ? { today: nb('fix') + nb('review') || undefined } : undefined} />

      <aside className="ac-filters" aria-label="Filters">
        <div className="ac-day">
          <h1>{title}</h1>
          {ads ? <p>{items.length ? `${items.length} ${items.length === 1 ? 'creative' : 'creatives'}` : 'No creative yet'}</p> : (
            <div className="ac-day-p">
              <button type="button" className="ac-ib" aria-label="Earlier day" disabled={di >= allDays.length - 1} onClick={() => goDay(allDays[di + 1])}><i className="ph ph-caret-left"></i></button>
              <span>{longDay(day).replace(/^(\w+), /, '$1 · ')}</span>
              <button type="button" className="ac-ib" aria-label="Later day" disabled={di <= 0} onClick={() => goDay(allDays[di - 1])}><i className="ph ph-caret-right"></i></button>
            </div>
          )}
        </div>
        <nav className="ac-fl" aria-label="Status">{filters}</nav>
        {laneIds.length ? <>
          <h2 className="ac-sect">{oneAccount ? account.replace(/ · $/, '') : ads ? 'Platforms' : email ? 'Senders' : 'Lanes'}</h2>
          <nav className="ac-fl ac-lanes" aria-label={ads ? 'Platforms' : 'Lanes'}>
            {laneIds.map((id) => {
              const l = laneOf(id);
              return (
                <button type="button" key={id} className={`ac-f${lane === id ? ' on' : ''}`} aria-pressed={lane === id} title={l.name} onClick={() => setLane(lane === id ? null : id)}>
                  <LaneTile l={l} /><span className="ac-f-l">{oneAccount ? platform(l.platform).label : short(l.name)}</span><span className="ac-f-n num">{counts[id]}</span>
                </button>
              );
            })}
          </nav>
        </> : null}
        <div className="ac-filters-foot">
          <MachineButton />
          <p className="ac-keys"><kbd>↑</kbd><kbd>↓</kbd> move{!ads ? <> · <kbd>A</kbd> approve · <kbd>H</kbd> hold</> : null} · <kbd>⌘K</kbd> search</p>
        </div>
      </aside>

      <section className="ac-list" aria-label={`${title}'s ${nouns}`}>
        <div className="ac-list-h">
          <div className="ac-list-top">
            <h1>{lane ? short(laneOf(lane).name) : title}</h1>
            {ads ? null : (
              <div className="ac-day-p">
                <button type="button" className="ac-ib" aria-label="Earlier day" disabled={di >= allDays.length - 1} onClick={() => goDay(allDays[di + 1])}><i className="ph ph-caret-left"></i></button>
                <span>{longDay(day).replace(/^(\w+), (\w+) (\d+)$/, (_, w, m, d) => `${w.slice(0, 3)} ${d} ${m.slice(0, 3)}`)}</span>
                <button type="button" className="ac-ib" aria-label="Later day" disabled={di <= 0} onClick={() => goDay(allDays[di - 1])}><i className="ph ph-caret-right"></i></button>
              </div>
            )}
            {laneIds.length > 1 ? (
              <label className="ac-pill">{ads ? 'Platform' : email ? 'Sender' : 'Lane'} is <b>{lane ? short(laneOf(lane).name) : 'any'}</b><i className="ph ph-caret-down" aria-hidden></i>
                <select value={lane || ''} onChange={(e) => setLane(e.target.value || null)} aria-label={ads ? 'Platform' : email ? 'Sender' : 'Lane'}>
                  <option value="">any</option>
                  {laneIds.map((id) => <option key={id} value={id}>{laneOf(id).name}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {lane && initialLane === lane ? (
            <div className="ac-lanehead">
              <LaneTile l={laneOf(lane)} size="lg" />
              <span><b>{laneOf(lane).name}</b><small>{laneOf(lane).handle || platform(laneOf(lane).platform).label}{laneOf(lane).brief ? ` · ${laneOf(lane).brief}` : ''}</small></span>
              <a className="ac-btn" href={ads ? '/ads' : email ? '/email' : '/'}><i className="ph ph-arrow-counter-clockwise"></i>Show everything</a>
            </div>
          ) : null}
          <label className="ac-search">
            <i className="ph ph-magnifying-glass" aria-hidden></i>
            <input ref={search} value={q} placeholder={`Search ${nouns}`} aria-label={`Search ${nouns}`} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} />
            {q ? <button type="button" className="ac-ib" aria-label="Clear the search" onClick={() => setQ('')}><i className="ph ph-x"></i></button> : <kbd>⌘K</kbd>}
          </label>
          <div className="ac-chips" role="group" aria-label="Status">{filters}</div>
          {timed.length ? (
            <div className="ac-rundown" aria-label="Rundown">
              <div className="ac-rd-t" aria-hidden>{Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, k) => <span key={k} style={{ left: pct(lo + k * step) }}>{hourName(lo + k * step)}</span>)}</div>
              <div className="ac-rd-r">
                {nowH !== null && nowH >= lo && nowH <= hi ? <span className="ac-rd-now" style={{ left: pct(nowH) }} aria-hidden></span> : null}
                {clusters.map((c) => {
                  const isNext = !!nextUp && c.list.some((x) => x.id === nextUp.id);
                  const on = c.list.some((x) => x.id === cur?.id);
                  const label = `${clock(c.list[0].at, tz)} · ${c.list.map((x) => `${short(laneOf(x.lane).name)}: ${titleParts(x).title}`).join(', ')}`;
                  return (
                    <button key={c.key} type="button" className={`ac-rd-i ${c.b}${on ? ' cur' : ''}${isNext ? ' next' : ''}`} style={{ left: pct(c.h) }} title={label} aria-label={label}
                      onClick={() => pick((on ? c.list[(c.list.findIndex((x) => x.id === cur?.id) + 1) % c.list.length] : c.list[0]).id)}>
                      {isNext ? <span className="mono">{clock(nextUp!.at, tz)} {platform(laneOf(nextUp!.lane).platform).label}</span> : c.list.length > 1 ? <span className="num">{c.list.length}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {!ads && items.length ? (
            <p className="ac-summ">
              <span><b className="num">{sentN}</b> of <span className="num">{inLane.length}</span> sent{lane ? <> on {laneOf(lane).name}</> : null}.</span>
              {nextUp && nextMin !== null ? <span className="ac-chip air"><span className="ac-dot" aria-hidden></span>{airsIn(nextMin)}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="ac-list-b">
          {groups.map((g) => {
            const clean = g.b === 'review' ? g.list.filter((x) => pending(x) && isClean(x, laneOf(x.lane).platform)) : [];
            return (
              <div key={g.b} className="ac-grp">
                <h3>{g.b === 'queued' && isToday ? 'Next up' : g.b === 'sent' && isToday ? 'Sent today' : g.b === 'review' && ads ? 'Needs review' : BUCKET[g.b].label}<span className="num">{g.list.length}</span>
                  {clean.length > 1 ? <button type="button" className="ac-link" onClick={() => decide(clean.map((x) => x.id), 'approved')}><i className="ph ph-checks"></i>Approve {clean.length} clean</button> : null}
                  {g.b === 'fix' && !ads ? <BulkFix list={g.list.filter((x) => reviewable(x))} platformOf={(x) => laneOf(x.lane).platform} decide={decide} agent={defaultAgent} demo={demo} /> : null}
                </h3>
                <ul>{g.list.map(row)}</ul>
              </div>
            );
          })}
          {email && tshown.length ? (
            <div className="ac-grp">
              <h3>Templates<span className="num">{tshown.length}</span></h3>
              <ul>{tshown.map(row)}</ul>
            </div>
          ) : null}
          {!flat.length ? (
            /* An empty list says WHY it is empty and offers the way out of it. */
            <div className="ac-empty">
              <span className="ac-empty-i"><i className={`ph ${needle ? 'ph-magnifying-glass' : lane || bucket ? 'ph-funnel-simple' : ads ? 'ph-megaphone' : email ? 'ph-envelope-simple' : 'ph-calendar-check'}`}></i></span>
              <b>{needle ? `Nothing matches “${q}”`
                : bucket ? `Nothing ${bucket === 'fix' ? 'needs a fix' : bucket === 'review' ? 'is waiting on you' : `is ${BUCKET[bucket].label.toLowerCase()}`}`
                : lane ? `Nothing on ${laneOf(lane).name}`
                : ads ? 'No ad creative yet'
                : email ? `No email queued for ${longDay(day)}`
                : `Nothing queued for ${longDay(day)}`}</b>
              <p>{needle ? `No ${nouns} here have that in their copy, lane or format.`
                : bucket || lane ? `Every other ${ads ? 'creative' : noun} is still here.`
                : ads ? 'Point the ads source in your config at the folder your renderer writes to, and every creative it builds shows up here.'
                : email ? 'Queue an email the way you queue a post, with an "email" block that names its subject and its rendered HTML.'
                : 'Nothing your jobs queued lands on this day. A post shows up here the moment it is queued.'}</p>
              {needle || lane || bucket ? (
                <button type="button" className="ac-btn" onClick={() => { setQ(''); setLane(null); setBucket(null); }}>
                  <i className="ph ph-arrow-counter-clockwise"></i>Show everything
                </button>
              ) : !ads && !email && di < allDays.length - 1 ? (
                <button type="button" className="ac-btn" onClick={() => goDay(allDays[di + 1])}><i className="ph ph-caret-left"></i>Go to {longDay(allDays[di + 1])}</button>
              ) : <a className="ac-btn" href="/docs#manifest"><i className="ph ph-book-open"></i>How to queue a post</a>}
            </div>
          ) : null}
        </div>
      </section>

      {cur ? (
        <Opened key={cur.id} item={cur} lane={laneOf(cur.lane)} laneName={short(laneOf(cur.lane).name)} tz={tz} carRef={car} agents={agents} defaultAgent={defaultAgent} demo={demo}
          demoRuns={demoRuns?.[cur.id] || (demo ? [] : undefined)} review={reviewOf(cur)} decide={reviewable(cur) ? decideNext : undefined} fix={fixOf(cur, laneOf(cur.lane).platform, reviewOf(cur))}
          bucket={bucketOf(cur)} onBack={() => setOpen(false)} clockAt={clockAt} />
      ) : (
        <section className="ac-open ac-open-empty" aria-label="Opened post">
          <div className="ac-empty"><span className="ac-empty-i"><i className="ph ph-cursor-click"></i></span><b>Pick a {noun}</b><p>It opens here with its media, its checks and a way to fix it.</p></div>
        </section>
      )}
    </div>
  );
}

export function Ring({ p, done, logo }: { p: string; done?: boolean; logo?: string }) {
  const pl = platform(p);
  /* eslint-disable-next-line @next/next/no-img-element */
  return <span className={`av${done ? ' done' : ''}`}><span className={logo ? 'logo' : undefined} style={{ background: logo ? '#fff' : pl.color }}>{logo ? <img src={mediaUrl(logo)} alt="" /> : <i className={`ph-fill ${pl.icon}`}></i>}</span></span>;
}

/* ===== the opened post and its details ===== */

type View = 'parts' | 'preview' | 'media';
function useView(): [View, (v: View) => void] {
  const [view, set] = useState<View>('parts');
  useEffect(() => {
    const t = setTimeout(() => { try { const v = localStorage.getItem('aircheck.view2') as View | null; if (v === 'parts' || v === 'preview' || v === 'media') set(v); } catch { /* blocked */ } }, 0);
    return () => clearTimeout(t);
  }, []);
  return [view, (v: View) => { set(v); try { localStorage.setItem('aircheck.view2', v); } catch { /* blocked */ } }];
}

function Opened({ item, lane, laneName, tz, carRef, agents, defaultAgent, demo, demoRuns, review, decide, fix, bucket, onBack, clockAt }: {
  item: QueueItem; lane: Lane; laneName: string; tz: string; carRef: React.Ref<CarHandle>; agents: string[]; defaultAgent: string; demo?: boolean; demoRuns?: Run[];
  review?: Review; decide?: Decide; fix: { label: string; fix?: string } | null; bucket: Bucket; onBack: () => void; clockAt?: number;
}) {
  const [view, setView] = useView();
  const ad = item.ad;
  const { runs, load } = useItemRuns(item, ad, demoRuns);
  const [active, setActive] = useState<string | null>(() => (demoRuns?.length ? demoRuns[0].id : null));
  const checks = useChecks(item, lane.platform);
  const vis = item.media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const nParts = (item.text ? 1 : 0) + vis.length + (item.missing?.length || 0);
  const { title, slug } = titleParts(item);
  const chip = bucket === 'fix' ? <span className="ac-chip bad"><span className="ac-dot" aria-hidden></span>Needs a fix</span>
    : bucket === 'sent' ? <span className="ac-chip ok">Sent {item.at ? clock(item.at, tz) : ''}</span>
    : bucket === 'held' ? <span className="ac-chip">Held</span>
    : bucket === 'review' ? <span className="ac-chip warn">{ad ? LADDER_LABEL[ad.status] : `Queued ${item.at ? clock(item.at, tz) : ''}`}</span>
    : bucket === 'approved' ? <span className="ac-chip ok">{ad ? LADDER_LABEL[ad.status] : 'Approved'}</span>
    : <span className="ac-chip">{ad ? LADDER_LABEL[ad.status] : review?.state === 'approved' ? `Approved · ${clock(item.at, tz)}` : `Queued ${item.at ? clock(item.at, tz) : ''}`}</span>;
  return (
    <section className="ac-open" aria-label={`Opened: ${title}`}>
      <div className="ac-post">
        <header className="ac-post-h">
          <button type="button" className="ac-ib ac-back" aria-label="Back to the list" onClick={onBack}><i className="ph ph-arrow-left"></i></button>
          {item.email ? <span className="pi pi-lg" style={{ background: '#18181b' }}><i className="ph-fill ph-envelope-simple"></i></span> : <LaneTile l={lane} size="lg" />}
          <div className="ac-post-t">
            <h2>{title}</h2>
            <p>{[laneName, ad ? ad.format : kindLabel(item.kind), item.email ? item.email.from : !ad && nParts > 1 ? `${nParts} parts` : null].filter(Boolean).join(' · ')}{slug ? <> · <span className="mono">{slug}</span></> : null}</p>
          </div>
          {chip}
        </header>
        {!item.email && !ad ? (
          <div className="ac-view" role="tablist" aria-label="How to show this post">
            {(['parts', 'preview', 'media'] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : undefined} onClick={() => setView(v)}>
                {v === 'parts' ? 'Part by part' : v === 'preview' ? `As on ${platform(lane.platform).label}` : 'Media'}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ac-post-b">
          {fix && bucket === 'fix' ? (
            <div className="ac-flag" role="note">
              <i className="ph-fill ph-warning-circle" aria-hidden></i>
              <span><b>{fix.label}</b>{fix.fix ? <small>Repair can rebuild it through the lane&apos;s own pipeline.</small> : null}</span>
              {fix.fix && item.status !== 'sent' ? <button type="button" className="ac-btn bad" onClick={() => window.dispatchEvent(new CustomEvent('aircheck:fix', { detail: fix.fix }))}><i className="ph-bold ph-wrench"></i>Fix</button> : null}
            </div>
          ) : null}
          {item.email ? <EmailPreview email={item.email} />
            : ad ? <><Car ref={carRef} media={item.media} className="ac-car" />{item.text || item.title ? <p className="ac-cap">{item.text || item.title}</p> : null}</>
            : view === 'preview' ? <PostPreview item={item} lane={lane} tz={tz} />
            : view === 'media' ? <><Car ref={carRef} media={item.media} className="ac-car" empty={item.meta?.mediaRemoved ? 'Posted. The media was removed after it went out' : undefined} /><Where media={item.media} /></>
            : <Parts item={item} lane={lane} checks={checks} />}
          {!ad ? <Trail runs={runs} review={review} item={item} tz={tz} clockAt={clockAt} /> : null}
          <Actions item={item} ad={ad} agents={agents} defaultAgent={defaultAgent} demo={demo} runs={runs} reload={load} active={active} setActive={setActive} clockAt={clockAt} />
        </div>
      </div>
      <Details item={item} lane={lane} tz={tz} review={review} decide={decide} fix={fix} bucket={bucket} checks={checks} runs={runs} active={active} setActive={setActive} clockAt={clockAt} />
    </section>
  );
}

/* THE POST, PART BY PART. The copy, then every slide or clip in order, then every file the plan names
 * that is not on disk. Each part carries the checks that are about it, so the broken one is tinted
 * and says why, with the Fix that opens Repair on exactly that. */
type Flag = { label: string; fix?: string };
function Parts({ item, lane, checks }: { item: QueueItem; lane: Lane; checks: Check[] }) {
  const rule = RULES[lane.platform];
  const vis = item.media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const sent = item.status === 'sent';
  const textFlags: Flag[] = sent ? [] : checks.filter((c) => !c.ok && (c.id === 'chars' || c.id === 'link')).map((c) => ({ label: c.id === 'chars' ? `Too long for ${rule?.name}: ${c.detail}` : c.label, fix: c.fix }));
  const ratio = checks.find((c) => c.id === 'ratio' && !c.ok);
  const thread = Array.isArray(item.meta?.thread) ? (item.meta!.thread as unknown[]).filter((t): t is string => typeof t === 'string') : null;
  const texts = thread?.length ? thread : item.text ? [item.text] : [];
  let n = 0;
  return (
    <ol className="ac-parts">
      {texts.map((t, k) => (
        <li key={`t${k}`} className={`ac-part${textFlags.length && k === 0 ? ' bad' : ''}`}>
          <span className="ac-part-n num">{++n}</span>
          <div className="ac-part-b">
            <p className="ac-part-copy" onMouseUp={(e) => anchorFromSelection(e.currentTarget, k)}>{t}</p>
            {k === 0 ? textFlags.map((f) => <PartFlag key={f.label} f={f} />) : null}
            {k === 0 && rule?.chars ? <small className="ac-part-m num">{[...t].length.toLocaleString('en-US')} / {rule.chars.toLocaleString('en-US')} characters</small> : null}
          </div>
        </li>
      ))}
      {vis.map((m, k) => {
        const flags: Flag[] = [];
        if (!sent && rule?.alt && m.kind === 'image' && !m.alt) flags.push({ label: `Alt text missing on slide ${k + 1}`, fix: 'Write alt text for every image' });
        if (!sent && rule?.files && k >= rule.files) flags.push({ label: `${rule.name} takes ${rule.files} files at most`, fix: `Cut the post to ${rule.files} files for ${rule.name}` });
        if (!sent && ratio && k === vis.findIndex((x) => x.kind === 'image')) flags.push({ label: `${ratio.label}: ${ratio.detail}`, fix: ratio.fix });
        return (
          <li key={m.path + k} className={`ac-part media${flags.length ? ' bad' : ''}`}>
            <span className="ac-part-n num">{++n}</span>
            <div className="ac-part-b">
              <div className="ac-part-m1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.kind === 'video' ? <video src={`${mediaUrl(m)}#t=1`} muted preload="metadata" playsInline /> : <img src={mediaUrl(m)} alt={m.alt || ''} loading="lazy" />}
                <span>
                  <b>{m.kind === 'video' ? 'Clip' : 'Slide'} {k + 1}</b>
                  <small className="mono">{m.path.split('/').pop()}</small>
                  {m.alt ? <small>Alt: {m.alt}</small> : null}
                </span>
                {sent ? null : <button type="button" className="ac-link ac-part-c" onClick={() => anchor({ label: `${m.kind === 'video' ? 'Clip' : 'Slide'} ${k + 1}`, about: `About ${m.kind === 'video' ? 'clip' : 'slide'} ${k + 1} (${m.path.split('/').pop()})` })}><i className="ph ph-chat-circle-text"></i>Comment</button>}
              </div>
              {flags.map((f) => <PartFlag key={f.label} f={f} />)}
            </div>
          </li>
        );
      })}
      {(item.missing || []).map((f) => (
        <li key={`miss-${f}`} className={`ac-part media${sent ? '' : ' bad'}`}>
          <span className="ac-part-n num">{++n}</span>
          <div className="ac-part-b">
            <div className="ac-part-m1"><span className="ac-th-t miss"><i className="ph ph-image-broken"></i></span><span><b>{f.split('/').pop()}</b><small className="mono">{f}</small></span></div>
            {sent ? <small className="ac-part-m">Cleaned up after it was sent.</small> : <PartFlag f={{ label: 'This file is not on disk', fix: `Rebuild the ${item.missing!.length} missing ${item.missing!.length === 1 ? 'file' : 'files'}` }} />}
          </div>
        </li>
      ))}
      {!n ? <li className="ac-part"><span className="ac-part-n">·</span><div className="ac-part-b"><p className="ac-part-copy muted">This post has no copy and no media.</p></div></li> : null}
    </ol>
  );
}
/* COMMENT ON A SPAN (review item 45): select words in the copy, or press Comment on a slide, and the
 * composer below carries that anchor into the run's request, so the revision and the trail say what
 * the comment was about. */
export type Anchor = { label: string; about: string };
const anchor = (a: Anchor) => window.dispatchEvent(new CustomEvent('aircheck:anchor', { detail: a }));
function anchorFromSelection(el: HTMLElement, part: number) {
  const sel = window.getSelection();
  const t = sel && !sel.isCollapsed && el.contains(sel.anchorNode) ? sel.toString().trim() : '';
  if (t.length < 2) return;
  const short = t.length > 60 ? `${t.slice(0, 57)}…` : t;
  anchor({ label: `“${short}”`, about: `About the words “${t.slice(0, 400)}”${part ? ` in part ${part + 1}` : ''}` });
}
function PartFlag({ f }: { f: Flag }) {
  return (
    <div className="ac-part-flag">
      <span>{f.label}</span>
      {f.fix ? <button type="button" className="ac-link bad" onClick={() => window.dispatchEvent(new CustomEvent('aircheck:fix', { detail: f.fix }))}>Fix<i className="ph ph-arrow-right"></i></button> : null}
    </div>
  );
}

/* THE DETAILS PANE: the facts, the status ladder, the checks, where the media lives, the manifest
 * and the earlier runs, with the decision (Approve, Hold, Changes) at its foot. */
function Details({ item, lane, tz, review, decide, fix, bucket, checks, runs, active, setActive, clockAt }: {
  item: QueueItem; lane: Lane; tz: string; review?: Review; decide?: Decide; fix: Flag | null; bucket: Bucket; checks: Check[]; runs: Run[]; active: string | null; setActive: (id: string | null) => void; clockAt?: number;
}) {
  const ad = item.ad;
  const [copied, setCopied] = useState(false);
  const path = ad ? ad.origin?.path : item.origin?.path;
  const copy = () => { if (path) navigator.clipboard?.writeText(path).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); };
  const pass = checks.filter((c) => c.ok).length;
  type Step = { s: 'ok' | 'bad' | 'on' | 'todo' | 'pause'; t: React.ReactNode };
  const ladder: Step[] = ad ? (['draft', 'review', 'approved', 'live'] as const).map((st, k, all) => {
    const at = all.indexOf(ad.status as typeof all[number]);
    return { s: ad.status === 'archived' ? 'todo' : k < at || (k === at && st !== 'review' && st !== 'draft') ? 'ok' : k === at ? 'on' : 'todo', t: LADDER_LABEL[st] };
  }) : [
    item.status === 'failed' ? { s: 'bad', t: 'The manifest has problems' } : { s: 'ok', t: item.source === 'day-plan' ? 'Built by the day plan' : 'Built by the lane' },
    item.status === 'held' ? { s: 'pause', t: 'Held by the job' } : { s: item.status === 'failed' ? 'todo' : 'ok', t: item.at ? `Queued for ${clock(item.at, tz)}` : 'Queued, unscheduled' },
    ...(bucket === 'fix' ? [{ s: 'bad' as const, t: <>Needs your fix<small>{fix?.label}</small></> }]
      : decide || review ? [review?.state === 'approved' ? { s: 'ok' as const, t: 'Approved' } : review?.state === 'held' ? { s: 'pause' as const, t: 'Held by you' } : { s: (item.status === 'sent' ? 'ok' : 'on') as Step['s'], t: 'Needs your OK' }]
      : []),
    item.status === 'sent' ? { s: 'ok', t: <>Sent{item.postUrl ? <a href={item.postUrl} target="_blank" rel="noreferrer">View post<i className="ph ph-arrow-up-right"></i></a> : item.unconfirmed ? <small>No link came back to confirm it</small> : null}</> } : { s: 'todo', t: 'Sent, with its post URL' },
  ];
  return (
    <aside className="ac-details" aria-label="Details">
      <div className="ac-details-b">
        <h2>{ad ? 'Creative details' : item.email ? 'Email details' : 'Post details'}</h2>
        <dl className="ac-dl">
          {ad ? <>
            <dt>Placement</dt><dd>{ad.format}</dd>
            <dt>Product</dt><dd>{ad.product}</dd>
            <dt>Files</dt><dd className="num">{item.media.length}{item.missing?.length ? <span className="ac-chip bad">{item.missing.length} missing</span> : null}</dd>
            {ad.recipe ? <><dt>Recipe</dt><dd className="mono">{ad.recipe}</dd></> : null}
            <dt>Run</dt><dd className="mono">{ad.run}</dd>
            {ad.stage && !armOfAd(ad) ? <><dt>Stage</dt><dd>{ad.stage}</dd></> : null}
            {armOfAd(ad) ? (() => { const a = armOfAd(ad)!; return <>
              <dt>Arm state</dt><dd><ArmChip a={a} /></dd>
              {a.budgetUsd ? <><dt>Budget</dt><dd className="num">${a.budgetUsd} total</dd></> : null}
              {a.campaign ? <><dt>Campaign</dt><dd className="mono">{a.campaign}</dd></> : null}
              <dt>Receipt</dt><dd className="mono">{a.receipt.split('/').pop()}</dd>
            </>; })() : null}
          </> : <>
            <dt>Send at</dt><dd className="num">{item.at ? clock(item.at, tz) : 'Unscheduled'}</dd>
            <dt>{item.email ? 'Sender' : 'Lane'}</dt><dd>{lane.name}</dd>
            {item.email ? <>
              <dt>From</dt><dd>{item.email.from || '—'}</dd>
              {item.email.to?.length ? <><dt>To</dt><dd>{item.email.to.join(', ')}</dd></> : null}
              {item.email.replyTo ? <><dt>Reply-To</dt><dd>{item.email.replyTo}</dd></> : null}
            </> : <>
              <dt>Format</dt><dd>{kindLabel(item.kind)}</dd>
              <dt>Media</dt><dd className="num">{item.media.length ? `${item.media.length} ${item.media.length === 1 ? 'file' : 'files'}` : 'None'}{item.missing?.length ? <span className="ac-chip bad">{item.missing.length} missing</span> : null}</dd>
            </>}
            <dt>Source</dt><dd>{item.source === 'day-plan' ? 'Day plan' : 'Queue folder'}</dd>
          </>}
          <dt>Earlier runs</dt><dd className="num">{runs.length}</dd>
        </dl>

        <h3>Status</h3>
        <ol className="ac-ladder">
          {ladder.map((st, k) => (
            <li key={k} className={st.s}>
              <span className="ac-ladder-i" aria-hidden>{st.s === 'ok' ? <i className="ph-bold ph-check"></i> : st.s === 'bad' ? <i className="ph-bold ph-exclamation-mark"></i> : st.s === 'pause' ? <i className="ph-bold ph-pause"></i> : st.s === 'on' ? <span className="ac-dot"></span> : null}</span>
              <span>{st.t}</span>
            </li>
          ))}
        </ol>

        {checks.length && !item.email && !ad ? <>
          <h3>Checks for {RULES[lane.platform]?.name || platform(lane.platform).label}<span className={`num${pass < checks.length ? ' wn' : ''}`}>{pass < checks.length ? `${checks.length - pass} ${checks.length - pass === 1 ? 'check' : 'checks'} failing` : `All ${checks.length} pass`}</span></h3>
          <ul className="ac-checks">
            {[...checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((c) => <li key={c.id} className={c.ok ? 'ok' : 'bad'}><i className={`ph-fill ${c.ok ? 'ph-check-circle' : 'ph-warning-circle'}`} aria-hidden></i><span>{c.label}</span><small className="num">{c.detail}</small></li>)}
          </ul>
        </> : null}

        {item.media.length && !item.email ? <><h3>Where the media lives</h3><Where media={item.media} /></> : null}

        <h3>Manifest</h3>
        {path ? (
          <div className="ac-path">
            <code>{home(path)}</code>
            <button type="button" className="ac-ib" aria-label={copied ? 'Copied' : 'Copy the path'} onClick={copy}><i className={`ph ${copied ? 'ph-check' : 'ph-copy'}`}></i></button>
          </div>
        ) : <p className="ac-muted">{item.source === 'day-plan' ? 'Read from the day plan.' : 'Synced to your account from your machine.'}</p>}

        {runs.length ? <><h3>Earlier runs</h3><RunHistory runs={runs} active={active} setActive={setActive} clockAt={clockAt} /></> : null}
      </div>
      {decide ? <div className="ac-details-f"><Gate key={`${item.id}:${review?.state || ''}`} item={item} review={review} decide={decide} /></div> : null}
    </aside>
  );
}

/* WHERE THE MEDIA LIVES. A post is a small JSON file; its images and video are never copied into
 * Aircheck. Each file is named with the place the browser loads it from: a folder on this computer,
 * or the owner's own storage (a URL), so nobody has to take that on trust. */
const home = (p: string) => p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/'))) || '/';
function common(dirs: string[]) {
  if (!dirs.length) return '';
  const parts = dirs.map((d) => d.split('/'));
  const out: string[] = [];
  for (let i = 0; i < parts[0].length; i++) { const seg = parts[0][i]; if (parts.every((x) => x[i] === seg)) out.push(seg); else break; }
  return out.join('/') || '/';
}
function Where({ media }: { media: MediaRef[] }) {
  if (!media.length) return null;
  const local = media.filter((m) => m.src !== 'url' && !/^https?:\/\//i.test(m.path));
  const remote = media.filter((m) => !local.includes(m));
  const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
  return (
    <div className="ac-where">
      {local.length ? <div><i className="ph ph-hard-drives" aria-hidden></i><span><b>On this computer</b><small className="mono">{home(common(local.map((m) => dirOf(m.path))))}</small></span><span className="num">{local.length}</span></div> : null}
      {remote.length ? <div><i className="ph ph-cloud" aria-hidden></i><span><b>In your own storage</b><small className="mono">{[...new Set(remote.map((m) => hostOf(m.path)))].join(', ')}</small></span><span className="num">{remote.length}</span></div> : null}
    </div>
  );
}


/** One ad creative opened on its own, for the Ads board's drawer: the same panel Today opens. */
export function OpenedCreative({ item, lane, tz, agents, defaultAgent, onBack }: { item: QueueItem; lane: Lane; tz: string; agents: string[]; defaultAgent: string; onBack: () => void }) {
  const car = useRef<CarHandle>(null);
  const ad = item.ad!;
  const bucket: Bucket = ad.missing?.length ? 'fix' : ad.status === 'archived' ? 'archived' : ad.approved || ad.status === 'approved' || ad.status === 'live' ? 'approved' : 'review';
  return <Opened item={item} lane={lane} laneName={lane.name} tz={tz} carRef={car} agents={agents} defaultAgent={defaultAgent} fix={fixOf(item, lane.platform)} bucket={bucket} onBack={onBack} />;
}

/* BULK ACTIONS on the Needs a fix group (review item 34): hold every failing post at once, or start a
 * Repair on each post that fails the same check (most often alt text). Each Repair is its own run on
 * this machine and only builds a candidate; nothing replaces a post until someone presses Use
 * revision on it. */
function BulkFix({ list, platformOf, decide, agent, demo }: { list: QueueItem[]; platformOf: (x: QueueItem) => string; decide: Decide; agent: string; demo?: boolean }) {
  const [busy, setBusy] = useState('');
  const alt = list.filter((x) => quickChecks(x, platformOf(x)).find((c) => !c.ok)?.id === 'alt');
  if (list.length < 2 && alt.length < 2) return null;
  const repairAll = async () => {
    if (demo) { (window.top || window).location.href = '/?signin=1'; return; }
    if (!window.confirm(`Start ${alt.length} Repair runs on this machine, one per post? Each builds a candidate beside its post and replaces nothing.`)) return;
    for (let k = 0; k < alt.length; k++) {
      setBusy(`${k + 1} of ${alt.length}`);
      await machineFetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'repair', day: alt[k].day, item: alt[k].id, request: 'Write alt text for every image', agent }) }).catch(() => null);
    }
    setBusy('');
  };
  return (
    <span className="ac-bulk">
      {list.length > 1 ? <button type="button" className="ac-link" onClick={() => decide(list.map((x) => x.id), 'held')}><i className="ph ph-pause"></i>Hold all {list.length}</button> : null}
      {alt.length > 1 ? <button type="button" className="ac-link" disabled={!!busy} onClick={repairAll}><i className="ph ph-wrench"></i>{busy ? `Starting ${busy}` : `Repair ${alt.length} alt text`}</button> : null}
    </span>
  );
}
