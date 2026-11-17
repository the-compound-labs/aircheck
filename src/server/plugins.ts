import { expand, readJson, type SourceConfig } from './config';
import { ref } from './media';
import type { AdCreative, Lane, Product, QueueItem } from './types';

/* PLUGINS. A source Aircheck does not ship (your own day planner, your own ad pipeline) is a plain
 * ES module named in the config:
 *
 *   "plugins": ["~/my-pipeline/aircheck-plugin.mjs"]
 *
 * and then used by name like a built-in one: { "source": "my-planner", ... }. A plugin exports
 * (default or named) any of the tables below. Every function is synchronous and reads files only;
 * a plugin never posts anything, the same as the rest of Aircheck.
 *
 *   lanes     source name -> (cfg, helpers) => Lane[]
 *   products  source name -> (cfg, helpers) => Product[]
 *   queue     source name -> { load(cfg, day, helpers) => QueueItem[], readAt?(cfg, day) => ISO string }
 *   ads       source name -> (cfg, helpers) => AdCreative[]
 *   replace   origin kind -> { replace(ctx), undo(ctx) }, for the queue rows a plugin wrote, so
 *             Repair can swap a finished run into them. A row with an origin kind no plugin
 *             replaces is shown with Replace locked.
 *
 * Plugins load from the config on every read, the same as the config itself. The hosted site reads
 * no config, so it loads none. */

export type PluginHelpers = {
  expand: typeof expand;
  readJson: typeof readJson;
  ref: typeof ref;
};

export type ReplaceContext = {
  item: QueueItem;
  /** Files the run made, already filtered to images and video, in order. */
  visual: string[];
  /** The run's PDF, when it made one. */
  pdf?: string;
  /** The run's copy, when it changed it. */
  text?: string;
  /** Copies a run file next to the queued post and returns the copy's path. */
  copy: (file: string) => string;
  /** Where the old row must be saved, as JSON with a `kind` equal to the origin kind. */
  backup: string;
  atomicWrite: (file: string, body: string) => void;
};
export type UndoContext = { item: QueueItem; backup: Record<string, unknown> & { kind: string }; atomicWrite: (file: string, body: string) => void };

export type AircheckPlugin = {
  name?: string;
  lanes?: Record<string, (cfg: SourceConfig, h: PluginHelpers) => Lane[]>;
  products?: Record<string, (cfg: SourceConfig, h: PluginHelpers) => Product[]>;
  queue?: Record<string, { load: (cfg: SourceConfig, day: string, h: PluginHelpers) => QueueItem[]; readAt?: (cfg: SourceConfig, day: string, h: PluginHelpers) => string | undefined }>;
  ads?: Record<string, (cfg: SourceConfig, h: PluginHelpers) => AdCreative[]>;
  replace?: Record<string, { replace: (ctx: ReplaceContext) => void; undo: (ctx: UndoContext) => void }>;
};

/* Built on call, not at load: config.ts imports this module, so its exports are not ready yet. */
export const helpers = (): PluginHelpers => ({ expand, readJson, ref });

let active: AircheckPlugin[] = [];
const loaded = new Map<string, AircheckPlugin>();

/* A synchronous require that no bundler rewrites: the module is a file on this machine, read at
 * run time, never part of the build. Node 20.19+ and 22.12+ require() an ES module. */
function requireFile(file: string): AircheckPlugin {
  const mod = process.getBuiltinModule?.('node:module') as typeof import('node:module') | undefined;
  if (!mod) throw new Error('Aircheck plugins need Node 20.16 or newer.');
  const loadedMod = mod.createRequire(file)(file) as { default?: AircheckPlugin } & AircheckPlugin;
  return loadedMod.default || loadedMod;
}

/** Load the plugins a config names. Called by loadConfig, so every read sees the current list. */
export function loadPlugins(files: string[] | undefined) {
  active = (files || []).map((f) => {
    const file = expand(f);
    let p = loaded.get(file);
    if (!p) {
      try { p = requireFile(file); } catch (e) { throw new Error(`Aircheck plugin ${file} did not load: ${(e as Error).message}`); }
      loaded.set(file, p);
    }
    return p;
  });
}

/** Add a plugin object directly (tests, or an embedding app). */
export function registerPlugin(p: AircheckPlugin) { active = [...active.filter((x) => x !== p), p]; }
export function clearPlugins() { active = []; }

type Entry<K extends keyof AircheckPlugin> = NonNullable<AircheckPlugin[K]> extends Record<string, infer V> ? V : never;

export function pluginFor<K extends keyof AircheckPlugin>(table: K, name: string): Entry<K> | undefined {
  for (const p of active) {
    const t = p[table] as Record<string, unknown> | undefined;
    if (t && Object.prototype.hasOwnProperty.call(t, name)) return t[name] as Entry<K>;
  }
  return undefined;
}
