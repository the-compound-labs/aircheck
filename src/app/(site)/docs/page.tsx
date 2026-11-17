import type { Metadata } from 'next';
import '../docs.css';
import { SiteFooter, SiteHeader } from '../chrome';
import { COPY } from '../copy';
import { DocsNav, type DocGroup } from './DocsNav';
import { ClientTabs, DocsAside } from './DocsAside';
import { hl } from './hl';

const description = 'These docs define the Aircheck manifest for posts and ad creatives, media source rules, and the MCP server that writes the files.';

export const metadata: Metadata = {
  title: 'Docs · Aircheck',
  description,
  alternates: { canonical: 'https://aircheck.dev/docs' },
  robots: { index: true, follow: true },
  openGraph: { title: 'Aircheck docs', description, url: 'https://aircheck.dev/docs' },
  twitter: { card: 'summary_large_image' },

};


/* The sidebar: every section of the page, grouped the way a reader looks for it. */
const MCP_JSON = `{
  "mcpServers": {
    "aircheck": {
      "command": "npx",
      "args": ["-y", "aircheck-mcp"],
      "env": {
        "AIRCHECK_TOKEN": "<your token>"
      }
    }
  }
}`;
const MCP_TOML = `[mcp_servers.aircheck]
command = "npx"
args = ["-y", "aircheck-mcp"]
env = { AIRCHECK_TOKEN = "<your token>" }`;

const GROUPS: DocGroup[] = [
  { label: 'Start', items: [{ id: 'setup', label: 'Two ways to set up' }, { id: 'mcp', label: 'Add the MCP server' }] },
  { label: 'Manifest', items: [{ id: 'manifest', label: 'The manifest' }, { id: 'ads', label: 'Ad creatives' }, { id: 'email', label: 'Emails' }] },
  { label: 'Media', items: [{ id: 'media', label: 'Media sources' }, { id: 'where', label: 'Where media lives' }] },
  { label: 'Account', items: [{ id: 'daily', label: 'Every day on aircheck.dev' }, { id: 'config', label: 'The config file' }, { id: 'logos', label: 'Lane logos' }] },
  { label: 'Reference', items: [{ id: 'tools', label: 'The MCP tools' }, { id: 'skill', label: 'The setup skill' }] },
];

/* The reviewed docs text, as markup. Code
 * samples keep their exact characters; hl() only colours them. The 2026-11-15 redesign puts the page
 * under the short dusk band with a grouped sidebar (../docs.css). */
