import type { Metadata } from 'next';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/bold';
import '@phosphor-icons/web/fill';
import '../compound-lockup.css';
import '../reader.css';
import '../landing.css';
import { COPY } from '../copy';
import { AppWindow } from '../AppWindow';
import { SignInLauncher } from '../SignInLauncher';
import { Brand, Lockup, SiteNav } from '../chrome';
import { LandingMotion } from './LandingMotion';
import { googleEnabled } from '@/server/oauth';
import { InstallMcp } from './InstallMcp';
import { DISCUSSIONS, CONTRIBUTING, ISSUES, REPO, SPONSOR } from '@/lib/project';
import { DEMO_ITEMS, DEMO_LANES, DEMO_NOW, DEMO_RUNS, DEMO_SELECTED, DEMO_TZ } from '@/lib/demo-day';
import { ago, clock, platform, since } from '@/lib/ui';

/* THE LANDING, 2026-11-15 redesign (direction "dusk plate"): the light Today board on a dusk landscape, red only as the on-air
 * light; a dark bento of the product's loop; the lanes card flowing into Today; the four steps that
 * keep media on your machine; the questions beside the preview's boundary; a closing card and a
 * footer that fades back into the dusk. Copy lives in ../copy.ts.
 *
 * aircheck.dev serves this at "/" to anyone signed out (worker/index.mjs); /home is its route. The
 * window in the hero is the real Today view on the sample day (/demo, ../AppWindow.tsx). */

const description = 'Aircheck shows every post your agents queued for today with its media. You can preview, revise, or repair a post before it goes out. Aircheck runs on your machine with no account, hosted backend, or billing.';
const ogTitle = 'Aircheck shows every post agents queued today before it goes out';
/* The share card: the live headline beside the real Today view. */
const card = { url: 'https://aircheck.dev/og-20261116.jpg', width: 1200, height: 630, type: 'image/jpeg', alt: 'Aircheck puts every post your agents queued on one screen.' };

export const metadata: Metadata = {
  metadataBase: new URL('https://aircheck.dev'),
  title: 'Aircheck: every post agents queued today, before it goes out',
  description,
  alternates: { canonical: 'https://aircheck.dev/' },
  openGraph: { type: 'website', siteName: 'Aircheck', url: 'https://aircheck.dev/', title: ogTitle, description, images: [card] },
  twitter: { card: 'summary_large_image', title: ogTitle, description, images: [{ url: card.url, alt: card.alt }] },
};

/* Motion is allowed: mark the document before anything paints, so reveals start hidden and never
 * flash. Without this (no script, reduced motion) every block is simply there. */
const MOTION = `try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('lp-js')}catch(e){}`;

