import type { Metadata } from 'next';
import '../../docs.css';
import { SiteFooter, SiteHeader } from '../../chrome';

const description = 'Aircheck shows queued social posts, their media, and their send status before a posting job sends them.';
const landingSource = 'https://aircheck.dev/';
const docsSource = 'https://aircheck.dev/docs';

export const metadata: Metadata = {
  title: 'Preview agent-queued social posts before they go out · Aircheck',
  description,
  alternates: { canonical: 'https://aircheck.dev/guides/preview-agent-queued-social-posts' },
  robots: { index: true, follow: true },
  openGraph: { title: 'Preview agent-queued social posts before they go out', description, url: 'https://aircheck.dev/guides/preview-agent-queued-social-posts' },
  twitter: { card: 'summary_large_image', title: 'Preview agent-queued social posts before they go out', description },

};

export default function PreviewGuide() {
  return (
    <>
      <SiteHeader title="Preview agent-queued social posts before they go out" />
      <main className="rd-main">
        <p>Aircheck shows queued social posts, their media, and their send status before a posting job sends them. The posting job writes one JSON manifest per post. Aircheck reads that day&apos;s queue and shows the rendered post and media on the Today screen. The <a href={landingSource}>live landing page</a> states that Aircheck shows every post agents queued today with its media; the <a href={docsSource}>live docs</a> define the manifest and MCP tools that write and read it.</p>
        <p><small>Evidence checked 10 November 2026: the <a href={landingSource}>live Aircheck landing page</a> and the <a href={docsSource}>live Aircheck docs</a>.</small></p>

        <h2 id="workflow">The workflow</h2>
        <ol className="ways">
          <li><h3>1. Connect the queue writer</h3><p>Use the Aircheck MCP server. Add it to Claude Code or Codex, then ask your agent to call <code>configure</code>. Aircheck reads your setup, proposes the config and the required change for each posting job, and writes nothing until you approve it. <a href={docsSource}>See the setup procedure in the docs.</a></p></li>
          <li><h3>2. Queue one manifest per post</h3><p>When an agent queues a post, call <code>queue_post</code>. The MCP server then writes a manifest. A post manifest includes the lane, optional send time, exact post text, ordered media sources, status, and an empty <code>postUrl</code> until the post is sent. A job that already writes daily plans can instead run <code>npx -y aircheck-mcp push</code> with <code>AIRCHECK_TOKEN</code>. <a href={docsSource}>See the manifest and daily push procedure in the docs.</a></p></li>
          <li><h3>3. Open the day in Aircheck</h3><p>Open Aircheck&apos;s Today view after the queue has been written. The landing page describes three views: a send-time strip, a thumbnail sheet grouped by hour, and a list with the lane, format, send time, and file count. The list also shows whether each post is sent, queued, or missing files. <a href={landingSource}>See the Today view described on the landing page.</a></p></li>
          <li><h3>4. Inspect, then fix before sending</h3><p>Open each queued post and inspect its copy and every media item before the posting job runs. Use Example to show a fresh version, Feedback to request a revision, or Repair to rebuild the post through its own pipeline. Repair can replace a queued post only after approval. Undo restores the old copy. <a href={landingSource}>See the preview and repair actions on the landing page.</a></p></li>
        </ol>

        <h2 id="check">What should you check before a post goes out?</h2>
        <p>Check the lane, send time, exact text, media order, and status. A queued post should use the queued status ladder. Aircheck reports missing local media instead of silently dropping it. After a send, the same manifest is rewritten with <code>sent</code> and <code>postUrl</code>. <a href={docsSource}>See the manifest fields and status rules in the docs.</a></p>

        <h2 id="safety">Can the preview publish the post?</h2>
        <p>No. The landing page says that a preview runs with no network and can write only in its run folder. Your posting jobs remain responsible for publishing. Aircheck reads the queue and can replace a queued post only when you approve a repair. <a href={landingSource}>See the local preview boundary on the landing page.</a></p>

        <p><small>Sources: <a href={landingSource}>live landing page</a> and <a href={docsSource}>live docs</a>, both checked 10 November 2026.</small></p>
        <a className="back" href="/"><i aria-hidden="true">←</i>Back to Aircheck</a>
      </main>
      <SiteFooter />
    </>
  );
}
