import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expand, readJson, type Config } from './config';
import { DbSessions, DbUsers, hostedDb } from './db';

/* SIGNING IN. An account is what a manifest belongs to, so there has to be a way to prove you are
 * one. This is deliberately small: an email, a password hashed with scrypt, and a session cookie.
 *
 * No mail is ever sent — no verification link, no reset mail — because Aircheck has no business
 * sending anyone email, and a product that cannot post on your behalf should not be able to write
 * to you either. A forgotten password is recovered by someone with access to the machine, the same
 * way the data itself is. */

export type User = { id: string; email: string; hash: string; salt: string; createdAt: string };
export type Session = { token: string; user: string; createdAt: string; expiresAt: string };

const DAYS = 30;
const norm = (email: string) => email.trim().toLowerCase();

function scrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

/** Passwords are compared in constant time, on the derived key, never on the password. */
function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export class Users {
  private file: string;
  constructor(file: string) { this.file = file; }

  private all(): User[] { return readJson<User[]>(this.file) || []; }

  private save(rows: User[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(rows, null, 2) + '\n');
    fs.renameSync(this.file + '.tmp', this.file);
  }

  find(email: string): User | null { return this.all().find((u) => u.email === norm(email)) || null; }
  byId(id: string): User | null { return this.all().find((u) => u.id === id) || null; }
  count() { return this.all().length; }

  create(email: string, password: string): User {
    const e = norm(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That is not an email address.');
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    if (this.find(e)) throw new Error('There is already an account for that address.');
    const salt = crypto.randomBytes(16).toString('hex');
    const user: User = { id: crypto.randomBytes(8).toString('hex'), email: e, salt, hash: scrypt(password, salt), createdAt: new Date().toISOString() };
    this.save([...this.all(), user]);
    return user;
  }

  /** An account made by Google sign-in. No password: an empty hash can never verify. `created` is
   * true only when this call inserted the row. */
  createOAuth(email: string): { user: User; created: boolean } {
    const found = this.find(email);
    if (found) return { user: found, created: false };
    const user: User = { id: crypto.randomBytes(8).toString('hex'), email: norm(email), salt: '', hash: '', createdAt: new Date().toISOString() };
    this.save([...this.all(), user]);
    return { user, created: true };
  }

  /* The same answer whether the address is unknown or the password is wrong, so this cannot be
   * used to find out who has an account. */
  verify(email: string, password: string): User | null {
    const u = this.find(email);
    if (!u || !u.hash) { scrypt(password, 'decoy-salt-for-constant-work'); return null; }
    return sameHash(u.hash, scrypt(password, u.salt)) ? u : null;
  }

  /** Remove the account row. True when a row was removed. */
  remove(id: string): boolean {
    const rows = this.all();
    const keep = rows.filter((r) => r.id !== id);
    if (keep.length === rows.length) return false;
    this.save(keep);
    return true;
  }

  setPassword(id: string, password: string) {
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    const rows = this.all();
    const u = rows.find((r) => r.id === id);
    if (!u) throw new Error('No such account.');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = scrypt(password, u.salt);
    this.save(rows);
  }
}

export class Sessions {
  private file: string;
  constructor(file: string) { this.file = file; }

  private all(): Session[] {
    const now = Date.now();
    return (readJson<Session[]>(this.file) || []).filter((s) => Date.parse(s.expiresAt) > now);
  }

  private save(rows: Session[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(rows, null, 2) + '\n');
    fs.renameSync(this.file + '.tmp', this.file);
  }

  open(user: string): Session {
    const s: Session = {
      token: crypto.randomBytes(32).toString('base64url'),
      user, createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + DAYS * 86400_000).toISOString(),
    };
    this.save([...this.all(), s]);
    return s;
  }

  user(token: string | undefined): string | null {
    if (!token) return null;
    const want = Buffer.from(token);
    for (const s of this.all()) {
      const got = Buffer.from(s.token);
      if (got.length === want.length && crypto.timingSafeEqual(got, want)) return s.user;
    }
    return null;
  }

  close(token: string) { this.save(this.all().filter((s) => s.token !== token)); }

  /** End every session of one user, on every browser. */
  closeAll(user: string) { this.save(this.all().filter((s) => s.user !== user)); }
}

const dir = (cfg: Config) => expand(cfg.account?.dir || cfg.dataDir);
/* On aircheck.dev the account lives in the database; a local install keeps the same rows as files
 * under its data dir. Callers await either way. */
export const users = (cfg: Config): Users | DbUsers => (hostedDb() ? new DbUsers() : new Users(path.join(dir(cfg), 'users.json')));
export const sessions = (cfg: Config): Sessions | DbSessions => (hostedDb() ? new DbSessions() : new Sessions(path.join(dir(cfg), 'sessions.json')));

export const COOKIE = 'aircheck_session';

/** The cookie header a signed-in browser carries. httpOnly, so script can never read it. */
export function cookieHeader(token: string, secure: boolean) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure ? '; Secure' : ''}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function cookieFrom(req: Request): string | undefined {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return undefined;
}
