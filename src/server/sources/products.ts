import { expand, type SourceConfig } from '../config';
import { helpers, pluginFor } from '../plugins';
import type { Product } from '../types';

/* PRODUCT SOURCES: what a preview run can be "about".
 *   static   items: Product[] in the config.
 * Any other source name comes from a plugin (see ../plugins.ts). */

export function loadProducts(cfg: SourceConfig): Product[] {
  if (cfg.source === 'static') return ((cfg.items as Product[]) || []).map((p) => ({ ...p, repository: p.repository ? expand(p.repository) : undefined }));
  const plugin = pluginFor('products', cfg.source);
  if (plugin) return plugin(cfg, helpers());
  throw new Error(`Unknown product source '${cfg.source}'`);
}
