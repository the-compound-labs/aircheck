<div align="center">

<img src="public/aircheck-mark.svg" width="72" height="72" alt="Aircheck">

# Aircheck

Aircheck is an open-source review screen for posts queued by AI agents and scheduled jobs. It shows the day's posts and media before anything goes out.

[Website](https://aircheck.dev) · [Docs](https://aircheck.dev/docs) · [Self-host](docs/self-host.md) · [Install the MCP server](mcp/README.md)

[![npm](https://img.shields.io/npm/v/aircheck-mcp?label=aircheck-mcp)](https://www.npmjs.com/package/aircheck-mcp)
[![License](https://img.shields.io/badge/license-MIT%20%C2%B7%20AGPL--3.0-blue)](#license)
[![CI](https://github.com/the-compound-labs/aircheck/actions/workflows/ci.yml/badge.svg)](https://github.com/the-compound-labs/aircheck/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/the-compound-labs/aircheck?style=flat)](https://github.com/the-compound-labs/aircheck/stargazers)

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-111111?logo=cursor)](https://cursor.com/en/install-mcp?name=aircheck&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImFpcmNoZWNrLW1jcEBsYXRlc3QiXX0%3D)
[![Add to VS Code](https://img.shields.io/badge/Add%20to-VS%20Code-0078d4?logo=visualstudiocode)](https://insiders.vscode.dev/redirect/mcp/install?name=aircheck&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22aircheck-mcp%40latest%22%5D%7D)

<img src="public/landing-assets/img/v8/today.png" width="880" alt="Aircheck Today: every queued post for the day with its media">

</div>

❌ Without Aircheck, agents and cron jobs queue posts without a review screen. A missing slide, incorrect caption or reordered carousel may be found only after publication.

✅ With Aircheck, one screen shows every queued post for the day with its images and video. You can preview, revise or repair a post before publication. Aircheck never posts, and your media stays on your machine.

Aircheck runs in front of any scheduler or posting job. A job writes one JSON manifest for each post into a dated queue folder, or a plugin reads the scheduler's own queue. The local app shows the day. The MCP server lets Claude Code, Codex, Cursor or any MCP client queue posts, read the day and re-run a post's own pipeline with a local headless agent.

## Quickstart

Add the MCP server to your agent and start the local app. Neither requires an account.

```sh
claude mcp add aircheck -s user -- npx -y aircheck-mcp@latest   # or: codex mcp add aircheck -- npx -y aircheck-mcp@latest
git clone https://github.com/the-compound-labs/aircheck
cd aircheck
npm install
npm run dev        # http://localhost:3326
```

Without a config file, the app reads `~/.aircheck/queue`, serves media from `~/.aircheck` and runs `claude` or `codex` from your PATH. `mcp/README.md` covers every MCP client.

## What is hosted

This repository contains the web app, the Cloudflare Worker, the database migrations and the MCP server. aircheck.dev runs the same code as an optional hosted account. It stores accounts and the JSON manifests your machine syncs, but never media. The aircheck.dev build also enables product analytics and ad measurement described in its privacy policy. A build you make yourself sends neither.

## How data flows

1. An agent or a job queues a post. The MCP server or the job itself writes one JSON manifest for the post into `<queue>/<YYYY-MM-DD>/`.
2. The MCP server syncs each manifest to the account through `POST /api/sync` when `AIRCHECK_TOKEN` is set.
3. The local app reads lanes, products, the queue and ads from the sources named in `aircheck.config.json`. The hosted app reads the manifests that the account holds.
4. Media never leaves your machine. A manifest holds a reference to each file. The browser loads a local file from the media bridge on `127.0.0.1:3327` and loads a URL from your own storage.

The Worker serves the landing page at `/` to a signed-out visitor and Today at `/` to a signed-in one. It redirects the hosts in `AIRCHECK_REDIRECT_HOSTS` and applies rate limits before a request reaches the database (`worker/admission.mjs`).

## The manifest

Each queued post has one JSON file in a dated folder:

```
<queue>/<YYYY-MM-DD>/<anything>.json
```

```json
{
  "lane": "brand-x",
  "at": "2026-11-07T15:30:00Z",
  "kind": "carousel",
  "text": "Post copy as it will go out",
  "media": ["slide-1.png", "https://cdn.you.com/slide-2.png"],
  "status": "queued",
  "postUrl": null
}
```

`lane` is the only required field. `status` is `queued`, `sent`, `held` or `failed`. A manifest that does not validate appears in the app as a failed post with its errors.

A `media` entry is a relative path, an absolute path, a URL or an object such as `{ "path": "...", "alt": "..." }`. The app reports a local file that is not on disk as missing.

`docs/aircheck-spec.md` holds the full manifest and ad creative schema. `public/schema/` holds the JSON Schemas for the manifest and the config.

## Config

`aircheck.config.json` names where the local app reads from. `aircheck.config.example.json` is a starting point. Without a config file, the app reads `~/.aircheck/queue`, serves media from `~/.aircheck` and runs `claude` or `codex` from your PATH.

| Key | What it is |
| --- | --- |
| `lanes` | The app reads `static` or `ad-accounts`, or a source that a plugin adds. |
| `products` | A preview can use `static` or a source that a plugin adds. |
| `queue` | The app reads `folder` or sources that plugins add for a day. |
| `ads` | The app reads ad creative from `ad-catalog` and `ad-folder`, or from sources that plugins add. |
| `plugins` | Plugins are ES modules that add sources by name. See Plugins below. |
| `account` | The account that manifests sync to. It never holds media. |
| `mediaRoots` | The only folders `/api/media` serves files from, plus `dataDir`. |
| `agents` | The config names the workspace paths and the command for each headless agent. `rules` and `adRules` add your own house rules to every preview prompt. |
| `dataDir` | Where preview runs are kept. The default is `~/.aircheck`. |

## Plugins

A source that Aircheck does not ship, such as your own planner or ad pipeline, is a plain ES module named under plugins in the config. It adds lane, product, queue or ad sources by name and can let Repair replace the rows it reads. src/server/plugins.ts documents the interface.

## Routes

| Route | What it serves |
| --- | --- |
| `/` | Today for a signed-in user or a local install. The landing page for a signed-out visitor on aircheck.dev. |
| `/lanes`, `/lanes/[id]`, `/runs` | Social lanes, one lane's studio, and preview runs. |
| `/ads`, `/ads/lanes`, `/ads/lanes/[id]`, `/ads/runs` | Ad creative review. |
| `/email`, `/email/lanes`, `/email/lanes/[id]`, `/email/runs` | Email review. |
| `/account` | Machine tokens and account settings. |
| `/demo` | The Today view on a sample day. The landing page shows it. |
| `/home` | The landing page route. |
| `/docs`, `/about`, `/contact`, `/privacy`, `/terms`, `/guides/preview-agent-queued-social-posts` | Reader pages. |
| `/api/auth`, `/api/auth/google`, `/api/auth/callback` | Sign up, sign in, sign out, password reset and Google sign-in. |
| `/api/tokens`, `/api/sync` | Machine tokens and manifest sync. |
| `/api/queue`, `/api/ads`, `/api/studio`, `/api/lanes/logo`, `/api/media` | Data for the app views. |
| `/api/runs` and `/api/runs/[id]` with `revise`, `replace` and `undo` | Preview runs. |
| `/api/ads-conversion` | Ad conversion reporting. |

## Repo layout

- `src/app/(app)/` holds the signed-in app. `src/app/(site)/` holds the landing and reader pages. `src/app/api/` holds the API routes.
- `src/server/` holds config, sources, plugins, manifests, accounts, auth, mail and preview runs.
- `src/components/` and `src/lib/` hold the UI.
- `mcp/` holds the MCP server, the media bridge and their tests. `mcp/README.md` explains how to add the server to Claude Code or Codex.
- `skills/aircheck-setup/` holds the skill that wires an existing posting setup by hand.
- `worker/` holds the Cloudflare Worker entry and its admission rules.
- `scripts/` holds the MCP bundle script, the day push script and the MCP smoke test.
- `supabase/migrations/` holds the database schema.
- `tests/` holds the Node tests.
- `public/landing-assets/` holds the landing images. `public/mail/` holds the images the account emails load.

## Run

```sh
npm install
npm run dev        # http://localhost:3326
```

The MCP server starts the media bridge on `127.0.0.1:3327` while your agent session runs. Run `npx -y aircheck-mcp keep-running` on macOS to keep the bridge up without a session. On Linux, run `npx -y aircheck-mcp serve` from your own service manager.

## Self-hosting

Run the local app from this checkout, or deploy the hosted app to your own Cloudflare Worker and Supabase project. docs/self-host.md covers both options.

## Test

```sh
npm run typecheck
npm run lint
npm test
```

See docs/self-host.md to run the hosted app on your own Cloudflare account. CI runs on every pull request.

## Contributing

Run npm test before opening a pull request. Scheduler adapters, starting with Postiz, keep_running support for Linux and Windows, and the manifest spec need help. See CONTRIBUTING.md and SECURITY.md.

## License

The web app and the Worker in src/ and worker/ use AGPL-3.0. The MCP server in mcp/, the setup skill in skills/ and the JSON schemas in public/schema/ use MIT. Neither license covers the Aircheck or Compound Labs names and marks. See NOTICE.

---

Built by Compound Labs. [thecompound.tech](https://thecompound.tech)
