import crypto from 'node:crypto';
import { databaseFetch } from './database-overload.mjs';
import { manifestProblems } from './manifest';
import type { Session, User } from './auth';
import type { Store, StoredManifest, TokenRecord } from './account';

/* THE HOSTED ACCOUNT. aircheck.dev keeps who you are and your manifests in the Compound Labs
 * database: aircheck_users, aircheck_sessions, aircheck_tokens and aircheck_manifests. Only the
 * server's service role can reach those tables (RLS on, nothing granted to anon), and they hold
 * JSON only: a manifest's media entries are references, never bytes.
 *
 * This speaks PostgREST directly over fetch, so it runs the same in Node and on a Worker. Reads go
 * through a bounded database fetch (database-overload.mjs); writes go straight through. */

/** The hosted account is on when the server has the database and is told to use it. */
export function hostedDb(): boolean {
  return process.env.AIRCHECK_DB === 'supabase' && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!dbUrl();
}

const dbUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');

async function rest<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const { prefer, ...rest } = init;
  const r = await databaseFetch(`${dbUrl()}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
      ...(rest.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`Aircheck database ${r.status}: ${text.slice(0, 200)}`) as Error & { status: number; body: string };
    err.status = r.status; err.body = text;
    throw err;
  }
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

const q = encodeURIComponent;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (email: string) => email.trim().toLowerCase();
const DAYS = 30;

function scrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

type UserRow = { id: string; email: string; hash: string; salt: string; created_at: string };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, hash: r.hash, salt: r.salt, createdAt: r.created_at });

export class DbUsers {
  async find(email: string): Promise<User | null> {
    const rows = await rest<UserRow[]>(`aircheck_users?email=eq.${q(norm(email))}&select=*&limit=1`);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async byId(id: string): Promise<User | null> {
    const rows = await rest<UserRow[]>(`aircheck_users?id=eq.${q(id)}&select=*&limit=1`);
    return rows[0] ? toUser(rows[0]) : null;
  }

  /** The hosted site always has other people's accounts, so it never offers "make the first one". */
  async count() { return 1; }

  async create(email: string, password: string): Promise<User> {
    const e = norm(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That is not an email address.');
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    const salt = crypto.randomBytes(16).toString('hex');
    const row = { id: crypto.randomBytes(8).toString('hex'), email: e, salt, hash: scrypt(password, salt) };
    try {
      const rows = await rest<UserRow[]>('aircheck_users', { method: 'POST', body: JSON.stringify(row), prefer: 'return=representation' });
      return toUser(rows[0]);
    } catch (err) {
      if ((err as { status?: number }).status === 409) throw new Error('There is already an account for that address.');
      throw err;
    }
  }

  /** An account made by Google sign-in. No password: an empty hash can never verify. A conflict on
   * the email returns no row (ignore-duplicates), so `created` is true only for the insert that won. */
  async createOAuth(email: string): Promise<{ user: User; created: boolean }> {
    const row = { id: crypto.randomBytes(8).toString('hex'), email: norm(email), salt: '', hash: '' };
    const rows = await rest<UserRow[]>('aircheck_users?on_conflict=email', { method: 'POST', body: JSON.stringify(row), prefer: 'resolution=ignore-duplicates,return=representation' });
    return rows[0] ? { user: toUser(rows[0]), created: true } : { user: (await this.find(email))!, created: false };
  }

  /* The same answer whether the address is unknown or the password is wrong. */
  async verify(email: string, password: string): Promise<User | null> {
    const u = await this.find(email);
    if (!u || !u.hash) { scrypt(password, 'decoy-salt-for-constant-work'); return null; }
    return sameHash(u.hash, scrypt(password, u.salt)) ? u : null;
  }

  async setPassword(id: string, password: string) {
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    const salt = crypto.randomBytes(16).toString('hex');
    await rest(`aircheck_users?id=eq.${q(id)}`, { method: 'PATCH', body: JSON.stringify({ salt, hash: scrypt(password, salt) }) });
  }

  /** Remove the account row. Its sessions, tokens, manifests and reset links go with it: every one
   * of those tables references aircheck_users with on delete cascade. The id is matched exactly, and
   * an empty id removes nothing. True when a row was removed. */
  async remove(id: string): Promise<boolean> {
    if (!id) return false;
    const rows = await rest<{ id: string }[]>(`aircheck_users?id=eq.${q(id)}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
    return rows.length === 1;
  }
}

/* Sessions are kept by the hash of the cookie value, so the table never holds a usable cookie. */
export class DbSessions {
  async open(user: string): Promise<Session> {
    const token = crypto.randomBytes(32).toString('base64url');
    const s: Session = { token, user, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + DAYS * 86400_000).toISOString() };
    await rest('aircheck_sessions', { method: 'POST', body: JSON.stringify({ token_hash: sha(token), user_id: user, expires_at: s.expiresAt }) });
    return s;
  }

  async user(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const rows = await rest<{ user_id: string }[]>(
      `aircheck_sessions?token_hash=eq.${sha(token)}&expires_at=gt.${q(new Date().toISOString())}&select=user_id&limit=1`,
    );
    return rows[0]?.user_id || null;
  }

  async close(token: string) {
    await rest(`aircheck_sessions?token_hash=eq.${sha(token)}`, { method: 'DELETE' });
  }

  /** The account row's cascade already ended these; kept so both stores answer the same call. */
  async closeAll(user: string) {
    if (user) await rest(`aircheck_sessions?user_id=eq.${q(user)}`, { method: 'DELETE' });
  }
}

