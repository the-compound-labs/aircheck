# Run Aircheck yourself

Aircheck has three free deployment options. Choose where the day should appear.

## On this machine

Clone the repository, install dependencies and start the local app on port 3326. It reads ~/.aircheck/queue with no config file, account or network. Copy aircheck.config.example.json to aircheck.config.json to name your own lanes, queue folders and media folders.

```sh
git clone https://github.com/the-compound-labs/aircheck
cd aircheck
npm install
npm run dev        # http://localhost:3326
```

## Your own Worker

The hosted app runs on Cloudflare Workers through OpenNext and stores accounts in Supabase. Apply the migrations in supabase/migrations to your Supabase project. Copy wrangler.example.jsonc to wrangler.jsonc, fill in your host and Supabase URL, set the listed secrets, then build and deploy. Mail and measurement remain off until you set their keys.

```sh
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx opennextjs-cloudflare build
npx wrangler deploy
```

## Install the MCP server

Every client runs the same entry: npx -y aircheck-mcp. Add AIRCHECK_TOKEN only when you use a hosted account.

```sh
claude mcp add aircheck -s user -- npx -y aircheck-mcp@latest
codex mcp add aircheck -- npx -y aircheck-mcp@latest
```

```json
{ "mcpServers": { "aircheck": { "command": "npx", "args": ["-y", "aircheck-mcp@latest"] } } }
```

## First run

Ask your agent to set up Aircheck. The configure tool scans your posting jobs and proposes a config and the change each job needs. It writes nothing until you approve each change.

## Keep it running

The keep_running tool installs a macOS login item that keeps the media bridge running. On Linux, run npx -y aircheck-mcp serve from a systemd user service or your session startup. Windows has no login item yet.

Aircheck runs on macOS, Linux and Windows. macOS supports everything. Linux supports the app and MCP server, but you must start the bridge yourself. Windows supports the app and MCP server, but CI has not tested Windows.

## Upgrade or uninstall

npx -y aircheck-mcp@latest always runs the newest server. For the app, pull the repository and run npm install again. To uninstall, remove the aircheck entry from your MCP client, run `npx -y aircheck-mcp stop-running` if you used keep_running, and delete ~/.aircheck.
