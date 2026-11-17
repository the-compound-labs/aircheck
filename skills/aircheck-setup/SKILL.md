---
name: aircheck-setup
description: Wire an existing posting setup into Aircheck, the local studio for agent-run social lanes. Reads the machine for the jobs that actually post (cron, launchd plists in ~/Library/LaunchAgents, Airflow DAGs, agent loops, any script that hits a platform API or drives a browser to post), finds where each one writes its media, then proposes the aircheck.config.json for that setup and the one-line change each job needs to drop one JSON file per post into <queue>/<YYYY-MM-DD>/. Every write is shown as a diff and applied only after the user approves that specific change. Use when someone says "set up Aircheck", "wire my posting jobs into Aircheck", "Aircheck shows nothing", "my queue is empty", "why is the timeline blank", "add a lane", "where do I put the queue files", or asks what their aircheck.config.json should look like. Aircheck never posts — the job still posts.
---

# aircheck-setup — read the setup, suggest the wiring, apply only with permission

Aircheck (your checkout, written `<aircheck>` below; `npm run dev`, port 3326) reads two things off disk: a
**config** that names where lanes, products, media and the day's queue come from, and a **queue**
of one JSON file per post. The local app needs no database and no account. It never posts.

This skill's whole job is to make those two things true for a setup that already posts.

Run it in this order. Do not skip ahead to step 3.

---

## Step 1 — READ the setup

```bash
node <aircheck>/skills/aircheck-setup/scan-setup.mjs
node <aircheck>/skills/aircheck-setup/scan-setup.mjs --json          # same scan, machine-readable
node <aircheck>/skills/aircheck-setup/scan-setup.mjs --root ~/work   # extra code roots
```

Read-only. It writes nothing, starts nothing, and makes no network call. It reports:

| source | what it reads |
|---|---|
| cron | `crontab -l`, each non-comment entry and its command |
| launchd | every plist in `~/Library/LaunchAgents`, `/Library/LaunchAgents`, `/Library/LaunchDaemons` via `plutil -convert json`, with `Label`, `ProgramArguments`, schedule, `StandardOutPath` |
| Airflow | `$AIRFLOW_HOME/dags`, `~/airflow/dags` and any `*/dags/` under the code roots — dag ids, task ids, schedule |
| posting scripts | files under the code roots that hit a platform **publish** surface (`api.x.com/2/tweets`, `api.linkedin.com/{v2,rest}/ugcPosts`, `com.atproto.repo.createRecord`, `graph.facebook.com/…/media_publish`, `graph.threads.net/…/threads`, `/api/v1/statuses`, YouTube `videos.insert`, `oauth.reddit.com/api/submit`, …), or drive Playwright/Puppeteer/Selenium **on a platform's own site** with page actions and posting words |

The script side is a heuristic, not an oracle. It skips `node_modules`, `.git`, build output,
`design-reviews/`, `public/`, `docs/` and test directories, requires a file to actually run
something (`fetch`, `axios`, `requests.post`, `subprocess`, a shebang) and ignores comment lines —
but on a large tree it still lists reading/deleting/metrics code next to the real senders. Read the
evidence line it prints, and narrow with `--root <the one repo that posts>`. It prints at most 40
and says how many more; `--json` has all of them.

For each posting script it also prints the directory- and file-shaped strings nearby — that is the
**media root candidate**. Confirm it by looking, not by guessing:

```bash
ls -la <candidate dir> | head
```

Then say back to the user, in a table, before proposing anything:

- each job: how it is scheduled, the file that posts, the platform, the account/lane it posts as
- where that job writes its images, slides, or video
- which jobs the scan could not classify, and ask about those by name

If the scan finds nothing, ask where the posting job lives. Never invent a lane or a path.

## Step 2 — SUGGEST the wiring

Two artifacts, both shown in full as text first, neither written yet.

### 2a. `aircheck.config.json`

Keys, from the repo README:

| key | what it is |
|---|---|
| `lanes` | `{ "source": "static", "items": [...] }` — one item per real account. `{ id, name, platform, handle, formats, brief }`. `formats` may be plain strings. `platform` must be one of `x`, `linkedin`, `bluesky`, `threads`, `instagram`, `facebook`, `youtube`, `tiktok`, `peerlist`, `reddit`, `hackernews`, `substack`; anything else is read as `other` and the lane is **dropped**. |
| `products` | what a preview can be about: `{ "source": "static", "items": [{ id, name, url, repository }] }` |
| `queue` | a list of sources read for a day. The portable one is `{ "source": "folder", "dir": "~/.aircheck/queue" }` |
| `mediaRoots` | the only folders `/api/media` will serve from (plus `dataDir`). Media outside them renders broken. |
| `agents.commands` | argv templates per agent; `{prompt}`, `{workspace}` and `{out}` are substituted |
| `agents.workspace` | where the lane pipelines live — the agent is told to read them there |
| `dataDir` | where preview runs are kept, default `~/.aircheck` |