type TokenRow = { hash: string; account: string; label: string | null; created_at: string; last_used_at: string | null };

export class DbTokens {
  async issue(account: string, label?: string): Promise<{ token: string; record: TokenRecord }> {
    const token = `ac_${crypto.randomBytes(24).toString('base64url')}`;
    const createdAt = new Date().toISOString();
    await rest('aircheck_tokens', { method: 'POST', body: JSON.stringify({ hash: sha(token), account, label: label || null, created_at: createdAt }) });
    return { token, record: { hash: sha(token), account, label, createdAt } };
  }

  async verify(token: string): Promise<string | null> {
    if (!token) return null;
    const h = sha(token);
    const rows = await rest<TokenRow[]>(`aircheck_tokens?hash=eq.${h}&select=account&limit=1`);
    if (!rows[0]) return null;
    await rest(`aircheck_tokens?hash=eq.${h}`, { method: 'PATCH', body: JSON.stringify({ last_used_at: new Date().toISOString() }) });
    return rows[0].account;
  }

  async revoke(hash: string) {
    await rest(`aircheck_tokens?hash=eq.${q(hash)}`, { method: 'DELETE' });
  }

  async revokeBy(account: string, createdAt: string): Promise<number> {
    const rows = await rest<TokenRow[]>(
      `aircheck_tokens?account=eq.${q(account)}&created_at=eq.${q(createdAt)}`,
      { method: 'DELETE', prefer: 'return=representation' },
    );
    return rows.length;
  }

  async list(account: string): Promise<Omit<TokenRecord, 'hash'>[]> {
    const rows = await rest<TokenRow[]>(`aircheck_tokens?account=eq.${q(account)}&select=account,label,created_at,last_used_at&order=created_at`);
    return rows.map((r) => ({ account: r.account, label: r.label || undefined, createdAt: r.created_at, lastUsedAt: r.last_used_at || undefined }));
  }
}

type ManifestRow = { account: string; day: string; id: string; manifest: StoredManifest['manifest']; origin: string | null; updated_at: string };
const toRec = (r: ManifestRow): StoredManifest => ({ id: r.id, day: r.day, manifest: r.manifest, origin: r.origin || undefined, updatedAt: r.updated_at });

/* The manifests an account holds, keyed by (account, day, id). The same four calls as the local
 * store, so nothing above this knows which one it is talking to. */
export class DbStore implements Store {
  async list(account: string, day: string): Promise<StoredManifest[]> {
    const rows = await rest<ManifestRow[]>(`aircheck_manifests?account=eq.${q(account)}&day=eq.${q(day)}&select=*&limit=500`);
    return rows.map(toRec).sort((a, b) => (a.manifest.at || '').localeCompare(b.manifest.at || ''));
  }

  async get(account: string, day: string, id: string) {
    const rows = await rest<ManifestRow[]>(`aircheck_manifests?account=eq.${q(account)}&day=eq.${q(day)}&id=eq.${q(id)}&select=*&limit=1`);
    return rows[0] ? toRec(rows[0]) : null;
  }

  async put(account: string, rec: StoredManifest) {
    const problems = manifestProblems(rec.manifest);
    if (problems.length) throw new Error(problems.join('; '));
    const updatedAt = new Date().toISOString();
    await rest('aircheck_manifests?on_conflict=account,day,id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: JSON.stringify({ account, day: rec.day, id: rec.id, manifest: rec.manifest, origin: rec.origin || null, updated_at: updatedAt }),
    });
    return { ...rec, updatedAt };
  }

  async remove(account: string, day: string, id: string) {
    await rest(`aircheck_manifests?account=eq.${q(account)}&day=eq.${q(day)}&id=eq.${q(id)}`, { method: 'DELETE' });
  }
}

/* Password-reset links, kept by the hash of the token. One hour, one use. */
export class DbResets {
  async create(user: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await rest('aircheck_password_resets', { method: 'POST', body: JSON.stringify({ token_hash: sha(token), user_id: user, expires_at: new Date(Date.now() + 3600_000).toISOString() }) });
    return token;
  }

  /** The user a live, unused link belongs to, marking it used. Null for anything else. */
  async use(token: string): Promise<string | null> {
    if (!token) return null;
    const rows = await rest<{ user_id: string }[]>(
      `aircheck_password_resets?token_hash=eq.${sha(token)}&used_at=is.null&expires_at=gt.${q(new Date().toISOString())}`,
      { method: 'PATCH', body: JSON.stringify({ used_at: new Date().toISOString() }), prefer: 'return=representation' },
    );
    return rows[0]?.user_id || null;
  }
}
