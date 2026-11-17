# The Aircheck MCP server

It runs on your machine. No other part of Aircheck does.

Your agent queues a post, and this server writes the manifest Aircheck reads. It marks the post
sent afterward and reads a day back. It proposes wiring for a setup that already posts. It re-runs
one post's own pipeline when something comes out wrong. It also serves the local media bridge, so
a page on `https://aircheck.dev` can show a slide stored on your disk.

**Your media never leaves your machine.** What reaches the Aircheck account is a manifest, a few KB
of JSON naming the lane, time, copy, status and a *reference* to each file.
This server never reads image or video bytes for upload. Aircheck never sends or stores those
bytes. When the page displays a local file, it requests the bridge on `127.0.0.1`. The bridge
serves the file only when its resolved path, including symlinks, is inside a folder listed in
`mediaRoots`. It serves files only to Aircheck origins. Your browser loads media in your own
bucket directly from that bucket. Aircheck has no upload path or upload field.

## Add it

### Claude Code

Under `mcpServers`, paste this into `~/.claude.json` (global) or `.mcp.json` in a project:

```json
{
  "mcpServers": {
    "aircheck": {
      "command": "npx",
      "args": ["-y", "aircheck-mcp"],
      "env": {
        "AIRCHECK_TOKEN": "<your token>",
        "AIRCHECK_CONFIG": "/Users/you/.aircheck/aircheck.config.json"
      }
    }
  }
}
```

### Codex

`~/.codex/config.toml` takes the same three things:

```toml
[mcp_servers.aircheck]
command = "npx"
args = ["-y", "aircheck-mcp"]
env = { AIRCHECK_TOKEN = "<your token>", AIRCHECK_CONFIG = "/Users/you/.aircheck/aircheck.config.json" }
```

Or let the CLI write it:

```sh
codex mcp add aircheck --env AIRCHECK_TOKEN=<your token> --env AIRCHECK_CONFIG=/Users/you/.aircheck/aircheck.config.json -- npx -y aircheck-mcp
```

### Cursor, VS Code and Claude Desktop

The connect dialog on aircheck.dev provides an install button for Cursor and VS Code. It provides JSON for Claude Desktop and any other MCP client. Every client uses the same entry: `npx -y aircheck-mcp@latest` with `AIRCHECK_TOKEN` and `AIRCHECK_CONFIG` in its environment.

Copy `AIRCHECK_TOKEN` from your account page at https://aircheck.dev/account. When the token is set, the server syncs every manifest it writes to your Aircheck account, and the day appears when you sign in at https://aircheck.dev. Without a token, manifests stay on your machine.

`AIRCHECK_CONFIG` is optional. Without it, the server
checks for `aircheck.config.json` in the working directory, then `~/.aircheck/`, then
`~/.config/aircheck/`, then `~/`. Set `AIRCHECK_CONFIG` because an MCP server uses the client's
current working directory.

Ask the agent to set up Aircheck. It calls `configure`, shows you a proposed config and the change
required by each posting job, and writes nothing until you approve.

## See every day on aircheck.dev

aircheck.dev shows what reached your account. A post reaches your account in one of two ways. When your agent calls `queue_post`, the MCP server syncs the manifest as it writes it, so the post appears at once.

Many setups already have jobs that write their own plan for the day and never call `queue_post`. Those setups can run `npx -y aircheck-mcp push` on a schedule. The command reads every source in your config for the day, as the app does, and sends the whole day to your account as manifests. Your media stays where it is. Add `--tomorrow` to send tomorrow as well, or add `--day YYYY-MM-DD` to send one day.

Run the command every hour. Each push replaces the previous copy of a manifest. A post that changed to `sent` updates on the next run, and another run never creates duplicates. The command needs `AIRCHECK_TOKEN` in its environment and exits 1 when it rejects a manifest, so your scheduler can report the failure.

```sh
# crontab -e: every hour, at minute 5, today and tomorrow
5 * * * * AIRCHECK_TOKEN=<your token> npx -y aircheck-mcp push --tomorrow
```

On macOS, you can use a launchd agent with `StartCalendarInterval` set to minute 5. From an agent, the `push_day` tool does the same work for one day.

Both formats use published JSON Schemas. An editor or a test can check each file before Aircheck reads it: https://aircheck.dev/schema/manifest.schema.json and https://aircheck.dev/schema/config.schema.json.

## The tools

| tool | what it does |
| --- | --- |
| `queue_post` | Writes one manifest into `<queue>/<YYYY-MM-DD>/<id>.json`. The day comes from `at` in the configured timezone. Validates first: a manifest with no `lane`, an unparseable `at` or a media entry with neither `path` nor `url` comes back as a list of problems and nothing is written. Returns the file path and the id. Call it when the post is **built**, not when it is sent — the queue's whole job is showing what goes out today, before it goes out. |
| `mark_sent` | Takes an `id` or a `path`, and rewrites `status` (default `sent`) and `postUrl`. The file is read, patched and re-serialized, so every other field survives exactly — key order included. A send is allowed to change two things. |
| `push_day` | Send a whole day to your account from the sources in your config. Use this command when your jobs write their own plans instead of calling `queue_post`. You can repeat the command safely. |
| `list_queue` | Returns a day's manifests as structured data: each one's media resolved to absolute paths or URLs, every local file the manifest names that is not on disk, and any file in the folder that does not parse. Defaults to today in the configured timezone. |
| `configure` | Reads the setup and **proposes** the wiring: where your config is (or exactly what to write when there is none), the posting jobs visible on this machine, a proposed `aircheck.config.json`, and the change each job needs. Writes nothing unless you pass `apply: true` — and even then it writes only the config file. |
| `repair` | Starts a re-run of one post's own pipeline locally. Spawns the agent from `agents.commands` in a fresh folder under `<dataDir>/runs/<id>/` and returns a run id straight away — it does not block, because an MCP call that waits out a render holds your whole conversation open. Pass `wait: true` for a repair you expect to be quick. |
| `repair_status` | How a run is doing, and its result once it is done. A run whose process is gone is finished from what it left in `out/`, so a result survives this server restarting mid-render. |