Fill it from step 1, not from the example. A config for a setup with two launchd posters, slides
rendered into `~/code/social/out`, and Claude as the agent:

```json
{
  "dataDir": "~/.aircheck",
  "timezone": "America/New_York",
  "lanes": {
    "source": "static",
    "items": [
      { "id": "brand-x", "name": "Brand on X", "platform": "x", "handle": "@yourbrand", "formats": ["text", "image"], "brief": "Short product posts with one screenshot." },
      { "id": "brand-linkedin", "name": "Brand on LinkedIn", "platform": "linkedin", "handle": "Your Brand", "formats": ["carousel"], "brief": "Five-slide carousels." }
    ]
  },
  "products": {
    "source": "static",
    "items": [{ "id": "widget", "name": "Widget", "url": "https://example.com", "repository": "~/code/widget" }]
  },
  "queue": [{ "source": "folder", "dir": "~/.aircheck/queue" }],
  "mediaRoots": ["~/.aircheck", "~/code/social/out"],
  "agents": {
    "default": "claude",
    "timeoutMinutes": 20,
    "workspace": "~/code/social",
    "commands": {
      "claude": ["claude", "-p", "{prompt}", "--permission-mode", "acceptEdits", "--add-dir", "{workspace}"],
      "codex": ["codex", "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "{prompt}"]
    }
  }
}
```

Rules that bite:

- **`lanes[].id` must equal the `lane` value the job writes.** A queue file whose `lane` matches no
  configured lane shows up unattached. Pick the id the job already knows (its account id), and use it
  on both sides.
- **Every directory a job writes media into must be in `mediaRoots`**, or the post renders with a
  broken image. Symlinks are resolved, so list the real path.
- Paths may start with `~`. The config is re-read on every request, so an edit needs no restart.
- `AIRCHECK_CONFIG` can point at a config outside the checkout, such as `~/.aircheck/aircheck.config.json`. Prefer that config over one inside the checkout, so a git pull never touches it.

### 2b. The one-line change per posting job

The contract, exactly as the README defines it: **one JSON file per post** in
`<queue>/<YYYY-MM-DD>/`, any filename ending `.json`.

```json
{
  "lane": "brand-x",
  "at": "2026-11-06T15:30:00Z",
  "kind": "carousel",
  "text": "Post copy as it will go out",
  "media": ["slide-1.png", "slide-2.png"],
  "status": "queued",
  "postUrl": null
}
```

- `lane` — required. **A file with no `lane` is skipped silently.**
- `at` — ISO timestamp of when it goes out. Missing `at` sorts last and shows no time.
- `kind` — free text (`text`, `image`, `carousel`, `video`, `longform`, …). Omitted, it is derived:
  more than one media → `carousel`, one → `image`, none → `text`.
- `text` — the copy as it will actually go out, not a summary.
- `media` — paths relative to the JSON file, or absolute. A path not on disk is dropped, so the post
  shows with no image.
- `status` — `queued`, `sent`, `held` or `failed`. Omitted, read as `queued`.
- `postUrl` — `null` until sent, then the permalink.

Write the file **when the post is built**, not when it is sent — that is the point: the queue shows
what goes out today, before it goes out.

Then, **after sending, the job rewrites the same file** with `status: "sent"` and the `postUrl`. The
job owns the file's whole life. Aircheck only reads it.

#### Worked example — patching a poster

A Node job that renders slides and posts them:

```js
// ~/code/social/post-linkedin.mjs  (before)
const slides = await renderCarousel(story);          // writes ~/code/social/out/<id>/slide-N.png
const text = await copyFor(story);
const res = await postCarousel({ text, slides });    // ← the only thing that posts
console.log('posted', res.url);
```

The patch. Two calls to one helper — one before the post, one after:

```js
// ~/code/social/post-linkedin.mjs  (after)
import { queuePost, markSent } from './aircheck-queue.mjs';

const slides = await renderCarousel(story);
const text = await copyFor(story);

const queued = queuePost({                            // ① the post is visible before it goes out
  lane: 'brand-linkedin',
  at: story.sendAt,                                   // ISO 8601
  kind: 'carousel',
  text,
  media: slides,                                      // absolute paths are fine
});

const res = await postCarousel({ text, slides });     // unchanged — the job still posts
markSent(queued, res.url);                            // ② status → sent, postUrl set
console.log('posted', res.url);
```

