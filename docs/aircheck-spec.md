# Aircheck — the manifest, the MCP server, and what we host

This is the engineering spec for the manifest, the MCP server and the hosted account.

## The product in one paragraph

Aircheck is a website you log into that shows every post your agents queued for today, with its
media, so you can fix a post before it goes out. **We host the shell and the features. We never
host your media.** Your posts live on your machine (or in your own storage) and stay there; what
reaches us is a small JSON manifest describing what is queued. The site reads that manifest and
loads each image from wherever the manifest says it lives.

## One setup

There is **one** way a setup is wired: the manifest format below. There are two ways to arrive at
it, and they produce identical files — the site cannot tell them apart.

1. **The MCP server does it with your agent.** This is the way. You add one entry to your Claude
   Code or Codex config; the agent reads your setup, tells you what Aircheck expects, wires it up,
   and from then on reports what it queued itself. Nothing to install and no jobs to patch.
2. **You read the docs and do it yourself.** The format is public and plain. A cron or Airflow
   shop with no agent in the loop writes the files directly.

Option 1 is the recommended path and the site, the docs and the landing should say so plainly.
Option 2 exists so that nobody is blocked, not as an equal alternative.

## The manifest

One JSON file per queued post or ad creative, in a dated folder:

```
<queue>/<YYYY-MM-DD>/<anything>.json
```

```json
{
  "lane": "brand-x",
  "at": "2026-11-07T15:30:00Z",
  "kind": "carousel",
  "text": "Post copy exactly as it will go out",
  "media": ["slide-1.png", "slide-2.png"],
  "status": "queued",
  "postUrl": null
}
```

| field | meaning |
| --- | --- |
| `lane` | which account/lane this goes out on. For an ad creative, the ad platform or account it runs on. Required. |
| `at` | when it sends, ISO 8601. Omit for unscheduled. |
| `kind` | `text`, `image`, `carousel`, `video`, `thread`, `article`. Inferred from `media` when absent. |
| `text` | the copy, exactly as it will post. |
| `media` | ordered list of media sources. See below. |
| `status` | a post: `queued`, `sent`, `held`, `failed` (default `queued`). An ad creative: `draft`, `review`, `approved`, `live`, `archived` (default `draft`). |
| `ad` | present only on an ad creative. See below. |
| `postUrl` | the permalink, after sending. Posts only. |

After a send, the job (or the MCP server) rewrites the same file: `status` becomes `sent` and
`postUrl` is filled in.

### An ad creative is the same manifest

There is one file shape. An ad creative is a manifest with an `ad` block, and **the presence of
`ad` is the only thing that tells the two apart**:

```json
{
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
}
```

| `ad.` field | meaning |
| --- | --- |
| `product` | what the creative is about. Required. Filters the Ads scope. |
| `format` | the placement it is cut for: `carousel-feed`, `still-square`, `video-portrait-15s`, `search-text`... Defaults to the kind. (A catalog creative has no `lane`, so its format picks the lane.) |
| `run` | the production run it belongs to. Creatives are grouped by run. Defaults to the dated folder, else `folder`. |
| `approved` | a person signed off. Defaults to `false`. |
| `recipe` | the recipe or script that built it, so Repair can re-run the real pipeline. Optional. |

`lane`, `text`, `media`, `kind`, `title` and `meta` mean exactly what they mean on a post, and
`media` follows the same media-source rules below — there is no second set. `at` stays optional and
a creative normally omits it. `postUrl` does not apply.

| | no `ad` — a post | `ad` — a creative |
| --- | --- | --- |
| scope | Social | Ads |
| grouped by | send hour | `ad.run` |
| status ladder | `queued` `sent` `held` `failed` | `draft` `review` `approved` `live` `archived` |
| Repair may replace it | unless sent, held, or due within 6 minutes | only while it is not approved, live or archived |
| `mark_sent` writes | `sent` and `postUrl` | `live` |

**The status word is validated against the shape.** A post marked `review`, or a creative marked
`queued`, is a problem, not a fallback, and the message names both ways out (use the other ladder,
or add/remove the `ad` block). A creative whose manifest does not validate is still shown in Ads,
carrying its problems and locked against Replace, exactly as a broken post shows up as failed.

**The approval rule.** Repair may replace a creative only while nobody has signed off: once
`ad.approved` is true or `status` is `approved`, `live` or `archived`, it may be running behind money
and Replace is refused. An approval flag wins over a stage that still says `review`. A swap never
changes `approved` or `status`, so Replace can never promote a creative.