### What `configure` will not do

It mirrors `skills/aircheck-setup/SKILL.md` and keeps its refusals:

- It never writes anything without `apply: true`.
- Even with `apply: true`, it writes **the config file and nothing else**. It never edits, reformats
or reschedules a posting job. Those files post to real accounts. A broken file posts incorrectly
or posts twice. The server describes the change each job needs for a person to apply and review.
- It never runs a posting job to test the wiring, and never touches `crontab`,
`launchctl load/unload` or an Airflow trigger starts the schedule. You control scheduling.
- It proposes, per job, the same thing the skill does: write the manifest when the post is built,
The job rewrites it after the send. With this server connected, the job makes two tool calls and
does not change.

Approve the config and each job change separately. Read each proposal before accepting it.

### What `repair` will not do

The run folder contains `prompt.md`, which records exactly what the agent was told, `agent.log`,
and `out/`. The prompt contains the app's own hard limits word for word:

> Never post, send, publish, schedule, upload or arm anything. Never touch ARMED flags, posted.json,
> cadence, state, ledger, queue or plan files. Never call a paid API. Never open a browser session
> that is signed in to a social account. Write files only inside `<the run folder's out/>`.

The agent uses the run folder as its working directory. Repair does not change the queued
manifest. The rebuilt files go into `out/` for review. Replacing the queued files is a separate
deliberate action.

## The media bridge

`mcp/bridge.mjs` starts with the server on `127.0.0.1:3327` by default.

```
GET /media?p=<absolute path>
```

- It serves a file only when the allow-list in `src/server/media.ts` would: resolve symlinks on both
The server resolves the file and each root. It then requires the real file to be inside a
configured `mediaRoot` or the `dataDir`. `..` cannot escape because `realpath` has already
flattened the path. A symlink that points outside a root resolves to its target and fails. Every
other failure returns a bare `403`.
- `Content-Type` comes from the extension, from the same table the app uses.
- CORS is scoped by exact origin match, defaulting to `https://aircheck.dev` and
The bridge uses `http://localhost:3326`. It has no wildcard, because a wildcard would let any
internet page read every file under your media roots. It answers `OPTIONS` as a preflight.
- `Range` is supported, so video scrubs.

Run or configure it on its own:

```sh
node mcp/bridge.mjs
```

| knob | default |
| --- | --- |
| `AIRCHECK_BRIDGE_PORT` / `bridge.port` | `3327` |
| `AIRCHECK_BRIDGE_HOST` / `bridge.host` | `127.0.0.1` |
| `AIRCHECK_BRIDGE_ORIGINS` / `bridge.origins` | `https://aircheck.dev,http://localhost:3326` |
| `AIRCHECK_BRIDGE=off` | start the MCP server without the bridge |

`GET /health` reports the roots and origins actually in force, which is the fastest way to find out
why an image is 403ing: the folder is not in `mediaRoots`.

## Config

The server reads the same `aircheck.config.json` as the app. It reads the file fresh on every tool
call, so edits require no restart. It uses these keys:

| key | what it is |
| --- | --- |
| `queue` | the sources read for a day. The manifest writer uses the first `{ "source": "folder", "dir": … }`, falling back to `<dataDir>/queue` |
| `mediaRoots` | the only folders the bridge will serve from (plus `dataDir`). List real paths — symlinks are resolved |
| `dataDir` | where repair runs are kept. Default `~/.aircheck` |
| `timezone` | which day an `at` belongs to. Defaults to the system zone |
| `agents.commands` | argv templates per agent; `{prompt}`, `{workspace}` and `{out}` are substituted |
| `agents.default`, `agents.timeoutMinutes`, `agents.workspace` | which agent `repair` runs, how long it may take, where the pipelines live |
| `bridge.port`, `bridge.host`, `bridge.origins` | the bridge, as above |

## Tests

```sh
node --test mcp/*.test.mjs
```

The tests check that a `queue_post` manifest round-trips through the app's reader byte for byte.
They check that `mark_sent` preserves every other field. They check that the bridge refuses paths
outside the roots directly, through `..`, and through a symlink. They check that CORS allows only
an Aircheck origin and that the bridge answers a preflight. They check that `Range` works. They
check that `configure` writes nothing without `apply: true`.

## Approve before it sends

On aircheck.dev, every queued post can be approved, held, or sent back with a note. Your posting job reads that decision with `check_post` right before it sends. When `send` is false, it does not post. When the decision is `changes`, `note` says what to fix.

Each lane has a policy in the config. The `auto` policy is the default. It sends a post that nobody has reviewed unless someone held it or sent it back.

The `review` policy sends only posts that someone approved.

```json
"review": { "default": "auto", "lanes": { "founder-x": "review" } }
```

## Keep it running

The server and the bridge that shows your images on aircheck.dev run while an agent session is open. To keep them running after the session closes, ask your agent to call `keep_running`. On macOS, `keep_running` installs a login item that runs `npx -y aircheck-mcp serve` with the same token and config. Call `keep_running` with `stop: true` to remove the login item.
