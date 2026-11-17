import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expand, readJson, type Config } from './config';
import { manifestProblems, type Manifest } from './manifest';
import { cookieFrom, sessions, Sessions, Users } from './auth';
import { DbStore, DbTokens, DbUsers, hostedDb } from './db';

/* THE ACCOUNT. What an account holds is manifests: text, a few KB each. It never holds media.
 *
 * That one line decides the whole design. A post's slides stay on the machine that made them, or
 * in storage its owner already pays for, and the browser fetches them from there. What syncs up is
 * the description of the post: lane, time, copy, status, and the media REFERENCES. So this module
 * reads and writes JSON and has no notion of a file upload.
 *
 * The store behind it is swappable. `local` keeps manifests under the data dir, which is what runs
 * today and what the tests run against; a hosted store speaks the same four calls over HTTP with a
 * token the web UI issues. Nothing above this module knows which one it is talking to. */

export type Account = { id: string; email?: string; name?: string };

export type StoredManifest = {
  /** Stable within an account: the day and the file name the manifest was written as. */
  id: string;
  day: string;
  manifest: Manifest;
  /** Where the manifest lives on the machine that queued it, so Repair can find it again. */
  origin?: string;
  updatedAt: string;
};

export interface Store {
  list(account: string, day: string): Promise<StoredManifest[]>;
  get(account: string, day: string, id: string): Promise<StoredManifest | null>;
  put(account: string, rec: StoredManifest): Promise<StoredManifest>;
  remove(account: string, day: string, id: string): Promise<void>;
}

const safe = (s: string) => s.replace(/[^a-z0-9._-]/gi, '-');

/* The local store: <dataDir>/accounts/<account>/<day>/<id>.json. The same bytes a hosted store
 * would hold, so moving to one is a change of transport and not of format. */
export class LocalStore implements Store {
  private root: string;
  constructor(root: string) { this.root = root; }

  private dir(account: string, day: string) { return path.join(this.root, 'accounts', safe(account), safe(day)); }
  private file(account: string, day: string, id: string) { return path.join(this.dir(account, day), `${safe(id)}.json`); }

  async list(account: string, day: string): Promise<StoredManifest[]> {
    const dir = this.dir(account, day);
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
    return names
      .map((n) => readJson<StoredManifest>(path.join(dir, n)))
      .filter((r): r is StoredManifest => !!r?.manifest)
      .sort((a, b) => (a.manifest.at || '').localeCompare(b.manifest.at || ''));
  }

  async get(account: string, day: string, id: string) {
    return readJson<StoredManifest>(this.file(account, day, id));
  }

  async put(account: string, rec: StoredManifest) {
    const problems = manifestProblems(rec.manifest);
    if (problems.length) throw new Error(problems.join('; '));
    const file = this.file(account, rec.day, rec.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const next: StoredManifest = { ...rec, updatedAt: new Date().toISOString() };
    fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(file + '.tmp', file);
    return next;
  }

  async remove(account: string, day: string, id: string) {
    try { fs.unlinkSync(this.file(account, day, id)); } catch { /* already gone */ }
  }

  /** Every manifest one account holds: its own folder under accounts/, and nothing beside it. */
  removeAccount(account: string) {
    const name = safe(account);
    if (!name || /^\.+$/.test(name)) return;
    fs.rmSync(path.join(this.root, 'accounts', name), { recursive: true, force: true });
  }
}

/* TOKENS. A machine syncing manifests proves which account it is for with a token the web UI
 * issues. Only the hash is kept, so the store never holds anything worth stealing, and the token
 * is shown once at issue time the way every other API key works. */

export type TokenRecord = { hash: string; account: string; label?: string; createdAt: string; lastUsedAt?: string };

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export class Tokens {
  private file: string;
  constructor(file: string) { this.file = file; }

  private all(): TokenRecord[] { return readJson<TokenRecord[]>(this.file) || []; }

  private save(rows: TokenRecord[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(rows, null, 2) + '\n');
    fs.renameSync(this.file + '.tmp', this.file);
  }

  /** Issue a token. The plain value is returned once and never stored. */
  issue(account: string, label?: string): { token: string; record: TokenRecord } {
    const token = `ac_${crypto.randomBytes(24).toString('base64url')}`;
    const record: TokenRecord = { hash: hashToken(token), account, label, createdAt: new Date().toISOString() };
    this.save([...this.all(), record]);
    return { token, record };
  }

  /** The account a token belongs to, or null. Constant-time compare on the hash. */
  verify(token: string): string | null {
    if (!token) return null;
    const want = Buffer.from(hashToken(token), 'hex');
    const rows = this.all();
    for (const r of rows) {
      const got = Buffer.from(r.hash, 'hex');
      if (got.length === want.length && crypto.timingSafeEqual(got, want)) {
        r.lastUsedAt = new Date().toISOString();
        this.save(rows);
        return r.account;
      }
    }
    return null;
  }

  revoke(hash: string) { this.save(this.all().filter((r) => r.hash !== hash)); }

  /** Revoke by the moment of issue, for a UI that is never given the hash. */
  revokeBy(account: string, createdAt: string): number {
    const rows = this.all();
    const keep = rows.filter((r) => !(r.account === account && r.createdAt === createdAt));
    this.save(keep);
    return rows.length - keep.length;
  }

  list(account: string): Omit<TokenRecord, 'hash'>[] {
    return this.all().filter((r) => r.account === account).map(({ hash: _h, ...rest }) => rest);
  }

  /** Revoke every token of one account. */
  revokeAll(account: string) { this.save(this.all().filter((r) => r.account !== account)); }
}

/* The hosted store. Same four calls over HTTPS, so moving an install from the local store to a
 * hosted one is a change of transport and nothing else — the bytes on the wire are the manifests
 * the local store writes to disk. It still carries no media: the body is JSON, and a media entry
 * is a reference the browser resolves on its own. */
export class HttpStore implements Store {
  private base: string;
  private token: string;
  constructor(base: string, token: string) { this.base = base.replace(/\/$/, ''); this.token = token; }