export default function Docs() {
  return (
    <>
      <SiteHeader title="Docs" lede={COPY.rd_docs_lede} />
      <div className="dc"><DocsNav groups={GROUPS} />
      <main className="rd-main dc-main">
<p>Aircheck reads one small JSON manifest for each post your agents queue and each ad creative your pipeline renders. This page defines the format, media rules, and MCP server.</p>

<h2 id="setup">One setup with two ways to create it</h2>
<p>{COPY.rd2_docs_install} Aircheck has one setup, shown in the manifest format below. Two setup paths produce identical files. Aircheck cannot distinguish between them.</p>
<ol className="ways"><li>The recommended path uses the MCP server. Add one entry to your Claude Code or Codex config. Ask your agent to set up Aircheck. The agent reads your setup, shows the proposed config and the required change for each posting job, and writes nothing until you approve. It then reports the items it queued.</li><li>You can also read this page and write the JSON yourself. A cron or Airflow setup without an agent writes the same files directly. This path supports setups without an agent. The MCP server remains the recommended path.</li></ol>

<h2 id="mcp">Add the MCP server</h2>
<p>Your account page issues this block with a machine token. Paste it into <code>~/.claude.json</code> under <code>mcpServers</code>, or into <code>.mcp.json</code> in a project. Aircheck shows the token once and stores only its hash. Revoking the token locks that machine out immediately. Replace the path with the server&apos;s location on your machine.</p>
<ClientTabs tabs={[
  { id: 'claude', label: 'Claude Code', img: '/claude.svg', cap: '~/.claude.json', code: hl(MCP_JSON) },
  { id: 'codex', label: 'Codex', img: '/openai.svg', cap: '~/.codex/config.toml', code: hl(MCP_TOML) },
  { id: 'cursor', label: 'Cursor', cap: '~/.cursor/mcp.json', code: hl(MCP_JSON) },
  { id: 'json', label: 'JSON', cap: 'any MCP client', code: hl(MCP_JSON) },
]} />
<p>Ask your agent to set up Aircheck. It calls <code>configure</code>, shows the proposed config and the required change for each posting job, and writes nothing until you approve.</p>

<h2 id="manifest">The manifest</h2>
<p>Write one JSON file for each queued post or ad creative in a folder named for the day. <code>lane</code> is the only required field. Aircheck still shows an invalid manifest as a failed item with its errors. This keeps a job typo visible instead of silently emptying the day.</p>
<figure className="code"><pre>{hl(`<queue>/<YYYY-MM-DD>/<anything>.json`)}</pre></figure>
<figure className="code"><div className="cap">a post</div><pre>{hl(`{
  "lane": "brand-x",
  "at": "2026-11-07T15:30:00Z",
  "kind": "carousel",
  "text": "Post copy exactly as it will go out",
  "media": ["slide-1.png", "https://cdn.you.com/slide-2.png"],
  "status": "queued",
  "postUrl": null
}`)}</pre></figure>
<div className="tw"><table><thead><tr><th>field</th><th>meaning</th></tr></thead><tbody><tr><td><code>lane</code></td><td>Which account or lane this goes out on. For an ad creative, the ad platform or account it runs on. Required.</td></tr><tr><td><code>at</code></td><td>When it sends, ISO 8601. Omit for unscheduled.</td></tr><tr><td><code>kind</code></td><td><code>text</code>, <code>image</code>, <code>carousel</code>, <code>video</code>, <code>thread</code>, <code>article</code>. Inferred from <code>media</code> when absent.</td></tr><tr><td><code>text</code></td><td>The copy, exactly as it will post.</td></tr><tr><td><code>media</code></td><td>Ordered list of media sources. See Media sources.</td></tr><tr><td><code>status</code></td><td>A post: <code>queued</code>, <code>sent</code>, <code>held</code>, <code>failed</code> (default <code>queued</code>). An ad creative: <code>draft</code>, <code>review</code>, <code>approved</code>, <code>live</code>, <code>archived</code> (default <code>draft</code>).</td></tr><tr><td><code>ad</code></td><td>Present only on an ad creative. See below.</td></tr><tr><td><code>postUrl</code></td><td>The permalink, after sending. Posts only.</td></tr></tbody></table></div>
<p>After a send, the job or MCP server rewrites the same file. <code>status</code> becomes <code>sent</code>, and <code>postUrl</code> is filled in. The file&apos;s other fields stay unchanged.</p>

<h3 id="ads">An ad creative uses the same manifest</h3>
<p>An ad creative uses the same manifest with an <code>ad</code> block. The <code>ad</code> block distinguishes a creative from a post. A file without <code>ad</code> is a post in Social, grouped by send hour. A file with <code>ad</code> is a creative in Ads, grouped by run. One folder can hold both files. Each view excludes the other file type.</p>
<figure className="code"><div className="cap">an ad creative</div><pre>{hl(`{
  "lane": "meta",
  "text": "Maple oat latte is back.",
  "media": ["slide-1.png", "https://cdn.you.com/slide-2.png"],
  "status": "review",
  "ad": {
    "product": "harbor-coffee",
    "format": "carousel-feed",
    "run": "review-2026-11-07",
    "approved": false
  }
}`)}</pre></figure>
<div className="tw"><table><thead><tr><th>field</th><th>meaning</th></tr></thead><tbody><tr><td><code>ad.product</code></td><td>What the creative is about. Required.</td></tr><tr><td><code>ad.format</code></td><td>The placement it is cut for: <code>carousel-feed</code>, <code>still-square</code>, <code>video-portrait-15s</code>, <code>search-text</code>. Defaults to the kind.</td></tr><tr><td><code>ad.run</code></td><td>The production run it belongs to. Creatives are grouped by run. Defaults to the dated folder.</td></tr><tr><td><code>ad.approved</code></td><td>A person signed off. Defaults to <code>false</code>.</td></tr><tr><td><code>ad.recipe</code></td><td>The recipe or script that built it, so Repair can re-run the real pipeline. Optional.</td></tr></tbody></table></div>
<p><code>lane</code>, <code>text</code>, <code>media</code>, <code>kind</code>, <code>title</code> and <code>meta</code> have the same meanings for posts and creatives. <code>media</code> follows the source rules below. <code>at</code> remains optional. A creative normally omits <code>at</code>.</p>
<div className="tw"><table><thead><tr><th></th><th>no <code>ad</code>: a post</th><th><code>ad</code>: a creative</th></tr></thead><tbody><tr><td>Scope</td><td>Social</td><td>Ads</td></tr><tr><td>Grouped by</td><td>Send hour</td><td><code>ad.run</code></td></tr><tr><td>Status</td><td><code>queued</code> <code>sent</code> <code>held</code> <code>failed</code></td><td><code>draft</code> <code>review</code> <code>approved</code> <code>live</code> <code>archived</code></td></tr><tr><td>Replace is locked</td><td>Once sent or held, or within 6 minutes of its send time</td><td>Once approved, live or archived</td></tr><tr><td><code>mark_sent</code> writes</td><td><code>sent</code> and <code>postUrl</code></td><td><code>live</code></td></tr></tbody></table></div>
<p>Each manifest shape has its own status ladder. Aircheck checks the status word against the shape. Aircheck reports a post marked <code>review</code> or a creative marked <code>queued</code> as a problem. The problem lists both fixes: use the other ladder, or add or remove the <code>ad</code> block.</p>
<p>Repair may replace a creative only before anyone signs off. Aircheck refuses Replace when <code>ad.approved</code> is true or when <code>status</code> is <code>approved</code>, <code>live</code> or <code>archived</code>. A replace preserves <code>approved</code> and <code>status</code>. Replace cannot promote a creative.</p>
<p>Aircheck reads a renderer&apos;s existing manifest without changing it. The <code>ad-catalog</code> source reads <code>&lt;dir&gt;/&lt;product&gt;/&lt;run&gt;/catalog.json</code>. It lists one creative for each asset in that file. The renderer owns the file, so Aircheck preserves its shape.</p>

<h3 id="email">An email uses the same manifest</h3>
<p>An email is a manifest with an <code>email</code> block. Aircheck shows it in Email, where the rendered message appears as the reader will see it. The email uses the post status words. A manifest cannot have both <code>ad</code> and <code>email</code>.</p>
<figure className="code"><div className="cap">an email</div><pre>{hl(`{
  "lane": "brand-email",
  "at": "2026-11-07T14:00:00Z",
  "status": "queued",
  "email": {
    "subject": "What shipped this week",
    "from": "Your Brand <hello@yourbrand.com>",
    "to": "weekly-list",
    "preheader": "Three changes worth a look",
    "html": "weekly.html",
    "text": "Plain-text version"
  }
}`)}</pre></figure>
<div className="tw"><table><thead><tr><th>field</th><th>meaning</th></tr></thead><tbody><tr><td><code>email.subject</code></td><td>The subject line is required.</td></tr><tr><td><code>email.from</code>, <code>email.replyTo</code></td><td>This field contains the sender and the reply address.</td></tr><tr><td><code>email.to</code></td><td>This field contains the addresses or the name of the list it goes to.</td></tr><tr><td><code>email.preheader</code></td><td>This preview line appears after the subject in an inbox.</td></tr><tr><td><code>email.html</code></td><td>This field contains the rendered message as a path or URL, following the media source rules.</td></tr><tr><td><code>email.text</code></td><td>This field contains the plain-text version.</td></tr></tbody></table></div>
<p>Both formats use published JSON Schemas. An editor or a test can check each file before Aircheck reads it: <a href="https://aircheck.dev/schema/manifest.schema.json">aircheck.dev/schema/manifest.schema.json</a> and <a href="https://aircheck.dev/schema/config.schema.json">aircheck.dev/schema/config.schema.json</a>.</p>

<h2 id="media">Media sources</h2>
<p>A media entry identifies a source. The browser resolves the source, and the bytes do not pass through Aircheck. Your account stores manifests containing a few KB of JSON each. Your account stores no media. Aircheck has no upload or upload field.</p>
<div className="tw"><table><thead><tr><th>form</th><th>example</th><th>how the browser gets it</th></tr></thead><tbody><tr><td>relative path</td><td><code>&quot;slide-1.png&quot;</code></td><td>resolved against the JSON file&apos;s folder, then served by the local bridge</td></tr><tr><td>absolute path</td><td><code>&quot;/Users/you/out/slide-1.png&quot;</code></td><td>served by the local bridge</td></tr><tr><td>URL</td><td><code>&quot;https://cdn.you.com/slide-1.png&quot;</code></td><td>loaded directly from your storage</td></tr><tr><td>object</td><td><code>&#123; &quot;path&quot;: &quot;...&quot;, &quot;alt&quot;: &quot;...&quot; &#125;</code></td><td>same as above, with extras</td></tr></tbody></table></div>
<p>A page served over HTTPS cannot read <code>file://</code> paths. It can load <code>http://localhost</code>. The MCP server runs a media bridge on <code>127.0.0.1:3327</code>. The bridge serves a file only when its real path, after symlink resolution, is inside a folder listed in <code>mediaRoots</code>. The bridge serves files only to Aircheck origins.</p>
<h3 id="where">Where you keep media determines where you can review it</h3>
<p>Media on your disk is available for review from that machine because its bridge serves the files. Media in your own bucket is available from anywhere, including a phone, because the browser loads it directly from the bucket. Your storage choice determines this access.</p>
<p>Aircheck reports a named local file that is absent from disk as missing. It does not drop the file from the manifest. Aircheck shows a post with missing slides so you can fix it before sending.</p>

<h2 id="daily">See every day on aircheck.dev</h2>
<p>aircheck.dev shows what reached your account. A post reaches your account in one of two ways. When your agent calls <code>queue_post</code>, the MCP server syncs the manifest as it writes it, so the post appears at once.</p>
<p>Many setups already have jobs that write their own plan for the day and never call <code>queue_post</code>. Those setups can run <code>npx -y aircheck-mcp push</code> on a schedule. The command reads every source in your config for the day, as the app does, and sends the whole day to your account as manifests. Your media stays where it is. Add <code>--tomorrow</code> to send tomorrow as well, or add <code>--day YYYY-MM-DD</code> to send one day.</p>
<p>Run the command every hour. Each push replaces the previous copy of a manifest. A post that changed to <code>sent</code> updates on the next run, and another run never creates duplicates. The command needs <code>AIRCHECK_TOKEN</code> in its environment and exits 1 when it rejects a manifest, so your scheduler can report the failure.</p>
<figure className="code"><div className="cap">crontab -e</div><pre>{hl(`# every hour, at minute 5: today and tomorrow
5 * * * * AIRCHECK_TOKEN=<your token> npx -y aircheck-mcp push --tomorrow`)}</pre></figure>
<p>On macOS, you can use a launchd agent with <code>StartCalendarInterval</code> set to minute 5. From an agent, the <code>push_day</code> tool does the same work for one day.</p>

<h2 id="config">The config file</h2>
<p><code>aircheck.config.json</code> tells the MCP server where your lanes, queue and ad creatives are on your machine, which folders the media bridge may serve, and how to start an agent for Repair. The server checks <code>AIRCHECK_CONFIG</code>, then the working directory, then <code>~/.aircheck/</code>, <code>~/.config/aircheck/</code> and <code>~/</code>. Paths may start with <code>~</code>. The <code>configure</code> tool proposes a config file.</p>
<div className="tw"><table><thead><tr><th>field</th><th>meaning</th></tr></thead><tbody><tr><td><code>timezone</code></td><td>This IANA time zone decides which day a post belongs to, such as <code>America/New_York</code>.</td></tr><tr><td><code>lanes</code></td><td>This inline <code>&#123; &quot;source&quot;: &quot;static&quot;, &quot;items&quot;: [...] &#125;</code> list defines your lanes. Each lane has <code>id</code> matching <code>lane</code> in a manifest, <code>name</code>, and <code>platform</code>, and can have <code>handle</code>, <code>brief</code>, <code>formats</code>, and <code>logo</code>.</td></tr><tr><td><code>queue</code></td><td>Aircheck reads each day&apos;s manifests from <code>&#123; &quot;source&quot;: &quot;folder&quot;, &quot;dir&quot;: &quot;~/.aircheck/queue&quot; &#125;</code> at <code>&lt;dir&gt;/&lt;YYYY-MM-DD&gt;/*.json</code>. <code>queue_post</code> writes to the first folder.</td></tr><tr><td><code>ads</code></td><td>Aircheck reads ad creatives from <code>ad-folder</code> manifests with an <code>ad</code> block or from <code>ad-catalog</code> at <code>&lt;dir&gt;/&lt;product&gt;/&lt;run&gt;/catalog.json</code>. Leave this field empty to turn Ads off.</td></tr><tr><td><code>products</code></td><td>This <code>static</code> list defines what your posts and ads are about. Each product has <code>id</code>, <code>name</code>, <code>url</code>, and <code>repository</code>.</td></tr><tr><td><code>mediaRoots</code></td><td>The media bridge serves files only from these folders.</td></tr><tr><td><code>agents</code></td><td>Repair starts a headless agent with <code>default</code>, <code>timeoutMinutes</code>, <code>workspace</code>, and <code>commands</code>. <code>commands</code> contains an argument list per agent, with <code>&#123;prompt&#125;</code> and <code>&#123;workspace&#125;</code> filled in.</td></tr><tr><td><code>dataDir</code></td><td>Aircheck keeps its own files in this location. The default location is <code>~/.aircheck</code>.</td></tr></tbody></table></div>
<h3 id="logos">Lane logos</h3>
<p>A lane shows its platform icon until you give it a logo. Set a logo on your account page, or add <code>logo</code> to the lane in your config. The logo must be an absolute path inside <code>mediaRoots</code>, which the media bridge serves, or an https URL. Your account stores only the reference.</p>
<figure className="code"><div className="cap">aircheck.config.json</div><pre>{hl(`"lanes": {
  "source": "static",
  "items": [
    { "id": "brand-x", "name": "Brand on X", "platform": "x", "logo": "https://cdn.you.com/brand-mark.svg" }
  ]
}`)}</pre></figure>

<h2 id="tools">The MCP tools</h2>
<p>The MCP server runs on your machine. It is the only part of Aircheck that runs there. It writes manifests. It reads a day back. It proposes wiring. It re-runs a post&apos;s own pipeline. It serves the media bridge.</p>
<div className="tw"><table><thead><tr><th>tool</th><th>what it does</th></tr></thead><tbody><tr><td><code>queue_post</code></td><td>Write one manifest for a post the agent just queued, or a creative it just rendered (pass <code>ad</code>). Validates first and returns the problems instead of writing a bad file.</td></tr><tr><td><code>mark_sent</code></td><td>After a send, rewrite <code>status</code> and <code>postUrl</code>. A creative goes <code>live</code>. Every other field is preserved.</td></tr><tr><td><code>push_day</code></td><td>Send a whole day to your account from the sources in your config. Use this command when your jobs write their own plans instead of calling <code>queue_post</code>. You can repeat the command safely.</td></tr><tr><td><code>list_queue</code></td><td>Read a day back, with media resolved and every missing local file named.</td></tr><tr><td><code>configure</code></td><td>Read your setup and propose the wiring. Writes the config file only with <code>apply: true</code>.</td></tr><tr><td><code>repair</code></td><td>Start a re-run of one post&apos;s own pipeline on your machine. Returns a run id at once.</td></tr><tr><td><code>repair_status</code></td><td>How a repair run is doing, and its result once it is done.</td></tr><tr><td><code>check_post</code></td><td>Call right before a send. Returns the decision made on aircheck.dev (approved, held, changes or pending) and <code>send</code>. When <code>send</code> is false, do not post. A lane set to <code>review</code> in the config sends only approved posts.</td></tr><tr><td><code>keep_running</code></td><td>Install a macOS login item that keeps the media bridge running after the agent session closes. Pass <code>stop: true</code> to remove it.</td></tr></tbody></table></div>
<p>Repair re-runs your real pipeline on your machine. <code>repair</code> returns a run id immediately instead of blocking. A blocking render would hold the agent&apos;s conversation open. <code>repair_status</code> reports the run. Its result survives a server restart during the render.</p>
<p><code>configure</code> writes nothing without <code>apply: true</code>. With <code>apply: true</code>, it writes only the config file. It does not edit a posting job or run one to test the wiring. It does not touch <code>crontab</code>, <code>launchctl</code> or an Airflow trigger.</p>

<h2 id="skill">The setup skill</h2>
<p><code>aircheck-setup</code> is a Claude Code and Codex skill for the manual route. It reads the machine for posting jobs, including cron entries, launchd plists, Airflow DAGs, scripts that call a platform&apos;s publish API, and scripts that drive a browser on a platform&apos;s own site. It records where each job writes media. It proposes <code>aircheck.config.json</code>. It proposes the change each job needs to write one manifest per post. It shows every write as a diff. It applies a change only after you approve it. It never starts a posting job or changes what a job posts.</p>
<p>Its two helpers run independently and read only. <code>scan-setup.mjs</code> lists what posts on the machine and where each job writes. <code>check-queue.mjs</code> reads the queue folder as Aircheck does and exits 1 when a file is unusable.</p>
<a className="back" href="/"><i aria-hidden="true">←</i>Back to Aircheck</a>
      </main><DocsAside /></div>
      <SiteFooter />
    </>
  );
}
