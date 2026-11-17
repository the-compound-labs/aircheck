/* The shapes every source adapter returns. The UI only ever sees these, so a new setup is a new
 * adapter in src/server/sources, never a UI change. */

export type Platform =
  | 'x' | 'linkedin' | 'bluesky' | 'threads' | 'instagram' | 'facebook' | 'youtube' | 'tiktok'
  | 'peerlist' | 'reddit' | 'hackernews' | 'substack' | 'pinterest'
  /* Ad platforms: an ad account lives on these the way a social account lives on the rest. */
  | 'google' | 'microsoft'
  /* A mailing: a newsletter, a product email, a sequence step. */
  | 'email' | 'other';

export type LaneFormat = { id: string; label: string; note?: string; module?: string };

export type Lane = {
  id: string;
  name: string;
  platform: Platform;
  handle?: string;
  voice?: string;
  /** What this lane posts, in a sentence. Shown on the lane and handed to the agent. */
  brief?: string;
  /** The posting processes or formats this lane runs (carousel, newsletter, replies...). */
  formats: LaneFormat[];
  /** Paths the agent should read first to learn how this lane really builds a post. */
  references?: string[];
  /** The lane's own logo, a path on this machine or a URL. Drawn in place of the platform glyph. */
  logo?: string;
};

export type Product = { id: string; name: string; url?: string; repository?: string };

/* A media reference is a SOURCE, never bytes we hold. 'local' is a file on the machine that
 * queued the post, fetched back through the media bridge; 'url' is the owner's own storage, which
 * the browser loads directly. Absent means local, so every existing caller keeps working. */
export type MediaRef = { path: string; kind: 'image' | 'video' | 'doc' | 'other'; src?: 'local' | 'url'; alt?: string };

export type QueueStatus = 'queued' | 'sent' | 'failed' | 'held';

/** A person's decision on a queued post, read back by the posting job before it sends. */
export type ReviewState = 'approved' | 'held' | 'changes';
export type Review = { state: ReviewState; at: string; note?: string; by?: string };

export type QueueItem = {
  id: string;
  lane: string;
  at?: string;
  kind: string;
  title?: string;
  text?: string;
  media: MediaRef[];
  url?: string;
  status: QueueStatus;
  postUrl?: string;
  /** Sent, but the sender got no permalink back to confirm it. */
  unconfirmed?: boolean;
  /** Files the producer names that are not on disk. */
  missing?: string[];
  source: string;
  /** The day this post belongs to. */
  day?: string;
  /** Where the post lives, so Repair can replace it: a folder file, or a kind a plugin replaces. */
  origin?: { kind: 'folder' | 'other' | (string & {}); path?: string };
  /** Why Repair cannot replace this post right now (sent, sending soon). Empty when it can. */
  lock?: string;
  /** Producer-specific fields worth showing raw (owner script, deck kind, topics...). */
  meta?: Record<string, unknown>;
  /** Set when this row is an ad creative: the same review, carrying its own ladder and lock. */
  ad?: AdCreative;
  /** Set when this row is an email: who it is from and to, its subject, and the rendered message. */
  email?: EmailInfo;
  /** A person's decision on this post, when one was made. */
  review?: Review;
};

/* AN EMAIL. The same queued item as a post, carrying a message instead of media: the headers a
 * reader sees in their inbox and the HTML they see when they open it. The HTML is a SOURCE like a
 * media entry (a file on the machine that queued it, or a URL), so Aircheck never holds it. */
export type EmailInfo = {
  subject: string;
  from?: string;
  to?: string[];
  replyTo?: string;
  preheader?: string;
  /** The rendered message, resolved like media. */
  html?: MediaRef & { src?: 'local' | 'url'; missing?: boolean };
  /** The plain-text part. */
  text?: string;
};

/* AD CREATIVE. The same review loop as a queued post, for the media an ad pipeline builds: a deck,
 * a still, a clip or a document that a person must look at before it is put behind money. A post
 * has a send time and goes out on its own; a creative has a review stage and goes live only once
 * someone approves it, so the status ladder and the replace lock differ. Everything else — media,
 * Example, Feedback, Repair, Replace, Undo — is shared. */

export type AdStatus = 'draft' | 'review' | 'approved' | 'live' | 'archived';

export type AdKind = 'carousel' | 'image' | 'video' | 'document' | 'text';

export type AdCreative = {
  /** product/run/assetId, stable across renders of the same asset. */
  id: string;
  /** The ad platform or account it runs on, when the manifest names one. Else its format decides. */
  lane?: string;
  product: string;
  /** The production run folder this creative was rendered in. */
  run: string;
  assetId: string;
  kind: AdKind;
  /** The placement this file is cut for: carousel-square, video-portrait-15s, still-feed... */
  format: string;
  title?: string;
  text?: string;
  media: MediaRef[];
  status: AdStatus;
  /** The producer's own stage word, shown raw when it has one (format-review, fanout...). */
  stage?: string;
  approved: boolean;
  missing?: string[];
  source: string;
  /** Where the creative lives, so Repair can replace it. */
  origin?: { kind: 'ad-catalog' | 'ad-folder' | 'other'; path?: string; dir?: string };
  /** Why Repair cannot replace this creative right now. Empty when it can. */
  lock?: string;
  /** The recipe that built it, so the agent can re-run the real pipeline. */
  recipe?: string;
  createdAt?: string;
  meta?: Record<string, unknown>;
};

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';

export type RunOutput = {
  text?: string;
  thread?: string[];
  media: MediaRef[];
  kind?: string;
  notes?: string;
};

export type RunAction = 'preview' | 'example' | 'feedback' | 'repair';

export type Run = {
  id: string;
  lane: string;
  /** preview = a new post for a lane; example, feedback and repair act on one queued post. */
  action?: RunAction;
  target?: { day: string; id: string };
  /** Set instead of target when the run acts on an ad creative rather than a queued post. */
  ad?: { id: string; product: string };
  format?: string;
  product?: string;
  agent: string;
  request?: string;
  /** A revision: the comment that asked for it, and the run it revises. */
  comment?: string;
  parent?: string;
  status: RunStatus;
  createdAt: string;
  finishedAt?: string;
  pid?: number;
  exitCode?: number | null;
  error?: string;
  output?: RunOutput;
  /** Set once Replace swapped this run's output into the queue; cleared by Undo. */
  replaced?: { at: string; backup: string };
};
