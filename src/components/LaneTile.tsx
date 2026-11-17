import type { Lane } from '@/server/types';
import { mediaUrl, platform } from '@/lib/ui';

/* The platforms whose own logo ships in public/logos (the redesign brief's logo set). Any other
 * platform keeps its glyph on its colour. */
const LOGO = new Set(['x', 'linkedin', 'threads', 'instagram', 'youtube', 'bluesky', 'tiktok']);
export const platformLogo = (p: string) => (LOGO.has(p) ? `/logos/${p}.svg` : '');

/* The small square a lane is drawn with in lists: its own logo when one is set, else the platform's
 * logo, else the platform glyph on the platform colour. `size` picks the list (sm), row (md) or
 * header (lg) square. */
export function LaneTile({ l, size = 'sm' }: { l: Pick<Lane, 'platform' | 'logo'>; size?: 'sm' | 'md' | 'lg' }) {
  const pl = platform(l.platform);
  const cls = `pi pi-${size}`;
  /* eslint-disable-next-line @next/next/no-img-element */
  if (l.logo) return <span className={`${cls} logo`}><img src={mediaUrl(l.logo)} alt="" /></span>;
  const own = platformLogo(l.platform);
  /* eslint-disable-next-line @next/next/no-img-element */
  if (own) return <span className={`${cls} brandlogo`}><img src={own} alt="" /></span>;
  return <span className={cls} style={{ background: pl.color }}><i className={`ph-fill ${pl.icon}`}></i></span>;
}