  private async call(path: string, init?: RequestInit) {
    const r = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}`, ...(init?.headers || {}) },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`Aircheck sync ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  async list(_account: string, day: string): Promise<StoredManifest[]> {
    const r = await this.call(`/api/sync?day=${encodeURIComponent(day)}`);
    return (r.manifests || []) as StoredManifest[];
  }

  async get(account: string, day: string, id: string) {
    return (await this.list(account, day)).find((m) => m.id === id) || null;
  }

  async put(_account: string, rec: StoredManifest) {
    const problems = manifestProblems(rec.manifest);
    if (problems.length) throw new Error(problems.join('; '));
    await this.call('/api/sync', { method: 'POST', body: JSON.stringify({ manifests: [rec] }) });
    return { ...rec, updatedAt: new Date().toISOString() };
  }

  async remove(_account: string, day: string, id: string) {
    await this.call(`/api/sync?day=${encodeURIComponent(day)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

export function store(cfg: Config): Store {
  if (hostedDb()) return new DbStore();
  const kind = (cfg.account?.store || 'local').toLowerCase();
  if (kind === 'local') return new LocalStore(expand(cfg.account?.dir || cfg.dataDir));
  if (kind === 'http' || kind === 'hosted') {
    const base = cfg.account?.url;
    const token = cfg.account?.token || process.env.AIRCHECK_TOKEN || '';
    if (!base) throw new Error('A hosted account needs account.url.');
    if (!token) throw new Error('A hosted account needs account.token, or AIRCHECK_TOKEN in the environment.');
    return new HttpStore(base, token);
  }
  throw new Error(`Unknown account store '${kind}'. Use 'local' or 'http'.`);
}

export function tokens(cfg: Config): Tokens | DbTokens {
  if (hostedDb()) return new DbTokens();
  return new Tokens(path.join(expand(cfg.account?.dir || cfg.dataDir), 'tokens.json'));
}

/* The account a request is for. A machine proves itself with a bearer token; a browser proves
 * itself with its session cookie. An install with a single configured account and neither of those
 * is the local case, where the only person who can reach the server is the one running it. */
export async function accountOf(cfg: Config, req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) return tokens(cfg).verify(bearer);
  const session = await sessions(cfg).user(cookieFrom(req));
  if (session) return session;
  /* The hosted site has no "only person on this machine": no proof, no account. */
  if (hostedDb()) return null;
  return cfg.account?.id || null;
}

/* DELETING AN ACCOUNT. Everything Aircheck stores for one account goes: the account row, its
 * sessions, its machine tokens, its manifests and its reset links. Aircheck keeps its own accounts
 * (aircheck_users); it does not use the sign-in identity other Compound Labs products share, so
 * nothing outside Aircheck is touched. Media was never stored, so there is none to remove.
 *
 * On aircheck.dev one delete of the account row does all of it, by the tables' own cascade. A local
 * install removes the same rows from its files. True when an account was removed. */
export async function deleteAccount(cfg: Config, id: string): Promise<boolean> {
  if (!id) return false;
  if (hostedDb()) return new DbUsers().remove(id);
  const root = expand(cfg.account?.dir || cfg.dataDir);
  const removed = new Users(path.join(root, 'users.json')).remove(id);
  if (!removed) return false;
  new Sessions(path.join(root, 'sessions.json')).closeAll(id);
  new Tokens(path.join(root, 'tokens.json')).revokeAll(id);
  new LocalStore(root).removeAccount(id);
  return true;
}