**Where creatives are read from.** The `ad-folder` source reads `<dir>/*.json` and
`<dir>/<YYYY-MM-DD>/*.json` and keeps only files with an `ad` block; the folder queue skips them.
So `ads` and `queue` may point at the same folder and neither scope shows the other's files. A
creative that synced to the account is read from there like a post.

**A renderer that already writes its own manifest.** `ad-catalog` reads
`<dir>/<product>/<run>/catalog.json`, the manifest a render pipeline writes for itself, with one
creative per asset in it. That file is the renderer's, not ours, so Aircheck reads it as it is and
does not ask it to change shape. Its `userApproved` maps to `approved`, its `stage` to the ladder
(`review` → review, `live`/`launched`/`serving` → live, `archived`/`retired` → archived, else draft),
and Replace rewrites only the asset's files and copy, with fresh hashes, never its stage or approval.

**Plugins.** A source that is not built in comes from a plugin, which is an ES module listed under plugins in the config, for example "plugins": ["~/my-pipeline/aircheck-plugin.mjs"]. The module exports tables keyed by source name: lanes, products, queue (load and an optional readAt), and ads. It can also export replace, keyed by a queue row's origin kind, so Repair can swap a finished run into a row the plugin reads. Every function is synchronous and only reads files. A queue row from a plugin with no replace entry shows Repair with Replace locked. An ad creative returned by a plugin can carry its own lock text. See src/server/plugins.ts.

### Media sources

A `media` entry is a **resolvable source**, not only a path. The browser resolves it; the bytes
never pass through us.

| form | example | how the browser gets it |
| --- | --- | --- |
| relative path | `"slide-1.png"` | resolved against the JSON file's folder, then served by the local bridge |
| absolute path | `"/Users/you/out/slide-1.png"` | served by the local bridge |
| URL | `"https://cdn.you.com/slide-1.png"` | loaded directly from your storage |
| object | `{ "path": "...", "alt": "..." }` | same as above, with extras |

**The local bridge.** A hosted HTTPS page cannot read `file://` — browsers forbid it outright. It
*can* load `http://localhost`, which browsers treat as a secure origin, so this is not mixed
content. The MCP server therefore also serves media over localhost from an allow-listed set of
roots, with CORS scoped to the Aircheck origin. This is the same allow-list the local app already
enforces in `src/server/media.ts`: resolve symlinks, refuse anything outside a configured root.

Consequence worth stating in the docs: **where you keep media decides where you can review.** Media
on your disk reviews from that machine. Media on your own bucket reviews from anywhere, phone
included. That is your storage choice, not ours.

## The MCP server

Runs on the user's machine. The only thing that does.

| tool | what it does |
| --- | --- |
| `queue_post` | write a manifest for a post the agent just queued, or a creative it just rendered (with `ad`) |
| `mark_sent` | rewrite status and postUrl after a send (a creative goes `live`) |
| `list_queue` | read back a day, for the agent |
| `configure` | read the user's setup, propose the wiring, apply on approval |
| `repair` | start a re-run of a post's own pipeline locally |
| `repair_status` | how that run is doing, and its result once it is done |
| `push_day` | send a whole day from the config's sources to the account |
| `check_post` | right before a send: the decision a person made (approved, held, changes, pending) and whether to send |
| `keep_running` | install a macOS login item that keeps the media bridge up after the agent session closes |

`check_post` is the review gate. A decision made on aircheck.dev is stored on the account's copy of
the manifest (`meta.review`) and survives a re-push from the machine. A lane's policy in the config
decides what "nobody has looked yet" means: `"review": { "default": "auto", "lanes": { "<id>": "review" } }`.
`auto` sends unless held or sent back; `review` sends only once approved.

`repair` starts rather than blocks: an MCP call that waits out a render holds the agent's whole
conversation open, so it returns a run id and `repair_status` reports on it. A run whose process is
gone is finished from what it left in `out/`, so a result survives the server restarting
mid-render.

It also serves the local media bridge, and syncs manifests to the account.

`repair` is why execution stays local: Example, Feedback and Repair re-run **the user's real
pipeline**, which only exists on their machine. A hosted server could never do this. The site sends
the request down the MCP connection; the work happens there; only the resulting manifest and media
references come back.

`skills/aircheck-setup` documents the manual route.

## The account

- An account holds a user's manifests. Manifests are text, a few KB.
- **We store JSON. We never store media.** This is a product promise and should be stated on the
  landing and the privacy page.
- The account is the reason the site is worth logging into: your queue follows you.
