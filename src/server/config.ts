import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlugins } from './plugins';

/* THE CONFIG. One JSON file names where lanes, products and today's queue come from, which folders
 * hold media, and how to start a headless agent. AIRCHECK_CONFIG points at another file;
 * otherwise aircheck.config.json beside package.json. Read fresh on every request, so an edit
 * applies without a restart. */

export type SourceConfig = { source: string; [k: string]: unknown };

export type Config = {
  /** Modules that add sources Aircheck does not ship (see plugins.ts). */
  plugins: string[];
  dataDir: string;
  timezone: string;
  lanes: SourceConfig;
  /** The ad platforms, the ad side of `lanes`. */
  adLanes: SourceConfig;
  products: SourceConfig;
  queue: SourceConfig[];
  /** Where the ad creative a pipeline has built is read from. Empty turns the Ads route off. */
  ads: SourceConfig[];
  /* THE ACCOUNT. Manifests sync to it; media never does. `id` is the single account this install
   * syncs as, `store` is where manifests are kept (local today), `dir` overrides where that store
   * writes. Absent means no sync: the app reads the queue straight off disk, as it always has. */
  account?: { id?: string; store?: string; dir?: string; url?: string; token?: string };
  mediaRoots: string[];
  agents: {
    default: string;
    timeoutMinutes: number;
    workspace?: string;
    /** Where the ad pipelines live. The agent is told to read them there for an ad creative. */
    adWorkspace?: string;
    commands: Record<string, string[]>;
    /** House rules added to every social preview and repair prompt, one line each. */
    rules?: string[];
    /** House rules added to every ad prompt, one line each. */
    adRules?: string[];
  };
};

export const expand = (p: string) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/* Where the config is: AIRCHECK_CONFIG; else the first that exists of aircheck.config.json beside
 * package.json, ~/.aircheck/, ~/.config/aircheck/ and ~ (the same places the MCP server looks). */
export function configPath() {
  if (process.env.AIRCHECK_CONFIG) return expand(process.env.AIRCHECK_CONFIG);
  const list = [
    path.join(process.cwd(), 'aircheck.config.json'),
    path.join(os.homedir(), '.aircheck', 'aircheck.config.json'),
    path.join(os.homedir(), '.config', 'aircheck', 'aircheck.config.json'),
    path.join(os.homedir(), 'aircheck.config.json'),
  ];
  return list.find((f) => fs.existsSync(f)) || list[0];
}

/* With no config anywhere, a fresh install still runs: the queue folder the MCP server writes to by
 * default, media served from the same folder, and the two headless agents on the PATH. */
const DEFAULTS: Partial<Config> & Record<string, unknown> = {
  queue: [{ source: 'folder', dir: '~/.aircheck/queue' }],
  ads: [{ source: 'ad-folder', dir: '~/.aircheck/queue' }],
  mediaRoots: ['~/.aircheck'],
  agents: {
    default: 'claude',
    timeoutMinutes: 20,
    commands: {
      claude: ['claude', '-p', '{prompt}', '--permission-mode', 'acceptEdits'],
      codex: ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '{prompt}'],
    },
  },
};

export function loadConfig(): Config {
  const file = configPath();
  let raw: Partial<Config>;
  try {
    /* The hosted site has no config file and no disk: every lane, post and creative it shows comes
     * from the signed-in account. */
    raw = process.env.AIRCHECK_DB === 'supabase' && !process.env.AIRCHECK_CONFIG ? { timezone: process.env.AIRCHECK_TZ || 'America/New_York' }
      : !process.env.AIRCHECK_CONFIG && !fs.existsSync(file) ? DEFAULTS
        : JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Aircheck config unreadable at ${file}: ${(e as Error).message}. Copy aircheck.config.example.json there.`);
  }
  const agents = raw.agents || { default: 'claude', timeoutMinutes: 20, commands: {} };
  const plugins = (raw.plugins || []).map(expand);
  loadPlugins(plugins);
  return {
    plugins,
    dataDir: expand(raw.dataDir || '~/.aircheck'),
    timezone: raw.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    lanes: raw.lanes || { source: 'static', items: [] },
    adLanes: raw.adLanes || { source: 'ad-accounts', accounts: '' },
    products: raw.products || { source: 'static', items: [] },
    queue: raw.queue || [],
    ads: raw.ads || [],
    account: raw.account,
    mediaRoots: (raw.mediaRoots || []).map(expand),
    agents: {
      default: agents.default,
      timeoutMinutes: agents.timeoutMinutes || 20,
      workspace: agents.workspace ? expand(agents.workspace) : undefined,
      adWorkspace: agents.adWorkspace ? expand(agents.adWorkspace) : undefined,
      commands: agents.commands || {},
      rules: agents.rules || [],
      adRules: agents.adRules || [],
    },
  };
}

/** Today's date (YYYY-MM-DD) in the configured timezone. */
export function today(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}