And the helper, written once per setup (adapt the `QUEUE` constant to the configured `queue[].dir`):

```js
// ~/code/social/aircheck-queue.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const QUEUE = path.join(os.homedir(), '.aircheck', 'queue');

export function queuePost({ lane, at, kind, text, media = [], id }) {
  const day = (at ? new Date(at) : new Date()).toISOString().slice(0, 10);
  const dir = path.join(QUEUE, day);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${(id || `${lane}-${Date.now()}`).replace(/[^\w.-]/g, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify({ lane, at, kind, text, media, status: 'queued', postUrl: null }, null, 2) + '\n');
  return file;
}

export function markSent(file, postUrl, status = 'sent') {
  const it = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...it, status, postUrl: postUrl || null }, null, 2) + '\n');
}
```

Shell and Python jobs get the same two writes. A cron shell job needs no helper file:

```sh
DAY=$(date -u +%F); OUT=~/.aircheck/queue/$DAY; mkdir -p "$OUT"
cat > "$OUT/brand-x-$(date -u +%H%M%S).json" <<JSON
{ "lane": "brand-x", "at": "$(date -u +%FT%TZ)", "kind": "image",
  "text": $(jq -Rs . < copy.txt), "media": ["$PWD/card.png"],
  "status": "queued", "postUrl": null }
JSON
```

Use `jq -Rs .` (or `json.dumps`) for the copy. Never hand-escape post text into JSON — a quote or a
newline in the copy silently breaks the file, and Aircheck then shows nothing for that post.

For an **Airflow DAG**, the write belongs in the same task that builds the post (and the rewrite in
the task that sends it), not in a separate DAG — a failed send must leave the file reading `failed`,
not `queued`.

If a job posts text with no media, `media: []` is correct. Do not invent an image.

## Step 3 — APPLY ONLY WITH PERMISSION

For **each** change, separately:

1. Show the exact change as a diff. For a new config, show the whole file. For a job patch, show
   `diff -u` against the current file.
2. Say what it affects in one line: "this adds two lanes and one queue folder, and changes nothing
   that posts" / "this adds 4 lines to the job that posts to LinkedIn".
3. **Ask.** Wait for the user to approve *that* change.
4. Only then write it.

Hard rules:

- ⛔ Never write `aircheck.config.json` without approval of that config's contents.
- ⛔ Never edit, move or reformat a posting job without approval of that specific patch. These files
  post to real accounts; a broken one posts wrong or posts twice.
- ⛔ Never change what a job posts, when it posts, its credentials, its arm flags, or its state files.
  The only addition is writing a JSON file next to what it already does.
- ⛔ Never run a posting job to test the wiring. Wait for its own schedule, or ask the user to run it.
- ⛔ Never `launchctl load/unload`, `crontab` edits, or an Airflow trigger. Scheduling is the user's.
- If the user approves one change and not another, apply only the approved one and say which is
  still unwired.
- Back up nothing by copying files around; the user's repo is under version control. Leave the diff
  in the working tree for them to commit.

## Step 4 — VERIFY, by reading only

```bash
node <aircheck>/skills/aircheck-setup/check-queue.mjs
node <aircheck>/skills/aircheck-setup/check-queue.mjs --day 2026-11-06
node <aircheck>/skills/aircheck-setup/check-queue.mjs --all
node <aircheck>/skills/aircheck-setup/check-queue.mjs --config ~/elsewhere/aircheck.config.json
```

It parses the folder queue the same way `src/server/sources/queue.ts` does and names the three
failures the app itself is silent about: a file with no `lane` (skipped), media not on disk
(dropped), media outside `mediaRoots` (refused by `/api/media`). It starts no server and writes
nothing. Exit code 1 if any file in the day is unusable.

If the day folder is empty, that is expected until the job next runs — say so, do not fabricate a
file to make the UI look populated. A single hand-written sample file is fine **only** if the user
asks for one, and say plainly that it is a sample.

Then tell the user the last step is theirs:

```bash
cd <aircheck> && npm run dev     # http://localhost:3326
```

Do not start the dev server as part of this skill unless the user asks.

## What this is NOT

- **Not a sender.** Aircheck never posts, has no credentials, and a preview run has no network. The
  job that posted before this skill ran is the job that posts after. If someone asks Aircheck to
  send a post, the answer is that it cannot.
- **Not a config overwrite.** If aircheck.config.json already exists, propose changes to it as a diff. Do not replace it with a different setup.
- **Not a plugin editor.** A queue, lane or ad source from a plugin reads its producer's own files. This skill does not edit those files or the plugin.
- **Not preview runs.** Starting an agent to draft an example post is `POST /api/runs` in the app,
  documented in the README.