/* A statement in two tones that lights word by word: `lead` ends where the white stops. */
function Fill({ text, lead, as: Tag = 'h2', id }: { text: string; lead: number; as?: 'h2' | 'h1'; id?: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag className="fill" data-fill id={id}>
      {words.map((w, i) => <span key={i} className={`fw${i < lead ? ' a' : ' b'}`} style={{ ['--k' as string]: (i / Math.max(1, words.length - 1)).toFixed(3) }}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}
    </Tag>
  );
}

/* The hero headline: each word rises in, 60ms behind the last. */
function Rise({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return <h1 className="h1">{words.map((w, i) => <span key={i} className="rw" style={{ animationDelay: `${120 + i * 60}ms` }}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}</h1>;
}

const Logo = ({ n, alt }: { n: string; alt: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`/logos/${n}.svg`} alt={alt} width={26} height={26} loading="lazy" />
);


/* The sample day the hero window shows (src/lib/demo-day.ts), as Today lists it: the last post
 * that went out and the three queued after it, on platforms with a logo here. */
const LOGO: Record<string, string> = { linkedin: 'linkedin', x: 'x', threads: 'threads', instagram: 'instagram', youtube: 'youtube', bluesky: 'bluesky', tiktok: 'tiktok', email: 'gmail' };
const DAY = (() => {
  const lane = new Map(DEMO_LANES.map((l) => [l.id, l]));
  const rows = DEMO_ITEMS.filter((i) => i.at && LOGO[lane.get(i.lane)?.platform || '']).sort((a, b) => a.at!.localeCompare(b.at!));
  const k = Math.max(0, rows.map((r) => r.status).lastIndexOf('sent'));
  return rows.slice(k, k + 4).map((i) => ({
    logo: LOGO[lane.get(i.lane)!.platform], name: platform(lane.get(i.lane)!.platform).label, post: i.title || '', at: clock(i.at, DEMO_TZ),
    sent: i.status === 'sent', review: i.status === 'queued' && !i.review,
  }));
})();

/* The sample day's one run (DEMO_RUNS): Codex's repair on the Instagram latte, as the opened post's
 * run panel shows it once it is done (src/components/Actions.tsx): the header with the agent and the
 * time, the comment, the note, Before and After with media and text, then Use revision beside Compare
 * and Discard, and Revise beside the comment box. */
const AGENT: Record<string, string> = { codex: 'Codex', claude: 'Claude' };
const REPAIR = (() => {
  const run = DEMO_RUNS[DEMO_SELECTED][0], item = DEMO_ITEMS.find((i) => i.id === DEMO_SELECTED)!, out = run.output!;
  const first = (t: string) => t.split('\n')[0];
  return {
    agent: AGENT[run.agent] || run.agent, said: run.comment || '', note: out.notes || '',
    at: since(run.finishedAt || run.createdAt, DEMO_NOW), took: ago(run.createdAt, Date.parse(run.finishedAt!)),
    before: { src: item.media[0].path, text: first(item.text || item.title || '') },
    after: { src: (out.media || item.media)[0].path, text: first(out.text || '') },
  };
})();

const STEPS: { n: string; text: string; code: string; label: string; icon: string }[] = [
  { n: '01', text: COPY.rd_step1, code: 'queue/<date>/', label: 'MCP server', icon: 'ph-file-text' },
  { n: '02', text: COPY.rd_step2, code: 'AIRCHECK_TOKEN', label: 'Sync', icon: 'ph-key' },
  { n: '03', text: COPY.rd_step3, code: 'aircheck.config.json', label: 'Today', icon: 'ph-sliders-horizontal' },
  { n: '04', text: COPY.rd_step4, code: '127.0.0.1:3327', label: 'Media bridge', icon: 'ph-hard-drives' },
];

const FAQ = [6, 7, 8, 1, 2, 3, 4, 5] as const;

/* Where Aircheck sits: in front of the scheduler or job that already posts. */
const SCHEDULERS: { name: string; img?: string; icon?: string; note?: string }[] = [
  { name: 'Postiz', icon: 'ph-calendar-check', note: COPY.oss_sched_postiz },
  { name: 'Claude Code', img: '/claude.svg' }, { name: 'Codex', img: '/openai.svg' },
  { name: 'cron', icon: 'ph-timer' }, { name: 'launchd', icon: 'ph-terminal-window' }, { name: 'Airflow', icon: 'ph-wind' },
  { name: COPY.oss_sched_any, icon: 'ph-file-text' },
];

/* The three free ways to run it, the default first. */
const TIERS = [
  { h: COPY.oss_tier1_h, p: COPY.oss_tier1_p, code: 'npm run dev', icon: 'ph-laptop' },
  { h: COPY.oss_tier2_h, p: COPY.oss_tier2_p, code: 'wrangler deploy', icon: 'ph-cloud' },
  { h: COPY.oss_tier3_h, p: COPY.oss_tier3_p, code: 'manifests only', icon: 'ph-user-circle' },
];

/* The ledger: plain rows, each a label and its value. */
const LEDGER = [
  [COPY.oss_ledger_selfhost, COPY.oss_ledger_selfhost_v], [COPY.oss_ledger_hosted, COPY.oss_ledger_hosted_v], [COPY.oss_ledger_ads, COPY.oss_ledger_ads_v],
  [COPY.oss_ledger_media, COPY.oss_ledger_media_v], [COPY.oss_ledger_license, COPY.oss_ledger_license_v],
] as const;

/* The hero chip is data, read off the same sample day the window draws (review item 42): when the
 * next post goes out, and how many are queued. */
const LIVE = (() => {
  const queued = DEMO_ITEMS.filter((i) => i.status === 'queued' && i.at);
  const next = queued.filter((i) => Date.parse(i.at!) > DEMO_NOW).sort((a, b) => a.at!.localeCompare(b.at!))[0];
  return COPY.rd2_hero_live.replace('{time}', clock(next?.at, DEMO_TZ)).replace('{n}', String(queued.length));
})();

/* The wiring, as the README names it (review item 41): the agents and jobs you already run, the MCP
 * server and the queue folder on your machine, and Today. */
const WIRE_LEFT: { name: string; img?: string; icon?: string }[] = [
  { name: 'Claude Code', img: '/claude.svg' }, { name: 'Codex', img: '/openai.svg' },
  { name: 'cron', icon: 'ph-timer' }, { name: 'Airflow', icon: 'ph-wind' }, { name: 'launchd', icon: 'ph-terminal-window' },
];

export default async function Landing({ searchParams }: { searchParams: Promise<{ signin?: string; error?: string; token?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: MOTION }} />
      <LandingMotion />
      <div className="lp" id="top">
        {/* ── the hero, on the dusk ───────────────────────────────────────────── */}
        <header className="hero">
          <div className="sky" aria-hidden="true"></div>
          <SiteNav local />
          <div className="hero-copy">
            <div className="chips hz" style={{ animationDelay: '40ms' }}>
              <p className="chip onair"><span className="live" aria-hidden="true"></span><span className="num">{LIVE}</span></p>
              <a className="chip onair oss" href={REPO}><i className="ph-bold ph-git-branch" aria-hidden="true"></i>{COPY.oss_hero_chip}</a>
            </div>
            <Rise text={COPY.rd_hero_h1} />
            <p className="sub hz" style={{ animationDelay: '520ms' }}>{COPY.rd_hero_sub}</p>
            <div className="ctas hz" style={{ animationDelay: '620ms' }}>
              <InstallMcp label={COPY.oss_install_label} note={COPY.oss_install_note} />
              <div className="cta-row">
                <a className="ac-btn ac-btn-light" href={REPO}><i className="ph-bold ph-github-logo" aria-hidden="true"></i>{COPY.oss_cta_github}</a>
                <a className="lnk" href="/?signin=1">{COPY.oss_cta_hosted}<i className="ph-bold ph-arrow-right" aria-hidden="true"></i></a>
              </div>
            </div>
            {/* The boundary, under the call to action (review item 39): Aircheck never posts. */}
            <ul className="bstrip hz" style={{ animationDelay: '700ms' }} aria-label="What Aircheck can do">
              <li className="b-post"><i className="ph-bold ph-prohibit" aria-hidden="true"></i><span><small>Publishes</small><b>{COPY.rd_bound_posts}</b></span></li>
              <li><i className="ph-bold ph-wifi-slash" aria-hidden="true"></i><span><small>Preview run</small><b>{COPY.rd_bound_net}</b></span></li>
              <li><i className="ph-bold ph-folder-simple" aria-hidden="true"></i><span><small>Writes to</small><b>{COPY.rd_bound_writes}</b></span></li>
            </ul>
          </div>
          <div className="shot hz" style={{ animationDelay: '760ms' }} id="today">
            <div className="frame desk">
              <div className="fb" aria-hidden="true"><i></i><i></i><i></i><span>aircheck.dev</span></div>
              <AppWindow src="/demo" />
            </div>
            {/* On a phone the window is the app at phone width, list first, in a phone (item 14). */}
            <div className="phone" aria-hidden="true"><div className="notch"></div><AppWindow src="/demo" w={390} h={780} lazy title="Aircheck Today on a phone, sample day" /></div>
          </div>
        </header>

        {/* ── see it, sample it, fix it ───────────────────────────────────────── */}
        <section className="night bento-sec" id="fix" aria-labelledby="bento-h">
          <div className="w center">
            <p className="chip dark" data-reveal><span className="live" aria-hidden="true"></span>{COPY.rd_bento_chip}</p>
            <Fill text={COPY.rd_bento_h} lead={3} id="bento-h" />
            <p className="lead" data-reveal>{COPY.rd_bento_p}</p>
          </div>
          <div className="w bento">
            <article className="card" data-reveal>
              <div className="vig rows" aria-hidden="true">
                {DAY.map((d) => (
                  <div key={d.post + d.at} className={`row${d.review ? ' hot' : ''}`}>
                    <span className="lg"><Logo n={d.logo} alt="" /></span>
                    <span className="t"><b>{d.post}</b><small>{d.name}</small></span>
                    <span className={`st${d.sent ? ' sent' : d.review ? ' rev' : ''}`}>{d.sent ? <><i className="ph-bold ph-check"></i>Sent {d.at}</> : <>Queued {d.at}</>}</span>
                  </div>
                ))}
              </div>
              <h3>{COPY.rd_see_h}</h3>
              <p>{COPY.rd_see_p}</p>
            </article>
            <article className="card" data-reveal style={{ transitionDelay: '90ms' }}>
              <div className="vig run" aria-hidden="true">
                {/* A running example run as the run panel draws it: agent and time in the header, Stop alone below. */}
                <div className="rh"><i className="ph ph-sparkle"></i><b>Example run</b><span className="who">Codex</span><span className="tag">Shown only</span><span className="t num">1m 12s</span></div>
                <ol className="steps">
                  <li className="ok"><i className="ph-bold ph-check"></i>Started Codex</li>
                  <li className="ok"><i className="ph-bold ph-check"></i>Reading the pipeline that made this post</li>
                  <li className="ok"><i className="ph-bold ph-check"></i>Made 1 file</li>
                  <li className="now"><span className="spin"></span><code>post.json</code></li>
                </ol>
                <div className="rf"><span className="stop"><i className="ph ph-stop"></i>Stop</span></div>
              </div>
              <h3>{COPY.rd_sample_h}</h3>
              <p>{COPY.rd_sample_p}</p>
            </article>
            <article className="card" data-reveal style={{ transitionDelay: '180ms' }}>
              <div className="vig fix" aria-hidden="true">
                <div className="rh"><i className="ph ph-wrench"></i><b>Revised run</b><span className="who">{REPAIR.agent}</span><span className="tag ok">Can replace</span><span className="t num">{REPAIR.at}</span></div>
                <p className="said">“{REPAIR.said}”</p>
                <p className="note">{REPAIR.note}</p>
                <div className="cmp">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <figure><figcaption>Before</figcaption><img src={REPAIR.before.src} alt="" width={120} height={150} loading="lazy" /><p>{REPAIR.before.text}</p></figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <figure className="new"><figcaption>After<span className="num"> · took {REPAIR.took}</span></figcaption><img src={REPAIR.after.src} alt="" width={120} height={150} loading="lazy" /><p>{REPAIR.after.text}</p></figure>
                </div>
                <div className="acts"><span className="b pri"><i className="ph-bold ph-check"></i>Use revision</span><span className="b on"><i className="ph ph-columns"></i>Compare</span><span className="b">Discard</span></div>
                <div className="again"><span className="ta">Comment to revise again…</span><span className="b"><i className="ph ph-arrow-clockwise"></i>Revise</span></div>
              </div>
              <h3>{COPY.rd_fix_h2}</h3>
              <p>{COPY.rd_fix_p2}</p>
            </article>
          </div>
        </section>

        {/* ── your lanes, into Today ──────────────────────────────────────────── */}
        <section className="lanes-sec" id="wire" aria-labelledby="lanes-h">
          <div className="sky2" aria-hidden="true"></div>
          <div className="w lanes">
            <div className="lcard wire" data-reveal>
              <div className="wcol">
                <span className="wh">{COPY.rd2_wire_col1}</span>
                <ul>{WIRE_LEFT.map((x) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <li key={x.name}><span className="lg">{x.img ? <img src={x.img} alt="" width={16} height={16} /> : <i className={`ph-bold ${x.icon}`} aria-hidden="true"></i>}</span>{x.name}</li>
                ))}</ul>
              </div>
              <svg className="wflow" viewBox="0 0 40 200" preserveAspectRatio="none" aria-hidden="true">{[20, 60, 100, 140, 180].map((y) => <path key={y} d={`M0 ${y} C 24 ${y}, 16 100, 40 100`} />)}</svg>
              <div className="wcol mid">
                <span className="wh">{COPY.rd2_wire_col2}</span>
                <div className="wbox"><i className="ph-bold ph-plugs" aria-hidden="true"></i><code>aircheck-mcp</code></div>
                <i className="ph ph-arrow-down wdown" aria-hidden="true"></i>
                <div className="wbox"><i className="ph-bold ph-folder-simple" aria-hidden="true"></i><code>queue/&lt;YYYY-MM-DD&gt;/</code></div>
              </div>
              <svg className="wflow one" viewBox="0 0 40 200" preserveAspectRatio="none" aria-hidden="true"><path d="M0 100 L 40 100" /></svg>
              <div className="wcol">
                <span className="wh">{COPY.rd2_wire_col3}</span>
                <div className="today">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/aircheck-mark.svg" alt="" width={40} height={40} />
                  <span><b>Today</b><small>{COPY.rd_lanes_today}</small></span>
                  <span className="pulse" aria-hidden="true"></span>
                </div>
              </div>
            </div>
            <div className="lcopy" data-reveal style={{ transitionDelay: '100ms' }}>
              <p className="chip glass"><i className="ph-bold ph-plugs" aria-hidden="true"></i>{COPY.rd_lanes_chip}</p>
              <h2 id="lanes-h" className="serif">{COPY.rd_lanes_h}</h2>
              <p className="lead">{COPY.rd_lanes_p}</p>
              <p className="codechip"><code>aircheck-mcp</code><i className="ph-bold ph-arrow-right" aria-hidden="true"></i><code>queue/&lt;YYYY-MM-DD&gt;/</code></p>
              <a className="lnk" href="/docs#manifest">{COPY.wire_docs}<i className="ph-bold ph-arrow-right" aria-hidden="true"></i></a>
            </div>
          </div>
        </section>

        {/* ── in front of the scheduler you already run ───────────────────────── */}
        <section className="night sched-sec" id="schedulers" aria-labelledby="sched-h">
          <div className="w center">
            <p className="chip dark" data-reveal><i className="ph-bold ph-calendar-dots" aria-hidden="true"></i>{COPY.oss_sched_chip}</p>
            <h2 id="sched-h" className="serif" data-reveal>{COPY.oss_sched_h}</h2>
            <p className="lead" data-reveal>{COPY.oss_sched_p}</p>
            <ul className="sched" data-reveal>{SCHEDULERS.map((x) => (
              <li key={x.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <span className="lg">{x.img ? <img src={x.img} alt="" width={16} height={16} /> : <i className={`ph-bold ${x.icon}`} aria-hidden="true"></i>}</span>
                <span className="nm">{x.name}{x.note ? <small>{x.note}</small> : null}</span>
              </li>
            ))}</ul>
          </div>
        </section>

        {/* ── your media never leaves your machine ────────────────────────────── */}
        <section className="night flow-sec" aria-labelledby="flow-h">
          <div className="w center">
            <p className="chip dark" data-reveal><i className="ph-bold ph-hard-drives" aria-hidden="true"></i>{COPY.rd_flow_chip}</p>
            <Fill text={COPY.rd_flow_h} lead={4} id="flow-h" />
          </div>
          <ol className="w steps4">
            {STEPS.map((s, i) => (
              <li key={s.n} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                <div className="sh"><span className="n">{s.n}</span><span className="lb"><i className={`ph ${s.icon}`} aria-hidden="true"></i>{s.label}</span></div>
                <p>{s.text}</p>
                <code>{s.code}</code>
              </li>
            ))}
          </ol>
        </section>

        {/* ── it runs on your machine: three free ways ────────────────────────── */}
        <section className="night tiers-sec" id="self-host" aria-labelledby="tiers-h">
          <div className="w center">
            <p className="chip dark" data-reveal><i className="ph-bold ph-laptop" aria-hidden="true"></i>{COPY.oss_tiers_chip}</p>
            <h2 id="tiers-h" className="serif" data-reveal>{COPY.oss_tiers_h}</h2>
            <p className="lead" data-reveal>{COPY.oss_tiers_p}</p>
          </div>
          <ol className="w tiers">
            {TIERS.map((t, i) => (
              <li key={t.h} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                <i className={`ph ${t.icon}`} aria-hidden="true"></i>
                <h3>{t.h}</h3>
                <p>{t.p}</p>
                <code>{t.code}</code>
              </li>
            ))}
          </ol>
          <div className="w center"><a className="lnk" href="/docs/self-host" data-reveal>{COPY.q7}<i className="ph-bold ph-arrow-right" aria-hidden="true"></i></a></div>
        </section>

        {/* ── free, and staying free ──────────────────────────────────────────── */}
        <section className="night free-sec" id="free" aria-labelledby="free-h">
          <div className="w free">
            <div className="fcopy" data-reveal>
              <p className="chip dark"><i className="ph-bold ph-hand-heart" aria-hidden="true"></i>{COPY.oss_free_chip}</p>
              <h2 id="free-h" className="serif">{COPY.oss_free_h}</h2>
              <p className="lead">{COPY.oss_free_p}</p>
              <p className="links"><a className="lnk" href={REPO}>{COPY.oss_foot_source}<i className="ph-bold ph-arrow-right" aria-hidden="true"></i></a>{SPONSOR ? <a className="lnk" href={SPONSOR}>Sponsor<i className="ph-bold ph-arrow-right" aria-hidden="true"></i></a> : null}</p>
            </div>
            <dl className="ledger" data-reveal style={{ transitionDelay: '100ms' }}>
              {LEDGER.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </div>
        </section>

        {/* ── questions, beside the preview's boundary ────────────────────────── */}
        <section className="night faq-sec" id="faq" aria-labelledby="faq-h">
          <div className="w faq">
            <div className="bound" data-reveal aria-label="Preview run capabilities">
              <div className="tag t1"><small>Preview run</small><b>{COPY.rd_bound_net}</b></div>
              <div className="tag t2"><small>Writes to</small><b>{COPY.rd_bound_writes}</b><code>runs/&lt;id&gt;/out/</code></div>
              <div className="tag t3"><small>Publishes</small><b>{COPY.rd_bound_posts}</b></div>
            </div>
            <div className="qa">
              <p className="chip dark" data-reveal><i className="ph-bold ph-question" aria-hidden="true"></i>{COPY.rd_faq_chip}</p>
              <h2 id="faq-h" className="serif" data-reveal>{COPY.rd_faq_h}</h2>
              <div className="acc">
                {FAQ.map((n, i) => (
                  <details key={n} open={i === 0}>
                    <summary><span>{COPY[`q${n}`]}</span><i aria-hidden="true"></i></summary>
                    <p>{COPY[`a${n}`]}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── the closing card ────────────────────────────────────────────────── */}
        <section className="night close-sec" aria-labelledby="close-h">
          <div className="w">
            <div className="closecard" data-reveal>
              <div className="cc">
                <p className="chip dark"><i className="ph-bold ph-arrow-right" aria-hidden="true"></i>{COPY.rd_close_chip}</p>
                <h2 id="close-h" className="serif">{COPY.rd_close_h2}</h2>
                <p>{COPY.rd_close_p2}</p>
                <a className="ac-btn ac-btn-light" href="/?signin=1">{COPY.hero_cta}</a>
              </div>
              <div className="bleed" aria-hidden="true"><div className="frame"><AppWindow src="/demo" lazy /></div></div>
            </div>
          </div>
        </section>

        {/* ── the footer, back into the dusk ──────────────────────────────────── */}
        <footer className="foot">
          <div className="w fcols">
            <div className="fb1"><Brand href="#top" /><p>{COPY.tagline}</p></div>
            <nav aria-label="Product"><b>Product</b><a href="#today">{COPY.nav_today}</a><a href="#fix">{COPY.nav_fix}</a><a href="#wire">{COPY.nav_wire}</a><a href="#faq">{COPY.nav_faq}</a></nav>
            <nav aria-label="Resources"><b>Resources</b><a href="/docs">{COPY.nav_docs}</a><a href="/docs#tools">MCP server</a><a href="/docs/self-host">Self-host</a><a href="/guides/preview-agent-queued-social-posts">Guide</a></nav>
            <nav aria-label="Open source"><b>{COPY.oss_foot_head}</b><a href={REPO}>{COPY.oss_foot_source}</a><a href={ISSUES}>{COPY.oss_foot_bug}</a><a href={CONTRIBUTING}>{COPY.oss_foot_contribute}</a><a href={DISCUSSIONS}>{COPY.oss_foot_discussions}</a>{SPONSOR ? <a href={SPONSOR}>Sponsor</a> : null}</nav>
            <nav aria-label="Compound Labs"><b>Compound Labs</b><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></nav>
          </div>
          <div className="w fbot"><Lockup /><span>{COPY.foot}</span></div>
          <div className="hills" aria-hidden="true"></div>
          {/* The sign-off: the name, large, cut by the bottom edge (review item 46). */}
          <div className="wordmark" aria-hidden="true">Aircheck</div>
        </footer>
      </div>
      <SignInLauncher open={sp.signin === '1' || sp.signin === 'reset'} reset={sp.signin === 'reset' ? (sp.token || '').slice(0, 200) : ''} google={googleEnabled()} error={sp.error && sp.error !== 'google' ? sp.error.slice(0, 200) : sp.error === 'google' ? 'Google sign-in did not finish. Try again.' : ''} />
    </>
  );
}
