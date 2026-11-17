import type { Metadata } from 'next';
import '../../docs.css';
import { SiteFooter, SiteHeader } from '../../chrome';
import { DocsNav, type DocGroup } from '../DocsNav';
import { ClientTabs, DocsAside } from '../DocsAside';
import { hl } from '../hl';
import { REPO, SELF_HOST_SOURCE } from '@/lib/project';

/* /docs/self-host: the three free ways to run Aircheck, the MCP install per client, the first run,
 * keeping the bridge up, platform support, and upgrade and uninstall. */
const T = {
  title: "Run Aircheck yourself",
  lede: "Aircheck has three free deployment options. Choose where the day should appear.",
  localH: "On this machine", localP: "Clone the repository, install dependencies and start the local app on port 3326. It reads ~/.aircheck/queue with no config file, account or network. Copy aircheck.config.example.json to aircheck.config.json to name your own lanes, queue folders and media folders.",
  workerH: "Your own Worker", workerP: "The hosted app runs on Cloudflare Workers through OpenNext and stores accounts in Supabase. Apply the migrations in supabase/migrations to your Supabase project. Copy wrangler.example.jsonc to wrangler.jsonc, fill in your host and Supabase URL, set the listed secrets, then build and deploy. Mail and measurement remain off until you set their keys.",
  mcpH: "Install the MCP server", mcpP: "Every client runs the same entry: npx -y aircheck-mcp. Add AIRCHECK_TOKEN only when you use a hosted account.",
  firstH: "First run", firstP: "Ask your agent to set up Aircheck. The configure tool scans your posting jobs and proposes a config and the change each job needs. It writes nothing until you approve each change.",
  keepH: "Keep it running", keepP: "The keep_running tool installs a macOS login item that keeps the media bridge running. On Linux, run npx -y aircheck-mcp serve from a systemd user service or your session startup. Windows has no login item yet.",
  platforms: "Aircheck runs on macOS, Linux and Windows. macOS supports everything. Linux supports the app and MCP server, but you must start the bridge yourself. Windows supports the app and MCP server, but CI has not tested Windows.",
  upgradeH: "Upgrade or uninstall", upgradeP: "npx -y aircheck-mcp@latest always runs the newest server. For the app, pull the repository and run npm install again. To uninstall, remove the aircheck entry from your MCP client, run `npx -y aircheck-mcp stop-running` if you used keep_running, and delete ~/.aircheck.",
  edit: "Edit this page on GitHub",
};

const description = T.lede;
export const metadata: Metadata = {
  title: `${T.title} · Aircheck`,
  description,
  alternates: { canonical: 'https://aircheck.dev/docs/self-host' },
  robots: { index: true, follow: true },
  openGraph: { title: T.title, description, url: 'https://aircheck.dev/docs/self-host' },
  twitter: { card: 'summary_large_image' },
};

const LOCAL = `git clone ${REPO}
cd aircheck
npm install
npm run dev        # http://localhost:3326`;
const WORKER = `cp wrangler.example.jsonc wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx opennextjs-cloudflare build
npx wrangler deploy`;
const ENTRY = `{
  "mcpServers": {
    "aircheck": {
      "command": "npx",
      "args": ["-y", "aircheck-mcp@latest"]
    }
  }
}`;
const TOML = `[mcp_servers.aircheck]
command = "npx"
args = ["-y", "aircheck-mcp@latest"]`;
const VSCODE = `{
  "servers": {
    "aircheck": {
      "command": "npx",
      "args": ["-y", "aircheck-mcp@latest"]
    }
  }
}`;

const GROUPS: DocGroup[] = [
  { label: 'Self-host', items: [{ id: 'local', label: T.localH }, { id: 'worker', label: T.workerH }] },
  { label: 'MCP server', items: [{ id: 'mcp', label: T.mcpH }, { id: 'first', label: T.firstH }, { id: 'keep', label: T.keepH }, { id: 'upgrade', label: T.upgradeH }] },
];

export default function SelfHost() {
  return (
    <>
      <SiteHeader title={T.title} lede={T.lede} />
      <div className="dc"><DocsNav groups={GROUPS} />
      <main className="rd-main dc-main">
<h2 id="local">{T.localH}</h2>
<p>{T.localP}</p>
<figure className="code"><div className="cap">terminal</div><pre>{hl(LOCAL)}</pre></figure>

<h2 id="worker">{T.workerH}</h2>
<p>{T.workerP}</p>
<figure className="code"><div className="cap">terminal</div><pre>{hl(WORKER)}</pre></figure>

<h2 id="mcp">{T.mcpH}</h2>
<p>{T.mcpP}</p>
<ClientTabs tabs={[
  { id: 'claude', label: 'Claude Code', img: '/claude.svg', cap: 'terminal', code: hl('claude mcp add aircheck -s user -- npx -y aircheck-mcp@latest') },
  { id: 'codex', label: 'Codex', img: '/openai.svg', cap: '~/.codex/config.toml', code: hl(TOML) },
  { id: 'cursor', label: 'Cursor', cap: '~/.cursor/mcp.json', code: hl(ENTRY) },
  { id: 'vscode', label: 'VS Code', cap: '.vscode/mcp.json', code: hl(VSCODE) },
  { id: 'desktop', label: 'Claude Desktop', img: '/claude.svg', cap: 'claude_desktop_config.json', code: hl(ENTRY) },
]} />

<h2 id="first">{T.firstH}</h2>
<p>{T.firstP}</p>

<h2 id="keep">{T.keepH}</h2>
<p>{T.keepP}</p>
<p>{T.platforms}</p>

<h2 id="upgrade">{T.upgradeH}</h2>
<p>{T.upgradeP}</p>

<p><a href={SELF_HOST_SOURCE}>{T.edit}</a></p>
      </main><DocsAside />
      </div>
      <SiteFooter />
    </>
  );
}
